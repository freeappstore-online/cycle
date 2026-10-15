// Runtime checks for records at the current schema version. Writes from the UI
// and imported payloads both go through these, so bad data fails loudly instead
// of landing in IndexedDB.

import {
  type CycleExport,
  DEFAULT_SETTINGS,
  type DayLog,
  FLOWS,
  type ISODate,
  MOODS,
  type Period,
  type Settings,
  SYMPTOMS,
} from './types'
import type { VersionedPayload } from './migrations'

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

export function isISODate(value: unknown): value is ISODate {
  if (typeof value !== 'string') return false
  const m = DATE_RE.exec(value)
  if (!m) return false
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3]
}

function fail(what: string, value: unknown): never {
  throw new Error(`Invalid ${what}: ${JSON.stringify(value)}`)
}

function isTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function isLength(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
}

export function validateDay(raw: unknown): DayLog {
  if (typeof raw !== 'object' || raw === null) fail('day log', raw)
  const r = raw as Record<string, unknown>
  if (!isISODate(r.date)) fail('day log date', r.date)
  if (r.flow !== undefined && !(FLOWS as readonly unknown[]).includes(r.flow)) fail('flow', r.flow)
  if (!Array.isArray(r.symptoms) || r.symptoms.some((s) => !(SYMPTOMS as readonly unknown[]).includes(s))) {
    fail('symptoms', r.symptoms)
  }
  if (r.mood !== undefined && !(MOODS as readonly unknown[]).includes(r.mood)) fail('mood', r.mood)
  if (r.note !== undefined && typeof r.note !== 'string') fail('note', r.note)
  if (!isTimestamp(r.updatedAt)) fail('updatedAt', r.updatedAt)
  const day: DayLog = { date: r.date, symptoms: [...new Set(r.symptoms as DayLog['symptoms'])], updatedAt: r.updatedAt }
  if (r.flow !== undefined) day.flow = r.flow as DayLog['flow']
  if (r.mood !== undefined) day.mood = r.mood as DayLog['mood']
  if (r.note !== undefined && r.note !== '') day.note = r.note as string
  return day
}

export function validatePeriod(raw: unknown): Period {
  if (typeof raw !== 'object' || raw === null) fail('period', raw)
  const r = raw as Record<string, unknown>
  if (typeof r.id !== 'string' || r.id === '') fail('period id', r.id)
  if (!isISODate(r.start)) fail('period start', r.start)
  if (r.end !== undefined && (!isISODate(r.end) || r.end < r.start)) fail('period end', r.end)
  if (!isTimestamp(r.updatedAt)) fail('updatedAt', r.updatedAt)
  const period: Period = { id: r.id, start: r.start, updatedAt: r.updatedAt }
  if (r.end !== undefined) period.end = r.end as ISODate
  return period
}

export function validateSettings(raw: unknown): Settings {
  if (raw === undefined || raw === null) return { ...DEFAULT_SETTINGS }
  if (typeof raw !== 'object') fail('settings', raw)
  const r = raw as Record<string, unknown>
  const s: Settings = {
    lutealLength: r.lutealLength ?? DEFAULT_SETTINGS.lutealLength,
    weekStart: r.weekStart ?? DEFAULT_SETTINGS.weekStart,
    updatedAt: r.updatedAt ?? 0,
  } as Settings
  if (!isLength(s.lutealLength, 7, 21)) fail('lutealLength', s.lutealLength)
  if (s.weekStart !== 0 && s.weekStart !== 1) fail('weekStart', s.weekStart)
  if (!isTimestamp(s.updatedAt)) fail('updatedAt', s.updatedAt)
  if (r.defaultCycleLength !== undefined) {
    if (!isLength(r.defaultCycleLength, 15, 90)) fail('defaultCycleLength', r.defaultCycleLength)
    s.defaultCycleLength = r.defaultCycleLength
  }
  if (r.defaultPeriodLength !== undefined) {
    if (!isLength(r.defaultPeriodLength, 1, 15)) fail('defaultPeriodLength', r.defaultPeriodLength)
    s.defaultPeriodLength = r.defaultPeriodLength
  }
  return s
}

/** Validates a payload that has already been migrated to the current schema. */
export function validateExport(data: VersionedPayload): CycleExport {
  return {
    schemaVersion: data.schemaVersion,
    days: data.days.map(validateDay),
    periods: data.periods.map(validatePeriod),
    settings: validateSettings(data.settings),
  }
}

/** True if two periods share at least one day. An ongoing period runs open-ended. */
export function periodsOverlap(a: Period, b: Period): boolean {
  return a.start <= (b.end ?? '9999-12-31') && b.start <= (a.end ?? '9999-12-31')
}
