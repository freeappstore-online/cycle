// Deterministic test data: a heavy user who logs every day. Shared by the size
// and sync tests.

import { SCHEMA_VERSION } from '../data/migrations'
import { type CycleExport, type DayLog, DEFAULT_SETTINGS, FLOWS, MOODS, type Period, SYMPTOMS } from '../data/types'

function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10)
const DAY = 86_400_000

/** A heavy user: logs every single day for `years` years, with symptoms, moods and frequent notes. */
export function heavyDataset(years: number): CycleExport {
  const rand = mulberry32(42)
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)]
  const start = Date.UTC(2020, 0, 1)
  const end = Date.UTC(2020 + years, 0, 1)
  const days: DayLog[] = []
  const periods: Period[] = []
  const periodDays = new Set<string>()

  for (let t = start; t < end; ) {
    const cycle = 25 + Math.floor(rand() * 8)
    const bleed = 4 + Math.floor(rand() * 3)
    periods.push({ id: crypto.randomUUID(), start: iso(t), end: iso(t + (bleed - 1) * DAY), updatedAt: t + DAY })
    for (let i = 0; i < bleed; i++) periodDays.add(iso(t + i * DAY))
    t += cycle * DAY
  }

  for (let t = start; t < end; t += DAY) {
    const date = iso(t)
    const day: DayLog = {
      date,
      symptoms: Array.from({ length: Math.floor(rand() * 4) }, () => pick(SYMPTOMS)).filter(
        (s, i, all) => all.indexOf(s) === i,
      ),
      mood: pick(MOODS),
      updatedAt: t + 3_600_000,
    }
    if (periodDays.has(date)) day.flow = pick(FLOWS)
    if (rand() < 0.3) day.note = 'Slept badly, took ibuprofen in the afternoon, felt better by evening.'
    days.push(day)
  }
  return { schemaVersion: SCHEMA_VERSION, days, periods, settings: { ...DEFAULT_SETTINGS, updatedAt: 1 } }
}
