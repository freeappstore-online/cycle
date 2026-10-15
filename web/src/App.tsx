import { Suspense, lazy, useEffect, useState } from 'react'
import { BuildInfo, type NavItem, Shell } from '@freeappstore/sdk/ui'
import { AppBadge } from './components/AppBadge'
import { useToday } from './dates'
import { fas } from './fas'
import { CalendarScreen } from './screens/CalendarScreen'
import { SettingsScreen } from './screens/SettingsScreen'
import { TodayScreen } from './screens/TodayScreen'
import { syncEngine } from './sync'

// Insights pulls in Recharts; load it only on that route so it stays out of the main chunk.
const InsightsScreen = lazy(() => import('./screens/InsightsScreen'))

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
  const today = useToday()

  // Optional encrypted sync: idle unless the user turned it on in Settings.
  useEffect(() => syncEngine.start(), [])

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
        <Screen path={path} today={today} onNavigate={navigate} />
      </div>
      <BuildInfo />
      <AppBadge today={today} />
    </Shell>
  )
}

function Screen({ path, today, onNavigate }: { path: string; today: string; onNavigate: (href: string) => void }) {
  switch (path) {
    case '/calendar':
      return <CalendarScreen today={today} />
    case '/insights':
      return (
        <Suspense fallback={<p className="text-[var(--muted)]">Loading…</p>}>
          <InsightsScreen onNavigate={onNavigate} />
        </Suspense>
      )
    case '/settings':
      return <SettingsScreen today={today} />
    default:
      return <TodayScreen today={today} />
  }
}

