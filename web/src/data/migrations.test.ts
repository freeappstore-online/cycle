import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { openCycleDB } from './db'
import { type Migrations, type VersionedPayload, migratePayload } from './migrations'
import { createCycleRepository } from './repository'

// Fixture for a hypothetical schema 2 that drops the "low_energy" mood and
// records it as the "fatigue" symptom instead. It exercises both migration
// paths (stored data in onupgradeneeded, and imported payloads) with the
// same function.
const toV2 = (data: VersionedPayload) => ({
  ...data,
  days: data.days.map((raw) => {
    const day = raw as { mood?: string; symptoms: string[] }
    if (day.mood !== 'low_energy') return day
    const { mood: _dropped, ...rest } = day
    return { ...rest, symptoms: [...new Set([...day.symptoms, 'fatigue'])] }
  }),
})
const FIXTURE_MIGRATIONS: Migrations = { 1: toV2 }

const v1Payload = {
  schemaVersion: 1,
  days: [
    { date: '2026-01-05', flow: 'heavy', symptoms: ['cramps'], mood: 'low_energy', updatedAt: 1 },
    { date: '2026-01-06', symptoms: [], mood: 'calm', updatedAt: 1 },
  ],
  periods: [{ id: 'p1', start: '2026-01-05', end: '2026-01-09', updatedAt: 1 }],
  settings: { lutealLength: 13, weekStart: 1, updatedAt: 1 },
}

const persist = () => Promise.resolve(true)

describe('migratePayload', () => {
  it('runs each step up to the target version', () => {
    const out = migratePayload(v1Payload, 2, FIXTURE_MIGRATIONS)
    expect(out.schemaVersion).toBe(2)
    expect(out.days[0]).toEqual({ date: '2026-01-05', flow: 'heavy', symptoms: ['cramps', 'fatigue'], updatedAt: 1 })
    expect(out.days[1]).toEqual(v1Payload.days[1])
    // Input is untouched.
    expect(v1Payload.days[0].mood).toBe('low_energy')
  })

  it('is a no-op at the current version and refuses newer or unknown ones', () => {
    expect(migratePayload(v1Payload, 1, FIXTURE_MIGRATIONS)).toBe(v1Payload)
    expect(() => migratePayload({ ...v1Payload, schemaVersion: 3 }, 2, FIXTURE_MIGRATIONS)).toThrow(/newer/)
    expect(() => migratePayload(v1Payload, 3, FIXTURE_MIGRATIONS)).toThrow(/No migration from schema 2/)
  })
})

describe('v1 → v2 migration', () => {
  it('migrates stored data when the database upgrades', async () => {
    const dbName = 'migrate-stored'
    const v1 = createCycleRepository({ dbName, requestPersist: persist })
    await v1.importAll(v1Payload, { mode: 'replace' })
    await v1.close()

    const v2 = createCycleRepository({ dbName, schemaVersion: 2, migrations: FIXTURE_MIGRATIONS, requestPersist: persist })
    const exported = await v2.exportAll()
    expect(exported.schemaVersion).toBe(2)
    expect(exported.days[0]).toEqual({ date: '2026-01-05', flow: 'heavy', symptoms: ['cramps', 'fatigue'], updatedAt: 1 })
    expect(exported.periods).toEqual(v1Payload.periods)
    expect(exported.settings).toEqual(v1Payload.settings)
    await v2.close()

    const db = await openCycleDB({ name: dbName, version: 2, migrations: FIXTURE_MIGRATIONS })
    expect(await db.get('meta', 'schemaVersion')).toBe(2)
    db.close()
  })

  it('migrates an imported v1 payload in a v2 app', async () => {
    const v2 = createCycleRepository({
      dbName: 'migrate-import',
      schemaVersion: 2,
      migrations: FIXTURE_MIGRATIONS,
      requestPersist: persist,
    })
    await v2.importAll(v1Payload, { mode: 'merge' })
    expect(await v2.getDay('2026-01-05')).toEqual({
      date: '2026-01-05',
      flow: 'heavy',
      symptoms: ['cramps', 'fatigue'],
      updatedAt: 1,
    })
    await v2.close()
  })

  it('aborts the upgrade and keeps v1 data if a migration throws', async () => {
    const dbName = 'migrate-fails'
    const v1 = createCycleRepository({ dbName, requestPersist: persist })
    await v1.importAll(v1Payload, { mode: 'replace' })
    await v1.close()

    const broken: Migrations = {
      1: () => {
        throw new Error('boom')
      },
    }
    await expect(openCycleDB({ name: dbName, version: 2, migrations: broken })).rejects.toThrow('boom')

    const again = createCycleRepository({ dbName, requestPersist: persist })
    expect(await again.exportAll()).toMatchObject({ schemaVersion: 1, days: v1Payload.days })
    await again.close()
  })
})
