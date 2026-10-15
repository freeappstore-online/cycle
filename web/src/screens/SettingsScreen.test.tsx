// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CycleRepoContext } from '../data/RepoContext'
import { type CycleRepository, createCycleRepository } from '../data/repository'
import { SyncEngine, memorySyncStateStore } from '../sync/engine'
import { FakeKv } from '../test/fakeKv'
import { type SettingsAuth, SettingsScreen } from './SettingsScreen'
import fixtureV1 from '../backup/fixtures/backup-v1.json'

let n = 0
let repo: CycleRepository

function fakeAuth(user: { login: string } | null): SettingsAuth & { user: { login: string } | null } {
  const listeners = new Set<(u: { login: string } | null) => void>()
  const auth = {
    user,
    onChange(l: (u: { login: string } | null) => void) {
      listeners.add(l)
      l(auth.user)
      return () => listeners.delete(l)
    },
    signIn: vi.fn(),
    signInWithEmail: vi.fn(async () => {}),
    signOut: vi.fn(() => {
      auth.user = null
      listeners.forEach((l) => l(null))
    }),
  }
  return auth
}

function setup(user: { login: string } | null, kv = new FakeKv()) {
  repo = createCycleRepository({ dbName: `settings-${++n}`, requestPersist: () => Promise.resolve(true) })
  const auth = fakeAuth(user)
  const engine = new SyncEngine({ repo, kv, auth, store: memorySyncStateStore(), iterations: 1000 })
  render(
    <CycleRepoContext.Provider value={repo}>
      <SettingsScreen engine={engine} auth={auth} today="2026-10-15" />
    </CycleRepoContext.Provider>,
  )
  return { auth, engine, kv, user: userEvent.setup() }
}

afterEach(async () => {
  cleanup()
  await repo.close()
})

describe('SettingsScreen', () => {
  it('offers sign-in when signed out, and says the app works without it', async () => {
    const { auth, user } = setup(null)
    expect(screen.getByText(/works fully on this device without an account/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Sign in with Google' }))
    expect(auth.signIn).toHaveBeenCalledWith('google')
    await user.type(screen.getByLabelText(/sign-in link by email/), 'me@example.com')
    await user.click(screen.getByRole('button', { name: 'Email me a link' }))
    expect(auth.signInWithEmail).toHaveBeenCalledWith('me@example.com')
    expect(await screen.findByText(/Check your inbox/)).toBeInTheDocument()
  })

  it('sets a passphrase, turns sync on, and turns it off again', async () => {
    const { user, kv } = setup({ login: 'sam' })
    await repo.putDay({ date: '2026-03-01', symptoms: ['cramps'] })
    expect(await screen.findByText(/Choose a passphrase/)).toBeInTheDocument()

    await user.type(screen.getByLabelText('New passphrase'), 'river stone lantern')
    await user.type(screen.getByLabelText('Confirm passphrase'), 'river stone lanterns')
    await user.click(screen.getByRole('button', { name: 'Turn on sync' }))
    expect(await screen.findByRole('alert')).toHaveTextContent("don't match")
    expect(kv.data.size).toBe(0)

    await user.clear(screen.getByLabelText('Confirm passphrase'))
    await user.type(screen.getByLabelText('Confirm passphrase'), 'river stone lantern')
    await user.click(screen.getByRole('button', { name: 'Turn on sync' }))
    expect(await screen.findByText(/Sync is on\. Last synced/)).toBeInTheDocument()
    expect([...kv.data.keys()].sort()).toEqual(['cycle:meta', 'cycle:y2026'])
    expect(screen.getByRole('checkbox', { name: 'Remember on this device' })).not.toBeChecked()

    await user.click(screen.getByRole('button', { name: 'Turn off sync' }))
    await user.click(screen.getByRole('button', { name: 'Turn off and delete cloud copy' }))
    await waitFor(() => expect(kv.data.size).toBe(0))
    expect(await screen.findByText(/Choose a passphrase/)).toBeInTheDocument()
    expect(await repo.getDay('2026-03-01')).toBeDefined()
  })

  it('asks for the existing passphrase and rejects a wrong one', async () => {
    const kv = new FakeKv()
    const first = setup({ login: 'sam' }, kv)
    await first.engine.enable('river stone lantern', { remember: false })
    cleanup()
    await repo.close()

    const { user } = setup({ login: 'sam' }, kv)
    expect(await screen.findByText(/already has synced Cycle data/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Confirm passphrase')).not.toBeInTheDocument()
    await user.type(screen.getByLabelText('Passphrase'), 'wrong words here')
    await user.click(screen.getByRole('button', { name: 'Turn on sync' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/doesn't match/)

    await user.click(screen.getByRole('button', { name: 'Forgot passphrase?' }))
    expect(screen.getByText(/nobody, including FreeAppStore, can recover it/)).toBeInTheDocument()
  })

  it('restores a backup file after preview and confirmation', async () => {
    const { user } = setup(null)
    await repo.putDay({ date: '2026-01-01', symptoms: ['acne'] })
    const file = new File([JSON.stringify(fixtureV1)], 'cycle-backup.json', { type: 'application/json' })
    await user.upload(screen.getByLabelText(/Choose a Cycle backup file/), file)
    expect(await screen.findByText(/4 logged days and 2 periods/)).toBeInTheDocument()
    expect(await repo.getDay('2026-08-20')).toBeUndefined()

    await user.click(screen.getByRole('radio', { name: /Replace/ }))
    await user.click(screen.getByRole('button', { name: 'Restore' }))
    await user.click(screen.getByRole('button', { name: 'Replace' }))
    expect(await screen.findByText(/Backup restored/)).toBeInTheDocument()
    expect(await repo.getDay('2026-08-20')).toMatchObject({ flow: 'heavy' })
    expect(await repo.getDay('2026-01-01')).toBeUndefined()
  })

  it('rejects a malformed file without changing anything', async () => {
    const { user } = setup(null)
    await repo.putDay({ date: '2026-01-01', symptoms: ['acne'] })
    await user.upload(screen.getByLabelText(/Choose a Cycle backup file/), new File(['{"days": ['], 'broken.json', { type: 'application/json' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/isn't valid JSON/)
    expect(await repo.getDay('2026-01-01')).toBeDefined()
  })

  it('offers plain backups when sync is off, encrypted once it is on', async () => {
    const { engine } = setup({ login: 'sam' })
    expect(screen.getByRole('radio', { name: /Encrypted/ })).toBeDisabled()
    expect(screen.getByRole('radio', { name: /Plain JSON/ })).toBeChecked()
    await engine.enable('river stone lantern', { remember: false })
    await waitFor(() => expect(screen.getByRole('radio', { name: /Encrypted/ })).toBeChecked())
  })

  it('defaults the doctor summary to the last 6 months', () => {
    setup(null)
    expect(screen.getByLabelText('From')).toHaveValue('2026-04-15')
    expect(screen.getByLabelText('To')).toHaveValue('2026-10-15')
    expect(screen.getByRole('button', { name: 'Download PDF' })).toBeEnabled()
  })

  it('explains privacy under accessible headings', () => {
    setup(null)
    const privacy = screen.getByRole('region', { name: 'Privacy' })
    for (const h of ['On this device', 'If you turn on sync', 'Page-view counts', 'Delete all data']) {
      expect(within(privacy).getByRole('heading', { name: h, level: 3 })).toBeInTheDocument()
    }
    expect(within(privacy).getByText(/IndexedDB/)).toBeInTheDocument()
    expect(within(privacy).getByText(/without cookies and without your account/)).toBeInTheDocument()
    expect(within(privacy).getByText(/Cloudflare Web Analytics/)).toBeInTheDocument()
  })

  it('deletes all local and cloud data after confirmation', async () => {
    const { user, engine, kv } = setup({ login: 'sam' })
    await repo.putDay({ date: '2026-03-01', symptoms: ['cramps'] })
    await engine.enable('river stone lantern', { remember: false })
    expect(kv.data.size).toBeGreaterThan(0)

    await user.click(screen.getByRole('button', { name: 'Delete all data' }))
    expect(screen.getByText(/and the encrypted copy in your account/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Delete everything' }))
    expect(await screen.findByText('All Cycle data was deleted.')).toBeInTheDocument()
    expect(kv.data.size).toBe(0)
    expect(await repo.getDay('2026-03-01')).toBeUndefined()
  })

  it('asks to sign in first when sync is on but signed out', async () => {
    const { engine, auth } = setup({ login: 'sam' })
    await engine.enable('river stone lantern', { remember: false })
    auth.signOut()
    expect(await screen.findByText(/sign in first \(above\) to delete the encrypted copy/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete all data' })).toBeDisabled()
  })

  it('re-opens the introduction from About', async () => {
    repo = createCycleRepository({ dbName: `settings-${++n}` })
    const onShowIntro = vi.fn()
    render(
      <CycleRepoContext.Provider value={repo}>
        <SettingsScreen engine={new SyncEngine({ repo, kv: new FakeKv(), auth: fakeAuth(null), store: memorySyncStateStore() })} auth={fakeAuth(null)} today="2026-10-15" onShowIntro={onShowIntro} />
      </CycleRepoContext.Provider>,
    )
    await userEvent.setup().click(screen.getByRole('button', { name: 'Show the introduction again' }))
    expect(onShowIntro).toHaveBeenCalled()
  })
})
