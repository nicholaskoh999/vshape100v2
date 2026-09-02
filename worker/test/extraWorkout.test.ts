import { describe, expect, it } from 'vitest'

import type { Env } from '../auth/config'
import { createD1SessionStore } from '../auth/d1Stores'
import { createSession } from '../auth/session'
import { createD1ScheduleTruth } from '../notifications/truth'
import { handleProgressionRequest } from '../progression/routes'
import { handleProgressRequest } from '../progress/routes'
import { handleWorkoutRequest } from '../workouts/routes'
import { createFakeD1 } from './fakeD1'
import { programmeFromLegacyPlan, startBody } from './programmeFixture'

/**
 * Round 17 — Extra Workout, server side.
 *
 * Every workout here is written through the REAL workout API, so nothing can
 * prove a fact from history the app could not actually have stored. The
 * progression, performance and notification truths are then read through their
 * own real handlers, so the isolation claims are made end to end rather than
 * against a mock.
 *
 * The single invariant these tests exist to defend:
 *
 *     EXTRA OCCURRENCE != SCHEDULED OCCURRENCE
 *
 * even when both were built from the same Foundation template on the same day.
 */

const ORIGIN = 'https://vshapev2.nkmwei.de'
const WORKOUTS = `${ORIGIN}/api/workouts`
const DATE = '2026-09-02'
/** 2026-09-05 is a Saturday and 2026-09-06 a Sunday. */
const SATURDAY = '2026-09-05'
const SUNDAY = '2026-09-06'

const MONDAY_PLAN = {
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
    {
      exerciseId: 'one-arm-db-row',
      name: 'One-Arm DB Row',
      prescription: '3 × 8–12',
      equipment: 'DB + Bench Flat',
      resultKind: 'reps',
      loadMode: 'kg_each',
      perSide: false,
      setCount: 2,
    },
  ],
}

/**
 * ROUND 22 — the Monday template, established where the server reads it.
 *
 * This suite is about Extra PROVENANCE, not about who authors the plan. The
 * plan it has always used is now the account's programme, and the two Start
 * bodies below carry only a revision and (for the Extra) the weekday copied.
 */
const PROGRAMME = programmeFromLegacyPlan('monday', MONDAY_PLAN)

/** A scheduled Start. */
const MONDAY_BODY = startBody(PROGRAMME.revision)

/** The same template, addressed as an Extra: identical snapshot, plus source. */
const EXTRA_FROM_MONDAY = startBody(PROGRAMME.revision, 'monday')

function makeEnv(db: D1Database): Env {
  return { DB: db, ASSETS: {} as Fetcher, APP_ORIGIN: ORIGIN }
}

/** A session token AND this account's authoritative programme. */
async function seedToken(
  fake: ReturnType<typeof createFakeD1>,
  googleSub: string,
  email: string,
) {
  fake.seedProgramme(googleSub, PROGRAMME)
  const db = fake.db
  const { token } = await createSession(createD1SessionStore(db), {
    googleSub,
    email,
    trusted: true,
  })
  return token
}

type Call = {
  token?: string
  method?: string
  origin?: string
  body?: unknown
}

async function workouts(db: D1Database, path: string, options: Call = {}) {
  const headers: Record<string, string> = {}
  if (options.token) headers.Cookie = `vshape_session=${options.token}`
  if (options.origin) headers.Origin = options.origin
  const payload = options.body === undefined ? undefined : JSON.stringify(options.body)
  if (payload !== undefined) headers['Content-Type'] = 'application/json'

  const response = await handleWorkoutRequest(
    new Request(`${WORKOUTS}/${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: payload,
    }),
    makeEnv(db),
  )
  if (!response) throw new Error('handler did not claim the request')
  return { response, body: (await response.json()) as Record<string, never> }
}

/** Start a workout the ordinary way, under whichever session id is given. */
async function start(
  db: D1Database,
  token: string,
  session: string,
  body: unknown,
  date = DATE,
) {
  return workouts(db, `${date}/${session}/start`, {
    token,
    method: 'POST',
    origin: ORIGIN,
    body,
  })
}

async function completeSet(
  db: D1Database,
  token: string,
  session: string,
  exerciseOrder: number,
  setIndex: number,
  entry: { result: number; load?: { value: number; unit: string } | null },
  date = DATE,
) {
  return workouts(db, `${date}/${session}/sets/${exerciseOrder}/${setIndex}`, {
    token,
    method: 'PUT',
    origin: ORIGIN,
    body: { action: 'complete', result: entry.result, load: entry.load ?? null },
  })
}

async function progression(db: D1Database, token: string, path: string) {
  const response = await handleProgressionRequest(
    new Request(`${ORIGIN}/api/progression/${path}`, {
      headers: { Cookie: `vshape_session=${token}` },
    }),
    makeEnv(db),
  )
  if (!response) throw new Error('progression handler did not claim the request')
  return { response, body: (await response.json()) as Record<string, never> }
}

async function performance(db: D1Database, token: string) {
  const response = await handleProgressRequest(
    new Request(`${ORIGIN}/api/progress/performance`, {
      headers: { Cookie: `vshape_session=${token}` },
    }),
    makeEnv(db),
  )
  if (!response) throw new Error('progress handler did not claim the request')
  return (await response.json()) as Record<string, never>
}

/* ------------------------------------------------------------------ */
/* 1. Preview writes nothing                                           */
/* ------------------------------------------------------------------ */

describe('1. previewing an Extra creates nothing', () => {
  it('reads as not started, and leaves no occurrence behind', async () => {
    const fake = createFakeD1()
    const { db } = fake
    const token = await seedToken(fake, 'sub-1', 'a@example.com')

    // Reading the Extra slug is exactly what the page does while the user is
    // still choosing a template. It must not bring a workout into existence.
    const read = await workouts(db, `${DATE}/extra`, { token })
    expect(read.response.status).toBe(200)
    expect(read.body.occurrence).toBeNull()

    const history = await workouts(db, 'history', { token })
    expect(history.body.workouts).toHaveLength(0)
    expect((history.body.totals as { workouts: number }).workouts).toBe(0)
  })
})

/* ------------------------------------------------------------------ */
/* 2. Start snapshots the CURRENT template                             */
/* ------------------------------------------------------------------ */

describe('2. Start clones the selected Foundation session', () => {
  it('stores the template as it stands, with extra provenance', async () => {
    const fake = createFakeD1()
    const { db } = fake
    const token = await seedToken(fake, 'sub-1', 'a@example.com')

    const { response, body } = await start(db, token, 'extra', EXTRA_FROM_MONDAY)
    expect(response.status).toBe(201)

    const occurrence = body.occurrence as Record<string, unknown>
    expect(occurrence.sessionId).toBe('extra')
    // Provenance is persisted and returned, not inferred by the client.
    expect(occurrence.kind).toBe('extra')
    expect(occurrence.sourceSessionId).toBe('monday')
    // The header is a copy of the template's current content.
    expect(occurrence.day).toBe('Monday')
    expect(occurrence.focus).toBe('Back Width + Biceps')

    const sets = body.sets as { exerciseName: string; prescription: string }[]
    expect(sets).toHaveLength(4)
    expect(sets[0].exerciseName).toBe('Lat Pulldown')
    // Derived from the programme's structured slot, so the prescription and the
    // set count can no longer disagree the way the old free-text plan let them.
    expect(sets[0].prescription).toBe('2 × 10–15')
  })

  it('refuses an Extra that does not say what it was copied from', async () => {
    const fake = createFakeD1()
    const { db } = fake
    const token = await seedToken(fake, 'sub-1', 'a@example.com')

    const { response, body } = await start(db, token, 'extra', MONDAY_BODY)
    expect(response.status).toBe(400)
    expect(body.field).toBe('source_session_id')
  })

  it('refuses a scheduled workout that claims a source', async () => {
    const fake = createFakeD1()
    const { db } = fake
    const token = await seedToken(fake, 'sub-1', 'a@example.com')

    // A client must not be able to attach Extra-shaped provenance to a real
    // scheduled obligation.
    const { response, body } = await start(db, token, 'monday', {
      ...MONDAY_BODY,
      sourceSessionId: 'tuesday',
    })
    expect(response.status).toBe(400)
    expect(body.field).toBe('source_session_id')
  })

  it('refuses an Extra sourced from another Extra', async () => {
    const fake = createFakeD1()
    const { db } = fake
    const token = await seedToken(fake, 'sub-1', 'a@example.com')

    const { response } = await start(db, token, 'extra', {
      ...MONDAY_BODY,
      sourceSessionId: 'extra',
    })
    expect(response.status).toBe(400)
  })

  it('never lets a client declare its own kind', async () => {
    const fake = createFakeD1()
    const { db } = fake
    const token = await seedToken(fake, 'sub-1', 'a@example.com')

    // `kind` is not part of any accepted payload. Sending one changes nothing:
    // the stored value is derived from the routed session id.
    const { body } = await start(db, token, 'monday', {
      ...MONDAY_BODY,
      kind: 'extra',
    })
    expect((body.occurrence as { kind: string }).kind).toBe('scheduled')
  })
})

/* ------------------------------------------------------------------ */
/* 3. Scheduled and Extra coexist on one date                          */
/* ------------------------------------------------------------------ */

describe('3. a scheduled session and an Extra share a date without colliding', () => {
  it('keeps two separate occurrences, each with its own sets', async () => {
    const fake = createFakeD1()
    const { db } = fake
    const token = await seedToken(fake, 'sub-1', 'a@example.com')

    const scheduled = await start(db, token, 'monday', MONDAY_BODY)
    const extra = await start(db, token, 'extra', EXTRA_FROM_MONDAY)

    expect(scheduled.response.status).toBe(201)
    // 201 proves the Extra CREATED an occurrence rather than resuming Monday's.
    expect(extra.response.status).toBe(201)

    expect((scheduled.body.occurrence as { kind: string }).kind).toBe('scheduled')
    expect((extra.body.occurrence as { kind: string }).kind).toBe('extra')

    // Logging into one must not appear in the other.
    await completeSet(db, token, 'extra', 0, 0, { result: 12, load: { value: 30, unit: 'kg' } })

    const scheduledRead = await workouts(db, `${DATE}/monday`, { token })
    const extraRead = await workouts(db, `${DATE}/extra`, { token })

    expect((scheduledRead.body.progress as { completed: number }).completed).toBe(0)
    expect((extraRead.body.progress as { completed: number }).completed).toBe(1)

    const history = await workouts(db, 'history', { token })
    expect(history.body.workouts).toHaveLength(2)
    expect((history.body.totals as { workouts: number }).workouts).toBe(2)
  })
})

/* ------------------------------------------------------------------ */
/* 4. One Extra per date                                               */
/* ------------------------------------------------------------------ */

describe('4. a second Extra on the same date resumes the first', () => {
  it('never creates extra-2, even from a different template', async () => {
    const fake = createFakeD1()
    const { db } = fake
    const token = await seedToken(fake, 'sub-1', 'a@example.com')

    const first = await start(db, token, 'extra', EXTRA_FROM_MONDAY)
    expect(first.response.status).toBe(201)

    // A second entry, this time asking for Tuesday. The stored snapshot wins:
    // once started, the source template cannot be changed.
    const second = await start(db, token, 'extra', startBody(PROGRAMME.revision, 'tuesday'))

    // 200, not 201: this resumed.
    expect(second.response.status).toBe(200)
    expect(second.body.created).toBe(false)

    const occurrence = second.body.occurrence as Record<string, unknown>
    expect(occurrence.sourceSessionId).toBe('monday')
    expect(occurrence.focus).toBe('Back Width + Biceps')
    expect(second.body.sets).toHaveLength(4)

    const history = await workouts(db, 'history', { token })
    expect(history.body.workouts).toHaveLength(1)
  })
})

/* ------------------------------------------------------------------ */
/* 5. Weekend                                                          */
/* ------------------------------------------------------------------ */

describe('5. an Extra may be performed at the weekend', () => {
  it('records Saturday and Sunday Extras without inventing a scheduled one', async () => {
    const fake = createFakeD1()
    const { db } = fake
    const token = await seedToken(fake, 'sub-1', 'a@example.com')

    const saturday = await start(db, token, 'extra', EXTRA_FROM_MONDAY, SATURDAY)
    const sunday = await start(db, token, 'extra', EXTRA_FROM_MONDAY, SUNDAY)
    expect(saturday.response.status).toBe(201)
    expect(sunday.response.status).toBe(201)

    // Two Extras, on two different dates — the per-date key, not a per-week one.
    const history = await workouts(db, 'history', { token })
    const rows = history.body.workouts as { date: string; kind: string; sessionId: string }[]
    expect(rows).toHaveLength(2)
    expect(rows.every((row) => row.kind === 'extra')).toBe(true)
    // Crucially: no scheduled occurrence was conjured for the weekend.
    expect(rows.every((row) => row.sessionId === 'extra')).toBe(true)
  })
})

/* ------------------------------------------------------------------ */
/* 7. Holiday Training On — both occurrences exist                     */
/* ------------------------------------------------------------------ */

describe('7. a real scheduled workout and an Extra stay separate', () => {
  it('keeps them distinct even when both are built from Monday', async () => {
    const fake = createFakeD1()
    const { db } = fake
    const token = await seedToken(fake, 'sub-1', 'a@example.com')

    await start(db, token, 'monday', MONDAY_BODY)
    await start(db, token, 'extra', EXTRA_FROM_MONDAY)

    const history = await workouts(db, 'history', { token })
    const rows = history.body.workouts as { sessionId: string; kind: string }[]

    expect(rows.filter((row) => row.kind === 'scheduled')).toHaveLength(1)
    expect(rows.filter((row) => row.kind === 'extra')).toHaveLength(1)
    // Holiday preference itself lives in holiday_overrides and is not touched
    // by any workout write — there is no statement in this round that could.
  })
})

/* ------------------------------------------------------------------ */
/* 9. Notification isolation                                           */
/* ------------------------------------------------------------------ */

describe('9. completing an Extra does not suppress the scheduled reminder', () => {
  it('leaves the scheduled session reported as unfinished', async () => {
    const fake = createFakeD1()
    const { db } = fake
    const token = await seedToken(fake, 'sub-1', 'a@example.com')
    const truth = createD1ScheduleTruth(db)

    // Only the Extra exists, and it is finished end to end.
    await start(db, token, 'extra', EXTRA_FROM_MONDAY)
    await completeSet(db, token, 'extra', 0, 0, { result: 12, load: { value: 30, unit: 'kg' } })
    await completeSet(db, token, 'extra', 0, 1, { result: 12, load: { value: 30, unit: 'kg' } })
    await completeSet(db, token, 'extra', 1, 0, { result: 10, load: { value: 20, unit: 'kg_each' } })
    await completeSet(db, token, 'extra', 1, 1, { result: 10, load: { value: 20, unit: 'kg_each' } })

    const extraFinished = await workouts(db, `${DATE}/extra`, { token })
    expect((extraFinished.body.progress as { completed: number }).completed).toBe(4)

    // The sweep asks about the scheduled session. It must still say "not
    // finished", or the user loses the reminder for work they have not done.
    expect(await truth.workoutFinished('sub-1', DATE, 'monday')).toBe(false)
  })

  it('still suppresses the reminder for a genuinely finished scheduled workout', async () => {
    const fake = createFakeD1()
    const { db } = fake
    const token = await seedToken(fake, 'sub-1', 'a@example.com')
    const truth = createD1ScheduleTruth(db)

    await start(db, token, 'monday', MONDAY_BODY)
    await completeSet(db, token, 'monday', 0, 0, { result: 12, load: { value: 30, unit: 'kg' } })
    await completeSet(db, token, 'monday', 0, 1, { result: 12, load: { value: 30, unit: 'kg' } })
    await completeSet(db, token, 'monday', 1, 0, { result: 10, load: { value: 20, unit: 'kg_each' } })
    await completeSet(db, token, 'monday', 1, 1, { result: 10, load: { value: 20, unit: 'kg_each' } })

    // The accepted Round 14 behaviour is unchanged.
    expect(await truth.workoutFinished('sub-1', DATE, 'monday')).toBe(true)
  })
})

/* ------------------------------------------------------------------ */
/* 12. Recent workouts provenance                                      */
/* ------------------------------------------------------------------ */

describe('12. history reports an Extra as an Extra', () => {
  it('carries kind and source on every history row', async () => {
    const fake = createFakeD1()
    const { db } = fake
    const token = await seedToken(fake, 'sub-1', 'a@example.com')

    await start(db, token, 'monday', MONDAY_BODY)
    await start(db, token, 'extra', EXTRA_FROM_MONDAY)

    const history = await workouts(db, 'history', { token })
    const rows = history.body.workouts as {
      sessionId: string
      kind: string
      sourceSessionId: string | null
    }[]

    const extra = rows.find((row) => row.sessionId === 'extra')
    const scheduled = rows.find((row) => row.sessionId === 'monday')

    expect(extra?.kind).toBe('extra')
    expect(extra?.sourceSessionId).toBe('monday')
    expect(scheduled?.kind).toBe('scheduled')
    expect(scheduled?.sourceSessionId).toBeNull()
  })

  it('reports the same provenance on a range read', async () => {
    const fake = createFakeD1()
    const { db } = fake
    const token = await seedToken(fake, 'sub-1', 'a@example.com')

    await start(db, token, 'extra', EXTRA_FROM_MONDAY)

    const ranged = await workouts(db, `history?from=${DATE}&to=${DATE}`, { token })
    const rows = ranged.body.workouts as { kind: string }[]
    expect(rows).toHaveLength(1)
    expect(rows[0].kind).toBe('extra')
  })
})

/* ------------------------------------------------------------------ */
/* 13 + 14. PB and Exercise Performance                                */
/* ------------------------------------------------------------------ */

describe('13/14. a completed Extra set is factual performance history', () => {
  it('can become the personal best, keeping kg_each as per dumbbell', async () => {
    const fake = createFakeD1()
    const { db } = fake
    const token = await seedToken(fake, 'sub-1', 'a@example.com')

    await start(db, token, 'extra', EXTRA_FROM_MONDAY)
    // One-Arm DB Row is exercise_order 1 and is kg_each.
    await completeSet(db, token, 'extra', 1, 0, {
      result: 10,
      load: { value: 22.5, unit: 'kg_each' },
    })

    const read = await performance(db, token)
    expect(read.complete).toBe(true)

    const variants = read.variants as {
      exerciseId: string
      loadMode: string
      personalBest: { loadValue: number | null; result: number; sessionId: string } | null
    }[]
    const row = variants.find((variant) => variant.exerciseId === 'one-arm-db-row')

    expect(row).toBeDefined()
    // Extra work is real training: it counts as a fact about what was lifted.
    expect(row?.personalBest?.loadValue).toBe(22.5)
    expect(row?.personalBest?.result).toBe(10)
    // And the best is attributed to the occurrence it actually happened in.
    expect(row?.personalBest?.sessionId).toBe('extra')
    // "each" survives all the way out. It is never converted to a total.
    expect(row?.loadMode).toBe('kg_each')
  })

  it('contributes performance points alongside scheduled work', async () => {
    const fake = createFakeD1()
    const { db } = fake
    const token = await seedToken(fake, 'sub-1', 'a@example.com')

    await start(db, token, 'monday', MONDAY_BODY)
    await completeSet(db, token, 'monday', 0, 0, { result: 12, load: { value: 30, unit: 'kg' } })

    await start(db, token, 'extra', EXTRA_FROM_MONDAY)
    await completeSet(db, token, 'extra', 0, 0, { result: 12, load: { value: 35, unit: 'kg' } })

    const read = await performance(db, token)
    const variants = read.variants as {
      exerciseId: string
      points: { sessionId: string; loadValue: number | null }[]
      personalBest: { loadValue: number | null; sessionId: string } | null
    }[]
    const row = variants.find((variant) => variant.exerciseId === 'lat-pulldown')

    // Both sets are performance history: the scheduled one and the Extra one.
    expect(row?.points).toHaveLength(2)
    expect(row?.points.map((point) => point.sessionId).sort()).toEqual(['extra', 'monday'])
    // The heavier set was the Extra one, and it is honestly the best.
    expect(row?.personalBest?.loadValue).toBe(35)
    expect(row?.personalBest?.sessionId).toBe('extra')
  })
})

/* ------------------------------------------------------------------ */
/* 15. Round 16 progression exclusion                                  */
/* ------------------------------------------------------------------ */

describe('15. Extra history never enters the scheduled progression lanes', () => {
  it('leaves next Monday’s recommendation byte-identical', async () => {
    const earlier = '2026-08-31'
    const guided = '2026-09-07'

    /** Build an account, optionally with an Extra that mimics Monday exactly. */
    async function recommendation(withExtra: boolean) {
      const fake = createFakeD1()
      const { db } = fake
      const token = await seedToken(fake, 'sub-1', 'a@example.com')

      // A real, finished scheduled Monday — the legitimate evidence.
      await start(db, token, 'monday', MONDAY_BODY, earlier)
      await completeSet(db, token, 'monday', 0, 0, { result: 15, load: { value: 30, unit: 'kg' } }, earlier)
      await completeSet(db, token, 'monday', 0, 1, { result: 15, load: { value: 30, unit: 'kg' } }, earlier)
      await completeSet(db, token, 'monday', 1, 0, { result: 12, load: { value: 20, unit: 'kg_each' } }, earlier)
      await completeSet(db, token, 'monday', 1, 1, { result: 12, load: { value: 20, unit: 'kg_each' } }, earlier)

      if (withExtra) {
        // An Extra copied from Monday, on a later date, with heavier loads and
        // top-of-range reps — precisely the history that WOULD move a
        // recommendation if it were allowed to count.
        const extraDate = '2026-09-02'
        await start(db, token, 'extra', EXTRA_FROM_MONDAY, extraDate)
        await completeSet(db, token, 'extra', 0, 0, { result: 15, load: { value: 60, unit: 'kg' } }, extraDate)
        await completeSet(db, token, 'extra', 0, 1, { result: 15, load: { value: 60, unit: 'kg' } }, extraDate)
        await completeSet(db, token, 'extra', 1, 0, { result: 12, load: { value: 40, unit: 'kg_each' } }, extraDate)
        await completeSet(db, token, 'extra', 1, 1, { result: 12, load: { value: 40, unit: 'kg_each' } }, extraDate)
      }

      // The workout being guided.
      await start(db, token, 'monday', MONDAY_BODY, guided)
      const { body } = await progression(db, token, `${guided}/monday`)
      return body
    }

    const without = await recommendation(false)
    const with_ = await recommendation(true)

    // Semantic equality, and byte equality of the serialised answer. If the
    // Extra had leaked into the lanes, the suggested loads would have moved.
    expect(with_).toEqual(without)
    expect(JSON.stringify(with_)).toBe(JSON.stringify(without))
  })

  it('does not let an Extra become the lane’s earlier occurrence', async () => {
    const fake = createFakeD1()
    const { db } = fake
    const token = await seedToken(fake, 'sub-1', 'a@example.com')

    // ONLY an Extra exists before the guided Monday.
    await start(db, token, 'extra', EXTRA_FROM_MONDAY, '2026-09-02')
    await completeSet(db, token, 'extra', 0, 0, { result: 15, load: { value: 60, unit: 'kg' } }, '2026-09-02')

    await start(db, token, 'monday', MONDAY_BODY, '2026-09-07')
    const { body } = await progression(db, token, '2026-09-07/monday')

    const lanes = body.lanes as { state: string; suggestedLoad: unknown }[]
    // With no SCHEDULED history, every lane must still be asking rather than
    // recommending — the Extra is not comparable evidence.
    expect(lanes.length).toBeGreaterThan(0)
    for (const lane of lanes) {
      expect(lane.state).toBe('calibrate')
      expect(lane.suggestedLoad).toBeNull()
    }
  })
})

/* ------------------------------------------------------------------ */
/* 16. Progression is refused for an Extra                             */
/* ------------------------------------------------------------------ */

describe('16. the progression surface is unavailable for an Extra', () => {
  it('refuses the read rather than answering with an empty lane set', async () => {
    const fake = createFakeD1()
    const { db } = fake
    const token = await seedToken(fake, 'sub-1', 'a@example.com')

    await start(db, token, 'extra', EXTRA_FROM_MONDAY)

    const { response, body } = await progression(db, token, `${DATE}/extra`)
    expect(response.status).toBe(404)
    expect(body.error).toBe('progression_not_available')
    // An empty answer is still an answer a client could render controls around.
    expect(body.lanes).toBeUndefined()
  })

  it('refuses a calibration write against an Extra', async () => {
    const fake = createFakeD1()
    const { db } = fake
    const token = await seedToken(fake, 'sub-1', 'a@example.com')
    await start(db, token, 'extra', EXTRA_FROM_MONDAY)

    const response = await handleProgressionRequest(
      new Request(`${ORIGIN}/api/progression/${DATE}/extra/calibration/0`, {
        method: 'PUT',
        headers: {
          Cookie: `vshape_session=${token}`,
          Origin: ORIGIN,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ feedback: 'too_light', chosenLoad: null }),
      }),
      makeEnv(db),
    )
    expect(response?.status).toBe(404)
  })
})

/* ------------------------------------------------------------------ */
/* 17. The snapshot is frozen                                          */
/* ------------------------------------------------------------------ */

describe('17. a started Extra keeps the truth it was started with', () => {
  it('ignores a newer template on resume', async () => {
    const fake = createFakeD1()
    const { db } = fake
    const token = await seedToken(fake, 'sub-1', 'a@example.com')

    await start(db, token, 'extra', EXTRA_FROM_MONDAY)

    // The Foundation source changes — as a PROGRAMME edit, which is the only way
    // it can change now: new name, new prescription, new equipment, and a new
    // revision to go with them.
    fake.seedProgramme('sub-1', {
      revision: PROGRAMME.revision + 1,
      exercises: [
        { exerciseId: 'lat-pulldown', name: 'Lat Pulldown (wide)' },
        { exerciseId: 'one-arm-db-row', name: 'One-Arm DB Row' },
      ],
      sessions: {
        ...PROGRAMME.sessions,
        monday: [
          {
            exerciseId: 'lat-pulldown',
            setCount: 9,
            targetMin: 1,
            targetMax: 1,
            equipment: 'BAND 99kg',
          },
        ],
      },
    })

    await start(db, token, 'extra', startBody(PROGRAMME.revision + 1, 'monday'))

    const read = await workouts(db, `${DATE}/extra`, { token })
    const sets = read.body.sets as {
      exerciseName: string
      prescription: string
      equipment: string | null
    }[]

    // What was performed is what is returned.
    expect(sets).toHaveLength(4)
    expect(sets[0].exerciseName).toBe('Lat Pulldown')
    // Derived from the programme's structured slot, so the prescription and the
    // set count can no longer disagree the way the old free-text plan let them.
    expect(sets[0].prescription).toBe('2 × 10–15')
    expect(sets[0].equipment).toBe('BAND 20kg')
  })
})

/* ------------------------------------------------------------------ */
/* 18 + 19. Set behaviour and load semantics inside an Extra           */
/* ------------------------------------------------------------------ */

describe('18/19. Complete, Skip and Undo behave exactly as they do elsewhere', () => {
  it('completes, skips and undoes, keeping kg_each per dumbbell', async () => {
    const fake = createFakeD1()
    const { db } = fake
    const token = await seedToken(fake, 'sub-1', 'a@example.com')
    await start(db, token, 'extra', EXTRA_FROM_MONDAY)

    const completed = await completeSet(db, token, 'extra', 1, 0, {
      result: 10,
      load: { value: 20, unit: 'kg_each' },
    })
    expect((completed.body.set as { status: string }).status).toBe('completed')
    expect((completed.body.set as { load: unknown }).load).toEqual({
      value: 20,
      unit: 'kg_each',
    })

    const skipped = await workouts(db, `${DATE}/extra/sets/1/1`, {
      token,
      method: 'PUT',
      origin: ORIGIN,
      body: { action: 'skip' },
    })
    expect((skipped.body.set as { status: string }).status).toBe('skipped')
    // A skip records no result and no load; it is not a quiet completion.
    expect((skipped.body.set as { result: unknown }).result).toBeNull()

    const undone = await workouts(db, `${DATE}/extra/sets/1/0`, {
      token,
      method: 'DELETE',
      origin: ORIGIN,
    })
    expect((undone.body.set as { status: string }).status).toBe('pending')
    expect((undone.body.set as { load: unknown }).load).toBeNull()
  })

  it('refuses a kg load against a kg_each set inside an Extra', async () => {
    const fake = createFakeD1()
    const { db } = fake
    const token = await seedToken(fake, 'sub-1', 'a@example.com')
    await start(db, token, 'extra', EXTRA_FROM_MONDAY)

    const { response, body } = await completeSet(db, token, 'extra', 1, 0, {
      result: 10,
      load: { value: 20, unit: 'kg' },
    })
    expect(response.status).toBe(400)
    expect(body.error).toBe('load_unit_mismatch')
  })
})

/* ------------------------------------------------------------------ */
/* 20 + 21. Account isolation and HTTP safety                          */
/* ------------------------------------------------------------------ */

describe('20/21. an Extra is account-scoped and write-guarded', () => {
  it('gives two accounts their own Extra on the same date', async () => {
    const fake = createFakeD1()
    const { db } = fake
    const alice = await seedToken(fake, 'sub-alice', 'alice@example.com')
    const bob = await seedToken(fake, 'sub-bob', 'bob@example.com')

    const hers = await start(db, alice, 'extra', EXTRA_FROM_MONDAY)
    const his = await start(db, bob, 'extra', {
      ...EXTRA_FROM_MONDAY,
      sourceSessionId: 'tuesday',
      focus: 'Upper Chest + Shoulders + Triceps',
    })

    // Both CREATED one: neither collided with the other.
    expect(hers.response.status).toBe(201)
    expect(his.response.status).toBe(201)

    await completeSet(db, alice, 'extra', 0, 0, { result: 12, load: { value: 30, unit: 'kg' } })

    const bobsRead = await workouts(db, `${DATE}/extra`, { token: bob })
    expect((bobsRead.body.progress as { completed: number }).completed).toBe(0)
    expect((bobsRead.body.occurrence as { sourceSessionId: string }).sourceSessionId).toBe(
      'tuesday',
    )

    const bobsHistory = await workouts(db, 'history', { token: bob })
    expect(bobsHistory.body.workouts).toHaveLength(1)
  })

  it('refuses an unauthenticated Extra start', async () => {
    const fake = createFakeD1()
    const { db } = fake
    const { response } = await workouts(db, `${DATE}/extra/start`, {
      method: 'POST',
      origin: ORIGIN,
      body: EXTRA_FROM_MONDAY,
    })
    expect(response.status).toBe(401)
  })

  it('refuses a cross-origin Extra start', async () => {
    const fake = createFakeD1()
    const { db } = fake
    const token = await seedToken(fake, 'sub-1', 'a@example.com')

    const { response } = await workouts(db, `${DATE}/extra/start`, {
      token,
      method: 'POST',
      origin: 'https://evil.example',
      body: EXTRA_FROM_MONDAY,
    })
    expect(response.status).toBe(403)
  })

  it('ignores an identity supplied in the body', async () => {
    const fake = createFakeD1()
    const { db } = fake
    const alice = await seedToken(fake, 'sub-alice', 'alice@example.com')
    await seedToken(fake, 'sub-bob', 'bob@example.com')

    // A googleSub in the payload is not part of any accepted shape.
    await start(db, alice, 'extra', { ...EXTRA_FROM_MONDAY, googleSub: 'sub-bob' })

    const bobsHistory = await workouts(db, 'history', {
      token: await seedToken(fake, 'sub-bob', 'bob@example.com'),
    })
    expect(bobsHistory.body.workouts).toHaveLength(0)
  })
})
