// Reminders via fas.push (#148), against a mocked push service at the SDK's
// real URLs. Covers the calm 503 state, the scheduling calls, rescheduling
// after logging, and the generic notification text in the service worker.
//
// Manual real-device check: sign in on a phone (iOS: from
// the Home Screen app), turn on a pill reminder 2 minutes ahead, lock the
// phone, and confirm the notification says only "Reminder / Check your
// calendar." and opens Cycle on Today when tapped.

import type { BrowserContext, Page } from '@playwright/test'
import { expect, go, openApp, seedFixture, test } from './fixtures'

const API = 'https://api.freeappstore.online'
const USER = { id: 'e2e-user', login: 'e2e-user', avatarUrl: null, dateOfBirth: null }
// A syntactically valid 65-byte uncompressed P-256 point, base64url (the browser's push subscribe is stubbed).
const VAPID = 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U'

interface Rule {
  type: string
  at?: number
  time?: string
}

async function signedIn(page: Page) {
  await page.addInitScript((user) => localStorage.setItem('fas:session', JSON.stringify({ token: 'e2e-token', user })), USER)
  await page.route(`${API}/v1/auth/me`, (r) => r.fulfill({ json: USER }))
  await page.route(`${API}/v1/apps/cycle/roles/ensure-member`, (r) => r.fulfill({ json: { ok: true } }))
  // Settings checks for a sync copy when signed in; with a fake token the real
  // API would answer 401 and the SDK would (rightly) sign out. No copy here.
  await page.route((url) => url.href.startsWith(`${API}/v1/apps/cycle/kv`), (r) =>
    new URL(r.request().url()).pathname.endsWith('/kv') ? r.fulfill({ json: [] }) : r.fulfill({ status: 404, body: '' }),
  )
  // Records whether the app ever asks for notification permission.
  await page.addInitScript(() => {
    const original = Notification.requestPermission.bind(Notification)
    Notification.requestPermission = (...args) => {
      ;(window as unknown as { __askedPermission: boolean }).__askedPermission = true
      return original(...args)
    }
  })
}

/** In-memory fas.push backend + a stubbed browser push subscription. */
async function mockPush(page: Page, context: BrowserContext) {
  const schedules = new Map<string, { rule: Rule; tz: string; quietHours: unknown }>()
  const log: string[] = []
  await context.grantPermissions(['notifications'])
  await page.addInitScript(() => {
    const fake = {
      endpoint: 'https://push.example.invalid/e2e',
      toJSON: () => ({ endpoint: 'https://push.example.invalid/e2e', keys: { p256dh: 'p', auth: 'a' } }),
      unsubscribe: async () => true,
    }
    let subscribed = false
    PushManager.prototype.subscribe = async function () {
      subscribed = true
      return fake as unknown as PushSubscription
    }
    PushManager.prototype.getSubscription = async function () {
      return (subscribed ? fake : null) as unknown as PushSubscription
    }
  })
  await page.route(`${API}/v1/push/vapid-public-key`, (r) => r.fulfill({ json: { publicKey: VAPID } }))
  await page.route(`${API}/v1/apps/cycle/push/subscriptions`, (r) => {
    log.push(`${r.request().method()} subscriptions`)
    return r.fulfill({ status: 201, json: { ok: true } })
  })
  await page.route(new RegExp(`^${API}/v1/apps/cycle/push/schedules(/[^?]*)?$`), (r) => {
    const req = r.request()
    const id = decodeURIComponent(new URL(req.url()).pathname.split('/schedules/')[1] ?? '')
    const toJson = (reminderId: string, s: { rule: Rule; tz: string; quietHours: unknown }) => ({
      reminderId,
      ...s,
      nextAt: s.rule.at ?? Date.now() + 3_600_000,
    })
    if (req.method() === 'GET') return r.fulfill({ json: { schedules: [...schedules].map(([k, s]) => toJson(k, s)) } })
    if (req.method() === 'PUT') {
      const body = req.postDataJSON() as { rule: Rule; tz: string; quietHours?: unknown }
      log.push(`PUT ${id} ${body.rule.type}`)
      schedules.set(id, { rule: body.rule, tz: body.tz, quietHours: body.quietHours ?? null })
      return r.fulfill({ json: toJson(id, schedules.get(id)!) })
    }
    if (req.method() === 'DELETE') {
      log.push(`DELETE ${id}`)
      schedules.delete(id)
      return r.fulfill({ status: 204, body: '' })
    }
    return r.fulfill({ status: 405, body: '' })
  })
  return { schedules, log }
}

test('push not configured (503): calm "coming soon", no permission prompt', async ({ page }) => {
  await signedIn(page)
  const pushCalls: string[] = []
  page.on('request', (r) => r.url().includes('/push/') && pushCalls.push(r.url()))
  await page.route(`${API}/v1/push/vapid-public-key`, (r) =>
    r.fulfill({ status: 503, json: { error: 'push is not configured: VAPID_PUBLIC_KEY is not set' } }),
  )
  await openApp(page)
  await go(page, 'Settings')
  const section = page.getByRole('region', { name: 'Reminders' })
  await expect(section.getByText(/Coming soon: reminders when your period is due/)).toBeVisible()
  await section.getByRole('checkbox', { name: 'When my period is due' }).check()
  await section.getByLabel('How early').selectOption('5')
  await section.getByRole('button', { name: 'Save preferences' }).click()
  await expect(section.getByText('Preferences saved on this device. Reminders are not active.')).toBeVisible()
  await expect(section.getByRole('alert')).toHaveCount(0)
  expect(await page.evaluate(() => (window as unknown as { __askedPermission?: boolean }).__askedPermission ?? false)).toBe(false)
  expect(pushCalls.every((u) => u.endsWith('/v1/push/vapid-public-key'))).toBe(true)
})

test('reminders create, cancel and follow logging (mocked push service)', async ({ page, context }) => {
  await signedIn(page)
  const { schedules, log } = await mockPush(page, context)
  await openApp(page)
  await seedFixture(page, false)
  await go(page, 'Settings')
  const section = page.getByRole('region', { name: 'Reminders' })

  await section.getByRole('checkbox', { name: 'When my period is due' }).check()
  await section.getByLabel('How early').selectOption('5')
  await section.getByRole('checkbox', { name: 'When my estimated fertile window starts' }).check()
  await section.getByRole('checkbox', { name: 'Daily pill reminder' }).check()
  await section.getByRole('button', { name: 'Save reminders' }).click()
  await expect(section.getByText('Reminders saved.')).toBeVisible()
  expect(log).toContain('POST subscriptions')
  expect(schedules.get('period-due')?.rule.type).toBe('at')
  expect(schedules.get('period-due')?.rule.at).toBe(await page.evaluate(() => new Date(2026, 10, 5, 9).getTime()))
  // Two observed cycles widen the second estimate to start as early as 7 Nov.
  expect(schedules.get('fertile-start')?.rule.at).toBe(await page.evaluate(() => new Date(2026, 9, 19, 9).getTime()))
  expect(schedules.get('pill')?.rule).toEqual({ type: 'daily', time: '09:00' })
  await expect(section.getByRole('list', { name: 'Upcoming reminders' })).toContainText('Pill')

  // Turning one off cancels its server schedule.
  await section.getByRole('checkbox', { name: 'Daily pill reminder' }).uncheck()
  await section.getByRole('button', { name: 'Save reminders' }).click()
  await expect.poll(() => schedules.has('pill')).toBe(false)
  expect(log).toContain('DELETE pill')

  // Logging a new period moves the period-due reminder.
  const before = schedules.get('period-due')!.rule.at
  await go(page, 'Today')
  await page.getByRole('button', { name: 'Period started today' }).click()
  await expect.poll(() => schedules.get('period-due')?.rule.at, { timeout: 10_000 }).not.toBe(before)

  await go(page, 'Settings')
  await section.getByRole('checkbox', { name: 'When my period is due' }).uncheck()
  await section.getByRole('checkbox', { name: 'When my estimated fertile window starts' }).uncheck()
  await section.getByRole('button', { name: 'Save reminders' }).click()
  await expect.poll(() => schedules.size).toBe(0)
  expect(log).toContain('DELETE period-due')
  expect(log).toContain('DELETE fertile-start')
  expect(log).toContain('DELETE pill')
})

test('a push shows only generic text', async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'uses the Chrome DevTools Protocol')
  await context.grantPermissions(['notifications'])
  await openApp(page)
  await page.evaluate(() => navigator.serviceWorker.ready)
  const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'))
  // Headless Chromium doesn't display notifications, so record what the
  // service worker's push handler asks to show.
  await sw.evaluate(() => {
    const g = self as unknown as { __shown: string[]; registration: ServiceWorkerRegistration }
    g.__shown = []
    const show = g.registration.showNotification.bind(g.registration)
    g.registration.showNotification = (title, options) => {
      g.__shown.push(`${title} | ${options?.body}`)
      return show(title, options).catch(() => undefined)
    }
  })
  const cdp = await context.newCDPSession(page)
  const registrationId = await new Promise<string>((resolve) => {
    cdp.on('ServiceWorker.workerRegistrationUpdated', ({ registrations }) => {
      const r = registrations.find((x: { isDeleted: boolean }) => !x.isDeleted)
      if (r) resolve(r.registrationId)
    })
    void cdp.send('ServiceWorker.enable')
  })
  await cdp.send('ServiceWorker.deliverPushMessage', { origin: new URL(page.url()).origin, registrationId, data: '' })
  await expect.poll(() => sw.evaluate(() => (self as unknown as { __shown: string[] }).__shown)).toEqual(['Reminder | Check your calendar.'])
})
