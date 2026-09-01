import { describe, expect, it } from 'vitest'

import type { Env } from '../auth/config'
import { createD1SessionStore } from '../auth/d1Stores'
import { createSession } from '../auth/session'
import { handleProgressionRequest } from '../progression/routes'
import { handleWorkoutRequest } from '../workouts/routes'
import { createFakeD1 } from './fakeD1'

/**
 * Round 17 correction 2 — progression admits only WHOLE scheduled provenance.
 *
 * Correction 1 made provenance a pair, and made a contradictory pair as
 * unreadable as an unknown kind: `readProvenance` refuses `kind = 'scheduled'`
 * carrying a `source_session_id` just as firmly as it refuses `kind = 'weird'`.
 *
 * The progression store cannot call that reader — it is raw SQL — and it was
 * filtering on `kind = 'scheduled'` alone. So a row like
 *
 *     session_id = 'monday', kind = 'scheduled', source_session_id = 'tuesday'
 *
 * was refused everywhere else in the app and admitted here, into the one place
 * that decides what the user is told to lift next.
 *
 * HOW THESE TESTS AVOID BEING VACUOUS.
 *
 * Every occurrence below is created through the REAL workout API, so its
 * primary key, its ownership token and its set rows are written by the same
 * code production uses. Only afterwards is a single provenance column flipped.
 * A corrupt row therefore cannot be "excluded" merely because it was seeded
 * under a key nothing could find.
 *
 * The control case proves it positively: the SAME occurrence, left valid,
 * DOES move the recommendation. If the corrupted variant leaves the answer
 * unchanged while the valid variant changes it, the row was reachable and was
 * genuinely refused on its provenance.
 */

const ORIGIN = 'https://vshapev2.nkmwei.de'
const WORKOUTS = `${ORIGIN}/api/workouts`

/** Mondays. The middle one carries the evidence under test. */
const EARLIER = '2026-08-31'
const MIDDLE = '2026-09-07'
const GUIDED = '2026-09-14'

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

const EXTRA_FROM_MONDAY = { ...MONDAY_BODY, sourceSessionId: 'monday' }

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

async function workouts(
  db: D1Database,
  path: string,
  options: { token?: string; method?: string; body?: unknown } = {},
) {
  const headers: Record<string, string> = {}
  if (options.token) headers.Cookie = `vshape_session=${options.token}`
  const payload = options.body === undefined ? undefined : JSON.stringify(options.body)
  if (payload !== undefined) {
    headers['Content-Type'] = 'application/json'
    headers.Origin = ORIGIN
  }

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

/** Start a workout through the real API. */
async function start(db: D1Database, token: string, date: string, session: string, body: unknown) {
  return workouts(db, `${date}/${session}/start`, { token, method: 'POST', body })
}

/** Complete a set through the real API. */
async function completeSet(
  db: D1Database,
  token: string,
  date: string,
  session: string,
  setIndex: number,
  load: number,
  result: number,
) {
  return workouts(db, `${date}/${session}/sets/0/${setIndex}`, {
    token,
    method: 'PUT',
    body: { action: 'complete', result, load: { value: load, unit: 'kg' } },
  })
}

async function progression(db: D1Database, token: string, date: string, session: string) {
  const response = await handleProgressionRequest(
    new Request(`${ORIGIN}/api/progression/${date}/${session}`, {
      headers: { Cookie: `vshape_session=${token}` },
    }),
    makeEnv(db),
  )
  if (!response) throw new Error('progression handler did not claim the request')
  return { response, body: (await response.json()) as Record<string, never> }
}

/** The one occurrence row matching a date + session, as the fake stores it. */
function occurrenceRow(fake: ReturnType<typeof createFakeD1>, date: string, session: string) {
  const row = [...fake.occurrences.values()].find(
    (candidate) => candidate.workout_date === date && candidate.session_id === session,
  )
  if (!row) throw new Error(`no occurrence for ${date}/${session}`)
  return row
}

/**
 * What the middle Monday should look like: heavy, top-of-range, and therefore
 * strong enough to move a recommendation if it were admitted as evidence.
 */
async function seedMiddleMonday(db: D1Database, token: string) {
  await start(db, token, MIDDLE, 'monday', MONDAY_BODY)
  await completeSet(db, token, MIDDLE, 'monday', 0, 60, 15)
  await completeSet(db, token, MIDDLE, 'monday', 1, 60, 15)
}

/**
 * Build an account and return next Monday's recommendation.
 *
 * `middle` decides what the intermediate occurrence is:
 *
 *   'none'          nothing between the earlier Monday and the guided one
 *   'valid'         a real scheduled Monday — the CONTROL, which must move it
 *   'contradictory' the same row with source_session_id flipped to 'tuesday'
 *   'extra'         a voluntary Extra copied from Monday
 */
async function recommendation(middle: 'none' | 'valid' | 'contradictory' | 'extra') {
  const fake = createFakeD1()
  const token = await seedToken(fake.db, 'sub-1', 'a@example.com')

  // A modest, legitimate scheduled Monday that every variant shares.
  await start(fake.db, token, EARLIER, 'monday', MONDAY_BODY)
  await completeSet(fake.db, token, EARLIER, 'monday', 0, 30, 12)
  await completeSet(fake.db, token, EARLIER, 'monday', 1, 30, 12)

  if (middle === 'valid' || middle === 'contradictory') {
    await seedMiddleMonday(fake.db, token)
    if (middle === 'contradictory') {
      // Written by the real API, then corrupted in exactly one column. The row
      // keeps its key, its ownership token and its set rows.
      occurrenceRow(fake, MIDDLE, 'monday').source_session_id = 'tuesday'
    }
  }

  if (middle === 'extra') {
    await start(fake.db, token, MIDDLE, 'extra', EXTRA_FROM_MONDAY)
    await completeSet(fake.db, token, MIDDLE, 'extra', 0, 60, 15)
    await completeSet(fake.db, token, MIDDLE, 'extra', 1, 60, 15)
  }

  await start(fake.db, token, GUIDED, 'monday', MONDAY_BODY)
  const { body } = await progression(fake.db, token, GUIDED, 'monday')
  return { fake, token, body }
}

/* ------------------------------------------------------------------ */
/* The control: the harness can actually move a recommendation         */
/* ------------------------------------------------------------------ */

describe('control — a VALID middle Monday does change the recommendation', () => {
  it('proves the evidence path is reachable, so exclusion below means something', async () => {
    const none = await recommendation('none')
    const valid = await recommendation('valid')

    // If this ever stopped differing, every exclusion assertion below would be
    // vacuously true and this file would be proving nothing at all.
    expect(JSON.stringify(valid.body)).not.toBe(JSON.stringify(none.body))
  })
})

/* ------------------------------------------------------------------ */
/* 1 + 2. The contradictory row is not evidence                        */
/* ------------------------------------------------------------------ */

describe('1/2. a contradictory scheduled row never enters progression', () => {
  it('leaves next Monday’s recommendation byte-identical to having no middle workout', async () => {
    const none = await recommendation('none')
    const corrupt = await recommendation('contradictory')

    expect(corrupt.body).toEqual(none.body)
    expect(JSON.stringify(corrupt.body)).toBe(JSON.stringify(none.body))
  })

  it('differs from the valid version of the very same occurrence', async () => {
    const valid = await recommendation('valid')
    const corrupt = await recommendation('contradictory')

    // Same date, same session, same sets, same loads. Only `source_session_id`
    // differs — and that alone decides whether it counts.
    expect(JSON.stringify(corrupt.body)).not.toBe(JSON.stringify(valid.body))
  })

  it('is still present in the store, so it was refused rather than missing', async () => {
    const { fake, token } = await recommendation('contradictory')

    // Reachable by key…
    expect(occurrenceRow(fake, MIDDLE, 'monday').source_session_id).toBe('tuesday')

    // …and visible to a provenance-agnostic read, which reports it as
    // unreadable rather than hiding it.
    const { body } = await workouts(fake.db, 'history', { token })
    const rows = body.workouts as { date: string; kind: unknown }[]
    const middle = rows.find((row) => row.date === MIDDLE)
    expect(middle).toBeDefined()
    expect(middle?.kind).toBeNull()
  })
})

/* ------------------------------------------------------------------ */
/* 3. Not an earlier progression occurrence                            */
/* ------------------------------------------------------------------ */

describe('3. a contradictory row is not an earlier progression occurrence', () => {
  it('leaves every lane calibrating when it is the ONLY prior history', async () => {
    const fake = createFakeD1()
    const token = await seedToken(fake.db, 'sub-1', 'a@example.com')

    // The only thing before the guided Monday, and it is contradictory.
    await seedMiddleMonday(fake.db, token)
    occurrenceRow(fake, MIDDLE, 'monday').source_session_id = 'tuesday'

    await start(fake.db, token, GUIDED, 'monday', MONDAY_BODY)
    const { body } = await progression(fake.db, token, GUIDED, 'monday')

    const lanes = body.lanes as { state: string; suggestedLoad: unknown; reasonCode: string }[]
    expect(lanes.length).toBeGreaterThan(0)
    for (const lane of lanes) {
      // With no admissible history the lane must still be ASKING, never
      // recommending off the back of a row it could not read.
      expect(lane.state).toBe('calibrate')
      expect(lane.reasonCode).toBe('awaiting_first_set')
      expect(lane.suggestedLoad).toBeNull()
    }
  })

  it('matches an account that genuinely has no prior history at all', async () => {
    async function guidedOnly(corrupt: boolean) {
      const fake = createFakeD1()
      const token = await seedToken(fake.db, 'sub-1', 'a@example.com')
      if (corrupt) {
        await seedMiddleMonday(fake.db, token)
        occurrenceRow(fake, MIDDLE, 'monday').source_session_id = 'tuesday'
      }
      await start(fake.db, token, GUIDED, 'monday', MONDAY_BODY)
      return (await progression(fake.db, token, GUIDED, 'monday')).body
    }

    expect(JSON.stringify(await guidedOnly(true))).toBe(JSON.stringify(await guidedOnly(false)))
  })
})

/* ------------------------------------------------------------------ */
/* 4 + 5 + 6. Everything legitimate is unchanged                       */
/* ------------------------------------------------------------------ */

describe('4. valid migrated scheduled rows still participate normally', () => {
  it('admits kind=scheduled with a null source as evidence', async () => {
    const { fake } = await recommendation('valid')

    // Exactly the shape migration 0010's DEFAULT produces for existing rows.
    const row = occurrenceRow(fake, MIDDLE, 'monday')
    expect(row.kind).toBe('scheduled')
    expect(row.source_session_id).toBeNull()

    const none = await recommendation('none')
    const valid = await recommendation('valid')
    expect(JSON.stringify(valid.body)).not.toBe(JSON.stringify(none.body))
  })

  it('produces a real recommendation from valid history', async () => {
    const { body } = await recommendation('valid')
    const lanes = body.lanes as { state: string }[]
    // Something other than "still asking" — the evidence was genuinely used.
    expect(lanes.some((lane) => lane.state !== 'calibrate')).toBe(true)
  })
})

describe('5. valid Extra rows remain excluded', () => {
  it('leaves the recommendation identical to having no middle workout', async () => {
    const none = await recommendation('none')
    const extra = await recommendation('extra')

    expect(JSON.stringify(extra.body)).toBe(JSON.stringify(none.body))
  })

  it('still refuses the progression surface for the Extra occurrence itself', async () => {
    const { fake, token } = await recommendation('extra')
    const { response, body } = await progression(fake.db, token, MIDDLE, 'extra')

    expect(response.status).toBe(404)
    expect(body.error).toBe('progression_not_available')
  })
})

describe('the calibration surface inherits the same gate', () => {
  /**
   * Both calibration paths resolve the occurrence first, so hardening
   * findOccurrence closes them too. Asserted rather than assumed: they are
   * writes, and a write against a row we cannot read is exactly what must not
   * happen.
   */
  async function calibration(method: 'PUT' | 'DELETE') {
    const fake = createFakeD1()
    const token = await seedToken(fake.db, 'sub-1', 'a@example.com')

    await seedMiddleMonday(fake.db, token)
    occurrenceRow(fake, MIDDLE, 'monday').source_session_id = 'tuesday'

    const response = await handleProgressionRequest(
      new Request(`${ORIGIN}/api/progression/${MIDDLE}/monday/calibration/0`, {
        method,
        headers: {
          Cookie: `vshape_session=${token}`,
          Origin: ORIGIN,
          'Content-Type': 'application/json',
        },
        body:
          method === 'PUT'
            ? JSON.stringify({ feedback: 'too_light', chosenLoad: null })
            : undefined,
      }),
      makeEnv(fake.db),
    )
    return { status: response!.status, body: (await response!.json()) as Record<string, never> }
  }

  it('refuses a calibration WRITE against a contradictory occurrence', async () => {
    const { status, body } = await calibration('PUT')
    // The accepted Round 16 mapping for "no such workout".
    expect(status).toBe(404)
    expect(body.error).toBe('workout_not_started')
  })

  it('refuses a calibration CLEAR against a contradictory occurrence', async () => {
    const { status, body } = await calibration('DELETE')
    expect(status).toBe(404)
    expect(body.error).toBe('workout_not_started')
  })
})

describe('6. existing Round 16 progression semantics are unchanged', () => {
  it('keeps account scoping: another account sees none of this history', async () => {
    const fake = createFakeD1()
    const mine = await seedToken(fake.db, 'sub-1', 'a@example.com')
    const theirs = await seedToken(fake.db, 'sub-2', 'b@example.com')

    await start(fake.db, mine, EARLIER, 'monday', MONDAY_BODY)
    await completeSet(fake.db, mine, EARLIER, 'monday', 0, 30, 12)
    await completeSet(fake.db, mine, EARLIER, 'monday', 1, 30, 12)

    await start(fake.db, theirs, GUIDED, 'monday', MONDAY_BODY)
    const { body } = await progression(fake.db, theirs, GUIDED, 'monday')

    const lanes = body.lanes as { state: string; suggestedLoad: unknown }[]
    for (const lane of lanes) {
      expect(lane.state).toBe('calibrate')
      expect(lane.suggestedLoad).toBeNull()
    }
  })

  it('keeps lane isolation: a different session is not evidence for Monday', async () => {
    const fake = createFakeD1()
    const token = await seedToken(fake.db, 'sub-1', 'a@example.com')

    // A heavy, valid, scheduled TUESDAY. Same exercise, same shape.
    await start(fake.db, token, MIDDLE, 'tuesday', {
      ...MONDAY_BODY,
      day: 'Tuesday',
      focus: 'Upper Chest + Shoulders + Triceps',
    })
    await completeSet(fake.db, token, MIDDLE, 'tuesday', 0, 60, 15)
    await completeSet(fake.db, token, MIDDLE, 'tuesday', 1, 60, 15)

    await start(fake.db, token, GUIDED, 'monday', MONDAY_BODY)
    const { body } = await progression(fake.db, token, GUIDED, 'monday')

    const lanes = body.lanes as { state: string; suggestedLoad: unknown }[]
    for (const lane of lanes) {
      expect(lane.state).toBe('calibrate')
      expect(lane.suggestedLoad).toBeNull()
    }
  })
})
