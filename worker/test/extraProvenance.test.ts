import { describe, expect, it } from 'vitest'

import type { Env } from '../auth/config'
import { createD1SessionStore } from '../auth/d1Stores'
import { createSession } from '../auth/session'
import { createD1ScheduleTruth } from '../notifications/truth'
import { handleProgressRequest } from '../progress/routes'
import { handleWorkoutRequest } from '../workouts/routes'
import { createFakeD1 } from './fakeD1'

/**
 * Round 17 correction 1, finding 3 — persisted provenance FAILS CLOSED.
 *
 * Migration 0010 cannot attach a CHECK constraint to `kind`, so the vocabulary
 * is enforced on read. The tempting shape for that is "anything I do not
 * recognise is scheduled", and it is the dangerous one: `scheduled` is the most
 * privileged status in the app. It can satisfy a training day, extend a streak,
 * unlock an achievement and suppress a reminder.
 *
 * Legacy rows do not need the guess. 0010's DEFAULT gives every pre-Round-17
 * row `kind = 'scheduled'` as part of the migration, so anything still
 * unreadable afterwards is corrupt rather than old.
 *
 * These tests write corrupt and self-contradictory rows straight into the
 * store — which is the only way they could ever arise — and prove the reads
 * refuse them.
 */

const ORIGIN = 'https://vshapev2.nkmwei.de'
const DATE = '2026-09-07'

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

/**
 * The fake store's own primary-key separator.
 *
 * It has to match exactly. A lookalike would seed rows that `findOccurrence`
 * could never retrieve, and every refusal test below would then pass because
 * the row was invisible rather than because it was refused.
 */
const SEP = String.fromCharCode(0)

type Corrupt = {
  session_id: string
  kind: string | null
  source_session_id: string | null
}

/**
 * Put one occurrence into the store directly, with whatever provenance the
 * case needs. Its sets are written the same way, so the workout is otherwise
 * completely ordinary — the provenance columns are the only thing wrong.
 */
function seedOccurrence(fake: ReturnType<typeof createFakeD1>, row: Corrupt) {
  const id = ['sub-1', DATE, row.session_id].join(SEP)
  fake.occurrences.set(id, {
    google_sub: 'sub-1',
    workout_date: DATE,
    session_id: row.session_id,
    snapshot_id: 'token-1',
    kind: row.kind as string,
    source_session_id: row.source_session_id,
    session_day_snapshot: 'Monday',
    session_focus_snapshot: 'Back Width + Biceps',
    session_intensity_snapshot: 'HARD',
    started_at: 1,
    updated_at: 2,
  })

  fake.workoutSets.set(['sub-1', DATE, row.session_id, 0, 0].join(SEP), {
    google_sub: 'sub-1',
    workout_date: DATE,
    session_id: row.session_id,
    snapshot_id: 'token-1',
    exercise_order: 0,
    set_index: 0,
    exercise_id_snapshot: 'lat-pulldown',
    exercise_name_snapshot: 'Lat Pulldown',
    prescription_snapshot: '4 × 10–15',
    equipment_snapshot: 'BAND 20kg',
    result_kind_snapshot: 'reps',
    load_mode_snapshot: 'kg',
    per_side_snapshot: 0,
    // Completed, so nothing but provenance could stop this qualifying.
    status: 'completed',
    actual_load_value: 30,
    actual_load_unit: 'kg',
    actual_result: 12,
    updated_at: 3,
  })
}

async function readWorkoutRoute(db: D1Database, token: string, path: string) {
  const response = await handleWorkoutRequest(
    new Request(`${ORIGIN}/api/workouts/${path}`, {
      headers: { Cookie: `vshape_session=${token}` },
    }),
    makeEnv(db),
  )
  if (!response) throw new Error('handler did not claim the request')
  return { response, body: (await response.json()) as Record<string, never> }
}

/** Every provenance a stored row must be refused for. */
const UNREADABLE: { name: string; row: Corrupt }[] = [
  {
    name: 'an unknown kind',
    row: { session_id: 'monday', kind: 'something-else', source_session_id: null },
  },
  {
    name: 'a missing kind',
    row: { session_id: 'monday', kind: null, source_session_id: null },
  },
  {
    name: 'an empty kind',
    row: { session_id: 'monday', kind: '', source_session_id: null },
  },
  {
    name: 'a future kind nobody has taught this build about',
    row: { session_id: 'monday', kind: 'superset', source_session_id: null },
  },
  {
    name: 'scheduled carrying a source session',
    row: { session_id: 'monday', kind: 'scheduled', source_session_id: 'tuesday' },
  },
  {
    name: 'extra carrying no source session',
    row: { session_id: 'extra', kind: 'extra', source_session_id: null },
  },
  {
    name: 'extra sourced from extra',
    row: { session_id: 'extra', kind: 'extra', source_session_id: 'extra' },
  },
  {
    name: 'extra whose source is not a slug at all',
    row: { session_id: 'extra', kind: 'extra', source_session_id: 'Not A Slug!' },
  },
]

/* ------------------------------------------------------------------ */
/* 3 + 4 + 5. The reminder, and the two contradictions                 */
/* ------------------------------------------------------------------ */

describe('unreadable provenance never suppresses a scheduled reminder', () => {
  for (const { name, row } of UNREADABLE.filter((entry) => entry.row.session_id === 'monday')) {
    it(`answers "not finished" for ${name}`, async () => {
      const fake = createFakeD1()
      seedOccurrence(fake, row)
      const truth = createD1ScheduleTruth(fake.db)

      // The workout is complete in every respect except that we cannot read
      // what it WAS. It must not be allowed to say "already done".
      const finished = await truth.workoutFinished('sub-1', DATE, 'monday')

      // Deliberately `false`, not `null`. Null withholds the whole
      // notification, and withholding is what costs the user the training day
      // this reminder exists to protect. False sends the reminder.
      expect(finished).toBe(false)
    })
  }

  it('still reports a genuinely finished scheduled workout as finished', async () => {
    const fake = createFakeD1()
    seedOccurrence(fake, {
      session_id: 'monday',
      kind: 'scheduled',
      source_session_id: null,
    })
    const truth = createD1ScheduleTruth(fake.db)

    // The accepted Round 14 behaviour is untouched by any of this.
    expect(await truth.workoutFinished('sub-1', DATE, 'monday')).toBe(true)
  })

  it('still returns null — withhold — for a real storage failure', async () => {
    const fake = createFakeD1()
    seedOccurrence(fake, {
      session_id: 'monday',
      kind: 'scheduled',
      source_session_id: null,
    })
    fake.breakWorkouts(new Error('d1 down'))
    const truth = createD1ScheduleTruth(fake.db)

    // A failed read has not earned the right to say "not finished" either.
    // The two failure modes stay distinct.
    expect(await truth.workoutFinished('sub-1', DATE, 'monday')).toBeNull()
  })
})

/* ------------------------------------------------------------------ */
/* The workout read refuses rather than inventing                      */
/* ------------------------------------------------------------------ */

describe('the workout API refuses an unreadable occurrence', () => {
  for (const { name, row } of UNREADABLE) {
    it(`returns a controlled error for ${name}`, async () => {
      const fake = createFakeD1()
      seedOccurrence(fake, row)
      const token = await seedToken(fake.db, 'sub-1', 'a@example.com')

      const { response, body } = await readWorkoutRoute(
        fake.db,
        token,
        `${DATE}/${row.session_id}`,
      )

      // NOT 200-with-a-guess, and NOT "occurrence: null" — which would read as
      // "not started" and offer to Start a workout that already exists.
      expect(response.status).toBe(500)
      expect(body.error).toBe('server_error')
      expect(body.occurrence).toBeUndefined()
    })
  }

  it('reads an ordinary scheduled workout normally', async () => {
    const fake = createFakeD1()
    seedOccurrence(fake, { session_id: 'monday', kind: 'scheduled', source_session_id: null })
    const token = await seedToken(fake.db, 'sub-1', 'a@example.com')

    const { response, body } = await readWorkoutRoute(fake.db, token, `${DATE}/monday`)
    expect(response.status).toBe(200)
    expect((body.occurrence as { kind: string }).kind).toBe('scheduled')
  })

  it('reads an ordinary Extra normally', async () => {
    const fake = createFakeD1()
    seedOccurrence(fake, { session_id: 'extra', kind: 'extra', source_session_id: 'monday' })
    const token = await seedToken(fake.db, 'sub-1', 'a@example.com')

    const { response, body } = await readWorkoutRoute(fake.db, token, `${DATE}/extra`)
    expect(response.status).toBe(200)
    expect((body.occurrence as { kind: string }).kind).toBe('extra')
    expect((body.occurrence as { sourceSessionId: string }).sourceSessionId).toBe('monday')
  })
})

/* ------------------------------------------------------------------ */
/* History marks rather than hides — and never says "scheduled"        */
/* ------------------------------------------------------------------ */

describe('history reports unreadable provenance as unknown, never as scheduled', () => {
  it('carries kind null so no consumer can count it as an obligation', async () => {
    const fake = createFakeD1()
    seedOccurrence(fake, {
      session_id: 'monday',
      kind: 'who-knows',
      source_session_id: null,
    })
    const token = await seedToken(fake.db, 'sub-1', 'a@example.com')

    const { response, body } = await readWorkoutRoute(fake.db, token, 'history')
    expect(response.status).toBe(200)

    const rows = body.workouts as { sessionId: string; kind: unknown }[]
    // The row survives: the sets are real training and hiding them would be its
    // own kind of lie.
    expect(rows).toHaveLength(1)
    // But it is explicitly unknown, not quietly scheduled.
    expect(rows[0].kind).toBeNull()
  })

  it('drops the source too when the pair contradicts itself', async () => {
    const fake = createFakeD1()
    seedOccurrence(fake, {
      session_id: 'monday',
      kind: 'scheduled',
      source_session_id: 'tuesday',
    })
    const token = await seedToken(fake.db, 'sub-1', 'a@example.com')

    const { body } = await readWorkoutRoute(fake.db, token, 'history')
    const rows = body.workouts as { kind: unknown; sourceSessionId: unknown }[]
    expect(rows[0].kind).toBeNull()
    // Neither half of a contradiction is preferred over the other.
    expect(rows[0].sourceSessionId).toBeNull()
  })

  it('still reports valid scheduled and extra rows exactly as before', async () => {
    const fake = createFakeD1()
    seedOccurrence(fake, { session_id: 'monday', kind: 'scheduled', source_session_id: null })
    seedOccurrence(fake, { session_id: 'extra', kind: 'extra', source_session_id: 'monday' })
    const token = await seedToken(fake.db, 'sub-1', 'a@example.com')

    const { body } = await readWorkoutRoute(fake.db, token, 'history')
    const rows = body.workouts as { sessionId: string; kind: string; sourceSessionId: string | null }[]

    expect(rows.find((row) => row.sessionId === 'monday')?.kind).toBe('scheduled')
    expect(rows.find((row) => row.sessionId === 'extra')?.kind).toBe('extra')
    expect(rows.find((row) => row.sessionId === 'extra')?.sourceSessionId).toBe('monday')
  })
})

/* ------------------------------------------------------------------ */
/* 8. Factual performance is unaffected                                */
/* ------------------------------------------------------------------ */

describe('valid Extra work still reaches PB and Exercise Performance', () => {
  it('counts a completed Extra set as factual history', async () => {
    const fake = createFakeD1()
    seedOccurrence(fake, { session_id: 'extra', kind: 'extra', source_session_id: 'monday' })
    const token = await seedToken(fake.db, 'sub-1', 'a@example.com')

    const response = await handleProgressRequest(
      new Request(`${ORIGIN}/api/progress/performance`, {
        headers: { Cookie: `vshape_session=${token}` },
      }),
      makeEnv(fake.db),
    )
    const body = (await response!.json()) as Record<string, never>

    expect(body.complete).toBe(true)
    const variants = body.variants as {
      exerciseId: string
      personalBest: { loadValue: number; sessionId: string } | null
    }[]
    const row = variants.find((variant) => variant.exerciseId === 'lat-pulldown')

    // Performance reads completed SETS, which are facts about what was lifted.
    // Provenance decides what a workout counts as, not whether it happened.
    expect(row?.personalBest?.loadValue).toBe(30)
    expect(row?.personalBest?.sessionId).toBe('extra')
  })
})
