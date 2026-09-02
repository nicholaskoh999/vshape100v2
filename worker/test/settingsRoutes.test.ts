import { describe, expect, it } from 'vitest'

import type { Env } from '../auth/config'
import { createD1SessionStore } from '../auth/d1Stores'
import { createSession } from '../auth/session'
import { handleSettingsRequest } from '../settings/routes'
import { handleWorkoutRequest } from '../workouts/routes'
import { createFakeD1 } from './fakeD1'
import { programmeFromLegacyPlan, startBody } from './programmeFixture'

/**
 * Round 18.1 — the account settings API.
 *
 * The real handler, the real D1 mapping layer and the real rules run together
 * against the in-memory D1 stand-in. No test touches a network.
 *
 * The two claims that matter most: an account cannot reach another account's
 * setting, and saving a start date writes nothing but that setting.
 */

const ORIGIN = 'https://vshapev2.nkmwei.de'
const CUTOVER = '2026-09-01'

const PLAN = {
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

/**
 * ROUND 22 — the same plan, established where the server now reads it.
 *
 * The Start body no longer carries programme content, so the plan this suite
 * has always been about is seeded as the account's authoritative programme.
 * Nothing about what the suite asserts changes.
 */
const PROGRAMME = programmeFromLegacyPlan('monday', PLAN)

const MONDAY_BODY = startBody(PROGRAMME.revision)

function makeEnv(db: D1Database): Env {
  return { DB: db, ASSETS: {} as Fetcher, APP_ORIGIN: ORIGIN }
}

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

async function settings(
  db: D1Database,
  options: { token?: string; method?: string; origin?: string; body?: unknown; rawBody?: string } = {},
) {
  const headers: Record<string, string> = {}
  if (options.token) headers.Cookie = `vshape_session=${options.token}`
  if (options.origin) headers.Origin = options.origin
  const payload = options.rawBody ?? (options.body === undefined ? undefined : JSON.stringify(options.body))
  if (payload !== undefined) headers['Content-Type'] = 'application/json'

  const response = await handleSettingsRequest(
    new Request(`${ORIGIN}/api/settings`, {
      method: options.method ?? 'GET',
      headers,
      body: payload,
    }),
    makeEnv(db),
  )
  if (!response) throw new Error('handler did not claim the request')
  return { response, body: (await response.json()) as Record<string, never> }
}

/* ------------------------------------------------------------------ */
/* Routing and defaults                                                */
/* ------------------------------------------------------------------ */

describe('routing', () => {
  it('ignores requests that are not settings requests', async () => {
    const fake = createFakeD1()
    const { db } = fake
    expect(
      await handleSettingsRequest(new Request(`${ORIGIN}/api/today/completions`), makeEnv(db)),
    ).toBeNull()
    // Exact match only: a future sub-path is not silently answered as this one.
    expect(
      await handleSettingsRequest(new Request(`${ORIGIN}/api/settings/anything`), makeEnv(db)),
    ).toBeNull()
  })

  it('refuses an unsupported method', async () => {
    const fake = createFakeD1()
    const { db } = fake
    const { response } = await settings(db, { method: 'DELETE' })
    expect(response.status).toBe(405)
  })
})

describe('1. an account that has never saved reads as no preference', () => {
  it('returns null rather than substituting the default', async () => {
    const fake = createFakeD1()
    const { db } = fake
    const token = await seedToken(fake, 'sub-1', 'a@example.com')

    const { response, body } = await settings(db, { token })
    expect(response.status).toBe(200)
    // Null is a real answer. The client applies the documented fallback, so the
    // API can tell "unset" from an explicit 2026-08-31.
    expect(body.foundationStartDate).toBeNull()
  })
})

/* ------------------------------------------------------------------ */
/* 11. Save, and read back                                             */
/* ------------------------------------------------------------------ */

describe('11. a saved date persists and is read back', () => {
  it('stores it and returns what was stored', async () => {
    const fake = createFakeD1()
    const { db } = fake
    const token = await seedToken(fake, 'sub-1', 'a@example.com')

    const saved = await settings(db, {
      token,
      method: 'PUT',
      origin: ORIGIN,
      body: { foundationStartDate: CUTOVER },
    })
    expect(saved.response.status).toBe(200)
    expect(saved.body.foundationStartDate).toBe(CUTOVER)

    // A fresh read — the equivalent of a reload — sees the same value.
    const reread = await settings(db, { token })
    expect(reread.body.foundationStartDate).toBe(CUTOVER)
  })

  it('replaces a previous choice rather than accumulating rows', async () => {
    const fake = createFakeD1()
    const { db, accountSettings } = fake
    const token = await seedToken(fake, 'sub-1', 'a@example.com')

    await settings(db, { token, method: 'PUT', origin: ORIGIN, body: { foundationStartDate: CUTOVER } })
    await settings(db, { token, method: 'PUT', origin: ORIGIN, body: { foundationStartDate: '2026-10-01' } })

    expect(accountSettings.size).toBe(1)
    expect((await settings(db, { token })).body.foundationStartDate).toBe('2026-10-01')
  })

  it('clears the preference on an explicit null', async () => {
    const fake = createFakeD1()
    const { db } = fake
    const token = await seedToken(fake, 'sub-1', 'a@example.com')

    await settings(db, { token, method: 'PUT', origin: ORIGIN, body: { foundationStartDate: CUTOVER } })
    const cleared = await settings(db, {
      token,
      method: 'PUT',
      origin: ORIGIN,
      body: { foundationStartDate: null },
    })

    expect(cleared.body.foundationStartDate).toBeNull()
  })
})

/* ------------------------------------------------------------------ */
/* 4. Invalid input is refused by the server too                       */
/* ------------------------------------------------------------------ */

describe('4. the server refuses impossible dates', () => {
  it('rejects a date that is not a real calendar day', async () => {
    const fake = createFakeD1()
    const { db } = fake
    const token = await seedToken(fake, 'sub-1', 'a@example.com')

    for (const value of ['2026-02-30', '2026-13-01', '2026-9-1', '', 'today', 42]) {
      const { response, body } = await settings(db, {
        token,
        method: 'PUT',
        origin: ORIGIN,
        body: { foundationStartDate: value },
      })
      expect(response.status, String(value)).toBe(400)
      expect(body.field, String(value)).toBe('foundation_start_date')
    }

    // Nothing was stored by any of those attempts.
    expect((await settings(db, { token })).body.foundationStartDate).toBeNull()
  })

  it('rejects a malformed body', async () => {
    const fake = createFakeD1()
    const { db } = fake
    const token = await seedToken(fake, 'sub-1', 'a@example.com')

    const bad = await settings(db, { token, method: 'PUT', origin: ORIGIN, rawBody: '{oops' })
    expect(bad.response.status).toBe(400)
    expect(bad.body.error).toBe('invalid_json')

    const notAnObject = await settings(db, { token, method: 'PUT', origin: ORIGIN, body: [] })
    expect(notAnObject.response.status).toBe(400)
  })
})

/* ------------------------------------------------------------------ */
/* 5 + 26. Account isolation, auth and same-origin                     */
/* ------------------------------------------------------------------ */

describe('5/26. account isolation and HTTP safety', () => {
  it('never lets one account read or write another account’s setting', async () => {
    const fake = createFakeD1()
    const { db } = fake
    const alice = await seedToken(fake, 'sub-alice', 'alice@example.com')
    const bob = await seedToken(fake, 'sub-bob', 'bob@example.com')

    await settings(db, { token: alice, method: 'PUT', origin: ORIGIN, body: { foundationStartDate: CUTOVER } })

    // Bob reads his own, which is still unset.
    expect((await settings(db, { token: bob })).body.foundationStartDate).toBeNull()

    await settings(db, {
      token: bob,
      method: 'PUT',
      origin: ORIGIN,
      body: { foundationStartDate: '2026-10-15' },
    })

    // Neither write reached the other account.
    expect((await settings(db, { token: alice })).body.foundationStartDate).toBe(CUTOVER)
    expect((await settings(db, { token: bob })).body.foundationStartDate).toBe('2026-10-15')
  })

  it('ignores an identity supplied in the body', async () => {
    const fake = createFakeD1()
    const { db } = fake
    const alice = await seedToken(fake, 'sub-alice', 'alice@example.com')
    const bob = await seedToken(fake, 'sub-bob', 'bob@example.com')

    // `googleSub` is not part of any accepted payload, so sending one changes
    // nothing: the account is the one on the session.
    await settings(db, {
      token: alice,
      method: 'PUT',
      origin: ORIGIN,
      body: { foundationStartDate: CUTOVER, googleSub: 'sub-bob' },
    })

    expect((await settings(db, { token: bob })).body.foundationStartDate).toBeNull()
    expect((await settings(db, { token: alice })).body.foundationStartDate).toBe(CUTOVER)
  })

  it('refuses an unauthenticated read and write', async () => {
    const fake = createFakeD1()
    const { db } = fake
    expect((await settings(db, {})).response.status).toBe(401)
    expect(
      (await settings(db, { method: 'PUT', origin: ORIGIN, body: { foundationStartDate: CUTOVER } }))
        .response.status,
    ).toBe(401)
  })

  it('refuses a cross-origin write', async () => {
    const fake = createFakeD1()
    const { db } = fake
    const token = await seedToken(fake, 'sub-1', 'a@example.com')

    const { response } = await settings(db, {
      token,
      method: 'PUT',
      origin: 'https://evil.example',
      body: { foundationStartDate: CUTOVER },
    })
    expect(response.status).toBe(403)
    expect((await settings(db, { token })).body.foundationStartDate).toBeNull()
  })

  it('reports a storage failure as a controlled error', async () => {
    const fake = createFakeD1()
    const token = await seedToken(fake, 'sub-1', 'a@example.com')
    fake.breakSettings(new Error('d1 down'))

    const { response, body } = await settings(fake.db, { token })
    expect(response.status).toBe(500)
    expect(body.error).toBe('server_error')
  })
})

/* ------------------------------------------------------------------ */
/* 6. Saving the date is non-destructive                               */
/* ------------------------------------------------------------------ */

describe('6. saving a start date changes no history', () => {
  it('leaves every recorded workout row exactly as it was', async () => {
    const fake = createFakeD1()
    const token = await seedToken(fake, 'sub-1', 'a@example.com')

    // Real recorded history, written through the real workout API.
    const start = await handleWorkoutRequest(
      new Request(`${ORIGIN}/api/workouts/2026-08-24/monday/start`, {
        method: 'POST',
        headers: {
          Cookie: `vshape_session=${token}`,
          Origin: ORIGIN,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(MONDAY_BODY),
      }),
      makeEnv(fake.db),
    )
    expect(start?.status).toBe(201)

    const occurrencesBefore = fake.occurrences.size
    const setsBefore = fake.workoutSets.size

    await settings(fake.db, {
      token,
      method: 'PUT',
      origin: ORIGIN,
      body: { foundationStartDate: CUTOVER },
    })

    // Changing the date is NOT a Fresh Start. Nothing was deleted or rewritten,
    // including history dated before the new start.
    expect(fake.occurrences.size).toBe(occurrencesBefore)
    expect(fake.workoutSets.size).toBe(setsBefore)

    const read = await handleWorkoutRequest(
      new Request(`${ORIGIN}/api/workouts/2026-08-24/monday`, {
        headers: { Cookie: `vshape_session=${token}` },
      }),
      makeEnv(fake.db),
    )
    const body = (await read!.json()) as { sets: unknown[]; occurrence: unknown }
    expect(body.occurrence).not.toBeNull()
    expect(body.sets).toHaveLength(2)
  })
})

/* ------------------------------------------------------------------ */
/* Round 18 Correction 1 — unreadable stored settings fail CLOSED      */
/* ------------------------------------------------------------------ */

describe('Correction 1 — a stored value we cannot trust is never a default', () => {
  /** Write a row exactly as a corrupt database would hold it. */
  function seedRow(
    fake: ReturnType<typeof createFakeD1>,
    googleSub: string,
    stored: unknown,
  ) {
    fake.accountSettings.set(googleSub, {
      google_sub: googleSub,
      foundation_start_date: stored as string | null,
      created_at: 1,
      updated_at: 1,
    })
  }

  it('A. no row at all reads as no preference', async () => {
    const fake = createFakeD1()
    const token = await seedToken(fake, 'sub-1', 'a@example.com')

    expect(fake.accountSettings.size).toBe(0)
    const { response, body } = await settings(fake.db, { token })
    expect(response.status).toBe(200)
    expect(body.foundationStartDate).toBeNull()
  })

  it('A. a stored NULL reads as no preference', async () => {
    const fake = createFakeD1()
    const token = await seedToken(fake, 'sub-1', 'a@example.com')
    seedRow(fake, 'sub-1', null)

    const { response, body } = await settings(fake.db, { token })
    expect(response.status).toBe(200)
    expect(body.foundationStartDate).toBeNull()
  })

  it('B. a valid stored date is used', async () => {
    const fake = createFakeD1()
    const token = await seedToken(fake, 'sub-1', 'a@example.com')
    seedRow(fake, 'sub-1', CUTOVER)

    const { response, body } = await settings(fake.db, { token })
    expect(response.status).toBe(200)
    expect(body.foundationStartDate).toBe(CUTOVER)
  })

  it.each([
    { why: 'shape-valid but impossible — passes the column GLOB', stored: '2026-02-30' as unknown },
    { why: 'impossible month', stored: '2026-13-01' },
    { why: 'not a leap year', stored: '2025-02-29' },
    { why: 'empty string', stored: '' },
    { why: 'not a date at all', stored: 'tomorrow' },
    { why: 'wrong type', stored: 42 },
    { why: 'a shape a future schema might introduce', stored: { date: '2026-09-01' } },
  ])('C. $why is a controlled error, never the legacy default', async ({ stored }) => {
    const fake = createFakeD1()
    const token = await seedToken(fake, 'sub-1', 'a@example.com')
    seedRow(fake, 'sub-1', stored)

    const { response, body } = await settings(fake.db, { token })

    // The whole point of the correction: refuse.
    expect(response.status).toBe(500)
    expect(body.error).toBe('settings_unreadable')
    // And above all, never manufacture the legacy date from corruption.
    expect(JSON.stringify(body)).not.toContain('2026-08-31')
    expect(body.foundationStartDate).toBeUndefined()
  })

  it('leaves Training and workout history fully usable when settings are corrupt', async () => {
    // The refusal must be contained. A Foundation day number is withheld; the
    // schedule, the session and its recorded sets are not settings-derived and
    // must keep working exactly as before.
    const fake = createFakeD1()
    const token = await seedToken(fake, 'sub-1', 'a@example.com')
    seedRow(fake, 'sub-1', '2026-02-30')

    const start = await handleWorkoutRequest(
      new Request(`${ORIGIN}/api/workouts/2026-09-07/monday/start`, {
        method: 'POST',
        headers: {
          Cookie: `vshape_session=${token}`,
          Origin: ORIGIN,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(MONDAY_BODY),
      }),
      makeEnv(fake.db),
    )
    expect(start?.status).toBe(201)

    const read = await handleWorkoutRequest(
      new Request(`${ORIGIN}/api/workouts/2026-09-07/monday`, {
        headers: { Cookie: `vshape_session=${token}` },
      }),
      makeEnv(fake.db),
    )
    expect(read?.status).toBe(200)
    const workout = (await read!.json()) as { sets: unknown[]; occurrence: unknown }
    expect(workout.occurrence).not.toBeNull()
    expect(workout.sets).toHaveLength(2)

    // Settings itself still refuses, so this is not passing because the row got
    // repaired somewhere along the way.
    expect((await settings(fake.db, { token })).response.status).toBe(500)
  })

  it('recovers the moment a valid date is saved over the corrupt one', async () => {
    const fake = createFakeD1()
    const token = await seedToken(fake, 'sub-1', 'a@example.com')
    seedRow(fake, 'sub-1', '2026-02-30')

    expect((await settings(fake.db, { token })).response.status).toBe(500)

    const saved = await settings(fake.db, {
      token,
      method: 'PUT',
      origin: ORIGIN,
      body: { foundationStartDate: CUTOVER },
    })
    expect(saved.response.status).toBe(200)
    expect(saved.body.foundationStartDate).toBe(CUTOVER)
    expect((await settings(fake.db, { token })).body.foundationStartDate).toBe(CUTOVER)
  })
})
