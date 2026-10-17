// The CRUD API screens use. Local-only: no network calls. The database opens
// lazily on first use, so importing this module doesn't touch IndexedDB.

import type { IDBPDatabase } from 'idb'
import { createLocalRepository } from './localRepository'
import { type CycleDB, DATA_STORES, DB_NAME, SETTINGS_KEY, openCycleDB } from './db'
import { MIGRATIONS, type Migrations, SCHEMA_VERSION, asVersionedPayload, migratePayload } from './migrations'
import type { CycleExport, DateRange, DayLog, ImportMode, ISODate, Period, Settings } from './types'
import { DEFAULT_SETTINGS } from './types'
import { periodsOverlap, validateDay, validateExport, validatePeriod, validateSettings } from './validate'

export type DayInput = Omit<DayLog, 'updatedAt'> & { updatedAt?: number }
export type PeriodInput = Omit<Period, 'id' | 'updatedAt'> & { id?: string; updatedAt?: number }
export type SettingsInput = Partial<Omit<Settings, 'updatedAt'>>

export interface CycleRepository {
  getDay(date: ISODate): Promise<DayLog | undefined>
  putDay(day: DayInput): Promise<DayLog>
  deleteDay(date: ISODate): Promise<void>
  /** Day logs with from <= date <= to, oldest first. */
  listDays(range: DateRange): Promise<DayLog[]>
  /** Periods sorted by start. With a range, only periods that overlap it. */
  listPeriods(range?: DateRange): Promise<Period[]>
  /** Creates (no id) or replaces a period. Rejects one that overlaps another period. */
  upsertPeriod(period: PeriodInput): Promise<Period>
  deletePeriod(id: string): Promise<void>
  getSettings(): Promise<Settings>
  /** Merges a partial update into the stored settings. */
  putSettings(settings: SettingsInput): Promise<Settings>
  exportAll(): Promise<CycleExport>
  /**
   * Imports a payload from exportAll (any older schemaVersion is migrated first).
   * replace: the payload becomes the whole dataset.
   * merge: per day, period and settings record, the newer updatedAt wins.
   * Imported periods aren't checked for overlap; sync (#141) resolves those.
   */
  importAll(data: unknown, options: { mode: ImportMode }): Promise<void>
  /** Deletes every day, period and setting on this device. */
  clearAll(): Promise<void>
  /** Called after any write, from this tab or another. Returns an unsubscribe function. */
  subscribe(listener: () => void): () => void
  close(): Promise<void>
}

export interface RepositoryOptions {
  dbName?: string
  schemaVersion?: number
  migrations?: Migrations
  /** Asked once, after the first write. Defaults to navigator.storage.persist(). */
  requestPersist?: () => Promise<boolean>
  now?: () => number
}

function defaultRequestPersist(): Promise<boolean> {
  return typeof navigator !== 'undefined' && navigator.storage?.persist
    ? navigator.storage.persist()
    : Promise.resolve(false)
}

function newId(): string {
  return crypto.randomUUID()
}

function createIndexedRepository({
  dbName = DB_NAME,
  schemaVersion = SCHEMA_VERSION,
  migrations = MIGRATIONS,
  requestPersist = defaultRequestPersist,
  now = Date.now,
}: RepositoryOptions = {}): CycleRepository {
  let dbPromise: Promise<IDBPDatabase<CycleDB>> | undefined
  const db = () => (dbPromise ??= openCycleDB({ name: dbName, version: schemaVersion, migrations }))

  const listeners = new Set<() => void>()
  const notifyLocal = () => listeners.forEach((l) => l())
  // Keeps other open tabs in step. Unavailable in some test environments.
  const channel = typeof BroadcastChannel === 'undefined' ? undefined : new BroadcastChannel(`cycle-data:${dbName}`)
  if (channel) channel.onmessage = notifyLocal

  let persistAsked = false
  async function afterWrite() {
    notifyLocal()
    channel?.postMessage('changed')
    if (persistAsked) return
    persistAsked = true
    const d = await db()
    if (await d.get('meta', 'persistRequested')) return
    await d.put('meta', true, 'persistRequested')
    requestPersist().catch(() => {})
  }

  async function readSettings(d: IDBPDatabase<CycleDB>): Promise<Settings> {
    return (await d.get('settings', SETTINGS_KEY)) ?? { ...DEFAULT_SETTINGS }
  }

  return {
    async getDay(date) {
      return (await db()).get('days', date)
    },

    async putDay(input) {
      const day = validateDay({ ...input, updatedAt: input.updatedAt ?? now() })
      await (await db()).put('days', day)
      await afterWrite()
      return day
    },

    async deleteDay(date) {
      await (await db()).delete('days', date)
      await afterWrite()
    },

    async listDays({ from, to }) {
      if (from > to) return []
      return (await db()).getAll('days', IDBKeyRange.bound(from, to))
    },

    async listPeriods(range) {
      const all = await (await db()).getAllFromIndex('periods', 'start')
      if (!range) return all
      const window: Period = { id: '', start: range.from, end: range.to, updatedAt: 0 }
      return all.filter((p) => periodsOverlap(p, window))
    },

    async upsertPeriod(input) {
      const period = validatePeriod({ ...input, id: input.id ?? newId(), updatedAt: input.updatedAt ?? now() })
      const d = await db()
      const tx = d.transaction('periods', 'readwrite')
      const others = (await tx.store.getAll()).filter((p) => p.id !== period.id)
      const clash = others.find((p) => periodsOverlap(p, period))
      if (clash) {
        tx.abort()
        await tx.done.catch(() => {})
        throw new Error(`Period overlaps another period starting ${clash.start}`)
      }
      await tx.store.put(period)
      await tx.done
      await afterWrite()
      return period
    },

    async deletePeriod(id) {
      await (await db()).delete('periods', id)
      await afterWrite()
    },

    async getSettings() {
      return readSettings(await db())
    },

    async putSettings(input) {
      const d = await db()
      const settings = validateSettings({ ...(await readSettings(d)), ...input, updatedAt: now() })
      await d.put('settings', settings, SETTINGS_KEY)
      await afterWrite()
      return settings
    },

    async exportAll() {
      const tx = (await db()).transaction(DATA_STORES, 'readonly')
      const [days, periods, settings] = await Promise.all([
        tx.objectStore('days').getAll(),
        tx.objectStore('periods').index('start').getAll(),
        tx.objectStore('settings').get(SETTINGS_KEY),
      ])
      return { schemaVersion, days, periods, settings: settings ?? { ...DEFAULT_SETTINGS } }
    },

    async importAll(raw, { mode }) {
      const data = validateExport(migratePayload(asVersionedPayload(raw), schemaVersion, migrations))
      const tx = (await db()).transaction(DATA_STORES, 'readwrite')
      const days = tx.objectStore('days')
      const periods = tx.objectStore('periods')
      const settings = tx.objectStore('settings')
      if (mode === 'replace') {
        await Promise.all([days.clear(), periods.clear(), settings.clear()])
        await Promise.all([
          ...data.days.map((day) => days.put(day)),
          ...data.periods.map((p) => periods.put(p)),
          settings.put(data.settings, SETTINGS_KEY),
        ])
      } else {
        const [existingDays, existingPeriods, existingSettings] = await Promise.all([
          days.getAll(),
          periods.getAll(),
          settings.get(SETTINGS_KEY),
        ])
        const dayAt = new Map(existingDays.map((d) => [d.date, d.updatedAt]))
        const periodAt = new Map(existingPeriods.map((p) => [p.id, p.updatedAt]))
        await Promise.all([
          ...data.days.filter((d) => d.updatedAt > (dayAt.get(d.date) ?? -1)).map((d) => days.put(d)),
          ...data.periods.filter((p) => p.updatedAt > (periodAt.get(p.id) ?? -1)).map((p) => periods.put(p)),
          data.settings.updatedAt > (existingSettings?.updatedAt ?? -1)
            ? settings.put(data.settings, SETTINGS_KEY)
            : Promise.resolve(),
        ])
      }
      await tx.done
      await afterWrite()
    },

    async clearAll() {
      const tx = (await db()).transaction(DATA_STORES, 'readwrite')
      await Promise.all(DATA_STORES.map((s) => tx.objectStore(s).clear()))
      await tx.done
      await afterWrite()
    },

    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    async close() {
      channel?.close()
      listeners.clear()
      const open = dbPromise
      dbPromise = undefined
      if (open) (await open).close()
    },
  }
}

/** Select once per connection; never fall back after a successful open. */
export function createCycleRepository(options: RepositoryOptions = {}): CycleRepository {
  let selected: Promise<CycleRepository> | undefined
  const listeners = new Set<() => void>()
  function backend() {
    return selected ??= (async () => {
      let repo: CycleRepository
      if (typeof indexedDB === 'undefined') repo = createLocalRepository(options)
      else {
        const indexed = createIndexedRepository(options)
        try { await indexed.getSettings(); repo = indexed }
        catch (error) {
          await indexed.close().catch(() => {})
          // Preserve schema/migration errors instead of hiding existing records.
          if (typeof error !== 'object' || error === null || !('name' in error) || !['SecurityError', 'UnknownError', 'InvalidStateError', 'NotSupportedError'].includes(String(error.name))) throw error
          repo = createLocalRepository(options)
        }
      }
      repo.subscribe(() => listeners.forEach((listener) => listener()))
      return repo
    })()
  }
  return {
    getDay: async (date) => (await backend()).getDay(date),
    putDay: async (day) => (await backend()).putDay(day),
    deleteDay: async (date) => (await backend()).deleteDay(date),
    listDays: async (range) => (await backend()).listDays(range),
    listPeriods: async (range) => (await backend()).listPeriods(range),
    upsertPeriod: async (period) => (await backend()).upsertPeriod(period),
    deletePeriod: async (id) => (await backend()).deletePeriod(id),
    getSettings: async () => (await backend()).getSettings(),
    putSettings: async (settings) => (await backend()).putSettings(settings),
    exportAll: async () => (await backend()).exportAll(),
    importAll: async (data, mode) => (await backend()).importAll(data, mode),
    clearAll: async () => (await backend()).clearAll(),
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    async close() {
      listeners.clear()
      const open = selected
      selected = undefined
      if (open) await (await open).close()
    },
  }
}

/** The app-wide repository. */
export const cycleRepo = createCycleRepository()
