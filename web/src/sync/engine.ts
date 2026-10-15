// Optional, end-to-end encrypted sync through fas.kv. Off by default; the app
// works fully without it. Only ciphertext and the KDF metadata leave the device.
//
// A sync is: fetch cycle:meta → check our key against it → fetch and decrypt
// every year → three-way merge into the local database (merge.ts) → upload the
// years that differ from what's stored → delete parts no longer used. Local
// writes schedule a debounced sync; so do sign-in, app open and coming back
// online. While offline, writes just stay in IndexedDB until the next sync.

import { type DBSchema, openDB } from 'idb'
import type { CycleRepository } from '../data/repository'
import { SCHEMA_VERSION, migratePayload } from '../data/migrations'
import type { CycleExport } from '../data/types'
import { validateExport } from '../data/validate'
import {
  KDF_ITERATIONS,
  type KdfParams,
  WrongPassphraseError,
  deriveKey,
  makeKeyCheck,
  newKdfParams,
  openJSON,
  sealJSON,
  sha256,
  verifyKeyCheck,
} from './crypto'
import {
  type Head,
  KEY_PREFIX,
  META_KEY,
  type RemoteMeta,
  type YearPayload,
  checkBudget,
  chunk,
  splitByYear,
  yearKey,
  yearKeys,
  yearLabel,
} from './layout'
import { type BaseIndex, indexOf, overlappingToDrop, planMerge } from './merge'

const HEAD_LABEL = `${KEY_PREFIX}head`

/** The parts of the SDK's fas.kv the engine uses. */
export interface KvLike {
  get<T = unknown>(key: string): Promise<T | null>
  set(key: string, value: unknown): Promise<void>
  delete(key: string): Promise<void>
  list(opts?: { prefix?: string }): Promise<string[]>
}

/** The parts of the SDK's fas.auth the engine uses. */
export interface AuthLike {
  readonly user: unknown
  onChange(listener: () => void): () => void
}

/** What's kept on this device about sync. Never the passphrase. */
export interface SyncState {
  enabled: boolean
  /** Keep the derived key (non-extractable) in IndexedDB so the passphrase isn't asked on every launch. */
  rememberKey: boolean
  params?: KdfParams
  check?: string
  key?: CryptoKey
  /** Item timestamps as of the last successful sync; see merge.ts. */
  base?: BaseIndex
  lastSyncedAt?: number
}

export interface SyncStateStore {
  load(): Promise<SyncState | undefined>
  save(state: SyncState): Promise<void>
}

interface SyncDB extends DBSchema {
  state: { key: string; value: SyncState }
}

/** Sync state in its own IndexedDB database, separate from the data (#137). */
export function idbSyncStateStore(name = 'cycle-sync'): SyncStateStore {
  const db = openDB<SyncDB>(name, 1, { upgrade: (d) => void d.createObjectStore('state') })
  return {
    load: async () => (await db).get('state', 'state'),
    save: async (state) => void (await (await db).put('state', state, 'state')),
  }
}

export function memorySyncStateStore(): SyncStateStore {
  let saved: SyncState | undefined
  return { load: async () => saved, save: async (s) => void (saved = { ...s }) }
}

export type SyncPhase = 'off' | 'signed-out' | 'locked' | 'syncing' | 'error' | 'idle'

export interface SyncStatus {
  phase: SyncPhase
  enabled: boolean
  rememberKey: boolean
  lastSyncedAt?: number
  /** Local changes not yet uploaded (e.g. offline). */
  pending: boolean
  error?: string
  /** Why the passphrase is needed again. */
  lockedReason?: 'no-key' | 'mismatch'
}

export interface SyncEngineOptions {
  repo: CycleRepository
  kv: KvLike
  auth: AuthLike
  store: SyncStateStore
  debounceMs?: number
  iterations?: number
  now?: () => number
}

function isOffline(err: unknown): boolean {
  return (typeof navigator !== 'undefined' && navigator.onLine === false) || err instanceof TypeError
}

export class SyncEngine {
  private readonly o: Required<Omit<SyncEngineOptions, 'debounceMs' | 'iterations' | 'now'>> & {
    debounceMs: number
    iterations: number
    now: () => number
  }
  private state: SyncState = { enabled: false, rememberKey: false }
  private key?: CryptoKey
  private readonly loaded: Promise<void>
  private running?: Promise<void>
  private again = false
  private rewriteNext = false
  private applying = false
  private timer?: ReturnType<typeof setTimeout>
  private pending = false
  private error?: string
  private lockedReason?: SyncStatus['lockedReason']
  private readonly listeners = new Set<() => void>()
  private snapshot: SyncStatus

  constructor(options: SyncEngineOptions) {
    this.o = { debounceMs: 3000, iterations: KDF_ITERATIONS, now: Date.now, ...options }
    this.snapshot = this.computeStatus()
    this.loaded = this.o.store.load().then((s) => {
      if (s) this.state = s
      this.key = s?.key
      this.notify()
    })
  }

  // --- Status -------------------------------------------------------------

  /** A stable snapshot, for useSyncExternalStore. */
  status = (): SyncStatus => this.snapshot

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private get signedIn() {
    return Boolean(this.o.auth.user)
  }

  private computeStatus(): SyncStatus {
    const s = this.state
    let phase: SyncPhase
    if (!s.enabled) phase = 'off'
    else if (!this.signedIn) phase = 'signed-out'
    else if (!this.key) phase = 'locked'
    else if (this.running) phase = 'syncing'
    else if (this.error) phase = 'error'
    else phase = 'idle'
    return {
      phase,
      enabled: s.enabled,
      rememberKey: s.rememberKey,
      lastSyncedAt: s.lastSyncedAt,
      pending: this.pending,
      error: this.error,
      lockedReason: s.enabled && !this.key ? (this.lockedReason ?? 'no-key') : undefined,
    }
  }

  private notify() {
    this.snapshot = this.computeStatus()
    this.listeners.forEach((l) => l())
  }

  private async save() {
    await this.o.store.save({ ...this.state, key: this.state.rememberKey ? this.key : undefined })
  }

  // --- Lifecycle ------------------------------------------------------------

  /** Wires sync to local writes, sign-in, app open and reconnecting. Returns a cleanup function. */
  start(): () => void {
    const quiet = () => {}
    const offRepo = this.o.repo.subscribe(() => {
      if (!this.applying) this.schedule()
    })
    // Fires once straight away with the current user (app open), then on sign-in/out.
    const offAuth = this.o.auth.onChange(() => {
      this.notify()
      if (this.signedIn) this.sync().catch(quiet)
    })
    const online = () => this.sync().catch(quiet)
    window.addEventListener('online', online)
    return () => {
      offRepo()
      offAuth()
      window.removeEventListener('online', online)
      clearTimeout(this.timer)
    }
  }

  /** Debounced sync after a local write. */
  schedule() {
    if (!this.state.enabled) return
    this.pending = true
    this.notify()
    clearTimeout(this.timer)
    this.timer = setTimeout(() => this.sync().catch(() => {}), this.o.debounceMs)
  }

  // --- User actions -----------------------------------------------------------

  /** Whether this account already has synced data (so the passphrase must match it). */
  async remoteExists(): Promise<boolean> {
    return (await this.o.kv.get(META_KEY)) !== null
  }

  /**
   * Turns sync on (or unlocks it again). With existing cloud data the
   * passphrase must match it, or WrongPassphraseError is thrown before anything
   * is written. Without cloud data, this passphrase is set up and everything on
   * this device is uploaded.
   */
  async enable(passphrase: string, { remember }: { remember: boolean }): Promise<void> {
    await this.loaded
    this.requireSignIn()
    const meta = await this.o.kv.get<RemoteMeta>(META_KEY)
    let params: KdfParams
    let key: CryptoKey
    let check: string
    if (meta) {
      params = kdfOf(meta)
      key = await deriveKey(passphrase, params)
      await verifyKeyCheck(key, meta.check)
      check = meta.check
    } else {
      params = newKdfParams(this.o.iterations)
      key = await deriveKey(passphrase, params)
      check = await makeKeyCheck(key)
    }
    // Keep the merge base when unlocking the same sync again; start fresh otherwise.
    const base = this.state.enabled ? this.state.base : undefined
    this.state = { ...this.state, enabled: true, rememberKey: remember, params, check, base }
    this.key = key
    this.lockedReason = undefined
    this.error = undefined
    await this.save()
    this.notify()
    await this.sync()
  }

  async setRemember(remember: boolean): Promise<void> {
    await this.loaded
    this.state = { ...this.state, rememberKey: remember }
    await this.save()
    this.notify()
  }

  /**
   * The unlocked sync key and its KDF metadata, for encrypted backups (#142) in
   * the same envelope format. Undefined when sync is off or locked.
   */
  backupKey(): { key: CryptoKey; params: KdfParams; check: string } | undefined {
    const { enabled, params, check } = this.state
    return enabled && this.key && params && check ? { key: this.key, params, check } : undefined
  }

  /** Re-encrypts everything under a new passphrase. Other devices will ask for it. */
  async changePassphrase(passphrase: string): Promise<void> {
    await this.loaded
    this.requireSignIn()
    if (!this.key) throw new Error('Unlock sync first.')
    await this.sync()
    const params = newKdfParams(this.o.iterations)
    const key = await deriveKey(passphrase, params)
    const check = await makeKeyCheck(key)
    // Swap key and state in one tick so no sync sees half of each.
    this.key = key
    this.state = { ...this.state, params, check }
    const done = this.sync('rewrite')
    await this.save()
    await done
  }

  /**
   * Forgot the passphrase: the cloud copy can't be decrypted, so erase it and
   * upload this device's data under a new passphrase.
   */
  async resetCloud(passphrase: string, { remember }: { remember: boolean }): Promise<void> {
    await this.loaded
    this.requireSignIn()
    await this.deleteCloud()
    this.state = { enabled: false, rememberKey: remember }
    this.key = undefined
    await this.enable(passphrase, { remember })
  }

  /** Turns sync off and deletes every cycle:* key. Local data stays. */
  async disable(): Promise<void> {
    await this.loaded
    this.requireSignIn()
    clearTimeout(this.timer)
    await this.running?.catch(() => {})
    await this.deleteCloud()
    this.state = { enabled: false, rememberKey: false }
    this.key = undefined
    this.pending = false
    this.error = undefined
    this.lockedReason = undefined
    await this.save()
    this.notify()
  }

  private requireSignIn() {
    if (!this.signedIn) throw new Error('Sign in to use sync.')
  }

  private async deleteCloud() {
    const keys = await this.o.kv.list({ prefix: KEY_PREFIX })
    await Promise.all(keys.map((k) => this.o.kv.delete(k)))
  }

  private async lock(reason: SyncStatus['lockedReason']) {
    this.key = undefined
    this.lockedReason = reason
    await this.save()
  }

  // --- Sync ---------------------------------------------------------------------

  /** Runs a sync (or joins the one in progress, then runs again). Rejects with the failure. */
  sync(mode: 'normal' | 'rewrite' = 'normal'): Promise<void> {
    if (mode === 'rewrite') this.rewriteNext = true
    if (this.running) {
      this.again = true
      return this.running
    }
    this.running = (async () => {
      await this.loaded
      try {
        do {
          this.again = false
          const rewrite = this.rewriteNext
          this.rewriteNext = false
          await this.runOnce(rewrite ? 'rewrite' : 'normal')
        } while (this.again || this.rewriteNext)
      } finally {
        this.running = undefined
        this.notify()
      }
    })()
    this.notify()
    return this.running
  }

  private async runOnce(mode: 'normal' | 'rewrite') {
    clearTimeout(this.timer)
    const { kv } = this.o
    // Captured once, so a passphrase change mid-run can't mix old and new keys.
    const key = this.key
    const params = this.state.params
    const check = this.state.check
    if (!this.state.enabled || !key || !params || !check || !this.signedIn) {
      this.pending = this.state.enabled
      return
    }
    try {
      const meta = await kv.get<RemoteMeta>(META_KEY)
      let remote: CycleExport | undefined
      let remoteHead = ''
      const remoteYears = new Map<string, { hash: string; parts: string[] }>()

      if (meta && mode === 'normal') {
        if (meta.salt !== params.salt || meta.check !== check) {
          try {
            await verifyKeyCheck(key, meta.check)
          } catch (err) {
            if (!(err instanceof WrongPassphraseError)) throw err
            // Changed on another device (or another account): ask again, write nothing.
            await this.lock('mismatch')
            return
          }
        }
        const head = await openJSON<Head>(key, meta.head, HEAD_LABEL)
        remoteHead = JSON.stringify(head)
        const days: unknown[] = []
        const periods: unknown[] = []
        for (const [year, count] of Object.entries(meta.years)) {
          const parts = await Promise.all(Array.from({ length: count }, (_, i) => kv.get<string>(yearKey(year, i))))
          if (parts.some((p) => typeof p !== 'string')) throw new Error('Synced data is incomplete; will retry.')
          const payload = await openJSON<YearPayload>(key, (parts as string[]).join(''), yearLabel(year))
          remoteYears.set(year, { hash: await sha256(JSON.stringify(payload)), parts: parts as string[] })
          days.push(...payload.days)
          periods.push(...payload.periods)
        }
        remote = validateExport(
          migratePayload({ schemaVersion: head.schemaVersion, days, periods, settings: head.settings }),
        )
      }

      let local = await this.o.repo.exportAll()
      if (remote) {
        await this.applyMerge(local, remote)
        local = await this.o.repo.exportAll()
      }
      await this.upload({ key, params, check }, local, meta, remoteYears, remoteHead, mode === 'rewrite')

      this.state = { ...this.state, base: indexOf(local), lastSyncedAt: this.o.now() }
      await this.save()
      this.pending = false
      this.error = undefined
    } catch (err) {
      this.pending = true
      this.error = isOffline(err)
        ? "You're offline. Changes are saved on this device and will sync when you're back online."
        : err instanceof Error
          ? err.message
          : String(err)
      throw err
    }
  }

  private async applyMerge(local: CycleExport, remote: CycleExport) {
    const { repo } = this.o
    const plan = planMerge(local, remote, this.state.base)
    this.applying = true
    try {
      if (plan.putDays.length || plan.putPeriods.length || plan.settings) {
        await repo.importAll(
          {
            schemaVersion: SCHEMA_VERSION,
            days: plan.putDays,
            periods: plan.putPeriods,
            settings: plan.settings ?? local.settings,
          },
          { mode: 'merge' },
        )
      }
      for (const date of plan.deleteDays) await repo.deleteDay(date)
      for (const id of plan.deletePeriods) await repo.deletePeriod(id)
      for (const id of overlappingToDrop(await repo.listPeriods())) await repo.deletePeriod(id)
    } finally {
      this.applying = false
    }
  }

  private async upload(
    { key, params, check }: { key: CryptoKey; params: KdfParams; check: string },
    local: CycleExport,
    meta: RemoteMeta | null,
    remoteYears: Map<string, { hash: string; parts: string[] }>,
    remoteHead: string,
    rewrite: boolean,
  ) {
    const writes = new Map<string, unknown>()
    const all = new Map<string, unknown>()
    const years: Record<string, number> = {}

    for (const [year, payload] of splitByYear(local)) {
      const existing = remoteYears.get(year)
      if (!rewrite && existing && existing.hash === (await sha256(JSON.stringify(payload)))) {
        years[year] = existing.parts.length
        existing.parts.forEach((p, i) => all.set(yearKey(year, i), p))
        continue
      }
      const parts = chunk(await sealJSON(key, payload, yearLabel(year)))
      years[year] = parts.length
      parts.forEach((p, i) => {
        writes.set(yearKey(year, i), p)
        all.set(yearKey(year, i), p)
      })
    }

    const head: Head = { schemaVersion: SCHEMA_VERSION, settings: local.settings }
    const headSame = !rewrite && meta && remoteHead === JSON.stringify(head)
    const newMeta: RemoteMeta = {
      ...params,
      check,
      head: headSame ? meta.head : await sealJSON(key, head, HEAD_LABEL),
      years,
    }
    all.set(META_KEY, newMeta)
    checkBudget(all)

    const metaChanged = !meta || JSON.stringify(meta) !== JSON.stringify(newMeta)
    if (writes.size === 0 && !metaChanged) return
    // Year blobs first, then the meta that points at them, then cleanup.
    await Promise.all([...writes].map(([k, v]) => this.o.kv.set(k, v)))
    if (metaChanged) await this.o.kv.set(META_KEY, newMeta)
    const stale = meta ? yearKeys(meta.years).filter((k) => !all.has(k)) : []
    await Promise.all(stale.map((k) => this.o.kv.delete(k)))
  }
}

function kdfOf(meta: RemoteMeta): KdfParams {
  return { v: meta.v, alg: meta.alg, kdf: meta.kdf, iter: meta.iter, salt: meta.salt }
}
