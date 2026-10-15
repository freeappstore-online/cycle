import { defineConfig, devices } from '@playwright/test'

// End-to-end tests for Cycle (#144). They run against the production build
// (vite preview), so the service worker, precache and lazy chunks are real.
// Build first: `pnpm build && pnpm e2e`.

const PORT = 4599
export const APP_ORIGIN = `http://localhost:${PORT}`

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: APP_ORIGIN,
    trace: 'retain-on-failure',
    // Keep a stable "today" for fixtures; locale fixes date formatting.
    locale: 'en-GB',
    timezoneId: 'Europe/London',
  },
  projects: [
    { name: 'desktop-light', use: { ...devices['Desktop Chrome'], colorScheme: 'light' } },
    { name: 'desktop-dark', use: { ...devices['Desktop Chrome'], colorScheme: 'dark' } },
    { name: 'mobile-light', use: { ...devices['Pixel 7'], colorScheme: 'light' } },
    { name: 'mobile-dark', use: { ...devices['Pixel 7'], colorScheme: 'dark' } },
  ],
  webServer: {
    command: `pnpm --filter @cycle/web exec vite preview --port ${PORT} --strictPort`,
    url: APP_ORIGIN,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
})
