import 'fake-indexeddb/auto'
import { PushNotConfiguredError, PushPermissionDeniedError } from '@freeappstore/sdk'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { type CycleRepository, createCycleRepository } from '../data/repository'
import { DEFAULT_PREFS, atLocal } from './plan'
import { FakePush, MemoryStorage, fetchStatus } from '../test/fakePush'
import { ReminderService, checkAvailability } from './service'

let n = 0
const repos: CycleRepository[] = []
async function setup({ status = 200, user = { id: 'u' } as unknown, now = new Date(2026, 9, 15, 10, 0) } = {}) {
  const repo = createCycleRepository({ dbName: `reminders-${++n}`, requestPersist: () => Promise.resolve(true) })
  repos.push(repo)
  for (const [start, end] of [
    ['2026-07-21', '2026-07-25'],
    ['2026-08-18', '2026-08-22'],
    ['2026-09-15', '2026-09-19'],
  ]) {
    await repo.upsertPeriod({ start, end, updatedAt: 1 })
  }
  const auth = { user, onChange: () => () => {} }
  const push = new FakePush(auth)
  const storage = new MemoryStorage()
  let current = now
  const service = new ReminderService({ push, repo, auth, storage, fetch: fetchStatus(status), now: () => current, debounceMs: 0 })
  await service.refreshAvailability()
  return { repo, auth, push, storage, service, setNow: (date: Date) => { current = date } }
}

afterEach(async () => {
  await Promise.all(repos.splice(0).map((r) => r.close()))
})

describe('availability', () => {
  it('maps the VAPID key endpoint to a calm state and never throws', async () => {
    expect(await checkAvailability('https://api.example', fetchStatus(503))).toBe('not-configured')
    expect(await checkAvailability('https://api.example', fetchStatus(200))).toBe('available')
    expect(await checkAvailability('https://api.example', fetchStatus(500))).toBe('unreachable')
    const offline = (async () => {
      throw new TypeError('Failed to fetch')
    }) as typeof fetch
    expect(await checkAvailability('https://api.example', offline)).toBe('unreachable')
  })
})

describe('ReminderService', () => {
  it('saves inactive choices across launches without push calls, even signed out', async () => {
    const { service, repo, push, storage, auth } = await setup({ status: 503, user: null })
    expect(await service.saveLocalPrefs({ ...DEFAULT_PREFS, periodDue: true, daysBefore: 5 })).toBe(true)
    const again = new ReminderService({ push, repo, auth, storage, fetch: fetchStatus(503) })
    expect(again.status().prefs).toMatchObject({ periodDue: true, daysBefore: 5 })
    await again.refreshAvailability()
    await again.resync()
    expect(push.calls).toEqual([])
  })

  it('reports a local storage failure without claiming the preferences were saved', async () => {
    const { repo, push, auth } = await setup({ status: 503 })
    const service = new ReminderService({ push, repo, auth, storage: {
      getItem: () => null, removeItem: () => {}, setItem: () => { throw new Error('Quota') },
    } })
    expect(await service.saveLocalPrefs({ ...DEFAULT_PREFS, pill: true })).toBe(false)
    expect(service.status().prefs.pill).toBe(false)
    expect(service.status().error).toMatch(/Couldn't save/)
    expect(push.calls).toEqual([])
  })

  it('while push is not configured (503): no permission prompt, no server calls, no error', async () => {
    const { push, service } = await setup({ status: 503 })
    expect(service.status().availability).toBe('not-configured')
    expect(await service.savePrefs({ ...DEFAULT_PREFS, pill: true })).toBe(false)
    await service.resync()
    expect(push.calls).toEqual([])
    expect(service.status().error).toBeUndefined()
  })

  it('turning reminders on subscribes once and creates the matching schedules', async () => {
    const { push, service } = await setup()
    expect(await service.savePrefs({ ...DEFAULT_PREFS, periodDue: true, pill: true })).toBe(true)
    // Period late by the estimate on 15 Oct (13 Oct ± 2): the next due reminder is for the cycle after, 10 Nov − 2.
    expect(push.calls).toEqual([
      'subscribe',
      `schedule period-due ${JSON.stringify({ at: atLocal('2026-11-08', '09:00') })}`,
      `schedule pill ${JSON.stringify({ daily: '09:00' })}`,
      'cancel fertile-start',
    ])
    expect([...push.server.keys()].sort()).toEqual(['period-due', 'pill'])
    expect(service.status().upcoming.map((r) => r.reminderId)).toEqual(['pill', 'period-due'])
  })

  it('turning one off cancels it; turning all off unsubscribes the device', async () => {
    const { push, service } = await setup()
    await service.savePrefs({ ...DEFAULT_PREFS, periodDue: true, pill: true })
    push.calls = []
    await service.savePrefs({ ...DEFAULT_PREFS, periodDue: true })
    expect(push.calls).toContain('cancel pill')
    expect(push.calls).not.toContain('subscribe')
    expect([...push.server.keys()]).toEqual(['period-due'])

    await service.savePrefs(DEFAULT_PREFS)
    expect(push.server.size).toBe(0)
    expect(push.calls.at(-1)).toBe('unsubscribe')
  })

  it('logging a new period moves the period-due and fertile reminders', async () => {
    const { repo, push, service } = await setup()
    await service.savePrefs({ ...DEFAULT_PREFS, periodDue: true, fertile: true })
    const before = push.server.get('period-due')!.nextAt

    push.calls = []
    await service.resync()
    expect(push.calls).toEqual([]) // nothing changed, nothing re-sent

    await repo.upsertPeriod({ start: '2026-10-15', updatedAt: 2 })
    await service.resync()
    // Cycles 28, 28, 30 → next ~13 Nov; due 2 days before.
    expect(push.server.get('period-due')!.nextAt).toEqual(atLocal('2026-11-11', '09:00'))
    expect(push.server.get('period-due')!.nextAt).not.toEqual(before)
    expect(push.calls.some((c) => c.startsWith('schedule fertile-start'))).toBe(true)
  })

  it('reschedules on writes through the repository subscription', async () => {
    const { repo, push, service } = await setup()
    await service.savePrefs({ ...DEFAULT_PREFS, periodDue: true })
    const stop = service.start()
    await repo.upsertPeriod({ start: '2026-10-15', updatedAt: 2 })
    await new Promise((r) => setTimeout(r, 50))
    expect(push.server.get('period-due')!.nextAt).toEqual(atLocal('2026-11-11', '09:00'))
    stop()
  })

  it('plans the next cycle after a one-shot reminder day passes in an open tab', async () => {
    const { push, service, setNow } = await setup({ now: new Date(2026, 10, 8, 8, 0) })
    await service.savePrefs({ ...DEFAULT_PREFS, periodDue: true })
    expect(push.server.get('period-due')?.nextAt).toEqual(atLocal('2026-11-08', '09:00'))

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const stop = service.start()
      await service.resync()
      setNow(new Date(2026, 10, 9, 0, 0))
      await vi.advanceTimersByTimeAsync(16 * 60 * 60 * 1000)
      await service.resync()
      expect(push.server.get('period-due')?.nextAt).toEqual(atLocal('2026-12-06', '09:00'))
      stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it('explains a blocked permission and keeps the reminders off', async () => {
    const { push, service } = await setup()
    push.subscribeError = new PushPermissionDeniedError()
    expect(await service.savePrefs({ ...DEFAULT_PREFS, pill: true })).toBe(false)
    expect(service.status().error).toMatch(/blocked/)
    expect(service.status().prefs.pill).toBe(false)
    expect(push.server.size).toBe(0)
  })

  it('treats "not configured" from subscribe as the calm state, not an error', async () => {
    const { push, service } = await setup()
    push.subscribeError = new PushNotConfiguredError()
    expect(await service.savePrefs({ ...DEFAULT_PREFS, pill: true })).toBe(false)
    expect(service.status()).toMatchObject({ availability: 'not-configured', error: undefined })
  })

  it('asks to sign in, and does nothing in the background while signed out', async () => {
    const { push, service } = await setup({ user: null })
    expect(await service.savePrefs({ ...DEFAULT_PREFS, pill: true })).toBe(false)
    expect(service.status().error).toMatch(/Sign in/)
    await service.resync()
    expect(push.calls).toEqual([])
  })

  it('remembers choices across launches', async () => {
    const { push, repo, storage, service } = await setup()
    await service.savePrefs({ ...DEFAULT_PREFS, fertile: true, time: '20:15' })
    const again = new ReminderService({ push, repo, auth: { user: { id: 'u' }, onChange: () => () => {} }, storage, fetch: fetchStatus(200) })
    expect(again.status().prefs).toMatchObject({ fertile: true, time: '20:15' })
  })

  it('clearAll cancels every reminder and unregisters the device', async () => {
    const { push, service } = await setup()
    await service.savePrefs({ ...DEFAULT_PREFS, periodDue: true, pill: true })
    await service.clearAll()
    expect(push.server.size).toBe(0)
    expect(push.calls.slice(-4)).toEqual(['cancel period-due', 'cancel fertile-start', 'cancel pill', 'unsubscribe'])
    expect(service.status().prefs).toEqual(DEFAULT_PREFS)
  })
})
