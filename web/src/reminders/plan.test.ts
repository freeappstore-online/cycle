import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, type Period } from '../data/types'
import { DEFAULT_PREFS, atLocal, planReminders } from './plan'

const period = (start: string, end: string): Period => ({ id: start, start, end, updatedAt: 0 })
// Three 28-day cycles: the next period is estimated for 2026-11-10 (range 8–12 Nov).
const periods = [
  period('2026-07-21', '2026-07-25'),
  period('2026-08-18', '2026-08-22'),
  period('2026-09-15', '2026-09-19'),
  period('2026-10-13', '2026-10-17'),
]
const now = new Date(2026, 9, 15, 10, 0) // 15 Oct 2026 10:00 local
const all = { ...DEFAULT_PREFS, periodDue: true, fertile: true, pill: true }

describe('planReminders', () => {
  it('cancels everything when nothing is turned on', () => {
    expect(planReminders(DEFAULT_PREFS, periods, DEFAULT_SETTINGS, now)).toEqual({
      schedule: [],
      cancel: ['period-due', 'fertile-start', 'pill'],
    })
  })

  it('schedules period-due N days before the estimate, the fertile window start and a daily pill', () => {
    const plan = planReminders(all, periods, DEFAULT_SETTINGS, now)
    expect(plan.cancel).toEqual([])
    expect(plan.schedule).toEqual([
      { id: 'period-due', when: { at: atLocal('2026-11-08', '09:00') } },
      // Fertile window: (8 Nov − 14 − 5) = 20 Oct.
      { id: 'fertile-start', when: { at: atLocal('2026-10-20', '09:00') } },
      { id: 'pill', when: { daily: '09:00' } },
    ])
  })

  it('uses the chosen time, days before and quiet hours', () => {
    const plan = planReminders(
      { ...all, fertile: false, pill: false, daysBefore: 0, time: '07:30', quietHours: { start: '22:00', end: '07:00' } },
      periods,
      DEFAULT_SETTINGS,
      now,
    )
    expect(plan.schedule).toEqual([
      { id: 'period-due', when: { at: atLocal('2026-11-10', '07:30') }, opts: { quietHours: { start: '22:00', end: '07:00' } } },
    ])
  })

  it('moves on a cycle once a reminder time has passed', () => {
    const later = new Date(2026, 10, 9, 10, 0) // 9 Nov: the 8 Nov reminder is gone
    const plan = planReminders({ ...DEFAULT_PREFS, periodDue: true }, periods, DEFAULT_SETTINGS, later)
    expect(plan.schedule[0].when).toEqual({ at: atLocal('2026-12-06', '09:00') })
  })

  it('cancels period and fertile reminders with no periods logged, but keeps the pill', () => {
    const plan = planReminders(all, [], DEFAULT_SETTINGS, now)
    expect(plan.schedule).toEqual([{ id: 'pill', when: { daily: '09:00' } }])
    expect(plan.cancel).toEqual(['period-due', 'fertile-start'])
  })
})
