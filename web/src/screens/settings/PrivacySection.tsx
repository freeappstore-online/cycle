// Settings → Privacy: what is stored where, what FreeAppStore can see, and
// "Delete all data". Keep this in step with the real behaviour of the data
// layer (#137), sync (#141) and the platform analytics loader in index.html.

import { ConfirmDialog } from '@freeappstore/sdk/ui'
import { type ReactNode, useState } from 'react'
import { dangerButton } from '../../components/buttons'
import { ErrorText, useAction } from '../../components/form'
import { useCycleRepo } from '../../data'
import { deleteAllData } from '../../privacy/deleteAll'
import { type SyncEngine, useSyncStatus } from '../../sync'

const card = 'rounded-[var(--radius)] border border-[var(--line)] bg-[var(--panel)] p-4'

function Topic({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h3 className="m-0 text-sm font-bold">{title}</h3>
      <div className="mt-1 flex flex-col gap-1 text-sm text-[var(--muted)]">{children}</div>
    </div>
  )
}

export function PrivacySection({ engine, signedIn }: { engine: SyncEngine; signedIn: boolean }) {
  const repo = useCycleRepo()
  const status = useSyncStatus(engine)
  const [confirming, setConfirming] = useState(false)
  const [done, setDone] = useState(false)
  const action = useAction()
  const needsSignIn = !signedIn && status.enabled

  return (
    <section id="privacy" aria-labelledby="privacy-heading" className={card}>
      <h2 id="privacy-heading" className="m-0 text-base font-bold">
        Privacy
      </h2>
      <div className="mt-3 flex flex-col gap-4">
        <Topic title="On this device">
          <p className="m-0">
            Everything you log (periods, flow, symptoms, mood and notes) and your settings are stored in this browser's
            storage (IndexedDB) on this device. Cycle works without an account and offline.
          </p>
          <p className="m-0">
            If you turn on sync, its settings are kept here too, plus the encryption key if you choose "Remember on
            this device".
          </p>
        </Topic>
        <Topic title="If you turn on sync">
          <p className="m-0">
            Sync is off unless you turn it on. Your data is encrypted on this device (AES-256-GCM, with a key made from
            your passphrase) before it's uploaded. Your FreeAppStore account stores only that encrypted copy, plus the
            non-secret details needed to unlock it with your passphrase (a random salt and an iteration count).
          </p>
          <p className="m-0">
            FreeAppStore can see your account, that you use Cycle, and the size and timing of the encrypted data, but
            not what's in it. Your passphrase never leaves your devices, so it can't be recovered if you forget it.
          </p>
        </Topic>
        <Topic title="Signing in">
          <p className="m-0">
            Signing in uses a FreeAppStore account (through GitHub, Google, Apple or an email link) and is only needed
            for sync.
          </p>
        </Topic>
        <Topic title="Page-view counts">
          <p className="m-0">
            The app loads FreeAppStore's store analytics script. It records page views: which screen you opened (for
            example /calendar), the page that linked here, and the time. They're sent to FreeAppStore without cookies
            and without your account, and held in this browser while you're offline. Nothing you log is ever included.
          </p>
          <p className="m-0">
            FreeAppStore may also use Cloudflare Web Analytics, which doesn't use cookies and reports only aggregate
            visit counts. As with any website, the servers handling these requests see your IP address and browser
            type.
          </p>
        </Topic>
        <Topic title="Backups and PDFs">
          <p className="m-0">Made on this device. They go only where you save or share them.</p>
        </Topic>
        <Topic title="What Cycle doesn't do">
          <p className="m-0">No ads, no tracking cookies, no third-party trackers or SDKs, and nothing you log is sold or shared.</p>
        </Topic>

        <div className="border-t border-[var(--line)] pt-4">
          <h3 className="m-0 text-sm font-bold">Delete all data</h3>
          <p className="mb-0 mt-1 text-sm text-[var(--muted)]">
            Removes everything Cycle has stored on this device and, if you're signed in, the encrypted copy in your
            account. Make a backup first if you might want it back.
          </p>
          {needsSignIn && (
            <p className="mb-0 mt-2 text-sm font-semibold">
              Sync is on, so sign in first (above) to delete the encrypted copy in your account as well.
            </p>
          )}
          {action.error && <ErrorText>{action.error}</ErrorText>}
          {done && (
            <p role="status" className="mb-0 mt-2 text-sm font-semibold">
              All Cycle data was deleted.
            </p>
          )}
          <button
            type="button"
            className={`${dangerButton} mt-3`}
            disabled={action.busy || needsSignIn}
            onClick={() => {
              setDone(false)
              setConfirming(true)
            }}
          >
            Delete all data
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={confirming}
        title="Delete all data?"
        message={
          signedIn
            ? "This deletes everything on this device and the encrypted copy in your account. It can't be undone."
            : "This deletes everything Cycle has stored on this device. It can't be undone."
        }
        confirmLabel="Delete everything"
        variant="danger"
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false)
          void action.run(() => deleteAllData({ repo, engine, signedIn })).then((ok) => setDone(ok))
        }}
      />
    </section>
  )
}
