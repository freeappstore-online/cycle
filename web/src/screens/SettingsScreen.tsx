import type { AuthProvider } from '@freeappstore/sdk'
import { ConfirmDialog, PageHeader } from '@freeappstore/sdk/ui'
import { type FormEvent, type ReactNode, useEffect, useId, useState } from 'react'
import { dangerButton, primaryButton, secondaryButton } from '../components/buttons'
import { fas } from '../fas'
import { SyncEngine, type SyncStatus, syncEngine, useSyncStatus } from '../sync'

/** The parts of fas.auth the screen uses. */
export interface SettingsAuth {
  readonly user: { login: string } | null
  onChange(listener: (user: { login: string } | null) => void): () => void
  signIn(provider?: AuthProvider): void
  signInWithEmail(email: string): Promise<void>
  signOut(): void
}

const card = 'rounded-[var(--radius)] border border-[var(--line)] bg-[var(--panel)] p-4'
const input =
  'w-full rounded-[var(--radius-sm)] border border-[var(--line-strong)] bg-[var(--panel-strong)] px-3 py-2 text-base text-[var(--ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sky)]'
const MIN_PASSPHRASE = 8

const REMEMBER_HELP =
  "Keeps the encryption key (never the passphrase) in this browser, in a form that can't be copied out, so you don't have to type the passphrase each time you open Cycle. Anyone who can use this browser profile could then sync your data, so leave it off on shared devices."

export function SettingsScreen({ engine = syncEngine, auth = fas.auth }: { engine?: SyncEngine; auth?: SettingsAuth }) {
  const [user, setUser] = useState(auth.user)
  useEffect(() => auth.onChange(setUser), [auth])

  return (
    <>
      <PageHeader title="Settings" description="Sync, backup and about." />
      <div className="flex flex-col gap-4">
        <section aria-labelledby="sync-heading" className={card}>
          <h2 id="sync-heading" className="m-0 text-base font-bold">
            Encrypted sync
          </h2>
          <p className="mb-0 mt-2 text-sm text-[var(--muted)]">
            Optional. Cycle works fully on this device without an account. With sync on, your data is encrypted on
            this device with a passphrase only you know before it's uploaded; the server only ever stores the
            encrypted copy.
          </p>
          {user ? <SignedIn engine={engine} auth={auth} login={user.login} /> : <SignedOut engine={engine} auth={auth} />}
        </section>

        <p className="m-0 text-sm text-[var(--muted)]">
          Cycle is a free, MIT-licensed app on{' '}
          <a href="https://freeappstore.online" className="underline">
            FreeAppStore
          </a>
          .
        </p>
      </div>
    </>
  )
}

function SignedOut({ engine, auth }: { engine: SyncEngine; auth: SettingsAuth }) {
  const status = useSyncStatus(engine)
  const emailId = useId()
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string>()

  const sendLink = async (e: FormEvent) => {
    e.preventDefault()
    setError(undefined)
    try {
      await auth.signInWithEmail(email.trim())
      setSent(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="mt-4 flex flex-col gap-4">
      {status.enabled && (
        <p role="status" className="m-0 text-sm font-semibold">
          Sync is paused until you sign in again. Changes are kept on this device.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={secondaryButton} onClick={() => auth.signIn('github')}>
          Sign in with GitHub
        </button>
        <button type="button" className={secondaryButton} onClick={() => auth.signIn('google')}>
          Sign in with Google
        </button>
        <button type="button" className={secondaryButton} onClick={() => auth.signIn('apple')}>
          Sign in with Apple
        </button>
      </div>
      <form onSubmit={sendLink} className="flex flex-col gap-2">
        <label htmlFor={emailId} className="text-sm font-bold">
          Or get a sign-in link by email
        </label>
        <div className="flex flex-wrap gap-2">
          <input
            id={emailId}
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={`${input} min-w-0 flex-1`}
          />
          <button type="submit" className={primaryButton}>
            Email me a link
          </button>
        </div>
        {sent && (
          <p role="status" className="m-0 text-sm">
            Check your inbox for the sign-in link.
          </p>
        )}
        {error && <ErrorText>{error}</ErrorText>}
      </form>
    </div>
  )
}

function SignedIn({ engine, auth, login }: { engine: SyncEngine; auth: SettingsAuth; login: string }) {
  const status = useSyncStatus(engine)
  const [forgot, setForgot] = useState(false)
  return (
    <div className="mt-4 flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="m-0 text-sm">
          Signed in as <strong>{login}</strong>
        </p>
        <button type="button" className={secondaryButton} onClick={() => auth.signOut()}>
          Sign out
        </button>
      </div>
      {forgot ? (
        <ForgotPassphrase engine={engine} onDone={() => setForgot(false)} />
      ) : status.phase === 'off' ? (
        <TurnOn engine={engine} onForgot={() => setForgot(true)} />
      ) : status.phase === 'locked' ? (
        <Unlock engine={engine} status={status} onForgot={() => setForgot(true)} />
      ) : (
        <SyncOn engine={engine} status={status} />
      )}
    </div>
  )
}

/** Runs an async action with busy and error state. */
function useAction() {
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

function PassphraseField({
  label,
  value,
  onChange,
  autoComplete,
  hint,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  autoComplete: 'new-password' | 'current-password'
  hint?: string
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
        minLength={autoComplete === 'new-password' ? MIN_PASSPHRASE : 1}
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

function RememberToggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  const id = useId()
  return (
    <div className="flex items-start gap-2">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        aria-describedby={`${id}-help`}
        className="mt-1 h-4 w-4 accent-[var(--accent)]"
      />
      <div>
        <label htmlFor={id} className="text-sm font-bold">
          Remember on this device
        </label>
        <p id={`${id}-help`} className="m-0 text-xs text-[var(--muted)]">
          {REMEMBER_HELP}
        </p>
      </div>
    </div>
  )
}

const ErrorText = ({ children }: { children: ReactNode }) => (
  <p role="alert" className="m-0 text-sm font-semibold text-[var(--danger)]">
    {children}
  </p>
)

const Busy = ({ busy, label }: { busy: boolean; label: string }) => (
  <p role="status" aria-live="polite" className="m-0 text-sm text-[var(--muted)]">
    {busy ? label : ''}
  </p>
)

/** New passphrase + confirmation. Returns an error message, or undefined if fine. */
function newPassphraseProblem(pass: string, confirm: string): string | undefined {
  if (pass.length < MIN_PASSPHRASE) return `Use at least ${MIN_PASSPHRASE} characters.`
  if (pass !== confirm) return "The passphrases don't match."
}

const NEW_HINT = `At least ${MIN_PASSPHRASE} characters; a few unrelated words is easy to remember and hard to guess. It can't be recovered if you forget it.`

function TurnOn({ engine, onForgot }: { engine: SyncEngine; onForgot: () => void }) {
  const [hasRemote, setHasRemote] = useState<boolean>()
  const [pass, setPass] = useState('')
  const [confirm, setConfirm] = useState('')
  const [remember, setRemember] = useState(false)
  const [problem, setProblem] = useState<string>()
  const action = useAction()

  useEffect(() => {
    let live = true
    engine.remoteExists().then(
      (v) => live && setHasRemote(v),
      () => live && setHasRemote(false),
    )
    return () => {
      live = false
    }
  }, [engine])

  if (hasRemote === undefined) return <p className="m-0 text-sm text-[var(--muted)]">Checking for synced data…</p>

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const p = hasRemote ? undefined : newPassphraseProblem(pass, confirm)
    setProblem(p)
    if (!p) void action.run(() => engine.enable(pass, { remember }))
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <p className="m-0 text-sm">
        {hasRemote
          ? 'This account already has synced Cycle data. Enter its passphrase to sync this device with it.'
          : 'Choose a passphrase. It encrypts your data on this device and never leaves it.'}
      </p>
      <PassphraseField
        label={hasRemote ? 'Passphrase' : 'New passphrase'}
        value={pass}
        onChange={setPass}
        autoComplete={hasRemote ? 'current-password' : 'new-password'}
        hint={hasRemote ? undefined : NEW_HINT}
      />
      {!hasRemote && <PassphraseField label="Confirm passphrase" value={confirm} onChange={setConfirm} autoComplete="new-password" />}
      <RememberToggle checked={remember} onChange={setRemember} />
      {(problem || action.error) && <ErrorText>{problem ?? action.error}</ErrorText>}
      <Busy busy={action.busy} label="Encrypting and syncing…" />
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={primaryButton} disabled={action.busy}>
          Turn on sync
        </button>
        {hasRemote && (
          <button type="button" className={secondaryButton} onClick={onForgot}>
            Forgot passphrase?
          </button>
        )}
      </div>
    </form>
  )
}

function Unlock({ engine, status, onForgot }: { engine: SyncEngine; status: SyncStatus; onForgot: () => void }) {
  const [pass, setPass] = useState('')
  const [remember, setRemember] = useState(status.rememberKey)
  const action = useAction()
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        void action.run(() => engine.enable(pass, { remember }))
      }}
      className="flex flex-col gap-3"
    >
      <p role="status" className="m-0 text-sm font-semibold">
        {status.lockedReason === 'mismatch'
          ? 'Your synced data now uses a different passphrase (it was changed on another device). Enter it to keep syncing.'
          : 'Sync is on. Enter your passphrase to sync this device.'}
      </p>
      <PassphraseField label="Passphrase" value={pass} onChange={setPass} autoComplete="current-password" />
      <RememberToggle checked={remember} onChange={setRemember} />
      {action.error && <ErrorText>{action.error}</ErrorText>}
      <Busy busy={action.busy} label="Unlocking…" />
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={primaryButton} disabled={action.busy}>
          Unlock sync
        </button>
        <button type="button" className={secondaryButton} onClick={onForgot}>
          Forgot passphrase?
        </button>
      </div>
    </form>
  )
}

function syncLine(status: SyncStatus): string {
  if (status.phase === 'syncing') return 'Syncing…'
  if (status.phase === 'error' && status.error) return status.error
  const when = status.lastSyncedAt
    ? `Last synced ${new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(status.lastSyncedAt)}.`
    : 'Not synced yet.'
  return status.pending ? `${when} Changes are waiting to sync.` : when
}

function SyncOn({ engine, status }: { engine: SyncEngine; status: SyncStatus }) {
  const [changing, setChanging] = useState(false)
  const [confirmOff, setConfirmOff] = useState(false)
  const action = useAction()
  return (
    <div className="flex flex-col gap-3">
      <p role="status" className={`m-0 text-sm ${status.phase === 'error' ? 'font-semibold text-[var(--danger)]' : ''}`}>
        <span aria-hidden="true">🔒 </span>Sync is on. {syncLine(status)}
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={secondaryButton} disabled={action.busy || status.phase === 'syncing'} onClick={() => void action.run(() => engine.sync())}>
          Sync now
        </button>
        <button type="button" className={secondaryButton} onClick={() => setChanging((c) => !c)} aria-expanded={changing}>
          Change passphrase
        </button>
        <button type="button" className={dangerButton} onClick={() => setConfirmOff(true)} disabled={action.busy}>
          Turn off sync
        </button>
      </div>
      <RememberToggle checked={status.rememberKey} onChange={(v) => void action.run(() => engine.setRemember(v))} disabled={action.busy} />
      {action.error && status.phase !== 'error' && <ErrorText>{action.error}</ErrorText>}
      {changing && <ChangePassphrase engine={engine} onDone={() => setChanging(false)} />}
      <ConfirmDialog
        open={confirmOff}
        title="Turn off sync?"
        message="This deletes the encrypted copy from the cloud. Everything stays on this device. Other devices keep their own copies but stop syncing."
        confirmLabel="Turn off and delete cloud copy"
        variant="danger"
        onCancel={() => setConfirmOff(false)}
        onConfirm={() => {
          setConfirmOff(false)
          void action.run(() => engine.disable())
        }}
      />
    </div>
  )
}

function ChangePassphrase({ engine, onDone }: { engine: SyncEngine; onDone: () => void }) {
  const [pass, setPass] = useState('')
  const [confirm, setConfirm] = useState('')
  const [problem, setProblem] = useState<string>()
  const action = useAction()
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault()
        const p = newPassphraseProblem(pass, confirm)
        setProblem(p)
        if (!p && (await action.run(() => engine.changePassphrase(pass)))) onDone()
      }}
      className="flex flex-col gap-3 rounded-[var(--radius-sm)] border border-[var(--line)] p-3"
    >
      <p className="m-0 text-sm">Everything is re-encrypted with the new passphrase. Your other devices will ask for it.</p>
      <PassphraseField label="New passphrase" value={pass} onChange={setPass} autoComplete="new-password" hint={NEW_HINT} />
      <PassphraseField label="Confirm new passphrase" value={confirm} onChange={setConfirm} autoComplete="new-password" />
      {(problem || action.error) && <ErrorText>{problem ?? action.error}</ErrorText>}
      <Busy busy={action.busy} label="Re-encrypting…" />
      <div>
        <button type="submit" className={primaryButton} disabled={action.busy}>
          Change passphrase
        </button>
      </div>
    </form>
  )
}

function ForgotPassphrase({ engine, onDone }: { engine: SyncEngine; onDone: () => void }) {
  const [pass, setPass] = useState('')
  const [confirm, setConfirm] = useState('')
  const [remember, setRemember] = useState(false)
  const [problem, setProblem] = useState<string>()
  const [confirming, setConfirming] = useState(false)
  const action = useAction()
  // The SDK ConfirmDialog's buttons have no type, so it sits outside the form.
  return (
    <>
    <form
      onSubmit={(e) => {
        e.preventDefault()
        const p = newPassphraseProblem(pass, confirm)
        setProblem(p)
        if (!p) setConfirming(true)
      }}
      className="flex flex-col gap-3"
    >
      <h3 className="m-0 text-sm font-bold">Forgot your passphrase?</h3>
      <p className="m-0 text-sm">
        Your passphrase never leaves your devices, so nobody, including FreeAppStore, can recover it or read the
        cloud copy. What you can do is erase the cloud copy and upload the data on <em>this</em> device under a new
        passphrase. Anything that only exists on another device won't be included.
      </p>
      <PassphraseField label="New passphrase" value={pass} onChange={setPass} autoComplete="new-password" hint={NEW_HINT} />
      <PassphraseField label="Confirm new passphrase" value={confirm} onChange={setConfirm} autoComplete="new-password" />
      <RememberToggle checked={remember} onChange={setRemember} />
      {(problem || action.error) && <ErrorText>{problem ?? action.error}</ErrorText>}
      <Busy busy={action.busy} label="Erasing and re-uploading…" />
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={dangerButton} disabled={action.busy}>
          Erase cloud copy and re-upload
        </button>
        <button type="button" className={secondaryButton} onClick={onDone}>
          Back
        </button>
      </div>
    </form>
      <ConfirmDialog
        open={confirming}
        title="Erase the cloud copy?"
        message="The encrypted cloud copy is deleted and replaced with this device's data. This can't be undone."
        confirmLabel="Erase and re-upload"
        variant="danger"
        onCancel={() => setConfirming(false)}
        onConfirm={async () => {
          setConfirming(false)
          if (await action.run(() => engine.resetCloud(pass, { remember }))) onDone()
        }}
      />
    </>
  )
}
