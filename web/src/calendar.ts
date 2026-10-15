// The month model behind the Calendar screen: which markers each day gets.
// Pure, so it's tested without rendering.

import type { DayLog, ISODate, Period, WeekStart } from './data/types'
import { type PredictedPeriod, addDays, addMonths, fertileWindowFor, toDayNumber } from './predict'
import { periodLastDay } from './periods'

/** `YYYY-MM`. */
export type Month = string

export const monthOf = (date: ISODate): Month => date.slice(0, 7)
export const shiftMonth = (month: Month, by: number): Month => addMonths(`${month}-01`, by).slice(0, 7)

/** Whole months from `a` to `b` (both `YYYY-MM`). */
export function monthsBetween(a: Month, b: Month): number {
  const [ay, am] = a.split('-').map(Number)
  const [by, bm] = b.split('-').map(Number)
  return (by - ay) * 12 + (bm - am)
}

export interface DayCell {
  date: ISODate
  day: number
  isToday: boolean
  isFuture: boolean
  /** Inside a logged period. */
  period: boolean
  /** Inside an estimated period (today or later, not already logged). */
  predicted: boolean
  /** Inside an estimated fertile window (today or later). */
  fertile: boolean
  log?: DayLog
}

export interface MonthModel {
  /** Empty leading cells before day 1, honouring the week start. */
  leading: number
  days: DayCell[]
}

export interface MonthInput {
  month: Month
  weekStart: WeekStart
  today: ISODate
  periods: readonly Period[]
  /** Day logs; only this month's are used. */
  days: readonly DayLog[]
  projected: readonly PredictedPeriod[]
  lutealLength: number
}

export function buildMonth({ month, weekStart, today, periods, days, projected, lutealLength }: MonthInput): MonthModel {
  const first = `${month}-01`
  const count = toDayNumber(`${shiftMonth(month, 1)}-01`) - toDayNumber(first)
  // 1970-01-01 was a Thursday (weekday 4).
  const weekday = (toDayNumber(first) + 4) % 7
  const leading = (weekday - weekStart + 7) % 7
  const logs = new Map(days.map((d) => [d.date, d]))
  const fertile = projected.map((p) => fertileWindowFor(p, lutealLength))

  const cells: DayCell[] = []
  for (let i = 0; i < count; i++) {
    const date = addDays(first, i)
    const period = periods.some((p) => p.start <= date && date <= periodLastDay(p, today))
    const upcoming = date >= today && !period
    const predicted = upcoming && projected.some((p) => p.start <= date && date <= p.end)
    cells.push({
      date,
      day: i + 1,
      isToday: date === today,
      isFuture: date > today,
      period,
      predicted,
      fertile: upcoming && !predicted && fertile.some((w) => w.start <= date && date <= w.end),
      log: logs.get(date),
    })
  }
  return { leading, days: cells }
}
