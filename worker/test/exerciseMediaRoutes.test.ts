import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Env } from '../auth/config'
import { createD1SessionStore } from '../auth/d1Stores'
import { createSession, TRUSTED_SESSION_MS } from '../auth/session'
import { handleExerciseMediaRequest } from '../exerciseMedia/routes'
import { createFakeD1 } from './fakeD1'

/**
 * Round 07 — the canonical exercise media API.
 *
 * The real handler, the real D1 mapping layer and the real rules all run
 * together against the in-memory D1 stand-in. Every media URL is a fixture:
 * no test touches a real network or a real media file.
 */

const ORIGIN = 'https://vshapev2.nkmwei.de'
const BASE = `${ORIGIN}/api/exercise-media`
const EXERCISE = 'lat-pulldown'

const GIF = {
  kind: 'gif',
  url: 'https://media.test.invalid/lat-pulldown.gif',
  alt: 'Lat Pulldown demonstration',
}
const IMAGE = {
  kind: 'image',
  url: 'https://media.test.invalid/lat-pulldown.png',
  alt: 'Lat Pulldown still',
}

function makeEnv(db: D1Database): Env {
  return { DB: db, ASSETS: {} as Fetcher, APP_ORIGIN: ORIGIN }
}

async function seedSession(
  db: D1Database,
  googleSub: string,
  email: string,
  options: { trusted?: boolean; createdAt?: number } = {},
) {
  return createSession(
    createD1SessionStore(db),
    { googleSub, email, trusted: options.trusted ?? true },
    options.createdAt,
  )
}

async function seedToken(db: D1Database, googleSub: string, email: string) {
  return (await seedSession(db, googleSub, email)).token
}

type ReqOptions = {
  token?: string
  method?: string
  origin?: string
  /** Omit for the collection; pass a slug (or a raw path segment) for an item. */
  id?: string
  body?: unknown
  /** Send a raw string body instead of JSON-encoding `body`. */
  rawBody?: string
}

function request({ token, method = 'GET', origin, id, body, rawBody }: ReqOptions): Request {
  const url = id === undefined ? BASE : `${BASE}/${id}`
  const headers: Record<string, string> = {}
  if (token) headers.Cookie = `vshape_session=${token}`
  if (origin) headers.Origin = origin
  const payload = rawBody ?? (body === undefined ? undefined : JSON.stringify(body))
  if (payload !== undefined) headers['Content-Type'] = 'application/json'
  return new Request(url, { method, headers, body: payload })
}

async function call(db: D1Database, options: ReqOptions) {
  const response = await handleExerciseMediaRequest(request(options), makeEnv(db))
  if (!response) throw new Error('handler did not claim the request')
  return { response, body: (await response.json()) as Record<string, unknown> }
}

/** Save one record the ordinary way, so tests share the real write path. */
async function save(db: D1Database, token: string, id: string, media: unknown) {
  return call(db, { token, method: 'PUT', id, origin: ORIGIN, body: media })
}

/* ------------------------------------------------------------------ */
/* Authentication                                                      */
/* ------------------------------------------------------------------ */

describe('authentication', () => {
  it('rejects an unauthenticated list', async () => {
    const { db } = createFakeD1()
    const { response, body } = await call(db, {})
    expect(response.status).toBe(401)
    expect(body.error).toBe('unauthenticated')
  })

  it('rejects an unauthenticated item read', async () => {
    const { db } = createFakeD1()
    const { response } = await call(db, { id: EXERCISE })
    expect(response.status).toBe(401)
  })

  it('rejects an unauthenticated save and stores nothing', async () => {
    const { db, media } = createFakeD1()
    const { response } = await call(db, {
      method: 'PUT',
      id: EXERCISE,
      origin: ORIGIN,
      body: GIF,
    })
    expect(response.status).toBe(401)
    expect(media.size).toBe(0)
  })

  it('rejects an unauthenticated delete', async () => {
    const { db } = createFakeD1()
    const { response } = await call(db, { method: 'DELETE', id: EXERCISE, origin: ORIGIN })
    expect(response.status).toBe(401)
  })

  it('rejects a bogus session cookie', async () => {
    const { db } = createFakeD1()
    const { response } = await call(db, { token: 'not-a-real-token' })
    expect(response.status).toBe(401)
  })

  it('takes the account from the session, never from the request', async () => {
    const { db, media } = createFakeD1()
    const token = await seedToken(db, 'google-sub-a', 'a@example.com')

    // A client-supplied identity in the body and the query string is ignored.
    const response = await handleExerciseMediaRequest(
      new Request(`${BASE}/${EXERCISE}?google_sub=attacker`, {
        method: 'PUT',
        headers: {
          Cookie: `vshape_session=${token}`,
          Origin: ORIGIN,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ...GIF, googleSub: 'attacker', google_sub: 'attacker' }),
      }),
      makeEnv(db),
    )

    expect(response?.status).toBe(200)
    expect([...media.values()].map((row) => row.google_sub)).toEqual(['google-sub-a'])
  })

  it('never echoes an identity back to the browser', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'google-sub-a', 'a@example.com')
    await save(db, token, EXERCISE, GIF)

    const item = await call(db, { token, id: EXERCISE })
    const list = await call(db, { token })

    for (const body of [item.body, list.body]) {
      const serialised = JSON.stringify(body)
      expect(serialised).not.toContain('google-sub-a')
      expect(serialised).not.toContain('a@example.com')
    }
  })

  it('marks every response no-store', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'google-sub-a', 'a@example.com')

    const list = await call(db, { token })
    const item = await call(db, { token, id: EXERCISE })
    const saved = await save(db, token, EXERCISE, GIF)
    const removed = await call(db, { token, method: 'DELETE', id: EXERCISE, origin: ORIGIN })
    const rejected = await call(db, { token, id: 'NOT A SLUG' })

    for (const { response } of [list, item, saved, removed, rejected]) {
      expect(response.headers.get('Cache-Control')).toBe('no-store')
    }
  })
})

/* ------------------------------------------------------------------ */
/* Cross-origin protection                                             */
/* ------------------------------------------------------------------ */

describe('cross-origin protection', () => {
  it('blocks a cross-origin PUT', async () => {
    const { db, media } = createFakeD1()
    const token = await seedToken(db, 'google-sub-a', 'a@example.com')

    const { response, body } = await call(db, {
      token,
      method: 'PUT',
      id: EXERCISE,
      origin: 'https://evil.example.com',
      body: GIF,
    })

    expect(response.status).toBe(403)
    expect(body.error).toBe('forbidden')
    expect(media.size).toBe(0)
  })

  it('blocks a cross-origin DELETE and leaves the record alone', async () => {
    const { db, media } = createFakeD1()
    const token = await seedToken(db, 'google-sub-a', 'a@example.com')
    await save(db, token, EXERCISE, GIF)

    const { response } = await call(db, {
      token,
      method: 'DELETE',
      id: EXERCISE,
      origin: 'https://evil.example.com',
    })

    expect(response.status).toBe(403)
    expect(media.size).toBe(1)
  })

  it('allows a same-origin write', async () => {
    const { db, media } = createFakeD1()
    const token = await seedToken(db, 'google-sub-a', 'a@example.com')

    const { response } = await save(db, token, EXERCISE, GIF)
    expect(response.status).toBe(200)
    expect(media.size).toBe(1)
  })
})

/* ------------------------------------------------------------------ */
/* Read / write over HTTP                                              */
/* ------------------------------------------------------------------ */

describe('reading and writing canonical media', () => {
  it('lists the account’s records', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'google-sub-a', 'a@example.com')
    await save(db, token, EXERCISE, GIF)
    await save(db, token, 'plank', IMAGE)

    const { response, body } = await call(db, { token })
    expect(response.status).toBe(200)
    expect((body.media as { exerciseId: string }[]).map((row) => row.exerciseId).sort()).toEqual([
      'lat-pulldown',
      'plank',
    ])
  })

  it('returns an empty list when nothing is set', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'google-sub-a', 'a@example.com')
    const { body } = await call(db, { token })
    expect(body.media).toEqual([])
  })

  it('reads one record back', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'google-sub-a', 'a@example.com')
    await save(db, token, EXERCISE, GIF)

    const { response, body } = await call(db, { token, id: EXERCISE })
    expect(response.status).toBe(200)
    expect(body.exerciseId).toBe(EXERCISE)
    expect(body.media).toMatchObject(GIF)
  })

  it('answers an exercise with no media with an honest null, not a 404', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'google-sub-a', 'a@example.com')

    const { response, body } = await call(db, { token, id: 'plank' })
    expect(response.status).toBe(200)
    expect(body).toEqual({ exerciseId: 'plank', media: null })
  })

  it('replaces an existing record instead of duplicating it', async () => {
    const { db, media } = createFakeD1()
    const token = await seedToken(db, 'google-sub-a', 'a@example.com')

    await save(db, token, EXERCISE, GIF)
    const { body } = await save(db, token, EXERCISE, IMAGE)

    expect(media.size).toBe(1)
    expect(body.media).toMatchObject(IMAGE)
    expect((await call(db, { token, id: EXERCISE })).body.media).toMatchObject(IMAGE)
  })

  it('keeps one row for an exercise however many times it is saved', async () => {
    const { db, media } = createFakeD1()
    const token = await seedToken(db, 'google-sub-a', 'a@example.com')

    // Lat Pulldown is trained on Monday, Wednesday and Thursday. Saving from
    // each of those contexts is still one canonical record.
    for (let i = 0; i < 3; i += 1) await save(db, token, EXERCISE, GIF)

    expect(media.size).toBe(1)
    expect([...media.values()][0].exercise_id).toBe(EXERCISE)
  })

  it('deletes a record and reports the honest empty state', async () => {
    const { db, media } = createFakeD1()
    const token = await seedToken(db, 'google-sub-a', 'a@example.com')
    await save(db, token, EXERCISE, GIF)

    const { response, body } = await call(db, {
      token,
      method: 'DELETE',
      id: EXERCISE,
      origin: ORIGIN,
    })

    expect(response.status).toBe(200)
    expect(body).toEqual({ exerciseId: EXERCISE, media: null })
    expect(media.size).toBe(0)
    expect((await call(db, { token, id: EXERCISE })).body.media).toBeNull()
  })

  it('is idempotent for a repeated delete', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'google-sub-a', 'a@example.com')

    for (let i = 0; i < 3; i += 1) {
      const { response } = await call(db, {
        token,
        method: 'DELETE',
        id: EXERCISE,
        origin: ORIGIN,
      })
      expect(response.status).toBe(200)
    }
  })

  it('stores the alt text trimmed', async () => {
    const { db, media } = createFakeD1()
    const token = await seedToken(db, 'google-sub-a', 'a@example.com')
    await save(db, token, EXERCISE, { ...GIF, alt: '  Lat Pulldown demonstration  ' })
    expect([...media.values()][0].media_alt).toBe('Lat Pulldown demonstration')
  })
})

/* ------------------------------------------------------------------ */
/* Account isolation                                                   */
/* ------------------------------------------------------------------ */

describe('account isolation', () => {
  it('one account never sees another’s media', async () => {
    const { db } = createFakeD1()
    const tokenA = await seedToken(db, 'google-sub-a', 'a@example.com')
    const tokenB = await seedToken(db, 'google-sub-b', 'b@example.com')

    await save(db, tokenA, EXERCISE, GIF)

    expect((await call(db, { token: tokenB })).body.media).toEqual([])
    expect((await call(db, { token: tokenB, id: EXERCISE })).body.media).toBeNull()
  })

  it('one account can never overwrite or delete another’s record', async () => {
    const { db, media } = createFakeD1()
    const tokenA = await seedToken(db, 'google-sub-a', 'a@example.com')
    const tokenB = await seedToken(db, 'google-sub-b', 'b@example.com')

    await save(db, tokenA, EXERCISE, GIF)
    await save(db, tokenB, EXERCISE, IMAGE)

    // Two accounts, same exercise: two rows, neither disturbed.
    expect(media.size).toBe(2)
    expect((await call(db, { token: tokenA, id: EXERCISE })).body.media).toMatchObject(GIF)

    await call(db, { token: tokenB, method: 'DELETE', id: EXERCISE, origin: ORIGIN })
    expect((await call(db, { token: tokenA, id: EXERCISE })).body.media).toMatchObject(GIF)
  })
})

/* ------------------------------------------------------------------ */
/* Validation over HTTP                                                */
/* ------------------------------------------------------------------ */

describe('input validation', () => {
  it('rejects a malformed exercise id', async () => {
    const { db, media } = createFakeD1()
    const token = await seedToken(db, 'google-sub-a', 'a@example.com')

    for (const id of [
      'Lat-Pulldown',
      'lat_pulldown',
      encodeURIComponent('lat pulldown'),
      encodeURIComponent("lat'; DROP TABLE exercise_media;--"),
      encodeURIComponent('../../etc/passwd'),
      'a'.repeat(200),
      '',
    ]) {
      const { response, body } = await call(db, {
        token,
        method: 'PUT',
        id,
        origin: ORIGIN,
        body: GIF,
      })
      expect(response.status).toBe(400)
      expect(body.error).toBe('invalid_exercise_id')
    }
    expect(media.size).toBe(0)
  })

  it('rejects an unsupported media type', async () => {
    const { db, media } = createFakeD1()
    const token = await seedToken(db, 'google-sub-a', 'a@example.com')

    for (const kind of ['video', 'GIF', 'webm', null, 1]) {
      const { response, body } = await call(db, {
        token,
        method: 'PUT',
        id: EXERCISE,
        origin: ORIGIN,
        body: { ...GIF, kind },
      })
      expect(response.status).toBe(400)
      expect(body).toEqual({ error: 'invalid_media', field: 'kind' })
    }
    expect(media.size).toBe(0)
  })

  it('rejects unsafe URL schemes and malformed URLs', async () => {
    const { db, media } = createFakeD1()
    const token = await seedToken(db, 'google-sub-a', 'a@example.com')

    for (const url of [
      'javascript:alert(1)',
      'data:image/gif;base64,R0lGODlhAQABAAAAACw=',
      'file:///etc/passwd',
      'blob:https://media.test.invalid/abc',
      'ftp://media.test.invalid/a.gif',
      '/media/lat-pulldown.gif',
      'not a url',
      '',
    ]) {
      const { response, body } = await call(db, {
        token,
        method: 'PUT',
        id: EXERCISE,
        origin: ORIGIN,
        body: { ...GIF, url },
      })
      expect(response.status).toBe(400)
      expect(body).toEqual({ error: 'invalid_media', field: 'url' })
    }
    expect(media.size).toBe(0)
  })

  it('rejects missing or blank alt text', async () => {
    const { db, media } = createFakeD1()
    const token = await seedToken(db, 'google-sub-a', 'a@example.com')

    for (const body of [
      { kind: GIF.kind, url: GIF.url },
      { ...GIF, alt: '' },
      { ...GIF, alt: '   ' },
      { ...GIF, alt: 'x'.repeat(200) },
    ]) {
      const result = await call(db, {
        token,
        method: 'PUT',
        id: EXERCISE,
        origin: ORIGIN,
        body,
      })
      expect(result.response.status).toBe(400)
      expect(result.body).toEqual({ error: 'invalid_media', field: 'alt' })
    }
    expect(media.size).toBe(0)
  })

  it('rejects malformed JSON', async () => {
    const { db, media } = createFakeD1()
    const token = await seedToken(db, 'google-sub-a', 'a@example.com')

    const { response, body } = await call(db, {
      token,
      method: 'PUT',
      id: EXERCISE,
      origin: ORIGIN,
      rawBody: '{ not json',
    })

    expect(response.status).toBe(400)
    expect(body).toEqual({ error: 'invalid_json' })
    expect(media.size).toBe(0)
  })

  it('rejects a body that is not an object', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'google-sub-a', 'a@example.com')

    const { response, body } = await call(db, {
      token,
      method: 'PUT',
      id: EXERCISE,
      origin: ORIGIN,
      rawBody: '"just a string"',
    })

    expect(response.status).toBe(400)
    expect(body).toEqual({ error: 'invalid_media', field: 'body' })
  })

  it('rejects unsupported methods', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'google-sub-a', 'a@example.com')

    const collectionPut = await call(db, { token, method: 'PUT', origin: ORIGIN, body: GIF })
    expect(collectionPut.response.status).toBe(405)

    const collectionDelete = await call(db, { token, method: 'DELETE', origin: ORIGIN })
    expect(collectionDelete.response.status).toBe(405)

    const itemPost = await call(db, { token, method: 'POST', id: EXERCISE, origin: ORIGIN })
    expect(itemPost.response.status).toBe(405)
  })

  it('reports an unknown nested path as not found', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'google-sub-a', 'a@example.com')

    const { response, body } = await call(db, { token, id: `${EXERCISE}/monday` })
    expect(response.status).toBe(404)
    expect(body).toEqual({ error: 'not_found' })
  })

  it('leaves requests that are not ours to the rest of the Worker', async () => {
    const { db } = createFakeD1()
    for (const url of [
      `${ORIGIN}/exercises/lat-pulldown`,
      `${ORIGIN}/api/auth/session`,
      `${ORIGIN}/api/today/completions`,
      `${ORIGIN}/api/exercise-media-other`,
    ]) {
      expect(await handleExerciseMediaRequest(new Request(url), makeEnv(db))).toBeNull()
    }
  })
})

/* ------------------------------------------------------------------ */
/* Storage failure                                                     */
/* ------------------------------------------------------------------ */

describe('storage failure', () => {
  it('returns a controlled error and leaks nothing', async () => {
    const { db, breakMedia } = createFakeD1()
    const token = await seedToken(db, 'google-sub-a', 'a@example.com')
    breakMedia(new Error('D1_ERROR: no such table: exercise_media'))

    for (const options of [
      { token },
      { token, id: EXERCISE },
      { token, method: 'PUT', id: EXERCISE, origin: ORIGIN, body: GIF },
      { token, method: 'DELETE', id: EXERCISE, origin: ORIGIN },
    ]) {
      const { response, body } = await call(db, options)
      expect(response.status).toBe(500)
      expect(body).toEqual({ error: 'server_error' })
      const serialised = JSON.stringify(body)
      expect(serialised).not.toContain('no such table')
      expect(serialised).not.toContain('exercise_media')
      expect(serialised).not.toContain('google-sub-a')
    }
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

function maxAgeOf(setCookie: string | null): number | null {
  if (!setCookie) return null
  const match = /Max-Age=(\d+)/.exec(setCookie)
  return match ? Number(match[1]) : null
}

/** Seed a session and move the clock into the trusted refresh window. */
async function seedAtAge(db: D1Database, days: number) {
  vi.useFakeTimers()
  vi.setSystemTime(START)
  const seeded = await seedSession(db, 'google-sub-a', 'a@example.com', {
    createdAt: START,
  })
  vi.setSystemTime(START + days * DAY)
  return seeded
}

describe('trusted session rolling cookie', () => {
  it('issues no cookie outside the refresh window', async () => {
    const { db } = createFakeD1()
    const { token } = await seedAtAge(db, 10) // 20 days left

    const response = await handleExerciseMediaRequest(request({ token }), makeEnv(db))
    expect(response?.status).toBe(200)
    expect(response?.headers.get('Set-Cookie')).toBeNull()
  })

  it('re-issues the cookie on every route inside the window', async () => {
    for (const options of [
      {},
      { id: EXERCISE },
      { method: 'PUT', id: EXERCISE, origin: ORIGIN, body: GIF },
      { method: 'DELETE', id: EXERCISE, origin: ORIGIN },
    ]) {
      const { db } = createFakeD1()
      const { token } = await seedAtAge(db, 26) // 4 days left

      const response = await handleExerciseMediaRequest(
        request({ ...options, token }),
        makeEnv(db),
      )
      expect(response?.status).toBe(200)
      expect(maxAgeOf(response!.headers.get('Set-Cookie'))).toBe(TRUSTED_MAX_AGE)
    }
  })

  it('re-issues the cookie even when the request itself is rejected', async () => {
    const { db } = createFakeD1()
    const { token } = await seedAtAge(db, 26)

    const response = await handleExerciseMediaRequest(
      request({ token, method: 'PUT', id: EXERCISE, origin: ORIGIN, body: { ...GIF, url: 'javascript:alert(1)' } }),
      makeEnv(db),
    )

    expect(response?.status).toBe(400)
    expect(maxAgeOf(response!.headers.get('Set-Cookie'))).toBe(TRUSTED_MAX_AGE)
  })

  it('re-issues the cookie even when a cross-origin write is blocked', async () => {
    const { db } = createFakeD1()
    const { token } = await seedAtAge(db, 26)

    const response = await handleExerciseMediaRequest(
      request({ token, method: 'DELETE', id: EXERCISE, origin: 'https://evil.example.com' }),
      makeEnv(db),
    )

    expect(response?.status).toBe(403)
    expect(maxAgeOf(response!.headers.get('Set-Cookie'))).toBe(TRUSTED_MAX_AGE)
  })

  it('re-issues the cookie even when storage then fails', async () => {
    const { db, breakMedia } = createFakeD1()
    const { token } = await seedAtAge(db, 26)
    breakMedia()

    const response = await handleExerciseMediaRequest(request({ token }), makeEnv(db))
    expect(response?.status).toBe(500)
    expect(maxAgeOf(response!.headers.get('Set-Cookie'))).toBe(TRUSTED_MAX_AGE)
  })

  it('clears a cookie that can no longer authenticate', async () => {
    const { db } = createFakeD1()
    const { token } = await seedAtAge(db, 31) // past the 30 day expiry

    const response = await handleExerciseMediaRequest(request({ token }), makeEnv(db))
    const setCookie = response!.headers.get('Set-Cookie')

    expect(response?.status).toBe(401)
    expect(setCookie).toContain('vshape_session=;')
    expect(setCookie).toContain('Max-Age=0')
    expect(setCookie).toContain('HttpOnly')
  })

  it('sends no cookie header when there was no cookie to begin with', async () => {
    const { db } = createFakeD1()
    const response = await handleExerciseMediaRequest(request({}), makeEnv(db))
    expect(response?.status).toBe(401)
    expect(response?.headers.get('Set-Cookie')).toBeNull()
  })
})
