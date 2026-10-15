// First-run introduction: four short, skippable steps. Shown once on a new
// device (re-openable from Settings → About). Skipping never blocks logging.

import { useEffect, useId, useRef, useState } from 'react'
import { useCycleRepo } from '../data'
import type { CycleRepository } from '../data/repository'
import type { ISODate } from '../data/types'
import { newPeriodFrom } from '../periods'
import { markOnboardingSeen, onboardingSeen } from '../privacy/onboarding'
import { primaryButton, secondaryButton } from './buttons'
import { DISCLAIMER } from '../privacy/copy'
import { ErrorText, input } from './form'
import { Sheet } from './Sheet'

const STEPS = 4

/**
 * Opens the introduction on a device that hasn't seen it, unless data is
 * already logged here (e.g. from before the introduction existed).
 */
export function useFirstRun(repo: CycleRepository): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (onboardingSeen()) return
    let live = true
    Promise.all([repo.listPeriods(), repo.listDays({ from: '0000-01-01', to: '9999-12-31' })]).then(
      ([periods, days]) => {
        if (!live) return
        if (periods.length || days.length) markOnboardingSeen()
        else setOpen(true)
      },
      () => {},
    )
    return () => {
      live = false
    }
  }, [repo])
  return [open, setOpen]
}

export function Onboarding({ open, onClose, today }: { open: boolean; onClose: () => void; today: ISODate }) {
  const close = () => {
    markOnboardingSeen()
    onClose()
  }
  return (
    <Sheet open={open} onClose={close} title="Welcome to Cycle">
      {open && <Steps today={today} onDone={close} />}
    </Sheet>
  )
}

function Steps({ today, onDone }: { today: ISODate; onDone: () => void }) {
  const repo = useCycleRepo()
  const [step, setStep] = useState(1)
  const [cycle, setCycle] = useState('')
  const [period, setPeriod] = useState('')
  const [last, setLast] = useState('')
  const [error, setError] = useState<string>()
  /** The last-period date already logged, so going Back and Next again doesn't log it twice. */
  const savedLast = useRef('')
  const heading = useRef<HTMLHeadingElement>(null)
  const ids = { cycle: useId(), period: useId(), last: useId() }

  // Move focus to each new step's heading so screen readers announce it.
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    heading.current?.focus()
  }, [step])

  const saveSetup = async () => {
    const c = cycle.trim() ? Number(cycle) : undefined
    const p = period.trim() ? Number(period) : undefined
    if (c !== undefined && !(Number.isInteger(c) && c >= 15 && c <= 90)) throw new Error('Cycle length should be a whole number from 15 to 90 days.')
    if (p !== undefined && !(Number.isInteger(p) && p >= 1 && p <= 15)) throw new Error('Period length should be a whole number from 1 to 15 days.')
    if (last && last > today) throw new Error("The last period can't start in the future.")
    if (c !== undefined || p !== undefined) await repo.putSettings({ defaultCycleLength: c, defaultPeriodLength: p })
    if (last && last !== savedLast.current) {
      await repo.upsertPeriod(newPeriodFrom(await repo.listPeriods(), last, today, p))
      savedLast.current = last
    }
  }

  const next = async () => {
    setError(undefined)
    if (step === 2) {
      try {
        await saveSetup()
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
        return
      }
    }
    if (step === STEPS) onDone()
    else setStep(step + 1)
  }

  const title = ['', 'Your cycle data stays on this device', 'Optional: a head start', 'Optional: sync between devices', 'About the estimates'][step]

  return (
    <div className="flex flex-col gap-4">
      <p className="m-0 text-xs font-bold text-[var(--ink)]">
        Step {step} of {STEPS}
      </p>
      <h3 ref={heading} tabIndex={-1} className="m-0 text-lg font-bold outline-none">
        {title}
      </h3>

      {step === 1 && (
        <div className="flex flex-col gap-2 text-sm">
          <p className="m-0">
            Everything you log is saved in this browser on this device. You don't need an account, and Cycle works
            offline.
          </p>
          <p className="m-0">
            No ads and no tracking cookies. FreeAppStore counts page views (which screen, not what you log), and
            Cloudflare Web Analytics loads a script from static.cloudflareinsights.com that counts visits in aggregate,
            without cookies. Neither sees what you log. Settings → Privacy explains exactly what is stored where.
          </p>
        </div>
      )}

      {step === 2 && (
        <div className="flex flex-col gap-3 text-sm">
          <p className="m-0">These help the first estimates. Leave anything blank if you're not sure; you can change it later.</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor={ids.cycle} className="mb-1 block font-bold">
                Typical cycle length (days)
              </label>
              <input id={ids.cycle} type="number" inputMode="numeric" min={15} max={90} placeholder="28" value={cycle} onChange={(e) => setCycle(e.target.value)} className={input} />
            </div>
            <div>
              <label htmlFor={ids.period} className="mb-1 block font-bold">
                Typical period length (days)
              </label>
              <input id={ids.period} type="number" inputMode="numeric" min={1} max={15} placeholder="5" value={period} onChange={(e) => setPeriod(e.target.value)} className={input} />
            </div>
          </div>
          <div>
            <label htmlFor={ids.last} className="mb-1 block font-bold">
              When did your last period start?
            </label>
            <input id={ids.last} type="date" max={today} value={last} onChange={(e) => setLast(e.target.value)} className={input} />
          </div>
          {error && <ErrorText>{error}</ErrorText>}
        </div>
      )}

      {step === 3 && (
        <div className="flex flex-col gap-2 text-sm">
          <p className="m-0">
            Sync is off unless you turn it on in Settings. If you do, your data is encrypted on this device with a
            passphrase only you know before it's uploaded to your FreeAppStore account. FreeAppStore stores only the
            encrypted copy and can't read it.
          </p>
          <p className="m-0">
            That also means nobody can recover it if you forget the passphrase. The data on your devices stays yours
            either way.
          </p>
        </div>
      )}

      {step === 4 && (
        <div className="flex flex-col gap-2 text-sm">
          <p className="m-0">
            Predicted periods and fertile windows are estimates from your own logged history. They get better as you
            log more cycles, and they can be wrong, especially when cycles are irregular.
          </p>
          <p className="m-0 font-semibold">{DISCLAIMER}</p>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <button type="button" className={secondaryButton} onClick={onDone}>
          {step === STEPS ? 'Close' : 'Skip introduction'}
        </button>
        <div className="flex gap-2">
          {step > 1 && (
            <button type="button" className={secondaryButton} onClick={() => setStep(step - 1)}>
              Back
            </button>
          )}
          <button type="button" className={primaryButton} onClick={() => void next()}>
            {step === STEPS ? 'Start using Cycle' : step === 2 && (cycle || period || last) ? 'Save and continue' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  )
}
