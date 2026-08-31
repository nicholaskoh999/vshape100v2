/**
 * Notification click routing.
 *
 * Split out of sw.js so it can be executed by a test rather than only read by
 * one. A regex over the service worker proves the code LOOKS right; running
 * these functions proves it BEHAVES right, which is what matters for a fallback
 * that only fires when something else has already gone wrong.
 *
 * Loaded by sw.js via importScripts, so it is the same file that ships.
 */

;(function attach(scope) {
  const FALLBACK_PATH = '/today'

  /**
   * A safe same-origin path from untrusted push data.
   *
   * A push payload is data, not instructions. Only a PATH is ever accepted:
   * anything absolute, protocol-relative or carrying a scheme is discarded,
   * because opening an attacker-chosen origin from a notification the user
   * trusts is the whole risk here.
   */
  function safePath(value) {
    if (typeof value !== 'string') return FALLBACK_PATH
    // `//evil.example` is protocol-relative and resolves OFF this origin.
    if (value.startsWith('//')) return FALLBACK_PATH
    if (!/^\/[A-Za-z0-9\-._~/]*$/.test(value)) return FALLBACK_PATH
    return value
  }

  /**
   * The first window of this app, if one is open.
   *
   * Other origins are ignored outright rather than focused: a window that is
   * not ours is not ours to move.
   */
  function findAppClient(clients, origin) {
    for (const client of clients) {
      try {
        if (new URL(client.url).origin === origin) return client
      } catch {
        // A client whose url cannot be parsed is not one we can reason about.
      }
    }
    return null
  }

  /**
   * Focus an existing window and take it to `href`, or open a new one.
   *
   * The fallback is the point. `client.navigate` is unavailable in some
   * browsers and rejects in others (a client that is not controlled, for
   * instance). Previously that path simply ended, leaving a focused window
   * still showing whatever it showed before — the notification did nothing.
   * Now every failure leads to `openWindow`, so a click always lands somewhere.
   */
  async function openTarget(clientsApi, origin, href) {
    let windows = []
    try {
      windows = await clientsApi.matchAll({ type: 'window', includeUncontrolled: true })
    } catch {
      windows = []
    }

    const client = findAppClient(windows, origin)

    if (client) {
      try {
        await client.focus()
      } catch {
        // Focus can be refused; navigation is still worth attempting.
      }

      if (typeof client.navigate === 'function') {
        try {
          await client.navigate(href)
          return 'navigated'
        } catch {
          // Fall through to opening a window.
        }
      }
    }

    await clientsApi.openWindow(href)
    return 'opened'
  }

  scope.vshapeSwRouting = { FALLBACK_PATH, safePath, findAppClient, openTarget }
})(typeof self === 'undefined' ? globalThis : self)
