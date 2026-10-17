// The cycle app's data model. Everything here is stored locally in IndexedDB
// (see db.ts) and serialised as `CycleExport` for backup and sync.
//
// Source of truth for periods: the `periods` store. A Period is an explicit
// start/end range the user edits ("period started", "period ended"). DayLog.flow
// records how heavy a given day was and is independent of it: flow outside a
// period (e.g. spotting mid-cycle) is allowed and does not create a period, and
// deleting a period leaves its day logs alone. Prediction (#139) reads periods.

/** Calendar date in local time, `YYYY-MM-DD`. Sorts lexicographically. */
export type ISODate = string

export const FLOWS = ['spotting', 'light', 'medium', 'heavy'] as const
export type Flow = (typeof FLOWS)[number]

export const SYMPTOMS = [
  'cramps',
  'headache',
  'bloating',
  'acne',
  'tender_breasts',
  'fatigue',
  'nausea',
  'back_pain',
  'cravings',
  'insomnia',
  'diarrhea',
  'constipation',
  'dizziness',
  'discharge',
] as const
export type SymptomId = (typeof SYMPTOMS)[number]
export type Symptom = SymptomId

export const MOODS = ['happy', 'calm', 'sad', 'anxious', 'irritable', 'sensitive', 'energetic', 'low_energy'] as const
export type MoodId = (typeof MOODS)[number]
export type Mood = MoodId

export interface DayLog {
  date: ISODate
  flow?: Flow
  symptoms: SymptomId[]
  mood?: MoodId
  note?: string
  /** ms since epoch; the newer record wins on merge. */
  updatedAt: number
}

export interface Period {
  id: string
  start: ISODate
  /** Inclusive. Missing while the period is ongoing. */
  end?: ISODate
  updatedAt: number
}

/** 0 = Sunday, 1 = Monday. */
export type WeekStart = 0 | 1

export interface Settings {
  /** Used for predictions until there's enough history. */
  defaultCycleLength?: number
  defaultPeriodLength?: number
  lutealLength: number
  weekStart: WeekStart
  updatedAt: number
}

export const DEFAULT_SETTINGS: Settings = {
  lutealLength: 14,
  weekStart: 1,
  updatedAt: 0,
}

/** The serialised shape used by exportAll/importAll, sync (#141) and backup (#142). */
export interface CycleExport {
  schemaVersion: number
  days: DayLog[]
  periods: Period[]
  settings: Settings
}

export interface DateRange {
  /** Inclusive. */
  from: ISODate
  /** Inclusive. */
  to: ISODate
}

export type ImportMode = 'replace' | 'merge'
