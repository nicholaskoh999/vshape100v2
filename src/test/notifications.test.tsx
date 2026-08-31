import { cleanup, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import manifestSource from '../../public/manifest.webmanifest?raw'
import serviceWorkerSource from '../../public/sw.js?raw'
import indexHtml from '../../index.html?raw'

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
      keys: { p256dh: 'BDeviceKey', auth: 'DeviceAuth' },
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
      p256dh: 'BDeviceKey',
      auth: 'DeviceAuth',
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
    // Claiming "off" here would promise a silence that will not arrive.
    expect(card()?.textContent).toMatch(/Could not fully turn reminders off/)
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

describe('7. the service worker', () => {
  it('handles push and notification clicks, and nothing else', () => {
    expect(serviceWorkerSource).toMatch(/addEventListener\('push'/)
    expect(serviceWorkerSource).toMatch(/addEventListener\('notificationclick'/)
  })

  it('adds no fetch interception or cache', () => {
    // A caching service worker can serve a previous deployment after a new one
    // ships, and a stale app is worse than no offline mode.
    expect(serviceWorkerSource).not.toMatch(/addEventListener\(\s*'fetch'/)
    expect(serviceWorkerSource).not.toMatch(/caches\./)
    expect(serviceWorkerSource).not.toMatch(/cache\.put/)
  })

  it('shows exactly one visible notification per push', () => {
    expect(serviceWorkerSource).toMatch(/showNotification\(/)
    // Deterministic tag: a re-delivery replaces rather than stacks.
    expect(serviceWorkerSource).toMatch(/tag/)
  })

  it('refuses any destination that is not a path on this origin', () => {
    // The safePath guard, exercised as the worker defines it.
    const guard = /function safePath\(value\)\s*\{[\s\S]*?\n\}/.exec(serviceWorkerSource)
    expect(guard).not.toBeNull()

    const fallback = /const FALLBACK_PATH = '([^']+)'/.exec(serviceWorkerSource)
    expect(fallback).not.toBeNull()
    const safePath = new Function(
      `const FALLBACK_PATH = '${fallback![1]}'; ${guard![0]}; return safePath`,
    )() as (value: unknown) => string

    expect(safePath('/training/monday')).toBe('/training/monday')
    expect(safePath('/today')).toBe('/today')

    // Everything that could leave the origin falls back to Today.
    for (const hostile of [
      'https://evil.example/steal',
      '//evil.example',
      'javascript:alert(1)',
      'data:text/html,x',
      '/today?next=https://evil.example',
      42,
      null,
      undefined,
    ]) {
      expect(safePath(hostile), String(hostile)).toBe('/today')
    }
  })

  it('uses the app icons it already ships', () => {
    expect(serviceWorkerSource).toMatch(/\/icon-192\.png/)
  })
})
