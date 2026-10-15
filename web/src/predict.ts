// Cycle prediction: pure functions over logged periods. No UI, no IndexedDB.
//
// Everything here is an estimate from past cycles. It is not a contraceptive
// method and must never be presented as one: there is deliberately no "safe
// days" output, and the fertile window is widened by the user's own cycle
// variability rather than narrowed to a confident date.
//
// Dates are `YYYY-MM-DD` strings. All maths is done on whole UTC day numbers,
// so local timezone and DST changes can't shift a date by one.

import type { ISODate, Period, Settings } from './data/types'

/** Cycles outside this many days are kept in history but left out of averages. */
export const MIN_CYCLE_LENGTH = 15
export const MAX_CYCLE_LENGTH = 90
/** How many recent usable cycles the average uses. */
export const AVERAGE_WINDOW = 6
/** Used when there's no history and onboarding didn't ask (#143). */
export const FALLBACK_CYCLE_LENGTH = 28
export const FALLBACK_PERIOD_LENGTH = 5
/** A spread (longest − shortest cycle) above this many days counts as irregular. */
export const IRREGULAR_SPREAD = 8

export interface Cycle {
  /** First day of the period that starts the cycle. */
  start: ISODate
  /** Day before the next period starts. */
  end: ISODate
  length: number
  /** Logged bleeding days, if the period has an end. */
  periodLength?: number
  /** Outside MIN/MAX_CYCLE_LENGTH (e.g. a missed log). Excluded from averages. */
  outlier: boolean
}

export interface PredictedPeriod {
  /** Most likely first day. */
  start: ISODate
  /** Most likely last day. */
  end: ISODate
  /** Earliest plausible first day. */
  rangeStart: ISODate
  /** Latest plausible first day. */
  rangeEnd: ISODate
}

export type Confidence = 'none' | 'low' | 'medium'

export interface Prediction {
  nextPeriod: PredictedPeriod | null
  fertileWindow: { start: ISODate; end: ISODate } | null
  ovulationEstimate: ISODate | null
  /** Mean of the cycles used; null when based on a default rather than history. */
  averageCycleLength: number | null
  /** Standard deviation of the cycles used; null with fewer than 2. */
  cycleLengthSD: number | null
  basedOnCycles: number
  /** High variability between the cycles used (spread > IRREGULAR_SPREAD days). */
  irregular: boolean
  /** Days past the most likely start with no new period logged. 0 if not late. */
  daysLate: number
  confidence: Confidence
}

export type PredictSettings = Pick<Settings, 'lutealLength'> &
  Partial<Pick<Settings, 'defaultCycleLength' | 'defaultPeriodLength'>>

// --- Date maths ------------------------------------------------------------

const MS_PER_DAY = 86_400_000

/** Days since 1970-01-01 for a `YYYY-MM-DD` date. */
export function toDayNumber(date: ISODate): number {
  const [y, m, d] = date.split('-').map(Number)
  return Date.UTC(y, m - 1, d) / MS_PER_DAY
}

export function fromDayNumber(day: number): ISODate {
  return new Date(day * MS_PER_DAY).toISOString().slice(0, 10)
}

export function addDays(date: ISODate, days: number): ISODate {
  return fromDayNumber(toDayNumber(date) + days)
}

/** b − a in whole days. */
export function daysBetween(a: ISODate, b: ISODate): number {
  return toDayNumber(b) - toDayNumber(a)
}

/** Same day of month `months` later, clamped to the month's last day (Jan 31 + 1 → Feb 28/29). */
export function addMonths(date: ISODate, months: number): ISODate {
  const [y, m, d] = date.split('-').map(Number)
  const first = new Date(Date.UTC(y, m - 1 + months, 1))
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate()
  first.setUTCDate(Math.min(d, lastDay))
  return first.toISOString().slice(0, 10)
}

// --- Cycles -----------------------------------------------------------------

/**
 * One cycle per pair of consecutive periods (start → next start). The open
 * current cycle (after the latest period) isn't complete, so it's left out.
 */
export function deriveCycles(periods: readonly Period[]): Cycle[] {
  const sorted = [...periods].sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0))
  const cycles: Cycle[] = []
  for (let i = 0; i + 1 < sorted.length; i++) {
    const cur = sorted[i]
    const length = daysBetween(cur.start, sorted[i + 1].start)
    const cycle: Cycle = {
      start: cur.start,
      end: addDays(sorted[i + 1].start, -1),
      length,
      outlier: length < MIN_CYCLE_LENGTH || length > MAX_CYCLE_LENGTH,
    }
    if (cur.end) cycle.periodLength = daysBetween(cur.start, cur.end) + 1
    cycles.push(cycle)
  }
  return cycles
}

function mean(xs: readonly number[]): number {
  return xs.reduce((s, x) => s + x, 0) / xs.length
}

/** Sample standard deviation. */
function sd(xs: readonly number[]): number {
  const m = mean(xs)
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1))
}

const round1 = (x: number) => Math.round(x * 10) / 10

interface Model {
  lastStart: ISODate
  cycleLength: number
  periodLength: number
  /** Days the start may plausibly fall before / after the most likely day, for one cycle ahead. */
  below: number
  above: number
  basedOn: number
  average: number | null
  sd: number | null
  irregular: boolean
  confidence: Confidence
}

function buildModel(periods: readonly Period[], settings: PredictSettings): Model | null {
  if (periods.length === 0) return null
  const cycles = deriveCycles(periods)
  const used = cycles.filter((c) => !c.outlier).slice(-AVERAGE_WINDOW)
  const lengths = used.map((c) => c.length)
  const lastStart = periods.reduce((latest, p) => (p.start > latest ? p.start : latest), periods[0].start)

  const logged = [...periods]
    .filter((p) => p.end)
    .sort((a, b) => (a.start < b.start ? -1 : 1))
    .slice(-AVERAGE_WINDOW)
    .map((p) => daysBetween(p.start, p.end!) + 1)
  const periodLength = logged.length
    ? Math.round(mean(logged))
    : (settings.defaultPeriodLength ?? FALLBACK_PERIOD_LENGTH)

  if (lengths.length === 0) {
    // One period (or only outlier gaps): fall back to what onboarding asked.
    return {
      lastStart,
      cycleLength: settings.defaultCycleLength ?? FALLBACK_CYCLE_LENGTH,
      periodLength,
      below: 5,
      above: 5,
      basedOn: 0,
      average: null,
      sd: null,
      irregular: false,
      confidence: 'low',
    }
  }

  const avg = mean(lengths)
  const cycleLength = Math.round(avg)
  const min = Math.min(...lengths)
  const max = Math.max(...lengths)
  const irregular = max - min > IRREGULAR_SPREAD
  const deviation = lengths.length > 1 ? sd(lengths) : null
  // At least ±2 days (±3 on a single cycle), widened to the observed min/max
  // and, for irregular cycles, to ±1.5 SD.
  const floor = lengths.length === 1 ? 3 : 2
  const sdSpread = irregular && deviation !== null ? Math.ceil(deviation * 1.5) : 0
  return {
    lastStart,
    cycleLength,
    periodLength,
    below: Math.max(floor, cycleLength - min, sdSpread),
    above: Math.max(floor, max - cycleLength, sdSpread),
    basedOn: lengths.length,
    average: round1(avg),
    sd: deviation === null ? null : round1(deviation),
    irregular,
    confidence: lengths.length >= 3 && !irregular ? 'medium' : 'low',
  }
}

/** The k-th predicted period after the latest logged one (k ≥ 1). Uncertainty grows with √k. */
function periodAt(model: Model, k: number): PredictedPeriod {
  const start = addDays(model.lastStart, model.cycleLength * k)
  const grow = Math.sqrt(k)
  return {
    start,
    end: addDays(start, model.periodLength - 1),
    rangeStart: addDays(start, -Math.ceil(model.below * grow)),
    rangeEnd: addDays(start, Math.ceil(model.above * grow)),
  }
}

/** Index of the first predicted period that hasn't fully slipped into the past. */
function firstUpcoming(model: Model, today: ISODate): number {
  let k = 1
  // Past the latest plausible start with nothing logged: most likely a missed
  // log, so move on to the following cycle instead of reporting a huge delay.
  while (periodAt(model, k).rangeEnd < today) k++
  return k
}

const NO_PREDICTION: Prediction = {
  nextPeriod: null,
  fertileWindow: null,
  ovulationEstimate: null,
  averageCycleLength: null,
  cycleLengthSD: null,
  basedOnCycles: 0,
  irregular: false,
  daysLate: 0,
  confidence: 'none',
}

/**
 * Estimates the next period, ovulation and fertile window from logged periods.
 * No prediction until at least one period is logged.
 */
export function predict(periods: readonly Period[], settings: PredictSettings, today: ISODate): Prediction {
  const model = buildModel(periods, settings)
  if (!model) return { ...NO_PREDICTION }

  const k = firstUpcoming(model, today)
  const next = periodAt(model, k)
  const luteal = settings.lutealLength
  const ovulation = addDays(next.start, -luteal)
  return {
    nextPeriod: next,
    // Ovulation ≈ next start − luteal length; window = ovulation − 5 … + 1,
    // stretched across the whole plausible range of next starts.
    fertileWindow: {
      start: addDays(next.rangeStart, -luteal - 5),
      end: addDays(next.rangeEnd, -luteal + 1),
    },
    ovulationEstimate: ovulation,
    averageCycleLength: model.average,
    cycleLengthSD: model.sd,
    basedOnCycles: model.basedOn,
    irregular: model.irregular,
    daysLate: Math.max(0, daysBetween(next.start, today)),
    confidence: model.confidence,
  }
}

/**
 * Predicted periods for the calendar: the next period (as in predict(), which
 * may be a few days late) and every later one whose most likely start is within
 * `months` months of today. Ranges widen the further out they are.
 */
export function projectedPeriods(
  periods: readonly Period[],
  settings: PredictSettings,
  today: ISODate,
  months: number,
): PredictedPeriod[] {
  const model = buildModel(periods, settings)
  if (!model) return []
  const horizon = addMonths(today, months)
  const out: PredictedPeriod[] = []
  for (let k = firstUpcoming(model, today); ; k++) {
    const p = periodAt(model, k)
    if (p.start > horizon) break
    out.push(p)
  }
  return out
}
