import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Env } from '../auth/config'
import { createD1SessionStore } from '../auth/d1Stores'
import { createSession } from '../auth/session'
import { handleTrainingFlexRequest } from '../trainingFlex/routes'
import { handleWorkoutRequest } from '../workouts/routes'
import { createFakeD1 } from './fakeD1'

/**
 * Round 19 Correction 2 — the exclusion holds under CONCURRENCY.
 *
 * Correction 1 checked for a conflict in the handler and then wrote. That is a
 * read-then-write, and it cannot make two things mutually exclusive: on
 * separate isolates both requests can read "no conflict", and then both commit.
 *
 *   A: flex reads "no workout"      B: start reads "no flex"
 *   B: workout commits              A: flex commits
 *   → BOTH exist
 *
 * The fix moved the decision into the writes themselves — a conditional INSERT
 * on each side, evaluated by D1's single writer against committed state. These
 * tests prove it by FORCING the interleaving rather than hoping for it: each
 * request is driven past its pre-read and parked at its write, the competing
 * write is allowed to commit first, and only then is the parked write released.
 *
 * Both orders are covered, because the bug existed in both.
 */

const ORIGIN = 'https://vshapev2.nkmwei.de'
const ZONE = 'Asia/Kuala_Lumpur'
/** A Tuesday, at an hour where the declared zone is on the same date. */
const TODAY = '2026-09-08'
const SESSION = 'tuesday'
const NOW = Date.UTC(2026, 8, 8, 12, 0, 0)

const START_BODY = {
  day: 'Tuesday',
  focus: 'Upper Chest + Shoulders + Triceps',
  intensity: 'HARD',
  exercises: [
    {
      exerciseId: 'incline-db-press',
      name: 'Incline DB Press',
      prescription: '4 × 8–12',
      equipment: 'DB + Bench',
      resultKind: 'reps',
      loadMode: 'kg',
      perSide: false,
      setCount: 3,
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

async function seedToken(db: D1Database) {
  const { token } = await createSession(createD1SessionStore(db), {
    googleSub: 'sub-1',
    email: 'a@example.com',
    trusted: true,
  })
  return token
}

function flexRequest(db: D1Database, token: string, kind: string) {
  return handleTrainingFlexRequest(
    new Request(`${ORIGIN}/api/training-flex`, {
      method: 'PUT',
      headers: {
        Cookie: `vshape_session=${token}`,
        Origin: ORIGIN,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ date: TODAY, kind, timezone: ZONE }),
    }),
    makeEnv(db),
  )
}

function startRequest(db: D1Database, token: string, session = SESSION) {
  return handleWorkoutRequest(
    new Request(`${ORIGIN}/api/workouts/${TODAY}/${session}/start`, {
      method: 'POST',
      headers: {
        Cookie: `vshape_session=${token}`,
        Origin: ORIGIN,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(START_BODY),
    }),
    makeEnv(db),
  )
}

/** Let every already-queued microtask run, so a parked request truly parks. */
async function flushMicrotasks() {
  for (let i = 0; i < 40; i += 1) await Promise.resolve()
}

/** Track settlement so a test can PROVE a request is still mid-flight. */
function track<T>(promise: Promise<T>) {
  const state = { settled: false }
  const tracked = promise.then((value) => {
    state.settled = true
    return value
  })
  return { state, tracked }
}

/* ------------------------------------------------------------------ */
/* TEST A — the scheduled write wins                                   */
/* ------------------------------------------------------------------ */

describe('A. the scheduled workout commits first', () => {
  it('the later flex write is refused, and nothing of the workout changes', async () => {
    const fake = createFakeD1()
    const token = await seedToken(fake.db)

    // 1. Park every flex write. The request will get past its pre-read — which
    //    correctly sees no workout, because none exists yet — and stop at the
    //    moment of persistence.
    const releaseFlex = fake.holdTrainingFlexWrites()
    const flex = track(flexRequest(fake.db, token, 'recovery'))

    await flushMicrotasks()
    // The interleaving is FORCED, not hoped for: the flex request is provably
    // still in flight, past its check and waiting to write.
    expect(flex.state.settled).toBe(false)
    expect(fake.trainingFlex.size).toBe(0)

    // 2. The Start now runs to completion. Its own pre-read sees no flex, which
    //    is true at this instant — exactly the stale-read window.
    const start = await startRequest(fake.db, token)
    expect(start!.status).toBe(201)
    expect(fake.occurrences.size).toBe(1)
    expect(fake.workoutSets.size).toBe(3)

    const occurrenceSnapshot = JSON.stringify([...fake.occurrences.entries()])
    const setsSnapshot = JSON.stringify([...fake.workoutSets.entries()])

    // 3. Release the parked flex write. Under the old read-then-write it would
    //    now commit and produce the impossible state.
    releaseFlex()
    const response = await flex.tracked

    // The write itself refused, because the occurrence existed when it ran.
    expect(response!.status).toBe(409)
    expect(((await response!.json()) as { error: string }).error).toBe(
      'workout_already_started',
    )

    // Final durable truth: the workout stands, and no flex row exists.
    expect(fake.trainingFlex.size).toBe(0)
    expect(fake.occurrences.size).toBe(1)
    expect(fake.workoutSets.size).toBe(3)
    // Byte-identical: the loser did not touch, rewrite or neutralise anything.
    expect(JSON.stringify([...fake.occurrences.entries()])).toBe(occurrenceSnapshot)
    expect(JSON.stringify([...fake.workoutSets.entries()])).toBe(setsSnapshot)
  })
})

/* ------------------------------------------------------------------ */
/* TEST B — the flex write wins                                        */
/* ------------------------------------------------------------------ */

describe('B. the flex choice commits first', () => {
  it('the later scheduled Start is refused, and writes no occurrence or sets', async () => {
    const fake = createFakeD1()
    const token = await seedToken(fake.db)

    // 1. Park the occurrence claim. The Start gets past its pre-read — which
    //    correctly sees no flex — and stops at persistence.
    const releaseBatches = fake.holdBatches()
    const start = track(startRequest(fake.db, token))

    await flushMicrotasks()
    expect(start.state.settled).toBe(false)
    expect(fake.occurrences.size).toBe(0)

    // 2. The flex request now runs to completion. Its pre-read sees no workout,
    //    which is true at this instant.
    const flexResponse = await flexRequest(fake.db, token, 'recovery')
    expect(flexResponse!.status).toBe(200)
    expect(fake.trainingFlex.size).toBe(1)

    // 3. Release the parked occurrence claim.
    releaseBatches()
    const response = await start.tracked

    // The conditional insert refused: the day was already resolved.
    expect(response!.status).toBe(409)
    expect(((await response!.json()) as { error: string }).error).toBe(
      'training_flex_active',
    )

    // Final durable truth: the choice stands, and NOTHING of the workout was
    // written — not the occurrence, and not one set. The set inserts are gated
    // on the occurrence carrying this token, so a blocked claim writes none.
    expect(fake.trainingFlex.size).toBe(1)
    expect(fake.occurrences.size).toBe(0)
    expect(fake.workoutSets.size).toBe(0)
  })

  it('leaves the Extra path open even mid-race', async () => {
    // Extra was never the day's obligation, so the exclusion does not touch it.
    const fake = createFakeD1()
    const token = await seedToken(fake.db)
    await flexRequest(fake.db, token, 'recovery')

    const extra = await handleWorkoutRequest(
      new Request(`${ORIGIN}/api/workouts/${TODAY}/extra/start`, {
        method: 'POST',
        headers: {
          Cookie: `vshape_session=${token}`,
          Origin: ORIGIN,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ...START_BODY, sourceSessionId: SESSION }),
      }),
      makeEnv(fake.db),
    )
    expect(extra!.status).toBe(201)
    expect(fake.trainingFlex.size).toBe(1)
  })
})

/* ------------------------------------------------------------------ */
/* Controls — the guards must not refuse when there is no conflict      */
/* ------------------------------------------------------------------ */

describe('controls: no conflict, no refusal', () => {
  it('a flex write succeeds when no workout exists', async () => {
    const fake = createFakeD1()
    const token = await seedToken(fake.db)
    const response = await flexRequest(fake.db, token, 'fitness_boxing_2')
    expect(response!.status).toBe(200)
    expect(fake.trainingFlex.size).toBe(1)
  })

  it('a scheduled Start succeeds when no choice exists', async () => {
    const fake = createFakeD1()
    const token = await seedToken(fake.db)
    const response = await startRequest(fake.db, token)
    expect(response!.status).toBe(201)
    expect(fake.occurrences.size).toBe(1)
    expect(fake.workoutSets.size).toBe(3)
  })

  it('clearing the choice reopens the scheduled Start', async () => {
    const fake = createFakeD1()
    const token = await seedToken(fake.db)

    await flexRequest(fake.db, token, 'recovery')
    expect((await startRequest(fake.db, token))!.status).toBe(409)

    const cleared = await handleTrainingFlexRequest(
      new Request(`${ORIGIN}/api/training-flex`, {
        method: 'PUT',
        headers: {
          Cookie: `vshape_session=${token}`,
          Origin: ORIGIN,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ date: TODAY, kind: null, timezone: ZONE }),
      }),
      makeEnv(fake.db),
    )
    expect(cleared!.status).toBe(200)
    expect(fake.trainingFlex.size).toBe(0)

    expect((await startRequest(fake.db, token))!.status).toBe(201)
    expect(fake.occurrences.size).toBe(1)
  })

  it('a resume is never refused, even with a choice somehow present', async () => {
    // Resuming an existing workout has no exclusion left to enforce, and
    // refusing would strand a session the user is in the middle of.
    const fake = createFakeD1()
    const token = await seedToken(fake.db)

    expect((await startRequest(fake.db, token))!.status).toBe(201)
    // Force the impossible state directly, bypassing the guards.
    fake.trainingFlex.set('forced', {
      google_sub: 'sub-1',
      local_date: TODAY,
      kind: 'recovery',
      created_at: 1,
      updated_at: 1,
    })

    const resume = await startRequest(fake.db, token)
    expect(resume!.status).toBe(200)
    expect(fake.occurrences.size).toBe(1)
  })
})
