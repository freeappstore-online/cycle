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
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  const date = page.getByLabel('When did your last period start?')
  await page.getByRole('button', { name: 'Save and continue' }).click()
  await expect(date).toHaveAttribute('aria-invalid', 'true')
  await expect(date).toHaveAccessibleDescription(/valid last-period start date/)
  await expectNoSeriousViolations(page, 'setup validation')
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

test('keyboard logging, confirmation focus and accessible names', async ({ page }) => {
  await openApp(page)
  const opener = page.getByRole('button', { name: 'Log today' })
  await opener.focus()
  await page.keyboard.press('Enter')
  const editor = page.getByRole('dialog')
  await expect(editor.getByRole('heading', { level: 2 })).toBeFocused()
  await expect(editor.getByRole('textbox', { name: 'Notes' })).toBeVisible()
  await editor.getByRole('button', { name: 'Save', exact: true }).focus()
  await page.keyboard.press('Tab')
  await expect(editor.getByRole('button', { name: 'Close', exact: true })).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(editor.getByRole('button', { name: 'Save', exact: true })).toBeFocused()
  const heavy = editor.getByRole('radio', { name: 'Heavy', exact: true })
  await heavy.focus()
  await page.keyboard.press('Space')
  await editor.getByRole('textbox', { name: 'Notes' }).fill('Keyboard smoke')
  await editor.getByRole('button', { name: 'Save', exact: true }).focus()
  await page.keyboard.press('Enter')
  const edit = page.getByRole('button', { name: 'Edit today' })
  await expect(edit).toBeFocused()
  await page.keyboard.press('Enter')
  const remove = editor.getByRole('button', { name: 'Delete day' })
  await remove.focus()
  await page.keyboard.press('Enter')
  const confirmation = page.getByRole('dialog', { name: 'Delete this day?' })
  await expect(confirmation.getByRole('heading')).toBeFocused()
  await expectNoSeriousViolations(page, 'confirmation')
  await confirmation.getByRole('button', { name: 'Delete', exact: true }).focus()
  await page.keyboard.press('Tab')
  await expect(confirmation.getByRole('button', { name: 'Close', exact: true })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(confirmation).toBeHidden()
  await expect(remove).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(edit).toBeFocused()
})

test('system theme and narrow mobile/tablet layouts', async ({ page }) => {
  await openApp(page)
  await seedFixture(page)
  for (const scheme of ['dark', 'light'] as const) {
    await page.emulateMedia({ colorScheme: scheme })
    if (scheme === 'dark') await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    else await expect(page.locator('html')).not.toHaveAttribute('data-theme', 'dark')
  }
  for (const width of [320, 768]) {
    await page.setViewportSize({ width, height: 1024 })
    for (const screen of ['Today', 'Calendar', 'Settings'] as const) {
      await go(page, screen)
      expect(await page.locator('main').evaluate((el) => el.scrollWidth <= el.clientWidth + 1), `${screen} at ${width}px`).toBe(true)
    }
  }
})
