// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { type CycleRepository, createCycleRepository } from '../../data/repository'
import { ReminderService } from '../../reminders/service'
import { FakePush, MemoryStorage, fetchStatus } from '../../test/fakePush'
import { RemindersSection } from './RemindersSection'

let n = 0
let repo: CycleRepository

async function setup({ status = 200, user = { id: 'u' } as unknown, home = false } = {}) {
  repo = createCycleRepository({ dbName: `reminders-ui-${++n}`, requestPersist: () => Promise.resolve(true) })
  const auth = { user, onChange: () => () => {} }
  const push = new FakePush(auth)
  if (home) push.support = { supported: false, reason: 'requires-home-screen' }
  const service = new ReminderService({ push, repo, auth, storage: new MemoryStorage(), fetch: fetchStatus(status) })
  render(<RemindersSection service={service} />)
  await service.refreshAvailability()
  return { push, service, user: userEvent.setup() }
}

afterEach(async () => {
  cleanup()
  await repo.close()
})

describe('RemindersSection', () => {
  it('shows a calm "coming soon" while push is not configured (503): no controls, no error', async () => {
    await setup({ status: 503 })
    expect(await screen.findByText(/Coming soon: reminders when your period is due/)).toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('explains the Home Screen requirement on iPhone and iPad', async () => {
    await setup({ home: true })
    expect(await screen.findByText(/add Cycle to your Home Screen/)).toBeInTheDocument()
  })

  it('asks to sign in, and says logging stays local', async () => {
    await setup({ user: null })
    expect(await screen.findByText(/Sign in above to use reminders/)).toBeInTheDocument()
    expect(screen.getByText(/your logged data stays on this device/)).toBeInTheDocument()
  })

  it('turns a daily pill reminder on with generic notification text', async () => {
    const { push, user } = await setup()
    expect(await screen.findByText(/never mention periods, fertility or pills/)).toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: 'Daily pill reminder' }))
    await user.clear(screen.getByLabelText('Time of day'))
    await user.type(screen.getByLabelText('Time of day'), '08:30')
    await user.click(screen.getByRole('button', { name: 'Save reminders' }))
    expect(await screen.findByText('Reminders saved.')).toBeInTheDocument()
    expect(push.calls).toEqual(['subscribe', `schedule pill ${JSON.stringify({ daily: '08:30' })}`, 'cancel period-due', 'cancel fertile-start'])
    await waitFor(() => expect(screen.getByRole('list', { name: 'Upcoming reminders' })).toHaveTextContent('Pill'))
  })
})
