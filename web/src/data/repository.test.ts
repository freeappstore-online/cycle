// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openCycleDB } from './db'
import { type CycleRepository, type RepositoryOptions, createCycleRepository } from './repository'
import { DEFAULT_SETTINGS, type CycleExport } from './types'

describe.each(['indexedDB', 'localStorage'])('%s repository', (backend) => {
  beforeEach(() => {
    if (backend === 'localStorage') vi.stubGlobal('indexedDB', undefined)
  })

  let dbCount = 0
  const open: CycleRepository[] = []

  function makeRepo(options: RepositoryOptions = {}) {
    const repo = createCycleRepository({
      dbName: `test-${++dbCount}`,
      requestPersist: () => Promise.resolve(true),
      ...options,
    })
    open.push(repo)
    return repo
  }

  afterEach(async () => {
    await Promise.all(open.splice(0).map((r) => r.close()))
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    localStorage.clear()
  })

  describe('days', () => {
    it('puts, gets, overwrites and deletes a day', async () => {
      const repo = makeRepo({ now: () => 1000 })
      expect(await repo.getDay('2026-03-01')).toBeUndefined()

      const saved = await repo.putDay({ date: '2026-03-01', flow: 'medium', symptoms: ['cramps'], note: 'ok' })
      expect(saved).toEqual({ date: '2026-03-01', flow: 'medium', symptoms: ['cramps'], note: 'ok', updatedAt: 1000 })
      expect(await repo.getDay('2026-03-01')).toEqual(saved)

      await repo.putDay({ date: '2026-03-01', symptoms: ['headache', 'headache'], mood: 'calm' })
      expect(await repo.getDay('2026-03-01')).toEqual({
        date: '2026-03-01',
        symptoms: ['headache'],
        mood: 'calm',
        updatedAt: 1000,
      })

      await repo.deleteDay('2026-03-01')
      expect(await repo.getDay('2026-03-01')).toBeUndefined()
    })

    it('rejects invalid days', async () => {
      const repo = makeRepo()
      await expect(repo.putDay({ date: '2026-02-30', symptoms: [] })).rejects.toThrow(/date/)
      await expect(repo.putDay({ date: '2026-3-1', symptoms: [] })).rejects.toThrow(/date/)
      // @ts-expect-error unknown flow
      await expect(repo.putDay({ date: '2026-03-01', flow: 'torrential', symptoms: [] })).rejects.toThrow(/flow/)
      // @ts-expect-error unknown symptom
      await expect(repo.putDay({ date: '2026-03-01', symptoms: ['hiccups'] })).rejects.toThrow(/symptoms/)
    })

    it('lists days in an inclusive range, oldest first', async () => {
      const repo = makeRepo()
      for (const date of ['2026-01-31', '2026-02-01', '2026-02-15', '2026-02-28', '2026-03-01']) {
        await repo.putDay({ date, symptoms: [] })
      }
      const feb = await repo.listDays({ from: '2026-02-01', to: '2026-02-28' })
      expect(feb.map((d) => d.date)).toEqual(['2026-02-01', '2026-02-15', '2026-02-28'])
      expect(await repo.listDays({ from: '2025-01-01', to: '2025-12-31' })).toEqual([])
      expect(await repo.listDays({ from: '2026-03-01', to: '2026-02-01' })).toEqual([])
    })
  })

  describe('periods', () => {
    it('creates, updates, lists sorted and deletes periods', async () => {
      const repo = makeRepo()
      const b = await repo.upsertPeriod({ start: '2026-02-03', end: '2026-02-07' })
      const a = await repo.upsertPeriod({ start: '2026-01-05', end: '2026-01-09' })
      expect(a.id).not.toBe(b.id)
      expect((await repo.listPeriods()).map((p) => p.start)).toEqual(['2026-01-05', '2026-02-03'])

      const ongoing = await repo.upsertPeriod({ start: '2026-03-02' })
      expect(ongoing.end).toBeUndefined()
      await repo.upsertPeriod({ ...ongoing, end: '2026-03-06' })
      expect((await repo.listPeriods()).at(-1)).toMatchObject({ id: ongoing.id, end: '2026-03-06' })

      await repo.deletePeriod(a.id)
      expect((await repo.listPeriods()).map((p) => p.id)).toEqual([b.id, ongoing.id])
    })

    it('lists periods overlapping a range', async () => {
      const repo = makeRepo()
      await repo.upsertPeriod({ start: '2026-01-29', end: '2026-02-02' })
      await repo.upsertPeriod({ start: '2026-02-26', end: '2026-03-02' })
      await repo.upsertPeriod({ start: '2026-03-26' })
      const feb = await repo.listPeriods({ from: '2026-02-01', to: '2026-02-28' })
      expect(feb.map((p) => p.start)).toEqual(['2026-01-29', '2026-02-26'])
      const later = await repo.listPeriods({ from: '2026-05-01', to: '2026-05-31' })
      expect(later.map((p) => p.start)).toEqual(['2026-03-26'])
    })

    it('rejects overlapping and backwards periods', async () => {
      const repo = makeRepo()
      await repo.upsertPeriod({ start: '2026-01-05', end: '2026-01-09' })
      await expect(repo.upsertPeriod({ start: '2026-01-09', end: '2026-01-12' })).rejects.toThrow(/overlaps/)
      await expect(repo.upsertPeriod({ start: '2026-01-01' })).rejects.toThrow(/overlaps/)
      await expect(repo.upsertPeriod({ start: '2026-02-05', end: '2026-02-01' })).rejects.toThrow(/end/)
      expect(await repo.listPeriods()).toHaveLength(1)
    })
  })

  describe('settings', () => {
    it('returns defaults, then merges partial updates', async () => {
      const repo = makeRepo({ now: () => 5 })
      expect(await repo.getSettings()).toEqual(DEFAULT_SETTINGS)
      await repo.putSettings({ defaultCycleLength: 30 })
      await repo.putSettings({ weekStart: 0 })
      expect(await repo.getSettings()).toEqual({ lutealLength: 14, weekStart: 0, defaultCycleLength: 30, updatedAt: 5 })
      await expect(repo.putSettings({ lutealLength: 40 })).rejects.toThrow(/lutealLength/)
    })
  })

  describe('persistence', () => {
    it('keeps data across connections (reloads)', async () => {
      const dbName = `persist-${++dbCount}`
      const first = createCycleRepository({ dbName, requestPersist: () => Promise.resolve(true) })
      await first.putDay({ date: '2026-04-01', flow: 'light', symptoms: [] })
      await first.close()
      const second = makeRepo({ dbName })
      expect(await second.getDay('2026-04-01')).toMatchObject({ flow: 'light' })
    })

    it.skipIf(backend === 'localStorage')('asks for persistent storage once, after the first write', async () => {
      const dbName = `persist-${++dbCount}`
      const requestPersist = vi.fn(() => Promise.resolve(true))
      const first = createCycleRepository({ dbName, requestPersist })
      await first.getSettings()
      expect(requestPersist).not.toHaveBeenCalled()
      await first.putDay({ date: '2026-04-01', symptoms: [] })
      await first.putDay({ date: '2026-04-02', symptoms: [] })
      await first.close()
      await makeRepo({ dbName, requestPersist }).putDay({ date: '2026-04-03', symptoms: [] })
      expect(requestPersist).toHaveBeenCalledTimes(1)
    })

    it('notifies subscribers after writes', async () => {
      const repo = makeRepo()
      const listener = vi.fn()
      const unsubscribe = repo.subscribe(listener)
      await repo.putDay({ date: '2026-04-01', symptoms: [] })
      await repo.upsertPeriod({ start: '2026-04-01' })
      expect(listener).toHaveBeenCalledTimes(2)
      unsubscribe()
      await repo.deleteDay('2026-04-01')
      expect(listener).toHaveBeenCalledTimes(2)
    })
  })

  describe('exportAll / importAll', () => {
    async function seed(repo: CycleRepository) {
      await repo.putDay({ date: '2026-01-05', flow: 'heavy', symptoms: ['cramps', 'fatigue'], updatedAt: 100 })
      await repo.putDay({ date: '2026-01-06', flow: 'medium', symptoms: [], mood: 'irritable', updatedAt: 100 })
      await repo.upsertPeriod({ id: 'p1', start: '2026-01-05', end: '2026-01-09', updatedAt: 100 })
      await repo.putSettings({ defaultCycleLength: 29 })
    }

    it('round-trips through JSON in replace mode', async () => {
      const source = makeRepo({ now: () => 100 })
      await seed(source)
      const exported = await source.exportAll()
      expect(exported.schemaVersion).toBe(1)
      expect(exported.days).toHaveLength(2)

      const target = makeRepo()
      await target.putDay({ date: '2025-12-01', symptoms: ['acne'] })
      await target.importAll(JSON.parse(JSON.stringify(exported)), { mode: 'replace' })
      expect(await target.exportAll()).toEqual(exported)
    })

    it('merges by newest updatedAt', async () => {
      const local = makeRepo({ now: () => 100 })
      await seed(local)
      await local.putDay({ date: '2026-01-10', symptoms: ['acne'], updatedAt: 100 })

      const incoming: CycleExport = {
        schemaVersion: 1,
        days: [
          { date: '2026-01-05', flow: 'light', symptoms: [], updatedAt: 200 }, // newer: wins
          { date: '2026-01-06', flow: 'spotting', symptoms: [], updatedAt: 50 }, // older: ignored
          { date: '2026-02-01', symptoms: ['headache'], updatedAt: 10 }, // new: added
        ],
        periods: [
          { id: 'p1', start: '2026-01-05', end: '2026-01-08', updatedAt: 200 },
          { id: 'p2', start: '2026-02-02', end: '2026-02-06', updatedAt: 10 },
        ],
        settings: { ...DEFAULT_SETTINGS, defaultCycleLength: 31, updatedAt: 1 },
      }
      await local.importAll(incoming, { mode: 'merge' })

      const merged = await local.exportAll()
      expect(merged.days.map((d) => [d.date, d.flow ?? null])).toEqual([
        ['2026-01-05', 'light'],
        ['2026-01-06', 'medium'],
        ['2026-01-10', null],
        ['2026-02-01', null],
      ])
      expect(merged.periods).toEqual(incoming.periods)
      expect(merged.settings.defaultCycleLength).toBe(29)
    })

    it('rejects malformed payloads without changing data', async () => {
      const repo = makeRepo()
      await repo.putDay({ date: '2026-01-05', symptoms: [] })
      await expect(repo.importAll({ hello: 'world' }, { mode: 'replace' })).rejects.toThrow(/Not a Cycle export/)
      await expect(
        repo.importAll(
          { schemaVersion: 1, days: [{ date: 'nope', symptoms: [], updatedAt: 1 }], periods: [], settings: {} },
          { mode: 'replace' },
        ),
      ).rejects.toThrow(/date/)
      await expect(
        repo.importAll({ schemaVersion: 99, days: [], periods: [], settings: {} }, { mode: 'replace' }),
      ).rejects.toThrow(/newer version/)
      expect(await repo.listDays({ from: '2026-01-01', to: '2026-12-31' })).toHaveLength(1)
    })

    it.skipIf(backend === 'localStorage')('writes the schema version to meta', async () => {
      const repo = makeRepo()
      await repo.getSettings()
      const db = await openCycleDB({ name: `test-${dbCount}` })
      expect(await db.get('meta', 'schemaVersion')).toBe(1)
      db.close()
    })
  })

    it('reloads periods and onboarding settings, retaining notes and mood', async () => {
      const dbName = 'reload-' + crypto.randomUUID()
      const first = makeRepo({ dbName })
      await first.putDay({ date: '2026-01-01', symptoms: ['cramps'], mood: 'calm', note: 'private' })
      const period = await first.upsertPeriod({ start: '2026-01-01', end: '2026-01-05' })
      await first.putSettings({ defaultCycleLength: 29, defaultPeriodLength: 5 })
      const saved = await first.exportAll()
      await first.close()
      const second = makeRepo({ dbName })
      expect(await second.exportAll()).toEqual(saved)
      await second.deletePeriod(period.id)
      expect(await second.getDay('2026-01-01')).toMatchObject({ note: 'private' })
      await second.clearAll()
      expect(await makeRepo({ dbName }).exportAll()).toMatchObject({ days: [], periods: [], settings: DEFAULT_SETTINGS })
    })

    it.skipIf(backend !== 'localStorage')('rejects failed writes without notifying or changing data', async () => {
      const repo = makeRepo()
      await repo.putDay({ date: '2026-01-01', symptoms: [] })
      const saved = await repo.exportAll()
      const listener = vi.fn()
      repo.subscribe(listener)
      const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Full', 'QuotaExceededError') })
      await expect(repo.putDay({ date: '2026-01-02', symptoms: [] })).rejects.toThrow(/not been saved/)
      expect(listener).not.toHaveBeenCalled()
      spy.mockRestore()
      expect(await repo.exportAll()).toEqual(saved)
    })

    it.skipIf(backend !== 'localStorage')('reports denied reads and corrupt storage without overwriting it', async () => {
      const dbName = 'corrupt'
      localStorage.setItem('cycle-data:' + dbName, '{broken')
      const repo = makeRepo({ dbName })
      await expect(repo.putDay({ date: '2026-01-01', symptoms: [] })).rejects.toThrow(/Unable to read/)
      expect(localStorage.getItem('cycle-data:' + dbName)).toBe('{broken')
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('Denied', 'SecurityError') })
      await expect(repo.getSettings()).rejects.toThrow(/Unable to read/)
    })
})

it('falls back when IndexedDB opening is denied', async () => {
  vi.spyOn(indexedDB, 'open').mockImplementation(() => { throw new DOMException('Denied', 'SecurityError') })
  const repo = createCycleRepository({ dbName: 'denied' })
  try {
    await repo.putSettings({ defaultCycleLength: 28 })
    expect(await repo.getSettings()).toMatchObject({ defaultCycleLength: 28 })
  } finally {
    await repo.close()
    vi.restoreAllMocks()
    localStorage.clear()
  }
})
