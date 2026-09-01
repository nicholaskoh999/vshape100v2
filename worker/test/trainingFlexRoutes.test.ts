import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Env } from '../auth/config'
import { createD1SessionStore } from '../auth/d1Stores'
import { createSession } from '../auth/session'
import { handleTrainingFlexRequest } from '../trainingFlex/routes'
import { handleWorkoutRequest } from '../workouts/routes'
import { createFakeD1 } from './fakeD1'

/**
 * Round 19.2 — the Today Training Flex API.
 *
 * The real handler, the real D1 mapping layer and the real rules run together
 * against the in-memory D1 stand-in. No test touches a network.
 *
 * Three claims matter most, and the third is the product promise: an account
 * cannot reach another account's choice; a day that is not plausibly today
 * cannot be written at all; and choosing Recovery writes NOTHING into the
 * tables that hold training evidence.
 */

const ORIGIN = 'https://vshapev2.nkmwei.de'
/** A Tuesday. The clock below is pinned to it so "today" is deterministic. */
const TODAY = '2026-09-08'
const NOW = Date.UTC(2026, 8, 8, 12, 0, 0)

const MONDAY_BODY = {
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
      setCount: 2,
    },
  ],
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(NOW))
})

afterEach(() => {
  vi.useRealTimers()
})

function makeEnv(db: D1Database): Env {
  return { DB: db, ASSETS: {} as Fetcher, APP_ORIGIN: ORIGIN }
}

async function seedToken(db: D1Database, googleSub: string, email: string) {
  const { token } = await createSession(createD1SessionStore(db), {
    googleSub,
    email,
    trusted: true,
  })
  return token
}

async function flex(
  db: D1Database,
  options: {
    token?: string
    method?: string
    origin?: string
    body?: unknown
    rawBody?: string
    query?: string
  } = {},
) {
  const headers: Record<string, string> = {}
  if (options.token) headers.Cookie = `vshape_session=${options.token}`
  if (options.origin) headers.Origin = options.origin
  const payload = options.rawBody ?? (options.body === undefined ? undefined : JSON.stringify(options.body))
  if (payload !== undefined) headers['Content-Type'] = 'application/json'

  const query = options.query ?? `?from=${TODAY}&to=${TODAY}`
  const response = await handleTrainingFlexRequest(
    new Request(`${ORIGIN}/api/training-flex${options.method === 'PUT' ? '' : query}`, {
      method: options.method ?? 'GET',
      headers,
      body: payload,
    }),
    makeEnv(db),
  )
  if (!response) throw new Error('handler did not claim the request')
  return { response, body: (await response.json()) as Record<string, never> }
}

/* ------------------------------------------------------------------ */
/* Routing and method                                                  */
/* ------------------------------------------------------------------ */

describe('routing', () => {
  it('ignores requests that are not training-flex requests', async () => {
    const { db } = createFakeD1()
    expect(
      await handleTrainingFlexRequest(new Request(`${ORIGIN}/api/settings`), makeEnv(db)),
    ).toBeNull()
    // Exact match only: a future sub-path is not silently answered as this one.
    expect(
      await handleTrainingFlexRequest(
        new Request(`${ORIGIN}/api/training-flex/anything`),
        makeEnv(db),
      ),
    ).toBeNull()
  })

  it('refuses an unsupported method', async () => {
    const { db } = createFakeD1()
    expect((await flex(db, { method: 'DELETE' })).response.status).toBe(405)
  })
})

/* ------------------------------------------------------------------ */
/* Auth, account isolation, same-origin                                */
/* ------------------------------------------------------------------ */

describe('auth and account isolation', () => {
  it('refuses an unauthenticated read and write', async () => {
    const { db } = createFakeD1()
    expect((await flex(db, {})).response.status).toBe(401)
    expect(
      (await flex(db, { method: 'PUT', origin: ORIGIN, body: { date: TODAY, kind: 'recovery' } }))
        .response.status,
    ).toBe(401)
  })

  it('refuses a cross-origin write', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'sub-1', 'a@example.com')

    const { response } = await flex(db, {
      method: 'PUT',
      token,
      origin: 'https://evil.example',
      body: { date: TODAY, kind: 'recovery' },
    })
    expect(response.status).toBe(403)
    expect((await flex(db, { token })).body.choices).toEqual([])
  })

  it('never lets one account read or write another account’s choice', async () => {
    const { db } = createFakeD1()
    const alice = await seedToken(db, 'sub-alice', 'alice@example.com')
    const bob = await seedToken(db, 'sub-bob', 'bob@example.com')

    await flex(db, {
      method: 'PUT',
      token: alice,
      origin: ORIGIN,
      body: { date: TODAY, kind: 'recovery' },
    })

    expect((await flex(db, { token: bob })).body.choices).toEqual([])
    expect((await flex(db, { token: alice })).body.choices).toEqual([
      { date: TODAY, kind: 'recovery' },
    ])
  })

  it('ignores an identity supplied in the body', async () => {
    const { db } = createFakeD1()
    const alice = await seedToken(db, 'sub-alice', 'alice@example.com')
    const bob = await seedToken(db, 'sub-bob', 'bob@example.com')

    await flex(db, {
      method: 'PUT',
      token: alice,
      origin: ORIGIN,
      body: { date: TODAY, kind: 'recovery', googleSub: 'sub-bob' },
    })

    expect((await flex(db, { token: bob })).body.choices).toEqual([])
  })
})

/* ------------------------------------------------------------------ */
/* Today only                                                          */
/* ------------------------------------------------------------------ */

describe('today only', () => {
  it.each([
    ['2026-09-01', 'a week ago'],
    ['2026-08-08', 'a month ago'],
    ['2026-09-20', 'later this month'],
    ['2027-09-08', 'next year'],
  ])('refuses %s (%s) and writes nothing', async (date) => {
    const fake = createFakeD1()
    const token = await seedToken(fake.db, 'sub-1', 'a@example.com')

    const { response, body } = await flex(fake.db, {
      method: 'PUT',
      token,
      origin: ORIGIN,
      body: { date, kind: 'recovery' },
    })
    expect(response.status).toBe(400)
    expect(body.field).toBe('date')
    expect(fake.trainingFlex.size).toBe(0)
  })

  it('accepts the neighbouring dates, so no timezone is locked out', async () => {
    for (const date of ['2026-09-07', '2026-09-08', '2026-09-09']) {
      const fake = createFakeD1()
      const token = await seedToken(fake.db, 'sub-1', 'a@example.com')
      const { response } = await flex(fake.db, {
        method: 'PUT',
        token,
        origin: ORIGIN,
        body: { date, kind: 'recovery' },
      })
      expect(response.status, date).toBe(200)
    }
  })
})

/* ------------------------------------------------------------------ */
/* Storing, replacing, clearing                                        */
/* ------------------------------------------------------------------ */

describe('persistence', () => {
  it('stores a choice and reads it back', async () => {
    const fake = createFakeD1()
    const token = await seedToken(fake.db, 'sub-1', 'a@example.com')

    const saved = await flex(fake.db, {
      method: 'PUT',
      token,
      origin: ORIGIN,
      body: { date: TODAY, kind: 'fitness_boxing_2' },
    })
    expect(saved.response.status).toBe(200)
    expect(saved.body.choice).toEqual({ date: TODAY, kind: 'fitness_boxing_2' })

    expect((await flex(fake.db, { token })).body.choices).toEqual([
      { date: TODAY, kind: 'fitness_boxing_2' },
    ])
  })

  it('replaces rather than accumulating', async () => {
    const fake = createFakeD1()
    const token = await seedToken(fake.db, 'sub-1', 'a@example.com')

    await flex(fake.db, { method: 'PUT', token, origin: ORIGIN, body: { date: TODAY, kind: 'recovery' } })
    await flex(fake.db, {
      method: 'PUT',
      token,
      origin: ORIGIN,
      body: { date: TODAY, kind: 'fitness_boxing_2' },
    })

    expect(fake.trainingFlex.size).toBe(1)
    expect((await flex(fake.db, { token })).body.choices).toEqual([
      { date: TODAY, kind: 'fitness_boxing_2' },
    ])
  })

  it('clears the day on an explicit null', async () => {
    const fake = createFakeD1()
    const token = await seedToken(fake.db, 'sub-1', 'a@example.com')

    await flex(fake.db, { method: 'PUT', token, origin: ORIGIN, body: { date: TODAY, kind: 'recovery' } })
    const cleared = await flex(fake.db, {
      method: 'PUT',
      token,
      origin: ORIGIN,
      body: { date: TODAY, kind: null },
    })

    expect(cleared.body.choice).toBeNull()
    expect(fake.trainingFlex.size).toBe(0)
    expect((await flex(fake.db, { token })).body.choices).toEqual([])
  })
})

/* ------------------------------------------------------------------ */
/* Malformed input and unreadable storage fail closed                  */
/* ------------------------------------------------------------------ */

describe('fail closed', () => {
  it.each([
    [{ date: TODAY, kind: 'yoga' }, 'kind'],
    [{ date: TODAY, kind: 5 }, 'kind'],
    [{ date: TODAY }, 'kind'],
    [{ date: '2026-02-30', kind: 'recovery' }, 'date'],
    [{ kind: 'recovery' }, 'date'],
  ])('refuses %o and stores nothing', async (body, field) => {
    const fake = createFakeD1()
    const token = await seedToken(fake.db, 'sub-1', 'a@example.com')

    const { response, body: answer } = await flex(fake.db, {
      method: 'PUT',
      token,
      origin: ORIGIN,
      body,
    })
    expect(response.status).toBe(400)
    expect(answer.field).toBe(field)
    expect(fake.trainingFlex.size).toBe(0)
  })

  it('refuses a malformed JSON body', async () => {
    const fake = createFakeD1()
    const token = await seedToken(fake.db, 'sub-1', 'a@example.com')
    const bad = await flex(fake.db, { method: 'PUT', token, origin: ORIGIN, rawBody: '{oops' })
    expect(bad.response.status).toBe(400)
    expect(bad.body.error).toBe('invalid_json')
  })

  it.each([
    ['?from=nonsense&to=' + TODAY],
    ['?from=' + TODAY],
    ['?from=2026-09-09&to=2026-09-08'],
  ])('refuses a bad read range %s', async (query) => {
    const fake = createFakeD1()
    const token = await seedToken(fake.db, 'sub-1', 'a@example.com')
    expect((await flex(fake.db, { token, query })).response.status).toBe(400)
  })

  it('reports an unreadable stored kind as an error, never as "no choice"', async () => {
    const fake = createFakeD1()
    const token = await seedToken(fake.db, 'sub-1', 'a@example.com')
    // A kind this build does not recognise — a future schema, or corruption.
    fake.trainingFlex.set(`sub-1 ${TODAY}`, {
      google_sub: 'sub-1',
      local_date: TODAY,
      kind: 'yoga',
      created_at: 1,
      updated_at: 1,
    })

    const { response, body } = await flex(fake.db, { token })
    expect(response.status).toBe(500)
    expect(body.error).toBe('flex_unreadable')
    // Above all it must not read as an unresolved day.
    expect(body.choices).toBeUndefined()
  })

  it('reports a storage failure as a controlled error', async () => {
    const fake = createFakeD1()
    const token = await seedToken(fake.db, 'sub-1', 'a@example.com')
    fake.breakTrainingFlex(new Error('d1 down'))

    const { response, body } = await flex(fake.db, { token })
    expect(response.status).toBe(500)
    expect(body.error).toBe('server_error')
  })
})

/* ------------------------------------------------------------------ */
/* THE PRODUCT PROMISE: no training evidence is ever created           */
/* ------------------------------------------------------------------ */

describe('a choice is never a workout', () => {
  it.each(['recovery', 'fitness_boxing_2'] as const)(
    '%s writes nothing into occurrences, sets or calibration',
    async (kind) => {
      const fake = createFakeD1()
      const token = await seedToken(fake.db, 'sub-1', 'a@example.com')

      expect(fake.occurrences.size).toBe(0)
      expect(fake.workoutSets.size).toBe(0)
      expect(fake.calibrations.size).toBe(0)

      const { response } = await flex(fake.db, {
        method: 'PUT',
        token,
        origin: ORIGIN,
        body: { date: TODAY, kind },
      })
      expect(response.status).toBe(200)

      // No occurrence, so no session, no sets, no load, no reps, no personal
      // best and nothing Round 16 progression can read.
      expect(fake.occurrences.size).toBe(0)
      expect(fake.workoutSets.size).toBe(0)
      expect(fake.calibrations.size).toBe(0)

      // And the workout API still reports the day as never started.
      const read = await handleWorkoutRequest(
        new Request(`${ORIGIN}/api/workouts/${TODAY}/tuesday`, {
          headers: { Cookie: `vshape_session=${token}` },
        }),
        makeEnv(fake.db),
      )
      const workout = (await read!.json()) as { sets: unknown[]; occurrence: unknown }
      expect(workout.occurrence).toBeNull()
      expect(workout.sets).toEqual([])
    },
  )

  it('leaves a genuinely recorded workout untouched', async () => {
    const fake = createFakeD1()
    const token = await seedToken(fake.db, 'sub-1', 'a@example.com')

    const start = await handleWorkoutRequest(
      new Request(`${ORIGIN}/api/workouts/${TODAY}/tuesday/start`, {
        method: 'POST',
        headers: {
          Cookie: `vshape_session=${token}`,
          Origin: ORIGIN,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(MONDAY_BODY),
      }),
      makeEnv(fake.db),
    )
    expect(start?.status).toBe(201)

    const occurrencesBefore = fake.occurrences.size
    const setsBefore = fake.workoutSets.size

    await flex(fake.db, { method: 'PUT', token, origin: ORIGIN, body: { date: TODAY, kind: 'recovery' } })

    // Choosing recovery does not delete or rewrite what was already recorded.
    expect(fake.occurrences.size).toBe(occurrencesBefore)
    expect(fake.workoutSets.size).toBe(setsBefore)
  })
})
