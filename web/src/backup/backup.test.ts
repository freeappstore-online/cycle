import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import type { Migrations, VersionedPayload } from '../data/migrations'
import { type CycleRepository, type RepositoryOptions, createCycleRepository } from '../data/repository'
import { WrongPassphraseError, deriveKey, fromBase64, makeKeyCheck, newKdfParams, toBase64 } from '../sync/crypto'
import { SyncEngine, memorySyncStateStore } from '../sync/engine'
import { FakeKv } from '../test/fakeKv'
import { heavyDataset } from '../test/heavyDataset'
import {
  type EncryptedBackup,
  backupFileName,
  decryptBackup,
  makeEncryptedBackup,
  makePlainBackup,
  parseBackupFile,
  prepareImport,
} from './backup'
import fixtureV1 from './fixtures/backup-v1.json'

let n = 0
const repos: CycleRepository[] = []
function makeRepo(options: RepositoryOptions = {}) {
  const repo = createCycleRepository({ dbName: `backup-${++n}`, requestPersist: () => Promise.resolve(true), ...options })
  repos.push(repo)
  return repo
}
afterEach(async () => {
  await Promise.all(repos.splice(0).map((r) => r.close()))
})

/** Restores a backup file's text into a repo the way the Settings screen does. */
async function restore(repo: CycleRepository, text: string, mode: 'replace' | 'merge', passphrase?: string) {
  const file = parseBackupFile(text)
  const raw = file.kind === 'encrypted' ? await decryptBackup(file.backup, passphrase!) : file.backup
  const preview = prepareImport(raw)
  await repo.importAll(preview.data, { mode })
  return preview
}

async function seeded() {
  const repo = makeRepo()
  await repo.importAll(heavyDataset(2), { mode: 'replace' })
  await repo.putSettings({ defaultCycleLength: 30, weekStart: 0 })
  return repo
}

const PASS = 'long sync passphrase'

describe('plain backup', () => {
  it('export → wipe → import restores identical data', async () => {
    const source = await seeded()
    const original = await source.exportAll()
    const text = JSON.stringify(makePlainBackup(original, new Date('2026-10-15T09:00:00Z')))
    expect(JSON.parse(text)).toMatchObject({ format: 'cycle-backup', exportedAt: '2026-10-15T09:00:00.000Z', schemaVersion: 1 })

    // "Wipe": replace everything with an empty dataset.
    await source.importAll({ schemaVersion: 1, days: [], periods: [], settings: {} }, { mode: 'replace' })
    expect((await source.exportAll()).days).toEqual([])

    const preview = await restore(source, text, 'replace')
    expect(preview).toMatchObject({ days: original.days.length, periods: original.periods.length, from: '2020-01-01' })
    expect(await source.exportAll()).toEqual(original)
  })

  it('merges into existing data', async () => {
    const repo = makeRepo()
    await repo.putDay({ date: '2025-01-01', symptoms: ['acne'], updatedAt: 1 })
    await restore(repo, JSON.stringify(fixtureV1), 'merge')
    const data = await repo.exportAll()
    expect(data.days.map((d) => d.date)).toEqual(['2025-01-01', '2026-08-20', '2026-08-21', '2026-09-03', '2026-09-17'])
  })
})

describe('encrypted backup', () => {
  it('export → wipe → import restores identical data, and contains no plaintext', async () => {
    const source = await seeded()
    const original = await source.exportAll()
    const params = newKdfParams(1000)
    const key = await deriveKey(PASS, params)
    const backup = await makeEncryptedBackup(original, { key, params, check: await makeKeyCheck(key) })
    const text = JSON.stringify(backup)
    expect(Object.keys(backup).sort()).toEqual(['alg', 'check', 'data', 'exportedAt', 'format', 'iter', 'kdf', 'salt', 'v'])
    for (const secret of ['2020-01-01', 'cramps', 'ibuprofen', 'updatedAt', 'lutealLength']) expect(text).not.toContain(secret)

    const target = makeRepo()
    await restore(target, text, 'replace', PASS)
    expect(await target.exportAll()).toEqual(original)
  })

  it('uses the sync key and envelope, so the sync passphrase opens it', async () => {
    const repo = makeRepo()
    await repo.putDay({ date: '2026-03-01', symptoms: ['nausea'] })
    const engine = new SyncEngine({ repo, kv: new FakeKv(), auth: { user: { id: 'u' }, onChange: () => () => {} }, store: memorySyncStateStore(), iterations: 1000 })
    expect(engine.backupKey()).toBeUndefined()
    await engine.enable(PASS, { remember: false })
    const backup = await makeEncryptedBackup(await repo.exportAll(), engine.backupKey()!)
    const raw = await decryptBackup(parseBackupFile(JSON.stringify(backup)).backup as EncryptedBackup, PASS)
    expect(prepareImport(raw).data.days[0].symptoms).toEqual(['nausea'])
  })

  it('rejects a wrong passphrase and a tampered file', async () => {
    const params = newKdfParams(1000)
    const key = await deriveKey(PASS, params)
    const backup = await makeEncryptedBackup({ schemaVersion: 1, days: [], periods: [], settings: { lutealLength: 14, weekStart: 1, updatedAt: 0 } }, { key, params, check: await makeKeyCheck(key) })
    await expect(decryptBackup(backup, 'wrong one')).rejects.toBeInstanceOf(WrongPassphraseError)
    const bytes = fromBase64(backup.data)
    bytes[20] ^= 1
    await expect(decryptBackup({ ...backup, data: toBase64(bytes) }, PASS)).rejects.toThrow(/damaged/)
    expect(() => parseBackupFile(JSON.stringify({ ...backup, data: 5 }))).toThrow(/damaged/)
  })
})

describe('import validation', () => {
  it('imports the v1 fixture as-is', async () => {
    const repo = makeRepo()
    const preview = await restore(repo, JSON.stringify(fixtureV1), 'replace')
    expect(preview).toMatchObject({ days: 4, periods: 2, from: '2026-08-20', to: '2026-09-17', exportedAt: '2026-10-15T08:30:00.000Z' })
    const data = await repo.exportAll()
    expect(data.settings).toEqual(fixtureV1.settings)
    expect(data.days[2]).toEqual(fixtureV1.days[2])
  })

  it('migrates an older schemaVersion fixture', async () => {
    // A hypothetical schema 2 that records the "low_energy" mood as the "fatigue" symptom (as in the #137 fixture).
    const toV2 = (data: VersionedPayload) => ({
      ...data,
      days: data.days.map((raw) => {
        const day = raw as { mood?: string; symptoms: string[] }
        if (day.mood !== 'low_energy') return day
        const { mood: _dropped, ...rest } = day
        return { ...rest, symptoms: [...day.symptoms, 'fatigue'] }
      }),
    })
    const migrations: Migrations = { 1: toV2 }
    const preview = prepareImport(fixtureV1, { schemaVersion: 2, migrations })
    expect(preview.data.schemaVersion).toBe(2)
    expect(preview.data.days[0]).toEqual({ date: '2026-08-20', flow: 'heavy', symptoms: ['cramps', 'back_pain', 'fatigue'], updatedAt: 1786000000000 })

    const repo = makeRepo({ schemaVersion: 2, migrations })
    await repo.importAll(preview.data, { mode: 'replace' })
    expect((await repo.getDay('2026-09-17'))?.symptoms).toEqual(['tender_breasts', 'bloating', 'fatigue'])
  })

  it('rejects malformed files with a clear message and changes nothing', async () => {
    const repo = makeRepo()
    await repo.putDay({ date: '2026-01-01', symptoms: ['acne'] })
    const before = await repo.exportAll()

    expect(() => parseBackupFile('{"days": [')).toThrow(/isn't valid JSON/)
    expect(() => parseBackupFile('42')).toThrow(/isn't a Cycle backup/)
    expect(() => prepareImport(parseBackupFile('{"hello": "world"}').backup)).toThrow(/isn't a Cycle backup/)
    // One bad day among good ones: nothing is applied.
    const broken = { ...fixtureV1, days: [...fixtureV1.days, { date: '2026-02-30', symptoms: [], updatedAt: 1 }] }
    expect(() => prepareImport(broken)).toThrow(/date/)
    await expect(repo.importAll(broken, { mode: 'replace' })).rejects.toThrow()
    expect(() => prepareImport({ ...fixtureV1, schemaVersion: 99 })).toThrow(/newer version of Cycle/)

    expect(await repo.exportAll()).toEqual(before)
  })

  it('names files by date and type', () => {
    expect(backupFileName('2026-10-15', false)).toBe('cycle-backup-2026-10-15.json')
    expect(backupFileName('2026-10-15', true)).toBe('cycle-backup-2026-10-15.encrypted.json')
  })
})
