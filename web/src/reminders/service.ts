// Reminders via fas.push (#148): period due, fertile window starting, and a
// daily pill reminder. Optional, signed-in only (the schedule lives on the
// server so it can fire while the app is closed); logging stays local.
//
// The platform's push may not be configured yet: GET /v1/push/vapid-public-key
// answers 503 until the VAPID keys are set. The service checks that first, so
// it never asks for notification permission (or shows an error) when push
// can't work; the UI shows a calm "coming soon" state instead.

import {
  type PushIsSupported,
  PushNotConfiguredError,
  PushNotSignedInError,
  PushNotSupportedError,
  PushPermissionDeniedError,
  type PushReminder,
  type PushScheduleOptions,
  type PushWhen,
} from '@freeappstore/sdk'
import type { CycleRepository } from '../data/repository'
import { ALL_REMINDER_IDS, DEFAULT_PREFS, type ReminderPrefs, anyEnabled, planReminders } from './plan'

/** The parts of fas.push the service uses. */
export interface PushLike {
  isSupported(): PushIsSupported
  subscribe(): Promise<void>
  unsubscribe(): Promise<void>
  schedule(reminderId: string, when: PushWhen, opts?: PushScheduleOptions): Promise<PushReminder>
  cancel(reminderId: string): Promise<void>
  list(): Promise<PushReminder[]>
}

export interface AuthLike {
  readonly user: unknown
  onChange(listener: () => void): () => void
}

/** 'checking' until the platform has answered whether push is configured. */
export type Availability = 'checking' | 'available' | 'not-configured' | 'unreachable'

export interface ReminderStatus {
  availability: Availability
  support: PushIsSupported
  signedIn: boolean
  prefs: ReminderPrefs
  busy: boolean
  /** Upcoming reminders as the server has them. */
  upcoming: PushReminder[]
  /** A message for the user; never set for "not configured". */
  error?: string
}

interface Stored {
  prefs: ReminderPrefs
  /** This device is registered with fas.push. */
  subscribed: boolean
  /** What was last scheduled per id, to skip identical requests. */
  sent: Record<string, string>
}

const STORAGE_KEY = 'cycle:reminders'

export interface ReminderServiceOptions {
  push: PushLike
  repo: CycleRepository
  auth: AuthLike
  apiBase?: string
  fetch?: typeof fetch
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
  now?: () => Date
  debounceMs?: number
}

/** Asks the platform whether push is configured, without ever throwing. */
export async function checkAvailability(apiBase: string, fetchFn: typeof fetch): Promise<Availability> {
  try {
    const res = await fetchFn(new URL('/v1/push/vapid-public-key', apiBase))
    if (res.status === 503) return 'not-configured'
    return res.ok ? 'available' : 'unreachable'
  } catch {
    return 'unreachable'
  }
}

export class ReminderService {
  private readonly o: Required<Omit<ReminderServiceOptions, 'storage'>> & { storage?: ReminderServiceOptions['storage'] }
  private stored: Stored
  private availability: Availability = 'checking'
  private busy = false
  private upcoming: PushReminder[] = []
  private error?: string
  private snapshot: ReminderStatus
  private readonly listeners = new Set<() => void>()
  private timer?: ReturnType<typeof setTimeout>
  private chain: Promise<unknown> = Promise.resolve()

  constructor(options: ReminderServiceOptions) {
    this.o = {
      apiBase: 'https://api.freeappstore.online',
      fetch: (...args) => fetch(...args),
      now: () => new Date(),
      debounceMs: 2000,
      ...options,
    }
    this.stored = this.load()
    this.snapshot = this.compute()
  }

  // --- Status ---------------------------------------------------------------

  status = (): ReminderStatus => this.snapshot

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private compute(): ReminderStatus {
    return {
      availability: this.availability,
      support: this.o.push.isSupported(),
      signedIn: Boolean(this.o.auth.user),
      prefs: this.stored.prefs,
      busy: this.busy,
      upcoming: this.upcoming,
      error: this.error,
    }
  }

  private notify() {
    this.snapshot = this.compute()
    this.listeners.forEach((l) => l())
  }

  // --- Storage ----------------------------------------------------------------

  private get storage() {
    if (this.o.storage) return this.o.storage
    return typeof localStorage === 'undefined' ? undefined : localStorage
  }

  private load(): Stored {
    try {
      const raw = this.storage?.getItem(STORAGE_KEY)
      if (raw) {
        const s = JSON.parse(raw) as Partial<Stored>
        return { prefs: { ...DEFAULT_PREFS, ...s.prefs }, subscribed: Boolean(s.subscribed), sent: s.sent ?? {} }
      }
    } catch {
      // Unreadable or blocked storage: start from defaults.
    }
    return { prefs: { ...DEFAULT_PREFS }, subscribed: false, sent: {} }
  }

  private save() {
    try {
      this.storage?.setItem(STORAGE_KEY, JSON.stringify(this.stored))
    } catch {
      // Blocked storage: reminders still work for this session.
    }
  }

  // --- Lifecycle --------------------------------------------------------------

  /** Checks availability and keeps reminders in step with logged data and sign-in. */
  start(): () => void {
    void this.refreshAvailability().then(() => this.resync())
    const offRepo = this.o.repo.subscribe(() => this.scheduleResync())
    const offAuth = this.o.auth.onChange(() => {
      this.notify()
      void this.resync()
    })
    return () => {
      offRepo()
      offAuth()
      clearTimeout(this.timer)
    }
  }

  async refreshAvailability(): Promise<Availability> {
    this.availability = await checkAvailability(this.o.apiBase, this.o.fetch)
    this.notify()
    return this.availability
  }

  /** Debounced: logging a period moves the period-due and fertile reminders. */
  scheduleResync() {
    if (!this.stored.subscribed || !anyEnabled(this.stored.prefs)) return
    clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.resync(), this.o.debounceMs)
  }

  // --- Actions ------------------------------------------------------------------

  /**
   * Saves the user's choices (call from a button tap: turning the first
   * reminder on asks for notification permission). Never throws; problems
   * end up in `status().error`, and "push not configured" in `availability`.
   */
  async savePrefs(prefs: ReminderPrefs): Promise<boolean> {
    return this.serial(async () => {
      if (this.availability !== 'available' && (await this.refreshAvailability()) !== 'available') return false
      try {
        if (anyEnabled(prefs) && !this.stored.subscribed) {
          await this.o.push.subscribe()
          this.stored.subscribed = true
        }
        this.stored.prefs = { ...prefs }
        this.save()
        await this.apply(true)
        if (!anyEnabled(prefs) && this.stored.subscribed) {
          await this.o.push.unsubscribe()
          this.stored.subscribed = false
          this.save()
        }
        return true
      } catch (err) {
        this.handle(err)
        return false
      }
    })
  }

  /** Saves inactive preferences without permission prompts or push calls. */
  async saveLocalPrefs(prefs: ReminderPrefs): Promise<boolean> {
    return this.serial(async () => {
      try {
        const storage = this.storage
        if (!storage) throw new Error('Storage unavailable')
        const next = { ...this.stored, prefs: { ...prefs } }
        storage.setItem(STORAGE_KEY, JSON.stringify(next))
        this.stored = next
        return true
      } catch {
        this.error = "Couldn't save reminder preferences on this device. Please try again."
        return false
      }
    })
  }

  /** Re-plans from the latest data (no permission prompt). Never throws. */
  async resync(): Promise<void> {
    await this.serial(async () => {
      if (this.availability !== 'available' || !this.o.auth.user || !this.stored.subscribed) return
      try {
        await this.apply(false)
      } catch (err) {
        this.handle(err)
      }
    })
  }

  /** Cancels every reminder and unregisters this device (used by "Delete all data"). */
  async clearAll(): Promise<void> {
    await this.serial(async () => {
      if (this.o.auth.user && this.stored.subscribed) {
        for (const id of ALL_REMINDER_IDS) await this.o.push.cancel(id)
        await this.o.push.unsubscribe()
      }
      this.stored = { prefs: { ...DEFAULT_PREFS }, subscribed: false, sent: {} }
      this.upcoming = []
      this.storage?.removeItem(STORAGE_KEY)
    })
  }

  // --- Internals ------------------------------------------------------------------

  /** Runs one action at a time, with the busy flag up. */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(async () => {
      this.busy = true
      this.error = undefined
      this.notify()
      try {
        return await fn()
      } finally {
        this.busy = false
        this.notify()
      }
    })
    this.chain = run.catch(() => {})
    return run
  }

  private async apply(force: boolean) {
    const { repo, push } = this.o
    const plan = planReminders(this.stored.prefs, await repo.listPeriods(), await repo.getSettings(), this.o.now())
    for (const r of plan.schedule) {
      const key = JSON.stringify([r.when, r.opts ?? null])
      if (!force && this.stored.sent[r.id] === key) continue
      await push.schedule(r.id, r.when, r.opts)
      this.stored.sent[r.id] = key
    }
    for (const id of plan.cancel) {
      if (!force && !(id in this.stored.sent)) continue
      await push.cancel(id)
      delete this.stored.sent[id]
    }
    this.save()
    this.upcoming = await push.list()
  }

  private handle(err: unknown) {
    if (err instanceof PushNotConfiguredError) {
      // Push was switched off (or isn't set up yet): calm state, no error.
      this.availability = 'not-configured'
      return
    }
    if (err instanceof PushPermissionDeniedError) {
      this.error = 'Notifications are blocked for this site. Allow them in your browser settings, then try again.'
    } else if (err instanceof PushNotSignedInError) {
      this.error = 'Sign in to use reminders.'
    } else if (err instanceof PushNotSupportedError) {
      this.error =
        err.reason === 'requires-home-screen'
          ? 'Add Cycle to your Home Screen and open it from there to get reminders.'
          : "This browser can't show reminders."
    } else {
      this.error = "Couldn't update reminders right now. Your choices are saved and will apply next time."
    }
  }
}
