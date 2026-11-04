import { expect, go, openApp, test } from './fixtures'

test.beforeEach(async ({ page }) => {
  const user = { id: 'e2e-user', login: 'e2e-user', avatarUrl: null, dateOfBirth: null }
  await page.addInitScript((user) => {
    localStorage.setItem('fas:session', JSON.stringify({ token: 'e2e-token', user }))
  }, user)
  await page.route('https://api.freeappstore.online/v1/auth/me', (r) => r.fulfill({ json: user }))
  await page.route('https://api.freeappstore.online/v1/apps/cycle/roles/ensure-member', (r) => r.fulfill({ json: { ok: true } }))
  await page.route('https://api.freeappstore.online/v1/apps/cycle/kv**', (r) =>
    r.fulfill({ json: [] }),
  )
  await openApp(page)
})

test('signed-in navigation reaches every screen without opening the profile menu', async ({ page }) => {
  const profile = page.getByRole('button', { name: 'Profile menu', exact: true })
  await expect(profile).toBeVisible()
  for (const screen of ['Settings', 'Calendar', 'Insights', 'Today'] as const) {
    await go(page, screen)
    await expect(page.getByRole('navigation', { name: 'Main', exact: true })
      .getByRole('link', { name: screen, exact: true, includeHidden: true })).toHaveAttribute('aria-current', 'page')
    await expect(profile).toHaveAttribute('aria-expanded', 'false')
  }
})

test('exact mobile Menu locator excludes the profile avatar button', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Mobile menu locator')
  const menu = page.getByRole('button', { name: 'Menu', exact: true })
  const profile = page.getByRole('button', { name: 'Profile menu', exact: true })
  await expect(menu).toHaveCount(1)
  await expect(profile).toBeVisible()
  expect(await menu.evaluate((button, avatar) => button === avatar, await profile.elementHandle())).toBe(false)
})

test('mobile menu supports touch, keyboard dismissal and keyboard navigation', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Mobile drawer behavior')
  const nav = page.getByRole('navigation', { name: 'Main', exact: true })
  const menu = nav.getByRole('button', { name: 'Menu', exact: true })
  const settings = nav.getByRole('link', { name: 'Settings', exact: true })
  await expect(menu).toHaveAttribute('aria-expanded', 'false')
  await expect(settings).toBeHidden()
  await menu.tap()
  await expect(menu).toHaveAttribute('aria-expanded', 'true')
  await expect(settings).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(menu).toBeFocused()
  await expect(settings).toBeHidden()
  await page.keyboard.press('Enter')
  await expect(settings).toBeVisible()
  await settings.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible()
  await expect(menu).toHaveAttribute('aria-expanded', 'false')
  await expect(settings).toBeHidden()
})
