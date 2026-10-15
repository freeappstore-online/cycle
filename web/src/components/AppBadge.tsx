// Shows "period due in N days" as a number on the installed app icon, where
// the Badging API exists. Just a number, nothing that says what it counts.

import { useEffect } from 'react'
import { useCycleData } from '../data'
import type { ISODate } from '../data/types'
import { daysBetween, predict } from '../predict'

/** Days ahead within which the badge shows. */
const BADGE_WITHIN_DAYS = 7

type BadgeNavigator = Navigator & {
  setAppBadge?: (count?: number) => Promise<void>
  clearAppBadge?: () => Promise<void>
}

export function AppBadge({ today }: { today: ISODate }) {
  const days = useCycleData(
    async (repo) => {
      const next = predict(await repo.listPeriods(), await repo.getSettings(), today).nextPeriod
      return next ? daysBetween(today, next.start) : null
    },
    [today],
  )

  useEffect(() => {
    const nav = navigator as BadgeNavigator
    if (days === undefined || !nav.setAppBadge || !nav.clearAppBadge) return
    const show = days !== null && days >= 1 && days <= BADGE_WITHIN_DAYS
    ;(show ? nav.setAppBadge(days) : nav.clearAppBadge()).catch(() => {})
  }, [days])

  return null
}
