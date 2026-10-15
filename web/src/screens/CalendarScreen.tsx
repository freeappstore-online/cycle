import { PageHeader } from '@freeappstore/sdk/ui'
import type { CSSProperties } from 'react'
import { useState } from 'react'
import { DaySheet } from '../components/DaySheet'
import { Drop } from '../components/Drop'
import { EstimateDisclaimer } from '../components/EstimateDisclaimer'
import { secondaryButton } from '../components/buttons'
import { type DayCell, buildMonth, monthOf, monthsBetween, shiftMonth } from '../calendar'
import { useCycleData } from '../data'
import type { ISODate } from '../data/types'
import { formatLong, formatMonth, weekdayNames } from '../dates'
import { FLOW_LABELS } from '../labels'
import { predict, projectedPeriods } from '../predict'

/** Diagonal stripes: the fertile-window pattern, so it isn't told apart by colour alone. */
const FERTILE_PATTERN: CSSProperties = {
  backgroundImage: 'repeating-linear-gradient(135deg, var(--sky-soft) 0 4px, transparent 4px 8px)',
}

export function CalendarScreen({ today }: { today: ISODate }) {
  const [month, setMonth] = useState(() => monthOf(today))
  const [editing, setEditing] = useState<ISODate>()

  const data = useCycleData(
    async (repo) => {
      const [periods, settings, days] = await Promise.all([
        repo.listPeriods(),
        repo.getSettings(),
        repo.listDays({ from: `${month}-01`, to: `${month}-31` }),
      ])
      // Reach a little past the end of the viewed month so estimates near its end show.
      const ahead = Math.max(1, monthsBetween(monthOf(today), month) + 2)
      return {
        periods,
        settings,
        days,
        projected: projectedPeriods(periods, settings, today, ahead),
        confidence: predict(periods, settings, today).confidence,
      }
    },
    [month, today],
  )

  const weekStart = data?.settings.weekStart ?? 1
  const model = data
    ? buildMonth({ month, weekStart, today, lutealLength: data.settings.lutealLength, ...data })
    : undefined

  return (
    <>
      <PageHeader
        title="Calendar"
        description="Logged periods, with estimated ones ahead."
        actions={
          <button
            type="button"
            className={secondaryButton}
            onClick={() => setMonth(monthOf(today))}
            disabled={month === monthOf(today)}
          >
            Jump to today
          </button>
        }
      />

      <div className="mb-3 flex items-center justify-between gap-2">
        <button type="button" className={secondaryButton} onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Previous month">
          <span aria-hidden="true">‹</span>
        </button>
        <h2 className="display-font m-0 text-center text-xl font-semibold" aria-live="polite">
          {formatMonth(month)}
        </h2>
        <button type="button" className={secondaryButton} onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Next month">
          <span aria-hidden="true">›</span>
        </button>
      </div>

      <div aria-hidden="true" className="grid grid-cols-7 gap-1 pb-1 text-center text-xs font-bold text-[var(--muted)]">
        {weekdayNames(weekStart).map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>
      {model ? (
        <ol aria-label={`Days in ${formatMonth(month)}`} className="m-0 grid list-none grid-cols-7 gap-1 p-0">
          {Array.from({ length: model.leading }, (_, i) => (
            <li key={`blank-${i}`} aria-hidden="true" />
          ))}
          {model.days.map((cell) => (
            <li key={cell.date}>
              <DayButton cell={cell} onOpen={() => setEditing(cell.date)} />
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-[var(--muted)]">Loading…</p>
      )}

      <Legend />
      {/* Estimates exist as soon as one period is logged (see the legend). */}
      {data && data.periods.length > 0 && <EstimateDisclaimer confidence={data.confidence} className="mt-2" />}

      <DaySheet date={editing} today={today} onClose={() => setEditing(undefined)} />
    </>
  )
}

export function dayLabel(cell: DayCell): string {
  const parts = [formatLong(cell.date)]
  if (cell.isToday) parts.push('today')
  if (cell.period) parts.push('period')
  if (cell.log?.flow) parts.push(`${FLOW_LABELS[cell.log.flow].toLowerCase()} flow`)
  if (cell.predicted) parts.push('estimated period')
  if (cell.fertile) parts.push('estimated fertile window')
  if (cell.log?.symptoms.length) parts.push('symptoms logged')
  if (cell.log?.mood) parts.push('mood logged')
  if (cell.log?.note) parts.push('has a note')
  return parts.join(', ')
}

function DayButton({ cell, onOpen }: { cell: DayCell; onOpen: () => void }) {
  let look = 'border-[var(--line)] bg-[var(--panel-strong)]'
  if (cell.period) look = 'border-2 border-solid border-[var(--accent)] bg-[var(--accent-soft)]'
  else if (cell.predicted) look = 'border-2 border-dashed border-[var(--accent)] bg-[var(--panel-strong)]'
  else if (cell.fertile) look = 'border border-dotted border-[var(--sky)]'
  const extras = cell.log && (cell.log.symptoms.length > 0 || cell.log.mood)
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={dayLabel(cell)}
      aria-current={cell.isToday ? 'date' : undefined}
      data-period={cell.period || undefined}
      data-predicted={cell.predicted || undefined}
      data-fertile={cell.fertile || undefined}
      className={
        `relative flex aspect-square w-full min-h-10 flex-col items-center justify-center rounded-[var(--radius-sm)] text-sm ${look} ` +
        (cell.isToday ? 'font-extrabold underline decoration-2 underline-offset-4 ring-2 ring-[var(--ink)] ring-offset-1 ring-offset-[var(--paper)] ' : '') +
        (cell.isFuture && !cell.predicted && !cell.fertile ? 'text-[var(--muted)]' : 'text-[var(--ink)]')
      }
      style={cell.fertile ? FERTILE_PATTERN : undefined}
    >
      <span>{cell.day}</span>
      <span aria-hidden="true" className="flex h-3 items-center gap-0.5 text-[0.6rem] leading-none">
        {(cell.period || cell.predicted) && <Drop filled={cell.period} />}
        {extras && <span className="text-[var(--ink)]">●</span>}
        {cell.log?.note && <span className="text-[var(--ink)]">✎</span>}
      </span>
    </button>
  )
}

function Legend() {
  const swatch = 'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-[0.6rem]'
  return (
    <section aria-labelledby="legend-heading" className="mt-4">
      <h3 id="legend-heading" className="sr-only">
        Legend
      </h3>
      <ul className="m-0 grid list-none grid-cols-2 gap-x-4 gap-y-2 p-0 text-sm sm:grid-cols-3">
        <li className="flex items-center gap-2">
          <span aria-hidden="true" className={`${swatch} border-2 border-solid border-[var(--accent)] bg-[var(--accent-soft)]`}>
            <Drop filled />
          </span>
          Period
        </li>
        <li className="flex items-center gap-2">
          <span aria-hidden="true" className={`${swatch} border-2 border-dashed border-[var(--accent)]`}>
            <Drop filled={false} />
          </span>
          Estimated period
        </li>
        <li className="flex items-center gap-2">
          <span aria-hidden="true" className={`${swatch} border border-dotted border-[var(--sky)]`} style={FERTILE_PATTERN} />
          Estimated fertile window
        </li>
        <li className="flex items-center gap-2">
          <span aria-hidden="true" className={`${swatch} font-extrabold underline ring-2 ring-[var(--ink)]`}>
            1
          </span>
          Today
        </li>
        <li className="flex items-center gap-2">
          <span aria-hidden="true" className={`${swatch} border border-[var(--line)]`}>
            ●
          </span>
          Symptoms or mood
        </li>
        <li className="flex items-center gap-2">
          <span aria-hidden="true" className={`${swatch} border border-[var(--line)]`}>
            ✎
          </span>
          Note
        </li>
      </ul>
    </section>
  )
}
