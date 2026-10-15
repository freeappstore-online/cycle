// Settings → Backup: download a JSON backup (encrypted with the sync
// passphrase when sync is unlocked, plain otherwise) and restore one.

import { ConfirmDialog } from '@freeappstore/sdk/ui'
import { type ChangeEvent, useId, useState } from 'react'
import {
  type BackupFile,
  type ImportPreview,
  backupFileName,
  decryptBackup,
  jsonBlob,
  makeEncryptedBackup,
  makePlainBackup,
  parseBackupFile,
  prepareImport,
} from '../../backup/backup'
import { canShareFiles, downloadBlob, shareBlob } from '../../backup/files'
import { primaryButton, secondaryButton } from '../../components/buttons'
import { Busy, ErrorText, PassphraseField, useAction } from '../../components/form'
import { useCycleRepo } from '../../data'
import type { ImportMode, ISODate } from '../../data/types'
import { formatLong } from '../../dates'
import { type SyncEngine, useSyncStatus } from '../../sync'

const card = 'rounded-[var(--radius)] border border-[var(--line)] bg-[var(--panel)] p-4'

export function BackupSection({ engine, today }: { engine: SyncEngine; today: ISODate }) {
  return (
    <section aria-labelledby="backup-heading" className={card}>
      <h2 id="backup-heading" className="m-0 text-base font-bold">
        Backup
      </h2>
      <p className="mb-0 mt-2 text-sm text-[var(--muted)]">
        A file with all your data, made on this device. Keep it somewhere safe; restore it here or on another device.
      </p>
      <ExportBackup engine={engine} today={today} />
      <hr className="my-4 border-0 border-t border-[var(--line)]" />
      <ImportBackup />
    </section>
  )
}

function ExportBackup({ engine, today }: { engine: SyncEngine; today: ISODate }) {
  const repo = useCycleRepo()
  // Re-render when sync locks or unlocks; the key for encrypted backups comes with it.
  useSyncStatus(engine)
  const canEncrypt = engine.backupKey() !== undefined
  const [choice, setChoice] = useState<'encrypted' | 'plain'>()
  const encrypted = (choice ?? (canEncrypt ? 'encrypted' : 'plain')) === 'encrypted' && canEncrypt
  const action = useAction()
  const share = canShareFiles()
  const name = useId()

  const make = async () => {
    const data = await repo.exportAll()
    const key = engine.backupKey()
    if (encrypted && !key) throw new Error('Sync is locked. Unlock it above, or make a plain backup.')
    return jsonBlob(encrypted ? await makeEncryptedBackup(data, key!) : makePlainBackup(data))
  }
  const file = backupFileName(today, encrypted)

  return (
    <div className="mt-4 flex flex-col gap-3">
      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className="mb-1 p-0 text-sm font-bold">Backup type</legend>
        <label className={`flex items-start gap-2 text-sm ${canEncrypt ? '' : 'opacity-60'}`}>
          <input type="radio" name={name} className="mt-1" checked={encrypted} disabled={!canEncrypt} onChange={() => setChoice('encrypted')} />
          <span>
            <strong>Encrypted</strong> with your sync passphrase (recommended).
            {!canEncrypt && ' Available when sync is on and unlocked.'}
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="radio" name={name} className="mt-1" checked={!encrypted} onChange={() => setChoice('plain')} />
          <span>
            <strong>Plain JSON.</strong> Anyone who has the file can read it.
          </span>
        </label>
      </fieldset>
      {action.error && <ErrorText>{action.error}</ErrorText>}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={primaryButton} disabled={action.busy} onClick={() => void action.run(async () => downloadBlob(await make(), file))}>
          Download backup
        </button>
        {share && (
          <button
            type="button"
            className={secondaryButton}
            disabled={action.busy}
            onClick={() => void action.run(async () => shareBlob(await make(), file, 'Cycle backup'))}
          >
            Share backup
          </button>
        )}
      </div>
    </div>
  )
}

type Step =
  | { step: 'choose' }
  | { step: 'passphrase'; file: Extract<BackupFile, { kind: 'encrypted' }> }
  | { step: 'preview'; preview: ImportPreview }
  | { step: 'done'; message: string }

function ImportBackup() {
  const repo = useCycleRepo()
  const fileId = useId()
  const modeName = useId()
  const [state, setState] = useState<Step>({ step: 'choose' })
  const [pass, setPass] = useState('')
  const [mode, setMode] = useState<ImportMode>('merge')
  const [confirming, setConfirming] = useState(false)
  const action = useAction()

  const reset = () => {
    setState({ step: 'choose' })
    setPass('')
    setMode('merge')
  }

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    void action.run(async () => {
      const parsed = parseBackupFile(await file.text())
      if (parsed.kind === 'encrypted') setState({ step: 'passphrase', file: parsed })
      else setState({ step: 'preview', preview: prepareImport(parsed.backup) })
    })
  }

  const apply = () =>
    action.run(async () => {
      if (state.step !== 'preview') return
      // importAll validates again and writes in one transaction: all or nothing.
      await repo.importAll(state.preview.data, { mode })
      setState({
        step: 'done',
        message: mode === 'replace' ? 'Backup restored. It replaced the data on this device.' : 'Backup merged into the data on this device.',
      })
    })

  return (
    <div className="flex flex-col gap-3">
      <h3 className="m-0 text-sm font-bold">Restore a backup</h3>
      {state.step === 'choose' && (
        <div>
          <label htmlFor={fileId} className="mb-1 block text-sm">
            Choose a Cycle backup file (.json)
          </label>
          <input id={fileId} type="file" accept="application/json,.json" onChange={onFile} className="block w-full text-sm" />
        </div>
      )}

      {state.step === 'passphrase' && (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            void action.run(async () => {
              const raw = await decryptBackup(state.file.backup, pass)
              setState({ step: 'preview', preview: prepareImport(raw) })
            })
          }}
        >
          <p className="m-0 text-sm">This backup is encrypted. Enter the sync passphrase it was made with.</p>
          <PassphraseField label="Backup passphrase" value={pass} onChange={setPass} autoComplete="current-password" />
          <Busy busy={action.busy} label="Decrypting…" />
          <div className="flex gap-2">
            <button type="submit" className={primaryButton} disabled={action.busy}>
              Decrypt
            </button>
            <button type="button" className={secondaryButton} onClick={reset}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {state.step === 'preview' && (
        <div className="flex flex-col gap-3">
          <p role="status" className="m-0 text-sm">
            {describe(state.preview)}
          </p>
          <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
            <legend className="mb-1 p-0 text-sm font-bold">How to restore</legend>
            <label className="flex items-start gap-2 text-sm">
              <input type="radio" name={modeName} className="mt-1" checked={mode === 'merge'} onChange={() => setMode('merge')} />
              <span>
                <strong>Merge</strong> with what's on this device. For each day, the most recently edited version is kept.
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input type="radio" name={modeName} className="mt-1" checked={mode === 'replace'} onChange={() => setMode('replace')} />
              <span>
                <strong>Replace</strong> everything on this device with the backup.
              </span>
            </label>
          </fieldset>
          <div className="flex gap-2">
            <button type="button" className={primaryButton} disabled={action.busy} onClick={() => setConfirming(true)}>
              Restore
            </button>
            <button type="button" className={secondaryButton} onClick={reset}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {state.step === 'done' && (
        <div className="flex flex-col gap-2">
          <p role="status" className="m-0 text-sm font-semibold">
            {state.message}
          </p>
          <div>
            <button type="button" className={secondaryButton} onClick={reset}>
              Done
            </button>
          </div>
        </div>
      )}

      {action.error && <ErrorText>{action.error}</ErrorText>}

      <ConfirmDialog
        open={confirming}
        title={mode === 'replace' ? 'Replace all data?' : 'Merge this backup?'}
        message={
          mode === 'replace'
            ? "Everything on this device is replaced by the backup. If sync is on, the change syncs too. This can't be undone."
            : 'Days and periods from the backup are added; where both have the same day, the most recently edited version is kept.'
        }
        confirmLabel={mode === 'replace' ? 'Replace' : 'Merge'}
        variant={mode === 'replace' ? 'danger' : 'default'}
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false)
          void apply()
        }}
      />
    </div>
  )
}

function describe(p: ImportPreview): string {
  const made = p.exportedAt ? `Backup from ${formatLong(p.exportedAt.slice(0, 10))}: ` : 'Backup: '
  const counts = `${p.days} logged day${p.days === 1 ? '' : 's'} and ${p.periods} period${p.periods === 1 ? '' : 's'}`
  const span = p.from && p.to ? `, ${formatLong(p.from)} to ${formatLong(p.to)}` : ''
  return `${made}${counts}${span}.`
}
