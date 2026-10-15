// Data shaping for the Insights screen. Pure functions over logged periods and
// day logs; the charts and tables only render what these return.

import type { DayLog, ISODate, Period, SymptomId } from '../data/types'
import { SYMPTOM_LABELS } from '../labels'
import { addDays, daysBetween, deriveCycles } from '../predict'

export interface CycleRow {
  /** 1-based, oldest first. */
  index: number
  start: ISODate
  end: ISODate
  length: number
  /** Logged bleeding days, if the period that starts the cycle has an end. */
  periodLength?: number
  /** Outside 15–90 days (e.g. a missed log). Left out of averages. */
  outlier: boolean
}

export function deriveCycleRows(periods: readonly Period[]): CycleRow[] {
  return deriveCycles(periods).map((c, i) => ({
    index: i + 1,
    start: c.start,
    end: c.end,
    length: c.length,
    ...(c.periodLength !== undefined && { periodLength: c.periodLength }),
    outlier: c.outlier,
  }))
}

export interface SummaryStats {
  /** Complete cycles used for the stats (outliers left out). */
  cycleCount: number
  /** Complete cycles left out as outliers. */
  excluded: number
  avgCycle: number | null
  /** Sample standard deviation of cycle length; null with fewer than 2 cycles. */
  stdDev: number | null
  shortest: number | null
  longest: number | null
  /** Over every logged period with an end, including the latest one. */
  avgPeriod: number | null
}

const round1 = (x: number) => Math.round(x * 10) / 10
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length

export function computeSummaryStats(rows: readonly CycleRow[], periods: readonly Period[] = []): SummaryStats {
  const lengths = rows.filter((r) => !r.outlier).map((r) => r.length)
  const periodLengths = periods.flatMap((p) => (p.end ? [daysBetween(p.start, p.end) + 1] : []))
  const avg = lengths.length ? mean(lengths) : null
  return {
    cycleCount: lengths.length,
    excluded: rows.length - lengths.length,
    avgCycle: avg === null ? null : round1(avg),
    stdDev:
      lengths.length >= 2 ? round1(Math.sqrt(lengths.reduce((s, x) => s + (x - avg!) ** 2, 0) / (lengths.length - 1))) : null,
    shortest: lengths.length ? Math.min(...lengths) : null,
    longest: lengths.length ? Math.max(...lengths) : null,
    avgPeriod: periodLengths.length ? round1(mean(periodLengths)) : null,
  }
}

/** One bar per cycle for the chart: period days stacked under the rest of the cycle. */
export interface CycleBar {
  index: number
  start: ISODate
  length: number
  periodDays: number
  restDays: number
  outlier: boolean
  /** Period length wasn't logged (no end date). */
  periodUnknown: boolean
}

export interface CycleChartData {
  bars: CycleBar[]
  /** Long outliers (> 90 days) left off the chart so they don't flatten the rest. */
  hiddenLong: number
  /** Older cycles beyond `limit`, still in the table. */
  hiddenOlder: number
}

/** The most recent `limit` cycles for the chart, oldest first. */
export function cycleChartData(rows: readonly CycleRow[], limit = 12): CycleChartData {
  const shown = rows.filter((r) => !(r.outlier && r.length > 90))
  const recent = shown.slice(-limit)
  return {
    bars: recent.map((r) => {
      const periodDays = Math.min(r.periodLength ?? 0, r.length)
      return {
        index: r.index,
        start: r.start,
        length: r.length,
        periodDays,
        restDays: r.length - periodDays,
        outlier: r.outlier,
        periodUnknown: r.periodLength === undefined,
      }
    }),
    hiddenLong: rows.length - shown.length,
    hiddenOlder: shown.length - recent.length,
  }
}

export interface SymptomCell {
  /** 1-based cycle day. */
  day: number
  /** Cycles in which the symptom was logged on this cycle day. */
  count: number
  /** Cycles long enough to have this day. */
  cyclesReaching: number
  /** count / cyclesReaching, 0–1. */
  freq: number
}

export interface SymptomGrid {
  /** Complete, non-outlier cycles the grid is built from. */
  cycles: number
  maxDay: number
  /** Symptoms logged at least once, most frequent first. */
  rows: { symptom: SymptomId; label: string; total: number; cells: SymptomCell[] }[]
}

/**
 * Symptom × cycle-day frequencies. Only complete, non-outlier cycles count,
 * and each day is normalised by how many of those cycles reached it, so a
 * long cycle's day 34 isn't compared against cycles that never got there.
 */
export function buildSymptomGrid(periods: readonly Period[], days: readonly DayLog[]): SymptomGrid {
  const cycles = deriveCycles(periods).filter((c) => !c.outlier)
  const maxDay = cycles.reduce((m, c) => Math.max(m, c.length), 0)
  const reaching = Array.from({ length: maxDay + 1 }, (_, d) => cycles.filter((c) => c.length >= d).length)
  const byDate = new Map(days.map((d) => [d.date, d]))
  const counts = new Map<SymptomId, number[]>()

  for (const c of cycles) {
    for (let d = 1; d <= c.length; d++) {
      const log = byDate.get(addDays(c.start, d - 1))
      for (const s of log?.symptoms ?? []) {
        let row = counts.get(s)
        if (!row) counts.set(s, (row = new Array(maxDay + 1).fill(0)))
        row[d]++
      }
    }
  }

  const rows = [...counts]
    .map(([symptom, row]) => ({
      symptom,
      label: SYMPTOM_LABELS[symptom],
      total: row.reduce((a, b) => a + b, 0),
      cells: Array.from({ length: maxDay }, (_, i) => {
        const day = i + 1
        return { day, count: row[day], cyclesReaching: reaching[day], freq: reaching[day] ? row[day] / reaching[day] : 0 }
      }),
    }))
    .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label))
  return { cycles: cycles.length, maxDay, rows }
}

export interface BinnedGrid {
  columns: { from: number; to: number; label: string }[]
  rows: { symptom: SymptomId; label: string; cells: { count: number; days: number; freq: number }[] }[]
}

/**
 * Groups cycle days into bins (days 1–5, 6–10, …) so the heatmap fits a phone.
 * A cell's freq is symptom days ÷ cycle days observed in that bin.
 */
export function binSymptomGrid(grid: SymptomGrid, size = 5): BinnedGrid {
  const columns: BinnedGrid['columns'] = []
  for (let from = 1; from <= grid.maxDay; from += size) {
    const to = Math.min(from + size - 1, grid.maxDay)
    columns.push({ from, to, label: from === to ? `Day ${from}` : `Days ${from}–${to}` })
  }
  return {
    columns,
    rows: grid.rows.map((r) => ({
      symptom: r.symptom,
      label: r.label,
      cells: columns.map(({ from, to }) => {
        const slice = r.cells.slice(from - 1, to)
        const count = slice.reduce((a, c) => a + c.count, 0)
        const days = slice.reduce((a, c) => a + c.cyclesReaching, 0)
        return { count, days, freq: days ? count / days : 0 }
      }),
    })),
  }
}
