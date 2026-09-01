import { describe, expect, it } from 'vitest'

import type { Env } from '../auth/config'
import { createD1SessionStore } from '../auth/d1Stores'
import { createSession } from '../auth/session'
import { handleProgressRequest } from '../progress/routes'
import { createD1WorkoutStore } from '../workouts/d1Store'
import { applySetUpdate, startWorkout } from '../workouts/workouts'
import { createFakeD1 } from './fakeD1'

/**
 * Round 15 — the Progress performance read, through the real route.
 *
 * The previous file proves the ranking rules against fixtures. This one proves
 * the part that fixtures cannot: that the SQL feeding them is account-scoped,
 * joined on the occurrence ownership token, restricted to completed sets, and
 * genuinely reads ALL of history rather than a recent page.
 *
 * Workouts here are written through the real Round 08 writers, so what the
 * Progress query reads is the same shape the app actually stores.
 */

const ORIGIN = 'https://vshapev2.nkmwei.de'

function makeEnv(db: D1Database): Env {
  return { DB: db, ASSETS: {} as Fetcher, APP_ORIGIN: ORIGIN } as unknown as Env
}

async function seedToken(db: D1Database, googleSub: string, email: string) {
  return (await createSession(createD1SessionStore(db), { googleSub, email, trusted: true }))
    .token
}

type ExerciseSpec = {
  exerciseId?: string
  name?: string
  resultKind?: 'reps' | 'seconds'
  loadMode?: 'none' | 'kg' | 'kg_each'
  perSide?: boolean
  setCount?: number
}

/** Start a workout with one or more exercises, exactly as the app would. */
async function startSession(
  db: D1Database,
  googleSub: string,
  date: string,
  sessionId: string,
  exercises: ExerciseSpec[],
  startedAt?: number,
) {
  await startWorkout(
    createD1WorkoutStore(db),
    googleSub,
    date,
    sessionId,
    {
      day: 'Monday',
      focus: 'Back Width + Biceps',
      intensity: 'HARD',
      sourceSessionId: null,
      exercises: exercises.map((exercise) => ({
        exerciseId: exercise.exerciseId ?? 'lat-pulldown',
        name: exercise.name ?? 'Lat Pulldown',
        prescription: '4 x 10-15',
        equipment: null,
        resultKind: exercise.resultKind ?? 'reps',
        loadMode: exercise.loadMode ?? 'kg',
        perSide: exercise.perSide ?? false,
        setCount: exercise.setCount ?? 4,
      })),
    },
    // An explicit start time, so a test about same-date recency does not
    // depend on two calls landing in different milliseconds.
    startedAt ?? Date.parse(`${date}T09:00:00Z`),
  )
}

/** Resolve one set of a started workout. */
async function resolveSet(
  db: D1Database,
  googleSub: string,
  date: string,
  sessionId: string,
  order: number,
  index: number,
  update:
    | { action: 'complete'; result: number; load: { value: number; unit: 'kg' | 'kg_each' } | null }
    | { action: 'skip' },
) {
  const outcome = await applySetUpdate(
    createD1WorkoutStore(db),
    googleSub,
    date,
    sessionId,
    order,
    index,
    update,
  )
  if (!outcome.ok) throw new Error(`could not resolve set: ${outcome.reason}`)
}

type Variant = {
  exerciseId: string
  exerciseName: string
  resultKind: string
  loadMode: string
  perSide: boolean
  personalBest: { date: string; loadValue: number | null; result: number } | null
  points: { date: string; sessionId: string; loadValue: number | null; result: number }[]
  lastPerformed: string
}

async function performance(db: D1Database, token: string) {
  const request = new Request(`${ORIGIN}/api/progress/performance`, {
    headers: { Cookie: `vshape_session=${token}` },
  })
  const response = await handleProgressRequest(request, makeEnv(db))
  if (!response) throw new Error('handler did not claim the request')
  const body = (await response.json()) as {
    complete: boolean
    examined?: number
    variants: Variant[]
  }
  return { response, body }
}

/* ------------------------------------------------------------------ */
/* 1. What may enter the aggregate                                     */
/* ------------------------------------------------------------------ */

describe('1. completed sets only', () => {
  it('includes a completed set', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')
    await startSession(db, 'sub-a', '2026-08-03', 'monday', [{}])
    await resolveSet(db, 'sub-a', '2026-08-03', 'monday', 0, 0, {
      action: 'complete',
      result: 10,
      load: { value: 50, unit: 'kg' },
    })

    const { body } = await performance(db, token)

    expect(body.complete).toBe(true)
    expect(body.variants).toHaveLength(1)
    expect(body.variants[0].personalBest).toMatchObject({ loadValue: 50, result: 10 })
  })

  it('excludes pending sets', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')
    // Started, nothing resolved: four pending sets and no performance.
    await startSession(db, 'sub-a', '2026-08-03', 'monday', [{}])

    const { body } = await performance(db, token)

    expect(body.variants).toEqual([])
    expect(body.examined).toBe(0)
  })

  it('excludes skipped sets', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')
    await startSession(db, 'sub-a', '2026-08-03', 'monday', [{}])
    await resolveSet(db, 'sub-a', '2026-08-03', 'monday', 0, 0, { action: 'skip' })

    const { body } = await performance(db, token)

    // Skipping is not a quiet way to record a set.
    expect(body.variants).toEqual([])
  })

  it('keeps a completed set beside skipped ones in the same workout', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')
    await startSession(db, 'sub-a', '2026-08-03', 'monday', [{}])
    await resolveSet(db, 'sub-a', '2026-08-03', 'monday', 0, 0, { action: 'skip' })
    await resolveSet(db, 'sub-a', '2026-08-03', 'monday', 0, 1, {
      action: 'complete',
      result: 12,
      load: { value: 45, unit: 'kg' },
    })
    await resolveSet(db, 'sub-a', '2026-08-03', 'monday', 0, 2, { action: 'skip' })

    const { body } = await performance(db, token)

    expect(body.variants[0].points).toHaveLength(1)
    expect(body.variants[0].points[0]).toMatchObject({ loadValue: 45, result: 12 })
  })
})

/* ------------------------------------------------------------------ */
/* 2. Account isolation                                                */
/* ------------------------------------------------------------------ */

describe('2. one account cannot see another', () => {
  it('never reports another account performance', async () => {
    const { db } = createFakeD1()
    const a = await seedToken(db, 'sub-a', 'a@example.com')
    await seedToken(db, 'sub-b', 'b@example.com')

    await startSession(db, 'sub-b', '2026-08-03', 'monday', [{}])
    await resolveSet(db, 'sub-b', '2026-08-03', 'monday', 0, 0, {
      action: 'complete',
      result: 10,
      load: { value: 200, unit: 'kg' },
    })

    const { body } = await performance(db, a)

    // B's 200 kg is nowhere in A's answer, not even as a number.
    expect(body.variants).toEqual([])
    expect(JSON.stringify(body)).not.toContain('200')
  })

  it('keeps each account own best', async () => {
    const { db } = createFakeD1()
    const a = await seedToken(db, 'sub-a', 'a@example.com')
    const b = await seedToken(db, 'sub-b', 'b@example.com')

    for (const [sub, load] of [
      ['sub-a', 50],
      ['sub-b', 80],
    ] as const) {
      await startSession(db, sub, '2026-08-03', 'monday', [{}])
      await resolveSet(db, sub, '2026-08-03', 'monday', 0, 0, {
        action: 'complete',
        result: 10,
        load: { value: load, unit: 'kg' },
      })
    }

    expect((await performance(db, a)).body.variants[0].personalBest?.loadValue).toBe(50)
    expect((await performance(db, b)).body.variants[0].personalBest?.loadValue).toBe(80)
  })
})

/* ------------------------------------------------------------------ */
/* 3. All of history, not a recent page                                */
/* ------------------------------------------------------------------ */

describe('3. all-time really means all-time', () => {
  it('finds a PB from long before the newest fifty workouts', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')

    // The heavy set, years ago.
    await startSession(db, 'sub-a', '2020-01-06', 'monday', [{}])
    await resolveSet(db, 'sub-a', '2020-01-06', 'monday', 0, 0, {
      action: 'complete',
      result: 5,
      load: { value: 95, unit: 'kg' },
    })

    // Sixty more recent workouts, all lighter — more than any page the
    // existing history endpoint returns.
    for (let index = 0; index < 60; index += 1) {
      const day = String(index + 1).padStart(2, '0')
      const date = `2026-0${index < 30 ? '6' : '7'}-${index < 30 ? day : String(index - 29).padStart(2, '0')}`
      await startSession(db, 'sub-a', date, 'monday', [{}])
      await resolveSet(db, 'sub-a', date, 'monday', 0, 0, {
        action: 'complete',
        result: 10,
        load: { value: 50, unit: 'kg' },
      })
    }

    const { body } = await performance(db, token)

    expect(body.complete).toBe(true)
    // A read that stopped at the newest N would have reported 50 kg, and
    // nothing on screen would have looked wrong.
    expect(body.variants[0].personalBest).toMatchObject({
      date: '2020-01-06',
      loadValue: 95,
      result: 5,
    })
    expect(body.variants[0].points).toHaveLength(61)
  })

  it('reports how many sets it examined', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')
    await startSession(db, 'sub-a', '2026-08-03', 'monday', [{ setCount: 4 }])
    for (let index = 0; index < 3; index += 1) {
      await resolveSet(db, 'sub-a', '2026-08-03', 'monday', 0, index, {
        action: 'complete',
        result: 10 + index,
        load: { value: 50, unit: 'kg' },
      })
    }

    const { body } = await performance(db, token)
    // Three completed; the fourth is still pending and is not a performance.
    expect(body.examined).toBe(3)
  })
})

/* ------------------------------------------------------------------ */
/* 4. Variants through the real query                                  */
/* ------------------------------------------------------------------ */

describe('4. measurement systems stay apart', () => {
  it('keeps kg and kg_each as separate variants', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')

    await startSession(db, 'sub-a', '2026-08-03', 'monday', [
      { exerciseId: 'db-press', name: 'DB Press', loadMode: 'kg' },
      { exerciseId: 'db-press', name: 'DB Press', loadMode: 'kg_each' },
    ])
    await resolveSet(db, 'sub-a', '2026-08-03', 'monday', 0, 0, {
      action: 'complete',
      result: 10,
      load: { value: 30, unit: 'kg' },
    })
    await resolveSet(db, 'sub-a', '2026-08-03', 'monday', 1, 0, {
      action: 'complete',
      result: 10,
      load: { value: 20, unit: 'kg_each' },
    })

    const { body } = await performance(db, token)

    expect(body.variants).toHaveLength(2)
    const each = body.variants.find((variant) => variant.loadMode === 'kg_each')
    // 20 kg each stays 20 kg each. It is never doubled into 40 kg total, and
    // it never competes with the 30 kg single-implement set.
    expect(each?.personalBest?.loadValue).toBe(20)
    expect(JSON.stringify(body)).not.toContain('40')
  })

  it('keeps reps and seconds as separate variants', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')

    await startSession(db, 'sub-a', '2026-08-03', 'monday', [
      { exerciseId: 'hold', name: 'Hold', resultKind: 'reps', loadMode: 'none' },
      { exerciseId: 'hold', name: 'Hold', resultKind: 'seconds', loadMode: 'none' },
    ])
    await resolveSet(db, 'sub-a', '2026-08-03', 'monday', 0, 0, {
      action: 'complete',
      result: 12,
      load: null,
    })
    await resolveSet(db, 'sub-a', '2026-08-03', 'monday', 1, 0, {
      action: 'complete',
      result: 60,
      load: null,
    })

    const { body } = await performance(db, token)

    expect(body.variants).toHaveLength(2)
    expect(body.variants.map((variant) => variant.resultKind).sort()).toEqual([
      'reps',
      'seconds',
    ])
  })

  it('keeps per-side apart from both-sides', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')

    await startSession(db, 'sub-a', '2026-08-03', 'monday', [
      { exerciseId: 'row', name: 'Row', perSide: true },
      { exerciseId: 'row', name: 'Row', perSide: false },
    ])
    await resolveSet(db, 'sub-a', '2026-08-03', 'monday', 0, 0, {
      action: 'complete',
      result: 10,
      load: { value: 24, unit: 'kg' },
    })
    await resolveSet(db, 'sub-a', '2026-08-03', 'monday', 1, 0, {
      action: 'complete',
      result: 10,
      load: { value: 24, unit: 'kg' },
    })

    const { body } = await performance(db, token)
    expect(body.variants).toHaveLength(2)
    expect(body.variants.filter((variant) => variant.perSide)).toHaveLength(1)
  })
})

/* ------------------------------------------------------------------ */
/* 5. Trends across workouts                                           */
/* ------------------------------------------------------------------ */

describe('5. one point per workout, through the real query', () => {
  /** The worked example from the round brief. */
  it('reads a real progression as four factual points', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')

    const workouts: [string, number, number][] = [
      ['2026-08-03', 45, 10],
      ['2026-08-10', 47.5, 8],
      ['2026-08-17', 47.5, 10],
      ['2026-08-24', 50, 8],
    ]

    for (const [date, load, reps] of workouts) {
      await startSession(db, 'sub-a', date, 'monday', [{}])
      // A lighter warm-up set in the same workout must not become the point.
      await resolveSet(db, 'sub-a', date, 'monday', 0, 0, {
        action: 'complete',
        result: 15,
        load: { value: 20, unit: 'kg' },
      })
      await resolveSet(db, 'sub-a', date, 'monday', 0, 1, {
        action: 'complete',
        result: reps,
        load: { value: load, unit: 'kg' },
      })
    }

    const { body } = await performance(db, token)

    expect(body.variants[0].points).toEqual([
      { date: '2026-08-03', sessionId: 'monday', loadValue: 45, result: 10 },
      { date: '2026-08-10', sessionId: 'monday', loadValue: 47.5, result: 8 },
      { date: '2026-08-17', sessionId: 'monday', loadValue: 47.5, result: 10 },
      { date: '2026-08-24', sessionId: 'monday', loadValue: 50, result: 8 },
    ])
    expect(body.variants[0].personalBest).toMatchObject({ date: '2026-08-24', loadValue: 50 })
  })

  it('gives one point for an exercise repeated twice in one session', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')

    await startSession(db, 'sub-a', '2026-08-03', 'monday', [
      { exerciseId: 'lat-pulldown', name: 'Lat Pulldown' },
      { exerciseId: 'lat-pulldown', name: 'Lat Pulldown' },
    ])
    await resolveSet(db, 'sub-a', '2026-08-03', 'monday', 0, 0, {
      action: 'complete',
      result: 12,
      load: { value: 45, unit: 'kg' },
    })
    await resolveSet(db, 'sub-a', '2026-08-03', 'monday', 1, 0, {
      action: 'complete',
      result: 6,
      load: { value: 52.5, unit: 'kg' },
    })

    const { body } = await performance(db, token)

    // One workout, one point, taken from the heaviest of both positions.
    expect(body.variants[0].points).toHaveLength(1)
    expect(body.variants[0].points[0].loadValue).toBe(52.5)
  })

  it('treats two sessions on one date as two occurrences', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')

    for (const session of ['monday', 'wednesday']) {
      await startSession(db, 'sub-a', '2026-08-03', session, [{}])
      await resolveSet(db, 'sub-a', '2026-08-03', session, 0, 0, {
        action: 'complete',
        result: 10,
        load: { value: session === 'monday' ? 50 : 45, unit: 'kg' },
      })
    }

    const { body } = await performance(db, token)
    expect(body.variants[0].points).toHaveLength(2)
  })

  it('reports an honest empty state for an account with no history', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')

    const { body } = await performance(db, token)

    expect(body).toEqual({ complete: true, examined: 0, variants: [] })
  })

  it('reports a single workout as one point and a PB', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')
    await startSession(db, 'sub-a', '2026-08-03', 'monday', [{}])
    await resolveSet(db, 'sub-a', '2026-08-03', 'monday', 0, 0, {
      action: 'complete',
      result: 10,
      load: { value: 50, unit: 'kg' },
    })

    const { body } = await performance(db, token)

    // One real point. The client decides not to draw a trend through it; the
    // server does not invent a second.
    expect(body.variants[0].points).toHaveLength(1)
    expect(body.variants[0].personalBest).not.toBeNull()
  })
})

/* ------------------------------------------------------------------ */
/* 6. Nothing invented                                                 */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* 5b. A loaded lift logged without its weight                         */
/* ------------------------------------------------------------------ */

describe('5b. a loaded set with no recorded load', () => {
  /** Complete a set of a kg exercise WITHOUT entering the weight. */
  async function completeWithoutLoad(
    db: D1Database,
    date: string,
    order: number,
    index: number,
    result: number,
  ) {
    await resolveSet(db, 'sub-a', date, 'monday', order, index, {
      action: 'complete',
      result,
      load: null,
    })
  }

  it('does not become a personal best', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')

    await startSession(db, 'sub-a', '2026-08-03', 'monday', [{}])
    await resolveSet(db, 'sub-a', '2026-08-03', 'monday', 0, 0, {
      action: 'complete',
      result: 8,
      load: { value: 50, unit: 'kg' },
    })
    // Thirty reps, no weight written down.
    await completeWithoutLoad(db, '2026-08-03', 0, 1, 30)

    const { body } = await performance(db, token)

    // 30 reps at an unknown weight is not a 30 kg best, and not a best at all.
    expect(body.variants[0].personalBest).toMatchObject({ loadValue: 50, result: 8 })
  })

  it('is chosen against, when an occurrence holds both kinds', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')

    await startSession(db, 'sub-a', '2026-08-03', 'monday', [{}])
    await completeWithoutLoad(db, '2026-08-03', 0, 0, 40)
    await resolveSet(db, 'sub-a', '2026-08-03', 'monday', 0, 1, {
      action: 'complete',
      result: 6,
      load: { value: 45, unit: 'kg' },
    })

    const { body } = await performance(db, token)

    expect(body.variants[0].points).toHaveLength(1)
    expect(body.variants[0].points[0]).toMatchObject({ loadValue: 45, result: 6 })
  })

  it('contributes no point when a whole occurrence recorded no load', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')

    await startSession(db, 'sub-a', '2026-08-03', 'monday', [{}])
    await resolveSet(db, 'sub-a', '2026-08-03', 'monday', 0, 0, {
      action: 'complete',
      result: 8,
      load: { value: 50, unit: 'kg' },
    })

    // A second workout where only reps were logged.
    await startSession(db, 'sub-a', '2026-08-10', 'monday', [{}])
    await completeWithoutLoad(db, '2026-08-10', 0, 0, 25)

    const { body } = await performance(db, token)

    // One point, from the workout that has a load. Every plotted point on a
    // loaded chart carries a real load.
    expect(body.variants[0].points).toHaveLength(1)
    expect(body.variants[0].points[0].date).toBe('2026-08-03')
    for (const point of body.variants[0].points) {
      expect(point.loadValue).not.toBeNull()
    }
  })

  it('publishes no loaded variant when nothing in it recorded a load', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')

    await startSession(db, 'sub-a', '2026-08-03', 'monday', [{}])
    await completeWithoutLoad(db, '2026-08-03', 0, 0, 12)
    await startSession(db, 'sub-a', '2026-08-10', 'monday', [{}])
    await completeWithoutLoad(db, '2026-08-10', 0, 0, 15)

    const { body } = await performance(db, token)

    // Real history, and no load fact anywhere in it. There is nothing to be
    // best at, so the variant does not appear - rather than appearing with rep
    // counts standing in for kilograms.
    expect(body.complete).toBe(true)
    expect(body.variants).toEqual([])
  })

  it('leaves an UNLOADED variant untouched by the same rule', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')

    await startSession(db, 'sub-a', '2026-08-03', 'monday', [
      { exerciseId: 'push-up', name: 'Push-Up', loadMode: 'none' },
    ])
    await resolveSet(db, 'sub-a', '2026-08-03', 'monday', 0, 0, {
      action: 'complete',
      result: 22,
      load: null,
    })

    const { body } = await performance(db, token)

    // A bodyweight exercise has no load by definition, and ranks on reps.
    expect(body.variants[0].personalBest).toMatchObject({ loadValue: null, result: 22 })
  })

  it('leaves a TIMED variant untouched by the same rule', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')

    await startSession(db, 'sub-a', '2026-08-03', 'monday', [
      { exerciseId: 'plank', name: 'Plank', resultKind: 'seconds', loadMode: 'none' },
    ])
    await resolveSet(db, 'sub-a', '2026-08-03', 'monday', 0, 0, {
      action: 'complete',
      result: 75,
      load: null,
    })

    const { body } = await performance(db, token)
    expect(body.variants[0].personalBest).toMatchObject({ result: 75 })
  })
})

/* ------------------------------------------------------------------ */
/* 5c. Same-date recency                                               */
/* ------------------------------------------------------------------ */

describe('5c. two workouts on one date', () => {
  it('sorts the variant performed later in the day first', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')

    // Alphabetically AAA would win; by real recency the evening one does.
    await startSession(
      db,
      'sub-a',
      '2026-08-03',
      'monday',
      [{ exerciseId: 'aaa-lift', name: 'AAA Lift' }],
      Date.parse('2026-08-03T07:00:00Z'),
    )
    await resolveSet(db, 'sub-a', '2026-08-03', 'monday', 0, 0, {
      action: 'complete',
      result: 10,
      load: { value: 40, unit: 'kg' },
    })

    await startSession(
      db,
      'sub-a',
      '2026-08-03',
      'wednesday',
      [{ exerciseId: 'zzz-lift', name: 'ZZZ Lift' }],
      Date.parse('2026-08-03T19:00:00Z'),
    )
    await resolveSet(db, 'sub-a', '2026-08-03', 'wednesday', 0, 0, {
      action: 'complete',
      result: 10,
      load: { value: 40, unit: 'kg' },
    })

    const { body } = await performance(db, token)

    expect(body.variants.map((variant) => variant.exerciseId)).toEqual([
      'zzz-lift',
      'aaa-lift',
    ])
  })

  it('never exposes the occurrence timestamps it ordered by', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')
    await startSession(db, 'sub-a', '2026-08-03', 'monday', [{}])
    await resolveSet(db, 'sub-a', '2026-08-03', 'monday', 0, 0, {
      action: 'complete',
      result: 10,
      load: { value: 50, unit: 'kg' },
    })

    const { body } = await performance(db, token)

    // The browser gets the ORDER, not the clock.
    expect(JSON.stringify(body)).not.toContain('startedAt')
    expect(JSON.stringify(body)).not.toContain('started_at')
  })
})

describe('6. no derived scores', () => {
  it('reports no estimated 1RM, tonnage or recommendation', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')
    await startSession(db, 'sub-a', '2026-08-03', 'monday', [{}])
    await resolveSet(db, 'sub-a', '2026-08-03', 'monday', 0, 0, {
      action: 'complete',
      result: 10,
      load: { value: 50, unit: 'kg' },
    })

    const { body } = await performance(db, token)
    const serialised = JSON.stringify(body)

    for (const invented of [
      'e1rm',
      '1rm',
      'estimated',
      'tonnage',
      'volume',
      'score',
      'suggest',
      'recommend',
      'next',
      'target',
    ]) {
      expect(serialised.toLowerCase(), invented).not.toContain(invented)
    }
  })

  it('reports a storage failure without leaking anything', async () => {
    const { db, breakProgress } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')
    breakProgress()

    const request = new Request(`${ORIGIN}/api/progress/performance`, {
      headers: { Cookie: `vshape_session=${token}` },
    })
    const response = await handleProgressRequest(request, makeEnv(db))

    expect(response?.status).toBe(500)
    expect(await response?.json()).toEqual({ error: 'server_error' })
  })
})
