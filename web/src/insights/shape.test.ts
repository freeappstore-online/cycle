import { describe, expect, it } from 'vitest'
import type { DayLog, Period, SymptomId } from '../data/types'
import { addDays } from '../predict'
import { binSymptomGrid, buildSymptomGrid, computeSummaryStats, cycleChartData, deriveCycleRows } from './shape'

const period = (start: string, end?: string): Period => ({ id: start, start, end, updatedAt: 0 })
/** Periods starting at `first` then after each of `lengths` days, each `bleed` days long. */
function history(first: string, lengths: number[], bleed = 5): Period[] {
  const starts = [first]
  for (const l of lengths) starts.push(addDays(starts.at(-1)!, l))
  return starts.map((s) => period(s, addDays(s, bleed - 1)))
}
const log = (date: string, symptoms: SymptomId[]): DayLog => ({ date, symptoms, updatedAt: 0 })

describe('deriveCycleRows', () => {
  it('is empty with 0 or 1 periods', () => {
    expect(deriveCycleRows([])).toEqual([])
    expect(deriveCycleRows([period('2026-01-01', '2026-01-05')])).toEqual([])
  })

  it('numbers complete cycles oldest first, with period length and outliers', () => {
    const rows = deriveCycleRows([...history('2026-01-01', [28, 10]), period('2026-03-10')].reverse())
    expect(rows).toEqual([
      { index: 1, start: '2026-01-01', end: '2026-01-28', length: 28, periodLength: 5, outlier: false },
      { index: 2, start: '2026-01-29', end: '2026-02-07', length: 10, periodLength: 5, outlier: true },
      { index: 3, start: '2026-02-08', end: '2026-03-09', length: 30, periodLength: 5, outlier: false },
    ])
  })
})

describe('computeSummaryStats', () => {
  it('is all null with no cycles, but still averages logged periods', () => {
    expect(computeSummaryStats([], [period('2026-01-01', '2026-01-04')])).toEqual({
      cycleCount: 0,
      excluded: 0,
      avgCycle: null,
      stdDev: null,
      shortest: null,
      longest: null,
      avgPeriod: 4,
    })
  })

  it('gives no variability for a single cycle', () => {
    const periods = history('2026-01-01', [29])
    expect(computeSummaryStats(deriveCycleRows(periods), periods)).toMatchObject({ cycleCount: 1, avgCycle: 29, stdDev: null })
  })

  it('averages, spreads and counts usable cycles, leaving outliers out', () => {
    const periods = history('2025-06-01', [26, 30, 120, 28, 10, 27], 5)
    periods[2].end = addDays(periods[2].start, 6) // a 7-day period
    const stats = computeSummaryStats(deriveCycleRows(periods), periods)
    expect(stats).toEqual({
      cycleCount: 4,
      excluded: 2,
      avgCycle: 27.8,
      stdDev: 1.7,
      shortest: 26,
      longest: 30,
      avgPeriod: 5.3,
    })
  })
})

describe('cycleChartData', () => {
  it('stacks period days under the rest of the cycle', () => {
    const periods = [...history('2026-01-01', [28, 30], 6), period('2026-04-01')]
    periods[1].end = undefined // period length not logged
    expect(cycleChartData(deriveCycleRows(periods)).bars).toEqual([
      { index: 1, start: '2026-01-01', length: 28, periodDays: 6, restDays: 22, outlier: false, periodUnknown: false },
      { index: 2, start: '2026-01-29', length: 30, periodDays: 0, restDays: 30, outlier: false, periodUnknown: true },
      { index: 3, start: '2026-02-28', length: 32, periodDays: 6, restDays: 26, outlier: false, periodUnknown: false },
    ])
  })

  it('keeps the latest cycles, shows short outliers and hides long ones', () => {
    const rows = deriveCycleRows(history('2024-01-01', [...Array(14).fill(28), 10, 120, 29]))
    const data = cycleChartData(rows, 12)
    expect(data.bars).toHaveLength(12)
    expect(data.bars.at(-1)).toMatchObject({ length: 29, outlier: false })
    expect(data.bars.at(-2)).toMatchObject({ length: 10, outlier: true })
    expect(data.hiddenLong).toBe(1)
    expect(data.hiddenOlder).toBe(rows.length - 1 - 12)
  })
})

describe('buildSymptomGrid', () => {
  // Three cycles: 28, 30 and 26 days.
  const periods = history('2026-01-01', [28, 30, 26])
  const starts = periods.map((p) => p.start)
  const days = [
    log(starts[0], ['cramps']),
    log(starts[1], ['cramps', 'headache']),
    log(starts[2], ['cramps']),
    log(addDays(starts[1], 1), ['cramps']),
    log(addDays(starts[1], 29), ['acne']), // day 30 of the 30-day cycle
    log(starts[3], ['nausea']), // the current, incomplete cycle: ignored
  ]
  const grid = buildSymptomGrid(periods, days)

  it('is empty with fewer than 2 periods', () => {
    expect(buildSymptomGrid(periods.slice(0, 1), days)).toEqual({ cycles: 0, maxDay: 0, rows: [] })
  })

  it('counts each symptom by cycle day, most frequent first', () => {
    expect(grid.cycles).toBe(3)
    expect(grid.maxDay).toBe(30)
    expect(grid.rows.map((r) => [r.symptom, r.total])).toEqual([
      ['cramps', 4],
      ['acne', 1],
      ['headache', 1],
    ])
    const cramps = grid.rows[0].cells
    expect(cramps[0]).toEqual({ day: 1, count: 3, cyclesReaching: 3, freq: 1 })
    expect(cramps[1]).toEqual({ day: 2, count: 1, cyclesReaching: 3, freq: 1 / 3 })
  })

  it('normalises late days by the cycles that reached them', () => {
    const acne = grid.rows.find((r) => r.symptom === 'acne')!.cells
    expect(acne[26]).toMatchObject({ day: 27, cyclesReaching: 2 })
    expect(acne[29]).toEqual({ day: 30, count: 1, cyclesReaching: 1, freq: 1 })
  })

  it('bins cycle days for the heatmap', () => {
    const binned = binSymptomGrid(grid, 5)
    expect(binned.columns.map((c) => c.label)).toEqual(['Days 1–5', 'Days 6–10', 'Days 11–15', 'Days 16–20', 'Days 21–25', 'Days 26–30'])
    const cramps = binned.rows[0]
    expect(cramps.cells[0]).toEqual({ count: 4, days: 15, freq: 4 / 15 })
    // Days 26–30: 3 + 2 + 2 + 1 + 1 cycles reached those days.
    expect(binned.rows[1].cells[5]).toEqual({ count: 1, days: 9, freq: 1 / 9 })
    expect(binSymptomGrid({ cycles: 1, maxDay: 11, rows: [] }, 5).columns.at(-1)?.label).toBe('Day 11')
  })
})
