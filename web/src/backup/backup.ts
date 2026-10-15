// JSON backups: exportAll() from #137 plus an export date, either plain or
// encrypted with the sync passphrase in the same envelope format as #141
// (PBKDF2 → AES-256-GCM over gzipped JSON, with a key check). Files are made
// on the device and never uploaded.

import { MIGRATIONS, type Migrations, SCHEMA_VERSION, asVersionedPayload, migratePayload } from '../data/migrations'
import type { CycleExport, ISODate } from '../data/types'
import { validateExport } from '../data/validate'
import { type KdfParams, deriveKey, openJSON, sealJSON, verifyKeyCheck } from '../sync/crypto'

export const PLAIN_FORMAT = 'cycle-backup'
export const ENCRYPTED_FORMAT = 'cycle-backup-encrypted'
const BACKUP_LABEL = 'cycle:backup'

export interface PlainBackup extends CycleExport {
  format: typeof PLAIN_FORMAT
  /** ISO timestamp. */
  exportedAt: string
}

export interface EncryptedBackup extends KdfParams {
  format: typeof ENCRYPTED_FORMAT
  exportedAt: string
  check: string
  /** Sealed PlainBackup. */
  data: string
}

export type BackupFile = { kind: 'plain'; backup: unknown } | { kind: 'encrypted'; backup: EncryptedBackup }

export function makePlainBackup(data: CycleExport, now = new Date()): PlainBackup {
  return { format: PLAIN_FORMAT, exportedAt: now.toISOString(), ...data }
}

export async function makeEncryptedBackup(
  data: CycleExport,
  { key, params, check }: { key: CryptoKey; params: KdfParams; check: string },
  now = new Date(),
): Promise<EncryptedBackup> {
  const plain = makePlainBackup(data, now)
  return {
    format: ENCRYPTED_FORMAT,
    exportedAt: plain.exportedAt,
    ...params,
    check,
    data: await sealJSON(key, plain, BACKUP_LABEL),
  }
}

const NOT_A_BACKUP = "This file isn't a Cycle backup."

/** Parses a chosen file's text. Throws a readable error for anything that isn't a backup. */
export function parseBackupFile(text: string): BackupFile {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error(`${NOT_A_BACKUP} It isn't valid JSON.`)
  }
  if (typeof raw !== 'object' || raw === null) throw new Error(NOT_A_BACKUP)
  const r = raw as Record<string, unknown>
  if (r.format === ENCRYPTED_FORMAT) {
    if (typeof r.data !== 'string' || typeof r.check !== 'string' || typeof r.salt !== 'string' || typeof r.iter !== 'number') {
      throw new Error('This encrypted backup is damaged.')
    }
    return { kind: 'encrypted', backup: raw as EncryptedBackup }
  }
  return { kind: 'plain', backup: raw }
}

/** Decrypts an encrypted backup. Throws WrongPassphraseError for a wrong passphrase. */
export async function decryptBackup(backup: EncryptedBackup, passphrase: string): Promise<unknown> {
  const key = await deriveKey(passphrase, { v: backup.v, alg: backup.alg, kdf: backup.kdf, iter: backup.iter, salt: backup.salt })
  await verifyKeyCheck(key, backup.check)
  try {
    return await openJSON(key, backup.data, BACKUP_LABEL)
  } catch {
    throw new Error('This encrypted backup is damaged.')
  }
}

export interface ImportPreview {
  data: CycleExport
  exportedAt?: string
  days: number
  periods: number
  /** Earliest and latest logged date, if any. */
  from?: ISODate
  to?: ISODate
}

/**
 * Validates a decrypted backup and migrates an older schemaVersion, without
 * writing anything. The result is what importAll() will apply.
 */
export function prepareImport(
  raw: unknown,
  { schemaVersion = SCHEMA_VERSION, migrations = MIGRATIONS }: { schemaVersion?: number; migrations?: Migrations } = {},
): ImportPreview {
  let data: CycleExport
  try {
    data = validateExport(migratePayload(asVersionedPayload(raw), schemaVersion, migrations))
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err)
    throw new Error(why.startsWith('Data is from a newer version') ? why : `${NOT_A_BACKUP} ${why}`)
  }
  const dates = [...data.days.map((d) => d.date), ...data.periods.map((p) => p.start)].sort()
  const exportedAt = (raw as { exportedAt?: unknown }).exportedAt
  return {
    data,
    exportedAt: typeof exportedAt === 'string' ? exportedAt : undefined,
    days: data.days.length,
    periods: data.periods.length,
    from: dates[0],
    to: dates.at(-1),
  }
}

export function backupFileName(today: ISODate, encrypted: boolean): string {
  return `cycle-backup-${today}${encrypted ? '.encrypted' : ''}.json`
}

export function jsonBlob(value: unknown): Blob {
  return new Blob([JSON.stringify(value, null, 1)], { type: 'application/json' })
}
