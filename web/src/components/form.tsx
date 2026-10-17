// Small form pieces shared by the Settings sections.

import { type ReactNode, useId, useState } from 'react'

export const input =
  'w-full rounded-[var(--radius-sm)] border border-[var(--muted)] bg-[var(--panel-strong)] px-3 py-2 text-base text-[var(--ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sky)]'

/** Runs an async action with busy and error state. */
export function useAction() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    setError(undefined)
    try {
      await fn()
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      return false
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, run }
}

export function PassphraseField({
  label,
  value,
  onChange,
  autoComplete,
  hint,
  minLength = 8,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  autoComplete: 'new-password' | 'current-password'
  hint?: string
  minLength?: number
}) {
  const id = useId()
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-bold">
        {label}
      </label>
      <input
        id={id}
        type="password"
        required
        minLength={autoComplete === 'new-password' ? minLength : 1}
        autoComplete={autoComplete}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className={input}
      />
      {hint && (
        <p id={`${id}-hint`} className="mb-0 mt-1 text-xs text-[var(--muted)]">
          {hint}
        </p>
      )}
    </div>
  )
}

export const ErrorText = ({ children }: { children: ReactNode }) => (
  <p role="alert" className="m-0 text-sm font-semibold text-[var(--danger)]">
    {children}
  </p>
)

export const Busy = ({ busy, label }: { busy: boolean; label: string }) => (
  <p role="status" aria-live="polite" className="m-0 text-sm text-[var(--muted)]">
    {busy ? label : ''}
  </p>
)
