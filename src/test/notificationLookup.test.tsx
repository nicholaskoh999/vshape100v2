import { cleanup, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  disableOnThisDevice,
  isFullyDisabled,
  lookupSubscription,
} from '@/features/notifications/pushClient'

import { authenticatedSession, mockAuthFetch, renderApp } from './authTestUtils'

/**
 * Round 14 correction 2, blocker 2 — "no subscription" and "I could not find
 * out" are different answers.
 *
 * The lookup used to swallow every failure and return null, which every caller
 * then read as "this device has none". A thrown `getRegistration` therefore
 * became "Off" in Settings, "already off" on Disable, and "cleanup succeeded"
 * on sign-out — three confident claims made on the strength of an error.
 *
 * The device may well still be subscribed and still receiving pushes in all
 * three cases. So the lookup is tri-state now, and an unknown is reported as an
 * unknown rather than being rounded down to the convenient answer.
 */

const PUBLIC_KEY = 'B'.repeat(86)
const P256DH =
  'BPQJoE44Q1Cc9mVFRQJQLSlbylnndSF3THRGgH1buOLGH3Ur5ZFvqpI1DKkGKEDa8jKNBlNWttPDqAdAvSVhszU'
const AUTH = 'qMTpNlhmid_ObCRqVDj04g'
const ENDPOINT = 'https://push.example/send/this-device'

let requestPermission: ReturnType<typeof vi.fn>
let unsubscribeSpy: ReturnType<typeof vi.fn<() => Promise<boolean>>>

function subscriptionStub() {
  return {
    endpoint: ENDPOINT,
    toJSON: () => ({ endpoint: ENDPOINT, keys: { p256dh: P256DH, auth: AUTH } }),
    unsubscribe: unsubscribeSpy,
  }
}

/**
 * A browser whose lookup can be made to answer, to answer "none", or to fail
 * at either of the two steps a lookup takes.
 */
function stubBrowser(
  mode: 'found' | 'no-subscription' | 'no-registration' | 'registration-throws' | 'subscription-throws',
) {
  const registration = {
    pushManager: {
      subscribe: vi.fn(async () => subscriptionStub()),
      getSubscription: vi.fn(async () => {
        if (mode === 'subscription-throws') throw new DOMException('unavailable')
        return mode === 'found' ? subscriptionStub() : null
      }),
    },
  }

  vi.stubGlobal('Notification', { permission: 'granted', requestPermission })
  vi.stubGlobal('PushManager', function PushManager() {})
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      register: vi.fn(async () => registration),
      getRegistration: vi.fn(async () => {
        if (mode === 'registration-throws') throw new DOMException('unavailable')
        return mode === 'no-registration' ? undefined : registration
      }),
    },
  })

  return registration
}

/** The notification API, recording what it was actually asked to do. */
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

const card = () => document.querySelector('[data-notification-settings]')
const state = () => card()?.getAttribute('data-notification-state') ?? null

async function renderSettings(notifications: (url: string, init?: RequestInit) => Promise<Response>) {
  mockAuthFetch({ session: authenticatedSession, notifications })
  renderApp('/settings')
  await screen.findByRole('heading', { level: 1, name: 'Settings' })
  await waitFor(() => expect(state()).not.toBe('checking'))
  return userEvent.setup()
}

beforeEach(() => {
  requestPermission = vi.fn(async () => 'granted')
  unsubscribeSpy = vi.fn(async () => true)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

/* ------------------------------------------------------------------ */
/* 1. The lookup itself                                                */
/* ------------------------------------------------------------------ */

describe('1. three answers, not two', () => {
  it('reports the subscription this device has', async () => {
    stubBrowser('found')
    const lookup = await lookupSubscription()

    expect(lookup.state).toBe('found')
    expect(lookup.state === 'found' && lookup.subscription.endpoint).toBe(ENDPOINT)
  })

  it('reports a genuine none when the browser says there is none', async () => {
    stubBrowser('no-subscription')
    expect(await lookupSubscription()).toEqual({ state: 'none' })
  })

  it('reports a genuine none when nothing is registered at all', async () => {
    stubBrowser('no-registration')
    // No service worker registration is a real answer, not a failure: there is
    // nothing that could be holding a subscription.
    expect(await lookupSubscription()).toEqual({ state: 'none' })
  })

  it('reports unavailable when the registration cannot be read', async () => {
    stubBrowser('registration-throws')
    expect(await lookupSubscription()).toEqual({ state: 'unavailable' })
  })

  it('reports unavailable when the subscription cannot be read', async () => {
    stubBrowser('subscription-throws')
    // The registration exists and may well hold a live subscription. Calling
    // that "none" is the exact mistake this replaces.
    expect(await lookupSubscription()).toEqual({ state: 'unavailable' })
  })

  it('reports unavailable where there is no service worker API', async () => {
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: undefined })
    expect(await lookupSubscription()).toEqual({ state: 'unavailable' })
  })

  it('never prompts for permission', async () => {
    for (const mode of ['found', 'no-subscription', 'subscription-throws'] as const) {
      stubBrowser(mode)
      await lookupSubscription()
    }
    expect(requestPermission).not.toHaveBeenCalled()
  })
})

/* ------------------------------------------------------------------ */
/* 2. Disabling must not claim an unknown is off                       */
/* ------------------------------------------------------------------ */

describe('2. disable is honest about what it could not check', () => {
  it('a confirmed none is a complete success', async () => {
    stubBrowser('no-subscription')
    const result = await disableOnThisDevice()

    expect(result).toEqual({ had: false, server: true, local: true })
    expect(isFullyDisabled(result)).toBe(true)
  })

  it('a failed lookup is NOT reported as off', async () => {
    stubBrowser('subscription-throws')
    const result = await disableOnThisDevice()

    // The old behaviour returned {had:false, server:true, local:true} here —
    // a clean "already off" for a device that may still be subscribed.
    expect(result.had).toBe(true)
    expect(isFullyDisabled(result)).toBe(false)
  })

  it('a failed registration read is NOT reported as off', async () => {
    stubBrowser('registration-throws')
    expect(isFullyDisabled(await disableOnThisDevice())).toBe(false)
  })

  it('retires the device normally when the lookup succeeds', async () => {
    stubBrowser('found')
    const fetchSpy = vi.fn(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchSpy)

    const result = await disableOnThisDevice()

    expect(result).toEqual({ had: true, server: true, local: true })
    expect(unsubscribeSpy).toHaveBeenCalled()
  })

  it('sends nothing to the server when it does not know what to retire', async () => {
    stubBrowser('subscription-throws')
    const fetchSpy = vi.fn(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchSpy)

    await disableOnThisDevice()

    // There is no endpoint to name, so there is no honest request to make.
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(unsubscribeSpy).not.toHaveBeenCalled()
  })
})

/* ------------------------------------------------------------------ */
/* 3. Settings must not show Off on an unknown                         */
/* ------------------------------------------------------------------ */

describe('3. Settings reports the unknown', () => {
  it('shows Off only when the browser confirmed there is none', async () => {
    stubBrowser('no-subscription')
    await renderSettings(notificationApi().handler)

    expect(state()).toBe('off')
  })

  it('does NOT show Off when the subscription could not be read', async () => {
    stubBrowser('subscription-throws')
    await renderSettings(notificationApi().handler)

    expect(state()).not.toBe('off')
    expect(state()).not.toBe('on')
    expect(state()).toBe('error')
  })

  it('does NOT show Off when the registration could not be read', async () => {
    stubBrowser('registration-throws')
    await renderSettings(notificationApi().handler)

    expect(state()).not.toBe('off')
    expect(state()).not.toBe('on')
    expect(state()).toBe('error')
  })

  it('says what happened without claiming a state', async () => {
    stubBrowser('subscription-throws')
    await renderSettings(notificationApi().handler)

    const text = card()?.textContent ?? ''
    expect(text).toMatch(/could not read this device reminder state/i)
    expect(text).not.toMatch(/On this device/)
  })

  it('registers nothing with the server on a failed lookup', async () => {
    stubBrowser('subscription-throws')
    const api = notificationApi()
    await renderSettings(api.handler)

    // Nothing is reconciled on the strength of an unknown.
    expect(api.calls).toHaveLength(0)
  })

  it('still never asks for permission by itself', async () => {
    stubBrowser('subscription-throws')
    await renderSettings(notificationApi().handler)

    expect(requestPermission).not.toHaveBeenCalled()
  })

  it('leaves a way forward', async () => {
    stubBrowser('subscription-throws')
    await renderSettings(notificationApi().handler)

    expect(screen.getByRole('button', { name: /Enable on this device/ })).toBeInTheDocument()
  })
})

/* ------------------------------------------------------------------ */
/* 4. Signing out                                                      */
/* ------------------------------------------------------------------ */

describe('4. sign-out does not claim an unconfirmed cleanup', () => {
  async function signOut(mode: Parameters<typeof stubBrowser>[0]) {
    stubBrowser(mode)
    mockAuthFetch({ session: authenticatedSession, notifications: notificationApi().handler })
    renderApp('/settings')
    await screen.findByRole('heading', { level: 1, name: 'Settings' })

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /Sign out/ }))
    await screen.findByRole('heading', { level: 1, name: /VShape/ })
    return document.querySelector('[data-signout-notice]')?.textContent ?? null
  }

  it('says nothing when there was confirmed nothing to retire', async () => {
    expect(await signOut('no-subscription')).toBeNull()
  })

  it('surfaces the privacy notice when the lookup failed', async () => {
    const notice = await signOut('subscription-throws')

    // The signed-out account may still be able to push this browser. That is
    // exactly what the person needs told, and it was previously silent.
    expect(notice).toMatch(/could not confirm reminders were turned off/i)
  })

  it('surfaces it when the registration could not be read either', async () => {
    expect(await signOut('registration-throws')).toMatch(
      /could not confirm reminders were turned off/i,
    )
  })

  it('still signs the person out', async () => {
    await signOut('subscription-throws')

    expect(screen.getByRole('heading', { level: 1, name: /VShape/ })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 1, name: 'Settings' })).toBeNull()
  })

  it('leaks nothing about the device in the notice', async () => {
    const notice = (await signOut('subscription-throws')) ?? ''

    expect(notice).not.toContain(ENDPOINT)
    expect(notice).not.toContain(P256DH)
    expect(notice).not.toContain(AUTH)
    expect(notice).not.toMatch(/@/)
  })
})
