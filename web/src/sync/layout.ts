// How synced data is laid out in fas.kv, within its limits (docs/LIMITS.md:
// 64 KB per value, 100 keys and 1 MB per user per app, keys ≤ 128 chars).
//
//   cycle:meta         plaintext KDF params + key check, the encrypted head
//                      ({ schemaVersion, settings }) and how many parts each year has
//   cycle:y2026        encrypted { days, periods } for 2026 (part 0)
//   cycle:y2026:1 …    further parts, only if a year's ciphertext is over PART_CHARS
//
// A year is gzipped and encrypted as one envelope, then the base64 string is
// split into parts, so GCM authenticates the whole year at once.

import type { CycleExport, DayLog, Period } from '../data/types'
import type { KdfParams } from './crypto'

export const KEY_PREFIX = 'cycle:'
export const META_KEY = 'cycle:meta'
/** Characters of base64 per KV value. Stored as a JSON string, so +2 quote bytes, well under 64 KiB. */
export const PART_CHARS = 60_000
export const KV_VALUE_LIMIT = 64 * 1024
/** Stay clear of the 100-key and 1 MB per-user limits. */
export const KEY_BUDGET = 90
export const BYTE_BUDGET = 900 * 1024

export interface RemoteMeta extends KdfParams {
  /** Encrypted known constant; a wrong passphrase fails to decrypt it. */
  check: string
  /** Encrypted { schemaVersion, settings }. */
  head: string
  /** Parts per year, e.g. { "2026": 1 }. */
  years: Record<string, number>
}

export interface Head {
  schemaVersion: number
  settings: CycleExport['settings']
}

export interface YearPayload {
  days: DayLog[]
  periods: Period[]
}

export class SyncLimitError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SyncLimitError'
  }
}

export function yearKey(year: string, part = 0): string {
  return part === 0 ? `${KEY_PREFIX}y${year}` : `${KEY_PREFIX}y${year}:${part}`
}

/** The GCM label a year is encrypted under (independent of how it's split). */
export const yearLabel = (year: string) => `${KEY_PREFIX}y${year}`

/** All KV keys for a meta's years. */
export function yearKeys(years: Record<string, number>): string[] {
  return Object.entries(years).flatMap(([year, parts]) => Array.from({ length: parts }, (_, i) => yearKey(year, i)))
}

/** Days by date year, periods by start year. Days and periods keep their sorted order. */
export function splitByYear(data: Pick<CycleExport, 'days' | 'periods'>): Map<string, YearPayload> {
  const years = new Map<string, YearPayload>()
  const bucket = (year: string) => {
    let y = years.get(year)
    if (!y) years.set(year, (y = { days: [], periods: [] }))
    return y
  }
  for (const d of data.days) bucket(d.date.slice(0, 4)).days.push(d)
  for (const p of data.periods) bucket(p.start.slice(0, 4)).periods.push(p)
  return new Map([...years].sort(([a], [b]) => (a < b ? -1 : 1)))
}

export function chunk(envelope: string, size = PART_CHARS): string[] {
  const parts: string[] = []
  for (let i = 0; i < envelope.length; i += size) parts.push(envelope.slice(i, i + size))
  return parts.length ? parts : ['']
}

export const valueBytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length

/** Throws SyncLimitError if the full set of values would exceed a fas.kv limit. */
export function checkBudget(values: ReadonlyMap<string, unknown>): void {
  if (values.size > KEY_BUDGET) {
    throw new SyncLimitError(
      `Your synced data would need ${values.size} storage keys (limit ${KEY_BUDGET}). Sync is paused; everything is still saved on this device.`,
    )
  }
  let total = 0
  for (const [key, value] of values) {
    const size = valueBytes(value)
    if (size > KV_VALUE_LIMIT) throw new SyncLimitError(`${key} is ${size} bytes, over the 64 KB value limit.`)
    total += size
  }
  if (total > BYTE_BUDGET) {
    throw new SyncLimitError(
      `Your encrypted data is ${Math.round(total / 1024)} KB, close to the 1 MB cloud limit. Sync is paused; everything is still saved on this device.`,
    )
  }
}
