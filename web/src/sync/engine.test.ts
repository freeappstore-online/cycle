import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import { type CycleRepository, createCycleRepository } from '../data/repository'
import { WrongPassphraseError } from './crypto'
import { FakeKv } from '../test/fakeKv'
import { type AuthLike, SyncEngine, type SyncStateStore, idbSyncStateStore, memorySyncStateStore } from './engine'
import { META_KEY, type RemoteMeta } from './layout'

const signedIn = { user: { id: 'u1' }, onChange: () => () => {} }

let n = 0
const repos: CycleRepository[] = []
function device(kv: FakeKv, store: SyncStateStore = memorySyncStateStore(), auth: AuthLike = signedIn) {
  const repo = createCycleRepository({ dbName: `sync-${++n}`, requestPersist: () => Promise.resolve(true) })
  repos.push(repo)
  const engine = new SyncEngine({ repo, kv, auth, store, iterations: 1000 })
  return { repo, engine }
}

afterEach(async () => {
  await Promise.all(repos.splice(0).map((r) => r.close()))
})

const PASS = 'a long and memorable passphrase'
const dataOf = async (repo: CycleRepository) => {
  const { days, periods } = await repo.exportAll()
  return { days, periods }
}

describe('SyncEngine', () => {
  it('is off by default and does nothing until enabled', async () => {
    const kv = new FakeKv()
    const { repo, engine } = device(kv)
    await repo.putDay({ date: '2026-03-01', symptoms: ['cramps'] })
    await engine.sync()
    expect(engine.status().phase).toBe('off')
    expect(kv.data.size).toBe(0)
  })

  it('uploads only ciphertext and KDF metadata', async () => {
    const kv = new FakeKv()
    const { repo, engine } = device(kv)
    await repo.putDay({ date: '2026-03-01', flow: 'medium', symptoms: ['cramps', 'tender_breasts'], mood: 'anxious', note: 'Saw Dr Okafor' })
    await repo.upsertPeriod({ start: '2026-02-27', end: '2026-03-03' })
    await repo.putSettings({ defaultCycleLength: 31 })
    await engine.enable(PASS, { remember: false })

    expect([...kv.data.keys()].sort()).toEqual(['cycle:meta', 'cycle:y2026'])
    const everything = kv.sent.join('\n')
    for (const secret of ['2026-03-01', '2026-02-27', 'cramps', 'tender', 'medium', 'anxious', 'Okafor', 'defaultCycleLength', 'updatedAt', PASS]) {
      expect(everything).not.toContain(secret)
    }
    const meta = JSON.parse(kv.data.get(META_KEY)!) as RemoteMeta
    expect(Object.keys(meta).sort()).toEqual(['alg', 'check', 'head', 'iter', 'kdf', 'salt', 'v', 'years'])
    expect(engine.status()).toMatchObject({ phase: 'idle', pending: false })
  })

  it('converges two devices with the same passphrase, newest edit winning', async () => {
    const kv = new FakeKv()
    const a = device(kv)
    const b = device(kv)
    await a.repo.putDay({ date: '2026-03-01', symptoms: ['cramps'], updatedAt: 10 })
    await a.repo.upsertPeriod({ id: 'p1', start: '2026-03-01', end: '2026-03-04', updatedAt: 10 })
    await a.engine.enable(PASS, { remember: false })

    await b.repo.putDay({ date: '2026-03-02', symptoms: ['acne'], updatedAt: 11 })
    await b.engine.enable(PASS, { remember: false })
    expect((await dataOf(b.repo)).days.map((d) => d.date)).toEqual(['2026-03-01', '2026-03-02'])

    // Both edit the same day; B's edit is newer.
    await a.repo.putDay({ date: '2026-03-01', symptoms: ['fatigue'], updatedAt: 20 })
    await b.repo.putDay({ date: '2026-03-01', symptoms: ['nausea'], updatedAt: 30 })
    await a.repo.putDay({ date: '2026-03-05', symptoms: [], note: 'from A', updatedAt: 21 })
    await a.engine.sync()
    await b.engine.sync()
    await a.engine.sync()

    expect(await dataOf(a.repo)).toEqual(await dataOf(b.repo))
    expect((await a.repo.getDay('2026-03-01'))?.symptoms).toEqual(['nausea'])
    expect((await b.repo.getDay('2026-03-05'))?.note).toBe('from A')
  })

  it("propagates deletions instead of resurrecting them", async () => {
    const kv = new FakeKv()
    const a = device(kv)
    const b = device(kv)
    await a.repo.putDay({ date: '2026-03-01', symptoms: [], updatedAt: 1 })
    await a.repo.putDay({ date: '2026-03-02', symptoms: [], updatedAt: 1 })
    await a.engine.enable(PASS, { remember: false })
    await b.engine.enable(PASS, { remember: false })

    await a.repo.deleteDay('2026-03-01')
    await a.engine.sync()
    expect(await a.repo.getDay('2026-03-01')).toBeUndefined()
    await b.engine.sync()
    expect(await b.repo.getDay('2026-03-01')).toBeUndefined()
    await a.engine.sync()
    expect((await dataOf(a.repo)).days.map((d) => d.date)).toEqual(['2026-03-02'])
  })

  it('dedupes the same period logged on two devices', async () => {
    const kv = new FakeKv()
    const a = device(kv)
    const b = device(kv)
    await a.repo.upsertPeriod({ id: 'from-a', start: '2026-03-01', end: '2026-03-05', updatedAt: 5 })
    await b.repo.upsertPeriod({ id: 'from-b', start: '2026-03-02', end: '2026-03-05', updatedAt: 6 })
    await a.engine.enable(PASS, { remember: false })
    await b.engine.enable(PASS, { remember: false })
    await a.engine.sync()
    expect((await a.repo.listPeriods()).map((p) => p.id)).toEqual(['from-b'])
    expect((await b.repo.listPeriods()).map((p) => p.id)).toEqual(['from-b'])
  })

  it('rejects a wrong passphrase without touching either side', async () => {
    const kv = new FakeKv()
    const a = device(kv)
    await a.repo.putDay({ date: '2026-03-01', symptoms: ['cramps'] })
    await a.engine.enable(PASS, { remember: false })
    const cloud = new Map(kv.data)

    const b = device(kv)
    await b.repo.putDay({ date: '2026-04-01', symptoms: ['acne'] })
    const before = await dataOf(b.repo)
    await expect(b.engine.enable('not the passphrase', { remember: false })).rejects.toBeInstanceOf(WrongPassphraseError)
    expect(kv.data).toEqual(cloud)
    expect(await dataOf(b.repo)).toEqual(before)
    expect(b.engine.status().phase).toBe('off')
  })

  it('queues offline edits and syncs them when back online', async () => {
    const kv = new FakeKv()
    const a = device(kv)
    const b = device(kv)
    await a.engine.enable(PASS, { remember: false })
    await b.engine.enable(PASS, { remember: false })

    kv.online = false
    await a.repo.putDay({ date: '2026-05-01', symptoms: ['headache'] })
    await expect(a.engine.sync()).rejects.toThrow()
    expect(a.engine.status()).toMatchObject({ phase: 'error', pending: true, error: expect.stringMatching(/offline/) })
    expect(await a.repo.getDay('2026-05-01')).toBeDefined()

    kv.online = true
    await a.engine.sync()
    expect(a.engine.status()).toMatchObject({ phase: 'idle', pending: false, error: undefined })
    await b.engine.sync()
    expect((await b.repo.getDay('2026-05-01'))?.symptoms).toEqual(['headache'])
  })

  it('re-encrypts on a passphrase change; other devices must re-enter it', async () => {
    const kv = new FakeKv()
    const a = device(kv)
    const b = device(kv)
    await a.repo.putDay({ date: '2026-03-01', symptoms: ['cramps'] })
    await a.engine.enable(PASS, { remember: false })
    await b.engine.enable(PASS, { remember: false })
    const oldMeta = kv.data.get(META_KEY)
    const oldYear = kv.data.get('cycle:y2026')

    await a.engine.changePassphrase('a brand new passphrase')
    expect(kv.data.get(META_KEY)).not.toBe(oldMeta)
    expect(kv.data.get('cycle:y2026')).not.toBe(oldYear)

    const cloud = new Map(kv.data)
    await b.repo.putDay({ date: '2026-03-09', symptoms: [] })
    await b.engine.sync()
    expect(b.engine.status()).toMatchObject({ phase: 'locked', lockedReason: 'mismatch' })
    expect(kv.data).toEqual(cloud)

    await expect(b.engine.enable(PASS, { remember: false })).rejects.toBeInstanceOf(WrongPassphraseError)
    await b.engine.enable('a brand new passphrase', { remember: false })
    await a.engine.sync()
    expect(await dataOf(a.repo)).toEqual(await dataOf(b.repo))
  })

  it('splits a year that is too big for one value into parts', async () => {
    const kv = new FakeKv()
    const a = device(kv)
    // Random notes don't compress, so this year needs more than one 60 KB part.
    const noise = () => Array.from(crypto.getRandomValues(new Uint8Array(400)), (b) => (b % 36).toString(36)).join('')
    await a.repo.importAll(
      {
        schemaVersion: 1,
        days: Array.from({ length: 200 }, (_, i) => ({
          date: `2026-${String(Math.floor(i / 28) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`,
          symptoms: [],
          note: noise(),
          updatedAt: 1,
        })),
        periods: [],
        settings: { lutealLength: 14, weekStart: 1, updatedAt: 0 },
      },
      { mode: 'replace' },
    )
    await a.engine.enable(PASS, { remember: false })
    const meta = JSON.parse(kv.data.get(META_KEY)!) as RemoteMeta
    expect(meta.years['2026']).toBeGreaterThan(1)
    for (const v of kv.data.values()) expect(new TextEncoder().encode(v).length).toBeLessThanOrEqual(64 * 1024)

    const b = device(kv)
    await b.engine.enable(PASS, { remember: false })
    expect((await dataOf(b.repo)).days).toHaveLength(200)

    // Shrinking back to one part deletes the leftover parts.
    for (const d of (await a.repo.exportAll()).days.slice(10)) await a.repo.deleteDay(d.date)
    await a.engine.sync()
    expect([...kv.data.keys()].sort()).toEqual(['cycle:meta', 'cycle:y2026'])
  })

  it('turning sync off deletes every cycle:* key and keeps local data', async () => {
    const kv = new FakeKv()
    kv.data.set('other-app-key', '"keep"')
    const a = device(kv)
    await a.repo.putDay({ date: '2026-03-01', symptoms: [] })
    await a.engine.enable(PASS, { remember: false })
    await a.engine.disable()
    expect([...kv.data.keys()]).toEqual(['other-app-key'])
    expect(await a.repo.getDay('2026-03-01')).toBeDefined()
    expect(a.engine.status().phase).toBe('off')
  })

  it('forgot passphrase: wipes the cloud copy and re-uploads this device under a new one', async () => {
    const kv = new FakeKv()
    const a = device(kv)
    await a.repo.putDay({ date: '2026-03-01', symptoms: [] })
    await a.engine.enable(PASS, { remember: false })
    const b = device(kv)
    await b.repo.putDay({ date: '2026-06-01', symptoms: [] })
    await b.engine.resetCloud('fresh start passphrase', { remember: false })
    const c = device(kv)
    await c.engine.enable('fresh start passphrase', { remember: false })
    expect((await dataOf(c.repo)).days.map((d) => d.date)).toEqual(['2026-06-01'])
  })

  it('remembers the key across launches only when asked to', async () => {
    const kv = new FakeKv()
    const store = idbSyncStateStore(`sync-state-${++n}`)
    const a = device(kv, store)
    await a.engine.enable(PASS, { remember: true })

    const relaunch = new SyncEngine({ repo: a.repo, kv, auth: signedIn, store, iterations: 1000 })
    await relaunch.sync()
    expect(relaunch.status()).toMatchObject({ phase: 'idle', rememberKey: true })

    await relaunch.setRemember(false)
    const again = new SyncEngine({ repo: a.repo, kv, auth: signedIn, store, iterations: 1000 })
    await again.sync()
    expect(again.status()).toMatchObject({ phase: 'locked', lockedReason: 'no-key', enabled: true })
  })

  it('waits for sign-in, keeping changes pending', async () => {
    const kv = new FakeKv()
    const auth = { user: null as unknown, onChange: () => () => {} }
    const a = device(kv, memorySyncStateStore(), auth)
    auth.user = { id: 'u1' }
    await a.engine.enable(PASS, { remember: false })
    auth.user = null
    await a.repo.putDay({ date: '2026-03-01', symptoms: [] })
    await a.engine.sync()
    expect(a.engine.status()).toMatchObject({ phase: 'signed-out', pending: true })
    await expect(a.engine.disable()).rejects.toThrow(/Sign in/)
  })
})
