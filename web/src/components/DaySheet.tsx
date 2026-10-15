// Log or edit one day: period started/ended, flow, symptoms, mood and a note.
// Period actions save straight away; the rest saves with "Save".

import { ConfirmDialog } from '@freeappstore/sdk/ui'
import { useId, useState } from 'react'
import { createPortal } from 'react-dom'
import { useCycleData, useCycleRepo } from '../data'
import { type DayLog, FLOWS, type Flow, type ISODate, MOODS, type MoodId, type Period, SYMPTOMS, type SymptomId } from '../data/types'
import { formatDayMonth, formatLong, plural } from '../dates'
import { FLOW_LABELS, MOOD_LABELS, SYMPTOM_LABELS } from '../labels'
import { daysBetween } from '../predict'
import { newPeriodFrom, periodActionsFor, periodLastDay } from '../periods'
import { accentButton, dangerButton, primaryButton, secondaryButton } from './buttons'
import { CheckboxChips, RadioChips } from './Chips'
import { Sheet } from './Sheet'

export interface DaySheetProps {
  /** The day being edited; the sheet is closed when undefined. */
  date: ISODate | undefined
  today: ISODate
  onClose: () => void
}

export function DaySheet({ date, today, onClose }: DaySheetProps) {
  const [confirming, setConfirming] = useState<'day' | 'period' | null>(null)
  return (
    <Sheet
      open={date !== undefined}
      // Escape also reaches this Modal while a confirmation is open on top; leave the sheet open then.
      onClose={() => confirming === null && onClose()}
      title={date ? formatLong(date) : ''}
    >
      {date && <DaySheetBody key={date} date={date} today={today} onClose={onClose} confirming={confirming} setConfirming={setConfirming} />}
    </Sheet>
  )
}

interface BodyProps {
  date: ISODate
  today: ISODate
  onClose: () => void
  confirming: 'day' | 'period' | null
  setConfirming: (c: 'day' | 'period' | null) => void
}

function DaySheetBody({ date, today, onClose, confirming, setConfirming }: BodyProps) {
  const data = useCycleData(
    async (repo) => {
      const [day, periods, settings] = await Promise.all([repo.getDay(date), repo.listPeriods(), repo.getSettings()])
      return { day: day ?? null, periods, settings }
    },
    [date],
  )
  if (!data) return <p className="text-[var(--muted)]">Loading…</p>
  if (date > today) {
    return (
      <>
        <p className="mt-0 text-[var(--muted)]">This day hasn't happened yet. You can log it once it arrives.</p>
        <button type="button" className={secondaryButton} onClick={onClose}>
          Close
        </button>
      </>
    )
  }
  return (
    <DayForm
      date={date}
      today={today}
      initial={data.day}
      periods={data.periods}
      periodLength={data.settings.defaultPeriodLength}
      onClose={onClose}
      confirming={confirming}
      setConfirming={setConfirming}
    />
  )
}

interface FormProps extends BodyProps {
  initial: DayLog | null
  periods: Period[]
  periodLength: number | undefined
}

function DayForm({ date, today, initial, periods, periodLength, onClose, confirming, setConfirming }: FormProps) {
  const repo = useCycleRepo()
  const noteId = useId()
  const [flow, setFlow] = useState<Flow | undefined>(initial?.flow)
  const [symptoms, setSymptoms] = useState<SymptomId[]>(initial?.symptoms ?? [])
  const [mood, setMood] = useState<MoodId | undefined>(initial?.mood)
  const [note, setNote] = useState(initial?.note ?? '')
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)

  const actions = periodActionsFor(periods, date, today)
  const current = actions.current

  const run = async (fn: () => Promise<unknown>, close = false) => {
    setBusy(true)
    setError(undefined)
    try {
      await fn()
      if (close) onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const startPeriod = () => run(() => repo.upsertPeriod(newPeriodFrom(periods, date, today, periodLength)))
  const endPeriod = () => actions.endTarget && run(() => repo.upsertPeriod({ ...actions.endTarget!, end: date }))
  const save = () =>
    run(async () => {
      const empty = !flow && symptoms.length === 0 && !mood && note.trim() === ''
      if (empty) {
        if (initial) await repo.deleteDay(date)
        return
      }
      await repo.putDay({ date, flow, symptoms, mood, note: note.trim() || undefined })
    }, true)

  return (
    <>
      <section aria-label="Period" className="mb-5 rounded-[var(--radius)] border border-[var(--line)] p-3">
        <p className="m-0 mb-3 flex items-center gap-2 text-sm" aria-live="polite">
          {current ? (
            <>
              <span aria-hidden="true">💧</span>
              <span>
                Period day {daysBetween(current.start, date) + 1}
                {current.end
                  ? ` (${formatDayMonth(current.start)} – ${formatDayMonth(current.end)})`
                  : `, ongoing since ${formatDayMonth(current.start)}`}
              </span>
            </>
          ) : (
            <span className="text-[var(--muted)]">Not logged as a period day.</span>
          )}
        </p>
        <div className="flex flex-wrap gap-2">
          {actions.canStart && (
            <button type="button" className={accentButton} onClick={startPeriod} disabled={busy}>
              Period started this day
            </button>
          )}
          {actions.endTarget && (
            <button type="button" className={secondaryButton} onClick={endPeriod} disabled={busy}>
              Period ended this day
            </button>
          )}
          {current && (
            <button type="button" className={secondaryButton} onClick={() => setConfirming('period')} disabled={busy}>
              Remove this period
            </button>
          )}
        </div>
      </section>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
        className="flex flex-col gap-5"
      >
        <RadioChips legend="Flow" options={FLOWS} labels={FLOW_LABELS} value={flow} onChange={setFlow} noneLabel="None" />
        <CheckboxChips legend="Symptoms" options={SYMPTOMS} labels={SYMPTOM_LABELS} value={symptoms} onChange={setSymptoms} />
        <RadioChips legend="Mood" options={MOODS} labels={MOOD_LABELS} value={mood} onChange={setMood} noneLabel="Not set" />
        <div>
          <label htmlFor={noteId} className="mb-2 block text-sm font-bold">
            Notes
          </label>
          <textarea
            id={noteId}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            maxLength={2000}
            className="w-full resize-y rounded-[var(--radius-sm)] border border-[var(--line-strong)] bg-[var(--panel-strong)] p-3 text-base text-[var(--ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sky)]"
          />
        </div>

        {error && (
          <p role="alert" className="m-0 text-sm font-semibold text-[var(--danger)]">
            {error}
          </p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          {initial ? (
            <button type="button" className={dangerButton} onClick={() => setConfirming('day')} disabled={busy}>
              Delete day
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button type="button" className={secondaryButton} onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className={primaryButton} disabled={busy}>
              Save
            </button>
          </div>
        </div>
      </form>

      {createPortal(
        <>
      <ConfirmDialog
        open={confirming === 'day'}
        title="Delete this day?"
        message={`Removes the flow, symptoms, mood and note logged for ${formatLong(date)}. Period dates aren't changed.`}
        confirmLabel="Delete"
        variant="danger"
        onCancel={() => setConfirming(null)}
        onConfirm={() => {
          setConfirming(null)
          void run(() => repo.deleteDay(date), true)
        }}
      />
      <ConfirmDialog
        open={confirming === 'period' && current !== undefined}
        title="Remove this period?"
        message={
          current
            ? `Removes the period from ${formatLong(current.start)} (${plural(daysBetween(current.start, periodLastDay(current, today)) + 1, 'day')}). Day logs are kept.`
            : ''
        }
        confirmLabel="Remove"
        variant="danger"
        onCancel={() => setConfirming(null)}
        onConfirm={() => {
          setConfirming(null)
          if (current) void run(() => repo.deletePeriod(current.id))
        }}
      />
        </>,
        document.body,
      )}
    </>
  )
}
