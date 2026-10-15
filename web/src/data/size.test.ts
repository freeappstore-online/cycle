import { describe, expect, it } from 'vitest'
import { heavyDataset } from '../test/heavyDataset'
import type { CycleExport } from './types'
import { validateExport } from './validate'

// Sizes the serialised export for the fas.kv budget in #141 (64 KB per value,
// 1 MB per user per app; plan is one encrypted blob per year).

const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length

describe('export size', () => {
  it('keeps a 5-year daily-logging dataset well under 1 MB, and one year under 64 KB', () => {
    const data = heavyDataset(5)
    expect(() => validateExport(data)).not.toThrow()
    const total = bytes(data)

    const year = (y: number): CycleExport => ({
      ...data,
      days: data.days.filter((d) => d.date.startsWith(`${y}-`)),
      periods: data.periods.filter((p) => p.start.startsWith(`${y}-`)),
    })
    const perYear = [2020, 2021, 2022, 2023, 2024].map((y) => bytes(year(y)))
    const maxYear = Math.max(...perYear)

    console.log(
      `export size: ${data.days.length} days + ${data.periods.length} periods over 5 years = ${(total / 1024).toFixed(1)} KB; ` +
        `largest single year ${(maxYear / 1024).toFixed(1)} KB (~${((maxYear * 4) / 3 / 1024).toFixed(1)} KB base64 before encryption overhead)`,
    )
    expect(total).toBeLessThan(500 * 1024)
    expect((maxYear * 4) / 3).toBeLessThan(64 * 1024)
  })
})
