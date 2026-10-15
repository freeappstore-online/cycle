// Shared e2e setup. Every test gets:
//   - a privacy guard: fails if any request (page or service worker) goes to a
//     host other than the app itself or the *.freeappstore.online platform;
//   - a fixed "today" (2026-10-15) so fixture dates and estimates are stable.

import { type Page, test as base, expect } from '@playwright/test'

export const TODAY = '2026-10-15'

export function isAllowedRequest(url: string, appOrigin: string): boolean {
  const u = new URL(url)
  if (u.protocol === 'data:' || u.protocol === 'blob:') return true
  if (u.origin === appOrigin) return true
  return u.protocol === 'https:' && (u.hostname === 'freeappstore.online' || u.hostname.endsWith('.freeappstore.online'))
}

export const test = base.extend<{ privacyGuard: void; fixedToday: void }>({
  privacyGuard: [
    async ({ context, baseURL }, use) => {
      const offenders: string[] = []
      context.on('request', (r) => {
        if (!isAllowedRequest(r.url(), new URL(baseURL!).origin)) offenders.push(r.url())
      })
      await use()
      expect(offenders, 'requests to hosts other than the app and *.freeappstore.online').toEqual([])
    },
    { auto: true },
  ],
  fixedToday: [
    async ({ page }, use) => {
      await page.clock.setFixedTime(new Date(`${TODAY}T10:00:00`))
      await use()
    },
    { auto: true },
  ],
})

export { expect }

/** Opens a screen from the main nav (through the menu on phones). */
export async function go(page: Page, name: 'Today' | 'Calendar' | 'Insights' | 'Settings') {
  const link = () => page.getByRole('link', { name, exact: true }).filter({ visible: true }).first()
  if ((await link().count()) === 0) await page.getByRole('button', { name: /menu/i }).click()
  await link().click()
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible()
}

/** Loads the app and dismisses the first-run introduction if it shows. */
export async function openApp(page: Page, path = '/') {
  await page.goto(path)
  const intro = page.getByRole('dialog', { name: 'Welcome to Cycle' })
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  // The introduction appears after a quick IndexedDB check on a new device.
  await intro.waitFor({ timeout: 2000 }).catch(() => {})
  if (await intro.isVisible()) await intro.getByRole('button', { name: 'Skip introduction' }).click()
  await expect(intro).toBeHidden()
}

/** Waits until the service worker controls the page (so the app works offline). */
export async function waitForServiceWorker(page: Page) {
  await page.evaluate(() => navigator.serviceWorker.ready)
  if (!(await page.evaluate(() => navigator.serviceWorker.controller !== null))) {
    await page.reload()
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null)
  }
}

const day = (date: string, symptoms: string[], extra: Record<string, unknown> = {}) => ({ date, symptoms, updatedAt: 1, ...extra })

/**
 * Three earlier periods, 28 days apart, with symptoms: with a period started
 * "today" (2026-10-15) that makes three complete cycles.
 */
export function fixtureBackup() {
  const starts = ['2026-07-21', '2026-08-18', '2026-09-15']
  const add = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
  return {
    format: 'cycle-backup',
    exportedAt: '2026-10-01T09:00:00.000Z',
    schemaVersion: 1,
    days: starts.flatMap((s) => [
      day(s, ['cramps', 'back_pain'], { flow: 'heavy' }),
      day(add(s, 1), ['cramps'], { flow: 'medium' }),
      day(add(s, 14), ['bloating'], { note: 'Fixture note' }),
    ]),
    periods: starts.map((s, i) => ({ id: `fixture-${i}`, start: s, end: add(s, 4), updatedAt: 1 })),
    settings: { lutealLength: 14, weekStart: 1, updatedAt: 1 },
  }
}

/** Writes the fixture straight into the app's IndexedDB (after the app has created it), then reloads. */
export async function seedFixture(page: Page, withTodayPeriod = true) {
  const data = fixtureBackup()
  if (withTodayPeriod) data.periods.push({ id: 'fixture-today', start: TODAY, end: undefined as unknown as string, updatedAt: 1 })
  await page.evaluate(async (d) => {
    const db = await new Promise<IDBDatabase>((res, rej) => {
      const r = indexedDB.open('cycle')
      r.onsuccess = () => res(r.result)
      r.onerror = () => rej(r.error)
    })
    const tx = db.transaction(['days', 'periods'], 'readwrite')
    for (const x of d.days) tx.objectStore('days').put(x)
    for (const p of d.periods) {
      const { end, ...rest } = p
      tx.objectStore('periods').put(end ? p : rest)
    }
    await new Promise((r) => (tx.oncomplete = r))
    db.close()
  }, data)
  await page.reload()
}
