// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CycleRepoContext } from '../data/RepoContext'
import { type CycleRepository, createCycleRepository } from '../data/repository'
import { addDays } from '../predict'
import InsightsScreen from './InsightsScreen'

let n = 0
let repo: CycleRepository

async function setup(lengths: number[], seed?: (repo: CycleRepository, starts: string[]) => Promise<unknown>) {
  repo = createCycleRepository({ dbName: `insights-${++n}`, requestPersist: () => Promise.resolve(true) })
  const starts = ['2026-01-01']
  for (const l of lengths) starts.push(addDays(starts.at(-1)!, l))
  for (const s of starts) await repo.upsertPeriod({ start: s, end: addDays(s, 4) })
  await seed?.(repo, starts)
  const onNavigate = vi.fn()
  render(
    <CycleRepoContext.Provider value={repo}>
      <InsightsScreen onNavigate={onNavigate} />
    </CycleRepoContext.Provider>,
  )
  return { onNavigate, user: userEvent.setup() }
}

afterEach(async () => {
  cleanup()
  await repo.close()
})

describe('InsightsScreen', () => {
  it('points back to logging with fewer than two complete cycles', async () => {
    const { onNavigate, user } = await setup([28])
    expect(await screen.findByRole('heading', { name: 'Not enough cycles yet' })).toBeInTheDocument()
    expect(screen.getByText(/You have one complete cycle so far/)).toBeInTheDocument()
    await user.click(screen.getByRole('link', { name: 'Calendar' }))
    expect(onNavigate).toHaveBeenCalledWith('/calendar')
  })

  it('shows summary stats, a described chart with a table view, and a text heatmap', async () => {
    await setup([27, 29, 28], async (r, starts) => {
      for (const s of starts.slice(0, 3)) await r.putDay({ date: s, symptoms: ['cramps'] })
      await r.putDay({ date: addDays(starts[0], 14), symptoms: ['bloating'] })
    })
    const summary = await screen.findByRole('region', { name: 'Summary' })
    expect(within(summary).getByText('Average cycle').nextSibling).toHaveTextContent('28 days')
    expect(within(summary).getByText('Average period').nextSibling).toHaveTextContent('5 days')
    expect(within(summary).getByText('±1 day')).toBeInTheDocument()
    expect(within(summary).getByText('Cycles logged').nextSibling).toHaveTextContent('3')

    expect(screen.getByText(/ran from 27 to 29 days; the average is 28 days/)).toBeInTheDocument()
    const cycles = screen.getByRole('table', { name: /All complete cycles/ })
    expect(within(cycles).getAllByRole('row')).toHaveLength(4)

    const heatmap = screen.getByRole('table', { name: /Percentage of cycle days with each symptom/ })
    expect(within(heatmap).getByRole('columnheader', { name: '1–5' })).toBeInTheDocument()
    const cramps = within(heatmap).getByRole('rowheader', { name: 'Cramps' }).closest('tr')!
    // Logged on day 1 of all three cycles: 3 of 15 cycle days in days 1–5.
    expect(within(cramps).getAllByRole('cell')[0]).toHaveTextContent('20%')
    expect(within(cramps).getAllByRole('cell')[0]).toHaveAttribute('title', 'Cramps, days 1–5: 3 of 15 cycle days (20%)')
    expect(within(heatmap).getByRole('rowheader', { name: 'Bloating' })).toBeInTheDocument()
    expect(screen.getByText('Do not use this app for contraception.')).toBeInTheDocument()
  })

  it('says so when no symptoms were logged', async () => {
    await setup([28, 28])
    expect(await screen.findByText(/No symptoms logged during your complete cycles yet/)).toBeInTheDocument()
  })
})
