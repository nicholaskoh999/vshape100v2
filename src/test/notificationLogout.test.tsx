import { cleanup, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { authenticatedSession, mockAuthFetch, renderApp } from './authTestUtils'

/**
 * Round 14 correction 1 — signing out must be honest about reminders.
 *
 * Retiring this device happens BEFORE the session goes, because afterwards the
 * DELETE would be unauthenticated and there would be nothing left to retire
 * with. If that cleanup cannot be confirmed, the signed-out account may still
 * be able to push this browser — someone else's routine appearing on a lock
 * screen after they signed out.
 *
 * So the failure is surfaced. It does not block sign-out and it does not trap
 * anyone in a retry: sign-out always completes, and the notice travels to the
 * login screen where the person can act on it.
 */

const PUBLIC_KEY = 'B'.repeat(86)
const P256DH =
  'BPQJoE44Q1Cc9mVFRQJQLSlbylnndSF3THRGgH1buOLGH3Ur5ZFvqpI1DKkGKEDa8jKNBlNWttPDqAdAvSVhszU'
const AUTH = 'qMTpNlhmid_ObCRqVDj04g'
const ENDPOINT = 'https://push.example/send/this-device'

let unsubscribeSpy: ReturnType<typeof vi.fn<() => Promise<boolean>>>

/** A browser already subscribed and permitted. */
function stubSubscribedBrowser(options: { hasSubscription?: boolean } = {}) {
  const subscription = {
    endpoint: ENDPOINT,
    toJSON: () => ({ endpoint: ENDPOINT, keys: { p256dh: P256DH, auth: AUTH } }),
    unsubscribe: unsubscribeSpy,
  }

  const registration = {
    pushManager: {
      subscribe: vi.fn(async () => subscription),
      getSubscription: vi.fn(async () =>
        options.hasSubscription === false ? null : subscription,
      ),
    },
  }

  vi.stubGlobal('Notification', { permission: 'granted', requestPermission: vi.fn() })
  vi.stubGlobal('PushManager', function PushManager() {})
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      register: vi.fn(async () => registration),
      getRegistration: vi.fn(async () => registration),
    },
  })
}

/** The notification API, with a controllable DELETE outcome. */
function api(options: { deleteStatus?: number } = {}) {
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
    if (method === 'DELETE' && options.deleteStatus && options.deleteStatus >= 400) {
      return new Response(JSON.stringify({ error: 'server_error' }), {
        status: options.deleteStatus,
      })
    }
    return new Response(
      JSON.stringify({ subscription: { enabled: method === 'PUT', timezone: 'UTC' } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  }
  return { calls, handler }
}

async function signOutFromSettings(
  notifications: (url: string, init?: RequestInit) => Promise<Response>,
) {
  const fetchSpy = mockAuthFetch({ session: authenticatedSession, notifications })
  renderApp('/settings')
  await screen.findByRole('heading', { level: 1, name: 'Settings' })
  await waitFor(() =>
    expect(document.querySelector('[data-notification-settings]')).not.toBeNull(),
  )

  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: /Sign out/ }))
  await screen.findByRole('heading', { level: 1, name: /VShape/ })
  return fetchSpy
}

function notice(): string | null {
  return document.querySelector('[data-signout-notice]')?.textContent ?? null
}

beforeEach(() => {
  unsubscribeSpy = vi.fn(async () => true)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

/* ------------------------------------------------------------------ */
/* 1. The normal case                                                  */
/* ------------------------------------------------------------------ */

describe('1. clean sign-out', () => {
  it('retires this device before ending the session', async () => {
    stubSubscribedBrowser()
    const notifications = api()
    const fetchSpy = await signOutFromSettings(notifications.handler)

    const urls = fetchSpy.mock.calls.map((call) => String(call[0]))
    const retireAt = urls.findIndex((url) => url.startsWith('/api/notifications/subscription'))
    const logoutAt = urls.findIndex((url) => url.startsWith('/api/auth/logout'))

    // Order matters: afterwards the DELETE would be unauthenticated.
    expect(retireAt).toBeGreaterThanOrEqual(0)
    expect(logoutAt).toBeGreaterThan(retireAt)
    expect(unsubscribeSpy).toHaveBeenCalled()
  })

  it('names only THIS endpoint, so no other device is touched', async () => {
    stubSubscribedBrowser()
    const notifications = api()
    await signOutFromSettings(notifications.handler)

    const removed = notifications.calls.find((call) => call.method === 'DELETE')
    expect(removed?.body).toEqual({ endpoint: ENDPOINT })
  })

  it('says nothing extra when cleanup succeeded', async () => {
    stubSubscribedBrowser()
    await signOutFromSettings(api().handler)
    expect(notice()).toBeNull()
  })

  it('says nothing when there was no subscription to retire', async () => {
    stubSubscribedBrowser({ hasSubscription: false })
    await signOutFromSettings(api().handler)
    // Nothing to disable is a complete success, not a partial one.
    expect(notice()).toBeNull()
  })
})

/* ------------------------------------------------------------------ */
/* 2. Cleanup that could not be confirmed                              */
/* ------------------------------------------------------------------ */

describe('2. honest failure', () => {
  it('surfaces a notice when the server retirement fails', async () => {
    stubSubscribedBrowser()
    await signOutFromSettings(api({ deleteStatus: 500 }).handler)

    // The account may still be able to push this browser; that must not be
    // swallowed.
    expect(notice()).toMatch(/could not confirm reminders were turned off/i)
  })

  it('surfaces a different notice when only the local unsubscribe fails', async () => {
    unsubscribeSpy = vi.fn(async () => false)
    stubSubscribedBrowser()
    await signOutFromSettings(api().handler)

    // The server will not push, but the browser still holds a subscription.
    // The remedy differs, so the wording does too.
    expect(notice()).toMatch(/browser may still hold a reminder subscription/i)
  })

  it('surfaces a notice when both halves fail', async () => {
    unsubscribeSpy = vi.fn(async () => false)
    stubSubscribedBrowser()
    await signOutFromSettings(api({ deleteStatus: 500 }).handler)

    expect(notice()).toMatch(/could not confirm reminders were turned off/i)
  })

  it('still signs the user out, rather than trapping them', async () => {
    unsubscribeSpy = vi.fn(async () => false)
    stubSubscribedBrowser()
    await signOutFromSettings(api({ deleteStatus: 500 }).handler)

    // The session is gone and the login screen is showing: a failed cleanup
    // must never hold someone inside a session they asked to leave.
    expect(screen.getByRole('heading', { level: 1, name: /VShape/ })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 1, name: 'Settings' })).toBeNull()
  })

  it('offers no retry loop, just the fact and what to do', async () => {
    stubSubscribedBrowser()
    await signOutFromSettings(api({ deleteStatus: 500 }).handler)

    const text = notice() ?? ''
    expect(text).toMatch(/Settings|browser/i)
    // Nothing to press, nothing to get stuck in.
    expect(document.querySelector('[data-signout-notice] button')).toBeNull()
  })

  it('exposes no endpoint, key or account detail in the notice', async () => {
    stubSubscribedBrowser()
    await signOutFromSettings(api({ deleteStatus: 500 }).handler)

    const text = notice() ?? ''
    expect(text).not.toContain(ENDPOINT)
    expect(text).not.toContain(P256DH)
    expect(text).not.toContain(AUTH)
    expect(text).not.toMatch(/push\.example/)
    expect(text).not.toMatch(/@/)
  })

  it('sends exactly one retire request, for this device only', async () => {
    stubSubscribedBrowser()
    const notifications = api({ deleteStatus: 500 })
    await signOutFromSettings(notifications.handler)

    const deletes = notifications.calls.filter((call) => call.method === 'DELETE')
    // One attempt: no loop, and no attempt to reach anything but this device.
    expect(deletes).toHaveLength(1)
    expect(deletes[0].body).toEqual({ endpoint: ENDPOINT })
  })
})
