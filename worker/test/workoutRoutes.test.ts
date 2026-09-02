import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Env } from '../auth/config'
import { createD1SessionStore } from '../auth/d1Stores'
import { createSession, TRUSTED_SESSION_MS } from '../auth/session'
import { handleWorkoutRequest } from '../workouts/routes'
import { createFakeD1 } from './fakeD1'

/**
 * Round 08 — the workout logging API.
 *
 * The real handler, the real D1 mapping layer and the real rules all run
 * together against the in-memory D1 stand-in. No test touches a real network.
 */

const ORIGIN = 'https://vshapev2.nkmwei.de'
const BASE = `${ORIGIN}/api/workouts`
const DATE = '2026-08-31'
const SESSION = 'monday'

const START_BODY = {
  day: 'Monday',
  focus: 'Back Width + Biceps',
  intensity: 'HARD',
  exercises: [
    {
      exerciseId: 'lat-pulldown',
      name: 'Lat Pulldown',
      prescription: '4 × 10–15',
      equipment: 'BAND 20kg',
      resultKind: 'reps',
      loadMode: 'kg',
      perSide: false,
      setCount: 4,
    },
    {
      exerciseId: 'one-arm-db-row',
      name: 'One-Arm DB Row',
      prescription: '3 × 8–12',
      equipment: 'DB + Bench Flat',
      resultKind: 'reps',
      loadMode: 'kg_each',
      perSide: false,
      setCount: 3,
    },
  ],
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
  /** Path after /api/workouts, e.g. `2026-08-31/monday/start`. */
  path?: string
  body?: unknown
  rawBody?: string
}

function request({
  token,
  method = 'GET',
  origin,
  path = `${DATE}/${SESSION}`,
  body,
  rawBody,
}: ReqOptions): Request {
  const headers: Record<string, string> = {}
  if (token) headers.Cookie = `vshape_session=${token}`
  if (origin) headers.Origin = origin
  const payload = rawBody ?? (body === undefined ? undefined : JSON.stringify(body))
  if (payload !== undefined) headers['Content-Type'] = 'application/json'
  return new Request(`${BASE}/${path}`, { method, headers, body: payload })
}

async function call(db: D1Database, options: ReqOptions) {
  const response = await handleWorkoutRequest(request(options), makeEnv(db))
  if (!response) throw new Error('handler did not claim the request')
  return { response, body: (await response.json()) as Record<string, never> }
}

/** Start the workout the ordinary way, so tests share the real write path. */
async function start(db: D1Database, token: string, body: unknown = START_BODY) {
  return call(db, {
    token,
    method: 'POST',
    origin: ORIGIN,
    path: `${DATE}/${SESSION}/start`,
    body,
  })
}

function setPath(exerciseOrder: number, setIndex: number, date = DATE, session = SESSION) {
  return `${date}/${session}/sets/${exerciseOrder}/${setIndex}`
}

/* ------------------------------------------------------------------ */
/* Routing                                                             */
/* ------------------------------------------------------------------ */

describe('routing', () => {
  it('ignores requests that are not workout requests', async () => {
    const { db } = createFakeD1()
    const response = await handleWorkoutRequest(
      new Request(`${ORIGIN}/api/today/completions`),
      makeEnv(db),
    )
    expect(response).toBeNull()
  })

  it('rejects an unknown nested route', async () => {
    const { db } = createFakeD1()
    const { response, body } = await call(db, { path: `${DATE}/${SESSION}/history` })
    expect(response.status).toBe(404)
    expect(body.error).toBe('not_found')
  })

  it('rejects a deeper unknown route', async () => {
    const { db } = createFakeD1()
    const { response } = await call(db, {
      path: `${DATE}/${SESSION}/sets/0/0/extra`,
    })
    expect(response.status).toBe(404)
  })

  it('rejects the wrong method on the occurrence route', async () => {
    const { db } = createFakeD1()
    const { response, body } = await call(db, { method: 'DELETE' })
    expect(response.status).toBe(405)
    expect(body.error).toBe('method_not_allowed')
  })

  it('rejects the wrong method on start', async () => {
    const { db } = createFakeD1()
    const { response } = await call(db, { method: 'GET', path: `${DATE}/${SESSION}/start` })
    expect(response.status).toBe(405)
  })

  it('rejects the wrong method on a set', async () => {
    const { db } = createFakeD1()
    const { response } = await call(db, { method: 'POST', path: setPath(0, 0) })
    expect(response.status).toBe(405)
  })
})

/* ------------------------------------------------------------------ */
/* Authentication                                                      */
/* ------------------------------------------------------------------ */

describe('authentication', () => {
  it('rejects an unauthenticated read', async () => {
    const { db } = createFakeD1()
    const { response, body } = await call(db, {})
    expect(response.status).toBe(401)
    expect(body.error).toBe('unauthenticated')
  })

  it('rejects an unauthenticated start', async () => {
    const { db } = createFakeD1()
    const { response } = await call(db, {
      method: 'POST',
      origin: ORIGIN,
      path: `${DATE}/${SESSION}/start`,
      body: START_BODY,
    })
    expect(response.status).toBe(401)
  })

  it('rejects an unauthenticated set write', async () => {
    const { db } = createFakeD1()
    const { response } = await call(db, {
      method: 'PUT',
      origin: ORIGIN,
      path: setPath(0, 0),
      body: { action: 'skip' },
    })
    expect(response.status).toBe(401)
  })

  it('rejects an unauthenticated undo', async () => {
    const { db } = createFakeD1()
    const { response } = await call(db, {
      method: 'DELETE',
      origin: ORIGIN,
      path: setPath(0, 0),
    })
    expect(response.status).toBe(401)
  })

  it('marks every response no-store', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'google-sub-a', 'a@example.com')
    await start(db, token)

    for (const options of [
      { token },
      { token, method: 'POST', origin: ORIGIN, path: `${DATE}/${SESSION}/start`, body: START_BODY },
      {
        token,
        method: 'PUT',
        origin: ORIGIN,
        path: setPath(0, 0),
        body: { action: 'skip' },
      },
      { token, method: 'DELETE', origin: ORIGIN, path: setPath(0, 0) },
    ]) {
      const { response } = await call(db, options)
      expect(response.headers.get('Cache-Control')).toBe('no-store')
    }
  })
})

/* ------------------------------------------------------------------ */
/* Same-origin                                                         */
/* ------------------------------------------------------------------ */

describe('same-origin guard', () => {
  it('allows a same-origin start', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'google-sub-a', 'a@example.com')
    const { response } = await start(db, token)
    expect(response.status).toBe(201)
  })

  it('blocks a cross-origin start', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'google-sub-a', 'a@example.com')
    const { response, body } = await call(db, {
      token,
      method: 'POST',
      origin: 'https://evil.example.com',
      path: `${DATE}/${SESSION}/start`,
      body: START_BODY,
    })
    expect(response.status).toBe(403)
    expect(body.error).toBe('forbidden')
  })

  it('blocks a cross-origin set write', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'google-sub-a', 'a@example.com')
    await start(db, token)

    const { response } = await call(db, {
      token,
      method: 'PUT',
      origin: 'https://evil.example.com',
      path: setPath(0, 0),
      body: { action: 'complete', result: 12, load: null },
    })
    expect(response.status).toBe(403)
  })

  it('blocks a cross-origin undo', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'google-sub-a', 'a@example.com')
    await start(db, token)

    const { response } = await call(db, {
      token,
      method: 'DELETE',
      origin: 'https://evil.example.com',
      path: setPath(0, 0),
    })
    expect(response.status).toBe(403)
  })

  it('leaves a cross-origin blocked workout unchanged', async () => {
    const { db, workoutSets } = createFakeD1()
    const token = await seedToken(db, 'google-sub-a', 'a@example.com')
    await start(db, token)

    await call(db, {
      token,
      method: 'PUT',
      origin: 'https://evil.example.com',
      path: setPath(0, 0),
      body: { action: 'complete', result: 12, load: null },
    })

    expect([...workoutSets.values()].every((row) => row.status === 'pending')).toBe(true)
  })

  it('allows a read with no Origin header', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'google-sub-a', 'a@example.com')
    const { response } = await call(db, { token })
    expect(response.status).toBe(200)
  })
})

/* ------------------------------------------------------------------ */
/* Read / start                                                        */
/* ------------------------------------------------------------------ */

describe('reading and starting', () => {
  it('reports a not-started workout as an honest null', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'google-sub-a', 'a@example.com')

    const { response, body } = await call(db, { token })
    expect(response.status).toBe(200)
    expect(body.occurrence).toBeNull()
    expect(body.sets).toEqual([])
    expect(body.progress).toBeNull()
  })

  it('creates the workout and returns 201 with every expected set', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'google-sub-a', 'a@example.com')

    const { response, body } = await start(db, token)
    expect(response.status).toBe(201)
    expect(body.created).toBe(true)
    expect(body.sets).toHaveLength(7)
    expect(body.progress).toEqual({ total: 7, completed: 0, skipped: 0, resolved: 0 })
  })

  it('resumes with 200 and does not duplicate the workout', async () => {
    const { db, occurrences, workoutSets } = createFakeD1()
    const token = await seedToken(db, 'google-sub-a', 'a@example.com')

    await start(db, token)
    const { response, body } = await start(db, token)

    expect(response.status).toBe(200)
    expect(body.created).toBe(false)
    expect(occurrences.size).toBe(1)
    expect(workoutSets.size).toBe(7)
  })

  it('never echoes the account identity', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'google-sub-a', 'a@example.com')
    const { body } = await start(db, token)
    expect(JSON.stringify(body)).not.toContain('google-sub-a')
    expect(JSON.stringify(body)).not.toContain('googleSub')
  })

  it('ignores a client-supplied account identity', async () => {
    const { db, occurrences } = createFakeD1()
    const token = await seedToken(db, 'google-sub-a', 'a@example.com')

    await start(db, token, {
      ...START_BODY,
      googleSub: 'google-sub-b',
      google_sub: 'google-sub-b',
    })

    // The row is filed under the session's account, not the body's.
    expect([...occurrences.values()][0].google_sub).toBe('google-sub-a')
  })

  it('keeps the first snapshot when a changed payload starts again', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'google-sub-a', 'a@example.com')

    await start(db, token)
    const { body } = await start(db, token, {
      day: 'Monday',
      focus: 'Rebuilt Back Focus',
      intensity: 'PUMP',
      exercises: [
        {
          exerciseId: 'lat-pulldown',
          name: 'Lat Pulldown (Wide)',
          prescription: '6 × 5–8',
          equipment: 'BAND 40kg',
          resultKind: 'reps',
          loadMode: 'kg_each',
          perSide: true,
          setCount: 6,
        },
      ],
    })

    const occurrence = body.occurrence as unknown as Record<string, unknown>
    const sets = body.sets as unknown as Record<string, unknown>[]
    expect(occurrence.focus).toBe('Back Width + Biceps')
    expect(sets).toHaveLength(7)
    expect(sets[0].prescription).toBe('4 × 10–15')
  })
})

/* ------------------------------------------------------------------ */
/* Account isolation                                                   */
/* ------------------------------------------------------------------ */

describe('account isolation', () => {
  it('does not expose another account’s workout on the same date and session', async () => {
    const { db } = createFakeD1()
    const tokenA = await seedToken(db, 'google-sub-a', 'a@example.com')
    const tokenB = await seedToken(db, 'google-sub-b', 'b@example.com')

    await start(db, tokenA)
    await call(db, {
      token: tokenA,
      method: 'PUT',
      origin: ORIGIN,
      path: setPath(0, 0),
      body: { action: 'complete', result: 12, load: { value: 20, unit: 'kg' } },
    })

    const { body } = await call(db, { token: tokenB })
    expect(body.occurrence).toBeNull()
    expect(body.sets).toEqual([])
  })

  it('does not let one account mutate another’s set', async () => {
    const { db } = createFakeD1()
    const tokenA = await seedToken(db, 'google-sub-a', 'a@example.com')
    const tokenB = await seedToken(db, 'google-sub-b', 'b@example.com')

    await start(db, tokenA)
    const { response } = await call(db, {
      token: tokenB,
      method: 'PUT',
      origin: ORIGIN,
      path: setPath(0, 0),
      body: { action: 'complete', result: 99, load: null },
    })

    expect(response.status).toBe(404)
    const { body } = await call(db, { token: tokenA })
    const sets = body.sets as unknown as Record<string, unknown>[]
    expect(sets[0].status).toBe('pending')
  })
})

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

describe('validation', () => {
  async function authed() {
    const fake = createFakeD1()
    const token = await seedToken(fake.db, 'google-sub-a', 'a@example.com')
    return { ...fake, token }
  }

  it('rejects a malformed date', async () => {
    const { db, token } = await authed()
    for (const date of ['2026-8-31', '31-08-2026', 'today', '2026-02-30', '']) {
      const { response, body } = await call(db, { token, path: `${date}/${SESSION}` })
      expect(response.status).toBe(400)
      expect(body.error).toBe('invalid_workout_date')
    }
  })

  it('rejects a malformed session slug', async () => {
    const { db, token } = await authed()
    for (const session of ['Monday', 'mon day', '../monday', 'monday!', '']) {
      const { response, body } = await call(db, {
        token,
        path: `${DATE}/${encodeURIComponent(session)}`,
      })
      expect(response.status).toBe(400)
      expect(body.error).toBe('invalid_session_id')
    }
  })

  it('rejects a negative or non-integer exercise order', async () => {
    const { db, token } = await authed()
    await start(db, token)
    for (const order of ['-1', '1.5', 'NaN', 'Infinity', '99', 'first']) {
      const { response, body } = await call(db, {
        token,
        method: 'DELETE',
        origin: ORIGIN,
        path: `${DATE}/${SESSION}/sets/${order}/0`,
      })
      expect(response.status).toBe(400)
      expect(body.error).toBe('invalid_exercise_order')
    }
  })

  it('rejects a negative or out-of-range set index', async () => {
    const { db, token } = await authed()
    await start(db, token)
    for (const index of ['-1', '2.5', 'NaN', '9999', 'last']) {
      const { response, body } = await call(db, {
        token,
        method: 'DELETE',
        origin: ORIGIN,
        path: `${DATE}/${SESSION}/sets/0/${index}`,
      })
      expect(response.status).toBe(400)
      expect(body.error).toBe('invalid_set_index')
    }
  })

  it('rejects malformed JSON on start', async () => {
    const { db, token } = await authed()
    const { response, body } = await call(db, {
      token,
      method: 'POST',
      origin: ORIGIN,
      path: `${DATE}/${SESSION}/start`,
      rawBody: '{ not json',
    })
    expect(response.status).toBe(400)
    expect(body.error).toBe('invalid_json')
  })

  it('rejects malformed JSON on a set write', async () => {
    const { db, token } = await authed()
    await start(db, token)
    const { response, body } = await call(db, {
      token,
      method: 'PUT',
      origin: ORIGIN,
      path: setPath(0, 0),
      rawBody: '<<<',
    })
    expect(response.status).toBe(400)
    expect(body.error).toBe('invalid_json')
  })

  it('rejects a start payload that is not an object', async () => {
    const { db, token } = await authed()
    for (const payload of [[], 'monday', 42, null]) {
      const { response, body } = await call(db, {
        token,
        method: 'POST',
        origin: ORIGIN,
        path: `${DATE}/${SESSION}/start`,
        body: payload,
      })
      expect(response.status).toBe(400)
      expect(body.error).toBe('invalid_start')
    }
  })

  it('rejects a start payload with no exercises', async () => {
    const { db, token } = await authed()
    const { response, body } = await call(db, {
      token,
      method: 'POST',
      origin: ORIGIN,
      path: `${DATE}/${SESSION}/start`,
      body: { ...START_BODY, exercises: [] },
    })
    expect(response.status).toBe(400)
    expect(body.field).toBe('exercises')
  })

  it('refuses to create thousands of sets from one payload', async () => {
    const { db, token, workoutSets } = await authed()

    const huge = {
      ...START_BODY,
      exercises: Array.from({ length: 40 }, () => START_BODY.exercises[0]),
    }
    const { response, body } = await call(db, {
      token,
      method: 'POST',
      origin: ORIGIN,
      path: `${DATE}/${SESSION}/start`,
      body: huge,
    })

    expect(response.status).toBe(400)
    expect(body.field).toBe('exercises')
    expect(workoutSets.size).toBe(0)
  })

  it('rejects an absurd set count', async () => {
    const { db, token, workoutSets } = await authed()
    const { response, body } = await call(db, {
      token,
      method: 'POST',
      origin: ORIGIN,
      path: `${DATE}/${SESSION}/start`,
      body: {
        ...START_BODY,
        exercises: [{ ...START_BODY.exercises[0], setCount: 100_000 }],
      },
    })
    expect(response.status).toBe(400)
    expect(body.field).toBe('setCount')
    expect(workoutSets.size).toBe(0)
  })

  it('rejects an oversized snapshot string', async () => {
    const { db, token } = await authed()
    const { response, body } = await call(db, {
      token,
      method: 'POST',
      origin: ORIGIN,
      path: `${DATE}/${SESSION}/start`,
      body: { ...START_BODY, focus: 'x'.repeat(500) },
    })
    expect(response.status).toBe(400)
    expect(body.field).toBe('focus')
  })

  it('rejects an unknown result kind or load mode', async () => {
    const { db, token } = await authed()
    for (const patch of [{ resultKind: 'metres' }, { loadMode: 'stones' }]) {
      const { response, body } = await call(db, {
        token,
        method: 'POST',
        origin: ORIGIN,
        path: `${DATE}/${SESSION}/start`,
        body: { ...START_BODY, exercises: [{ ...START_BODY.exercises[0], ...patch }] },
      })
      expect(response.status).toBe(400)
      expect(body.field).toBe('exercise')
    }
  })

  it('rejects an invalid set action', async () => {
    const { db, token } = await authed()
    await start(db, token)
    for (const body of [{ action: 'maybe' }, {}, { action: 'complete' }]) {
      const result = await call(db, {
        token,
        method: 'PUT',
        origin: ORIGIN,
        path: setPath(0, 0),
        body,
      })
      expect(result.response.status).toBe(400)
      expect(result.body.error).toBe('invalid_set')
    }
  })

  it('rejects a non-finite, negative or zero result', async () => {
    const { db, token } = await authed()
    await start(db, token)
    for (const result of [0, -5, 1.5, 99_999, 'twelve', null]) {
      const response = await call(db, {
        token,
        method: 'PUT',
        origin: ORIGIN,
        path: setPath(0, 0),
        body: { action: 'complete', result, load: null },
      })
      expect(response.response.status).toBe(400)
      expect(response.body.field).toBe('result')
    }
  })

  it('rejects an invalid load value', async () => {
    const { db, token } = await authed()
    await start(db, token)
    for (const value of [-1, 99_999, 'heavy', null]) {
      const response = await call(db, {
        token,
        method: 'PUT',
        origin: ORIGIN,
        path: setPath(0, 0),
        body: { action: 'complete', result: 12, load: { value, unit: 'kg' } },
      })
      expect(response.response.status).toBe(400)
      expect(response.body.field).toBe('load')
    }
  })

  it('rejects an unaccepted load unit', async () => {
    const { db, token } = await authed()
    await start(db, token)
    const { response, body } = await call(db, {
      token,
      method: 'PUT',
      origin: ORIGIN,
      path: setPath(0, 0),
      body: { action: 'complete', result: 12, load: { value: 20, unit: 'lbs' } },
    })
    expect(response.status).toBe(400)
    expect(body.field).toBe('unit')
  })

  it('rejects a load whose unit contradicts the stored snapshot', async () => {
    const { db, token } = await authed()
    await start(db, token)
    const { response, body } = await call(db, {
      token,
      method: 'PUT',
      origin: ORIGIN,
      path: setPath(0, 0),
      body: { action: 'complete', result: 12, load: { value: 20, unit: 'kg_each' } },
    })
    expect(response.status).toBe(400)
    expect(body.error).toBe('load_unit_mismatch')
  })

  it('reports an unknown set as 404 rather than creating it', async () => {
    const { db, token, workoutSets } = await authed()
    await start(db, token)

    const { response, body } = await call(db, {
      token,
      method: 'PUT',
      origin: ORIGIN,
      path: setPath(0, 9),
      body: { action: 'complete', result: 12, load: null },
    })

    expect(response.status).toBe(404)
    expect(body.error).toBe('set_not_found')
    expect(workoutSets.size).toBe(7)
  })
})

/* ------------------------------------------------------------------ */
/* Logging through the API                                             */
/* ------------------------------------------------------------------ */

describe('logging through the API', () => {
  async function started() {
    const fake = createFakeD1()
    const token = await seedToken(fake.db, 'google-sub-a', 'a@example.com')
    await start(fake.db, token)
    return { ...fake, token }
  }

  it('completes a set and returns exactly what was stored', async () => {
    const { db, token } = await started()
    const { response, body } = await call(db, {
      token,
      method: 'PUT',
      origin: ORIGIN,
      path: setPath(1, 0),
      body: { action: 'complete', result: 10, load: { value: 12.5, unit: 'kg_each' } },
    })

    expect(response.status).toBe(200)
    const set = body.set as unknown as Record<string, unknown>
    expect(set.status).toBe('completed')
    expect(set.result).toBe(10)
    expect(set.load).toEqual({ value: 12.5, unit: 'kg_each' })
  })

  it('skips a set without recording a result', async () => {
    const { db, token } = await started()
    const { body } = await call(db, {
      token,
      method: 'PUT',
      origin: ORIGIN,
      path: setPath(0, 1),
      body: { action: 'skip' },
    })

    const set = body.set as unknown as Record<string, unknown>
    expect(set.status).toBe('skipped')
    expect(set.result).toBeNull()
    expect(set.load).toBeNull()
  })

  it('undoes a set back to pending', async () => {
    const { db, token } = await started()
    await call(db, {
      token,
      method: 'PUT',
      origin: ORIGIN,
      path: setPath(0, 0),
      body: { action: 'complete', result: 12, load: { value: 20, unit: 'kg' } },
    })

    const { response, body } = await call(db, {
      token,
      method: 'DELETE',
      origin: ORIGIN,
      path: setPath(0, 0),
    })

    expect(response.status).toBe(200)
    const set = body.set as unknown as Record<string, unknown>
    expect(set.status).toBe('pending')
    expect(set.result).toBeNull()
    expect(set.load).toBeNull()
  })

  it('reports progress with skips counted separately from completions', async () => {
    const { db, token } = await started()
    await call(db, {
      token,
      method: 'PUT',
      origin: ORIGIN,
      path: setPath(0, 0),
      body: { action: 'complete', result: 12, load: null },
    })
    await call(db, {
      token,
      method: 'PUT',
      origin: ORIGIN,
      path: setPath(0, 1),
      body: { action: 'skip' },
    })

    const { body } = await call(db, { token })
    expect(body.progress).toEqual({ total: 7, completed: 1, skipped: 1, resolved: 2 })
  })

  it('survives a re-read, which is what a refresh does', async () => {
    const { db, token } = await started()
    await call(db, {
      token,
      method: 'PUT',
      origin: ORIGIN,
      path: setPath(0, 0),
      body: { action: 'complete', result: 12, load: { value: 20, unit: 'kg' } },
    })

    const { body } = await call(db, { token })
    const sets = body.sets as unknown as Record<string, unknown>[]
    expect(sets[0].status).toBe('completed')
    expect(sets[0].result).toBe(12)
    expect(sets[0].load).toEqual({ value: 20, unit: 'kg' })
    expect(sets[1].status).toBe('pending')
  })
})

/* ------------------------------------------------------------------ */
/* Storage failure                                                     */
/* ------------------------------------------------------------------ */

describe('storage failure', () => {
  it('reports a controlled 500 without leaking anything internal', async () => {
    const { db, breakWorkouts } = createFakeD1()
    const token = await seedToken(db, 'google-sub-a', 'a@example.com')
    breakWorkouts(new Error('D1 exploded: SELECT * FROM workout_sets'))
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { response, body } = await call(db, { token })

    expect(response.status).toBe(500)
    expect(body.error).toBe('server_error')
    expect(JSON.stringify(body)).not.toContain('SELECT')
    errors.mockRestore()
  })
})

/* ------------------------------------------------------------------ */
/* Rolling trusted sessions                                            */
/* ------------------------------------------------------------------ */

const DAY = 24 * 60 * 60 * 1000
const START_AT = Date.UTC(2026, 8, 1)
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
  vi.setSystemTime(START_AT)
  const seeded = await seedSession(db, 'google-sub-a', 'a@example.com', {
    createdAt: START_AT,
  })
  vi.setSystemTime(START_AT + days * DAY)
  return seeded
}

describe('trusted session rolling cookie', () => {
  it('issues no cookie outside the refresh window', async () => {
    const { db } = createFakeD1()
    const { token } = await seedAtAge(db, 10)

    const response = await handleWorkoutRequest(request({ token }), makeEnv(db))
    expect(response?.status).toBe(200)
    expect(response?.headers.get('Set-Cookie')).toBeNull()
  })

  it('re-issues the cookie on every route inside the window', async () => {
    for (const options of [
      {},
      { method: 'POST', origin: ORIGIN, path: `${DATE}/${SESSION}/start`, body: START_BODY },
      { method: 'PUT', origin: ORIGIN, path: setPath(0, 0), body: { action: 'skip' } },
      { method: 'DELETE', origin: ORIGIN, path: setPath(0, 0) },
    ]) {
      const { db } = createFakeD1()
      vi.useFakeTimers()
      vi.setSystemTime(START_AT)
      const { token } = await seedSession(db, 'google-sub-a', 'a@example.com', {
        createdAt: START_AT,
      })
      // Seed the workout while the session is still fresh. Doing it inside the
      // refresh window would consume the one roll-forward the window allows,
      // and the assertion below would then be testing the wrong request.
      await handleWorkoutRequest(
        request({
          token,
          method: 'POST',
          origin: ORIGIN,
          path: `${DATE}/${SESSION}/start`,
          body: START_BODY,
        }),
        makeEnv(db),
      )
      vi.setSystemTime(START_AT + 26 * DAY)

      const response = await handleWorkoutRequest(
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

    const response = await handleWorkoutRequest(
      request({ token, path: `not-a-date/${SESSION}` }),
      makeEnv(db),
    )

    expect(response?.status).toBe(400)
    expect(maxAgeOf(response!.headers.get('Set-Cookie'))).toBe(TRUSTED_MAX_AGE)
  })

  it('re-issues the cookie even when a cross-origin write is blocked', async () => {
    const { db } = createFakeD1()
    const { token } = await seedAtAge(db, 26)

    const response = await handleWorkoutRequest(
      request({
        token,
        method: 'POST',
        origin: 'https://evil.example.com',
        path: `${DATE}/${SESSION}/start`,
        body: START_BODY,
      }),
      makeEnv(db),
    )

    expect(response?.status).toBe(403)
    expect(maxAgeOf(response!.headers.get('Set-Cookie'))).toBe(TRUSTED_MAX_AGE)
  })

  it('clears a dead cookie on an unauthenticated request', async () => {
    const { db } = createFakeD1()
    const response = await handleWorkoutRequest(
      request({ token: 'not-a-real-token' }),
      makeEnv(db),
    )

    expect(response?.status).toBe(401)
    const setCookie = response!.headers.get('Set-Cookie')
    expect(setCookie).toContain('vshape_session=')
    expect(maxAgeOf(setCookie)).toBe(0)
  })
})

/* ------------------------------------------------------------------ */
/* Round 20 Correction 1 — the API refuses an unreadable setting       */
/* ------------------------------------------------------------------ */

/**
 * The DIRECT API proof for Blocker 2, with no UI and no test double standing in
 * for the decision.
 *
 * The corrupt value is written into the `exercise_input_types` row itself, and
 * the PRODUCTION reader — `createD1ExerciseInputTypeStore.list` → `toRecord` →
 * `resolveInputTypes` → `buildSnapshot` — is what decides it cannot be read.
 * The fake supplies storage, not the verdict.
 */
describe('Round 20 — a stored input type that cannot be read', () => {
  /** Write a setting straight into storage, so any value can be tried. */
  function seedInputType(fake: ReturnType<typeof createFakeD1>, googleSub: string, value: string) {
    fake.inputTypes.set([googleSub, 'lat-pulldown'].join('\u0000'), {
      google_sub: googleSub,
      exercise_id: 'lat-pulldown',
      input_type: value,
      created_at: 1,
      updated_at: 1,
    })
  }

  it('refuses the Start, writing no occurrence and no sets', async () => {
    const fake = createFakeD1()
    const token = await seedToken(fake.db, 'google-sub-a', 'a@example.com')
    seedInputType(fake, 'google-sub-a', 'elastic_vibes')

    const { response, body } = await start(fake.db, token)

    expect(response.status).toBe(500)
    expect(body).toEqual({ error: 'input_type_unreadable' })
    expect(fake.occurrences.size).toBe(0)
    expect(fake.workoutSets.size).toBe(0)
  })

  it('leaves the workout genuinely unstarted, so a later read says so', async () => {
    const fake = createFakeD1()
    const token = await seedToken(fake.db, 'google-sub-a', 'a@example.com')
    seedInputType(fake, 'google-sub-a', 'elastic_vibes')
    await start(fake.db, token)

    const { response, body } = await call(fake.db, { token })
    expect(response.status).toBe(200)
    expect(body.occurrence).toBeNull()
  })

  it('starts normally once the stored value is one this build understands', async () => {
    // NON-VACUITY. Identical request, identical account, identical row —
    // only the stored VALUE differs, and the production reader decides.
    const fake = createFakeD1()
    const token = await seedToken(fake.db, 'google-sub-a', 'a@example.com')
    seedInputType(fake, 'google-sub-a', 'resistance_band')

    const { response } = await start(fake.db, token)
    expect(response.status).toBe(201)
    expect(fake.occurrences.size).toBe(1)
    expect(fake.workoutSets.size).toBe(7)

    // And it froze what the row actually said, forcing the load mode to agree.
    const latPulldown = [...fake.workoutSets.values()].filter(
      (row) => row.exercise_id_snapshot === 'lat-pulldown',
    )
    expect(latPulldown).toHaveLength(4)
    expect(latPulldown.every((row) => row.input_type_snapshot === 'resistance_band')).toBe(true)
    expect(latPulldown.every((row) => row.load_mode_snapshot === 'none')).toBe(true)
  })

  it('starts normally when no setting exists at all', async () => {
    // The other NON-VACUITY control: absence is not unreadability.
    const fake = createFakeD1()
    const token = await seedToken(fake.db, 'google-sub-a', 'a@example.com')

    const { response } = await start(fake.db, token)
    expect(response.status).toBe(201)
    expect(fake.workoutSets.size).toBe(7)
  })

  it('refuses only the account whose setting is corrupt', async () => {
    const fake = createFakeD1()
    const corrupt = await seedToken(fake.db, 'google-sub-a', 'a@example.com')
    const fine = await seedToken(fake.db, 'google-sub-b', 'b@example.com')
    seedInputType(fake, 'google-sub-a', 'elastic_vibes')

    expect((await start(fake.db, corrupt)).response.status).toBe(500)
    expect((await start(fake.db, fine)).response.status).toBe(201)

    // Exactly one account's workout exists, and it is the other one's.
    expect(fake.occurrences.size).toBe(1)
    expect([...fake.occurrences.values()][0].google_sub).toBe('google-sub-b')
  })
})
