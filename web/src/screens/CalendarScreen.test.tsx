// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { CycleRepoContext, type CycleRepository, createCycleRepository } from '../data'
import { formatDayMonth, formatLong } from '../dates'
import { CalendarScreen } from './CalendarScreen'
import { TodayScreen } from './TodayScreen'

const TODAY = '2026-10-15'
let n = 0
let repo: CycleRepository

async function setup(seed?: (repo: CycleRepository) => Promise<unknown>, screenEl = <CalendarScreen today={TODAY} />) {
  repo = createCycleRepository({ dbName: `calendar-${++n}`, requestPersist: () => Promise.resolve(true) })
  await seed?.(repo)
  const user = userEvent.setup()
  render(<CycleRepoContext.Provider value={repo}>{screenEl}</CycleRepoContext.Provider>)
  return { user }
}

afterEach(async () => {
  cleanup()
  await repo.close()
})

const days = () => within(screen.getByRole('list', { name: /Days in/ }))

describe('CalendarScreen', () => {
  it('renders one labelled button per day of the month', async () => {
    await setup()
    await screen.findByRole('list', { name: /Days in/ })
    const buttons = days().getAllByRole('button')
    expect(buttons).toHaveLength(31)
    expect(buttons[0]).toHaveAccessibleName(formatLong('2026-10-01'))
    const today = days().getByRole('button', { name: `${formatLong(TODAY)}, today` })
    expect(today).toHaveAttribute('aria-current', 'date')
  })

  it('moves between months and back to today', async () => {
    const { user } = await setup()
    await screen.findByRole('list', { name: /Days in/ })
    await user.click(screen.getByRole('button', { name: 'Next month' }))
    await waitFor(() => expect(days().getAllByRole('button')).toHaveLength(30))
    expect(days().getAllByRole('button')[0]).toHaveAccessibleName(formatLong('2026-11-01'))
    await user.click(screen.getByRole('button', { name: 'Jump to today' }))
    await waitFor(() => expect(days().getAllByRole('button')).toHaveLength(31))
  })

  it('marks logged, estimated and fertile days, and labels them', async () => {
    await setup(async (r) => {
      await r.upsertPeriod({ start: '2026-08-20', end: '2026-08-24' })
      await r.upsertPeriod({ start: '2026-09-17', end: '2026-09-21' })
      await r.upsertPeriod({ start: '2026-10-15' })
      await r.putDay({ date: TODAY, flow: 'heavy', symptoms: ['cramps'], note: 'ow' })
    })
    const today = await screen.findByRole('button', {
      name: `${formatLong(TODAY)}, today, period, heavy flow, symptoms logged, has a note`,
    })
    expect(today).toHaveAttribute('data-period', 'true')
    // 28-day cycles → fertile window estimated in late October.
    const fertile = days()
      .getAllByRole('button')
      .filter((b) => b.hasAttribute('data-fertile'))
    expect(fertile.length).toBeGreaterThan(0)
    expect(fertile[0]).toHaveAccessibleName(expect.stringContaining('estimated fertile window'))
    expect(screen.getByText(/not medical advice/)).toBeInTheDocument()
  })

  it('shows a period immediately after logging it from a day', async () => {
    const { user } = await setup()
    await user.click(await screen.findByRole('button', { name: formatLong('2026-10-12') }))
    await user.click(await screen.findByRole('button', { name: 'Period started this day' }))
    await user.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() =>
      expect(days().getByRole('button', { name: `${formatLong('2026-10-12')}, period` })).toHaveAttribute('data-period'),
    )
    expect(days().getByRole('button', { name: `${formatLong(TODAY)}, today, period` })).toBeInTheDocument()
  })
})

describe('TodayScreen', () => {
  it('starts and ends a period today, and labels the estimate', async () => {
    const { user } = await setup(
      async (r) => {
        await r.upsertPeriod({ start: '2026-08-20', end: '2026-08-24' })
        await r.upsertPeriod({ start: '2026-09-17', end: '2026-09-21' })
      },
      <TodayScreen today={TODAY} />,
    )
    expect(await screen.findByRole('heading', { name: 'Cycle day 29' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Next period \(estimate\)/ })).toBeInTheDocument()
    expect(screen.getByText(/Don't rely on it for contraception/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Period started today' }))
    expect(await screen.findByRole('heading', { name: 'Period day 1' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Period ended today' }))
    await waitFor(async () => expect((await repo.listPeriods()).at(-1)).toMatchObject({ start: TODAY, end: TODAY }))
  })

  it('shows the next fertile window that has not ended yet', async () => {
    await setup(
      async (r) => {
        await r.upsertPeriod({ start: '2026-07-26', end: '2026-07-30' })
        await r.upsertPeriod({ start: '2026-08-22', end: '2026-08-26' })
        await r.upsertPeriod({ start: '2026-09-19', end: '2026-09-23' })
      },
      <TodayScreen today={TODAY} />,
    )
    // Next period ~17 Oct, so the window before it (26 Sep – 6 Oct) is over; show the one after (range 11–17 Nov).
    expect(
      await screen.findByText(`Estimated fertile window: ${formatDayMonth('2026-10-23')} – ${formatDayMonth('2026-11-04')}.`),
    ).toBeInTheDocument()
  })

  it('asks a new user for their first period and shows no estimate', async () => {
    await setup(undefined, <TodayScreen today={TODAY} />)
    expect(await screen.findByRole('heading', { name: 'Welcome to Cycle' })).toBeInTheDocument()
    expect(screen.queryByText(/estimate/i)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Log today' })).toBeInTheDocument()
  })
})
