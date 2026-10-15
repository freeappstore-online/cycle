// Which "period started / ended" actions make sense for a given day, and what
// they write. Pure functions over the logged periods.

import type { ISODate, Period } from './data/types'
import type { PeriodInput } from './data/repository'
import { FALLBACK_PERIOD_LENGTH, addDays, daysBetween } from './predict'

/** A closed period that ended at most this many days before a day can still be extended to it. */
const EXTEND_WITHIN_DAYS = 7

/** Last day a period covers: its end, or today while it's ongoing. */
export function periodLastDay(period: Period, today: ISODate): ISODate {
  return period.end ?? (today > period.start ? today : period.start)
}

/** The logged period that includes `date`, if any. */
export function periodOn(periods: readonly Period[], date: ISODate, today: ISODate): Period | undefined {
  return periods.find((p) => p.start <= date && date <= periodLastDay(p, today))
}

export interface DayPeriodActions {
  /** The period this day is part of. */
  current?: Period
  /** "Period started" is offered. */
  canStart: boolean
  /** "Period ended" would set this period's end to the day (ending, shortening or extending it). */
  endTarget?: Period
}

export function periodActionsFor(periods: readonly Period[], date: ISODate, today: ISODate): DayPeriodActions {
  if (date > today) return { canStart: false }
  const current = periodOn(periods, date, today)
  if (current) return { current, canStart: false, endTarget: current.end === date ? undefined : current }
  const before = periods.filter((p) => p.start < date).sort((a, b) => (a.start < b.start ? 1 : -1))[0]
  const extendable = before?.end && daysBetween(before.end, date) <= EXTEND_WITHIN_DAYS ? before : undefined
  return { canStart: true, endTarget: extendable }
}

/**
 * The period to create when one starts on `date`. It stays open (ongoing) if it
 * could still be going on today; otherwise it gets the usual length, cut short
 * before the next logged period so the two don't overlap.
 */
export function newPeriodFrom(
  periods: readonly Period[],
  date: ISODate,
  today: ISODate,
  periodLength = FALLBACK_PERIOD_LENGTH,
): PeriodInput {
  const next = periods.filter((p) => p.start > date).sort((a, b) => (a.start < b.start ? -1 : 1))[0]
  let end: ISODate | undefined = addDays(date, periodLength - 1)
  if (!next && end >= today) end = undefined
  if (next && end && end >= next.start) end = addDays(next.start, -1)
  return end ? { start: date, end } : { start: date }
}

/** 1-based day of the period, or of the cycle since the latest period started on or before `date`. */
export function cycleDay(periods: readonly Period[], date: ISODate): number | undefined {
  const latest = periods.filter((p) => p.start <= date).sort((a, b) => (a.start < b.start ? 1 : -1))[0]
  return latest ? daysBetween(latest.start, date) + 1 : undefined
}
