import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Env } from '../auth/config'
import { createD1SessionStore } from '../auth/d1Stores'
import {
  createSession,
  TRUSTED_SESSION_MS,
  UNTRUSTED_SESSION_MS,
} from '../auth/session'
import { handleTodayRequest } from '../today/routes'
import { createFakeD1 } from './fakeD1'

const ORIGIN = 'https://vshapev2.nkmwei.de'
const BASE = `${ORIGIN}/api/today/completions`
const RANGE = 'from=2026-09-06&to=2026-09-07'
const KEY = '2026-09-07:gym-training'

function makeEnv(db: D1Database): Env {
  return { DB: db, ASSETS: {} as Fetcher, APP_ORIGIN: ORIGIN }
}

async function seedSession(
  db: D1Database,
  googleSub: string,
  email: string,
  options: { trusted?: boolean; createdAt?: number } = {},
) {
  const { token, record } = await createSession(
    createD1SessionStore(db),
    { googleSub, email, trusted: options.trusted ?? true },
    options.createdAt,
  )
  return { token, record }
}

/** Most tests only need the cookie value. */
async function seedToken(db: D1Database, googleSub: string, email: string) {
  return (await seedSession(db, googleSub, email)).token
}

type ReqOptions = {
  token?: string
  method?: string
  origin?: string
  key?: string
  query?: string
}

function request({ token, method = 'GET', origin, key, query }: ReqOptions): Request {
  const url = key
    ? `${BASE}/${encodeURIComponent(key)}`
    : `${BASE}?${query ?? RANGE}`
  const headers: Record<string, string> = {}
  if (token) headers.Cookie = `vshape_session=${token}`
  if (origin) headers.Origin = origin
  return new Request(url, { method, headers })
}

/** Run a request through the real router and read the JSON back. */
async function call(db: D1Database, options: ReqOptions) {
  const response = await handleTodayRequest(request(options), makeEnv(db))
  if (!response) throw new Error('handler did not claim the request')
  return { response, body: (await response.json()) as Record<string, unknown> }
}

describe('authentication', () => {
  it('6. rejects an unauthenticated read', async () => {
    const { db } = createFakeD1()
    const { response, body } = await call(db, {})
    expect(response.status).toBe(401)
    expect(body.error).toBe('unauthenticated')
  })

  it('7. rejects an unauthenticated complete', async () => {
    const { db, completions } = createFakeD1()
    const { response } = await call(db, { method: 'PUT', key: KEY, origin: ORIGIN })
    expect(response.status).toBe(401)
    expect(completions.size).toBe(0)
  })

  it('8. rejects an unauthenticated undo', async () => {
    const { db } = createFakeD1()
    const { response } = await call(db, { method: 'DELETE', key: KEY, origin: ORIGIN })
    expect(response.status).toBe(401)
  })

  it('rejects a bogus session cookie', async () => {
    const { db } = createFakeD1()
    const { response } = await call(db, { token: 'not-a-real-token' })
    expect(response.status).toBe(401)
  })

  it('9. takes the account from the session, never from the request', async () => {
    const { db, completions } = createFakeD1()
    const token = await seedToken(db, 'google-sub-a', 'a@example.com')

    // A client-supplied identity in the query string is simply ignored.
    const { response } = await handleTodayRequest(
      new Request(
        `${BASE}/${encodeURIComponent(KEY)}?google_sub=attacker&email=b@example.com`,
        { method: 'PUT', headers: { Cookie: `vshape_session=${token}`, Origin: ORIGIN } },
      ),
      makeEnv(db),
    ).then(async (r) => ({ response: r!, body: await r!.json() }))

    expect(response.status).toBe(200)
    expect([...completions.values()].map((row) => row.google_sub)).toEqual([
      'google-sub-a',
    ])
  })

  it('never echoes an identity back to the browser', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'google-sub-a', 'a@example.com')
    await call(db, { token, method: 'PUT', key: KEY, origin: ORIGIN })
    const { body } = await call(db, { token })

    const serialised = JSON.stringify(body)
    expect(serialised).not.toContain('google-sub-a')
    expect(serialised).not.toContain('a@example.com')
  })

  it('marks every response no-store', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'google-sub-a', 'a@example.com')
    const { response } = await call(db, { token })
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })
})

describe('cross-origin protection', () => {
  it('rejects a cross-site write with the same rule as logout', async () => {
    const { db, completions } = createFakeD1()
    const token = await seedToken(db, 'google-sub-a', 'a@example.com')

    for (const method of ['PUT', 'DELETE']) {
      const { response } = await call(db, {
        token,
        method,
        key: KEY,
        origin: 'https://evil.example.com',
      })
      expect(response.status).toBe(403)
    }
    expect(completions.size).toBe(0)
  })

  it('allows a same-origin write', async () => {
    const { db, completions } = createFakeD1()
    const token = await seedToken(db, 'google-sub-a', 'a@example.com')
    const { response } = await call(db, {
      token,
      method: 'PUT',
      key: KEY,
      origin: ORIGIN,
    })
    expect(response.status).toBe(200)
    expect(completions.size).toBe(1)
  })
})

describe('input validation', () => {
  it('10. rejects a malformed occurrence key', async () => {
    const { db, completions } = createFakeD1()
    const token = await seedToken(db, 'google-sub-a', 'a@example.com')

    for (const key of [
      'not-a-key',
      '2026-13-01:work',
      '2026-09-07:',
      "2026-09-07:a'; DROP TABLE today_completions;--",
      '2026-09-07:../../etc/passwd',
      `2026-09-07:${'a'.repeat(200)}`,
    ]) {
      const { response, body } = await call(db, {
        token,
        method: 'PUT',
        key,
        origin: ORIGIN,
      })
      expect(response.status).toBe(400)
      expect(body.error).toBe('invalid_occurrence_key')
    }
    expect(completions.size).toBe(0)
  })

  it('rejects a malformed day range', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'google-sub-a', 'a@example.com')

    for (const query of [
      '',
      'from=2026-09-07',
      'to=2026-09-07',
      'from=2026-09-08&to=2026-09-07',
      'from=nope&to=2026-09-07',
      'from=2026-01-01&to=2026-12-31',
    ]) {
      const { response, body } = await call(db, { token, query })
      expect(response.status).toBe(400)
      expect(body.error).toBe('invalid_range')
    }
  })

  it('rejects unsupported methods and unknown paths', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'google-sub-a', 'a@example.com')

    const post = await call(db, { token, method: 'POST', origin: ORIGIN })
    expect(post.response.status).toBe(405)

    const getItem = await call(db, { token, method: 'GET', key: KEY })
    expect(getItem.response.status).toBe(405)

    const unknown = await handleTodayRequest(
      new Request(`${ORIGIN}/api/today/nope`, {
        headers: { Cookie: `vshape_session=${token}` },
      }),
      makeEnv(db),
    )
    expect(unknown?.status).toBe(404)
  })

  it('leaves non-Today requests to the rest of the Worker', async () => {
    const { db } = createFakeD1()
    expect(await handleTodayRequest(new Request(`${ORIGIN}/today`), makeEnv(db))).toBeNull()
    expect(
      await handleTodayRequest(new Request(`${ORIGIN}/api/auth/session`), makeEnv(db)),
    ).toBeNull()
  })
})

describe('storage failure', () => {
  it('11. returns a controlled error and leaks nothing', async () => {
    const { db, breakCompletions } = createFakeD1()
    const token = await seedToken(db, 'google-sub-a', 'a@example.com')
    breakCompletions(new Error('D1_ERROR: no such table: today_completions'))

    for (const options of [
      { token },
      { token, method: 'PUT', key: KEY, origin: ORIGIN },
      { token, method: 'DELETE', key: KEY, origin: ORIGIN },
    ]) {
      const { response, body } = await call(db, options)
      expect(response.status).toBe(500)
      expect(body).toEqual({ error: 'server_error' })
      expect(JSON.stringify(body)).not.toContain('no such table')
    }
  })
})

describe('reads are scoped to the signed-in account', () => {
  it('12. returns only the current account’s completions', async () => {
    const { db } = createFakeD1()
    const tokenA = await seedToken(db, 'google-sub-a', 'a@example.com')
    const tokenB = await seedToken(db, 'google-sub-b', 'b@example.com')

    await call(db, { token: tokenA, method: 'PUT', key: KEY, origin: ORIGIN })
    await call(db, {
      token: tokenA,
      method: 'PUT',
      key: '2026-09-06:ready-to-sleep',
      origin: ORIGIN,
    })
    await call(db, {
      token: tokenB,
      method: 'PUT',
      key: '2026-09-07:reading',
      origin: ORIGIN,
    })

    const a = await call(db, { token: tokenA })
    expect((a.body.completions as { key: string }[]).map((row) => row.key)).toEqual([
      '2026-09-06:ready-to-sleep',
      '2026-09-07:gym-training',
    ])

    const b = await call(db, { token: tokenB })
    expect((b.body.completions as { key: string }[]).map((row) => row.key)).toEqual([
      '2026-09-07:reading',
    ])
  })

  it('13. one account can never see or remove another’s completion', async () => {
    const { db, completions } = createFakeD1()
    const tokenA = await seedToken(db, 'google-sub-a', 'a@example.com')
    const tokenB = await seedToken(db, 'google-sub-b', 'b@example.com')

    await call(db, { token: tokenA, method: 'PUT', key: KEY, origin: ORIGIN })

    // B never sees it...
    const seen = await call(db, { token: tokenB })
    expect(seen.body.completions).toEqual([])

    // ...and B deleting the same key cannot touch A's row.
    const removed = await call(db, {
      token: tokenB,
      method: 'DELETE',
      key: KEY,
      origin: ORIGIN,
    })
    expect(removed.response.status).toBe(200)
    expect(completions.size).toBe(1)
    expect((await call(db, { token: tokenA })).body.completions).toHaveLength(1)
  })
})

describe('write semantics over HTTP', () => {
  it('is idempotent for a repeated complete', async () => {
    const { db, completions } = createFakeD1()
    const token = await seedToken(db, 'google-sub-a', 'a@example.com')

    await call(db, { token, method: 'PUT', key: KEY, origin: ORIGIN })
    const first = [...completions.values()][0].completed_at
    await call(db, { token, method: 'PUT', key: KEY, origin: ORIGIN })
    await call(db, { token, method: 'PUT', key: KEY, origin: ORIGIN })

    expect(completions.size).toBe(1)
    expect([...completions.values()][0].completed_at).toBe(first)
  })

  it('is idempotent for a repeated undo', async () => {
    const { db, completions } = createFakeD1()
    const token = await seedToken(db, 'google-sub-a', 'a@example.com')
    await call(db, { token, method: 'PUT', key: KEY, origin: ORIGIN })

    for (let i = 0; i < 3; i += 1) {
      const { response } = await call(db, {
        token,
        method: 'DELETE',
        key: KEY,
        origin: ORIGIN,
      })
      expect(response.status).toBe(200)
    }
    expect(completions.size).toBe(0)
  })

  it('stores the anchor day derived from the key', async () => {
    const { db, completions } = createFakeD1()
    const token = await seedToken(db, 'google-sub-a', 'a@example.com')
    await call(db, {
      token,
      method: 'PUT',
      key: '2026-09-06:ready-to-sleep',
      origin: ORIGIN,
    })
    expect([...completions.values()][0].anchor_day).toBe('2026-09-06')
  })

  it('keeps a spillover completion separate from today’s same item', async () => {
    const { db, completions } = createFakeD1()
    const token = await seedToken(db, 'google-sub-a', 'a@example.com')

    await call(db, {
      token,
      method: 'PUT',
      key: '2026-09-06:ready-to-sleep',
      origin: ORIGIN,
    })
    await call(db, {
      token,
      method: 'PUT',
      key: '2026-09-07:ready-to-sleep',
      origin: ORIGIN,
    })
    expect(completions.size).toBe(2)

    await call(db, {
      token,
      method: 'DELETE',
      key: '2026-09-07:ready-to-sleep',
      origin: ORIGIN,
    })
    expect([...completions.values()].map((row) => row.occurrence_key)).toEqual([
      '2026-09-06:ready-to-sleep',
    ])
  })
})

/* ------------------------------------------------------------------ */
/* Rolling trusted sessions                                            */
/* ------------------------------------------------------------------ */

const DAY = 24 * 60 * 60 * 1000
const START = Date.UTC(2026, 8, 1)
const TRUSTED_MAX_AGE = TRUSTED_SESSION_MS / 1000

afterEach(() => {
  vi.useRealTimers()
})

function setCookieOf(response: Response) {
  return response.headers.get('Set-Cookie')
}

function maxAgeOf(setCookie: string | null): number | null {
  if (!setCookie) return null
  const match = /Max-Age=(\d+)/.exec(setCookie)
  return match ? Number(match[1]) : null
}

/**
 * Seed a session and move the clock so it is inside (or outside) the trusted
 * rolling-refresh window.
 */
async function seedAtAge(
  db: D1Database,
  days: number,
  options: { trusted?: boolean } = {},
) {
  vi.useFakeTimers()
  vi.setSystemTime(START)
  const seeded = await seedSession(db, 'google-sub-a', 'a@example.com', {
    ...options,
    createdAt: START,
  })
  vi.setSystemTime(START + days * DAY)
  return seeded
}

describe('trusted session rolling cookie', () => {
  it('1. issues no cookie on a read outside the refresh window', async () => {
    const { db, sessions } = createFakeD1()
    const { token, record } = await seedAtAge(db, 10) // 20 days left

    const response = await handleTodayRequest(request({ token }), makeEnv(db))

    expect(response?.status).toBe(200)
    expect(setCookieOf(response!)).toBeNull()
    // ...and D1 was not written either.
    expect(sessions.get(record.sessionHash)?.expires_at).toBe(record.expiresAt)
  })

  it('2. rolls D1 and re-issues the cookie on a read inside the window', async () => {
    const { db, sessions } = createFakeD1()
    const { token, record } = await seedAtAge(db, 26) // 4 days left

    const response = await handleTodayRequest(request({ token }), makeEnv(db))
    const setCookie = setCookieOf(response!)

    expect(response?.status).toBe(200)
    // D1 rolled forward...
    expect(sessions.get(record.sessionHash)?.expires_at).toBe(
      START + 26 * DAY + TRUSTED_SESSION_MS,
    )
    // ...and the browser cookie was renewed to match.
    expect(maxAgeOf(setCookie)).toBe(TRUSTED_MAX_AGE)
    expect(setCookie).toContain(`vshape_session=${token}`)
  })

  it('3. re-issues the cookie on a complete inside the window', async () => {
    const { db, completions } = createFakeD1()
    const { token } = await seedAtAge(db, 26)

    const response = await handleTodayRequest(
      request({ token, method: 'PUT', key: KEY, origin: ORIGIN }),
      makeEnv(db),
    )

    expect(response?.status).toBe(200)
    expect(completions.size).toBe(1)
    expect(maxAgeOf(setCookieOf(response!))).toBe(TRUSTED_MAX_AGE)
  })

  it('4. rolls once per window — a follow-up undo needs no second cookie', async () => {
    const { db, completions } = createFakeD1()
    const { token } = await seedAtAge(db, 26)

    await handleTodayRequest(
      request({ token, method: 'PUT', key: KEY, origin: ORIGIN }),
      makeEnv(db),
    )
    const response = await handleTodayRequest(
      request({ token, method: 'DELETE', key: KEY, origin: ORIGIN }),
      makeEnv(db),
    )

    expect(response?.status).toBe(200)
    expect(completions.size).toBe(0)
    // The first request already rolled D1, so only that one re-issues.
    expect(setCookieOf(response!)).toBeNull()
  })

  it('4b. re-issues the cookie on an undo inside the window', async () => {
    const { db } = createFakeD1()
    const { token } = await seedAtAge(db, 26)

    const response = await handleTodayRequest(
      request({ token, method: 'DELETE', key: KEY, origin: ORIGIN }),
      makeEnv(db),
    )

    expect(response?.status).toBe(200)
    expect(maxAgeOf(setCookieOf(response!))).toBe(TRUSTED_MAX_AGE)
  })

  it('5. the refreshed cookie keeps every accepted attribute', async () => {
    const { db } = createFakeD1()
    const { token } = await seedAtAge(db, 26)

    const secure = setCookieOf(
      (await handleTodayRequest(request({ token }), makeEnv(db)))!,
    )
    expect(secure).toContain('HttpOnly')
    expect(secure).toContain('SameSite=Lax')
    expect(secure).toContain('Path=/')
    expect(secure).toContain(`Max-Age=${TRUSTED_MAX_AGE}`)
    // APP_ORIGIN is https here, so the cookie is Secure.
    expect(secure).toContain('Secure')

    // On plain-http local development it is not.
    const { db: db2 } = createFakeD1()
    const local = await seedAtAge(db2, 26)
    const httpEnv: Env = {
      DB: db2,
      ASSETS: {} as Fetcher,
      APP_ORIGIN: 'http://localhost:5173',
    }
    const httpResponse = await handleTodayRequest(
      new Request(`http://localhost:5173/api/today/completions?${RANGE}`, {
        headers: { Cookie: `vshape_session=${local.token}` },
      }),
      httpEnv,
    )
    const insecure = setCookieOf(httpResponse!)
    expect(insecure).toContain('HttpOnly')
    expect(insecure).not.toContain('Secure')
  })

  it('6. never rolls an untrusted session', async () => {
    const { db, sessions } = createFakeD1()
    // 23 hours in: an untrusted session has under an hour left and still
    // must not roll — it is fixed-expiry by design.
    vi.useFakeTimers()
    vi.setSystemTime(START)
    const { token, record } = await seedSession(db, 'google-sub-a', 'a@example.com', {
      trusted: false,
      createdAt: START,
    })
    vi.setSystemTime(START + 23 * 60 * 60 * 1000)

    const response = await handleTodayRequest(request({ token }), makeEnv(db))

    expect(response?.status).toBe(200)
    expect(setCookieOf(response!)).toBeNull()
    expect(sessions.get(record.sessionHash)?.expires_at).toBe(
      START + UNTRUSTED_SESSION_MS,
    )
  })

  it('re-issues the cookie even when the request itself is rejected', async () => {
    const { db } = createFakeD1()
    const { token } = await seedAtAge(db, 26)

    // A malformed key still rolled the session on the way in.
    const response = await handleTodayRequest(
      request({ token, method: 'PUT', key: 'not-a-key', origin: ORIGIN }),
      makeEnv(db),
    )

    expect(response?.status).toBe(400)
    expect(maxAgeOf(setCookieOf(response!))).toBe(TRUSTED_MAX_AGE)
  })

  it('re-issues the cookie even when storage then fails', async () => {
    const { db, breakCompletions } = createFakeD1()
    const { token } = await seedAtAge(db, 26)
    breakCompletions()

    const response = await handleTodayRequest(request({ token }), makeEnv(db))

    expect(response?.status).toBe(500)
    expect(maxAgeOf(setCookieOf(response!))).toBe(TRUSTED_MAX_AGE)
  })

  it('clears a cookie that can no longer authenticate', async () => {
    const { db } = createFakeD1()
    const { token } = await seedAtAge(db, 31) // past the 30 day expiry

    const response = await handleTodayRequest(request({ token }), makeEnv(db))
    const setCookie = setCookieOf(response!)

    expect(response?.status).toBe(401)
    expect(setCookie).toContain('vshape_session=;')
    expect(setCookie).toContain('Max-Age=0')
    expect(setCookie).toContain('HttpOnly')
  })

  it('sends no cookie header when there was no cookie to begin with', async () => {
    const { db } = createFakeD1()
    const response = await handleTodayRequest(request({}), makeEnv(db))
    expect(response?.status).toBe(401)
    expect(setCookieOf(response!)).toBeNull()
  })
})
