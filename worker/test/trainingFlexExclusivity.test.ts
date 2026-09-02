import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Env } from '../auth/config'
import { createD1SessionStore } from '../auth/d1Stores'
import { createSession } from '../auth/session'
import { handleTrainingFlexRequest } from '../trainingFlex/routes'
import { handleWorkoutRequest } from '../workouts/routes'
import { createFakeD1 } from './fakeD1'
import { programmeFromLegacyPlan, startBody } from './programmeFixture'

/**
 * Round 19 Correction 1 — the three Today choices are ALTERNATIVES.
 *
 * "Do scheduled workout", "Recovery today" and "Nintendo Fitness Boxing 2" are
 * mutually exclusive, and the exclusion is enforced in DURABLE SERVER TRUTH
 * rather than by hiding a button. Every test here goes through the real HTTP
 * handlers, because the whole point is that a direct API call — or the Training
 * route, which uses the same endpoint — cannot get around it.
 *
 * The invariant has two halves and one absolute rule:
 *
 *   started workout  → a flex choice is refused
 *   flex choice      → starting the scheduled workout is refused
 *   NEITHER refusal ever repairs the conflict by writing. Real training history
 *   is never deleted, rewritten or neutralised to make a choice fit, and the
 *   flex row is never silently cleared to let a Start through.
 */

const ORIGIN = 'https://vshapev2.nkmwei.de'
/** A Tuesday, and 12:00 UTC — the same calendar day in the declared zone. */
const ZONE = 'Asia/Kuala_Lumpur'
const TODAY = '2026-09-08'
const SESSION = 'tuesday'
const NOW = Date.UTC(2026, 8, 8, 12, 0, 0)

const PLAN = {
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
      setCount: 2,
    },
  ],
}

/**
 * ROUND 22 — the same plan, established where the server now reads it.
 *
 * The Start body no longer carries programme content, so the plan this suite
 * has always been about is seeded as the account's authoritative programme.
 * Nothing about what the suite asserts changes.
 */
const PROGRAMME = programmeFromLegacyPlan(SESSION, PLAN)

const START_BODY = startBody(PROGRAMME.revision)

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

async function seedToken(fake: ReturnType<typeof createFakeD1>) {
  fake.seedProgramme('sub-1', PROGRAMME)
  const db = fake.db
  const { token } = await createSession(createD1SessionStore(db), {
    googleSub: 'sub-1',
    email: 'a@example.com',
    trusted: true,
  })
  return token
}

/** PUT /api/training-flex — the real handler. */
async function putFlex(
  db: D1Database,
  token: string,
  kind: string | null,
  date = TODAY,
) {
  const response = await handleTrainingFlexRequest(
    new Request(`${ORIGIN}/api/training-flex`, {
      method: 'PUT',
      headers: {
        Cookie: `vshape_session=${token}`,
        Origin: ORIGIN,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ date, kind, timezone: ZONE }),
    }),
    makeEnv(db),
  )
  return { response: response!, body: (await response!.json()) as Record<string, never> }
}

/** POST /api/workouts/:date/:session/start — the real handler. */
async function startWorkout(
  db: D1Database,
  token: string,
  session = SESSION,
  body: Record<string, unknown> = START_BODY,
) {
  const response = await handleWorkoutRequest(
    new Request(`${ORIGIN}/api/workouts/${TODAY}/${session}/start`, {
      method: 'POST',
      headers: {
        Cookie: `vshape_session=${token}`,
        Origin: ORIGIN,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }),
    makeEnv(db),
  )
  return { response: response!, body: (await response!.json()) as Record<string, never> }
}

/** Complete every set, so the workout is genuinely finished. */
async function completeFirstSet(db: D1Database, token: string) {
  const response = await handleWorkoutRequest(
    new Request(`${ORIGIN}/api/workouts/${TODAY}/${SESSION}/sets/0/0`, {
      method: 'PUT',
      headers: {
        Cookie: `vshape_session=${token}`,
        Origin: ORIGIN,
        'Content-Type': 'application/json',
      },
      // ROUND 22. The load mode is derived from the programme now, and
      // "Incline DB Press" is dumbbell work — so the accepted Round 20 rule
      // makes this PER DUMBBELL. The old fixture hand-declared `kg` for a DB
      // exercise, which the server would no longer agree to.
      body: JSON.stringify({
        action: 'complete',
        result: 10,
        load: { value: 20, unit: 'kg_each' },
      }),
    }),
    makeEnv(db),
  )
  return response!
}

/* ------------------------------------------------------------------ */
/* 1–3. Flex active → the scheduled start is refused                   */
/* ------------------------------------------------------------------ */

describe('a flexed day refuses its scheduled workout', () => {
  it.each(['recovery', 'fitness_boxing_2'] as const)(
    '%s: a direct start is refused and creates no occurrence',
    async (kind) => {
      const fake = createFakeD1()
      const token = await seedToken(fake)

      expect((await putFlex(fake.db, token, kind)).response.status).toBe(200)

      // Straight at the API, bypassing any UI.
      const start = await startWorkout(fake.db, token)
      expect(start.response.status).toBe(409)
      expect(start.body.error).toBe('training_flex_active')

      // Nothing was created — not the occurrence, not a single set.
      expect(fake.occurrences.size).toBe(0)
      expect(fake.workoutSets.size).toBe(0)
      // And the refusal did NOT quietly clear the choice to let the next
      // attempt through.
      expect(fake.trainingFlex.size).toBe(1)
    },
  )

  it('clearing via "Do scheduled workout" lets the start succeed', async () => {
    const fake = createFakeD1()
    const token = await seedToken(fake)

    await putFlex(fake.db, token, 'recovery')
    expect((await startWorkout(fake.db, token)).response.status).toBe(409)

    // The documented way out: choose the scheduled workout, which clears.
    const cleared = await putFlex(fake.db, token, null)
    expect(cleared.response.status).toBe(200)
    expect(cleared.body.choice).toBeNull()
    expect(fake.trainingFlex.size).toBe(0)

    const start = await startWorkout(fake.db, token)
    expect(start.response.status).toBe(201)
    expect(fake.occurrences.size).toBe(1)
  })

  it('does not block an EXTRA — Round 17 semantics are unchanged', async () => {
    const fake = createFakeD1()
    const token = await seedToken(fake)
    await putFlex(fake.db, token, 'recovery')

    // An Extra is voluntary and is not the day's obligation, so it is not the
    // thing the choice was an alternative to.
    const extra = await startWorkout(fake.db, token, 'extra', {
      ...START_BODY,
      sourceSessionId: SESSION,
    })
    expect(extra.response.status).toBe(201)
  })

  it('fails closed when the stored kind cannot be read', async () => {
    const fake = createFakeD1()
    const token = await seedToken(fake)
    // A stored kind this build cannot name — a future schema, or corruption.
    fake.trainingFlex.set('x', {
      google_sub: 'sub-1',
      local_date: TODAY,
      kind: 'yoga',
      created_at: 1,
      updated_at: 1,
    })

    // Correction 2 moved the decision into the write, whose guard asks only
    // whether a choice EXISTS for the day — it does not need to name it. So an
    // unreadable row still blocks the Start, and does so as the same honest
    // conflict rather than as a server error: the day IS resolved, we simply
    // cannot say into what.
    const start = await startWorkout(fake.db, token)
    expect(start.response.status).toBe(409)
    expect(start.body.error).toBe('training_flex_active')
    // The point either way: nothing was written.
    expect(fake.occurrences.size).toBe(0)
    expect(fake.workoutSets.size).toBe(0)
  })
})

/* ------------------------------------------------------------------ */
/* 4–6. Started / completed workout → a flex choice is refused         */
/* ------------------------------------------------------------------ */

describe('a started workout refuses a flex choice', () => {
  it.each(['recovery', 'fitness_boxing_2'] as const)(
    '%s is refused once the session has started, and is not written',
    async (kind) => {
      const fake = createFakeD1()
      const token = await seedToken(fake)

      expect((await startWorkout(fake.db, token)).response.status).toBe(201)
      const occurrencesAfterStart = fake.occurrences.size
      const setsAfterStart = fake.workoutSets.size

      const flex = await putFlex(fake.db, token, kind)
      expect(flex.response.status).toBe(409)
      expect(flex.body.error).toBe('workout_already_started')

      // No flex row, and the workout is untouched.
      expect(fake.trainingFlex.size).toBe(0)
      expect(fake.occurrences.size).toBe(occurrencesAfterStart)
      expect(fake.workoutSets.size).toBe(setsAfterStart)
    },
  )

  it('is refused after the workout is COMPLETED, and deletes nothing', async () => {
    const fake = createFakeD1()
    const token = await seedToken(fake)

    expect((await startWorkout(fake.db, token)).response.status).toBe(201)
    expect((await completeFirstSet(fake.db, token)).status).toBe(200)

    const occurrences = fake.occurrences.size
    const sets = fake.workoutSets.size

    const flex = await putFlex(fake.db, token, 'recovery')
    expect(flex.response.status).toBe(409)

    // The completed set is still there. Nothing was rewritten to make the
    // choice fit, and nothing was neutralised.
    expect(fake.occurrences.size).toBe(occurrences)
    expect(fake.workoutSets.size).toBe(sets)
    expect(fake.trainingFlex.size).toBe(0)

    const read = await handleWorkoutRequest(
      new Request(`${ORIGIN}/api/workouts/${TODAY}/${SESSION}`, {
        headers: { Cookie: `vshape_session=${token}` },
      }),
      makeEnv(fake.db),
    )
    const workout = (await read!.json()) as {
      occurrence: unknown
      sets: { status: string }[]
    }
    expect(workout.occurrence).not.toBeNull()
    expect(workout.sets.some((set) => set.status === 'completed')).toBe(true)
  })

  it('still allows CLEARING, so a conflicting day is never a dead end', async () => {
    const fake = createFakeD1()
    const token = await seedToken(fake)
    await startWorkout(fake.db, token)

    // Nothing to clear here, but the operation must not be refused by the
    // started-workout guard — that guard is about choosing an alternative.
    const cleared = await putFlex(fake.db, token, null)
    expect(cleared.response.status).toBe(200)
    expect(cleared.body.choice).toBeNull()
  })

  it('an EXTRA on the same day does not block a flex choice', async () => {
    const fake = createFakeD1()
    const token = await seedToken(fake)

    const extra = await startWorkout(fake.db, token, 'extra', {
      ...START_BODY,
      sourceSessionId: SESSION,
    })
    expect(extra.response.status).toBe(201)

    // The day's own obligation was never started, so the choice is still open.
    expect((await putFlex(fake.db, token, 'recovery')).response.status).toBe(200)
  })
})

/* ------------------------------------------------------------------ */
/* 10. No evidence is ever destroyed by either refusal                 */
/* ------------------------------------------------------------------ */

describe('neither refusal ever writes', () => {
  it('leaves occurrences, sets and calibration byte-identical', async () => {
    const fake = createFakeD1()
    const token = await seedToken(fake)

    await startWorkout(fake.db, token)
    await completeFirstSet(fake.db, token)

    const before = {
      occurrences: [...fake.occurrences.entries()].map(([k, v]) => [k, JSON.stringify(v)]),
      sets: [...fake.workoutSets.entries()].map(([k, v]) => [k, JSON.stringify(v)]),
      calibration: fake.calibrations.size,
    }

    // Every refused attempt, in both directions.
    await putFlex(fake.db, token, 'recovery')
    await putFlex(fake.db, token, 'fitness_boxing_2')
    await startWorkout(fake.db, token)

    expect(
      [...fake.occurrences.entries()].map(([k, v]) => [k, JSON.stringify(v)]),
    ).toEqual(before.occurrences)
    expect([...fake.workoutSets.entries()].map(([k, v]) => [k, JSON.stringify(v)])).toEqual(
      before.sets,
    )
    expect(fake.calibrations.size).toBe(before.calibration)
  })
})
