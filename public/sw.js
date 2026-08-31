/**
 * VShape100 service worker.
 *
 * It does exactly two things: show a notification when one is pushed, and open
 * the right screen when it is clicked.
 *
 * ## What it deliberately does NOT do
 *
 * There is no `fetch` handler here, and no cache. A service worker that
 * intercepts requests can serve a previous deployment's assets after a new one
 * ships, and a stale app is a much worse bug than a missing offline mode. When
 * offline support is genuinely wanted it should be its own round, designed
 * with deployment freshness in mind. Round 14 needed a service worker only
 * because Web Push requires one.
 *
 * ## Trust
 *
 * A push payload is data, not instructions. The only field that can move the
 * user is `to`, and it is treated as a PATH on this origin — never as a URL.
 * The routing rules live in sw-routing.js so they can be executed by a test
 * rather than only matched by a regex.
 */

importScripts('/sw-routing.js')

const { safePath, openTarget } = self.vshapeSwRouting

const APP_NAME = 'VShape100'
const ICON = '/icon-192.png'
const BADGE = '/icon-192.png'

function readPayload(event) {
  if (!event.data) return null
  try {
    return event.data.json()
  } catch {
    return null
  }
}

self.addEventListener('install', () => {
  // Take over as soon as possible; there is nothing to pre-cache.
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('push', (event) => {
  const payload = readPayload(event)

  // A push with no readable payload still has to show something: browsers
  // require a visible notification for every push, and silently swallowing it
  // can cost the site its push permission.
  const title = (payload && typeof payload.title === 'string' && payload.title) || APP_NAME
  const body = (payload && typeof payload.body === 'string' && payload.body) || ''
  const path = safePath(payload && payload.to)
  // A deterministic tag per trigger minute: a re-delivery replaces the banner
  // rather than stacking a second one.
  const tag = (payload && typeof payload.tag === 'string' && payload.tag) || 'vshape'

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag,
      icon: ICON,
      badge: BADGE,
      // Reminders are for right now; a silent re-show would be pointless.
      renotify: false,
      requireInteraction: false,
      data: { path },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  const path = safePath(event.notification.data && event.notification.data.path)
  const target = new URL(path, self.location.origin)

  // Focus and navigate an existing window when that works, and open a new one
  // whenever it does not — a click must always land somewhere.
  event.waitUntil(openTarget(self.clients, self.location.origin, target.href))
})
