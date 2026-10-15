// The v1 user journey (#144): onboarding → log a period and symptoms →
// calendar → predictions after 3 cycles → Insights → JSON export → wipe →
// import → PDF. The privacy guard in fixtures.ts checks every request.

import { readFile } from 'node:fs/promises'
import { TODAY, expect, fixtureBackup, go, test } from './fixtures'

test('full journey', async ({ page }) => {
  // Onboarding, with the optional setup.
  await page.goto('/')
  const intro = page.getByRole('dialog', { name: 'Welcome to Cycle' })
  await expect(intro.getByRole('heading', { name: 'Your cycle data stays on this device' })).toBeVisible()
  await intro.getByRole('button', { name: 'Next' }).click()
  await intro.getByLabel('Typical cycle length (days)').fill('28')
  await intro.getByRole('button', { name: 'Save and continue' }).click()
  await expect(intro.getByRole('heading', { name: 'Optional: sync between devices' })).toBeVisible()
  await intro.getByRole('button', { name: 'Next' }).click()
  await expect(intro.getByText(/Do not use this app for contraception/)).toBeVisible()
  await intro.getByRole('button', { name: 'Start using Cycle' }).click()
  await expect(intro).toBeHidden()

  // Log today's period, flow and symptoms.
  await page.getByRole('button', { name: 'Period started today' }).click()
  await expect(page.getByRole('heading', { name: 'Period day 1' })).toBeVisible()
  await page.getByRole('button', { name: 'Log today' }).click()
  const sheet = page.getByRole('dialog')
  await sheet.getByRole('group', { name: 'Flow' }).getByText('Medium', { exact: true }).click()
  await sheet.getByRole('group', { name: 'Symptoms' }).getByText('Cramps', { exact: true }).click()
  await sheet.getByLabel('Notes').fill('Started this morning')
  await sheet.getByRole('button', { name: 'Save' }).click()
  await expect(sheet).toBeHidden()
  await expect(page.getByText('Started this morning')).toBeVisible()

  // The calendar shows it.
  await go(page, 'Calendar')
  await expect(page.getByRole('button', { name: /Thursday,? 15 October 2026, today, period, medium flow, symptoms logged, has a note/ })).toBeVisible()

  // Add three earlier cycles from a backup file (merge), then estimates appear.
  await go(page, 'Settings')
  await page.getByLabel('Choose a Cycle backup file (.json)').setInputFiles({
    name: 'fixture.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(fixtureBackup())),
  })
  await expect(page.getByText(/9 logged days and 3 periods/)).toBeVisible()
  await page.getByRole('button', { name: 'Restore' }).click()
  await page.getByRole('button', { name: 'Merge', exact: true }).click()
  await expect(page.getByText('Backup merged into the data on this device.')).toBeVisible()

  await go(page, 'Today')
  await expect(page.getByRole('heading', { name: /Next period \(estimate\)/ })).toBeVisible()
  await expect(page.getByText(/Estimated fertile window: 23 Oct – 2 Nov/)).toBeVisible()
  await expect(page.getByText('Do not use this app for contraception.')).toBeVisible()

  await go(page, 'Calendar')
  expect(await page.locator('[data-fertile]').count()).toBeGreaterThan(0)
  await page.getByRole('button', { name: 'Next month' }).click()
  await expect(page.getByRole('heading', { name: 'November 2026' })).toBeVisible()
  expect(await page.locator('[data-predicted]').count()).toBeGreaterThan(0)

  // Insights renders (Recharts loads lazily).
  await go(page, 'Insights')
  await expect(page.getByRole('heading', { name: 'Cycle length' })).toBeVisible()
  await expect(page.locator('.recharts-bar-rectangle').first()).toBeVisible()
  await expect(page.getByText('Cycles logged').locator('..')).toContainText('3')
  await expect(page.getByRole('table', { name: /Percentage of cycle days with each symptom/ })).toBeVisible()

  // JSON export.
  await go(page, 'Settings')
  const [backupDownload] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download backup' }).click()])
  expect(backupDownload.suggestedFilename()).toBe(`cycle-backup-${TODAY}.json`)
  const backupPath = await backupDownload.path()
  const backup = JSON.parse(await readFile(backupPath, 'utf8'))
  expect(backup).toMatchObject({ format: 'cycle-backup', schemaVersion: 1 })
  expect(backup.days).toHaveLength(10)
  expect(backup.periods).toHaveLength(4)

  // Wipe.
  await page.getByRole('button', { name: 'Delete all data' }).click()
  await page.getByRole('button', { name: 'Delete everything' }).click()
  await expect(page.getByText('All Cycle data was deleted.')).toBeVisible()
  await go(page, 'Today')
  await expect(page.getByRole('heading', { name: 'Welcome to Cycle' })).toBeVisible()

  // Import restores it.
  await go(page, 'Settings')
  await page.getByLabel('Choose a Cycle backup file (.json)').setInputFiles(backupPath)
  await expect(page.getByText(/10 logged days and 4 periods/)).toBeVisible()
  await page.getByRole('radio', { name: /Replace/ }).check()
  await page.getByRole('button', { name: 'Restore' }).click()
  await page.getByRole('button', { name: 'Replace', exact: true }).click()
  await expect(page.getByText(/Backup restored/)).toBeVisible()
  await go(page, 'Today')
  await expect(page.getByRole('heading', { name: 'Period day 1' })).toBeVisible()
  await expect(page.getByText('Started this morning')).toBeVisible()

  // The doctor PDF downloads.
  await go(page, 'Settings')
  const [pdfDownload] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download PDF' }).click()])
  expect(pdfDownload.suggestedFilename()).toBe(`cycle-summary-2026-04-15-to-${TODAY}.pdf`)
  const pdf = await readFile(await pdfDownload.path())
  expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-')
})
