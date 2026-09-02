import { describe, expect, it } from 'vitest'

import type { Env } from '../auth/config'
import { createD1SessionStore } from '../auth/d1Stores'
import { createSession } from '../auth/session'
import { handleWorkoutRequest } from '../workouts/routes'
import { createFakeD1 } from './fakeD1'
import { programmeFromLegacyPlan, startBody } from './programmeFixture'

/**
 * Round 12 — the range-scoped history read.
 *
 * It exists because the paged read cannot PROVE anything about a date: it
 * returns the newest N workouts, so a date with no row might simply be older
 * than the page. A streak turns absence into "not trained", which is only
 * honest when the read is known to have covered the day.
 *
 * It adds no table, writes nothing, and takes no identity from the caller —
 * the account is the session's, exactly as every other route.
 */

const ORIGIN = 'https://vshapev2.nkmwei.de'
const BASE = `${ORIGIN}/api/workouts`

function makeEnv(db: D1Database): Env {
  return { DB: db, ASSETS: {} as Fetcher, APP_ORIGIN: ORIGIN }
}

async function seedToken(db: D1Database, googleSub: string, email: string) {
  return (
    await createSession(createD1SessionStore(db), { googleSub, email, trusted: true })
  ).token
}

function request(path: string, options: { token?: string; method?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = {}
  if (options.token) headers.Cookie = `vshape_session=${options.token}`
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'
  if (options.method && options.method !== 'GET') headers.Origin = ORIGIN
  return new Request(`${BASE}/${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })
}

async function call(
  db: D1Database,
  path: string,
  options: { token?: string; method?: string; body?: unknown } = {},
) {
  const response = await handleWorkoutRequest(request(path, options), makeEnv(db))
  if (!response) throw new Error('handler did not claim the request')
  return { response, body: (await response.json()) as Record<string, never> }
}

function plan(setCount: number) {
  return [
    {
      exerciseId: 'lat-pulldown',
      name: 'Lat Pulldown',
      prescription: '4 × 10–15',
      equipment: 'BAND 20kg',
      resultKind: 'reps',
      loadMode: 'kg',
      perSide: false,
      setCount,
    },
  ]
}

/** ROUND 22. Establish the programme this Start should freeze, then Start. */
async function startWorkout(
  fake: ReturnType<typeof createFakeD1>,
  token: string,
  date: string,
  sessionId: string,
) {
  fake.seedProgrammeForAll(programmeFromLegacyPlan(sessionId, { exercises: plan(2) }))
  return call(fake.db, `${date}/${sessionId}/start`, {
    token,
    method: 'POST',
    body: startBody(),
  })
}

async function completeSet(db: D1Database, token: string, date: string, s: string, i: number) {
  return call(db, `${date}/${s}/sets/0/${i}`, {
    token,
    method: 'PUT',
    body: { action: 'complete', result: 12, load: { value: 20, unit: 'kg' } },
  })
}

/** A finished workout: both sets completed. */
async function finish(
  fake: ReturnType<typeof createFakeD1>,
  token: string,
  date: string,
  sessionId: string,
) {
  await startWorkout(fake, token, date, sessionId)
  await completeSet(fake.db, token, date, sessionId, 0)
  await completeSet(fake.db, token, date, sessionId, 1)
}

type RangeBody = {
  from: string
  to: string
  complete: boolean
  workouts: { date: string; sessionId: string }[]
  totals: { workouts: number }
}

async function readRange(db: D1Database, token: string, from: string, to: string) {
  const { response, body } = await call(db, `history?from=${from}&to=${to}`, { token })
  return { response, body: body as unknown as RangeBody }
}

/* ------------------------------------------------------------------ */
/* Authentication and identity                                         */
/* ------------------------------------------------------------------ */

describe('range read authentication', () => {
  it('rejects an unauthenticated range read', async () => {
    const fake = createFakeD1()
    const { db } = fake
    const { response, body } = await call(db, 'history?from=2026-09-01&to=2026-09-30')
    expect(response.status).toBe(401)
    expect(body.error).toBe('unauthenticated')
  })

  it('marks the response no-store', async () => {
    const fake = createFakeD1()
    const { db } = fake
    const token = await seedToken(db, 'sub-a', 'a@example.com')
    const { response } = await readRange(db, token, '2026-09-01', '2026-09-30')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })

  it('takes no account identity from the caller', async () => {
    const fake = createFakeD1()
    const { db } = fake
    const mine = await seedToken(db, 'sub-a', 'a@example.com')
    await finish(fake, mine, '2026-09-07', 'monday')

    const theirs = await seedToken(db, 'sub-b', 'b@example.com')

    // Naming another account in the query string changes nothing: the account
    // is the session's, and these parameters are not read at all.
    const { body } = await call(
      db,
      'history?from=2026-09-01&to=2026-09-30&googleSub=sub-a&google_sub=sub-a&account=sub-a',
      { token: theirs },
    )
    expect((body as unknown as RangeBody).workouts).toEqual([])
    expect((body as unknown as RangeBody).totals.workouts).toBe(0)
  })

  it('never returns another account’s workouts', async () => {
    const fake = createFakeD1()
    const { db } = fake
    const mine = await seedToken(db, 'sub-a', 'a@example.com')
    const theirs = await seedToken(db, 'sub-b', 'b@example.com')

    await finish(fake, mine, '2026-09-07', 'monday')
    await finish(fake, theirs, '2026-09-08', 'tuesday')

    const asMine = await readRange(db, mine, '2026-09-01', '2026-09-30')
    expect(asMine.body.workouts.map((row) => row.date)).toEqual(['2026-09-07'])

    const asTheirs = await readRange(db, theirs, '2026-09-01', '2026-09-30')
    expect(asTheirs.body.workouts.map((row) => row.date)).toEqual(['2026-09-08'])
  })
})

/* ------------------------------------------------------------------ */
/* Parameters                                                          */
/* ------------------------------------------------------------------ */

describe('range parameters', () => {
  async function reject(query: string) {
    const fake = createFakeD1()
    const { db } = fake
    const token = await seedToken(db, 'sub-a', 'a@example.com')
    const { response, body } = await call(db, `history?${query}`, { token })
    expect(response.status, query).toBe(400)
    expect(body.error, query).toBe('invalid_range')
  }

  it('refuses a malformed or impossible date', async () => {
    await reject('from=2026-9-1&to=2026-09-30')
    await reject('from=2026-02-30&to=2026-03-01')
    await reject('from=yesterday&to=today')
  })

  it('refuses a backwards range', async () => {
    await reject('from=2026-09-30&to=2026-09-01')
  })

  it('refuses a half-specified range rather than guessing the other end', async () => {
    await reject('from=2026-09-01')
    await reject('to=2026-09-30')
  })

  it('refuses a range wider than the bound', async () => {
    // 366 days is the most one read may span, matching the Holiday bound.
    await reject('from=2026-01-01&to=2027-12-31')
  })

  it('accepts a range exactly at the bound', async () => {
    const fake = createFakeD1()
    const { db } = fake
    const token = await seedToken(db, 'sub-a', 'a@example.com')
    // 2026-01-01 to 2026-12-31 inclusive is 365 days.
    const { response } = await readRange(db, token, '2026-01-01', '2026-12-31')
    expect(response.status).toBe(200)
  })

  it('still serves the paged read when no range is asked for', async () => {
    const fake = createFakeD1()
    const { db } = fake
    const token = await seedToken(db, 'sub-a', 'a@example.com')
    await finish(fake, token, '2026-09-07', 'monday')

    const { response, body } = await call(db, 'history?limit=5', { token })
    expect(response.status).toBe(200)
    expect((body as unknown as { limit: number }).limit).toBe(5)
  })
})

/* ------------------------------------------------------------------ */
/* What it returns                                                     */
/* ------------------------------------------------------------------ */

describe('range results', () => {
  it('returns every workout inside the inclusive span, newest first', async () => {
    const fake = createFakeD1()
    const { db } = fake
    const token = await seedToken(db, 'sub-a', 'a@example.com')
    await finish(fake, token, '2026-09-07', 'monday')
    await finish(fake, token, '2026-09-08', 'tuesday')
    await finish(fake, token, '2026-09-09', 'wednesday')

    const { body } = await readRange(db, token, '2026-09-07', '2026-09-09')
    expect(body.workouts.map((row) => row.date)).toEqual([
      '2026-09-09',
      '2026-09-08',
      '2026-09-07',
    ])
    // Both ends are included.
    expect(body.from).toBe('2026-09-07')
    expect(body.to).toBe('2026-09-09')
  })

  it('excludes workouts outside the span', async () => {
    const fake = createFakeD1()
    const { db } = fake
    const token = await seedToken(db, 'sub-a', 'a@example.com')
    await finish(fake, token, '2026-09-06', 'sunday')
    await finish(fake, token, '2026-09-08', 'tuesday')
    await finish(fake, token, '2026-09-20', 'sunday')

    const { body } = await readRange(db, token, '2026-09-07', '2026-09-09')
    expect(body.workouts.map((row) => row.date)).toEqual(['2026-09-08'])
  })

  it('reports itself complete when it returned everything in the span', async () => {
    const fake = createFakeD1()
    const { db } = fake
    const token = await seedToken(db, 'sub-a', 'a@example.com')
    await finish(fake, token, '2026-09-07', 'monday')

    const { body } = await readRange(db, token, '2026-09-01', '2026-09-30')
    expect(body.complete).toBe(true)
  })

  it('reports an empty span honestly rather than as unknown', async () => {
    const fake = createFakeD1()
    const { db } = fake
    const token = await seedToken(db, 'sub-a', 'a@example.com')

    const { body } = await readRange(db, token, '2026-09-01', '2026-09-30')
    expect(body.workouts).toEqual([])
    // Nothing recorded IS the complete truth for that span.
    expect(body.complete).toBe(true)
  })

  it('keeps completed and skipped separate in the range rows', async () => {
    const fake = createFakeD1()
    const { db } = fake
    const token = await seedToken(db, 'sub-a', 'a@example.com')
    await startWorkout(fake, token, '2026-09-07', 'monday')
    await completeSet(db, token, '2026-09-07', 'monday', 0)
    await call(db, '2026-09-07/monday/sets/0/1', {
      token,
      method: 'PUT',
      body: { action: 'skip' },
    })

    const { body } = await readRange(db, token, '2026-09-07', '2026-09-07')
    const row = body.workouts[0] as unknown as {
      progress: { total: number; completed: number; skipped: number; resolved: number }
    }
    expect(row.progress).toMatchObject({ total: 2, completed: 1, skipped: 1, resolved: 2 })
  })
})

/* ------------------------------------------------------------------ */
/* Read-only                                                           */
/* ------------------------------------------------------------------ */

describe('range read is read-only', () => {
  it('writes nothing — the same read twice returns the same facts', async () => {
    const fake = createFakeD1()
    const { db } = fake
    const token = await seedToken(db, 'sub-a', 'a@example.com')
    await finish(fake, token, '2026-09-07', 'monday')

    const first = await readRange(db, token, '2026-09-01', '2026-09-30')
    const second = await readRange(db, token, '2026-09-01', '2026-09-30')
    expect(second.body).toEqual(first.body)
  })

  it('never invents a workout for a date that has none', async () => {
    const fake = createFakeD1()
    const { db } = fake
    const token = await seedToken(db, 'sub-a', 'a@example.com')

    // A whole month with nothing recorded stays empty: the read does not
    // backfill a "missed" row to represent an absent workout.
    const { body } = await readRange(db, token, '2026-09-01', '2026-09-30')
    expect(body.workouts).toHaveLength(0)
    expect(body.totals.workouts).toBe(0)
  })

  it('rejects a write method on the history path', async () => {
    const fake = createFakeD1()
    const { db } = fake
    const token = await seedToken(db, 'sub-a', 'a@example.com')
    for (const method of ['POST', 'PUT', 'DELETE']) {
      const { response } = await call(db, 'history?from=2026-09-01&to=2026-09-30', {
        token,
        method,
      })
      expect(response.status, method).toBe(405)
    }
  })
})
