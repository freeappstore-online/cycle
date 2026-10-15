// Which fas.push reminders to schedule or cancel, from the user's choices and
// the #139 estimates. Pure: the service applies the plan.

import type { PushScheduleOptions, PushWhen } from '@freeappstore/sdk'
import type { Period, Settings } from '../data/types'
import { localToday } from '../dates'
import { addDays, fertileWindowFor, projectedPeriods } from '../predict'

export interface ReminderPrefs {
  periodDue: boolean
  /** Days before the estimated start (0 = on the day). */
  daysBefore: number
  fertile: boolean
  pill: boolean
  /** Time of day for every reminder, HH:MM (24-hour, this device's time zone). */
  time: string
  /** Hold reminders in this daily window until it ends. */
  quietHours: { start: string; end: string } | null
}

export const DEFAULT_PREFS: ReminderPrefs = {
  periodDue: false,
  daysBefore: 2,
  fertile: false,
  pill: false,
  time: '09:00',
  quietHours: null,
}

/** Server-side reminder ids (stable, so scheduling again replaces). */
export const REMINDER_IDS = { periodDue: 'period-due', fertile: 'fertile-start', pill: 'pill' } as const
export const ALL_REMINDER_IDS: string[] = Object.values(REMINDER_IDS)

export interface PlannedReminder {
  id: string
  when: PushWhen
  opts?: PushScheduleOptions
}

export interface ReminderPlan {
  schedule: PlannedReminder[]
  cancel: string[]
}

export const anyEnabled = (p: ReminderPrefs) => p.periodDue || p.fertile || p.pill

/** A local date + HH:MM as an instant (in this device's time zone). */
export function atLocal(date: string, time: string): Date {
  const [y, m, d] = date.split('-').map(Number)
  const [hh, mm] = time.split(':').map(Number)
  return new Date(y, m - 1, d, hh, mm)
}

export function planReminders(
  prefs: ReminderPrefs,
  periods: readonly Period[],
  settings: Settings,
  now: Date,
): ReminderPlan {
  const schedule: PlannedReminder[] = []
  const cancel: string[] = []
  const opts = prefs.quietHours ? { quietHours: prefs.quietHours } : undefined
  const withOpts = (id: string, when: PushWhen): PlannedReminder => (opts ? { id, when, opts } : { id, when })

  // The next few estimated periods: the first one whose reminder time is
  // still ahead wins, so a reminder that has already passed moves on a cycle.
  const projected = periods.length ? projectedPeriods(periods, settings, localToday(now), 4) : []
  const firstFuture = (dates: string[]) => dates.map((d) => atLocal(d, prefs.time)).find((at) => at > now)

  const due = prefs.periodDue ? firstFuture(projected.map((p) => addDays(p.start, -prefs.daysBefore))) : undefined
  if (due) schedule.push(withOpts(REMINDER_IDS.periodDue, { at: due }))
  else cancel.push(REMINDER_IDS.periodDue)

  const fertile = prefs.fertile
    ? firstFuture(projected.map((p) => fertileWindowFor(p, settings.lutealLength).start))
    : undefined
  if (fertile) schedule.push(withOpts(REMINDER_IDS.fertile, { at: fertile }))
  else cancel.push(REMINDER_IDS.fertile)

  if (prefs.pill) schedule.push(withOpts(REMINDER_IDS.pill, { daily: prefs.time }))
  else cancel.push(REMINDER_IDS.pill)

  return { schedule, cancel }
}
