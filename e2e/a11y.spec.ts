// Accessibility smoke (#144): axe on every screen, the introduction and the
// day sheet, with no serious or critical violations (light and dark projects).
//
// The SDK Shell's header (platform-owned: the orange "Free" logo link and
// "Sign in" button) fails colour contrast with the platform accent. Apps may
// not override brand colours (fas check: "No brand overrides"), so the header
// is excluded here and its result recorded as an annotation instead.

import AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'
import { expect, go, openApp, seedFixture, test } from './fixtures'

async function expectNoSeriousViolations(page: Page, label: string) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .exclude('#root > div > header')
    .analyze()
  const serious = results.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id} (${v.impact}): ${v.help} — ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`)
  expect(serious, `axe on ${label}`).toEqual([])
}

test('platform header (recorded, not gated)', async ({ page }) => {
  await page.goto('/')
  const results = await new AxeBuilder({ page }).include('#root > div > header').withTags(['wcag2aa']).analyze()
  test.info().annotations.push({
    type: 'platform-a11y',
    description: results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`).join('; ') || 'none',
  })
})

test('introduction', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('dialog', { name: 'Welcome to Cycle' })).toBeVisible()
  await expectNoSeriousViolations(page, 'introduction')
})

test('every screen with data, and the day sheet', async ({ page }) => {
  await openApp(page)
  await seedFixture(page)
  for (const screen of ['Today', 'Calendar', 'Insights', 'Settings'] as const) {
    await go(page, screen)
    if (screen === 'Insights') await expect(page.locator('.recharts-bar-rectangle').first()).toBeVisible()
    await expectNoSeriousViolations(page, screen)
  }
  await go(page, 'Today')
  await page.getByRole('button', { name: 'Log today' }).click()
  await expect(page.getByRole('dialog').getByRole('group', { name: 'Flow' })).toBeVisible()
  await expectNoSeriousViolations(page, 'day sheet')
})
