// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CycleRepoContext } from '../data/RepoContext'
import { type CycleRepository, createCycleRepository } from '../data/repository'
import { onboardingSeen } from '../privacy/onboarding'
import { Onboarding, useFirstRun } from './Onboarding'

const TODAY = '2026-10-15'
let n = 0
let repo: CycleRepository

function Harness() {
  const [open, setOpen] = useFirstRun(repo)
  return <Onboarding open={open} onClose={() => setOpen(false)} today={TODAY} />
}

const app = () => (
  <CycleRepoContext.Provider value={repo}>
    <Harness />
  </CycleRepoContext.Provider>
)

async function setup(seed?: (r: CycleRepository) => Promise<unknown>) {
  repo = createCycleRepository({ dbName: `onboarding-${++n}`, requestPersist: () => Promise.resolve(true) })
  await seed?.(repo)
  return { ...render(app()), user: userEvent.setup() }
}

beforeEach(() => localStorage.clear())
afterEach(async () => {
  cleanup()
  await repo.close()
})

describe('Onboarding', () => {
  it('shows once to a new user; skipping still lets them log', async () => {
    const { user, unmount } = await setup()
    expect(await screen.findByRole('dialog', { name: 'Welcome to Cycle' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Your cycle data stays on this device' })).toBeInTheDocument()
    expect(screen.getByText(/without cookies/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Skip introduction' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(onboardingSeen()).toBe(true)
    await repo.putDay({ date: TODAY, symptoms: ['cramps'] })
    expect(await repo.getDay(TODAY)).toBeDefined()

    unmount()
    render(app())
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('stays out of the way for someone who already has data', async () => {
    await setup((r) => r.upsertPeriod({ start: '2026-09-20', end: '2026-09-24' }))
    await waitFor(() => expect(onboardingSeen()).toBe(true))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('walks through all four steps, saving the optional setup once', async () => {
    const { user } = await setup()
    await screen.findByRole('dialog')
    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByRole('heading', { name: 'Optional: a head start' })).toHaveFocus()
    expect(screen.getByText('Step 2 of 4')).toBeInTheDocument()

    await user.type(screen.getByLabelText('Typical cycle length (days)'), '9')
    await user.click(screen.getByRole('button', { name: 'Save and continue' }))
    expect(screen.getByRole('alert')).toHaveTextContent(/15 to 90/)

    await user.clear(screen.getByLabelText('Typical cycle length (days)'))
    await user.type(screen.getByLabelText('Typical cycle length (days)'), '31')
    await user.type(screen.getByLabelText('Typical period length (days)'), '4')
    await user.type(screen.getByLabelText('When did your last period start?'), '2026-10-02')
    await user.click(screen.getByRole('button', { name: 'Save and continue' }))
    // Saving writes to IndexedDB first, so the next step appears asynchronously.
    expect(await screen.findByRole('heading', { name: 'Optional: sync between devices' })).toHaveFocus()
    expect(screen.getByText(/can't read it/)).toBeInTheDocument()
    expect(screen.getByText(/nobody can recover it if you forget the passphrase/)).toBeInTheDocument()

    // Back and forward again doesn't log the period twice.
    await user.click(screen.getByRole('button', { name: 'Back' }))
    await user.click(screen.getByRole('button', { name: 'Save and continue' }))
    await screen.findByRole('heading', { name: 'Optional: sync between devices' })
    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByRole('heading', { name: 'About the estimates' })).toBeInTheDocument()
    expect(screen.getByText(/Do not use this app for contraception/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Start using Cycle' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(await repo.getSettings()).toMatchObject({ defaultCycleLength: 31, defaultPeriodLength: 4 })
    expect(await repo.listPeriods()).toMatchObject([{ start: '2026-10-02', end: '2026-10-05' }])
  })
})
