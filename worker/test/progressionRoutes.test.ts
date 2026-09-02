import { describe, expect, it } from 'vitest'

import type { Env } from '../auth/config'
import { createD1SessionStore } from '../auth/d1Stores'
import { createSession } from '../auth/session'
import { handleProgressionRequest } from '../progression/routes'
import { handleWorkoutRequest } from '../workouts/routes'
import { createFakeD1 , type SeedProgramme } from './fakeD1'
import { startBody } from './programmeFixture'



/**
 * ROUND 22 — both weekday templates, as the account's one programme.
 *
 * Progression is judged against the prescription a Start FROZE, so these
 * suites still need Monday and Wednesday to differ. They differ in the
 * programme now instead of in two request bodies.
 */
const ORIGIN = 'https://vshapev2.nkmwei.de'
const BASE = `${ORIGIN}/api/progression`
const WORKOUTS = `${ORIGIN}/api/workouts`

const PROGRAMME = {
  revision: 1,
  exercises: [
    { exerciseId: 'lat-pulldown', name: 'Lat Pulldown' },
    { exerciseId: 'lateral-raise', name: 'Lateral Raise' },
  ],
  sessions: {
    monday: [
      {
        exerciseId: 'lat-pulldown',
        setCount: 4,
        targetMin: 10,
        targetMax: 15,
        equipment: 'BAND 20kg',
      },
    ],
    tuesday: [{ exerciseId: 'lat-pulldown', setCount: 4, targetMin: 10, targetMax: 15 }],
    wednesday: [{ exerciseId: 'lat-pulldown', setCount: 2, targetMin: 15, targetMax: 20 }],
    thursday: [{ exerciseId: 'lat-pulldown', setCount: 4, targetMin: 10, targetMax: 15 }],
    friday: [{ exerciseId: 'lateral-raise', setCount: 3, targetMin: 15, targetMax: 20 }],
  },
} satisfies SeedProgramme

const MONDAY_BODY = startBody(PROGRAMME.revision)
const WEDNESDAY_BODY = startBody(PROGRAMME.revision)


const FRIDAY_BODY = startBody(PROGRAMME.revision)

/**
 * THE AMBIGUOUS SHAPE, AS STORED DATA.
 *
 * A weekday listing one canonical exercise twice cannot be a PROGRAMME any
 * more: migration 0015 makes (account, weekday, exercise) the primary key and
 * `validateProgramme` refuses a duplicate outright. That is a real improvement
 * — the shape was never resolvable — but the server must still refuse to guess
 * when it MEETS one, because workouts started before Round 22 can hold it.
 *
 * So it is modelled where it can now exist: in the stored workout. Start a
 * two-exercise Monday, then rewrite the second exercise's rows into a duplicate
 * of the first, which is exactly what such a legacy occurrence looks like.
 */
const AMBIGUOUS_PROGRAMME = {
  ...PROGRAMME,
  sessions: {
    ...PROGRAMME.sessions,
    monday: [
      {
        exerciseId: 'lat-pulldown',
        setCount: 4,
        targetMin: 10,
        targetMax: 15,
        equipment: 'BAND 20kg',
      },
      {
        exerciseId: 'lateral-raise',
        setCount: 4,
        targetMin: 10,
        targetMax: 15,
        equipment: 'BAND 20kg',
      },
    ],
  },
} satisfies SeedProgramme

const AMBIGUOUS_BODY = startBody(PROGRAMME.revision)

/** Make the second exercise of a stored workout a duplicate of the first. */
function makeStoredWorkoutAmbiguous(
  fake: ReturnType<typeof createFakeD1>,
  workoutDate: string,
) {
  for (const [id, row] of fake.workoutSets) {
    if (row.workout_date === workoutDate && row.exercise_order === 1) {
      fake.workoutSets.set(id, {
        ...row,
        exercise_id_snapshot: 'lat-pulldown',
        exercise_name_snapshot: 'Lat Pulldown',
        prescription_snapshot: '4 × 10–15',
      })
    }
  }
}

function makeEnv(db: D1Database): Env {
  return { DB: db, ASSETS: {} as Fetcher, APP_ORIGIN: ORIGIN }
}

async function seedToken(db: D1Database, googleSub: string, email: string) {
  const created = await createSession(createD1SessionStore(db), {
    googleSub,
    email,
    trusted: true,
  })
  return created.token
}

type ReqOptions = {
  token?: string
  method?: string
  origin?: string
  path: string
  body?: unknown
  rawBody?: string
}

function build(base: string, options: ReqOptions): Request {
  const headers: Record<string, string> = {}
  if (options.token) headers.Cookie = `vshape_session=${options.token}`
  if (options.origin) headers.Origin = options.origin
  const payload =
    options.rawBody ?? (options.body === undefined ? undefined : JSON.stringify(options.body))
  if (payload !== undefined) headers['Content-Type'] = 'application/json'
  return new Request(`${base}/${options.path}`, {
    method: options.method ?? 'GET',
    headers,
    body: payload,
  })
}

async function call(db: D1Database, options: ReqOptions) {
  const response = await handleProgressionRequest(build(BASE, options), makeEnv(db))
  if (!response) throw new Error('handler did not claim the request')
  return { response, body: (await response.json()) as Record<string, never> }
}

async function workout(db: D1Database, options: ReqOptions) {
  const response = await handleWorkoutRequest(build(WORKOUTS, options), makeEnv(db))
  if (!response) throw new Error('workout handler did not claim the request')
  return { response, body: (await response.json()) as Record<string, never> }
}

/** Start a workout through the real API. */
async function start(db: D1Database, token: string, date: string, session: string, body: unknown) {
  return workout(db, {
    token,
    method: 'POST',
    origin: ORIGIN,
    path: `${date}/${session}/start`,
    body,
  })
}

/** Complete one set through the real API — the only way history is ever made. */
async function complete(
  db: D1Database,
  token: string,
  date: string,
  session: string,
  setIndex: number,
  entry: { result: number; load?: { value: number; unit: string } | null },
  exerciseOrder = 0,
) {
  return workout(db, {
    token,
    method: 'PUT',
    origin: ORIGIN,
    path: `${date}/${session}/sets/${exerciseOrder}/${setIndex}`,
    body: { action: 'complete', result: entry.result, load: entry.load ?? null },
  })
}

/** Record a whole Monday occurrence at one load. */
async function record(
  db: D1Database,
  token: string,
  date: string,
  load: number,
  results: number[],
) {
  await start(db, token, date, 'monday', MONDAY_BODY)
  for (const [setIndex, result] of results.entries()) {
    await complete(db, token, date, 'monday', setIndex, {
      result,
      load: { value: load, unit: 'kg' },
    })
  }
}

/** The stored sets of one workout, as the workout API returns them. */
async function workoutRead(db: D1Database, token: string, date: string, session: string) {
  const { body } = await workout(db, { token, path: `${date}/${session}` })
  return body.sets as unknown as {
    status: string
    result: number | null
    load: { value: number; unit: string } | null
  }[]
}

type Lane = {
  exerciseOrder: number
  exerciseId: string
  state: string
  reasonCode: string
  suggestedLoad: { value: number; unit: string } | null
  loadDirection: string | null
  calibration: {
    stage: string
    observedLoad: { value: number; unit: string } | null
    feedback: string | null
    chosenLoad: { value: number; unit: string } | null
  } | null
  lastResult: { date: string; results: number[] } | null
}

function lanes(body: Record<string, never>): Lane[] {
  return body.lanes as unknown as Lane[]
}

/* ------------------------------------------------------------------ */
/* Routing and identity                                                */
/* ------------------------------------------------------------------ */

describe('routing and identity', () => {
  it('ignores requests that are not progression requests', async () => {
    const fake = createFakeD1()
    const { db } = fake
    fake.seedProgrammeForAll(PROGRAMME)
    for (const url of [
      `${ORIGIN}/api/progress/performance`,
      `${ORIGIN}/api/progress/weight`,
      `${ORIGIN}/api/workouts/2026-08-31/monday`,
    ]) {
      expect(await handleProgressionRequest(new Request(url), makeEnv(db)), url).toBeNull()
    }
  })

  it('refuses an unauthenticated read', async () => {
    const fake = createFakeD1()
    const { db } = fake
    fake.seedProgrammeForAll(PROGRAMME)
    const { response, body } = await call(db, { path: '2026-08-31/monday' })
    expect(response.status).toBe(401)
    expect(body.error).toBe('unauthenticated')
  })

  it('refuses an unauthenticated calibration write', async () => {
    const fake = createFakeD1()
    const { db } = fake
    fake.seedProgrammeForAll(PROGRAMME)
    const { response } = await call(db, {
      method: 'PUT',
      origin: ORIGIN,
      path: '2026-08-31/monday/calibration/0',
      body: { feedback: 'good' },
    })
    expect(response.status).toBe(401)
  })

  it('rejects a cross-origin write', async () => {
    const fake = createFakeD1()
    const { db } = fake
    fake.seedProgrammeForAll(PROGRAMME)
    const token = await seedToken(db, 'sub-1', 'a@example.com')
    const { response } = await call(db, {
      token,
      method: 'PUT',
      origin: 'https://evil.example',
      path: '2026-08-31/monday/calibration/0',
      body: { feedback: 'good' },
    })
    expect(response.status).toBe(403)
  })

  it('rejects an unknown method and an unknown shape', async () => {
    const fake = createFakeD1()
    const { db } = fake
    fake.seedProgrammeForAll(PROGRAMME)
    const token = await seedToken(db, 'sub-1', 'a@example.com')

    expect(
      (await call(db, { token, method: 'POST', origin: ORIGIN, path: '2026-08-31/monday' }))
        .response.status,
    ).toBe(405)
    expect((await call(db, { token, path: '2026-08-31/monday/anything' })).response.status).toBe(
      404,
    )
  })

  it('rejects a malformed date, session or exercise order', async () => {
    const fake = createFakeD1()
    const { db } = fake
    fake.seedProgrammeForAll(PROGRAMME)
    const token = await seedToken(db, 'sub-1', 'a@example.com')

    expect((await call(db, { token, path: '2026-02-30/monday' })).body.error).toBe(
      'invalid_workout_date',
    )
    expect((await call(db, { token, path: '2026-08-31/Monday' })).body.error).toBe(
      'invalid_session_id',
    )
    expect(
      (
        await call(db, {
          token,
          method: 'PUT',
          origin: ORIGIN,
          path: '2026-08-31/monday/calibration/99',
          body: { feedback: 'good' },
        })
      ).body.error,
    ).toBe('invalid_exercise_order')
  })

  it('answers honestly when the workout has not been started', async () => {
    const fake = createFakeD1()
    const { db } = fake
    fake.seedProgrammeForAll(PROGRAMME)
    const token = await seedToken(db, 'sub-1', 'a@example.com')
    const { response, body } = await call(db, { token, path: '2026-08-31/monday' })

    expect(response.status).toBe(200)
    expect(body.started).toBe(false)
    expect(body.lanes).toEqual([])
  })

  it('never lets a payload choose the account', async () => {
    const fake = createFakeD1()
    const { db } = fake
    fake.seedProgrammeForAll(PROGRAMME)
    const mine = await seedToken(db, 'sub-mine', 'mine@example.com')
    const theirs = await seedToken(db, 'sub-theirs', 'theirs@example.com')

    await record(db, theirs, '2026-08-24', 20, [15, 15, 15, 15])
    await start(db, mine, '2026-08-31', 'monday', MONDAY_BODY)

    // A body naming the other account changes nothing: identity comes from the
    // session cookie and nowhere else.
    const { body } = await call(db, {
      token: mine,
      method: 'PUT',
      origin: ORIGIN,
      path: '2026-08-31/monday/calibration/0',
      body: { feedback: 'good', googleSub: 'sub-theirs' },
    })
    // Nothing has been completed yet, so calibration is refused outright.
    expect(body.error).toBe('no_completed_set')
  })
})

/* ------------------------------------------------------------------ */
/* 29 — account isolation                                              */
/* ------------------------------------------------------------------ */

describe('29. account isolation', () => {
  it('one account never derives guidance from another account’s history', async () => {
    const fake = createFakeD1()
    const { db } = fake
    fake.seedProgrammeForAll(PROGRAMME)
    const mine = await seedToken(db, 'sub-mine', 'mine@example.com')
    const theirs = await seedToken(db, 'sub-theirs', 'theirs@example.com')

    // They cleared the range; I have never trained this lane.
    await record(db, theirs, '2026-08-24', 20, [15, 15, 15, 15])
    await start(db, mine, '2026-08-31', 'monday', MONDAY_BODY)

    const mineLanes = lanes((await call(db, { token: mine, path: '2026-08-31/monday' })).body)
    expect(mineLanes[0].state).toBe('calibrate')
    expect(mineLanes[0].suggestedLoad).toBeNull()

    // And their own read is unaffected by mine.
    await start(db, theirs, '2026-08-31', 'monday', MONDAY_BODY)
    const theirLanes = lanes((await call(db, { token: theirs, path: '2026-08-31/monday' })).body)
    expect(theirLanes[0].state).toBe('increase_load')
  })

  it('one account cannot read or clear another account’s calibration', async () => {
    const fake = createFakeD1()
    const { db, calibrations } = fake
    fake.seedProgrammeForAll(PROGRAMME)
    const mine = await seedToken(db, 'sub-mine', 'mine@example.com')
    const theirs = await seedToken(db, 'sub-theirs', 'theirs@example.com')

    for (const token of [mine, theirs]) {
      await start(db, token, '2026-08-31', 'monday', MONDAY_BODY)
      await complete(db, token, '2026-08-31', 'monday', 0, {
        result: 12,
        load: { value: 20, unit: 'kg' },
      })
    }
    await call(db, {
      token: theirs,
      method: 'PUT',
      origin: ORIGIN,
      path: '2026-08-31/monday/calibration/0',
      body: { feedback: 'too_light', chosenLoad: { value: 25, unit: 'kg' } },
    })

    // My read of the same date and session sees nothing of theirs.
    const mineLanes = lanes((await call(db, { token: mine, path: '2026-08-31/monday' })).body)
    expect(mineLanes[0].calibration?.stage).toBe('awaiting_feedback')
    expect(mineLanes[0].suggestedLoad).toBeNull()

    // My delete cannot reach their row.
    await call(db, {
      token: mine,
      method: 'DELETE',
      origin: ORIGIN,
      path: '2026-08-31/monday/calibration/0',
    })
    expect(calibrations.size).toBe(1)
    const theirLanes = lanes((await call(db, { token: theirs, path: '2026-08-31/monday' })).body)
    expect(theirLanes[0].calibration?.chosenLoad).toEqual({ value: 25, unit: 'kg' })
  })
})

/* ------------------------------------------------------------------ */
/* 18 — session lane isolation, end to end                             */
/* ------------------------------------------------------------------ */

describe('18. session lanes stay separate', () => {
  it('Monday Lat Pulldown never draws on Wednesday Lat Pulldown', async () => {
    const fake = createFakeD1()
    const { db } = fake
    fake.seedProgrammeForAll(PROGRAMME)
    const token = await seedToken(db, 'sub-1', 'a@example.com')

    // Wednesday's Lat Pulldown cleared its own range at a light load.
    await start(db, token, '2026-08-26', 'wednesday', WEDNESDAY_BODY)
    for (const setIndex of [0, 1]) {
      await complete(db, token, '2026-08-26', 'wednesday', setIndex, {
        result: 20,
        load: { value: 12.5, unit: 'kg' },
      })
    }

    await start(db, token, '2026-08-31', 'monday', MONDAY_BODY)
    const mondayLanes = lanes((await call(db, { token, path: '2026-08-31/monday' })).body)

    // Same canonical exercise, different training work: Monday has no history.
    expect(mondayLanes[0].exerciseId).toBe('lat-pulldown')
    expect(mondayLanes[0].state).toBe('calibrate')
    expect(mondayLanes[0].suggestedLoad).toBeNull()
    expect(mondayLanes[0].lastResult).toBeNull()
  })

  it('Wednesday reads its own history, as LIGHT quality work', async () => {
    const fake = createFakeD1()
    const { db } = fake
    fake.seedProgrammeForAll(PROGRAMME)
    const token = await seedToken(db, 'sub-1', 'a@example.com')

    await start(db, token, '2026-08-26', 'wednesday', WEDNESDAY_BODY)
    for (const setIndex of [0, 1]) {
      await complete(db, token, '2026-08-26', 'wednesday', setIndex, {
        result: 20,
        load: { value: 12.5, unit: 'kg' },
      })
    }
    await record(db, token, '2026-08-24', 20, [15, 15, 15, 15])

    await start(db, token, '2026-09-02', 'wednesday', WEDNESDAY_BODY)
    const wednesdayLanes = lanes((await call(db, { token, path: '2026-09-02/wednesday' })).body)

    // LIGHT: quality, and the load repeated back is Wednesday's own 12.5kg —
    // never Monday's 20kg, and never an increase off a perfect session.
    expect(wednesdayLanes[0].state).toBe('quality')
    expect(wednesdayLanes[0].suggestedLoad).toEqual({ value: 12.5, unit: 'kg' })
    expect(wednesdayLanes[0].loadDirection).toBeNull()
  })
})

/* ------------------------------------------------------------------ */
/* Derivation from real recorded history                               */
/* ------------------------------------------------------------------ */

describe('derivation from recorded history', () => {
  it('today’s own occurrence is never its own evidence', async () => {
    const fake = createFakeD1()
    const { db } = fake
    fake.seedProgrammeForAll(PROGRAMME)
    const token = await seedToken(db, 'sub-1', 'a@example.com')

    // A perfect session logged TODAY must not tell today to add load.
    await record(db, token, '2026-08-31', 20, [15, 15, 15, 15])
    const today = lanes((await call(db, { token, path: '2026-08-31/monday' })).body)
    expect(today[0].state).toBe('calibrate')

    // The next occurrence reads it, because by then it is history.
    await start(db, token, '2026-09-07', 'monday', MONDAY_BODY)
    const next = lanes((await call(db, { token, path: '2026-09-07/monday' })).body)
    expect(next[0].state).toBe('increase_load')
    expect(next[0].loadDirection).toBe('increase')
    expect(next[0].suggestedLoad).toBeNull()
  })

  it('28. undoing a completed set recomputes the recommendation from truth', async () => {
    const fake = createFakeD1()
    const { db } = fake
    fake.seedProgrammeForAll(PROGRAMME)
    const token = await seedToken(db, 'sub-1', 'a@example.com')

    await record(db, token, '2026-08-31', 20, [15, 15, 15, 15])
    await start(db, token, '2026-09-07', 'monday', MONDAY_BODY)
    expect(lanes((await call(db, { token, path: '2026-09-07/monday' })).body)[0].state).toBe(
      'increase_load',
    )

    // Take back the last set of the recorded session.
    await workout(db, {
      token,
      method: 'DELETE',
      origin: ORIGIN,
      path: '2026-08-31/monday/sets/0/3',
    })

    const after = lanes((await call(db, { token, path: '2026-09-07/monday' })).body)
    expect(after[0].state).toBe('hold')
    expect(after[0].loadDirection).toBeNull()
  })

  it('28b. correcting a set downwards recomputes it too', async () => {
    const fake = createFakeD1()
    const { db } = fake
    fake.seedProgrammeForAll(PROGRAMME)
    const token = await seedToken(db, 'sub-1', 'a@example.com')

    await record(db, token, '2026-08-31', 20, [15, 15, 15, 15])
    await start(db, token, '2026-09-07', 'monday', MONDAY_BODY)

    await complete(db, token, '2026-08-31', 'monday', 3, {
      result: 12,
      load: { value: 20, unit: 'kg' },
    })

    const after = lanes((await call(db, { token, path: '2026-09-07/monday' })).body)
    expect(after[0].state).toBe('build_reps')
    expect(after[0].suggestedLoad).toEqual({ value: 20, unit: 'kg' })
  })

  it('a skipped set in the last session holds rather than progressing', async () => {
    const fake = createFakeD1()
    const { db } = fake
    fake.seedProgrammeForAll(PROGRAMME)
    const token = await seedToken(db, 'sub-1', 'a@example.com')

    await start(db, token, '2026-08-31', 'monday', MONDAY_BODY)
    for (const setIndex of [0, 1, 2]) {
      await complete(db, token, '2026-08-31', 'monday', setIndex, {
        result: 15,
        load: { value: 20, unit: 'kg' },
      })
    }
    await workout(db, {
      token,
      method: 'PUT',
      origin: ORIGIN,
      path: '2026-08-31/monday/sets/0/3',
      body: { action: 'skip' },
    })

    await start(db, token, '2026-09-07', 'monday', MONDAY_BODY)
    const next = lanes((await call(db, { token, path: '2026-09-07/monday' })).body)
    expect(next[0].state).toBe('hold')
  })

  it('11. reduces only after two consecutive weak sessions at the same load', async () => {
    const fake = createFakeD1()
    const { db } = fake
    fake.seedProgrammeForAll(PROGRAMME)
    const token = await seedToken(db, 'sub-1', 'a@example.com')

    await record(db, token, '2026-08-24', 20, [8, 8, 9, 8])
    await start(db, token, '2026-08-31', 'monday', MONDAY_BODY)
    expect(lanes((await call(db, { token, path: '2026-08-31/monday' })).body)[0].state).toBe(
      'hold',
    )

    await record(db, token, '2026-08-31', 20, [9, 8, 8, 9])
    await start(db, token, '2026-09-07', 'monday', MONDAY_BODY)
    const after = lanes((await call(db, { token, path: '2026-09-07/monday' })).body)
    expect(after[0].state).toBe('reduce_load')
    expect(after[0].loadDirection).toBe('reduce')
    expect(after[0].suggestedLoad).toBeNull()
  })
})

/* ------------------------------------------------------------------ */
/* 6, 7 — calibration persistence                                      */
/* ------------------------------------------------------------------ */

describe('6, 7. calibration persists across reload and resume', () => {
  async function calibrating() {
    const fake = createFakeD1()
    const { db, calibrations } = fake
    fake.seedProgrammeForAll(PROGRAMME)
    const token = await seedToken(db, 'sub-1', 'a@example.com')
    await start(db, token, '2026-08-31', 'monday', MONDAY_BODY)
    await complete(db, token, '2026-08-31', 'monday', 0, {
      result: 12,
      load: { value: 20, unit: 'kg' },
    })
    return { db, token, calibrations }
  }

  it('refuses a judgement before a first working set is completed', async () => {
    const fake = createFakeD1()
    const { db } = fake
    fake.seedProgrammeForAll(PROGRAMME)
    const token = await seedToken(db, 'sub-1', 'a@example.com')
    await start(db, token, '2026-08-31', 'monday', MONDAY_BODY)

    const { response, body } = await call(db, {
      token,
      method: 'PUT',
      origin: ORIGIN,
      path: '2026-08-31/monday/calibration/0',
      body: { feedback: 'too_light' },
    })
    expect(response.status).toBe(409)
    expect(body.error).toBe('no_completed_set')
  })

  it('6. a Good judgement survives a fresh read', async () => {
    const { db, token } = await calibrating()

    await call(db, {
      token,
      method: 'PUT',
      origin: ORIGIN,
      path: '2026-08-31/monday/calibration/0',
      body: { feedback: 'good' },
    })

    // A completely fresh read — this is what a reload does.
    const reloaded = lanes((await call(db, { token, path: '2026-08-31/monday' })).body)
    expect(reloaded[0].calibration).toMatchObject({
      stage: 'settled',
      feedback: 'good',
      observedLoad: { value: 20, unit: 'kg' },
    })
    expect(reloaded[0].suggestedLoad).toEqual({ value: 20, unit: 'kg' })
  })

  it('7. a load the user chose survives a fresh read', async () => {
    const { db, token } = await calibrating()

    await call(db, {
      token,
      method: 'PUT',
      origin: ORIGIN,
      path: '2026-08-31/monday/calibration/0',
      body: { feedback: 'too_light', chosenLoad: { value: 25, unit: 'kg' } },
    })

    const reloaded = lanes((await call(db, { token, path: '2026-08-31/monday' })).body)
    expect(reloaded[0].calibration?.chosenLoad).toEqual({ value: 25, unit: 'kg' })
    expect(reloaded[0].suggestedLoad).toEqual({ value: 25, unit: 'kg' })
    expect(reloaded[0].loadDirection).toBe('increase')
  })

  it('4b. Good + a foreign chosen load cannot change the recommendation', async () => {
    const { db, token, calibrations } = await calibrating()

    // A direct API call — no browser involved — asserting a different load
    // under "good". The number is dropped, not honoured.
    const { response, body } = await call(db, {
      token,
      method: 'PUT',
      origin: ORIGIN,
      path: '2026-08-31/monday/calibration/0',
      body: { feedback: 'good', chosenLoad: { value: 25, unit: 'kg' } },
    })
    expect(response.status).toBe(200)

    const lane = lanes(body)[0]
    expect(lane.calibration).toMatchObject({ feedback: 'good', chosenLoad: null })
    // The load actually lifted, and nothing else.
    expect(lane.suggestedLoad).toEqual({ value: 20, unit: 'kg' })
    expect(lane.loadDirection).toBeNull()

    // Nothing foreign reached storage either — the stored row itself.
    expect([...calibrations.values()][0]).toMatchObject({
      feedback: 'good',
      chosen_load_value: null,
      chosen_load_unit: null,
      observed_load_value: 20,
      observed_load_unit: 'kg',
    })

    // A fresh read says the same thing.
    const reloaded = lanes((await call(db, { token, path: '2026-08-31/monday' })).body)[0]
    expect(reloaded.suggestedLoad).toEqual({ value: 20, unit: 'kg' })
    expect(reloaded.calibration?.chosenLoad).toBeNull()

    // And the completed working set is exactly as it was performed.
    const workout = await workoutRead(db, token, '2026-08-31', 'monday')
    expect(workout[0]).toMatchObject({
      status: 'completed',
      result: 12,
      load: { value: 20, unit: 'kg' },
    })
  })

  it('4c. a foreign chosen load does not survive switching to Good', async () => {
    const { db, token } = await calibrating()

    await call(db, {
      token,
      method: 'PUT',
      origin: ORIGIN,
      path: '2026-08-31/monday/calibration/0',
      body: { feedback: 'too_light', chosenLoad: { value: 25, unit: 'kg' } },
    })
    const light = lanes((await call(db, { token, path: '2026-08-31/monday' })).body)[0]
    expect(light.suggestedLoad).toEqual({ value: 25, unit: 'kg' })

    await call(db, {
      token,
      method: 'PUT',
      origin: ORIGIN,
      path: '2026-08-31/monday/calibration/0',
      body: { feedback: 'good' },
    })
    const good = lanes((await call(db, { token, path: '2026-08-31/monday' })).body)[0]
    // Back to the load that was actually lifted; the earlier 25 is gone.
    expect(good.suggestedLoad).toEqual({ value: 20, unit: 'kg' })
    expect(good.calibration?.chosenLoad).toBeNull()
  })

  it('never rewrites the completed set the judgement was about', async () => {
    const { db, token } = await calibrating()

    await call(db, {
      token,
      method: 'PUT',
      origin: ORIGIN,
      path: '2026-08-31/monday/calibration/0',
      body: { feedback: 'too_light', chosenLoad: { value: 25, unit: 'kg' } },
    })

    const { body } = await workout(db, { token, path: '2026-08-31/monday' })
    const sets = body.sets as unknown as { load: { value: number } | null; result: number }[]
    // Still 12 reps at 20kg. A suggestion did not become what was performed.
    expect(sets[0]).toMatchObject({ result: 12, load: { value: 20, unit: 'kg' } })
  })

  it('a judgement is dropped when the set it described is undone', async () => {
    const { db, token } = await calibrating()

    await call(db, {
      token,
      method: 'PUT',
      origin: ORIGIN,
      path: '2026-08-31/monday/calibration/0',
      body: { feedback: 'good' },
    })
    await workout(db, {
      token,
      method: 'DELETE',
      origin: ORIGIN,
      path: '2026-08-31/monday/sets/0/0',
    })

    const after = lanes((await call(db, { token, path: '2026-08-31/monday' })).body)
    expect(after[0].calibration?.stage).toBe('awaiting_first_set')
    expect(after[0].suggestedLoad).toBeNull()
  })

  it('a judgement can be replaced, and cleared', async () => {
    const { db, token, calibrations } = await calibrating()

    for (const feedback of ['too_light', 'too_heavy', 'good']) {
      await call(db, {
        token,
        method: 'PUT',
        origin: ORIGIN,
        path: '2026-08-31/monday/calibration/0',
        body: { feedback },
      })
    }
    // One judgement per slot, replaced rather than duplicated.
    expect(calibrations.size).toBe(1)
    expect(
      lanes((await call(db, { token, path: '2026-08-31/monday' })).body)[0].calibration?.feedback,
    ).toBe('good')

    const cleared = await call(db, {
      token,
      method: 'DELETE',
      origin: ORIGIN,
      path: '2026-08-31/monday/calibration/0',
    })
    expect(calibrations.size).toBe(0)
    expect(lanes(cleared.body)[0].calibration?.stage).toBe('awaiting_feedback')
  })

  it('refuses a judgement on a lane that has comparable history', async () => {
    const fake = createFakeD1()
    const { db } = fake
    fake.seedProgrammeForAll(PROGRAMME)
    const token = await seedToken(db, 'sub-1', 'a@example.com')

    await record(db, token, '2026-08-24', 20, [12, 12, 11, 10])
    await start(db, token, '2026-08-31', 'monday', MONDAY_BODY)
    await complete(db, token, '2026-08-31', 'monday', 0, {
      result: 12,
      load: { value: 20, unit: 'kg' },
    })

    const { response, body } = await call(db, {
      token,
      method: 'PUT',
      origin: ORIGIN,
      path: '2026-08-31/monday/calibration/0',
      body: { feedback: 'too_light' },
    })
    expect(response.status).toBe(409)
    expect(body.error).toBe('not_calibrating')
  })

  it('refuses a chosen load in the wrong unit', async () => {
    const { db, token } = await calibrating()
    const { response, body } = await call(db, {
      token,
      method: 'PUT',
      origin: ORIGIN,
      path: '2026-08-31/monday/calibration/0',
      body: { feedback: 'too_light', chosenLoad: { value: 25, unit: 'kg_each' } },
    })
    // 25 in each hand is not 25 on a stack. Refused, not converted.
    expect(response.status).toBe(409)
    expect(body.error).toBe('load_unit_mismatch')
  })

  it('rejects a malformed judgement without storing anything', async () => {
    const { db, token, calibrations } = await calibrating()

    for (const body of [
      { feedback: 'felt-fine' },
      { feedback: 'good', chosenLoad: { value: -1, unit: 'kg' } },
      { feedback: 'good', chosenLoad: { value: 20, unit: 'lbs' } },
      [],
    ]) {
      const { response } = await call(db, {
        token,
        method: 'PUT',
        origin: ORIGIN,
        path: '2026-08-31/monday/calibration/0',
        body,
      })
      expect(response.status, JSON.stringify(body)).toBe(400)
    }
    expect(calibrations.size).toBe(0)
  })

  it('refuses a judgement for a slot the workout does not have', async () => {
    const { db, token } = await calibrating()
    const { response, body } = await call(db, {
      token,
      method: 'PUT',
      origin: ORIGIN,
      path: '2026-08-31/monday/calibration/3',
      body: { feedback: 'good' },
    })
    expect(response.status).toBe(404)
    expect(body.error).toBe('slot_not_found')
  })
})

/* ------------------------------------------------------------------ */
/* 20, 23 — ambiguity and PUMP, end to end                             */
/* ------------------------------------------------------------------ */

describe('20, 23. refusing to guess, and never chasing load', () => {
  it('20. two identical slots in one stored workout fail closed', async () => {
    const fake = createFakeD1()
    const { db } = fake
    fake.seedProgrammeForAll(PROGRAMME)
    const token = await seedToken(db, 'sub-1', 'a@example.com')

    // A clean, unambiguous history first, so the refusal is about the
    // ambiguity and not about a lack of evidence.
    await record(db, token, '2026-08-24', 20, [15, 15, 15, 15])
    fake.seedProgrammeForAll(AMBIGUOUS_PROGRAMME)
    await start(db, token, '2026-08-31', 'monday', AMBIGUOUS_BODY)
    makeStoredWorkoutAmbiguous(fake, '2026-08-31')

    const both = lanes((await call(db, { token, path: '2026-08-31/monday' })).body)
    expect(both).toHaveLength(2)
    for (const lane of both) {
      expect(lane.state).toBe('unavailable')
      expect(lane.reasonCode).toBe('ambiguous_slot')
      expect(lane.suggestedLoad).toBeNull()
      expect(lane.loadDirection).toBeNull()
    }
  })

  it('20b. an ambiguous stored HISTORY fails closed rather than picking a slot', async () => {
    const fake = createFakeD1()
    const { db } = fake
    fake.seedProgrammeForAll(PROGRAMME)
    const token = await seedToken(db, 'sub-1', 'a@example.com')

    fake.seedProgrammeForAll(AMBIGUOUS_PROGRAMME)
    await start(db, token, '2026-08-24', 'monday', AMBIGUOUS_BODY)
    makeStoredWorkoutAmbiguous(fake, '2026-08-24')
    for (const exerciseOrder of [0, 1]) {
      for (const setIndex of [0, 1, 2, 3]) {
        await complete(
          db,
          token,
          '2026-08-24',
          'monday',
          setIndex,
          { result: 15, load: { value: exerciseOrder === 0 ? 20 : 12.5, unit: 'kg' } },
          exerciseOrder,
        )
      }
    }

    await start(db, token, '2026-08-31', 'monday', MONDAY_BODY)
    const lane = lanes((await call(db, { token, path: '2026-08-31/monday' })).body)[0]
    expect(lane.state).toBe('unavailable')
    expect(lane.reasonCode).toBe('ambiguous_history')
    expect(lane.suggestedLoad).toBeNull()
  })

  it('3. a stored intensity with no ruleset fails closed, end to end', async () => {
    const fake = createFakeD1()
    const { db } = fake
    fake.seedProgrammeForAll(PROGRAMME)
    const token = await seedToken(db, 'sub-1', 'a@example.com')

    // A clean, unambiguous history, so the refusal is about the intensity and
    // nothing else.
    await record(db, token, '2026-08-24', 20, [15, 15, 15, 15])
    // ROUND 22. Intensity is no longer something a Start body can state — it
    // comes from the fixed Foundation metadata — so a snapshot naming no
    // ruleset can only be STORED data, written before that was true. Modelled
    // exactly that way: Start normally, then age the stored row.
    await start(db, token, '2026-08-31', 'monday', MONDAY_BODY)
    for (const [id, row] of fake.occurrences) {
      if (row.workout_date === '2026-08-31') {
        fake.occurrences.set(id, { ...row, session_intensity_snapshot: 'DELOAD' })
      }
    }

    const { body } = await call(db, { token, path: '2026-08-31/monday' })
    expect(body.intensity).toBe('DELOAD')
    // Not quietly absorbed into the gentler ruleset.
    expect(body.ruleset).toBeNull()

    const lane = lanes(body)[0]
    expect(lane.state).toBe('unavailable')
    expect(lane.reasonCode).toBe('unreadable_intensity')
    expect(lane.suggestedLoad).toBeNull()
    expect(lane.loadDirection).toBeNull()
    expect(lane.calibration).toBeNull()
  })

  it('3b. no calibration can be recorded against a session with no ruleset', async () => {
    const fake = createFakeD1()
    const { db, calibrations } = fake
    fake.seedProgrammeForAll(PROGRAMME)
    const token = await seedToken(db, 'sub-1', 'a@example.com')

    // As above: a no-ruleset intensity can only be stored data now.
    await start(db, token, '2026-08-31', 'monday', MONDAY_BODY)
    for (const [id, row] of fake.occurrences) {
      if (row.workout_date === '2026-08-31') {
        fake.occurrences.set(id, { ...row, session_intensity_snapshot: 'DELOAD' })
      }
    }
    await complete(db, token, '2026-08-31', 'monday', 0, {
      result: 12,
      load: { value: 20, unit: 'kg' },
    })

    const { response, body } = await call(db, {
      token,
      method: 'PUT',
      origin: ORIGIN,
      path: '2026-08-31/monday/calibration/0',
      body: { feedback: 'good' },
    })
    expect(response.status).toBe(409)
    expect(body.error).toBe('not_calibrating')
    expect(calibrations.size).toBe(0)
  })

  it('23. a PUMP session never increases, however perfect the last one was', async () => {
    const fake = createFakeD1()
    const { db } = fake
    fake.seedProgrammeForAll(PROGRAMME)
    const token = await seedToken(db, 'sub-1', 'a@example.com')

    await start(db, token, '2026-08-28', 'friday', FRIDAY_BODY)
    for (const setIndex of [0, 1, 2]) {
      await complete(db, token, '2026-08-28', 'friday', setIndex, {
        result: 20,
        load: { value: 7.5, unit: 'kg' },
      })
    }

    await start(db, token, '2026-09-04', 'friday', FRIDAY_BODY)
    const lane = lanes((await call(db, { token, path: '2026-09-04/friday' })).body)[0]
    expect(lane.state).toBe('quality')
    expect(lane.loadDirection).toBeNull()
    // Only the same load is repeated back.
    expect(lane.suggestedLoad).toEqual({ value: 7.5, unit: 'kg' })
  })
})

/* ------------------------------------------------------------------ */
/* 31, 32 — Holiday interaction                                        */
/* ------------------------------------------------------------------ */

describe('31, 32. Holiday interaction', () => {
  it('31. Training-On on a Holiday uses the underlying weekday lane', async () => {
    const fake = createFakeD1()
    const { db } = fake
    fake.seedProgrammeForAll(PROGRAMME)
    const token = await seedToken(db, 'sub-1', 'a@example.com')

    // An ordinary Monday, then a Monday that happens to fall in a Holiday the
    // user chose to keep training through. Holiday changes nothing about the
    // workout's identity: the same weekday session, so the same lane.
    await record(db, token, '2026-08-24', 20, [12, 12, 11, 10])
    await start(db, token, '2026-08-31', 'monday', MONDAY_BODY)

    const holidayLanes = lanes((await call(db, { token, path: '2026-08-31/monday' })).body)
    expect(holidayLanes[0].state).toBe('build_reps')
    expect(holidayLanes[0].suggestedLoad).toEqual({ value: 20, unit: 'kg' })
    // Not a separate "holiday lane": it reads the ordinary Monday history.
    expect(holidayLanes[0].lastResult?.date).toBe('2026-08-24')
  })

  it('32. Training-Off generates no progression evidence at all', async () => {
    const fake = createFakeD1()
    const { db } = fake
    fake.seedProgrammeForAll(PROGRAMME)
    const token = await seedToken(db, 'sub-1', 'a@example.com')

    // Training Off means no workout is started on that date, so there is no
    // occurrence and nothing for progression to read.
    await record(db, token, '2026-08-24', 20, [12, 12, 11, 10])

    const off = await call(db, { token, path: '2026-08-31/monday' })
    expect(off.body.started).toBe(false)
    expect(off.body.lanes).toEqual([])

    // And the next real Monday still reads the last REAL session, not a gap.
    await start(db, token, '2026-09-07', 'monday', MONDAY_BODY)
    const next = lanes((await call(db, { token, path: '2026-09-07/monday' })).body)
    expect(next[0].lastResult?.date).toBe('2026-08-24')
    expect(next[0].state).toBe('build_reps')
  })
})

/* ------------------------------------------------------------------ */
/* Storage failure                                                     */
/* ------------------------------------------------------------------ */

describe('storage failure', () => {
  it('reports a controlled error and never invents guidance', async () => {
    const fake = createFakeD1()
    const { db, breakWorkouts } = fake
    fake.seedProgrammeForAll(PROGRAMME)
    const token = await seedToken(db, 'sub-1', 'a@example.com')
    await start(db, token, '2026-08-31', 'monday', MONDAY_BODY)
    breakWorkouts()

    const { response, body } = await call(db, { token, path: '2026-08-31/monday' })
    expect(response.status).toBe(500)
    expect(body.error).toBe('server_error')
    expect(body.lanes).toBeUndefined()
  })
})
