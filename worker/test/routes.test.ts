import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Env } from '../auth/config'
import { createD1SessionStore } from '../auth/d1Stores'
import { handleLogout, handleSession } from '../auth/routes'
import { createSession, TRUSTED_SESSION_MS, UNTRUSTED_SESSION_MS } from '../auth/session'
import { createFakeD1 } from './fakeD1'

const DAY = 24 * 60 * 60 * 1000
const THIRTY_DAYS_SECONDS = 30 * 24 * 60 * 60
const START = Date.UTC(2026, 8, 1)

const HTTPS_ORIGIN = 'https://vshapev2.nkmwei.de'

function makeEnv(db: D1Database, appOrigin = HTTPS_ORIGIN): Env {
  return { DB: db, ASSETS: {} as Fetcher, APP_ORIGIN: appOrigin }
}

function sessionRequest(token: string, origin = HTTPS_ORIGIN): Request {
  return new Request(`${origin}/api/auth/session`, {
    headers: { Cookie: `vshape_session=${token}` },
  })
}

/** Seed a session through the real store so the D1 insert path is exercised. */
async function seedSession(db: D1Database, trusted: boolean, createdAt: number) {
  return createSession(
    createD1SessionStore(db),
    { googleSub: 'google-sub-1', email: 'person@example.com', trusted },
    createdAt,
  )
}

function maxAgeOf(setCookie: string | null): number | null {
  if (!setCookie) return null
  const match = /Max-Age=(\d+)/.exec(setCookie)
  return match ? Number(match[1]) : null
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('GET /api/auth/session — trusted rolling refresh', () => {
  it('re-issues the cookie with a fresh 30 day Max-Age when the session rolls forward', async () => {
    const { db, sessions } = createFakeD1()
    const { token, record } = await seedSession(db, true, START)

    // 26 days in: only 4 days remain, inside the 7 day refresh threshold.
    const now = START + 26 * DAY
    vi.setSystemTime(now)

    const response = await handleSession(sessionRequest(token), makeEnv(db))
    const setCookie = response.headers.get('Set-Cookie')

    expect(await response.json()).toEqual({
      authenticated: true,
      user: { email: 'person@example.com', name: null, picture: null },
    })

    // The browser cookie is renewed for the full trusted lifetime...
    expect(setCookie).toBeTruthy()
    expect(maxAgeOf(setCookie)).toBe(THIRTY_DAYS_SECONDS)
    // ...carrying the same opaque token, not a newly minted one.
    expect(setCookie).toContain(`vshape_session=${token}`)

    // ...and D1 was rolled forward to match.
    const row = sessions.get(record.sessionHash)
    expect(row?.expires_at).toBe(now + TRUSTED_SESSION_MS)
  })

  it('keeps the cookie and the D1 row expiring at the same moment', async () => {
    const { db, sessions } = createFakeD1()
    const { token, record } = await seedSession(db, true, START)

    const now = START + 26 * DAY
    vi.setSystemTime(now)

    const response = await handleSession(sessionRequest(token), makeEnv(db))
    const cookieExpiry = now + maxAgeOf(response.headers.get('Set-Cookie'))! * 1000

    // This is the bug the fix closes: the cookie must not die before the row.
    expect(cookieExpiry).toBe(sessions.get(record.sessionHash)?.expires_at)
  })

  it('does not re-issue the cookie when the session is not near expiry', async () => {
    const { db, sessions } = createFakeD1()
    const { token, record } = await seedSession(db, true, START)

    // One day in, 29 days remain — well outside the refresh threshold.
    vi.setSystemTime(START + DAY)

    const response = await handleSession(sessionRequest(token), makeEnv(db))

    expect(response.headers.get('Set-Cookie')).toBeNull()
    // D1 is untouched too, so an ordinary request stays read-only.
    expect(sessions.get(record.sessionHash)?.expires_at).toBe(record.expiresAt)
    expect(sessions.get(record.sessionHash)?.last_seen_at).toBe(START)
  })

  it('does not roll a non-trusted session, even close to its expiry', async () => {
    const { db, sessions } = createFakeD1()
    const { token, record } = await seedSession(db, false, START)

    // 23 hours into a 24 hour session.
    vi.setSystemTime(START + 23 * 60 * 60 * 1000)

    const response = await handleSession(sessionRequest(token), makeEnv(db))

    expect((await response.json()) as { authenticated: boolean }).toMatchObject({
      authenticated: true,
    })
    expect(response.headers.get('Set-Cookie')).toBeNull()
    expect(sessions.get(record.sessionHash)?.expires_at).toBe(START + UNTRUSTED_SESSION_MS)
  })

  it('refreshes at most once until the threshold is crossed again', async () => {
    const { db } = createFakeD1()
    const { token } = await seedSession(db, true, START)

    vi.setSystemTime(START + 26 * DAY)
    const first = await handleSession(sessionRequest(token), makeEnv(db))
    expect(first.headers.get('Set-Cookie')).toBeTruthy()

    // Immediately after rolling forward there are 30 days left again.
    vi.setSystemTime(START + 26 * DAY + 60_000)
    const second = await handleSession(sessionRequest(token), makeEnv(db))
    expect(second.headers.get('Set-Cookie')).toBeNull()
  })
})

describe('re-issued cookie attributes', () => {
  it('keeps HttpOnly, SameSite=Lax, Path=/ and Secure on https', async () => {
    const { db } = createFakeD1()
    const { token } = await seedSession(db, true, START)
    vi.setSystemTime(START + 26 * DAY)

    const response = await handleSession(sessionRequest(token), makeEnv(db))
    const setCookie = response.headers.get('Set-Cookie') ?? ''

    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('SameSite=Lax')
    expect(setCookie).toContain('Path=/')
    expect(setCookie).toContain('Secure')
  })

  it('omits Secure for plain-http local development', async () => {
    const { db } = createFakeD1()
    const { token } = await seedSession(db, true, START)
    vi.setSystemTime(START + 26 * DAY)

    const localOrigin = 'http://localhost:5173'
    const response = await handleSession(
      sessionRequest(token, localOrigin),
      makeEnv(db, localOrigin),
    )
    const setCookie = response.headers.get('Set-Cookie') ?? ''

    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).not.toContain('Secure')
  })
})

describe('GET /api/auth/session — non-valid sessions', () => {
  it('reports an expired session and clears the cookie', async () => {
    const { db } = createFakeD1()
    const { token } = await seedSession(db, false, START)
    vi.setSystemTime(START + UNTRUSTED_SESSION_MS + 1)

    const response = await handleSession(sessionRequest(token), makeEnv(db))

    expect(await response.json()).toEqual({ authenticated: false, reason: 'expired' })
    expect(maxAgeOf(response.headers.get('Set-Cookie'))).toBe(0)
  })

  it('reports a revoked session and clears the cookie', async () => {
    const { db } = createFakeD1()
    const { token } = await seedSession(db, true, START)
    vi.setSystemTime(START + DAY)

    await handleLogout(
      new Request(`${HTTPS_ORIGIN}/api/auth/logout`, {
        method: 'POST',
        headers: { Cookie: `vshape_session=${token}`, Origin: HTTPS_ORIGIN },
      }),
      makeEnv(db),
    )

    const response = await handleSession(sessionRequest(token), makeEnv(db))
    expect(await response.json()).toEqual({ authenticated: false, reason: 'revoked' })
    expect(maxAgeOf(response.headers.get('Set-Cookie'))).toBe(0)
  })

  it('sends no cookie header when there was no cookie to begin with', async () => {
    const { db } = createFakeD1()
    const response = await handleSession(
      new Request(`${HTTPS_ORIGIN}/api/auth/session`),
      makeEnv(db),
    )

    expect(await response.json()).toEqual({ authenticated: false, reason: null })
    expect(response.headers.get('Set-Cookie')).toBeNull()
  })
})
