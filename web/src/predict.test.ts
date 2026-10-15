import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Period } from './data/types'
import {
  addDays,
  addMonths,
  daysBetween,
  deriveCycles,
  predict,
  type PredictSettings,
  projectedPeriods,
} from './predict'

const SETTINGS: PredictSettings = { lutealLength: 14 }

/** Periods starting at `first`, then after each of `lengths` days, each `bleed` days long. */
function history(first: string, lengths: number[], bleed = 5): Period[] {
  const starts = [first]
  for (const l of lengths) starts.push(addDays(starts.at(-1)!, l))
  return starts.map((start, i) => ({ id: `p${i}`, start, end: addDays(start, bleed - 1), updatedAt: 0 }))
}

describe('date maths', () => {
  afterEach(() => vi.unstubAllEnvs())

  it.each(['America/New_York', 'Europe/London', 'Australia/Sydney'])('is exact across DST changes in %s', (tz) => {
    vi.stubEnv('TZ', tz)
    // Sanity check that the zone is really in effect and has a DST change this year.
    const offsets = new Set(Array.from({ length: 12 }, (_, m) => new Date(2026, m, 1).getTimezoneOffset()))
    expect(offsets.size).toBe(2)

    // US: 2026-03-08 / 2026-11-01. EU: 2026-03-29 / 2026-10-25. AU: 2026-04-05 / 2026-10-04.
    for (const [a, b] of [
      ['2026-03-07', '2026-03-09'],
      ['2026-03-28', '2026-03-30'],
      ['2026-10-24', '2026-10-26'],
      ['2026-10-31', '2026-11-02'],
      ['2026-04-04', '2026-04-06'],
      ['2026-10-03', '2026-10-05'],
    ]) {
      expect(daysBetween(a, b)).toBe(2)
      expect(addDays(a, 2)).toBe(b)
    }
    expect(daysBetween('2026-01-01', '2027-01-01')).toBe(365)

    // A regular history spanning both changes predicts exactly 28 days on.
    const p = predict(history('2026-02-15', [28, 28, 28, 28, 28, 28, 28, 28, 28]), SETTINGS, '2026-11-10')
    expect(p.nextPeriod?.start).toBe('2026-11-22')
    expect(p.averageCycleLength).toBe(28)
  })

  it('handles leap years', () => {
    expect(daysBetween('2028-02-28', '2028-03-01')).toBe(2)
    expect(daysBetween('2027-02-28', '2027-03-01')).toBe(1)
    expect(daysBetween('2028-01-01', '2029-01-01')).toBe(366)
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29')
    expect(addMonths('2027-01-31', 1)).toBe('2027-02-28')
    expect(addMonths('2026-11-15', 3)).toBe('2027-02-15')

    // A 28-day cycle from 2028-02-01 lands on the leap day.
    const periods = history('2027-11-09', [28, 28, 28])
    expect(periods.at(-1)!.start).toBe('2028-02-01')
    const p = predict(periods, SETTINGS, '2028-02-10')
    expect(p.nextPeriod?.start).toBe('2028-02-29')
    expect(p.nextPeriod?.end).toBe('2028-03-04')
    expect(deriveCycles(history('2028-02-01', [29]))[0]).toMatchObject({ end: '2028-02-29', length: 29 })
  })
})

describe('deriveCycles', () => {
  it('pairs consecutive starts, sorts input, and leaves out the open current cycle', () => {
    const periods = history('2026-01-01', [28, 30])
    const cycles = deriveCycles([periods[2], periods[0], periods[1]])
    expect(cycles).toEqual([
      { start: '2026-01-01', end: '2026-01-28', length: 28, periodLength: 5, outlier: false },
      { start: '2026-01-29', end: '2026-02-27', length: 30, periodLength: 5, outlier: false },
    ])
    expect(deriveCycles(periods.slice(0, 1))).toEqual([])
    expect(deriveCycles([])).toEqual([])
  })

  it('flags cycles outside 15–90 days as outliers but keeps them', () => {
    const cycles = deriveCycles(history('2026-01-01', [28, 10, 120, 28]))
    expect(cycles.map((c) => [c.length, c.outlier])).toEqual([
      [28, false],
      [10, true],
      [120, true],
      [28, false],
    ])
  })
})

describe('predict', () => {
  it('makes no prediction with no data', () => {
    expect(predict([], SETTINGS, '2026-06-01')).toEqual({
      nextPeriod: null,
      fertileWindow: null,
      ovulationEstimate: null,
      averageCycleLength: null,
      cycleLengthSD: null,
      basedOnCycles: 0,
      irregular: false,
      daysLate: 0,
      confidence: 'none',
    })
  })

  it('uses the onboarding cycle length with one period, flagged low confidence', () => {
    const one: Period[] = [{ id: 'a', start: '2026-06-01', updatedAt: 0 }]
    const p = predict(one, { ...SETTINGS, defaultCycleLength: 32, defaultPeriodLength: 4 }, '2026-06-03')
    expect(p).toMatchObject({
      nextPeriod: { start: '2026-07-03', end: '2026-07-06', rangeStart: '2026-06-28', rangeEnd: '2026-07-08' },
      ovulationEstimate: '2026-06-19',
      averageCycleLength: null,
      basedOnCycles: 0,
      confidence: 'low',
    })
    // Without an onboarding answer it falls back to 28 days, still low.
    expect(predict(one, SETTINGS, '2026-06-03')).toMatchObject({
      nextPeriod: { start: '2026-06-29' },
      confidence: 'low',
    })
  })

  it('predicts a regular 28-day cycle with medium confidence and a ±2 day range', () => {
    const periods = history('2026-01-01', [28, 28, 28, 28, 28, 28])
    const p = predict(periods, SETTINGS, '2026-06-20')
    expect(p).toEqual({
      nextPeriod: { start: '2026-07-16', end: '2026-07-20', rangeStart: '2026-07-14', rangeEnd: '2026-07-18' },
      ovulationEstimate: '2026-07-02',
      fertileWindow: { start: '2026-06-25', end: '2026-07-05' },
      averageCycleLength: 28,
      cycleLengthSD: 0,
      basedOnCycles: 6,
      irregular: false,
      daysLate: 0,
      confidence: 'medium',
    })
  })

  it('averages only the last 6 usable cycles', () => {
    const p = predict(history('2025-01-01', [40, 40, 28, 28, 28, 28, 28, 28]), SETTINGS, '2025-09-01')
    expect(p.averageCycleLength).toBe(28)
    expect(p.basedOnCycles).toBe(6)
  })

  it('handles short (21-day) cycles', () => {
    const p = predict(history('2026-01-01', [21, 21, 22]), SETTINGS, '2026-03-07')
    expect(p.averageCycleLength).toBe(21.3)
    expect(p.nextPeriod?.start).toBe('2026-03-27')
    expect(p.ovulationEstimate).toBe('2026-03-13')
    expect(p.confidence).toBe('medium')
  })

  it('handles long (35+ day) cycles', () => {
    const p = predict(history('2026-01-01', [36, 36, 37, 35]), SETTINGS, '2026-05-26')
    expect(p.averageCycleLength).toBe(36)
    expect(p.nextPeriod?.start).toBe('2026-06-30')
    expect(p.ovulationEstimate).toBe('2026-06-16')
    expect(p.confidence).toBe('medium')
  })

  it('widens the range and drops confidence for irregular cycles', () => {
    const p = predict(history('2026-01-01', [24, 38, 27, 35, 22]), SETTINGS, '2026-05-26')
    expect(p.irregular).toBe(true)
    expect(p.confidence).toBe('low')
    expect(p.averageCycleLength).toBe(29.2)
    expect(p.cycleLengthSD).toBe(7)
    const { start, rangeStart, rangeEnd } = p.nextPeriod!
    // ±1.5 SD (11 days), which also covers the shortest and longest cycles seen.
    expect(daysBetween(rangeStart, start)).toBe(11)
    expect(daysBetween(start, rangeEnd)).toBe(11)
    // The fertile window spans the whole range, not one confident day.
    expect(daysBetween(p.fertileWindow!.start, p.fertileWindow!.end)).toBe(22 + 6)
  })

  it('keeps confidence low with fewer than 3 cycles', () => {
    expect(predict(history('2026-01-01', [28]), SETTINGS, '2026-02-01').confidence).toBe('low')
    expect(predict(history('2026-01-01', [28, 28]), SETTINGS, '2026-03-01').confidence).toBe('low')
  })

  it('excludes outlier cycles from the average', () => {
    const periods = history('2025-01-01', [28, 28, 120, 28, 10, 28])
    const p = predict(periods, SETTINGS, addDays(periods.at(-1)!.start, 3))
    expect(p.averageCycleLength).toBe(28)
    expect(p.basedOnCycles).toBe(4)
    expect(p.irregular).toBe(false)
    expect(deriveCycles(periods).filter((c) => c.outlier)).toHaveLength(2)
  })

  it('falls back to the default when every cycle is an outlier', () => {
    const p = predict(history('2025-01-01', [150]), { ...SETTINGS, defaultCycleLength: 30 }, '2025-06-01')
    expect(p).toMatchObject({ basedOnCycles: 0, averageCycleLength: null, confidence: 'low' })
    expect(p.nextPeriod?.start).toBe('2025-06-30')
  })

  it('reports a late period while still within the range', () => {
    const periods = history('2026-01-01', [28, 28, 28, 28, 28, 28])
    // Most likely start 2026-07-16, latest plausible 2026-07-18.
    const p = predict(periods, SETTINGS, '2026-07-18')
    expect(p.nextPeriod?.start).toBe('2026-07-16')
    expect(p.daysLate).toBe(2)
  })

  it('moves on a cycle after a missed log (90+ days with nothing new)', () => {
    const periods = history('2025-07-17', [28, 28, 28, 28, 28, 28])
    expect(periods.at(-1)!.start).toBe('2026-01-01')
    const p = predict(periods, SETTINGS, '2026-04-15')
    // Jan 29, Feb 26 and Mar 26 have all passed; the next plausible one is Apr 23 (±4).
    expect(p.nextPeriod).toMatchObject({ start: '2026-04-23', rangeStart: '2026-04-19', rangeEnd: '2026-04-27' })
    expect(p.daysLate).toBe(0)
    expect(p.averageCycleLength).toBe(28)
  })

  it('predicts from the start of an ongoing period', () => {
    const periods = history('2026-01-01', [28, 28, 28])
    const ongoing = { ...periods.at(-1)!, end: undefined }
    const p = predict([...periods.slice(0, -1), ongoing], SETTINGS, addDays(ongoing.start, 1))
    expect(p.nextPeriod?.start).toBe(addDays(ongoing.start, 28))
  })

  it('uses the logged period length, and the luteal length setting', () => {
    const p = predict(history('2026-01-01', [28, 28, 28], 7), { lutealLength: 12 }, '2026-03-30')
    expect(p.nextPeriod).toMatchObject({ start: '2026-04-23', end: '2026-04-29' })
    expect(p.ovulationEstimate).toBe('2026-04-11')
  })

  it('never exposes contraception-style "safe" output', () => {
    const p = predict(history('2026-01-01', [28, 28, 28]), SETTINGS, '2026-03-30')
    expect(JSON.stringify(p)).not.toMatch(/safe|infertile|contracept/i)
  })
})

describe('projectedPeriods', () => {
  it('returns the predicted periods in the next N months with growing ranges', () => {
    const periods = history('2026-01-01', [28, 28, 28, 28, 28, 28])
    const projected = projectedPeriods(periods, SETTINGS, '2026-06-20', 3)
    expect(projected.map((p) => p.start)).toEqual(['2026-07-16', '2026-08-13', '2026-09-10'])
    const widths = projected.map((p) => daysBetween(p.rangeStart, p.rangeEnd))
    expect(widths).toEqual([4, 6, 8])
    expect(projected[0]).toEqual(predict(periods, SETTINGS, '2026-06-20').nextPeriod)
  })

  it('is empty with no data, and starts after a missed log', () => {
    expect(projectedPeriods([], SETTINGS, '2026-06-20', 6)).toEqual([])
    const periods = history('2025-07-17', [28, 28, 28, 28, 28, 28])
    expect(projectedPeriods(periods, SETTINGS, '2026-04-15', 2).map((p) => p.start)).toEqual([
      '2026-04-23',
      '2026-05-21',
    ])
  })
})
