// Privacy (#144): every request goes only to the app or *.freeappstore.online.
// The guard in fixtures.ts runs for every test; this one visits every screen
// with data so all lazy chunks, fonts and the analytics loader are exercised.

import { TODAY, expect, go, isAllowedRequest, openApp, seedFixture, test } from './fixtures'

test('the guard itself rejects other hosts', () => {
  const app = 'http://localhost:4599'
  expect(isAllowedRequest(`${app}/assets/index.js`, app)).toBe(true)
  expect(isAllowedRequest('https://api.freeappstore.online/v1/analytics.js?app=cycle', app)).toBe(true)
  expect(isAllowedRequest('https://freeappstore.online/', app)).toBe(true)
  expect(isAllowedRequest('https://fonts.googleapis.com/css', app)).toBe(false)
  expect(isAllowedRequest('https://static.cloudflareinsights.com/beacon.min.js', app)).toBe(false)
  expect(isAllowedRequest('https://evil-freeappstore.online/', app)).toBe(false)
  expect(isAllowedRequest('http://api.freeappstore.online/', app)).toBe(false)
})

test('no third-party requests on any screen', async ({ page }) => {
  const seen = new Set<string>()
  page.context().on('request', (r) => seen.add(new URL(r.url()).host))
  await openApp(page)
  await seedFixture(page)
  for (const screen of ['Calendar', 'Insights', 'Settings', 'Today'] as const) await go(page, screen)
  await page.getByRole('button', { name: 'Log today' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click()
  await go(page, 'Settings')
  const [pdf] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download PDF' }).click()])
  expect(pdf.suggestedFilename()).toContain(TODAY)
  // The guard fixture fails the test if anything else was requested; this just records what was.
  test.info().annotations.push({ type: 'hosts', description: [...seen].sort().join(', ') })
})
