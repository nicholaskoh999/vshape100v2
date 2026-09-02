import { describe, expect, it } from 'vitest'

import type { Env } from '../auth/config'
import { createD1SessionStore } from '../auth/d1Stores'
import { createSession } from '../auth/session'
import { handleWorkoutRequest } from '../workouts/routes'
import { createFakeD1 } from './fakeD1'

/**
 * Round 21 — the Cancel Start and History Correction HTTP surface.
 *
 * The real handler, the real D1 mapping layer and the real rules run together
 * against the in-memory D1 stand-in. Both operations are destructive or
 * history-rewriting, so the refusals matter more than the successes: identity
 * always comes from the session, the same-origin guard applies, and every
 * malformed request fails closed before anything is written.
 */

const ORIGIN = 'https://vshapev2.nkmwei.de'
const BASE = `${ORIGIN}/api/workouts`
const DATE = '2026-09-07'
const SESSION = 'monday'

const START_BODY = {
  day: 'Monday',
  focus: 'Back Width + Biceps',
  intensity: 'HARD',
  exercises: [
    {
      exerciseId: 'lat-pulldown',
      name: 'Lat Pulldown',
      prescription: '4 x 10-15',
      equipment: null,
      resultKind: 'reps',
      loadMode: 'kg',
      perSide: false,
      setCount: 2,
    },
  ],
}

function makeEnv(db: D1Database): Env {
  return { DB: db, ASSETS: {} as Fetcher, APP_ORIGIN: ORIGIN }
}

async function seedToken(db: D1Database, googleSub: string, email: string) {
  const session = await createSession(createD1SessionStore(db), {
    googleSub,
    email,
    trusted: true,
  })
  return session.token
}

type Req = {
  token?: string
  method?: string
  origin?: string
  path?: string
  body?: unknown
  rawBody?: string
}

async function call(db: D1Database, options: Req) {
  const { token, method = 'GET', origin, path = `${DATE}/${SESSION}`, body, rawBody } = options
  const headers: Record<string, string> = {}
  if (token) headers.Cookie = `vshape_session=${token}`
  if (origin) headers.Origin = origin
  const payload = rawBody ?? (body === undefined ? undefined : JSON.stringify(body))
  if (payload !== undefined) headers['Content-Type'] = 'application/json'
  const response = await handleWorkoutRequest(
    new Request(`${BASE}/${path}`, { method, headers, body: payload }),
    makeEnv(db),
  )
  if (!response) throw new Error('handler did not claim the request')
  return { response, body: (await response.json()) as Record<string, never> }
}

const start = (db: D1Database, token: string, path = `${DATE}/${SESSION}/start`) =>
  call(db, { token, method: 'POST', origin: ORIGIN, path, body: START_BODY })

const cancel = (db: D1Database, token: string, origin: string | undefined = ORIGIN) =>
  call(db, { token, method: 'DELETE', origin })

const complete = (db: D1Database, token: string, order = 0, index = 0) =>
  call(db, {
    token,
    method: 'PUT',
    origin: ORIGIN,
    path: `${DATE}/${SESSION}/sets/${order}/${index}`,
    body: { action: 'complete', result: 12, load: { value: 20, unit: 'kg' } },
  })

/* ------------------------------------------------------------------ */
/* Cancel Start                                                        */
/* ------------------------------------------------------------------ */

describe('DELETE /api/workouts/:date/:session — cancel an accidental Start', () => {
  it('cancels an untouched workout and answers as not started', async () => {
    const fake = createFakeD1()
    const token = await seedToken(fake.db, 'sub-a', 'a@example.com')
    await start(fake.db, token)

    const { response, body } = await cancel(fake.db, token)
    expect(response.status).toBe(200)
    // Exactly the shape a never-started workout reads as.
    expect(body).toEqual({ date: DATE, sessionId: SESSION, occurrence: null, sets: [], progress: null })
    expect(fake.occurrences.size).toBe(0)
    expect(fake.workoutSets.size).toBe(0)

    // And a read agrees.
    const read = await call(fake.db, { token })
    expect(read.body.occurrence).toBeNull()
  })

  it('refuses a workout that has been worked in, changing nothing', async () => {
    const fake = createFakeD1()
    const token = await seedToken(fake.db, 'sub-a', 'a@example.com')
    await start(fake.db, token)
    await complete(fake.db, token)

    const { response, body } = await cancel(fake.db, token)
    expect(response.status).toBe(409)
    expect(body.error).toBe('workout_touched')
    expect(fake.occurrences.size).toBe(1)
    expect(fake.workoutSets.size).toBe(2)
  })

  it('answers 404 when there is nothing to cancel, including a second cancel', async () => {
    const fake = createFakeD1()
    const token = await seedToken(fake.db, 'sub-a', 'a@example.com')

    expect((await cancel(fake.db, token)).response.status).toBe(404)

    await start(fake.db, token)
    expect((await cancel(fake.db, token)).response.status).toBe(200)
    const second = await cancel(fake.db, token)
    expect(second.response.status).toBe(404)
    expect(second.body.error).toBe('not_started')
  })

  it('requires authentication', async () => {
    const fake = createFakeD1()
    const token = await seedToken(fake.db, 'sub-a', 'a@example.com')
    await start(fake.db, token)

    const { response } = await call(fake.db, { method: 'DELETE', origin: ORIGIN })
    expect(response.status).toBe(401)
    expect(fake.occurrences.size).toBe(1)
  })

  it('refuses a cross-origin cancel', async () => {
    const fake = createFakeD1()
    const token = await seedToken(fake.db, 'sub-a', 'a@example.com')
    await start(fake.db, token)

    const { response, body } = await cancel(fake.db, token, 'https://evil.example')
    expect(response.status).toBe(403)
    expect(body.error).toBe('forbidden')
    expect(fake.occurrences.size).toBe(1)
  })

  it('cannot cancel another account’s workout', async () => {
    const fake = createFakeD1()
    const alice = await seedToken(fake.db, 'sub-a', 'a@example.com')
    const bob = await seedToken(fake.db, 'sub-b', 'b@example.com')
    await start(fake.db, bob)

    const { response } = await cancel(fake.db, alice)
    expect(response.status).toBe(404)
    expect(fake.occurrences.size).toBe(1)
    expect([...fake.occurrences.values()][0].google_sub).toBe('sub-b')
  })

  it('reports whether the workout is cancelable on the read', async () => {
    const fake = createFakeD1()
    const token = await seedToken(fake.db, 'sub-a', 'a@example.com')
    await start(fake.db, token)

    expect((await call(fake.db, { token })).body.cancelable).toBe(true)
    await complete(fake.db, token)
    expect((await call(fake.db, { token })).body.cancelable).toBe(false)
  })
})

/* ------------------------------------------------------------------ */
/* History Correction                                                  */
/* ------------------------------------------------------------------ */

describe('PUT .../sets/:order/:index/correction — correct a recorded set', () => {
  async function completedWorkout() {
    const fake = createFakeD1()
    const token = await seedToken(fake.db, 'sub-a', 'a@example.com')
    await start(fake.db, token)
    await complete(fake.db, token)
    const read = await call(fake.db, { token })
    const set = (read.body.sets as unknown as { updatedAt: number }[])[0]
    return { fake, token, updatedAt: set.updatedAt }
  }

  const correctionPath = `${DATE}/${SESSION}/sets/0/0/correction`

  const correct = (db: D1Database, token: string, body: unknown, origin = ORIGIN) =>
    call(db, { token, method: 'PUT', origin, path: correctionPath, body })

  it('corrects a kilogram set into a band set, and records the audit', async () => {
    const { fake, token, updatedAt } = await completedWorkout()

    const { response, body } = await correct(fake.db, token, {
      inputType: 'resistance_band',
      band: { label: 'Black', count: 3 },
      result: 12,
      expectedUpdatedAt: updatedAt,
    })

    expect(response.status).toBe(200)
    expect(body.corrected).toBe(true)
    const set = body.set as unknown as Record<string, unknown>
    expect(set.inputType).toBe('resistance_band')
    expect(set.band).toEqual({ label: 'Black', count: 3 })
    expect(set.load).toBeNull()
    expect(set.status).toBe('completed')
    expect(fake.workoutSetCorrections.size).toBe(1)
  })

  it('surfaces the correction time on a later read', async () => {
    const { fake, token, updatedAt } = await completedWorkout()
    await correct(fake.db, token, {
      inputType: 'resistance_band',
      band: { label: 'Black', count: 3 },
      result: 12,
      expectedUpdatedAt: updatedAt,
    })

    const read = await call(fake.db, { token })
    const sets = read.body.sets as unknown as { correctedAt: number | null }[]
    expect(typeof sets[0].correctedAt).toBe('number')
    // The set that was never corrected says so honestly.
    expect(sets[1].correctedAt).toBeNull()
  })

  it('answers 409 on a stale version, writing nothing', async () => {
    const { fake, token, updatedAt } = await completedWorkout()

    const { response, body } = await correct(fake.db, token, {
      inputType: 'resistance_band',
      band: { label: 'Black', count: 3 },
      result: 12,
      expectedUpdatedAt: updatedAt - 1,
    })
    expect(response.status).toBe(409)
    expect(body.error).toBe('stale')
    expect(fake.workoutSetCorrections.size).toBe(0)
  })

  it('reports a no-op without inventing an audit event', async () => {
    const { fake, token, updatedAt } = await completedWorkout()

    const { response, body } = await correct(fake.db, token, {
      inputType: 'weight_kg',
      load: { value: 20, unit: 'kg' },
      result: 12,
      expectedUpdatedAt: updatedAt,
    })
    expect(response.status).toBe(200)
    expect(body.corrected).toBe(false)
    expect(fake.workoutSetCorrections.size).toBe(0)
  })

  it('refuses an incoherent correction before anything is written', async () => {
    const { fake, token, updatedAt } = await completedWorkout()

    for (const bad of [
      { inputType: 'resistance_band', load: { value: 3, unit: 'kg' }, band: { label: 'Black', count: 3 }, result: 12, expectedUpdatedAt: updatedAt },
      { inputType: 'weight_kg', band: { label: 'Black', count: 3 }, result: 12, expectedUpdatedAt: updatedAt },
      { inputType: 'bodyweight', load: { value: 3, unit: 'kg' }, result: 12, expectedUpdatedAt: updatedAt },
      { inputType: 'elastic_vibes', result: 12, expectedUpdatedAt: updatedAt },
      { inputType: 'resistance_band', band: { label: 'Black', count: 0 }, result: 12, expectedUpdatedAt: updatedAt },
      { inputType: 'resistance_band', band: { label: 'Black', count: 3 }, result: 0, expectedUpdatedAt: updatedAt },
      { inputType: 'resistance_band', band: { label: 'Black', count: 3 }, result: 12 },
    ]) {
      const { response, body } = await correct(fake.db, token, bad)
      expect(response.status, JSON.stringify(bad)).toBe(400)
      expect(body.error).toBe('invalid_correction')
    }
    expect(fake.workoutSetCorrections.size).toBe(0)
  })

  it('refuses malformed JSON', async () => {
    const { fake, token } = await completedWorkout()
    const { response, body } = await call(fake.db, {
      token, method: 'PUT', origin: ORIGIN, path: correctionPath, rawBody: 'not json',
    })
    expect(response.status).toBe(400)
    expect(body.error).toBe('invalid_json')
  })

  it('refuses a pending set', async () => {
    const { fake, token } = await completedWorkout()
    const read = await call(fake.db, { token })
    const pending = (read.body.sets as unknown as { updatedAt: number }[])[1]

    const { response, body } = await call(fake.db, {
      token, method: 'PUT', origin: ORIGIN,
      path: `${DATE}/${SESSION}/sets/0/1/correction`,
      body: { inputType: 'resistance_band', band: { label: 'Black', count: 3 }, result: 12, expectedUpdatedAt: pending.updatedAt },
    })
    expect(response.status).toBe(400)
    expect(body.error).toBe('not_completed')
    expect(fake.workoutSetCorrections.size).toBe(0)
  })

  it('requires authentication and same origin', async () => {
    const { fake, token, updatedAt } = await completedWorkout()
    const payload = {
      inputType: 'resistance_band', band: { label: 'Black', count: 3 },
      result: 12, expectedUpdatedAt: updatedAt,
    }

    const anonymous = await call(fake.db, {
      method: 'PUT', origin: ORIGIN, path: correctionPath, body: payload,
    })
    expect(anonymous.response.status).toBe(401)

    const crossOrigin = await correct(fake.db, token, payload, 'https://evil.example')
    expect(crossOrigin.response.status).toBe(403)

    expect(fake.workoutSetCorrections.size).toBe(0)
  })

  it('cannot correct another account’s set', async () => {
    const { fake, updatedAt } = await completedWorkout()
    const bob = await seedToken(fake.db, 'sub-b', 'b@example.com')

    const { response } = await correct(fake.db, bob, {
      inputType: 'resistance_band', band: { label: 'Black', count: 3 },
      result: 12, expectedUpdatedAt: updatedAt,
    })
    expect(response.status).toBe(404)
    expect(fake.workoutSetCorrections.size).toBe(0)
  })

  it('rejects the wrong method on the correction route', async () => {
    const { fake, token } = await completedWorkout()
    for (const method of ['GET', 'POST', 'DELETE']) {
      const { response } = await call(fake.db, {
        token, method, origin: ORIGIN, path: correctionPath,
      })
      expect(response.status, method).toBe(405)
    }
  })
})

/* ------------------------------------------------------------------ */
/* Correction 1 — the corrected timestamp on the wire                  */
/* ------------------------------------------------------------------ */

/**
 * Blocker 2.
 *
 * The successful correction response used to send `correctedAt: null`, because
 * `toPublicSet` defaulted it and nothing passed the committed audit time in.
 * The React editor adopts that response directly, so for one render the app
 * showed the corrected Black ×3 truth while claiming the set had never been
 * corrected — the mark only appeared after some later refetch.
 *
 * The React test did not catch it because the in-memory stand-in set
 * `correctedAt` itself, making the double MORE correct than production. These
 * go through the REAL Worker handler, where nothing can paper over it.
 */
describe('a successful correction carries its audit timestamp', () => {
  const path = `${DATE}/${SESSION}/sets/0/0/correction`

  async function completedWorkout() {
    const fake = createFakeD1()
    const token = await seedToken(fake.db, 'sub-a', 'a@example.com')
    await start(fake.db, token)
    await complete(fake.db, token)
    const read = await call(fake.db, { token })
    const set = (read.body.sets as unknown as { updatedAt: number; correctedAt: number | null }[])[0]
    return { fake, token, updatedAt: set.updatedAt, correctedAt: set.correctedAt }
  }

  const band = (expectedUpdatedAt: number) => ({
    inputType: 'resistance_band',
    band: { label: 'Black', count: 3 },
    result: 12,
    expectedUpdatedAt,
  })

  it('reports the committed correction time in the response itself', async () => {
    const { fake, token, updatedAt, correctedAt } = await completedWorkout()
    // Before: never corrected, and the read says so honestly.
    expect(correctedAt).toBeNull()

    const { response, body } = await call(fake.db, {
      token, method: 'PUT', origin: ORIGIN, path, body: band(updatedAt),
    })

    expect(response.status).toBe(200)
    expect(body.corrected).toBe(true)
    const set = body.set as unknown as Record<string, unknown>
    expect(typeof set.correctedAt).toBe('number')

    // It is the AUDIT EVENT's own timestamp, not an arbitrary clock reading.
    expect(fake.workoutSetCorrections.size).toBe(1)
    const audit = [...fake.workoutSetCorrections.values()][0]
    expect(set.correctedAt).toBe(audit.corrected_at)
  })

  it('answers the same value on a subsequent read', async () => {
    const { fake, token, updatedAt } = await completedWorkout()
    const saved = await call(fake.db, {
      token, method: 'PUT', origin: ORIGIN, path, body: band(updatedAt),
    })
    const fromSave = (saved.body.set as unknown as Record<string, unknown>).correctedAt

    const read = await call(fake.db, { token })
    const fromRead = (read.body.sets as unknown as { correctedAt: number | null }[])[0].correctedAt

    // No drift between what the save said and what the workout says afterwards.
    expect(fromRead).toBe(fromSave)
  })

  it('does NOT manufacture a timestamp for a no-op', async () => {
    const { fake, token, updatedAt } = await completedWorkout()

    const { body } = await call(fake.db, {
      token, method: 'PUT', origin: ORIGIN, path,
      body: { inputType: 'weight_kg', load: { value: 20, unit: 'kg' }, result: 12, expectedUpdatedAt: updatedAt },
    })

    expect(body.corrected).toBe(false)
    // Never corrected, and a no-op does not make it look otherwise.
    expect((body.set as unknown as Record<string, unknown>).correctedAt).toBeNull()
    expect(fake.workoutSetCorrections.size).toBe(0)
  })

  it('preserves an EXISTING correction time when a later no-op is submitted', async () => {
    const { fake, token, updatedAt } = await completedWorkout()
    const first = await call(fake.db, {
      token, method: 'PUT', origin: ORIGIN, path, body: band(updatedAt),
    })
    const original = (first.body.set as unknown as Record<string, unknown>).correctedAt
    const nextVersion = (first.body.set as unknown as { updatedAt: number }).updatedAt

    // Submit exactly what is now stored: no event happened, so the existing
    // history must be reported unchanged rather than refreshed.
    const noop = await call(fake.db, {
      token, method: 'PUT', origin: ORIGIN, path, body: band(nextVersion),
    })

    expect(noop.body.corrected).toBe(false)
    expect((noop.body.set as unknown as Record<string, unknown>).correctedAt).toBe(original)
    expect(fake.workoutSetCorrections.size).toBe(1)
  })

  it('reports the LATEST event after a second real correction', async () => {
    const { fake, token, updatedAt } = await completedWorkout()
    const first = await call(fake.db, {
      token, method: 'PUT', origin: ORIGIN, path, body: band(updatedAt),
    })
    const firstAt = (first.body.set as unknown as Record<string, unknown>).correctedAt
    const nextVersion = (first.body.set as unknown as { updatedAt: number }).updatedAt

    const second = await call(fake.db, {
      token, method: 'PUT', origin: ORIGIN, path,
      body: { inputType: 'weight_kg', load: { value: 9, unit: 'kg' }, result: 10, expectedUpdatedAt: nextVersion },
    })

    expect(second.body.corrected).toBe(true)
    const secondAt = (second.body.set as unknown as Record<string, unknown>).correctedAt as number
    // Two distinct events, appended rather than replaced. The timestamps can be
    // equal - both corrections can land inside the same millisecond - so the
    // count is what proves the audit chained, and the ordering is asserted as
    // non-decreasing rather than strictly later.
    expect(fake.workoutSetCorrections.size).toBe(2)
    expect(new Set([...fake.workoutSetCorrections.keys()]).size).toBe(2)
    expect(secondAt).toBeGreaterThanOrEqual(firstAt as number)

    // And the workout read agrees with the newer of the two.
    const read = await call(fake.db, { token })
    expect((read.body.sets as unknown as { correctedAt: number }[])[0].correctedAt).toBe(secondAt)
  })
})
