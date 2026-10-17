// Settings → Summary for a doctor: a text PDF for a chosen date range, made on
// this device. jsPDF loads only when the user generates one.

import { useId, useState } from 'react'
import { canShareFiles, downloadBlob, shareBlob } from '../../backup/files'
import { primaryButton, secondaryButton } from '../../components/buttons'
import { Busy, ErrorText, input, useAction } from '../../components/form'
import { useCycleRepo } from '../../data'
import type { ISODate } from '../../data/types'
import { addMonths } from '../../predict'
import { buildSummary } from '../../report/summary'

const card = 'rounded-[var(--radius)] border border-[var(--line)] bg-[var(--panel)] p-4'

export function ReportSection({ today }: { today: ISODate }) {
  const repo = useCycleRepo()
  const fromId = useId()
  const toId = useId()
  const notesId = useId()
  const errorId = useId()
  const [from, setFrom] = useState(() => addMonths(today, -6))
  const [to, setTo] = useState(today)
  const [notes, setNotes] = useState(false)
  const action = useAction()
  const share = canShareFiles()
  const invalid = !from || !to || from > to

  const make = async () => {
    const [{ renderSummaryPdf, pdfFileName }, data] = await Promise.all([import('../../report/pdf'), repo.exportAll()])
    const blob = await renderSummaryPdf(buildSummary(data, { from, to, includeNotes: notes, generatedOn: today }))
    return { blob, file: pdfFileName(from, to) }
  }

  return (
    <section aria-labelledby="report-heading" className={card}>
      <h2 id="report-heading" className="m-0 text-base font-bold">
        Summary for a doctor
      </h2>
      <p className="mb-0 mt-2 text-sm text-[var(--muted)]">
        A PDF with your periods, cycle lengths and symptoms for a date range. It's made on this device and isn't
        uploaded anywhere.
      </p>
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={fromId} className="mb-1 block text-sm font-bold">
            From
          </label>
          <input id={fromId} type="date" aria-invalid={invalid || undefined} aria-describedby={invalid ? errorId : undefined} value={from} max={to || today} onChange={(e) => setFrom(e.target.value)} className={input} />
        </div>
        <div>
          <label htmlFor={toId} className="mb-1 block text-sm font-bold">
            To
          </label>
          <input id={toId} type="date" aria-invalid={invalid || undefined} aria-describedby={invalid ? errorId : undefined} value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)} className={input} />
        </div>
      </div>
      <div className="mt-3 flex items-start gap-2">
        <input id={notesId} type="checkbox" checked={notes} onChange={(e) => setNotes(e.target.checked)} className="mt-1 h-4 w-4 accent-[var(--accent)]" />
        <label htmlFor={notesId} className="text-sm">
          Include my notes
        </label>
      </div>
      {invalid && <div id={errorId}><ErrorText>Choose a start date on or before the end date.</ErrorText></div>}
      {action.error && <ErrorText>{action.error}</ErrorText>}
      <Busy busy={action.busy} label="Creating PDF…" />
      <div className="mt-1 flex flex-wrap gap-2">
        <button
          type="button"
          className={primaryButton}
          disabled={invalid || action.busy}
          onClick={() =>
            void action.run(async () => {
              const { blob, file } = await make()
              downloadBlob(blob, file)
            })
          }
        >
          Download PDF
        </button>
        {share && (
          <button
            type="button"
            className={secondaryButton}
            disabled={invalid || action.busy}
            onClick={() =>
              void action.run(async () => {
                const { blob, file } = await make()
                await shareBlob(blob, file, 'Cycle summary')
              })
            }
          >
            Share PDF
          </button>
        )}
      </div>
    </section>
  )
}
