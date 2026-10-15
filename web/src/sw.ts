// Cycle's service worker (vite-plugin-pwa injectManifest). It does what the
// generated one did (precache everything, serve index.html for navigations
// so the app opens offline, take over immediately) and adds the fas.push
// handler for reminders (#148).

/// <reference lib="webworker" />
import { registerFasPushHandler } from '@freeappstore/sdk/push-sw'
import { clientsClaim } from 'workbox-core'
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'

declare const self: ServiceWorkerGlobalScope

precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()

// SPA fallback: without it, opening from the home screen shows a blank page offline.
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html'), { denylist: [/^\/api/, /^\/v1/] }))

// Activate new deploys straight away (registerType: 'autoUpdate').
void self.skipWaiting()
clientsClaim()

// Pushes carry no payload and may show on a lock screen, so the text is
// deliberately generic: it never mentions periods, fertility or pills.
registerFasPushHandler({
  title: 'Reminder',
  body: 'Check your calendar.',
  icon: '/icon-192.png',
  tag: 'cycle-reminder',
  onClick: () => '/',
})
