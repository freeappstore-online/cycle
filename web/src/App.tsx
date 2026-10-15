import { useEffect, useState } from 'react'
import { initApp } from '@freeappstore/sdk'
import { BuildInfo, type NavItem, PageHeader, Shell } from '@freeappstore/sdk/ui'

const fas = initApp({ appId: 'cycle' })

// The app's screens. Shell renders them as its navbar (<nav aria-label="Main">,
// current screen highlighted, a menu on phones). `title` becomes the browser
// tab title on that route.
const NAV: NavItem[] = [
  { label: 'Today', href: '/', title: 'Today — Cycle' },
  { label: 'Calendar', href: '/calendar', title: 'Calendar — Cycle' },
  { label: 'Insights', href: '/insights', title: 'Insights — Cycle' },
  { label: 'Settings', href: '/settings', title: 'Settings — Cycle' },
]

export default function App() {
  const [path, setPath] = useState(() => window.location.pathname)

  // Keep the screen in step with the browser's back and forward buttons.
  useEffect(() => {
    const sync = () => setPath(window.location.pathname)
    window.addEventListener('popstate', sync)
    return () => window.removeEventListener('popstate', sync)
  }, [])

  // Nav clicks switch screens without a page load. Shell scrolls to the top
  // and moves focus to the new screen's PageHeader.
  const navigate = (href: string) => {
    window.history.pushState(null, '', href)
    setPath(href)
  }

  return (
    <Shell app={fas} appName="Cycle" nav={NAV} onNavigate={navigate}>
      <div className="mx-auto w-full max-w-3xl p-4 sm:p-8">
        <Screen path={path} />
      </div>
      <BuildInfo />
    </Shell>
  )
}

function Screen({ path }: { path: string }) {
  switch (path) {
    case '/calendar':
      return (
        <>
          <PageHeader title="Calendar" description="Past periods and predicted dates." />
          <ComingSoon />
        </>
      )
    case '/insights':
      return (
        <>
          <PageHeader title="Insights" description="Cycle length, period length and symptom trends." />
          <ComingSoon />
        </>
      )
    case '/settings':
      return (
        <>
          <PageHeader title="Settings" description="Sync, export and about." />
          <ComingSoon />
          <p className="mt-4 text-[var(--muted)]">
            Cycle is a free, MIT-licensed app on{' '}
            <a href="https://freeappstore.online" className="underline">
              FreeAppStore
            </a>
            .
          </p>
        </>
      )
    default:
      return (
        <>
          <PageHeader title="Today" description="Log your period, flow and symptoms." />
          <ComingSoon />
        </>
      )
  }
}

// Placeholder body until the screens are built. The app doesn't track
// anything yet, so it says so plainly.
function ComingSoon() {
  return (
    <p className="rounded-[var(--radius)] border border-[var(--line)] bg-[var(--panel)] p-4 text-[var(--muted)]">
      Coming soon. Cycle is a private period tracker in development; this screen doesn't store
      anything yet.
    </p>
  )
}
