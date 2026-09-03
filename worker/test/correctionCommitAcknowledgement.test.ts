import { describe, expect, it } from 'vitest'

import type { Env } from '../auth/config'
import { createD1SessionStore } from '../auth/d1Stores'
import { createSession } from '../auth/session'
import { handleWorkoutRequest } from '../workouts/routes'
import { createFakeD1, type SeedProgramme } from './fakeD1'

/**
 * ROUND 23 — A CORRECTION'S OUTCOME MUST BE TRUE.
 *
 * WHAT HAPPENED IN PRODUCTION.
 *
 * A real Triceps Pushdown correction was sent to the accepted Round 21 route.
 * The route answered `500 server_error`. The correction had nevertheless
 * committed: the set carried the corrected facts and the immutable audit event
 * existed, with the right BEFORE and the right AFTER.
 *
 * So the caller was told a state-changing request had failed when it had
 * succeeded. That is the dangerous half. A client — or a person — told "failed"
 * reasonably retries, and a retry of a correction is not obviously harmless.
 *
 * WHERE IT COMES FROM.
 *
 * `store.correctSet()` is the ONLY awaited operation in the whole correction
 * path that sits at or after the commit point. Everything before it is a read
 * or a pure check; everything after it — building the record, projecting it,
 * serialising the response, attaching session headers — is synchronous and
 * total. There is nowhere else a post-commit failure could come from.
 *
 * And that await can reject over a write that happened: D1 is a network round
 * trip around a transaction, so the batch can commit while the acknowledgement
 * is lost. The rejection propagates to the route's catch, which answers 500.
 *
 * WHAT THIS FILE PROVES.
 *
 * The failure is reproduced at the real boundary — the batch commits in full
 * and THEN rejects — and driven through the real HTTP handler, so what is
 * asserted is the status code and body a browser would actually receive.
 *
 * Remove the reconciliation in `correctSet` and the first test here fails with
 * exactly the production symptom: HTTP 500 over a committed, audited
 * correction.
 */

const ORIGIN = 'https://vshapev2.nkmwei.de'
const BASE = `${ORIGIN}/api/workouts`
const DATE = '2026-09-01'
const SESSION = 'tuesday'
const ACCOUNT = 'google-sub-a'

const PROGRAMME: SeedProgramme = {
  revision: 1,
  exercises: [{ exerciseId: 'triceps-pushdown', name: 'Triceps Pushdown' }],
  sessions: {
    monday: [],
    tuesday: [
      { exerciseId: 'triceps-pushdown', setCount: 1, targetMin: 10, targetMax: 15 },
    ],
    wednesday: [],
    thursday: [],
    friday: [],
  },
}

function makeEnv(db: D1Database): Env {
  return { DB: db, ASSETS: {} as Fetcher, APP_ORIGIN: ORIGIN }
}

function request(
  token: string,
  method: string,
  path: string,
  body?: unknown,
): Request {
  const headers: Record<string, string> = { Cookie: `vshape_session=${token}`, Origin: ORIGIN }
  const payload = body === undefined ? undefined : JSON.stringify(body)
  if (payload !== undefined) headers['Content-Type'] = 'application/json'
  return new Request(`${BASE}/${path}`, { method, headers, body: payload })
}

async function call(db: D1Database, token: string, method: string, path: string, body?: unknown) {
  const response = await handleWorkoutRequest(request(token, method, path, body), makeEnv(db))
  if (!response) throw new Error('handler did not claim the request')
  return { response, body: (await response.json()) as Record<string, never> }
}

/**
 * A started workout with one COMPLETED Triceps set recorded as 3 kg x 12 —
 * exactly the production shape this round is about.
 *
 * Built through the real Start and the real set-update route, so the row under
 * test is one the application actually wrote.
 */
async function seedCompletedSet() {
  const fake = createFakeD1()
  fake.seedProgramme(ACCOUNT, PROGRAMME)
  const { token } = await createSession(createD1SessionStore(fake.db), {
    googleSub: ACCOUNT,
    email: 'person@example.com',
    trusted: true,
  })

  await call(fake.db, token, 'POST', `${DATE}/${SESSION}/start`, {
    expectedRevision: PROGRAMME.revision,
  })
  const logged = await call(fake.db, token, 'PUT', `${DATE}/${SESSION}/sets/0/0`, {
    action: 'complete',
    result: 12,
    load: { value: 3, unit: 'kg' },
  })
  // The fixture is only useful if the set really is completed 3 kg x 12.
  if (logged.response.status !== 200) {
    throw new Error(`seed failed: ${logged.response.status} ${JSON.stringify(logged.body)}`)
  }

  const read = await call(fake.db, token, 'GET', `${DATE}/${SESSION}`)
  const sets = read.body.sets as unknown as { updatedAt: number; result: number }[]
  return { fake, token, updatedAt: sets[0].updatedAt }
}

/** The correction the production case actually asked for. */
const AFTER = {
  inputType: 'resistance_band',
  load: null,
  band: { label: 'Black', count: 3 },
  result: 12,
}

const PATH = `${DATE}/${SESSION}/sets/0/0/correction`

/* ------------------------------------------------------------------ */

describe('E. a correction that commits must never be reported as a failure', () => {
  it('reports success when the batch commits and the acknowledgement is lost', async () => {
    const { fake, token, updatedAt } = await seedCompletedSet()

    // THE PRODUCTION FAILURE CLASS: the batch applies in full, then rejects.
    fake.failBatchAfterCommit(new Error('Network connection lost.'))

    const { response, body } = await call(fake.db, token, 'PUT', PATH, {
      ...AFTER,
      expectedUpdatedAt: updatedAt,
    })

    // The observable symptom that must be gone.
    expect(response.status, 'HTTP status').toBe(200)
    expect(body.corrected as unknown as boolean).toBe(true)

    // And the body must describe the DURABLE truth, not an intention.
    const set = body.set as unknown as Record<string, unknown>
    expect(set.inputType).toBe('resistance_band')
    expect(set.load).toBeNull()
    expect(set.band).toEqual({ label: 'Black', count: 3 })
    expect(set.result).toBe(12)
    expect(set.status).toBe('completed')

    // Exactly one audit event, and the set really was rewritten.
    expect(fake.workoutSetCorrections.size).toBe(1)
    const audit = [...fake.workoutSetCorrections.values()][0]
    expect(audit.before_load_value).toBe(3)
    expect(audit.before_input_type).toBe('weight_kg')
    expect(audit.after_band_label).toBe('Black')
    expect(audit.after_band_count).toBe(3)
    expect(audit.after_result).toBe(12)
    // The response's correctedAt is the one the audit durably recorded.
    expect(set.correctedAt).toBe(audit.corrected_at)

    const stored = [...fake.workoutSets.values()][0]
    expect(stored.actual_band_label).toBe('Black')
    expect(stored.actual_load_value).toBeNull()
    expect(stored.status).toBe('completed')
  })

  it('still reports the real failure when the write genuinely did not commit', async () => {
    const { fake, token, updatedAt } = await seedCompletedSet()
    const before = { ...([...fake.workoutSets.values()][0]) }

    // Fails BEFORE anything is applied — the ordinary storage outage.
    fake.breakWorkouts(new Error('D1 unavailable'))

    const { response, body } = await call(fake.db, token, 'PUT', PATH, {
      ...AFTER,
      expectedUpdatedAt: updatedAt,
    })

    expect(response.status).toBe(500)
    expect(body.error as unknown as string).toBe('server_error')

    // Nothing was written, and nothing was claimed.
    expect(fake.workoutSetCorrections.size).toBe(0)
    expect([...fake.workoutSets.values()][0]).toEqual(before)
  })

  it('does not invent a success when the reconciling read also fails', async () => {
    const { fake, token, updatedAt } = await seedCompletedSet()

    // The batch commits and rejects, AND the store stays broken afterwards, so
    // the question "did it commit?" cannot be answered. Claiming success would
    // be a guess; the original failure is reported instead.
    fake.failBatchAfterCommit(new Error('Network connection lost.'))
    fake.breakWorkouts(new Error('D1 unavailable'))

    const { response, body } = await call(fake.db, token, 'PUT', PATH, {
      ...AFTER,
      expectedUpdatedAt: updatedAt,
    })

    expect(response.status).toBe(500)
    expect(body.error as unknown as string).toBe('server_error')
  })
})

/* ------------------------------------------------------------------ */

describe('A-D. the Round 21 guarantees, still exactly as they were', () => {
  it('A. a genuine correction: one set changes, one audit, 2xx, corrected=true', async () => {
    const { fake, token, updatedAt } = await seedCompletedSet()

    const { response, body } = await call(fake.db, token, 'PUT', PATH, {
      ...AFTER,
      expectedUpdatedAt: updatedAt,
    })

    expect(response.status).toBe(200)
    expect(body.corrected as unknown as boolean).toBe(true)
    expect(fake.workoutSetCorrections.size).toBe(1)

    // The response body matches the durable AFTER truth.
    const stored = [...fake.workoutSets.values()][0]
    const set = body.set as unknown as Record<string, unknown>
    expect(set.result).toBe(stored.actual_result)
    expect(set.band).toEqual({
      label: stored.actual_band_label,
      count: stored.actual_band_count,
    })
    expect(set.inputType).toBe(stored.input_type_snapshot)
    expect(set.updatedAt).toBe(stored.updated_at)
  })

  it('B. a no-op: 2xx, corrected=false, no audit, no mutation', async () => {
    const { fake, token, updatedAt } = await seedCompletedSet()
    const before = { ...([...fake.workoutSets.values()][0]) }

    const { response, body } = await call(fake.db, token, 'PUT', PATH, {
      inputType: 'weight_kg',
      load: { value: 3, unit: 'kg' },
      band: null,
      result: 12,
      expectedUpdatedAt: updatedAt,
    })

    expect(response.status).toBe(200)
    expect(body.corrected as unknown as boolean).toBe(false)
    expect(fake.workoutSetCorrections.size).toBe(0)
    expect([...fake.workoutSets.values()][0]).toEqual(before)
  })

  it('C. a stale CAS: 409, no audit, no mutation', async () => {
    const { fake, token, updatedAt } = await seedCompletedSet()
    const before = { ...([...fake.workoutSets.values()][0]) }

    const { response, body } = await call(fake.db, token, 'PUT', PATH, {
      ...AFTER,
      expectedUpdatedAt: updatedAt - 1,
    })

    expect(response.status).toBe(409)
    expect(body.error as unknown as string).toBe('stale')
    expect(fake.workoutSetCorrections.size).toBe(0)
    expect([...fake.workoutSets.values()][0]).toEqual(before)
  })

  it('D. a set that is not completed: controlled refusal, no audit, no mutation', async () => {
    const { fake, token } = await seedCompletedSet()

    // Put the set back to pending through the real Undo route.
    await call(fake.db, token, 'DELETE', `${DATE}/${SESSION}/sets/0/0`)
    const read = await call(fake.db, token, 'GET', `${DATE}/${SESSION}`)
    const sets = read.body.sets as unknown as { status: string; updatedAt: number }[]
    expect(sets[0].status).toBe('pending')
    const before = { ...([...fake.workoutSets.values()][0]) }

    const { response, body } = await call(fake.db, token, 'PUT', PATH, {
      ...AFTER,
      expectedUpdatedAt: sets[0].updatedAt,
    })

    expect(response.status).toBe(400)
    expect(body.error as unknown as string).toBe('not_completed')
    expect(fake.workoutSetCorrections.size).toBe(0)
    expect([...fake.workoutSets.values()][0]).toEqual(before)
  })

  it('D2. an invalid payload is refused before anything is read or written', async () => {
    const { fake, token, updatedAt } = await seedCompletedSet()
    const before = { ...([...fake.workoutSets.values()][0]) }

    // A band payload that also carries a load: two kinds of resistance at once.
    const { response, body } = await call(fake.db, token, 'PUT', PATH, {
      inputType: 'resistance_band',
      load: { value: 3, unit: 'kg' },
      band: { label: 'Black', count: 3 },
      result: 12,
      expectedUpdatedAt: updatedAt,
    })

    expect(response.status).toBe(400)
    expect(body.error as unknown as string).toBe('invalid_correction')
    expect(fake.workoutSetCorrections.size).toBe(0)
    expect([...fake.workoutSets.values()][0]).toEqual(before)
  })
})
