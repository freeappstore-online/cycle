// Renders a DoctorSummary as a text-based A4 PDF. jsPDF is loaded with a
// dynamic import() only when a PDF is generated, so it stays out of the main
// chunk; the PWA precaches its chunk, so this works offline too.

import type { ISODate } from '../data/types'
import type { DoctorSummary } from './summary'

const PAGE_W = 210
const PAGE_H = 297
const MARGIN = 18
const FOOTER_H = 14
const LINE = 5.2

/** A fixed English date ("15 Oct 2026") to match the English report text. */
export function pdfDate(date: ISODate): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(Date.UTC(y, m - 1, d)),
  )
}

/**
 * The PDF's built-in Helvetica only covers Windows-1252. Map common
 * punctuation to ASCII and replace anything else outside Latin-1, so notes in
 * other scripts don't come out garbled.
 */
export function pdfText(text: string): string {
  return text
    .normalize('NFC')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/•/g, '-')
    .replace(/[^\n -~ -ÿ]/gu, '?')
}

/** `compress: false` keeps the text streams readable, for tests. */
export async function renderSummaryPdf(summary: DoctorSummary, { compress = true } = {}): Promise<Blob> {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress })
  doc.setProperties({ title: 'Cycle summary', subject: 'Self-reported menstrual cycle summary', creator: 'Cycle (FreeAppStore)' })

  let y = MARGIN
  const ensure = (h: number) => {
    if (y + h > PAGE_H - MARGIN - FOOTER_H) {
      doc.addPage()
      y = MARGIN
    }
  }
  const text = (s: string, x: number, opts?: { bold?: boolean; size?: number; color?: number }) => {
    doc.setFont('helvetica', opts?.bold ? 'bold' : 'normal')
    doc.setFontSize(opts?.size ?? 10)
    doc.setTextColor(opts?.color ?? 20)
    doc.text(pdfText(s), x, y)
  }
  const heading = (s: string) => {
    ensure(LINE * 4)
    y += LINE * 0.8
    text(s, MARGIN, { bold: true, size: 12 })
    y += LINE * 1.2
  }
  const paragraph = (s: string, opts?: { color?: number }) => {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    for (const line of doc.splitTextToSize(pdfText(s), PAGE_W - 2 * MARGIN) as string[]) {
      ensure(LINE)
      text(line, MARGIN, opts)
      y += LINE
    }
  }
  /** A simple table: header row, then rows; repeats the header after a page break. */
  const table = (columns: { title: string; width: number }[], rows: string[][]) => {
    const head = () => {
      let x = MARGIN
      for (const c of columns) {
        text(c.title, x, { bold: true, size: 9, color: 80 })
        x += c.width
      }
      doc.setDrawColor(180)
      doc.line(MARGIN, y + 1.5, PAGE_W - MARGIN, y + 1.5)
      y += LINE + 1
    }
    ensure(LINE * 3)
    head()
    for (const row of rows) {
      if (y + LINE > PAGE_H - MARGIN - FOOTER_H) {
        doc.addPage()
        y = MARGIN
        head()
      }
      let x = MARGIN
      row.forEach((cell, i) => {
        text(cell, x)
        x += columns[i].width
      })
      y += LINE
    }
  }

  // Title
  text('Cycle summary', MARGIN, { bold: true, size: 18 })
  y += LINE * 1.6
  text(`${pdfDate(summary.from)} to ${pdfDate(summary.to)}`, MARGIN, { size: 11, color: 60 })
  y += LINE * 1.2
  paragraph(`Generated ${pdfDate(summary.generatedOn)} from data logged in the Cycle app. ${summary.loggedDays} days with entries in this period.`, {
    color: 90,
  })

  heading('Cycle length')
  if (summary.cycleStats) {
    const s = summary.cycleStats
    paragraph(
      `Average ${s.average} days over ${s.count} complete cycle${s.count === 1 ? '' : 's'} (shortest ${s.shortest}, longest ${s.longest}).`,
    )
  } else {
    paragraph('Not enough logged periods in this range to measure a complete cycle.')
  }
  const outliers = summary.cycles.filter((c) => c.outlier)
  if (summary.cycles.length) {
    y += 1
    table(
      [
        { title: 'Cycle start', width: 45 },
        { title: 'Length (days)', width: 35 },
        { title: '', width: 60 },
      ],
      summary.cycles.map((c) => [pdfDate(c.start), String(c.length), c.outlier ? 'Not in average (possible missed log)' : '']),
    )
  }
  if (outliers.length) paragraph('Cycles shorter than 15 or longer than 90 days are listed but left out of the average.', { color: 90 })

  heading('Periods')
  if (summary.periods.length) {
    if (summary.periodStats) {
      const p = summary.periodStats
      paragraph(`Average length ${p.average} days (shortest ${p.shortest}, longest ${p.longest}).`)
      y += 1
    }
    table(
      [
        { title: 'Start', width: 45 },
        { title: 'End', width: 45 },
        { title: 'Length (days)', width: 35 },
      ],
      summary.periods.map((p) => [pdfDate(p.start), p.end ? pdfDate(p.end) : 'Ongoing', p.length ? String(p.length) : '-']),
    )
  } else {
    paragraph('No periods logged in this range.')
  }

  heading('Symptoms')
  if (summary.symptoms.length) {
    table(
      [
        { title: 'Symptom', width: 60 },
        { title: 'Days', width: 25 },
        { title: '% of logged days', width: 40 },
      ],
      summary.symptoms.map((s) => [s.label, String(s.days), `${s.percent}%`]),
    )
  } else {
    paragraph('No symptoms logged in this range.')
  }

  if (summary.notes.length) {
    heading('Notes')
    for (const n of summary.notes) {
      ensure(LINE * 2)
      text(pdfDate(n.date), MARGIN, { bold: true })
      y += LINE
      paragraph(n.note)
      y += 1
    }
  }

  // Footer on every page.
  const pages = doc.getNumberOfPages()
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i)
    doc.setDrawColor(200)
    doc.line(MARGIN, PAGE_H - MARGIN - 6, PAGE_W - MARGIN, PAGE_H - MARGIN - 6)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(100)
    doc.text(
      pdfText(`Self-reported data from the Cycle app, not a medical record. Generated ${pdfDate(summary.generatedOn)}.`),
      MARGIN,
      PAGE_H - MARGIN - 1.5,
    )
    doc.text(`Page ${i} of ${pages}`, PAGE_W - MARGIN, PAGE_H - MARGIN - 1.5, { align: 'right' })
  }

  return doc.output('blob')
}

export function pdfFileName(from: ISODate, to: ISODate): string {
  return `cycle-summary-${from}-to-${to}.pdf`
}
