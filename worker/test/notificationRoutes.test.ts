import { describe, expect, it } from 'vitest'

import type { Env } from '../auth/config'
import { createD1SessionStore } from '../auth/d1Stores'
import { createSession } from '../auth/session'
import { handleNotificationRequest } from '../notifications/routes'
import { createFakeD1 } from './fakeD1'

/**
 * Round 14 — the notification API.
 *
 * A push subscription is the most sensitive thing this app stores after the
 * session itself: an endpoint plus its keys is the ability to send a
 * notification to somebody's lock screen. So the tests here are mostly about
 * what the server REFUSES to say and what it refuses to let one account do to
 * another.
 *
 * The account is always the session's. No endpoint reads an identity from a
 * body, a query string, a path or a header.
 */

const ORIGIN = 'https://vshapev2.nkmwei.de'
const BASE = `${ORIGIN}/api/notifications`

const ENDPOINT_A = 'https://fcm.googleapis.com/fcm/send/device-a'
const ENDPOINT_B = 'https://updates.push.services.mozilla.com/wpush/v2/device-b'

const VALID = {
  endpoint: ENDPOINT_A,
  p256dh: 'BKxQpJH8gm-vN2mZ0aQ3Hs7lJ1YtG6cW2rB4nT8yP0dE',
  auth: 'k9Lm2QpX7vT4nB8sR1cW3g',
  timezone: 'Asia/Kuala_Lumpur',
}

function makeEnv(db: D1Database, over: Partial<Env> = {}): Env {
  return {
    DB: db,
    ASSETS: {} as Fetcher,
    APP_ORIGIN: ORIGIN,
    VAPID_PUBLIC_KEY: 'B'.repeat(86),
    VAPID_PRIVATE_KEY: 'p'.repeat(43),
    VAPID_SUBJECT: 'mailto:reminders@example.com',
    ...over,
  }
}

async function seedToken(db: D1Database, googleSub: string, email: string) {
  return (
    await createSession(createD1SessionStore(db), { googleSub, email, trusted: true })
  ).token
}

type CallOptions = {
  token?: string
  method?: string
  path?: string
  body?: unknown
  origin?: string
  env?: Partial<Env>
}

async function call(db: D1Database, options: CallOptions = {}) {
  const headers: Record<string, string> = {}
  if (options.token) headers.Cookie = `vshape_session=${options.token}`
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'
  if (options.origin) headers.Origin = options.origin

  const request = new Request(`${BASE}${options.path ?? '/subscription'}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })

  const response = await handleNotificationRequest(request, makeEnv(db, options.env))
  if (!response) throw new Error('handler did not claim the request')
  return { response, body: (await response.json()) as Record<string, never> }
}

/** Enable a device for an account. */
async function enable(db: D1Database, token: string, body: unknown = VALID) {
  return call(db, { token, method: 'PUT', origin: ORIGIN, body })
}

/* ------------------------------------------------------------------ */
/* 1. Authentication                                                   */
/* ------------------------------------------------------------------ */

describe('1. every route needs the session', () => {
  it('refuses an unauthenticated config read', async () => {
    const { db } = createFakeD1()
    const { response, body } = await call(db, { path: '/config' })
    expect(response.status).toBe(401)
    expect(body.error).toBe('unauthenticated')
  })

  it('refuses an unauthenticated subscribe', async () => {
    const { db, pushSubscriptions } = createFakeD1()
    const { response } = await call(db, { method: 'PUT', origin: ORIGIN, body: VALID })
    expect(response.status).toBe(401)
    expect(pushSubscriptions.size).toBe(0)
  })

  it('refuses an unauthenticated unsubscribe', async () => {
    const { db } = createFakeD1()
    const { response } = await call(db, {
      method: 'DELETE',
      origin: ORIGIN,
      body: { endpoint: ENDPOINT_A },
    })
    expect(response.status).toBe(401)
  })

  it('refuses a cross-origin write', async () => {
    const { db, pushSubscriptions } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')
    const { response, body } = await call(db, {
      token,
      method: 'PUT',
      origin: 'https://evil.example',
      body: VALID,
    })
    expect(response.status).toBe(403)
    expect(body.error).toBe('forbidden')
    expect(pushSubscriptions.size).toBe(0)
  })

  it('refuses a method the resource does not have', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')
    for (const [path, method] of [
      ['/config', 'PUT'],
      ['/config', 'DELETE'],
      ['/subscription', 'POST'],
    ] as const) {
      const { response } = await call(db, { token, path, method, origin: ORIGIN, body: {} })
      expect(response.status, `${method} ${path}`).toBe(405)
    }
  })
})

/* ------------------------------------------------------------------ */
/* 2. Config                                                           */
/* ------------------------------------------------------------------ */

describe('2. config', () => {
  it('returns only the PUBLIC key', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')
    const { response, body } = await call(db, { token, path: '/config' })

    expect(response.status).toBe(200)
    expect(body.available).toBe(true)
    expect(body.publicKey).toBe('B'.repeat(86))
    // The private half must never be reachable from a browser.
    expect(JSON.stringify(body)).not.toContain('p'.repeat(43))
  })

  it('reports unavailable, honestly, when VAPID is unconfigured', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')
    const { response, body } = await call(db, {
      token,
      path: '/config',
      env: { VAPID_PUBLIC_KEY: undefined, VAPID_PRIVATE_KEY: undefined, VAPID_SUBJECT: undefined },
    })

    // Not an error: a deployment without push config is a normal state.
    expect(response.status).toBe(200)
    expect(body.available).toBe(false)
    expect(body.publicKey).toBeNull()
  })

  it('treats half-configured as unconfigured', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')
    const { body } = await call(db, {
      token,
      path: '/config',
      env: { VAPID_PRIVATE_KEY: undefined },
    })
    // Better to say no now than to fail mid-send, once a minute.
    expect(body.available).toBe(false)
  })
})

/* ------------------------------------------------------------------ */
/* 3. Registering a device                                             */
/* ------------------------------------------------------------------ */

describe('3. registering', () => {
  it('stores the subscription under the session account', async () => {
    const { db, pushSubscriptions } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')

    const { response, body } = await enable(db, token)
    expect(response.status).toBe(200)
    expect(body.subscription).toEqual({ enabled: true, timezone: 'Asia/Kuala_Lumpur' })

    const stored = [...pushSubscriptions.values()]
    expect(stored).toHaveLength(1)
    expect(stored[0].google_sub).toBe('sub-a')
    expect(stored[0].endpoint).toBe(ENDPOINT_A)
  })

  it('accepts no account identity from the caller', async () => {
    const { db, pushSubscriptions } = createFakeD1()
    const token = await seedToken(db, 'sub-b', 'b@example.com')

    // Naming another account in the body changes nothing: the fields are not
    // read at all, and identity comes only from the session.
    await enable(db, token, {
      ...VALID,
      googleSub: 'sub-a',
      google_sub: 'sub-a',
      account: 'sub-a',
    })

    expect([...pushSubscriptions.values()][0].google_sub).toBe('sub-b')
  })

  it('reconciles a changed timezone without creating a second row', async () => {
    const { db, pushSubscriptions } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')

    await enable(db, token)
    // The same device, now somewhere else. Travel must follow the same local
    // clock the Today page uses, and needs no new permission prompt.
    const { body } = await enable(db, token, { ...VALID, timezone: 'Europe/London' })

    expect(pushSubscriptions.size).toBe(1)
    expect(body.subscription).toEqual({ enabled: true, timezone: 'Europe/London' })
    expect([...pushSubscriptions.values()][0].timezone).toBe('Europe/London')
  })

  it('rebinds a device that signs into a different account', async () => {
    const { db, pushSubscriptions } = createFakeD1()
    const a = await seedToken(db, 'sub-a', 'a@example.com')
    const b = await seedToken(db, 'sub-b', 'b@example.com')

    await enable(db, a)
    await enable(db, b)

    // One browser, one row: the device must not be left receiving both
    // accounts' reminders.
    expect(pushSubscriptions.size).toBe(1)
    expect([...pushSubscriptions.values()][0].google_sub).toBe('sub-b')
  })

  it('keeps two different devices of one account', async () => {
    const { db, pushSubscriptions } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')

    await enable(db, token)
    await enable(db, token, { ...VALID, endpoint: ENDPOINT_B })

    expect(pushSubscriptions.size).toBe(2)
  })

  it('refuses a malformed subscription and stores nothing', async () => {
    const { db, pushSubscriptions } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')

    const bad: [string, unknown][] = [
      ['endpoint', { ...VALID, endpoint: 'http://push.example/insecure' }],
      ['endpoint', { ...VALID, endpoint: 'not a url' }],
      ['endpoint', { ...VALID, endpoint: `https://push.example/${'x'.repeat(2000)}` }],
      ['p256dh', { ...VALID, p256dh: 'has spaces' }],
      ['p256dh', { ...VALID, p256dh: '' }],
      ['auth', { ...VALID, auth: 'has+plus/slash' }],
      ['timezone', { ...VALID, timezone: 'Mars/Olympus' }],
      ['timezone', { ...VALID, timezone: '+08:00' }],
      ['timezone', { ...VALID, timezone: '' }],
      ['body', 'not an object'],
    ]

    for (const [field, body] of bad) {
      const { response, body: answer } = await enable(db, token, body)
      expect(response.status, JSON.stringify(body)).toBe(400)
      expect(answer.error).toBe('invalid_subscription')
      expect(answer.field, JSON.stringify(body)).toBe(field)
    }

    expect(pushSubscriptions.size).toBe(0)
  })

  it('never echoes the endpoint or the keys back', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')
    const { body } = await enable(db, token)

    const serialised = JSON.stringify(body)
    expect(serialised).not.toContain(ENDPOINT_A)
    expect(serialised).not.toContain(VALID.p256dh)
    expect(serialised).not.toContain(VALID.auth)
    expect(serialised).not.toContain('sub-a')
  })
})

/* ------------------------------------------------------------------ */
/* 4. Disabling a device                                               */
/* ------------------------------------------------------------------ */

describe('4. disabling', () => {
  it('removes this account"s own device', async () => {
    const { db, pushSubscriptions } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')
    await enable(db, token)

    const { response, body } = await call(db, {
      token,
      method: 'DELETE',
      origin: ORIGIN,
      body: { endpoint: ENDPOINT_A },
    })

    expect(response.status).toBe(200)
    expect(body.removed).toBe(true)
    expect(pushSubscriptions.size).toBe(0)
  })

  it('cannot remove another account"s device', async () => {
    const { db, pushSubscriptions } = createFakeD1()
    const a = await seedToken(db, 'sub-a', 'a@example.com')
    const b = await seedToken(db, 'sub-b', 'b@example.com')
    await enable(db, a)

    const { response, body } = await call(db, {
      token: b,
      method: 'DELETE',
      origin: ORIGIN,
      body: { endpoint: ENDPOINT_A },
    })

    // Answers the same either way, so it cannot be used to probe whether
    // somebody else's device exists.
    expect(response.status).toBe(200)
    expect(body.removed).toBe(false)
    expect(pushSubscriptions.size).toBe(1)
    expect([...pushSubscriptions.values()][0].google_sub).toBe('sub-a')
  })

  it('leaves this account"s OTHER devices alone', async () => {
    const { db, pushSubscriptions } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')
    await enable(db, token)
    await enable(db, token, { ...VALID, endpoint: ENDPOINT_B })

    await call(db, {
      token,
      method: 'DELETE',
      origin: ORIGIN,
      body: { endpoint: ENDPOINT_A },
    })

    expect(pushSubscriptions.size).toBe(1)
    expect([...pushSubscriptions.values()][0].endpoint).toBe(ENDPOINT_B)
  })

  it('refuses a malformed endpoint', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')
    const { response } = await call(db, {
      token,
      method: 'DELETE',
      origin: ORIGIN,
      body: { endpoint: 'nope' },
    })
    expect(response.status).toBe(400)
  })
})

/* ------------------------------------------------------------------ */
/* 5. Status                                                           */
/* ------------------------------------------------------------------ */

describe('5. status', () => {
  it('reports this device as enabled for its own account', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')
    await enable(db, token)

    const { body } = await call(db, {
      token,
      path: `/subscription?endpoint=${encodeURIComponent(ENDPOINT_A)}`,
    })
    expect(body.subscription).toEqual({ enabled: true, timezone: 'Asia/Kuala_Lumpur' })
  })

  it('reports another account"s device as not enabled here', async () => {
    const { db } = createFakeD1()
    const a = await seedToken(db, 'sub-a', 'a@example.com')
    const b = await seedToken(db, 'sub-b', 'b@example.com')
    await enable(db, a)

    const { body } = await call(db, {
      token: b,
      path: `/subscription?endpoint=${encodeURIComponent(ENDPOINT_A)}`,
    })
    // Never "enabled", and never an error that would confirm it exists.
    expect(body.subscription).toEqual({ enabled: false, timezone: null })
  })

  it('returns no list of anybody"s subscriptions', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')
    await enable(db, token)
    await enable(db, token, { ...VALID, endpoint: ENDPOINT_B })

    const { body } = await call(db, {
      token,
      path: `/subscription?endpoint=${encodeURIComponent(ENDPOINT_A)}`,
    })

    const serialised = JSON.stringify(body)
    expect(serialised).not.toContain(ENDPOINT_A)
    expect(serialised).not.toContain(ENDPOINT_B)
    expect(Array.isArray((body as unknown as { subscriptions?: unknown }).subscriptions)).toBe(
      false,
    )
  })
})
