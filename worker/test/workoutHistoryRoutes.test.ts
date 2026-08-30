import { describe, expect, it, vi } from 'vitest'

import type { Env } from '../auth/config'
import { createD1SessionStore } from '../auth/d1Stores'
import { createSession } from '../auth/session'
import { handleWorkoutRequest } from '../workouts/routes'
import { createFakeD1 } from './fakeD1'

/**
 * Round 10 — the read-only workout history surface.
 *
 * Reporting only: every assertion here is about what was recorded. Nothing in
 * this suite expects a "missed" workout, an adherence figure or a streak, and
 * a skipped set is never allowed to read as a completed one.
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

/** One exercise with `setCount` sets, so a workout's shape is predictable. */
function plan(setCount: number, exerciseId = 'lat-pulldown') {
  return [
    {
      exerciseId,
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

async function startWorkout(
  db: D1Database,
  token: string,
  date: string,
  sessionId: string,
  options: { setCount?: number; day?: string; focus?: string; intensity?: string } = {},
) {
  return call(db, `${date}/${sessionId}/start`, {
    token,
    method: 'POST',
    body: {
      day: options.day ?? 'Monday',
      focus: options.focus ?? 'Back Width + Biceps',
      intensity: options.intensity ?? 'HARD',
      exercises: plan(options.setCount ?? 4),
    },
  })
}

async function completeSet(db: D1Database, token: string, date: string, s: string, i: number) {
  return call(db, `${date}/${s}/sets/0/${i}`, {
    token,
    method: 'PUT',
    body: { action: 'complete', result: 12, load: { value: 20, unit: 'kg' } },
  })
}

async function skipSet(db: D1Database, token: string, date: string, s: string, i: number) {
  return call(db, `${date}/${s}/sets/0/${i}`, { token, method: 'PUT', body: { action: 'skip' } })
}

/* ------------------------------------------------------------------ */
/* Authentication and isolation                                        */
/* ------------------------------------------------------------------ */

describe('history authentication', () => {
  it('rejects an unauthenticated read', async () => {
    const { db } = createFakeD1()
    const { response, body } = await call(db, 'history')
    expect(response.status).toBe(401)
    expect(body.error).toBe('unauthenticated')
  })

  it('marks the response no-store', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')
    const { response } = await call(db, 'history', { token })
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })

  it('rejects a write method on history', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')
    for (const method of ['POST', 'PUT', 'DELETE']) {
      const { response, body } = await call(db, 'history', { token, method, body: {} })
      expect(response.status).toBe(405)
      expect(body.error).toBe('method_not_allowed')
    }
  })

  it('never echoes the account identity', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')
    await startWorkout(db, token, '2026-08-31', 'monday')

    const { body } = await call(db, 'history', { token })
    expect(JSON.stringify(body)).not.toContain('sub-a')
    expect(JSON.stringify(body)).not.toContain('googleSub')
    expect(JSON.stringify(body)).not.toContain('snapshotId')
  })
})

describe('account isolation', () => {
  it('shows an account only its own recorded workouts', async () => {
    const { db } = createFakeD1()
    const tokenA = await seedToken(db, 'sub-a', 'a@example.com')
    const tokenB = await seedToken(db, 'sub-b', 'b@example.com')

    await startWorkout(db, tokenA, '2026-08-31', 'monday')
    await completeSet(db, tokenA, '2026-08-31', 'monday', 0)

    const b = await call(db, 'history', { token: tokenB })
    expect(b.body.workouts).toEqual([])
    expect(b.body.totals).toEqual({
      workouts: 0,
      sets: 0,
      completed: 0,
      skipped: 0,
      resolved: 0,
    })

    // A still sees its own, so the empty answer above is isolation, not loss.
    const a = await call(db, 'history', { token: tokenA })
    expect((a.body.workouts as unknown as unknown[]).length).toBe(1)
  })

  it('does not let one account’s totals include another’s sets', async () => {
    const { db } = createFakeD1()
    const tokenA = await seedToken(db, 'sub-a', 'a@example.com')
    const tokenB = await seedToken(db, 'sub-b', 'b@example.com')

    await startWorkout(db, tokenA, '2026-08-31', 'monday', { setCount: 4 })
    await startWorkout(db, tokenB, '2026-08-31', 'monday', { setCount: 2 })

    const a = await call(db, 'history', { token: tokenA })
    const b = await call(db, 'history', { token: tokenB })
    expect((a.body.totals as unknown as { sets: number }).sets).toBe(4)
    expect((b.body.totals as unknown as { sets: number }).sets).toBe(2)
  })
})

/* ------------------------------------------------------------------ */
/* Shape, counts and semantics                                         */
/* ------------------------------------------------------------------ */

describe('recorded history', () => {
  it('reports an empty history honestly', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')

    const { response, body } = await call(db, 'history', { token })
    expect(response.status).toBe(200)
    expect(body.workouts).toEqual([])
    expect(body.totals).toEqual({
      workouts: 0,
      sets: 0,
      completed: 0,
      skipped: 0,
      resolved: 0,
    })
  })

  it('returns the snapshot fields Progress needs', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')
    await startWorkout(db, token, '2026-08-31', 'monday')

    const { body } = await call(db, 'history', { token })
    const entry = (body.workouts as unknown as Record<string, unknown>[])[0]
    expect(entry).toMatchObject({
      date: '2026-08-31',
      sessionId: 'monday',
      day: 'Monday',
      focus: 'Back Width + Biceps',
      intensity: 'HARD',
    })
    expect(typeof entry.startedAt).toBe('number')
    expect(typeof entry.updatedAt).toBe('number')
  })

  it('counts completed and skipped separately, and never merges them', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')
    await startWorkout(db, token, '2026-08-31', 'monday', { setCount: 4 })
    await completeSet(db, token, '2026-08-31', 'monday', 0)
    await skipSet(db, token, '2026-08-31', 'monday', 1)

    const { body } = await call(db, 'history', { token })
    const entry = (body.workouts as unknown as Record<string, unknown>[])[0]

    expect(entry.progress).toEqual({ total: 4, completed: 1, skipped: 1, resolved: 2 })
    expect(body.totals).toEqual({
      workouts: 1,
      sets: 4,
      completed: 1,
      skipped: 1,
      resolved: 2,
    })
  })

  it('a fully skipped workout reports zero completed', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')
    await startWorkout(db, token, '2026-08-31', 'monday', { setCount: 2 })
    await skipSet(db, token, '2026-08-31', 'monday', 0)
    await skipSet(db, token, '2026-08-31', 'monday', 1)

    const { body } = await call(db, 'history', { token })
    const progress = (body.workouts as unknown as { progress: Record<string, number> }[])[0]
      .progress

    // Every set resolved, none trained. Traversal is not success.
    expect(progress.resolved).toBe(progress.total)
    expect(progress.completed).toBe(0)
    expect(progress.skipped).toBe(2)
  })

  it('reports a partially pending workout as pending, not complete', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')
    await startWorkout(db, token, '2026-08-31', 'monday', { setCount: 4 })
    await completeSet(db, token, '2026-08-31', 'monday', 0)

    const { body } = await call(db, 'history', { token })
    const progress = (body.workouts as unknown as { progress: Record<string, number> }[])[0]
      .progress
    expect(progress).toEqual({ total: 4, completed: 1, skipped: 0, resolved: 1 })
    expect(progress.resolved).toBeLessThan(progress.total)
  })

  it('includes a started workout with nothing logged, without calling it trained', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')
    await startWorkout(db, token, '2026-08-31', 'monday', { setCount: 3 })

    const { body } = await call(db, 'history', { token })
    const progress = (body.workouts as unknown as { progress: Record<string, number> }[])[0]
      .progress
    expect(progress).toEqual({ total: 3, completed: 0, skipped: 0, resolved: 0 })
  })

  it('totals cover all history, not just the returned page', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')
    for (const day of ['2026-08-31', '2026-09-01', '2026-09-02']) {
      await startWorkout(db, token, day, 'monday', { setCount: 2 })
    }

    const { body } = await call(db, 'history?limit=1', { token })
    expect((body.workouts as unknown as unknown[]).length).toBe(1)
    expect(body.totals).toMatchObject({ workouts: 3, sets: 6 })
  })
})

/* ------------------------------------------------------------------ */
/* Ordering                                                            */
/* ------------------------------------------------------------------ */

describe('ordering', () => {
  it('returns newest workout date first', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')
    for (const day of ['2026-08-31', '2026-09-03', '2026-09-01']) {
      await startWorkout(db, token, day, 'monday')
    }

    const { body } = await call(db, 'history', { token })
    expect((body.workouts as unknown as { date: string }[]).map((w) => w.date)).toEqual([
      '2026-09-03',
      '2026-09-01',
      '2026-08-31',
    ])
  })

  it('breaks a same-date tie deterministically', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')
    // Two sessions recorded on one day.
    await startWorkout(db, token, '2026-09-01', 'monday')
    await startWorkout(db, token, '2026-09-01', 'wednesday')

    const first = await call(db, 'history', { token })
    const second = await call(db, 'history', { token })
    const ids = (body: Record<string, never>) =>
      (body.workouts as unknown as { sessionId: string }[]).map((w) => w.sessionId)

    expect(ids(first.body)).toHaveLength(2)
    // Stable: the same request twice gives the same order.
    expect(ids(first.body)).toEqual(ids(second.body))
  })
})

/* ------------------------------------------------------------------ */
/* Bounded limit                                                       */
/* ------------------------------------------------------------------ */

describe('limit', () => {
  async function withWorkouts(count: number) {
    const fake = createFakeD1()
    const token = await seedToken(fake.db, 'sub-a', 'a@example.com')
    for (let i = 0; i < count; i += 1) {
      const day = `2026-09-${String(i + 1).padStart(2, '0')}`
      await startWorkout(fake.db, token, day, 'monday', { setCount: 1 })
    }
    return { ...fake, token }
  }

  it('defaults to a bounded page', async () => {
    const { db, token } = await withWorkouts(3)
    const { body } = await call(db, 'history', { token })
    expect(body.limit).toBe(20)
  })

  it('honours an explicit valid limit', async () => {
    const { db, token } = await withWorkouts(5)
    const { body } = await call(db, 'history?limit=2', { token })
    expect(body.limit).toBe(2)
    expect((body.workouts as unknown as unknown[]).length).toBe(2)
  })

  it('accepts the maximum', async () => {
    const { db, token } = await withWorkouts(1)
    const { response, body } = await call(db, 'history?limit=50', { token })
    expect(response.status).toBe(200)
    expect(body.limit).toBe(50)
  })

  it('rejects an unbounded or hostile limit rather than serving it', async () => {
    const { db, token } = await withWorkouts(1)
    for (const limit of ['0', '-1', '51', '999999', 'all', '1.5', 'NaN', 'Infinity', '1e9']) {
      const { response, body } = await call(db, `history?limit=${limit}`, { token })
      expect(response.status, `limit=${limit}`).toBe(400)
      expect(body.error).toBe('invalid_limit')
    }
  })
})

/* ------------------------------------------------------------------ */
/* The existing single-workout API is unchanged                        */
/* ------------------------------------------------------------------ */

describe('existing workout API still behaves exactly as before', () => {
  it('start, read, complete, skip and undo all still work', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')

    const started = await startWorkout(db, token, '2026-08-31', 'monday', { setCount: 4 })
    expect(started.response.status).toBe(201)

    const resumed = await startWorkout(db, token, '2026-08-31', 'monday', { setCount: 4 })
    expect(resumed.response.status).toBe(200)
    expect(resumed.body.created).toBe(false)

    expect((await completeSet(db, token, '2026-08-31', 'monday', 0)).response.status).toBe(200)
    expect((await skipSet(db, token, '2026-08-31', 'monday', 1)).response.status).toBe(200)

    const undone = await call(db, '2026-08-31/monday/sets/0/1', { token, method: 'DELETE' })
    expect(undone.response.status).toBe(200)
    expect((undone.body.set as unknown as { status: string }).status).toBe('pending')

    const read = await call(db, '2026-08-31/monday', { token })
    expect(read.body.progress).toEqual({ total: 4, completed: 1, skipped: 0, resolved: 1 })
  })

  it('still reports a not-started workout as null', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')
    const { body } = await call(db, '2026-08-31/monday', { token })
    expect(body.occurrence).toBeNull()
  })

  it('still 404s an unknown nested route', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')
    const { response } = await call(db, '2026-08-31/monday/summary', { token })
    expect(response.status).toBe(404)
  })

  it('does not treat a bare date segment as history', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')
    const { response } = await call(db, '2026-08-31', { token })
    expect(response.status).toBe(404)
  })
})

/* ------------------------------------------------------------------ */
/* Storage failure                                                     */
/* ------------------------------------------------------------------ */

describe('storage failure', () => {
  it('reports a controlled 500 without leaking internals', async () => {
    const { db, breakWorkouts } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')
    breakWorkouts(new Error('D1 exploded: SELECT FROM workout_occurrences'))
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { response, body } = await call(db, 'history', { token })
    expect(response.status).toBe(500)
    expect(body.error).toBe('server_error')
    expect(JSON.stringify(body)).not.toContain('SELECT')
    errors.mockRestore()
  })
})
