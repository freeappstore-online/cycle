// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CycleRepoContext, type CycleRepository, createCycleRepository } from '../data'
import { formatLong } from '../dates'
import { DaySheet } from './DaySheet'

const TODAY = '2026-10-15'
let n = 0
let repo: CycleRepository

function setup(date: string = TODAY) {
  repo = createCycleRepository({ dbName: `daysheet-${++n}`, requestPersist: () => Promise.resolve(true) })
  const onClose = vi.fn()
  const user = userEvent.setup()
  const utils = render(
    <CycleRepoContext.Provider value={repo}>
      <DaySheet date={date} today={TODAY} onClose={onClose} />
    </CycleRepoContext.Provider>,
  )
  return { ...utils, onClose, user }
}

afterEach(async () => {
  cleanup()
  await repo.close()
})

const group = (name: string) => within(screen.getByRole('group', { name }))

describe('DaySheet', () => {
  it('is a dialog named by the full date, with labelled pickers', async () => {
    setup()
    const dialog = screen.getByRole('dialog', { name: formatLong(TODAY) })
    expect(dialog).toBeInTheDocument()
    await screen.findByRole('group', { name: 'Flow' })
    expect(screen.getByRole('group', { name: 'Symptoms' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Mood' })).toBeInTheDocument()
    expect(screen.getByLabelText('Notes')).toBeInTheDocument()
    expect(group('Flow').getByRole('radio', { name: 'None' })).toBeChecked()
  })

  it('logs flow, symptoms, mood and a note and persists them', async () => {
    const { user, onClose } = setup()
    await screen.findByRole('group', { name: 'Flow' })
    await user.click(group('Flow').getByRole('radio', { name: 'Medium' }))
    await user.click(group('Symptoms').getByRole('checkbox', { name: 'Cramps' }))
    await user.click(group('Symptoms').getByRole('checkbox', { name: 'Tender breasts' }))
    await user.click(group('Mood').getByRole('radio', { name: 'Calm' }))
    await user.type(screen.getByLabelText('Notes'), '  Took ibuprofen  ')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(await repo.getDay(TODAY)).toMatchObject({
      date: TODAY,
      flow: 'medium',
      symptoms: ['cramps', 'tender_breasts'],
      mood: 'calm',
      note: 'Took ibuprofen',
    })
  })

  it('opens a past day pre-filled and saves edits to it', async () => {
    const date = '2026-10-02'
    repo = createCycleRepository({ dbName: `daysheet-${++n}` })
    await repo.putDay({ date, flow: 'heavy', symptoms: ['acne'], mood: 'sad', note: 'hi' })
    await repo.close()
    n-- // reuse the same database in setup()
    const { user } = setup(date)

    await waitFor(() => expect(group('Flow').getByRole('radio', { name: 'Heavy' })).toBeChecked())
    expect(group('Symptoms').getByRole('checkbox', { name: 'Acne' })).toBeChecked()
    expect(group('Mood').getByRole('radio', { name: 'Sad' })).toBeChecked()
    expect(screen.getByLabelText('Notes')).toHaveValue('hi')

    await user.click(group('Flow').getByRole('radio', { name: 'Light' }))
    await user.click(group('Symptoms').getByRole('checkbox', { name: 'Acne' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(async () => expect(await repo.getDay(date)).toMatchObject({ flow: 'light', symptoms: [] }))
  })

  it('deletes a day after confirmation', async () => {
    repo = createCycleRepository({ dbName: `daysheet-${++n}` })
    await repo.putDay({ date: TODAY, symptoms: ['fatigue'] })
    await repo.close()
    n--
    const { user, onClose } = setup()

    await user.click(await screen.findByRole('button', { name: 'Delete day' }))
    expect(screen.getByText('Delete this day?')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(await repo.getDay(TODAY)).toBeUndefined()
  })

  it('logs a period start and end from the sheet', async () => {
    const { user } = setup('2026-10-12')
    await user.click(await screen.findByRole('button', { name: 'Period started this day' }))
    await waitFor(async () => expect(await repo.listPeriods()).toEqual([expect.objectContaining({ start: '2026-10-12' })]))
    expect((await repo.listPeriods())[0].end).toBeUndefined()
    expect(await screen.findByText(/Period day 1, ongoing/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Period ended this day' }))
    await waitFor(async () => expect(await repo.listPeriods()).toMatchObject([{ start: '2026-10-12', end: '2026-10-12' }]))
  })

  it('removes a period after confirmation, keeping day logs', async () => {
    repo = createCycleRepository({ dbName: `daysheet-${++n}` })
    await repo.upsertPeriod({ start: '2026-10-10', end: '2026-10-14' })
    await repo.putDay({ date: '2026-10-11', flow: 'heavy', symptoms: [] })
    await repo.close()
    n--
    const { user } = setup('2026-10-11')

    await user.click(await screen.findByRole('button', { name: 'Remove this period' }))
    await user.click(screen.getByRole('button', { name: 'Remove' }))
    await waitFor(async () => expect(await repo.listPeriods()).toEqual([]))
    expect(await repo.getDay('2026-10-11')).toMatchObject({ flow: 'heavy' })
  })

  it("doesn't log future days", async () => {
    setup('2026-10-20')
    expect(await screen.findByText(/hasn't happened yet/)).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Flow' })).not.toBeInTheDocument()
  })
})
