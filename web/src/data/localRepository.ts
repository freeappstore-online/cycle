import type { CycleRepository, RepositoryOptions } from './repository'
import { DEFAULT_SETTINGS, type CycleExport } from './types'
import { asVersionedPayload, migratePayload, MIGRATIONS, SCHEMA_VERSION } from './migrations'
import { periodsOverlap, validateDay, validateExport, validatePeriod, validateSettings } from './validate'

/** A single JSON write keeps each fallback mutation atomic, including imports. */
export function createLocalRepository(options: RepositoryOptions = {}): CycleRepository {
  const key = `cycle-data:${options.dbName ?? 'cycle'}`
  const version = options.schemaVersion ?? SCHEMA_VERSION
  const now = options.now ?? Date.now
  const listeners = new Set<() => void>()
  function read(): CycleExport {
    try {
      const raw = localStorage.getItem(key)
      return raw === null
        ? { schemaVersion: version, days: [], periods: [], settings: { ...DEFAULT_SETTINGS } }
        : validateExport(migratePayload(asVersionedPayload(JSON.parse(raw)), version, options.migrations ?? MIGRATIONS))
    } catch (cause) {
      throw new Error('Unable to read local cycle storage. Existing data has not been changed.', { cause })
    }
  }
  function write(data: CycleExport) {
    try {
      localStorage.setItem(key, JSON.stringify(data))
    } catch (cause) {
      throw new Error('Unable to save local cycle storage. Changes have not been saved.', { cause })
    }
    listeners.forEach((listener) => listener())
  }
  const storageChanged = (event: StorageEvent) => {
    if (event.key === key || event.key === null) listeners.forEach((listener) => listener())
  }
  if (typeof window !== 'undefined') window.addEventListener('storage', storageChanged)
  const sortedPeriods = (data: CycleExport) => data.periods.sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id))
  return {
    async getDay(date) { return read().days.find((day) => day.date === date) },
    async putDay(input) {
      const day = validateDay({ ...input, updatedAt: input.updatedAt ?? now() })
      const data = read()
      data.days = [...data.days.filter((d) => d.date !== day.date), day]
      write(data)
      return day
    },
    async deleteDay(date) {
      const data = read()
      data.days = data.days.filter((day) => day.date !== date)
      write(data)
    },
    async listDays({ from, to }) {
      return read().days.filter((day) => day.date >= from && day.date <= to).sort((a, b) => a.date.localeCompare(b.date))
    },
    async listPeriods(range) {
      return sortedPeriods(read()).filter((period) => !range || periodsOverlap(period, { id: '', start: range.from, end: range.to, updatedAt: 0 }))
    },
    async upsertPeriod(input) {
      const period = validatePeriod({ ...input, id: input.id ?? crypto.randomUUID(), updatedAt: input.updatedAt ?? now() })
      const data = read()
      const others = data.periods.filter((p) => p.id !== period.id)
      if (others.some((p) => periodsOverlap(p, period))) throw new Error('Period overlaps another period')
      data.periods = [...others, period]
      write(data)
      return period
    },
    async deletePeriod(id) {
      const data = read()
      data.periods = data.periods.filter((period) => period.id !== id)
      write(data)
    },
    async getSettings() { return read().settings },
    async putSettings(input) {
      const data = read()
      data.settings = validateSettings({ ...data.settings, ...input, updatedAt: now() })
      write(data)
      return data.settings
    },
    async exportAll() {
      const data = read()
      data.days.sort((a, b) => a.date.localeCompare(b.date))
      sortedPeriods(data)
      return data
    },
    async importAll(raw, { mode }) {
      const incoming = validateExport(migratePayload(asVersionedPayload(raw), version, options.migrations ?? MIGRATIONS))
      if (mode === 'replace') { write(incoming); return }
      const data = read()
      for (const day of incoming.days) {
        const existing = data.days.find((d) => d.date === day.date)
        if (!existing || day.updatedAt > existing.updatedAt) data.days = [...data.days.filter((d) => d.date !== day.date), day]
      }
      for (const period of incoming.periods) {
        const existing = data.periods.find((p) => p.id === period.id)
        if (!existing || period.updatedAt > existing.updatedAt) data.periods = [...data.periods.filter((p) => p.id !== period.id), period]
      }
      if (incoming.settings.updatedAt > data.settings.updatedAt) data.settings = incoming.settings
      write(data)
    },
    async clearAll() { write({ schemaVersion: version, days: [], periods: [], settings: { ...DEFAULT_SETTINGS } }) },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    async close() {
      listeners.clear()
      if (typeof window !== 'undefined') window.removeEventListener('storage', storageChanged)
    },
  }
}
