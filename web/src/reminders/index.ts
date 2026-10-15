import { useSyncExternalStore } from 'react'
import { cycleRepo } from '../data/repository'
import { fas } from '../fas'
import { ReminderService, type ReminderStatus } from './service'

export { ReminderService, type ReminderStatus } from './service'

/** The app-wide reminder service. Idle unless the user turns reminders on. */
export const reminderService = new ReminderService({ push: fas.push, repo: cycleRepo, auth: fas.auth })

export function useReminderStatus(service: ReminderService = reminderService): ReminderStatus {
  return useSyncExternalStore(service.subscribe, service.status)
}
