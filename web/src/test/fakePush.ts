import {
  type PushIsSupported,
  PushNotSignedInError,
  type PushReminder,
  type PushScheduleOptions,
  type PushWhen,
} from '@freeappstore/sdk'
import type { PushLike } from '../reminders/service'

/** A fas.push stand-in that records calls and keeps a server-side schedule list. */
export class FakePush implements PushLike {
  calls: string[] = []
  server = new Map<string, PushReminder>()
  support: PushIsSupported = { supported: true, reason: 'ok' }
  subscribeError?: Error
  private readonly auth: { user: unknown }
  constructor(auth: { user: unknown }) {
    this.auth = auth
  }
  private requireUser() {
    if (!this.auth.user) throw new PushNotSignedInError()
  }
  isSupported() {
    return this.support
  }
  async subscribe() {
    this.requireUser()
    this.calls.push('subscribe')
    if (this.subscribeError) throw this.subscribeError
  }
  async unsubscribe() {
    this.calls.push('unsubscribe')
  }
  async schedule(id: string, when: PushWhen, opts?: PushScheduleOptions) {
    this.requireUser()
    this.calls.push(`schedule ${id} ${JSON.stringify(when)}`)
    const nextAt = 'at' in when ? new Date(when.at) : new Date(2026, 9, 16, 9, 0)
    const r: PushReminder = { reminderId: id, when, tz: 'Europe/London', quietHours: opts?.quietHours ?? null, nextAt }
    this.server.set(id, r)
    return r
  }
  async cancel(id: string) {
    this.calls.push(`cancel ${id}`)
    this.server.delete(id)
  }
  async list() {
    return [...this.server.values()].sort((a, b) => +a.nextAt - +b.nextAt)
  }
}

export class MemoryStorage {
  map = new Map<string, string>()
  getItem = (k: string) => this.map.get(k) ?? null
  setItem = (k: string, v: string) => void this.map.set(k, v)
  removeItem = (k: string) => void this.map.delete(k)
}

export const fetchStatus = (status: number) =>
  (async () => new Response(status === 200 ? '{"publicKey":"BAx"}' : '{}', { status })) as typeof fetch
