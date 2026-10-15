// Merge rules for sync. Pure functions.
//
// Per day (by date) and per period (by id), the newer updatedAt wins; settings
// are last-write-wins too. On top of that the merge is three-way: `base`
// records each item's updatedAt as of the last successful sync, which tells a
// deletion apart from a new item:
//   - only remote, and in base at the same or a newer time → deleted here; don't bring it back
//   - only local,  and in base at the same or a newer time → deleted elsewhere; delete it here
// An item edited after the deletion (updatedAt newer than base) survives.
//
// Known limitation: fas.kv has no compare-and-swap, so two devices writing the
// same year at the same moment can still lose one side's latest edit until it
// is edited again. Syncs pull and merge right before writing to keep that
// window short.

import type { CycleExport, DayLog, Period, Settings } from '../data/types'
import { periodsOverlap } from '../data/validate'

export interface BaseIndex {
  days: Record<string, number>
  periods: Record<string, number>
}

export interface MergePlan {
  putDays: DayLog[]
  deleteDays: string[]
  putPeriods: Period[]
  deletePeriods: string[]
  /** Set when the remote settings are newer. */
  settings?: Settings
}

export function indexOf(data: Pick<CycleExport, 'days' | 'periods'>): BaseIndex {
  return {
    days: Object.fromEntries(data.days.map((d) => [d.date, d.updatedAt])),
    periods: Object.fromEntries(data.periods.map((p) => [p.id, p.updatedAt])),
  }
}

function mergeItems<T extends { updatedAt: number }>(
  local: readonly T[],
  remote: readonly T[],
  keyOf: (item: T) => string,
  base: Record<string, number> | undefined,
): { put: T[]; del: string[] } {
  const localByKey = new Map(local.map((i) => [keyOf(i), i]))
  const remoteKeys = new Set<string>()
  const put: T[] = []
  const del: string[] = []
  for (const r of remote) {
    const k = keyOf(r)
    remoteKeys.add(k)
    const l = localByKey.get(k)
    if (l) {
      if (r.updatedAt > l.updatedAt) put.push(r)
    } else {
      const b = base?.[k]
      if (b === undefined || r.updatedAt > b) put.push(r)
    }
  }
  for (const [k, l] of localByKey) {
    if (remoteKeys.has(k)) continue
    const b = base?.[k]
    if (b !== undefined && l.updatedAt <= b) del.push(k)
  }
  return { put, del }
}

export function planMerge(
  local: Pick<CycleExport, 'days' | 'periods' | 'settings'>,
  remote: Pick<CycleExport, 'days' | 'periods' | 'settings'>,
  base: BaseIndex | undefined,
): MergePlan {
  const days = mergeItems(local.days, remote.days, (d) => d.date, base?.days)
  const periods = mergeItems(local.periods, remote.periods, (p) => p.id, base?.periods)
  const plan: MergePlan = {
    putDays: days.put,
    deleteDays: days.del,
    putPeriods: periods.put,
    deletePeriods: periods.del,
  }
  if (remote.settings.updatedAt > local.settings.updatedAt) plan.settings = remote.settings
  return plan
}

/**
 * Two devices can log the same period separately (different ids). After a
 * merge, keep the most recently updated of any overlapping periods (ties: the
 * smaller id) and return the ids to delete. Every device applies the same rule,
 * so they converge.
 */
export function overlappingToDrop(periods: readonly Period[]): string[] {
  const sorted = [...periods].sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : a.id < b.id ? -1 : 1))
  const kept: Period[] = []
  const drop: string[] = []
  const beats = (a: Period, b: Period) => a.updatedAt > b.updatedAt || (a.updatedAt === b.updatedAt && a.id < b.id)
  for (const p of sorted) {
    const clashIdx = kept.findIndex((k) => periodsOverlap(k, p))
    if (clashIdx === -1) {
      kept.push(p)
      continue
    }
    const k = kept[clashIdx]
    if (beats(p, k)) {
      drop.push(k.id)
      kept.splice(clashIdx, 1)
      // p may now clash with another kept period; re-check it.
      sorted.push(p)
    } else {
      drop.push(p.id)
    }
  }
  return drop
}
