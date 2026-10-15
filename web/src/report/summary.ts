// The numbers behind the doctor PDF. Pure: built from exported data and a date range.

import type { CycleExport, ISODate, SymptomId } from '../data/types'
import { SYMPTOM_LABELS } from '../labels'
import { daysBetween, deriveCycles } from '../predict'

export interface SummaryPeriod {
  start: ISODate
  end?: ISODate
  /** Days, inclusive. Missing while ongoing. */
  length?: number
}

export interface Range3 {
  average: number
  shortest: number
  longest: number
}

export interface DoctorSummary {
  from: ISODate
  to: ISODate
  generatedOn: ISODate
  periods: SummaryPeriod[]
  /** Complete cycles starting in the range. */
  cycles: { start: ISODate; length: number; outlier: boolean }[]
  /** Over non-outlier cycles (15–90 days). */
  cycleStats: (Range3 & { count: number }) | null
  periodStats: Range3 | null
  /** Days in the range with anything logged. */
  loggedDays: number
  symptoms: { id: SymptomId; label: string; days: number; percent: number }[]
  notes: { date: ISODate; note: string }[]
}

const round1 = (x: number) => Math.round(x * 10) / 10

function stats(xs: number[]): Range3 | null {
  if (xs.length === 0) return null
  return { average: round1(xs.reduce((a, b) => a + b, 0) / xs.length), shortest: Math.min(...xs), longest: Math.max(...xs) }
}

export function buildSummary(
  data: Pick<CycleExport, 'days' | 'periods'>,
  { from, to, includeNotes, generatedOn }: { from: ISODate; to: ISODate; includeNotes: boolean; generatedOn: ISODate },
): DoctorSummary {
  const periods = [...data.periods]
    .filter((p) => p.start <= to && (p.end ?? generatedOn) >= from)
    .sort((a, b) => (a.start < b.start ? -1 : 1))
    .map((p): SummaryPeriod => (p.end ? { start: p.start, end: p.end, length: daysBetween(p.start, p.end) + 1 } : { start: p.start }))

  const cycles = deriveCycles(data.periods)
    .filter((c) => c.start >= from && c.start <= to)
    .map((c) => ({ start: c.start, length: c.length, outlier: c.outlier }))
  const usable = cycles.filter((c) => !c.outlier).map((c) => c.length)
  const cycleStats = stats(usable)

  const days = data.days.filter((d) => d.date >= from && d.date <= to)
  const counts = new Map<SymptomId, number>()
  for (const d of days) for (const s of d.symptoms) counts.set(s, (counts.get(s) ?? 0) + 1)
  const symptoms = [...counts]
    .map(([id, n]) => ({ id, label: SYMPTOM_LABELS[id], days: n, percent: days.length ? Math.round((n / days.length) * 100) : 0 }))
    .sort((a, b) => b.days - a.days || a.label.localeCompare(b.label))

  return {
    from,
    to,
    generatedOn,
    periods,
    cycles,
    cycleStats: cycleStats && { ...cycleStats, count: usable.length },
    periodStats: stats(periods.flatMap((p) => (p.length ? [p.length] : []))),
    loggedDays: days.length,
    symptoms,
    notes: includeNotes ? days.flatMap((d) => (d.note ? [{ date: d.date, note: d.note }] : [])) : [],
  }
}
