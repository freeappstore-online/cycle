// Offline (#144): after the first load the service worker serves the app;
// logging works and persists without a network.

import { expect, go, openApp, test, waitForServiceWorker } from './fixtures'

test('works offline after the first load', async ({ page, context }) => {
  await openApp(page)
  await waitForServiceWorker(page)

  await context.setOffline(true)
  await page.reload()
  await expect(page.getByRole('heading', { level: 1, name: 'Today' })).toBeVisible()

  await page.getByRole('button', { name: 'Log today' }).click()
  const sheet = page.getByRole('dialog')
  await sheet.getByRole('group', { name: 'Symptoms' }).getByText('Headache', { exact: true }).click()
  await sheet.getByRole('button', { name: 'Save' }).click()
  await expect(sheet).toBeHidden()

  // Still offline: reload and it's still there.
  await page.reload()
  await expect(page.getByText('Headache')).toBeVisible()

  // Lazy screens come from the precache too.
  await go(page, 'Insights')
  await expect(page.getByRole('heading', { name: 'Not enough cycles yet' })).toBeVisible()
  await context.setOffline(false)
})
