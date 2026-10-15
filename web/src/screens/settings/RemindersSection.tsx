// Settings → Reminders (#148). Optional, signed-in only; calm "coming soon"
// while the platform's push isn't configured (VAPID key endpoint → 503).

import { useEffect, useId, useState } from 'react'
import { primaryButton } from '../../components/buttons'
import { Busy, ErrorText, input } from '../../components/form'
import { type ReminderService, reminderService, useReminderStatus } from '../../reminders'
import { REMINDER_IDS, type ReminderPrefs } from '../../reminders/plan'

const card = 'rounded-[var(--radius)] border border-[var(--line)] bg-[var(--panel)] p-4'

const LABELS: Record<string, string> = {
  [REMINDER_IDS.periodDue]: 'Period due',
  [REMINDER_IDS.fertile]: 'Fertile window starting',
  [REMINDER_IDS.pill]: 'Pill',
}

export function RemindersSection({ service = reminderService }: { service?: ReminderService }) {
  const status = useReminderStatus(service)
  return (
    <section aria-labelledby="reminders-heading" className={card}>
      <h2 id="reminders-heading" className="m-0 text-base font-bold">
        Reminders
      </h2>
      <Body service={service} status={status} />
    </section>
  )
}

const Note = ({ children }: { children: React.ReactNode }) => (
  <p role="status" className="mb-0 mt-2 text-sm text-[var(--muted)]">
    {children}
  </p>
)

function Body({ service, status }: { service: ReminderService; status: ReturnType<typeof useReminderStatus> }) {
  switch (status.availability) {
    case 'checking':
      return <Note>Checking whether reminders are available…</Note>
    case 'not-configured':
      return (
        <Note>
          Coming soon: reminders when your period is due, when your fertile window starts, and a daily pill reminder.
          They'll arrive as plain notifications that don't say what they're about. Nothing to set up yet.
        </Note>
      )
    case 'unreachable':
      return <Note>Reminders can't be set up right now (you may be offline). Everything else works as usual.</Note>
  }
  if (!status.support.supported) {
    return (
      <Note>
        {status.support.reason === 'requires-home-screen'
          ? 'On iPhone and iPad, add Cycle to your Home Screen and open it from there to get reminders.'
          : "This browser can't show reminders. Logging and estimates work as usual."}
      </Note>
    )
  }
  if (!status.signedIn) {
    return (
      <Note>
        Sign in above to use reminders. The reminder schedule is kept in your account so it can notify you while
        Cycle is closed; your logged data stays on this device either way.
      </Note>
    )
  }
  return <Form service={service} status={status} />
}

function Form({ service, status }: { service: ReminderService; status: ReturnType<typeof useReminderStatus> }) {
  const [prefs, setPrefs] = useState<ReminderPrefs>(status.prefs)
  const [saved, setSaved] = useState(false)
  useEffect(() => setPrefs(status.prefs), [status.prefs])
  const ids = { due: useId(), days: useId(), fertile: useId(), pill: useId(), time: useId(), quiet: useId(), qs: useId(), qe: useId() }
  const set = (patch: Partial<ReminderPrefs>) => {
    setSaved(false)
    setPrefs((p) => ({ ...p, ...patch }))
  }
  const box = 'mt-0.5 h-4 w-4 accent-[var(--accent)]'

  return (
    <form
      className="mt-3 flex flex-col gap-3 text-sm"
      onSubmit={async (e) => {
        e.preventDefault()
        setSaved(await service.savePrefs(prefs))
      }}
    >
      <p className="m-0 text-[var(--muted)]">
        Notifications only say "Check your calendar." They never mention periods, fertility or pills.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input id={ids.due} type="checkbox" className={box} checked={prefs.periodDue} onChange={(e) => set({ periodDue: e.target.checked })} />
        <label htmlFor={ids.due} className="font-bold">
          When my period is due
        </label>
        <label htmlFor={ids.days} className="sr-only">
          How early
        </label>
        <select
          id={ids.days}
          value={prefs.daysBefore}
          disabled={!prefs.periodDue}
          onChange={(e) => set({ daysBefore: Number(e.target.value) })}
          className={`${input} w-auto py-1`}
        >
          {[0, 1, 2, 3, 5, 7].map((n) => (
            <option key={n} value={n}>
              {n === 0 ? 'on the estimated day' : `${n} day${n === 1 ? '' : 's'} before`}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-2">
        <input id={ids.fertile} type="checkbox" className={box} checked={prefs.fertile} onChange={(e) => set({ fertile: e.target.checked })} />
        <label htmlFor={ids.fertile} className="font-bold">
          When my estimated fertile window starts
        </label>
      </div>
      <div className="flex items-center gap-2">
        <input id={ids.pill} type="checkbox" className={box} checked={prefs.pill} onChange={(e) => set({ pill: e.target.checked })} />
        <label htmlFor={ids.pill} className="font-bold">
          Daily pill reminder
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={ids.time} className="font-bold">
          Time of day
        </label>
        <input id={ids.time} type="time" required value={prefs.time} onChange={(e) => set({ time: e.target.value })} className={`${input} w-auto py-1`} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          id={ids.quiet}
          type="checkbox"
          className={box}
          checked={prefs.quietHours !== null}
          onChange={(e) => set({ quietHours: e.target.checked ? { start: '22:00', end: '07:00' } : null })}
        />
        <label htmlFor={ids.quiet} className="font-bold">
          Quiet hours
        </label>
        {prefs.quietHours && (
          <>
            <label htmlFor={ids.qs} className="sr-only">
              Quiet hours start
            </label>
            <input
              id={ids.qs}
              type="time"
              value={prefs.quietHours.start}
              onChange={(e) => set({ quietHours: { ...prefs.quietHours!, start: e.target.value } })}
              className={`${input} w-auto py-1`}
            />
            <span aria-hidden="true">to</span>
            <label htmlFor={ids.qe} className="sr-only">
              Quiet hours end
            </label>
            <input
              id={ids.qe}
              type="time"
              value={prefs.quietHours.end}
              onChange={(e) => set({ quietHours: { ...prefs.quietHours!, end: e.target.value } })}
              className={`${input} w-auto py-1`}
            />
          </>
        )}
      </div>
      <p className="m-0 text-xs text-[var(--muted)]">
        Reminder times are estimates and follow your logged periods. Your account stores only the times, not your
        cycle data.
      </p>
      {status.error && <ErrorText>{status.error}</ErrorText>}
      <Busy busy={status.busy} label="Updating reminders…" />
      {saved && !status.error && (
        <p role="status" className="m-0 font-semibold">
          Reminders saved.
        </p>
      )}
      {status.upcoming.length > 0 && (
        <ul className="m-0 list-none p-0" aria-label="Upcoming reminders">
          {status.upcoming.map((r) => (
            <li key={r.reminderId}>
              {LABELS[r.reminderId] ?? r.reminderId}:{' '}
              {new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(r.nextAt)}
            </li>
          ))}
        </ul>
      )}
      <div>
        <button type="submit" className={primaryButton} disabled={status.busy}>
          Save reminders
        </button>
      </div>
    </form>
  )
}
