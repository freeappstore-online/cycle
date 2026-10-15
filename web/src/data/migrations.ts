// Schema versioning. One migration function per version step, applied in two
// places so they can't drift apart:
//   - db.ts runs it over the stored records in onupgradeneeded;
//   - importAll runs it over imported/synced payloads with an older schemaVersion.
//
// To change the stored shape: bump SCHEMA_VERSION, add MIGRATIONS[old] that
// turns a payload at `old` into one at `old + 1`, and add a fixture test.

export const SCHEMA_VERSION = 1

/** A payload at any schema version. Only the current version's records are typed (CycleExport). */
export interface VersionedPayload {
  schemaVersion: number
  days: unknown[]
  periods: unknown[]
  settings: unknown
}

/** Transforms a payload at version N into version N + 1. Must not mutate its input. */
export type Migration = (data: VersionedPayload) => Omit<VersionedPayload, 'schemaVersion'>

/** Keyed by the version a migration upgrades *from*. */
export type Migrations = Readonly<Record<number, Migration>>

export const MIGRATIONS: Migrations = {}

export function migratePayload(
  data: VersionedPayload,
  target: number = SCHEMA_VERSION,
  migrations: Migrations = MIGRATIONS,
): VersionedPayload {
  if (!Number.isInteger(data.schemaVersion) || data.schemaVersion < 1) {
    throw new Error(`Invalid schemaVersion: ${String(data.schemaVersion)}`)
  }
  if (data.schemaVersion > target) {
    throw new Error(
      `Data is from a newer version of Cycle (schema ${data.schemaVersion}, this app reads up to ${target}). Update the app and try again.`,
    )
  }
  let out = data
  while (out.schemaVersion < target) {
    const step = migrations[out.schemaVersion]
    if (!step) throw new Error(`No migration from schema ${out.schemaVersion}`)
    out = { ...step(out), schemaVersion: out.schemaVersion + 1 }
  }
  return out
}

/** Checks the envelope of an untrusted payload (file import, sync download). */
export function asVersionedPayload(raw: unknown): VersionedPayload {
  if (typeof raw !== 'object' || raw === null) throw new Error('Not a Cycle export')
  const r = raw as Record<string, unknown>
  if (typeof r.schemaVersion !== 'number' || !Array.isArray(r.days) || !Array.isArray(r.periods)) {
    throw new Error('Not a Cycle export')
  }
  return { schemaVersion: r.schemaVersion, days: r.days, periods: r.periods, settings: r.settings }
}
