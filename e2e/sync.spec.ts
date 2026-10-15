// Sync (#144): only ciphertext and KDF metadata reach fas.kv.
//
// There are no test credentials for a real FreeAppStore account, so this
// signs in with a fake session and serves the platform's auth and kv routes
// from memory, at the same URLs the SDK uses. That checks exactly what the app
// sends. Manual check against the real service (two browser profiles, same
// account): turn on sync in both, edit in each, confirm they converge, and in
// DevTools → Network confirm PUT /v1/apps/cycle/kv/* bodies are base64 only.

import type { Page } from '@playwright/test'
import { expect, go, openApp, seedFixture, test } from './fixtures'

const API = 'https://api.freeappstore.online'
const USER = { id: 'e2e-user', login: 'e2e-user', avatarUrl: null, dateOfBirth: null }

async function fakePlatform(page: Page) {
  const kv = new Map<string, string>()
  const puts: string[] = []
  await page.addInitScript((user) => {
    localStorage.setItem('fas:session', JSON.stringify({ token: 'e2e-token', user }))
  }, USER)
  await page.route(`${API}/v1/auth/me`, (r) => r.fulfill({ json: USER }))
  await page.route(`${API}/v1/apps/cycle/roles/ensure-member`, (r) => r.fulfill({ json: { ok: true } }))
  await page.route(new RegExp(`^${API}/v1/apps/cycle/kv(/|\\?|$)`), async (route) => {
    const req = route.request()
    const url = new URL(req.url())
    const key = decodeURIComponent(url.pathname.split('/kv/')[1] ?? '')
    if (!key) {
      const prefix = url.searchParams.get('prefix') ?? ''
      return route.fulfill({ json: [...kv.keys()].filter((k) => k.startsWith(prefix)) })
    }
    if (req.method() === 'GET') return kv.has(key) ? route.fulfill({ body: kv.get(key), contentType: 'application/json' }) : route.fulfill({ status: 404, body: '' })
    if (req.method() === 'PUT') {
      const body = req.postData() ?? ''
      puts.push(body)
      kv.set(key, body)
      return route.fulfill({ status: 204, body: '' })
    }
    if (req.method() === 'DELETE') {
      kv.delete(key)
      return route.fulfill({ status: 204, body: '' })
    }
    return route.fulfill({ status: 405, body: '' })
  })
  return { kv, puts }
}

test('sync uploads only ciphertext, and turning it off deletes it', async ({ page }) => {
  const { kv, puts } = await fakePlatform(page)
  await openApp(page)
  await seedFixture(page)
  await go(page, 'Settings')
  await expect(page.getByText('Signed in as')).toBeVisible()

  await page.getByLabel('New passphrase').fill('river stone lantern')
  await page.getByLabel('Confirm passphrase').fill('river stone lantern')
  await page.getByRole('button', { name: 'Turn on sync' }).click()
  await expect(page.getByText(/Sync is on\. Last synced/)).toBeVisible({ timeout: 20_000 })

  expect([...kv.keys()].sort()).toEqual(['cycle:meta', 'cycle:y2026'])
  const sent = puts.join('\n')
  for (const plain of ['2026-07-21', '2026-10-15', 'cramps', 'back_pain', 'bloating', 'Fixture note', 'updatedAt', 'heavy', 'river stone lantern']) {
    expect(sent, `"${plain}" must not be uploaded`).not.toContain(plain)
  }
  const meta = JSON.parse(kv.get('cycle:meta')!)
  expect(Object.keys(meta).sort()).toEqual(['alg', 'check', 'head', 'iter', 'kdf', 'salt', 'v', 'years'])
  expect(meta).toMatchObject({ alg: 'AES-256-GCM', kdf: 'PBKDF2-SHA-256', iter: 600000 })

  await page.getByRole('button', { name: 'Turn off sync' }).click()
  await page.getByRole('button', { name: 'Turn off and delete cloud copy' }).click()
  await expect(page.getByText('Choose a passphrase.', { exact: false })).toBeVisible()
  expect(kv.size).toBe(0)
})
