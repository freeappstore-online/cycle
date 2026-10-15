// Display helpers for `YYYY-MM-DD` dates. Formatting goes through UTC so the
// device timezone can't shift the day; "today" is the device's local date.

import { useEffect, useState } from 'react'
import type { ISODate } from './data/types'
import { toDayNumber } from './predict'

const pad = (n: number) => String(n).padStart(2, '0')

/** The device's local calendar date. */
export function localToday(now = new Date()): ISODate {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/** Today's date, refreshed when the app comes back to the foreground (e.g. after midnight). */
export function useToday(): ISODate {
  const [today, setToday] = useState(localToday)
  useEffect(() => {
    const refresh = () => setToday(localToday())
    document.addEventListener('visibilitychange', refresh)
    window.addEventListener('focus', refresh)
    return () => {
      document.removeEventListener('visibilitychange', refresh)
      window.removeEventListener('focus', refresh)
    }
  }, [])
  return today
}

const asUTC = (date: ISODate) => new Date(toDayNumber(date) * 86_400_000)

function format(date: ISODate, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(undefined, { ...options, timeZone: 'UTC' }).format(asUTC(date))
}

/** "Wednesday, 15 October 2026" (order follows the user's locale). */
export const formatLong = (date: ISODate) =>
  format(date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

/** "Thu 16 Jul". */
export const formatShort = (date: ISODate) => format(date, { weekday: 'short', day: 'numeric', month: 'short' })

/** "16 Jul". */
export const formatDayMonth = (date: ISODate) => format(date, { day: 'numeric', month: 'short' })

/** "October 2026" for a `YYYY-MM` month. */
export const formatMonth = (month: string) => format(`${month}-01`, { month: 'long', year: 'numeric' })

/** Short weekday names starting on Sunday (0) or Monday (1). */
export function weekdayNames(weekStart: 0 | 1): string[] {
  // 2026-01-04 is a Sunday.
  return Array.from({ length: 7 }, (_, i) => format(`2026-01-${pad(4 + weekStart + i)}`, { weekday: 'short' }))
}

/** "N days" / "1 day". */
export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
