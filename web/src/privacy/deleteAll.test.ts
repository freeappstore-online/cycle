import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import { type CycleRepository, createCycleRepository } from '../data/repository'
import { type AuthLike, SyncEngine, memorySyncStateStore } from '../sync/engine'
import { FakeKv } from '../test/fakeKv'
import { NeedsSignInError, deleteAllData } from './deleteAll'

let n = 0
const repos: CycleRepository[] = []

async function device(user: unknown) {
  const kv = new FakeKv()
  kv.data.set('other-app-key', '"keep"')
  const auth: AuthLike & { user: unknown } = { user, onChange: () => () => {} }
  const repo = createCycleRepository({ dbName: `delete-${++n}`, requestPersist: () => Promise.resolve(true) })
  repos.push(repo)
  await repo.putDay({ date: '2026-03-01', symptoms: ['cramps'], note: 'private' })
  await repo.upsertPeriod({ start: '2026-03-01', end: '2026-03-05' })
  await repo.putSettings({ defaultCycleLength: 30 })
  const engine = new SyncEngine({ repo, kv, auth, store: memorySyncStateStore(), iterations: 1000 })
  return { kv, auth, repo, engine }
}

const isEmpty = async (repo: CycleRepository) => {
  const data = await repo.exportAll()
  return data.days.length === 0 && data.periods.length === 0 && data.settings.defaultCycleLength === undefined
}

afterEach(async () => {
  await Promise.all(repos.splice(0).map((r) => r.close()))
})

describe('deleteAllData', () => {
  it('signed in with sync on: deletes local data, every cycle:* key and the sync state', async () => {
    const { kv, repo, engine } = await device({ id: 'u' })
    await engine.enable('a long passphrase', { remember: true })
    expect([...kv.data.keys()].filter((k) => k.startsWith('cycle:')).length).toBeGreaterThan(0)

    await deleteAllData({ repo, engine, signedIn: true })
    expect([...kv.data.keys()]).toEqual(['other-app-key'])
    expect(await isEmpty(repo)).toBe(true)
    expect(engine.status()).toMatchObject({ phase: 'off', enabled: false, rememberKey: false })
    expect(engine.backupKey()).toBeUndefined()
  })

  it('signed in without sync here: still removes a cloud copy made on another device', async () => {
    const { kv, repo, engine } = await device({ id: 'u' })
    kv.data.set('cycle:meta', '{}')
    kv.data.set('cycle:y2026', '"ciphertext"')
    await deleteAllData({ repo, engine, signedIn: true })
    expect([...kv.data.keys()]).toEqual(['other-app-key'])
    expect(await isEmpty(repo)).toBe(true)
  })

  it('signed out with sync on: refuses and changes nothing until signed in', async () => {
    const { kv, auth, repo, engine } = await device({ id: 'u' })
    await engine.enable('a long passphrase', { remember: false })
    auth.user = null
    const cloud = new Map(kv.data)
    await expect(deleteAllData({ repo, engine, signedIn: false })).rejects.toBeInstanceOf(NeedsSignInError)
    expect(kv.data).toEqual(cloud)
    expect(await isEmpty(repo)).toBe(false)
  })

  it('signed out without sync: wipes this device', async () => {
    const { kv, repo, engine } = await device(null)
    await deleteAllData({ repo, engine, signedIn: false })
    expect(await isEmpty(repo)).toBe(true)
    expect([...kv.data.keys()]).toEqual(['other-app-key'])
  })
})
