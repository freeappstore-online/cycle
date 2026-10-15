import { describe, expect, it } from 'vitest'
import type { DayLog, Period } from '../data/types'
import { heavyDataset } from '../test/heavyDataset'
import { pdfDate, pdfFileName, pdfText, renderSummaryPdf } from './pdf'
import { buildSummary } from './summary'

const period = (start: string, end?: string): Period => ({ id: start, start, end, updatedAt: 0 })
const day = (date: string, symptoms: DayLog['symptoms'], note?: string): DayLog => ({ date, symptoms, note, updatedAt: 0 })

const periods = [
  period('2026-01-03', '2026-01-07'),
  period('2026-01-31', '2026-02-04'),
  period('2026-03-01', '2026-03-06'),
  period('2026-06-20', '2026-06-23'), // after a missed log: 111-day gap
  period('2026-07-18'),
]
const days = [
  day('2026-01-03', ['cramps', 'fatigue']),
  day('2026-01-04', ['cramps']),
  day('2026-02-01', ['headache'], 'Saw GP about headaches'),
  day('2026-03-02', ['cramps', 'bloating']),
  day('2025-12-01', ['acne'], 'outside range'),
]

describe('buildSummary', () => {
  const summary = buildSummary({ days, periods }, { from: '2026-01-01', to: '2026-07-20', includeNotes: true, generatedOn: '2026-07-20' })

  it('lists periods in range with lengths, ongoing ones without', () => {
    expect(summary.periods).toEqual([
      { start: '2026-01-03', end: '2026-01-07', length: 5 },
      { start: '2026-01-31', end: '2026-02-04', length: 5 },
      { start: '2026-03-01', end: '2026-03-06', length: 6 },
      { start: '2026-06-20', end: '2026-06-23', length: 4 },
      { start: '2026-07-18' },
    ])
    expect(summary.periodStats).toEqual({ average: 5, shortest: 4, longest: 6 })
  })

  it('reports cycle lengths with average and range, leaving outliers out of the average', () => {
    expect(summary.cycles.map((c) => [c.length, c.outlier])).toEqual([
      [28, false],
      [29, false],
      [111, true],
      [28, false],
    ])
    expect(summary.cycleStats).toEqual({ average: 28.3, shortest: 28, longest: 29, count: 3 })
  })

  it('counts symptom days within the range, most frequent first', () => {
    expect(summary.loggedDays).toBe(4)
    expect(summary.symptoms.map((s) => [s.label, s.days, s.percent])).toEqual([
      ['Cramps', 3, 75],
      ['Bloating', 1, 25],
      ['Fatigue', 1, 25],
      ['Headache', 1, 25],
    ])
  })

  it('includes notes only when asked', () => {
    expect(summary.notes).toEqual([{ date: '2026-02-01', note: 'Saw GP about headaches' }])
    expect(buildSummary({ days, periods }, { from: '2026-01-01', to: '2026-07-20', includeNotes: false, generatedOn: '2026-07-20' }).notes).toEqual([])
  })

  it('narrows everything to the range', () => {
    const march = buildSummary({ days, periods }, { from: '2026-03-01', to: '2026-03-31', includeNotes: true, generatedOn: '2026-07-20' })
    expect(march.periods.map((p) => p.start)).toEqual(['2026-03-01'])
    expect(march.notes).toEqual([])
    expect(march.symptoms.map((s) => s.id)).toEqual(['bloating', 'cramps'])
  })
})

describe('PDF', () => {
  const text = async (blob: Blob) => new TextDecoder('latin1').decode(await blob.arrayBuffer())

  it('renders a text PDF with the range, tables and self-reported footer', async () => {
    const summary = buildSummary({ days, periods }, { from: '2026-01-01', to: '2026-07-20', includeNotes: true, generatedOn: '2026-07-20' })
    const blob = await renderSummaryPdf(summary, { compress: false })
    expect(blob.type).toBe('application/pdf')
    const pdf = await text(blob)
    expect(pdf.startsWith('%PDF-')).toBe(true)
    expect(pdf.trimEnd().endsWith('%%EOF')).toBe(true)
    for (const s of [
      'Cycle summary',
      '1 Jan 2026 to 20 Jul 2026',
      'Average 28.3 days over 3 complete cycles',
      'Not in average',
      'Ongoing',
      'Cramps',
      '75%',
      'Saw GP about headaches',
      'Self-reported data from the Cycle app, not a medical record',
      'Page 1 of 1',
      'Estimates only, not medical advice. Do not use this app for contraception.',
    ]) {
      expect(pdf).toContain(`(${s}`)
    }
  })

  it('leaves notes out unless included, and paginates long ranges', async () => {
    const data = heavyDataset(3)
    const summary = buildSummary(data, { from: '2020-01-01', to: '2022-12-31', includeNotes: true, generatedOn: '2023-01-01' })
    const pdf = await text(await renderSummaryPdf(summary, { compress: false }))
    const pages = Number(/Page 1 of (\d+)/.exec(pdf)?.[1])
    expect(pages).toBeGreaterThan(3)
    expect(pdf).toContain(`(Page ${pages} of ${pages})`)
    // The contraception disclaimer is in the footer of every page.
    expect(pdf.match(/Do not use this app for contraception/g)).toHaveLength(pages)

    const noNotes = await text(await renderSummaryPdf({ ...summary, notes: [] }, { compress: false }))
    expect(noNotes).not.toContain('Slept badly')
    // Compressed by default.
    expect((await renderSummaryPdf(summary)).size).toBeLessThan(new Blob([pdf]).size / 2)
  })

  it('keeps text within the PDF font and dates unambiguous', () => {
    expect(pdfText('Felt “rough” – took ibuprofen… 😣 日本')).toBe('Felt "rough" - took ibuprofen... ? ??')
    expect(pdfText('café naïve')).toBe('café naïve')
    expect(pdfDate('2026-02-01')).toBe('1 Feb 2026')
    expect(pdfFileName('2026-04-15', '2026-10-15')).toBe('cycle-summary-2026-04-15-to-2026-10-15.pdf')
  })
})
