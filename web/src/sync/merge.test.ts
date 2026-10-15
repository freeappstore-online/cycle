import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, type DayLog, type Period } from '../data/types'
import { indexOf, overlappingToDrop, planMerge } from './merge'

const day = (date: string, updatedAt: number, note?: string): DayLog => ({ date, symptoms: [], updatedAt, note })
const period = (id: string, start: string, end: string | undefined, updatedAt: number): Period => ({ id, start, end, updatedAt })
const data = (days: DayLog[], periods: Period[] = [], settingsAt = 0) => ({
  days,
  periods,
  settings: { ...DEFAULT_SETTINGS, updatedAt: settingsAt },
})

describe('planMerge', () => {
  it('without a base, unions both sides and keeps the newer copy', () => {
    const local = data([day('2026-01-01', 5, 'local'), day('2026-01-02', 1, 'local')], [period('a', '2026-01-01', '2026-01-04', 1)])
    const remote = data([day('2026-01-01', 3, 'remote'), day('2026-01-02', 9, 'remote'), day('2026-01-03', 1)], [period('b', '2026-02-01', undefined, 1)])
    const plan = planMerge(local, remote, undefined)
    expect(plan.putDays.map((d) => [d.date, d.note])).toEqual([
      ['2026-01-02', 'remote'],
      ['2026-01-03', undefined],
    ])
    expect(plan.putPeriods.map((p) => p.id)).toEqual(['b'])
    expect(plan.deleteDays).toEqual([])
    expect(plan.deletePeriods).toEqual([])
  })

  it('keeps a local deletion instead of bringing the item back', () => {
    const base = indexOf(data([day('2026-01-01', 1)], [period('a', '2026-01-01', '2026-01-04', 1)]))
    const plan = planMerge(data([]), data([day('2026-01-01', 1)], [period('a', '2026-01-01', '2026-01-04', 1)]), base)
    expect(plan.putDays).toEqual([])
    expect(plan.putPeriods).toEqual([])
  })

  it('applies a remote deletion locally', () => {
    const base = indexOf(data([day('2026-01-01', 1)], [period('a', '2026-01-01', '2026-01-04', 1)]))
    const plan = planMerge(data([day('2026-01-01', 1)], [period('a', '2026-01-01', '2026-01-04', 1)]), data([]), base)
    expect(plan.deleteDays).toEqual(['2026-01-01'])
    expect(plan.deletePeriods).toEqual(['a'])
  })

  it('keeps an edit made after the other side deleted', () => {
    const base = indexOf(data([day('2026-01-01', 1), day('2026-01-02', 1)]))
    // Local edited 01-01 after the last sync; remote deleted it.
    expect(planMerge(data([day('2026-01-01', 7)]), data([]), base).deleteDays).toEqual([])
    // Remote edited 01-02 after the last sync; local deleted it.
    expect(planMerge(data([]), data([day('2026-01-02', 7)]), base).putDays.map((d) => d.date)).toEqual(['2026-01-02'])
  })

  it('takes settings from whichever side changed them last', () => {
    expect(planMerge(data([], [], 1), data([], [], 2), undefined).settings?.updatedAt).toBe(2)
    expect(planMerge(data([], [], 2), data([], [], 1), undefined).settings).toBeUndefined()
  })
})

describe('overlappingToDrop', () => {
  it('keeps the most recently updated of overlapping periods, deterministically', () => {
    const periods = [
      period('x', '2026-01-01', '2026-01-05', 5),
      period('y', '2026-01-02', '2026-01-04', 9),
      period('z', '2026-02-01', '2026-02-05', 1),
    ]
    expect(overlappingToDrop(periods)).toEqual(['x'])
    expect(overlappingToDrop([...periods].reverse())).toEqual(['x'])
    // Same timestamp: the smaller id wins.
    expect(overlappingToDrop([period('b', '2026-01-01', '2026-01-05', 1), period('a', '2026-01-03', undefined, 1)])).toEqual(['b'])
    expect(overlappingToDrop([periods[2]])).toEqual([])
  })
})
