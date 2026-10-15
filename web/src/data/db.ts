// IndexedDB schema and upgrade path. The IndexedDB version *is* the schema
// version, so onupgradeneeded fires exactly when stored data needs migrating.

import { type DBSchema, type IDBPDatabase, type IDBPTransaction, openDB } from 'idb'
import { MIGRATIONS, type Migrations, SCHEMA_VERSION, migratePayload } from './migrations'
import type { DayLog, Period, Settings } from './types'

export const DB_NAME = 'cycle'
export const SETTINGS_KEY = 'settings'

export interface CycleDB extends DBSchema {
  /** Keyed by date. */
  days: { key: string; value: DayLog }
  periods: { key: string; value: Period; indexes: { start: string } }
  /** A single record under SETTINGS_KEY. */
  settings: { key: string; value: Settings }
  /** schemaVersion, persistRequested. */
  meta: { key: string; value: unknown }
}

export type StoreName = 'days' | 'periods' | 'settings' | 'meta'
export const DATA_STORES = ['days', 'periods', 'settings'] as const

type UpgradeTx = IDBPTransaction<CycleDB, StoreName[], 'versionchange'>

export interface OpenOptions {
  name?: string
  version?: number
  migrations?: Migrations
}

export async function openCycleDB({
  name = DB_NAME,
  version = SCHEMA_VERSION,
  migrations = MIGRATIONS,
}: OpenOptions = {}): Promise<IDBPDatabase<CycleDB>> {
  let migrationError: unknown
  try {
    return await openDB<CycleDB>(name, version, {
      upgrade(db, oldVersion, newVersion, tx) {
        // Structural changes are idempotent "create if missing", so they don't
        // need to be keyed by version until a store or index is removed.
        if (!db.objectStoreNames.contains('days')) db.createObjectStore('days', { keyPath: 'date' })
        if (!db.objectStoreNames.contains('periods')) {
          db.createObjectStore('periods', { keyPath: 'id' }).createIndex('start', 'start')
        }
        if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings')
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta')

        const target = newVersion ?? version
        // openDB itself rejects if the upgrade aborts; these handlers just keep
        // the transaction's own promises from surfacing as unhandled.
        tx.done.catch(() => {})
        tx.objectStore('meta').put(target, 'schemaVersion').catch(() => {})
        if (oldVersion > 0 && oldVersion < target) {
          migrateStoredData(tx, oldVersion, target, migrations).catch((err: unknown) => {
            migrationError = err
            tx.abort()
          })
        }
      },
    })
  } catch (err) {
    throw migrationError ?? err
  }
}

/** Reads every record, runs the payload migrations, and writes the result back, inside the upgrade transaction. */
async function migrateStoredData(tx: UpgradeTx, from: number, to: number, migrations: Migrations) {
  const [days, periods, settings] = await Promise.all([
    tx.objectStore('days').getAll(),
    tx.objectStore('periods').getAll(),
    tx.objectStore('settings').get(SETTINGS_KEY),
  ])
  const migrated = migratePayload({ schemaVersion: from, days, periods, settings }, to, migrations)
  await Promise.all(DATA_STORES.map((s) => tx.objectStore(s).clear()))
  await Promise.all([
    ...migrated.days.map((d) => tx.objectStore('days').put(d as DayLog)),
    ...migrated.periods.map((p) => tx.objectStore('periods').put(p as Period)),
    migrated.settings === undefined
      ? Promise.resolve()
      : tx.objectStore('settings').put(migrated.settings as Settings, SETTINGS_KEY),
  ])
}
