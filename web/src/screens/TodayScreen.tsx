import { PageHeader } from '@freeappstore/sdk/ui'
import { useState } from 'react'
import { DaySheet } from '../components/DaySheet'
import { Drop } from '../components/Drop'
import { EstimateDisclaimer } from '../components/EstimateDisclaimer'
import { accentButton, primaryButton, secondaryButton } from '../components/buttons'
import { useCycleData, useCycleRepo } from '../data'
import type { DayLog, ISODate, Period, Settings } from '../data/types'
import { formatDayMonth, formatLong, formatShort, plural } from '../dates'
import { FLOW_LABELS, MOOD_LABELS, SYMPTOM_LABELS } from '../labels'
import { type Prediction, daysBetween, fertileWindowFor, predict, projectedPeriods } from '../predict'
import { cycleDay, newPeriodFrom, periodActionsFor } from '../periods'

const card = 'rounded-[var(--radius)] border border-[var(--line)] bg-[var(--panel)] p-4'

export function TodayScreen({ today }: { today: ISODate }) {
  const repo = useCycleRepo()
  const [editing, setEditing] = useState<ISODate>()
  const [error, setError] = useState<string>()
  const [loadError, setLoadError] = useState<string>()
  const [attempt, setAttempt] = useState(0)
  const data = useCycleData(
    async (r) => {
      const [periods, settings, day] = await Promise.all([r.listPeriods(), r.getSettings(), r.getDay(today)])
      return { periods, settings, day }
    },
    [today, attempt],
    setLoadError,
  )

  const act = (fn: () => Promise<unknown>) => {
    setError(undefined)
    fn().catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
  }

  return (
    <>
      <PageHeader title="Today" description={formatLong(today)} />
      {loadError ? (
        <div>
          <p role="alert">Could not load your logs: {loadError}</p>
          <button type="button" className={secondaryButton} onClick={() => { setLoadError(undefined); setAttempt((value) => value + 1) }}>Retry</button>
        </div>
      ) : !data ? (
        <p className="text-[var(--muted)]">Loading…</p>
      ) : (
        <div className="flex flex-col gap-4">
          <section aria-labelledby="today-status" className={card}>
            <Status
              periods={data.periods}
              today={today}
              onStart={() => act(() => repo.upsertPeriod(newPeriodFrom(data.periods, today, today, data.settings.defaultPeriodLength)))}
              onEnd={(p) => act(() => repo.upsertPeriod({ ...p, end: today }))}
            />
            {error && (
              <p role="alert" className="mb-0 mt-3 text-sm font-semibold text-[var(--danger)]">
                {error}
              </p>
            )}
          </section>

          <section aria-labelledby="today-log" className={card}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 id="today-log" className="m-0 text-base font-bold">
                Today's log
              </h2>
              <button type="button" className={primaryButton} onClick={() => setEditing(today)}>
                {data.day ? 'Edit today' : 'Log today'}
              </button>
            </div>
            <DaySummary day={data.day} />
          </section>

          {data.periods.length > 0 && (
            <Estimate periods={data.periods} settings={data.settings} today={today} />
          )}
        </div>
      )}
      <DaySheet date={editing} today={today} onClose={() => setEditing(undefined)} />
    </>
  )
}

function Status({
  periods,
  today,
  onStart,
  onEnd,
}: {
  periods: Parameters<typeof periodActionsFor>[0]
  today: ISODate
  onStart: () => void
  onEnd: (p: NonNullable<ReturnType<typeof periodActionsFor>['endTarget']>) => void
}) {
  const actions = periodActionsFor(periods, today, today)
  const day = cycleDay(periods, today)
  return (
    <>
      <h2 id="today-status" className="display-font m-0 flex items-center gap-2 text-2xl font-semibold">
        {actions.current ? (
          <>
            <Drop filled className="h-5 w-5" />
            Period day {daysBetween(actions.current.start, today) + 1}
          </>
        ) : day ? (
          `Cycle day ${day}`
        ) : (
          'Welcome to Cycle'
        )}
      </h2>
      {periods.length === 0 && (
        <p className="mb-0 mt-2 text-[var(--muted)]">
          Log the first day of your period to start. If it started earlier, pick that day on the Calendar.
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {actions.canStart && (
          <button type="button" className={accentButton} onClick={onStart}>
            Period started today
          </button>
        )}
        {actions.endTarget && (
          <button type="button" className={secondaryButton} onClick={() => onEnd(actions.endTarget!)}>
            Period ended today
          </button>
        )}
      </div>
    </>
  )
}

function DaySummary({ day }: { day: DayLog | undefined }) {
  if (!day) return <p className="mb-0 mt-2 text-[var(--muted)]">Nothing logged yet today.</p>
  const rows: [string, string][] = []
  if (day.flow) rows.push(['Flow', FLOW_LABELS[day.flow]])
  if (day.symptoms.length) rows.push(['Symptoms', day.symptoms.map((s) => SYMPTOM_LABELS[s]).join(', ')])
  if (day.mood) rows.push(['Mood', MOOD_LABELS[day.mood]])
  if (day.note) rows.push(['Notes', day.note])
  return (
    <dl className="mb-0 mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="font-bold">{k}</dt>
          <dd className="m-0 whitespace-pre-wrap break-words text-[var(--muted)]">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

/** The first estimated fertile window that hasn't ended yet. predict() gives the one before the
 * next period, which is already over late in a cycle. */
function upcomingFertileWindow(periods: Period[], settings: Settings, today: ISODate) {
  return projectedPeriods(periods, settings, today, 3)
    .map((p) => fertileWindowFor(p, settings.lutealLength))
    .find((w) => w.end >= today)
}

function Estimate({ periods, settings, today }: { periods: Period[]; settings: Settings; today: ISODate }) {
  const p: Prediction = predict(periods, settings, today)
  if (!p.nextPeriod) return null
  const fertile = upcomingFertileWindow(periods, settings, today)
  const { start, rangeStart, rangeEnd } = p.nextPeriod
  const until = daysBetween(today, start)
  const headline =
    p.daysLate > 0 ? `${plural(p.daysLate, 'day')} later than estimated` : until === 0 ? 'Could start today' : `In about ${plural(until, 'day')}`

  let basis: string
  if (p.basedOnCycles === 0) basis = "Based on a typical cycle length until you've logged a full cycle, so it's a rough guess."
  else if (p.irregular) basis = `Your cycles vary quite a bit (average ${p.averageCycleLength} days), so the range is wide.`
  else if (p.confidence === 'low') basis = `Based on ${plural(p.basedOnCycles, 'cycle')}. Estimates get better as you log more.`
  else basis = `Based on your last ${plural(p.basedOnCycles, 'cycle')} (average ${p.averageCycleLength} days).`

  return (
    <section aria-labelledby="today-estimate" className={`${card} border-dashed`}>
      <h2 id="today-estimate" className="m-0 flex items-center gap-2 text-base font-bold">
        <Drop filled={false} className="h-4 w-4" />
        Next period <span className="font-normal text-[var(--muted)]">(estimate)</span>
      </h2>
      <p className="display-font mb-1 mt-2 text-2xl font-semibold">{headline}</p>
      <p className="m-0 text-sm">
        Most likely around <strong>{formatShort(start)}</strong>, somewhere between {formatDayMonth(rangeStart)} and{' '}
        {formatDayMonth(rangeEnd)}.
      </p>
      {fertile && (
        <p className="mb-0 mt-2 text-sm">
          Estimated fertile window: {formatDayMonth(fertile.start)} – {formatDayMonth(fertile.end)}
          {fertile.start <= today ? ' (includes today)' : ''}.
        </p>
      )}
      <p className="mb-0 mt-2 text-sm text-[var(--muted)]">{basis}</p>
      <EstimateDisclaimer confidence={p.confidence} className="mt-3" />
    </section>
  )
}
