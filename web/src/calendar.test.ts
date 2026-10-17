import { describe, expect, it } from 'vitest'
import { buildMonth, monthOf, monthsBetween, shiftMonth } from './calendar'
import type { Period } from './data/types'
import { projectedPeriods } from './predict'
import { cycleDay, newPeriodFrom, periodActionsFor, periodOn } from './periods'

const period = (id: string, start: string, end?: string): Period => ({ id, start, end, updatedAt: 0 })

describe('month helpers', () => {
  it('shifts and compares months across years', () => {
    expect(monthOf('2026-10-15')).toBe('2026-10')
    expect(shiftMonth('2026-12', 1)).toBe('2027-01')
    expect(shiftMonth('2026-01', -1)).toBe('2025-12')
    expect(monthsBetween('2026-10', '2027-02')).toBe(4)
  })
})

describe('buildMonth', () => {
  const base = { today: '2026-10-15', periods: [], days: [], projected: [], lutealLength: 14 }

  it('honours the week start', () => {
    // 2026-10-01 is a Thursday.
    expect(buildMonth({ ...base, month: '2026-10', weekStart: 1 }).leading).toBe(3)
    expect(buildMonth({ ...base, month: '2026-10', weekStart: 0 }).leading).toBe(4)
    // 2026-02-01 is a Sunday.
    expect(buildMonth({ ...base, month: '2026-02', weekStart: 0 }).leading).toBe(0)
    expect(buildMonth({ ...base, month: '2026-02', weekStart: 1 }).leading).toBe(6)
  })

  it('has one cell per day, including leap days', () => {
    expect(buildMonth({ ...base, month: '2026-02', weekStart: 1 }).days).toHaveLength(28)
    expect(buildMonth({ ...base, month: '2028-02', weekStart: 1 }).days).toHaveLength(29)
    expect(buildMonth({ ...base, month: '2026-10', weekStart: 1 }).days.at(-1)?.date).toBe('2026-10-31')
  })

  it('marks logged, ongoing, estimated and fertile days', () => {
    const periods = [period('a', '2026-08-20', '2026-08-24'), period('b', '2026-09-17', '2026-09-21'), period('c', '2026-10-13')]
    const settings = { lutealLength: 14 }
    const projected = projectedPeriods(periods, settings, '2026-10-15', 2)
    const month = buildMonth({
      ...base,
      month: '2026-10',
      weekStart: 1,
      periods,
      projected,
      days: [{ date: '2026-10-14', symptoms: ['cramps'], note: 'x', updatedAt: 0 }],
    })
    const at = (d: number) => month.days[d - 1]
    // Ongoing period: logged through today, not beyond.
    expect([12, 13, 14, 15, 16].map((d) => at(d).period)).toEqual([false, true, true, true, false])
    expect(at(15).isToday).toBe(true)
    expect(at(14).log?.note).toBe('x')
    // Cycles of 28 and 26 days → next estimated start 2026-11-09; its fertile window falls in late October.
    expect(projected[0].start).toBe('2026-11-09')
    expect(month.days.filter((d) => d.predicted)).toEqual([])
    const fertile = month.days.filter((d) => d.fertile).map((d) => d.day)
    // Range Nov 7–11, so the window is (Nov 7 − 14 − 5) … (Nov 11 − 14 + 1).
    expect([fertile[0], fertile.at(-1)]).toEqual([19, 29])
    expect(month.days.filter((d) => d.ovulation).map((d) => d.date)).toEqual(['2026-10-26'])
    // Nothing estimated in the past.
    expect(month.days.slice(0, 15).some((d) => d.predicted || d.fertile)).toBe(false)

    const nov = buildMonth({ ...base, month: '2026-11', weekStart: 1, periods, projected })
    expect(nov.days.filter((d) => d.predicted).map((d) => d.day)).toEqual([9, 10, 11, 12, 13])
  })
})

describe('period actions', () => {
  const periods = [period('a', '2026-09-01', '2026-09-05'), period('b', '2026-10-13')]
  const today = '2026-10-15'

  it('finds the period covering a day, ongoing up to today', () => {
    expect(periodOn(periods, '2026-09-03', today)?.id).toBe('a')
    expect(periodOn(periods, '2026-10-15', today)?.id).toBe('b')
    expect(periodOn(periods, '2026-10-16', today)).toBeUndefined()
    expect(cycleDay(periods, today)).toBe(3)
    expect(cycleDay([], today)).toBeUndefined()
  })

  it('offers start, end, or extend as fits the day', () => {
    expect(periodActionsFor(periods, '2026-10-14', today)).toMatchObject({ canStart: false, endTarget: { id: 'b' } })
    expect(periodActionsFor(periods, '2026-09-05', today)).toMatchObject({ canStart: false, endTarget: undefined })
    // Two days after a closed period: can start a new one or extend the last.
    expect(periodActionsFor(periods, '2026-09-07', today)).toMatchObject({ canStart: true, endTarget: { id: 'a' } })
    expect(periodActionsFor(periods, '2026-09-25', today)).toMatchObject({ canStart: true, endTarget: undefined })
    expect(periodActionsFor(periods, '2026-10-20', today)).toEqual({ canStart: false })
  })

  it('creates an ongoing period when it could still be going on, a closed one otherwise', () => {
    expect(newPeriodFrom([], today, today)).toEqual({ start: today })
    expect(newPeriodFrom([], '2026-10-12', today)).toEqual({ start: '2026-10-12' })
    expect(newPeriodFrom([], '2026-08-01', today, 4)).toEqual({ start: '2026-08-01', end: '2026-08-04' })
    // Cut short before the next logged period.
    expect(newPeriodFrom(periods, '2026-08-29', today)).toEqual({ start: '2026-08-29', end: '2026-08-31' })
  })
})
