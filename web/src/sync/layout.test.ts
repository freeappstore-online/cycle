import { describe, expect, it } from 'vitest'
import { heavyDataset } from '../test/heavyDataset'
import { deriveKey, newKdfParams, sealJSON } from './crypto'
import {
  BYTE_BUDGET,
  KEY_BUDGET,
  KV_VALUE_LIMIT,
  PART_CHARS,
  SyncLimitError,
  checkBudget,
  chunk,
  splitByYear,
  valueBytes,
  yearKey,
  yearKeys,
  yearLabel,
} from './layout'

describe('keys', () => {
  it('names year parts and lists them', () => {
    expect(yearKey('2026')).toBe('cycle:y2026')
    expect(yearKey('2026', 2)).toBe('cycle:y2026:2')
    expect(yearLabel('2026')).toBe('cycle:y2026')
    expect(yearKeys({ 2025: 1, 2026: 3 })).toEqual(['cycle:y2025', 'cycle:y2026', 'cycle:y2026:1', 'cycle:y2026:2'])
    expect(Math.max(...yearKeys({ 2026: 20 }).map((k) => k.length))).toBeLessThanOrEqual(128)
  })
})

describe('chunk', () => {
  it('splits at the part size, and every part fits a 64 KB value', () => {
    expect(chunk('a'.repeat(PART_CHARS))).toHaveLength(1)
    const two = chunk('a'.repeat(PART_CHARS + 1))
    expect(two.map((p) => p.length)).toEqual([PART_CHARS, 1])
    const many = chunk('b'.repeat(PART_CHARS * 3 + 5))
    expect(many).toHaveLength(4)
    expect(many.join('')).toBe('b'.repeat(PART_CHARS * 3 + 5))
    for (const p of many) expect(valueBytes(p)).toBeLessThanOrEqual(KV_VALUE_LIMIT)
    expect(valueBytes('a'.repeat(PART_CHARS))).toBeLessThan(KV_VALUE_LIMIT)
    expect(chunk('')).toEqual([''])
  })
})

describe('splitByYear', () => {
  it('buckets days by date and periods by start, sorted by year', () => {
    const split = splitByYear({
      days: [
        { date: '2025-12-31', symptoms: [], updatedAt: 1 },
        { date: '2026-01-01', symptoms: [], updatedAt: 1 },
      ],
      periods: [{ id: 'p', start: '2025-12-30', end: '2026-01-03', updatedAt: 1 }],
    })
    expect([...split.keys()]).toEqual(['2025', '2026'])
    expect(split.get('2025')).toMatchObject({ days: [{ date: '2025-12-31' }], periods: [{ id: 'p' }] })
    expect(split.get('2026')).toMatchObject({ days: [{ date: '2026-01-01' }], periods: [] })
  })
})

describe('checkBudget', () => {
  it(`refuses more than ${KEY_BUDGET} keys`, () => {
    const ok = new Map(Array.from({ length: KEY_BUDGET }, (_, i) => [`k${i}`, 'x']))
    expect(() => checkBudget(ok)).not.toThrow()
    ok.set('one-more', 'x')
    expect(() => checkBudget(ok)).toThrow(SyncLimitError)
  })

  it('refuses before reaching 1 MB in total', () => {
    const part = 'a'.repeat(PART_CHARS)
    const values = new Map(Array.from({ length: Math.floor(BYTE_BUDGET / (PART_CHARS + 2)) }, (_, i) => [`k${i}`, part]))
    expect(() => checkBudget(values)).not.toThrow()
    values.set('over', part)
    expect(() => checkBudget(values)).toThrow(/1 MB/)
    expect(BYTE_BUDGET).toBeLessThan(1024 * 1024)
  })

  it('refuses a single value over 64 KB', () => {
    expect(() => checkBudget(new Map([['big', 'a'.repeat(KV_VALUE_LIMIT)]]))).toThrow(/64 KB/)
  })
})

describe('real data size', () => {
  it('compresses a heavy year to one small part, leaving lots of room under 1 MB', async () => {
    const key = await deriveKey('pass', newKdfParams(1000))
    const years = splitByYear(heavyDataset(5))
    const sizes: number[] = []
    for (const [year, payload] of years) {
      const parts = chunk(await sealJSON(key, payload, yearLabel(year)))
      expect(parts).toHaveLength(1)
      sizes.push(valueBytes(parts[0]))
    }
    const max = Math.max(...sizes)
    const total = sizes.reduce((a, b) => a + b, 0)
    console.log(`encrypted sync size: largest year ${(max / 1024).toFixed(1)} KB, 5 years ${(total / 1024).toFixed(1)} KB`)
    expect(max).toBeLessThan(PART_CHARS / 2)
    expect(total).toBeLessThan(BYTE_BUDGET / 4)
  })
})
