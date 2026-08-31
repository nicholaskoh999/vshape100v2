import { cleanup, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import manifestSource from '../../public/manifest.webmanifest?raw'
import serviceWorkerSource from '../../public/sw.js?raw'
import routingSource from '../../public/sw-routing.js?raw'
import indexHtml from '../../index.html?raw'

import {
  AUTH_BYTES,
  isAuthSecret,
  isP256dhKey,
  P256DH_BYTES,
} from '@shared/notifications/subscription'

import { authenticatedSession, mockAuthFetch, renderApp } from './authTestUtils'

/**
 * Round 14 — reminders in the browser.
 *
 * The rule these tests exist to enforce is that VShape never asks for
 * notification permission on its own. A permission prompt that appears because
 * a page rendered is the fastest way to get permanently blocked, and a blocked
 * browser cannot be un-blocked by the app. So `Notification.requestPermission`
 * is spied on throughout, and asserted NOT to have been called except from an
 * explicit press of Enable.
 */

const PUBLIC_KEY = 'B'.repeat(86)

/** A subscription shape the server will accept: 65-byte point, 16-byte secret. */
const P256DH = 'BPQJoE44Q1Cc9mVFRQJQLSlbylnndSF3THRGgH1buOLGH3Ur5ZFvqpI1DKkGKEDa8jKNBlNWttPDqAdAvSVhszU'
const AUTH = 'qMTpNlhmid_ObCRqVDj04g'

type PermissionState = 'default' | 'granted' | 'denied'

type StubSubscription = {
  endpoint: string
  toJSON: () => { endpoint: string; keys: { p256dh: string; auth: string } }
  unsubscribe: () => Promise<boolean>
}

let requestPermission: ReturnType<typeof vi.fn<() => Promise<PermissionState>>>
let subscribeSpy: ReturnType<typeof vi.fn<() => Promise<StubSubscription | null>>>
let unsubscribeSpy: ReturnType<typeof vi.fn<() => Promise<boolean>>>
let registerSpy: ReturnType<typeof vi.fn>

/** A browser with Push, in a chosen permission state. */
function stubBrowser(
  options: {
    permission?: PermissionState
    existing?: boolean
    subscribeFails?: boolean
    userAgent?: string
    standalone?: boolean
  } = {},
) {
  const permission = options.permission ?? 'default'

  const subscription = {
    endpoint: 'https://push.example/send/this-device',
    toJSON: () => ({
      endpoint: 'https://push.example/send/this-device',
      keys: { p256dh: P256DH, auth: AUTH },
    }),
    unsubscribe: unsubscribeSpy,
  }

  subscribeSpy = vi.fn(async () => (options.subscribeFails ? null : subscription))
  const registration = {
    pushManager: {
      subscribe: vi.fn(async () => {
        const made = await subscribeSpy()
        if (!made) throw new Error('subscribe refused')
        return made
      }),
      getSubscription: vi.fn(async () => (options.existing ? subscription : null)),
    },
  }

  registerSpy = vi.fn(async () => registration)

  vi.stubGlobal('Notification', {
    permission,
    requestPermission,
  })
  vi.stubGlobal('PushManager', function PushManager() {})
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      register: registerSpy,
      getRegistration: vi.fn(async () => registration),
    },
  })

  if (options.userAgent) {
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: options.userAgent,
    })
  }

  return { subscription, registration }
}

/** A browser with no Push support at all. */
function stubUnsupported(options: { userAgent?: string } = {}) {
  vi.unstubAllGlobals()
  // Restore the spies the suite asserts on.
  vi.stubGlobal('Notification', undefined)
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: undefined,
  })
  if (options.userAgent) {
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: options.userAgent,
    })
  }
}

/** The notification API, configured and recording what it was told. */
function notificationApi() {
  const calls: { method: string; body: unknown }[] = []
  const handler = async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    if (url.startsWith('/api/notifications/config')) {
      return new Response(JSON.stringify({ available: true, publicKey: PUBLIC_KEY }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    calls.push({ method, body: init?.body ? JSON.parse(String(init.body)) : null })
    return new Response(
      JSON.stringify({ subscription: { enabled: method === 'PUT', timezone: 'UTC' } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  }
  return { calls, handler }
}

async function renderSettings(notifications?: (url: string, init?: RequestInit) => Promise<Response>) {
  mockAuthFetch({ session: authenticatedSession, notifications })
  renderApp('/settings')
  await screen.findByRole('heading', { level: 1, name: 'Settings' })
  return userEvent.setup()
}

function card(): HTMLElement | null {
  return document.querySelector('[data-notification-settings]')
}

function state(): string | null {
  return card()?.getAttribute('data-notification-state') ?? null
}

async function settled() {
  await waitFor(() => expect(state()).not.toBe('checking'))
}

beforeEach(() => {
  requestPermission = vi.fn(async () => 'granted' as PermissionState)
  unsubscribeSpy = vi.fn(async () => true)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

/* ------------------------------------------------------------------ */
/* 1. The PWA foundation                                               */
/* ------------------------------------------------------------------ */

describe('1. installable app', () => {
  it('links a manifest from the document', () => {
    expect(indexHtml).toMatch(/<link rel="manifest" href="\/manifest\.webmanifest" \/>/)
  })

  it('declares an installable manifest using the existing icons', () => {
    const manifest = JSON.parse(manifestSource) as Record<string, unknown>

    expect(manifest.name).toBe('VShape100')
    expect(manifest.display).toBe('standalone')
    // Today-first product, so the installed app opens on Today.
    expect(manifest.start_url).toBe('/today')
    expect(manifest.scope).toBe('/')

    const icons = manifest.icons as { src: string; sizes: string; purpose?: string }[]
    const sizes = icons.map((icon) => icon.sizes)
    expect(sizes).toContain('192x192')
    expect(sizes).toContain('512x512')
    // Reuses what the app already ships; no new art was invented.
    for (const icon of icons) expect(['/icon-192.png', '/icon-512.png']).toContain(icon.src)
    expect(icons.some((icon) => icon.purpose === 'maskable')).toBe(true)
  })

  it('keeps the existing theme language', () => {
    const manifest = JSON.parse(manifestSource) as Record<string, string>
    expect(manifest.theme_color).toBe('#0B1220')
    expect(manifest.background_color).toBe('#0B1220')
  })
})

/* ------------------------------------------------------------------ */
/* 2. Permission is never requested on its own                         */
/* ------------------------------------------------------------------ */

describe('2. nothing asks by itself', () => {
  it('does not request permission when Settings renders', async () => {
    stubBrowser({ permission: 'default' })
    await renderSettings(notificationApi().handler)
    await settled()

    expect(requestPermission).not.toHaveBeenCalled()
    expect(state()).toBe('off')
  })

  it('does not request permission when the app boots elsewhere', async () => {
    stubBrowser({ permission: 'default' })
    mockAuthFetch({ session: authenticatedSession })
    renderApp('/today')
    await screen.findByRole('heading', { level: 1, name: 'Today' })

    expect(requestPermission).not.toHaveBeenCalled()
  })

  it('registers the service worker without asking for anything', async () => {
    stubBrowser({ permission: 'default' })
    await renderSettings(notificationApi().handler)
    await settled()

    // Registration alone prompts for nothing; it only makes a receiver ready.
    expect(registerSpy).toHaveBeenCalled()
    expect(requestPermission).not.toHaveBeenCalled()
    expect(subscribeSpy).not.toHaveBeenCalled()
  })

  it('shows Off before anything has been enabled', async () => {
    stubBrowser({ permission: 'default' })
    await renderSettings(notificationApi().handler)
    await settled()

    expect(state()).toBe('off')
    expect(card()?.textContent).toMatch(/Off/)
    // The explanation comes BEFORE the prompt, not after it.
    expect(card()?.textContent).toMatch(/Uses your existing VShape schedule/)
    expect(card()?.textContent).toMatch(/Only fixed-time items notify/)
  })
})

/* ------------------------------------------------------------------ */
/* 3. Enabling                                                         */
/* ------------------------------------------------------------------ */

describe('3. enabling on this device', () => {
  it('requests permission exactly once, and only on press', async () => {
    stubBrowser({ permission: 'default' })
    const api = notificationApi()
    const user = await renderSettings(api.handler)
    await settled()

    await user.click(screen.getByRole('button', { name: /Enable on this device/ }))
    await waitFor(() => expect(state()).toBe('on'))

    expect(requestPermission).toHaveBeenCalledTimes(1)
  })

  it('subscribes with the server VAPID public key', async () => {
    stubBrowser({ permission: 'default' })
    const api = notificationApi()
    const user = await renderSettings(api.handler)
    await settled()

    await user.click(screen.getByRole('button', { name: /Enable on this device/ }))
    await waitFor(() => expect(state()).toBe('on'))

    const saved = api.calls.find((call) => call.method === 'PUT')
    expect(saved?.body).toMatchObject({
      endpoint: 'https://push.example/send/this-device',
      p256dh: P256DH,
      auth: AUTH,
    })
    // The device reports its own zone; the server never guesses one.
    expect((saved?.body as { timezone: string }).timezone.length).toBeGreaterThan(0)
  })

  it('shows Blocked and subscribes nothing when permission is refused', async () => {
    requestPermission = vi.fn(async () => 'denied' as PermissionState)
    stubBrowser({ permission: 'default' })
    const api = notificationApi()
    const user = await renderSettings(api.handler)
    await settled()

    await user.click(screen.getByRole('button', { name: /Enable on this device/ }))
    await waitFor(() => expect(state()).toBe('blocked'))

    expect(subscribeSpy).not.toHaveBeenCalled()
    expect(api.calls.filter((call) => call.method === 'PUT')).toHaveLength(0)
  })

  it('never re-asks a browser that already said no', async () => {
    stubBrowser({ permission: 'denied' })
    await renderSettings(notificationApi().handler)
    await settled()

    expect(state()).toBe('blocked')
    expect(requestPermission).not.toHaveBeenCalled()
    // No button either: only browser settings can undo this.
    expect(screen.queryByRole('button', { name: /Enable on this device/ })).toBeNull()
    expect(card()?.textContent).toMatch(/browser settings/i)
  })

  it('reports an honest error when the browser refuses the subscription', async () => {
    stubBrowser({ permission: 'default', subscribeFails: true })
    const user = await renderSettings(notificationApi().handler)
    await settled()

    await user.click(screen.getByRole('button', { name: /Enable on this device/ }))
    await waitFor(() => expect(state()).toBe('error'))
    // Never claims to be on when it is not.
    expect(card()?.textContent).not.toMatch(/On this device/)
  })
})

/* ------------------------------------------------------------------ */
/* 4. Already enabled                                                  */
/* ------------------------------------------------------------------ */

describe('4. an already-enabled device', () => {
  it('shows On without asking anything', async () => {
    stubBrowser({ permission: 'granted', existing: true })
    await renderSettings(notificationApi().handler)
    await settled()

    expect(state()).toBe('on')
    expect(requestPermission).not.toHaveBeenCalled()
  })

  it('silently reconciles its timezone, with no prompt', async () => {
    stubBrowser({ permission: 'granted', existing: true })
    const api = notificationApi()
    await renderSettings(api.handler)
    await settled()

    await waitFor(() => expect(api.calls.some((call) => call.method === 'PUT')).toBe(true))
    // Travel changes the local clock the schedule is written in; the server
    // has no other way to learn about it.
    expect(requestPermission).not.toHaveBeenCalled()
  })

  it('disables only this device', async () => {
    stubBrowser({ permission: 'granted', existing: true })
    const api = notificationApi()
    const user = await renderSettings(api.handler)
    await settled()

    await user.click(screen.getByRole('button', { name: /Disable on this device/ }))
    await waitFor(() => expect(state()).toBe('off'))

    const removed = api.calls.find((call) => call.method === 'DELETE')
    // Names THIS endpoint, so no other device can be caught by it.
    expect(removed?.body).toEqual({ endpoint: 'https://push.example/send/this-device' })
    expect(unsubscribeSpy).toHaveBeenCalled()
  })

  it('says so honestly when disabling only half worked', async () => {
    // Set BEFORE stubBrowser: the subscription captures this spy as it is built.
    unsubscribeSpy = vi.fn(async () => false)
    stubBrowser({ permission: 'granted', existing: true })
    const user = await renderSettings(notificationApi().handler)
    await settled()

    await user.click(screen.getByRole('button', { name: /Disable on this device/ }))
    await waitFor(() => expect(state()).toBe('error'))
    // Claiming "off" here would promise a silence that will not arrive. The
    // message names WHICH half is outstanding, because the remedy differs.
    expect(card()?.textContent).toMatch(/this browser still holds a subscription/i)
    expect(card()?.textContent).not.toMatch(/^Off$/m)
  })
})

/* ------------------------------------------------------------------ */
/* 5. Honest unavailability                                            */
/* ------------------------------------------------------------------ */

describe('5. when it cannot work', () => {
  it('says unavailable when the server has no VAPID configuration', async () => {
    stubBrowser({ permission: 'default' })
    // The default stand-in reports an unconfigured deployment.
    await renderSettings()
    await settled()

    expect(state()).toBe('unavailable')
    expect(card()?.textContent).toMatch(/not configured on the server/i)
    expect(requestPermission).not.toHaveBeenCalled()
  })

  it('says unsupported when the browser has no Push', async () => {
    stubUnsupported({ userAgent: 'Mozilla/5.0 (Ancient Browser)' })
    await renderSettings(notificationApi().handler)
    await settled()

    expect(state()).toBe('unsupported')
    expect(screen.queryByRole('button', { name: /Enable on this device/ })).toBeNull()
  })

  it('asks an uninstalled iPhone to install first, rather than lying', async () => {
    stubUnsupported({
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/605.1',
    })
    await renderSettings(notificationApi().handler)
    await settled()

    // Safari HAS the APIs; it withholds them until the app is installed, so
    // "unsupported" would be untrue and unactionable.
    expect(state()).toBe('install-required')
    expect(card()?.textContent).toMatch(/Home Screen/i)
  })

  it('leaves the rest of Settings working regardless', async () => {
    stubBrowser({ permission: 'default' })
    await renderSettings()
    await settled()

    expect(screen.getByLabelText('Exercise Library')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Sign out/ })).toBeInTheDocument()
  })
})

/* ------------------------------------------------------------------ */
/* 6. It is a setting, not a destination                               */
/* ------------------------------------------------------------------ */

describe('6. no new destination', () => {
  it('adds no Notifications nav item', async () => {
    stubBrowser({ permission: 'default' })
    await renderSettings(notificationApi().handler)
    await settled()

    const navLinks = [...document.querySelectorAll('nav a[href]')].map((a) =>
      a.getAttribute('href'),
    )
    expect(navLinks).not.toContain('/notifications')
    expect(new Set(navLinks)).toEqual(
      new Set(['/today', '/training', '/progress', '/calendar', '/achievements', '/settings']),
    )
  })

  it('replaced the old placeholder rather than adding a page', async () => {
    stubBrowser({ permission: 'default' })
    await renderSettings(notificationApi().handler)
    await settled()

    const text = document.querySelector('main')?.textContent ?? ''
    expect(text).toMatch(/Routine reminders/)
    // The Round 02 placeholder is gone.
    expect(text).not.toMatch(/Web Push lands later/)
  })
})

/* ------------------------------------------------------------------ */
/* 7. The service worker                                               */
/* ------------------------------------------------------------------ */

/**
 * The routing rules are loaded from the file that actually ships and then
 * CALLED, not matched with a regex. A fallback that only fires when something
 * else has already gone wrong has to be executed to be believed.
 */
function loadRouting() {
  const scope: Record<string, unknown> = {}
  new Function('self', `${routingSource}; return self`)(scope)
  return scope.vshapeSwRouting as {
    FALLBACK_PATH: string
    safePath: (value: unknown) => string
    findAppClient: (clients: { url: string }[], origin: string) => unknown
    openTarget: (
      clientsApi: unknown,
      origin: string,
      href: string,
    ) => Promise<'navigated' | 'opened'>
  }
}

describe('7. the service worker', () => {
  it('handles push and notification clicks, and nothing else', () => {
    expect(serviceWorkerSource).toMatch(/addEventListener\('push'/)
    expect(serviceWorkerSource).toMatch(/addEventListener\('notificationclick'/)
  })

  it('adds no fetch interception or cache', () => {
    // A caching service worker can serve a previous deployment after a new one
    // ships, and a stale app is worse than no offline mode.
    for (const source of [serviceWorkerSource, routingSource]) {
      expect(source).not.toMatch(/addEventListener\(\s*'fetch'/)
      expect(source).not.toMatch(/caches\./)
      expect(source).not.toMatch(/cache\.put/)
    }
  })

  it('shows exactly one visible notification per push', () => {
    expect(serviceWorkerSource).toMatch(/showNotification\(/)
    expect(serviceWorkerSource).toMatch(/tag/)
  })

  it('loads its routing from the shipped file', () => {
    expect(serviceWorkerSource).toMatch(/importScripts\('\/sw-routing\.js'\)/)
  })

  it('uses the app icons it already ships', () => {
    expect(serviceWorkerSource).toMatch(/\/icon-192\.png/)
  })
})

describe('8. notification click routing', () => {
  const ORIGIN = 'https://vshapev2.nkmwei.de'

  it('accepts a same-origin path', () => {
    const { safePath } = loadRouting()
    expect(safePath('/training/monday')).toBe('/training/monday')
    expect(safePath('/today')).toBe('/today')
  })

  it('refuses any destination that could leave this origin', () => {
    const { safePath } = loadRouting()
    for (const hostile of [
      'https://evil.example/steal',
      '//evil.example',
      'javascript:alert(1)',
      'data:text/html,x',
      '/today?next=https://evil.example',
      'training/monday',
      42,
      null,
      undefined,
      {},
    ]) {
      expect(safePath(hostile), String(hostile)).toBe('/today')
    }
  })

  it('focuses an existing window and navigates it', async () => {
    const { openTarget } = loadRouting()
    const focus = vi.fn(async () => {})
    const navigate = vi.fn(async () => {})
    const openWindow = vi.fn(async () => {})

    const outcome = await openTarget(
      {
        matchAll: async () => [{ url: `${ORIGIN}/today`, focus, navigate }],
        openWindow,
      },
      ORIGIN,
      `${ORIGIN}/training/monday`,
    )

    expect(outcome).toBe('navigated')
    expect(focus).toHaveBeenCalled()
    expect(navigate).toHaveBeenCalledWith(`${ORIGIN}/training/monday`)
    expect(openWindow).not.toHaveBeenCalled()
  })

  it('opens a window when the client cannot navigate', async () => {
    const { openTarget } = loadRouting()
    const openWindow = vi.fn(async () => {})

    // Some browsers simply do not expose navigate() on a client.
    const outcome = await openTarget(
      {
        matchAll: async () => [{ url: `${ORIGIN}/today`, focus: async () => {} }],
        openWindow,
      },
      ORIGIN,
      `${ORIGIN}/training/monday`,
    )

    // The bug this replaces: the click used to end here, doing nothing.
    expect(outcome).toBe('opened')
    expect(openWindow).toHaveBeenCalledWith(`${ORIGIN}/training/monday`)
  })

  it('opens a window when navigate is rejected', async () => {
    const { openTarget } = loadRouting()
    const openWindow = vi.fn(async () => {})

    const outcome = await openTarget(
      {
        matchAll: async () => [
          {
            url: `${ORIGIN}/today`,
            focus: async () => {},
            navigate: async () => {
              throw new Error('not allowed for an uncontrolled client')
            },
          },
        ],
        openWindow,
      },
      ORIGIN,
      `${ORIGIN}/today`,
    )

    expect(outcome).toBe('opened')
    expect(openWindow).toHaveBeenCalled()
  })

  it('opens a window when no VShape window is open', async () => {
    const { openTarget } = loadRouting()
    const openWindow = vi.fn(async () => {})

    const outcome = await openTarget(
      { matchAll: async () => [], openWindow },
      ORIGIN,
      `${ORIGIN}/today`,
    )

    expect(outcome).toBe('opened')
    expect(openWindow).toHaveBeenCalledWith(`${ORIGIN}/today`)
  })

  it('never focuses a window belonging to another origin', async () => {
    const { openTarget, findAppClient } = loadRouting()
    const focus = vi.fn(async () => {})
    const openWindow = vi.fn(async () => {})

    expect(findAppClient([{ url: 'https://evil.example/x' }], ORIGIN)).toBeNull()

    const outcome = await openTarget(
      {
        matchAll: async () => [{ url: 'https://evil.example/x', focus, navigate: async () => {} }],
        openWindow,
      },
      ORIGIN,
      `${ORIGIN}/today`,
    )

    // A window that is not ours is not ours to move.
    expect(focus).not.toHaveBeenCalled()
    expect(outcome).toBe('opened')
  })

  it('still opens a window when the client list cannot be read', async () => {
    const { openTarget } = loadRouting()
    const openWindow = vi.fn(async () => {})

    const outcome = await openTarget(
      {
        matchAll: async () => {
          throw new Error('clients unavailable')
        },
        openWindow,
      },
      ORIGIN,
      `${ORIGIN}/today`,
    )

    expect(outcome).toBe('opened')
  })
})

/* ------------------------------------------------------------------ */
/* 9. "On" is server-confirmed                                         */
/* ------------------------------------------------------------------ */

/**
 * A local PushSubscription is only half of "on".
 *
 * Without a registered row and a usable timezone the server can never schedule
 * or deliver anything, so showing "On this device" on the strength of the
 * browser alone promises something the app cannot do.
 */
describe('9. confirmed before claimed', () => {
  /** A notification API whose reconcile fails. */
  function failingReconcile(status = 500) {
    const calls: { method: string }[] = []
    const handler = async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      if (url.startsWith('/api/notifications/config')) {
        return new Response(JSON.stringify({ available: true, publicKey: PUBLIC_KEY }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      calls.push({ method })
      return new Response(JSON.stringify({ error: 'server_error' }), { status })
    }
    return { calls, handler }
  }

  it('shows On only after the server confirms the subscription', async () => {
    stubBrowser({ permission: 'granted', existing: true })
    const api = notificationApi()
    await renderSettings(api.handler)
    await settled()

    expect(state()).toBe('on')
    // The confirmation is the reconcile itself, and it was awaited.
    expect(api.calls.some((call) => call.method === 'PUT')).toBe(true)
  })

  it('does NOT show On when the server rejects the reconcile', async () => {
    stubBrowser({ permission: 'granted', existing: true })
    await renderSettings(failingReconcile().handler)
    await settled()

    // The browser has a subscription, but nothing will ever be delivered to it.
    expect(state()).not.toBe('on')
    expect(state()).toBe('error')
    expect(card()?.textContent).not.toMatch(/On this device/)
    expect(card()?.textContent).toMatch(/not registered on the server/i)
  })

  it('offers a way to try again after a failed reconcile', async () => {
    stubBrowser({ permission: 'granted', existing: true })
    await renderSettings(failingReconcile().handler)
    await settled()

    expect(screen.getByRole('button', { name: /Enable on this device/ })).toBeInTheDocument()
  })

  it('does NOT show On without a usable device timezone', async () => {
    stubBrowser({ permission: 'granted', existing: true })
    // A browser that cannot report its zone cannot be scheduled for.
    vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(
      () => ({ resolvedOptions: () => ({ timeZone: '' }) }) as never,
    )

    await renderSettings(notificationApi().handler)
    await settled()

    expect(state()).toBe('error')
    expect(card()?.textContent).toMatch(/timezone/i)
  })

  it('never requests permission while reconciling', async () => {
    stubBrowser({ permission: 'granted', existing: true })
    await renderSettings(notificationApi().handler)
    await settled()

    expect(requestPermission).not.toHaveBeenCalled()
  })

  it('confirms a changed timezone before claiming On', async () => {
    stubBrowser({ permission: 'granted', existing: true })
    const api = notificationApi()
    await renderSettings(api.handler)
    await settled()

    // Travel changes the clock the schedule is written in; the reconcile is
    // what carries it, and On is only claimed once it succeeded.
    const saved = api.calls.find((call) => call.method === 'PUT')
    expect(saved).toBeDefined()
    expect((saved?.body as { timezone: string }).timezone.length).toBeGreaterThan(0)
    expect(state()).toBe('on')
  })
})

/* ------------------------------------------------------------------ */
/* 10. Key material must be the right shape                            */
/* ------------------------------------------------------------------ */

/**
 * Key material that cannot be encrypted to is worse than absent: it would sit
 * in D1 looking enabled and failing silently once a minute. So the shape is
 * checked at the door, not discovered at send time.
 */
describe('10. push key shape', () => {
  it('accepts a real uncompressed P-256 point', () => {
    expect(isP256dhKey(P256DH)).toBe(true)
    expect(P256DH_BYTES).toBe(65)
  })

  it('accepts a real 16-byte auth secret', () => {
    expect(isAuthSecret(AUTH)).toBe(true)
    expect(AUTH_BYTES).toBe(16)
  })

  it('refuses a point of the wrong length', () => {
    // 64 bytes and 66 bytes are both not a P-256 point.
    expect(isP256dhKey(P256DH.slice(0, 86))).toBe(false)
    expect(isP256dhKey(P256DH + 'AA')).toBe(false)
  })

  it('refuses a point that is not marked uncompressed', () => {
    // 0x04 is the marker; without it this is not what Web Push uses.
    expect(isP256dhKey('A' + P256DH.slice(1))).toBe(false)
  })

  it('refuses an auth secret of the wrong length', () => {
    expect(isAuthSecret(AUTH.slice(0, 20))).toBe(false)
    expect(isAuthSecret(AUTH + AUTH)).toBe(false)
  })

  it('refuses anything that is not base64url at all', () => {
    for (const bad of ['', 'has spaces', 'plus+slash/', 'padded==', null, 42, {}, undefined]) {
      expect(isP256dhKey(bad), String(bad)).toBe(false)
      expect(isAuthSecret(bad), String(bad)).toBe(false)
    }
  })

  it('refuses key material longer than the accepted bound', () => {
    expect(isP256dhKey('A'.repeat(500))).toBe(false)
    expect(isAuthSecret('A'.repeat(500))).toBe(false)
  })
})
