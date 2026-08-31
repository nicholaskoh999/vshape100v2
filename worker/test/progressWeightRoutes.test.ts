import { describe, expect, it } from 'vitest'

import type { Env } from '../auth/config'
import { createD1SessionStore } from '../auth/d1Stores'
import { createSession } from '../auth/session'
import { handleProgressRequest } from '../progress/routes'
import { createFakeD1 } from './fakeD1'

/**
 * Round 15 — the body weight API.
 *
 * The account is always the session's. No endpoint reads an identity from a
 * body, a query string, a path or a header, and no response tells one account
 * anything about another's measurements — including whether they exist.
 */

const ORIGIN = 'https://vshapev2.nkmwei.de'
const BASE = `${ORIGIN}/api/progress`
const ZONE = 'Asia/Kuala_Lumpur'

function makeEnv(db: D1Database): Env {
  return { DB: db, ASSETS: {} as Fetcher, APP_ORIGIN: ORIGIN } as unknown as Env
}

async function seedToken(db: D1Database, googleSub: string, email: string) {
  return (await createSession(createD1SessionStore(db), { googleSub, email, trusted: true }))
    .token
}

type CallOptions = {
  token?: string
  method?: string
  path?: string
  body?: unknown
  origin?: string
}

async function call(db: D1Database, options: CallOptions = {}) {
  const headers: Record<string, string> = {}
  if (options.token) headers.Cookie = `vshape_session=${options.token}`
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'
  if (options.origin) headers.Origin = options.origin

  const request = new Request(`${BASE}${options.path ?? '/weight'}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })

  const response = await handleProgressRequest(request, makeEnv(db))
  if (!response) throw new Error('handler did not claim the request')
  return { response, body: (await response.json()) as Record<string, never> }
}

/** Save a measurement for an account. */
async function save(db: D1Database, token: string, localDate: string, weightKg: number) {
  return call(db, {
    token,
    method: 'PUT',
    origin: ORIGIN,
    body: { localDate, weightKg, timezone: ZONE },
  })
}

/* ------------------------------------------------------------------ */
/* 1. Authentication and origin                                        */
/* ------------------------------------------------------------------ */

describe('1. only the signed-in account', () => {
  it('refuses every route without a session', async () => {
    const { db } = createFakeD1()

    for (const options of [
      { method: 'GET' as const },
      { method: 'PUT' as const, origin: ORIGIN, body: { localDate: '2020-05-01', weightKg: 78 } },
      { method: 'DELETE' as const, origin: ORIGIN, path: '/weight/2020-05-01' },
      { method: 'GET' as const, path: '/performance' },
    ]) {
      const { response, body } = await call(db, options)
      expect(response.status, options.method + (options.path ?? '')).toBe(401)
      expect(body.error).toBe('unauthenticated')
    }
  })

  it('refuses a cross-origin write', async () => {
    const { db, bodyWeights } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')

    const { response } = await call(db, {
      token,
      method: 'PUT',
      origin: 'https://evil.example',
      body: { localDate: '2020-05-01', weightKg: 78, timezone: ZONE },
    })

    expect(response.status).toBe(403)
    expect(bodyWeights.size).toBe(0)
  })

  it('refuses a cross-origin delete', async () => {
    const { db, bodyWeights } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')
    await save(db, token, '2020-05-01', 78)

    const { response } = await call(db, {
      token,
      method: 'DELETE',
      path: '/weight/2020-05-01',
      origin: 'https://evil.example',
    })

    expect(response.status).toBe(403)
    expect(bodyWeights.size).toBe(1)
  })

  it('allows a read without an Origin header', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')
    const { response } = await call(db, { token })
    expect(response.status).toBe(200)
  })

  it('refuses methods the routes do not have', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')

    for (const [path, method] of [
      ['/weight', 'DELETE'],
      ['/weight/2020-05-01', 'PUT'],
      ['/performance', 'PUT'],
    ] as const) {
      const { response } = await call(db, { token, method, path, origin: ORIGIN })
      expect(response.status, `${method} ${path}`).toBe(405)
    }
  })

  it('404s an unknown progress path', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')
    const { response } = await call(db, { token, path: '/nonsense' })
    expect(response.status).toBe(404)
  })
})

/* ------------------------------------------------------------------ */
/* 2. Writing                                                          */
/* ------------------------------------------------------------------ */

describe('2. saving a measurement', () => {
  it('stores a whole number of kilograms', async () => {
    const { db, bodyWeights } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')

    const { response, body } = await save(db, token, '2020-05-01', 78)

    expect(response.status).toBe(200)
    expect(body.entry).toEqual({ date: '2020-05-01', weightKg: 78, tenths: 780 })
    expect([...bodyWeights.values()][0].weight_tenths_kg).toBe(780)
  })

  it('stores one decimal place exactly', async () => {
    const { db, bodyWeights } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')

    await save(db, token, '2020-05-01', 78.4)

    // Integer tenths in storage, so nothing can drift.
    expect([...bodyWeights.values()][0].weight_tenths_kg).toBe(784)
  })

  it('refuses more than one decimal place', async () => {
    const { db, bodyWeights } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')

    const { response, body } = await save(db, token, '2020-05-01', 78.45)

    expect(response.status).toBe(400)
    expect(body.field).toBe('weight')
    // Refused, not silently rounded to 78.5.
    expect(bodyWeights.size).toBe(0)
  })

  it('refuses zero, negative and non-numeric weights', async () => {
    const { db, bodyWeights } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')

    for (const weight of [0, -1, -78.4, 'heavy', null, NaN]) {
      const { response } = await call(db, {
        token,
        method: 'PUT',
        origin: ORIGIN,
        body: { localDate: '2020-05-01', weightKg: weight, timezone: ZONE },
      })
      expect(response.status, String(weight)).toBe(400)
    }
    expect(bodyWeights.size).toBe(0)
  })

  it('refuses a malformed or impossible date', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')

    for (const date of ['2026-9-1', '2026-02-30', '2026-13-01', 'yesterday']) {
      const { response, body } = await call(db, {
        token,
        method: 'PUT',
        origin: ORIGIN,
        body: { localDate: date, weightKg: 78, timezone: ZONE },
      })
      expect(response.status, date).toBe(400)
      expect(body.field).toBe('date')
    }
  })

  it('refuses an invalid timezone', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')

    const { response, body } = await call(db, {
      token,
      method: 'PUT',
      origin: ORIGIN,
      body: { localDate: '2020-05-01', weightKg: 78, timezone: 'Mars/Olympus' },
    })

    expect(response.status).toBe(400)
    expect(body.field).toBe('timezone')
  })

  it('refuses a future local date', async () => {
    const { db, bodyWeights } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')

    const { response, body } = await call(db, {
      token,
      method: 'PUT',
      origin: ORIGIN,
      body: { localDate: '2099-01-01', weightKg: 78, timezone: ZONE },
    })

    expect(response.status).toBe(400)
    expect(body.field).toBe('future')
    expect(bodyWeights.size).toBe(0)
  })

  it('backfills a past date', async () => {
    const { db, bodyWeights } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')

    const { response } = await save(db, token, '2020-01-02', 81.2)

    expect(response.status).toBe(200)
    expect([...bodyWeights.values()][0].local_date).toBe('2020-01-02')
  })

  it('refuses invalid JSON', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')

    const request = new Request(`${BASE}/weight`, {
      method: 'PUT',
      headers: {
        Cookie: `vshape_session=${token}`,
        'Content-Type': 'application/json',
        Origin: ORIGIN,
      },
      body: '{ not json',
    })
    const response = await handleProgressRequest(request, makeEnv(db))
    expect(response?.status).toBe(400)
  })
})

/* ------------------------------------------------------------------ */
/* 3. One account, one date, one entry                                 */
/* ------------------------------------------------------------------ */

describe('3. identity', () => {
  it('updates rather than duplicating when the same date is saved again', async () => {
    const { db, bodyWeights } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')

    await save(db, token, '2020-05-01', 78.4)
    await save(db, token, '2020-05-01', 77.9)
    await save(db, token, '2020-05-01', 77.5)

    // One date, one row — never three contradictory weights for one day.
    expect(bodyWeights.size).toBe(1)
    expect([...bodyWeights.values()][0].weight_tenths_kg).toBe(775)
  })

  it('keeps two accounts on the same date independent', async () => {
    const { db, bodyWeights } = createFakeD1()
    const a = await seedToken(db, 'sub-a', 'a@example.com')
    const b = await seedToken(db, 'sub-b', 'b@example.com')

    await save(db, a, '2020-05-01', 78.4)
    await save(db, b, '2020-05-01', 92.1)

    expect(bodyWeights.size).toBe(2)
    const mine = [...bodyWeights.values()].filter((row) => row.google_sub === 'sub-a')
    expect(mine).toHaveLength(1)
    expect(mine[0].weight_tenths_kg).toBe(784)
  })

  it('never takes the account from the payload', async () => {
    const { db, bodyWeights } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')

    await call(db, {
      token,
      method: 'PUT',
      origin: ORIGIN,
      body: {
        localDate: '2020-05-01',
        weightKg: 78.4,
        timezone: ZONE,
        googleSub: 'sub-b',
        account: 'sub-b',
        email: 'b@example.com',
      },
    })

    // Filed under the SESSION's account, whatever the payload claimed.
    expect([...bodyWeights.values()][0].google_sub).toBe('sub-a')
  })

  it('lists only the signed-in account', async () => {
    const { db } = createFakeD1()
    const a = await seedToken(db, 'sub-a', 'a@example.com')
    const b = await seedToken(db, 'sub-b', 'b@example.com')

    await save(db, a, '2020-05-01', 78.4)
    await save(db, b, '2020-05-01', 92.1)
    await save(db, b, '2020-05-02', 92.5)

    const { body } = await call(db, { token: a })
    const points = body.points as unknown as { date: string; weightKg: number }[]

    expect(points).toEqual([{ date: '2020-05-01', weightKg: 78.4, tenths: 784 }])
  })
})

/* ------------------------------------------------------------------ */
/* 4. Deleting                                                         */
/* ------------------------------------------------------------------ */

describe('4. deleting', () => {
  it('removes this account own measurement', async () => {
    const { db, bodyWeights } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')
    await save(db, token, '2020-05-01', 78.4)

    const { response } = await call(db, {
      token,
      method: 'DELETE',
      path: '/weight/2020-05-01',
      origin: ORIGIN,
    })

    expect(response.status).toBe(200)
    expect(bodyWeights.size).toBe(0)
  })

  it('cannot touch another account measurement', async () => {
    const { db, bodyWeights } = createFakeD1()
    const a = await seedToken(db, 'sub-a', 'a@example.com')
    const b = await seedToken(db, 'sub-b', 'b@example.com')
    await save(db, a, '2020-05-01', 78.4)

    const { response } = await call(db, {
      token: b,
      method: 'DELETE',
      path: '/weight/2020-05-01',
      origin: ORIGIN,
    })

    expect(response.status).toBe(200)
    // A's measurement is untouched.
    expect(bodyWeights.size).toBe(1)
    expect([...bodyWeights.values()][0].google_sub).toBe('sub-a')
  })

  it('answers identically whether the measurement existed or not', async () => {
    const { db } = createFakeD1()
    const a = await seedToken(db, 'sub-a', 'a@example.com')
    const b = await seedToken(db, 'sub-b', 'b@example.com')
    await save(db, a, '2020-05-01', 78.4)

    const mine = await call(db, {
      token: a,
      method: 'DELETE',
      path: '/weight/2020-05-01',
      origin: ORIGIN,
    })
    const foreign = await call(db, {
      token: b,
      method: 'DELETE',
      path: '/weight/2020-05-01',
      origin: ORIGIN,
    })
    const absent = await call(db, {
      token: b,
      method: 'DELETE',
      path: '/weight/2011-01-01',
      origin: ORIGIN,
    })

    // Identical status and body: an account cannot probe whether another has a
    // measurement on a date by watching the shape of the answer.
    expect(mine.response.status).toBe(200)
    expect(foreign.response.status).toBe(200)
    expect(absent.response.status).toBe(200)
    expect(JSON.stringify(foreign.body)).toBe(JSON.stringify(mine.body))
    expect(JSON.stringify(absent.body)).toBe(
      JSON.stringify({ date: '2011-01-01' }),
    )
  })

  it('refuses a malformed date in the path', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')

    const { response } = await call(db, {
      token,
      method: 'DELETE',
      path: '/weight/2026-02-30',
      origin: ORIGIN,
    })
    expect(response.status).toBe(400)
  })
})

/* ------------------------------------------------------------------ */
/* 5. Reading and windows                                              */
/* ------------------------------------------------------------------ */

describe('5. reading', () => {
  /** Seed measurements relative to a fixed today. */
  async function seedRange(db: D1Database, token: string) {
    // Today is whatever the server clock says; these are all comfortably past.
    await save(db, token, '2020-01-01', 90)
    await save(db, token, '2020-02-01', 89.5)
    await save(db, token, '2020-03-01', 88)
  }

  it('returns an honest empty state', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')

    const { body } = await call(db, { token })

    expect(body.points).toEqual([])
    expect(body.summary).toMatchObject({
      latest: null,
      previous: null,
      first: null,
      changeFromPreviousTenths: null,
      changeFromFirstTenths: null,
      count: 0,
    })
  })

  it('refuses to compare a single measurement', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')
    await save(db, token, '2020-01-01', 90)

    const { body } = await call(db, { token })

    expect(body.summary).toMatchObject({
      changeFromPreviousTenths: null,
      changeFromFirstTenths: null,
      count: 1,
    })
  })

  it('computes both changes once there are two measurements', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')
    await seedRange(db, token)

    const { body } = await call(db, { token })

    expect(body.summary).toMatchObject({
      changeFromPreviousTenths: 880 - 895,
      changeFromFirstTenths: 880 - 900,
      count: 3,
    })
  })

  it('All includes measurements far older than any window', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')
    await seedRange(db, token)

    const { body } = await call(db, { token, path: '/weight?range=all' })
    const points = body.points as unknown as { date: string }[]

    expect(points.map((point) => point.date)).toEqual([
      '2020-01-01',
      '2020-02-01',
      '2020-03-01',
    ])
  })

  it('a bounded window excludes everything older than it', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')
    await seedRange(db, token)

    const { body } = await call(db, {
      token,
      path: `/weight?range=30d&timezone=${encodeURIComponent(ZONE)}`,
    })

    // Every seeded measurement is years old, so a 30-day window holds none of
    // them — and reports that honestly rather than reaching further back.
    expect(body.points).toEqual([])
    // The SUMMARY is lifetime, so it still knows about all three. The window
    // decides what is drawn, not what exists.
    expect(body.summary).toMatchObject({ count: 3 })
  })

  it('a bounded window requires a usable timezone', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')

    const { response, body } = await call(db, { token, path: '/weight?range=30d' })

    // Without a zone there is no "today" to end the window on, and defaulting
    // to UTC would shift the boundary by a day for most of the world.
    expect(response.status).toBe(400)
    expect(body.error).toBe('invalid_timezone')
  })

  it('All needs no timezone, so history stays readable without one', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')
    await save(db, token, '2020-01-01', 90)

    const { response } = await call(db, { token, path: '/weight?range=all' })
    expect(response.status).toBe(200)
  })

  it('refuses an unknown range', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')

    const { response, body } = await call(db, { token, path: '/weight?range=7d' })
    expect(response.status).toBe(400)
    expect(body.error).toBe('invalid_range')
  })

  it('carries exact tenths alongside kilograms', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')
    await save(db, token, '2020-01-01', 78.4)
    await save(db, token, '2020-01-02', 78.5)

    const { body } = await call(db, { token })

    // The client can subtract tenths exactly; subtracting the kg floats would
    // give -0.09999999999999432.
    expect(body.summary).toMatchObject({ changeFromPreviousTenths: 1 })
  })

  /*
   * The window chooses what is DRAWN. It does not change what "since first"
   * means. Recomputing the summary inside 30D would answer a different
   * question — "since the first measurement in the last month" — using the
   * same words, and the number would move every time the window changed.
   */
  describe('the summary is lifetime, not windowed', () => {
    /** The example from the review, verbatim. */
    async function seedExample(db: D1Database, token: string) {
      await save(db, token, '2026-01-01', 85)
      await save(db, token, '2026-08-20', 80)
      await save(db, token, '2026-08-31', 79)
    }

    it('keeps Latest, Previous and Since First identical in every window', async () => {
      const { db } = createFakeD1()
      const token = await seedToken(db, 'sub-a', 'a@example.com')
      await seedExample(db, token)

      const seen: Record<string, unknown> = {}
      for (const range of ['30d', '90d', 'all'] as const) {
        const { body } = await call(db, {
          token,
          path: `/weight?range=${range}&timezone=${encodeURIComponent(ZONE)}`,
        })
        seen[range] = body.summary
      }

      const expected = {
        latest: { date: '2026-08-31', weightKg: 79, tenths: 790 },
        previous: { date: '2026-08-20', weightKg: 80, tenths: 800 },
        first: { date: '2026-01-01', weightKg: 85, tenths: 850 },
        changeFromPreviousTenths: -10,
        changeFromFirstTenths: -60,
        count: 3,
      }

      // Byte-identical across all three windows.
      expect(seen['30d']).toEqual(expected)
      expect(seen['90d']).toEqual(expected)
      expect(seen.all).toEqual(expected)
    })

    it('changes only the drawn points when the window changes', async () => {
      const { db } = createFakeD1()
      const token = await seedToken(db, 'sub-a', 'a@example.com')
      await seedExample(db, token)

      const dates = async (range: string) => {
        const { body } = await call(db, {
          token,
          path: `/weight?range=${range}&timezone=${encodeURIComponent(ZONE)}`,
        })
        return (body.points as unknown as { date: string }[]).map((point) => point.date)
      }

      // Today is 2026-08-31, so 30D reaches back to 2026-08-02.
      expect(await dates('30d')).toEqual(['2026-08-20', '2026-08-31'])
      expect(await dates('90d')).toEqual(['2026-08-20', '2026-08-31'])
      expect(await dates('all')).toEqual(['2026-01-01', '2026-08-20', '2026-08-31'])
    })

    it('does not ship the whole history to compute it', async () => {
      const { db } = createFakeD1()
      const token = await seedToken(db, 'sub-a', 'a@example.com')
      await seedExample(db, token)

      const { body } = await call(db, {
        token,
        path: `/weight?range=30d&timezone=${encodeURIComponent(ZONE)}`,
      })

      // The January measurement is named by the summary, but it is NOT one of
      // the points the browser was sent to draw.
      expect((body.summary as unknown as { first: { date: string } }).first.date).toBe(
        '2026-01-01',
      )
      expect(body.points).toHaveLength(2)
    })

    it('still refuses to compare a lone measurement in any window', async () => {
      const { db } = createFakeD1()
      const token = await seedToken(db, 'sub-a', 'a@example.com')
      await save(db, token, '2026-08-31', 79)

      for (const range of ['30d', 'all'] as const) {
        const { body } = await call(db, {
          token,
          path: `/weight?range=${range}&timezone=${encodeURIComponent(ZONE)}`,
        })
        expect(body.summary, range).toMatchObject({
          changeFromPreviousTenths: null,
          changeFromFirstTenths: null,
          count: 1,
        })
      }
    })

    it('a measurement outside every window still sets Since First', async () => {
      const { db } = createFakeD1()
      const token = await seedToken(db, 'sub-a', 'a@example.com')
      await save(db, token, '2020-03-01', 95)
      await save(db, token, '2026-08-31', 79)

      const { body } = await call(db, {
        token,
        path: `/weight?range=30d&timezone=${encodeURIComponent(ZONE)}`,
      })

      // Six years and 16 kg ago, outside any window, and still the first.
      expect(body.summary).toMatchObject({
        changeFromFirstTenths: 790 - 950,
        count: 2,
      })
      expect(body.points).toHaveLength(1)
    })
  })

  it('reports a storage failure without leaking anything', async () => {
    const { db, breakProgress } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')
    breakProgress()

    const { response, body } = await call(db, { token })

    expect(response.status).toBe(500)
    expect(body).toEqual({ error: 'server_error' })
  })

  it('an edit is reflected in latest, previous and first', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')
    await save(db, token, '2020-01-01', 90)
    await save(db, token, '2020-02-01', 88)

    // Correct the older entry; the derived truth must move with it.
    await save(db, token, '2020-01-01', 92)

    const { body } = await call(db, { token })
    expect(body.summary).toMatchObject({
      changeFromFirstTenths: 880 - 920,
      changeFromPreviousTenths: 880 - 920,
      count: 2,
    })
  })

  it('a delete is reflected in the summary', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')
    await save(db, token, '2020-01-01', 90)
    await save(db, token, '2020-02-01', 88)
    await call(db, { token, method: 'DELETE', path: '/weight/2020-02-01', origin: ORIGIN })

    const { body } = await call(db, { token })

    // Back to one measurement, so the comparisons become unavailable again
    // rather than keeping a stale change.
    expect(body.summary).toMatchObject({ count: 1, changeFromPreviousTenths: null })
  })
})
