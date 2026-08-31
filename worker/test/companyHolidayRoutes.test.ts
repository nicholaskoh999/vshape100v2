import { describe, expect, it } from 'vitest'

import type { Env } from '../auth/config'
import { createD1SessionStore } from '../auth/d1Stores'
import { createSession } from '../auth/session'
import { handleHolidayRequest } from '../holiday/routes'
import { createFakeD1 } from './fakeD1'

/**
 * Round 13 — company Holidays and the Training preference.
 *
 * The company calendar is global and canonical: seeded once for everyone, its
 * dates and names not the account's to move, rename or delete. Only the
 * Training choice belongs to the account, and it is written through exactly
 * one endpoint so the weekend rule cannot be reached around.
 *
 * Approved dates used below:
 *   2026-08-31  Merdeka Day        Monday   (trainable)
 *   2026-09-16  Malaysia Day       Wednesday
 *   2026-11-08  Deepavali          Sunday   (never trainable)
 */

const ORIGIN = 'https://vshapev2.nkmwei.de'
const BASE = `${ORIGIN}/api/holidays`

const MERDEKA = 'company:2026-08-31'
const MALAYSIA_DAY = 'company:2026-09-16'
const DEEPAVALI_SUNDAY = 'company:2026-11-08'

function makeEnv(db: D1Database): Env {
  return { DB: db, ASSETS: {} as Fetcher, APP_ORIGIN: ORIGIN }
}

async function seedToken(db: D1Database, googleSub: string, email: string) {
  return (
    await createSession(createD1SessionStore(db), { googleSub, email, trusted: true })
  ).token
}

type CallOptions = {
  token?: string
  method?: string
  path?: string
  body?: unknown
  origin?: string
  query?: string
}

async function call(db: D1Database, options: CallOptions = {}) {
  const headers: Record<string, string> = {}
  if (options.token) headers.Cookie = `vshape_session=${options.token}`
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'
  if (options.origin) headers.Origin = options.origin

  const url = `${BASE}${options.path ?? ''}${options.query ?? ''}`
  const request = new Request(url, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })

  const response = await handleHolidayRequest(request, makeEnv(db))
  if (!response) throw new Error('handler did not claim the request')
  return { response, body: (await response.json()) as Record<string, never> }
}

type PublicHoliday = {
  id: string
  startDate: string
  endDate: string
  name: string
  source: string
  trainingOn: boolean
}

function holidaysIn(body: Record<string, never>): PublicHoliday[] {
  return body.holidays as unknown as PublicHoliday[]
}

async function list(db: D1Database, token: string, from: string, to: string) {
  return call(db, { token, query: `?from=${from}&to=${to}` })
}

/** Set the Training preference for a Holiday. */
async function setTraining(
  db: D1Database,
  token: string,
  id: string,
  trainingOn: boolean,
) {
  return call(db, {
    token,
    method: 'PUT',
    origin: ORIGIN,
    path: `/${encodeURIComponent(id)}/training`,
    body: { trainingOn },
  })
}

/* ------------------------------------------------------------------ */
/* 1. The calendar is visible to every account                         */
/* ------------------------------------------------------------------ */

describe('1. company calendar reads', () => {
  it('returns the approved dates with their names', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')

    const { body } = await list(db, token, '2026-08-01', '2026-09-30')
    const found = holidaysIn(body).filter((row) => row.source === 'company')

    expect(found.map((row) => [row.startDate, row.name])).toEqual([
      ['2026-08-31', 'Merdeka Day'],
      ['2026-09-16', 'Malaysia Day'],
    ])
  })

  it('returns only the dates intersecting the requested span', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')

    const { body } = await list(db, token, '2026-09-01', '2026-09-30')
    expect(holidaysIn(body).map((row) => row.startDate)).toEqual(['2026-09-16'])
  })

  it('shows every account the same calendar, with no seeding on read', async () => {
    const { db, companyPreferences } = createFakeD1()
    const a = await seedToken(db, 'sub-a', 'a@example.com')
    const b = await seedToken(db, 'sub-b', 'b@example.com')

    const forA = holidaysIn((await list(db, a, '2026-08-01', '2026-09-30')).body)
    const forB = holidaysIn((await list(db, b, '2026-08-01', '2026-09-30')).body)
    expect(forA).toEqual(forB)

    // A GET must never write. Nothing was created to answer either read.
    expect(companyPreferences.size).toBe(0)
  })

  it('requires a session', async () => {
    const { db } = createFakeD1()
    const { response, body } = await call(db, { query: '?from=2026-08-01&to=2026-09-30' })
    expect(response.status).toBe(401)
    expect(body.error).toBe('unauthenticated')
  })
})

/* ------------------------------------------------------------------ */
/* 2. Training preference                                              */
/* ------------------------------------------------------------------ */

describe('2. training preference', () => {
  it('defaults every company Holiday to Training Off', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')

    const { body } = await list(db, token, '2026-01-01', '2026-12-31')
    for (const row of holidaysIn(body)) {
      expect(row.trainingOn, row.startDate).toBe(false)
    }
  })

  it('turns training on for a weekday company Holiday', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')

    const { response, body } = await setTraining(db, token, MERDEKA, true)
    expect(response.status).toBe(200)
    expect(body.holiday).toMatchObject({
      id: MERDEKA,
      startDate: '2026-08-31',
      name: 'Merdeka Day',
      source: 'company',
      trainingOn: true,
    })
  })

  it('survives a re-read', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')
    await setTraining(db, token, MERDEKA, true)

    const { body } = await list(db, token, '2026-08-31', '2026-08-31')
    expect(holidaysIn(body)[0]).toMatchObject({ trainingOn: true, name: 'Merdeka Day' })
  })

  it('can be turned back off', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')
    await setTraining(db, token, MERDEKA, true)
    await setTraining(db, token, MERDEKA, false)

    const { body } = await list(db, token, '2026-08-31', '2026-08-31')
    expect(holidaysIn(body)[0].trainingOn).toBe(false)
  })

  it('is account-scoped: one account cannot change another"s', async () => {
    const { db } = createFakeD1()
    const a = await seedToken(db, 'sub-a', 'a@example.com')
    const b = await seedToken(db, 'sub-b', 'b@example.com')

    await setTraining(db, a, MERDEKA, true)

    const forB = holidaysIn((await list(db, b, '2026-08-31', '2026-08-31')).body)
    expect(forB[0].trainingOn).toBe(false)

    const forA = holidaysIn((await list(db, a, '2026-08-31', '2026-08-31')).body)
    expect(forA[0].trainingOn).toBe(true)
  })

  it('refuses Training On for a weekend company Holiday', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')

    // Deepavali 2026 falls on a Sunday: there is no planned session to
    // restore, so the preference is refused rather than stored and ignored.
    const { response, body } = await setTraining(db, token, DEEPAVALI_SUNDAY, true)
    expect(response.status).toBe(400)
    expect(body.error).toBe('holiday_not_trainable')

    const listed = holidaysIn((await list(db, token, '2026-11-08', '2026-11-08')).body)
    expect(listed[0].trainingOn).toBe(false)
  })

  it('allows Training Off for a weekend company Holiday', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')
    const { response } = await setTraining(db, token, DEEPAVALI_SUNDAY, false)
    expect(response.status).toBe(200)
  })

  it('404s an unapproved date rather than inventing a Holiday', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')
    const { response, body } = await setTraining(db, token, 'company:2026-07-04', true)
    expect(response.status).toBe(404)
    expect(body.error).toBe('holiday_not_found')
  })

  it('requires a session', async () => {
    const { db } = createFakeD1()
    const { response } = await call(db, {
      method: 'PUT',
      origin: ORIGIN,
      path: `/${encodeURIComponent(MERDEKA)}/training`,
      body: { trainingOn: true },
    })
    expect(response.status).toBe(401)
  })

  it('rejects a cross-origin write', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')
    const { response, body } = await call(db, {
      token,
      method: 'PUT',
      origin: 'https://evil.example',
      path: `/${encodeURIComponent(MERDEKA)}/training`,
      body: { trainingOn: true },
    })
    expect(response.status).toBe(403)
    expect(body.error).toBe('forbidden')
  })

  it('rejects a body that does not state a boolean', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')
    for (const body of [{}, { trainingOn: 'yes' }, { trainingOn: 1 }, []]) {
      const { response } = await call(db, {
        token,
        method: 'PUT',
        origin: ORIGIN,
        path: `/${encodeURIComponent(MERDEKA)}/training`,
        body,
      })
      expect(response.status, JSON.stringify(body)).toBe(400)
    }
  })

  it('accepts no account identity from the caller', async () => {
    const { db } = createFakeD1()
    const a = await seedToken(db, 'sub-a', 'a@example.com')
    const b = await seedToken(db, 'sub-b', 'b@example.com')

    // Naming another account in the body changes nothing: identity comes only
    // from the session, and these fields are not read at all.
    await call(db, {
      token: b,
      method: 'PUT',
      origin: ORIGIN,
      path: `/${encodeURIComponent(MERDEKA)}/training`,
      body: { trainingOn: true, googleSub: 'sub-a', google_sub: 'sub-a', account: 'sub-a' },
    })

    const forA = holidaysIn((await list(db, a, '2026-08-31', '2026-08-31')).body)
    expect(forA[0].trainingOn).toBe(false)
  })

  it('rejects a write method the sub-resource does not have', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')
    for (const method of ['POST', 'DELETE', 'GET']) {
      const { response } = await call(db, {
        token,
        method,
        origin: ORIGIN,
        path: `/${encodeURIComponent(MERDEKA)}/training`,
        body: method === 'GET' ? undefined : { trainingOn: true },
      })
      expect(response.status, method).toBe(405)
    }
  })
})

/* ------------------------------------------------------------------ */
/* 3. A company date is canonical                                      */
/* ------------------------------------------------------------------ */

describe('3. company dates are immutable', () => {
  it('refuses to move or rename one', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')

    const { response, body } = await call(db, {
      token,
      method: 'PUT',
      origin: ORIGIN,
      path: `/${encodeURIComponent(MERDEKA)}`,
      body: { startDate: '2026-08-20', endDate: '2026-08-21', name: 'Renamed' },
    })

    expect(response.status).toBe(403)
    expect(body.error).toBe('holiday_immutable')

    // Unchanged where it belongs.
    const listed = holidaysIn((await list(db, token, '2026-08-31', '2026-08-31')).body)
    expect(listed[0]).toMatchObject({ startDate: '2026-08-31', name: 'Merdeka Day' })
  })

  it('refuses to delete one', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')

    const { response, body } = await call(db, {
      token,
      method: 'DELETE',
      origin: ORIGIN,
      path: `/${encodeURIComponent(MALAYSIA_DAY)}`,
    })

    expect(response.status).toBe(403)
    expect(body.error).toBe('holiday_immutable')
    expect(holidaysIn((await list(db, token, '2026-09-16', '2026-09-16')).body)).toHaveLength(1)
  })
})

/* ------------------------------------------------------------------ */
/* 4. Custom Holidays may not sit on a company date                    */
/* ------------------------------------------------------------------ */

describe('4. company owns its dates', () => {
  async function createCustom(
    db: D1Database,
    token: string,
    startDate: string,
    endDate = startDate,
  ) {
    return call(db, {
      token,
      method: 'POST',
      origin: ORIGIN,
      body: { startDate, endDate },
    })
  }

  it('refuses a custom Holiday landing exactly on one', async () => {
    const { db, holidays } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')

    const { response, body } = await createCustom(db, token, '2026-08-31')
    expect(response.status).toBe(409)
    expect(body.error).toBe('holiday_conflict')
    expect(body.conflict).toMatchObject({
      startDate: '2026-08-31',
      name: 'Merdeka Day',
      source: 'company',
    })
    expect(holidays.size).toBe(0)
  })

  it('refuses a custom range that merely spans one', async () => {
    const { db, holidays } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')

    const { response } = await createCustom(db, token, '2026-08-28', '2026-09-02')
    expect(response.status).toBe(409)
    expect(holidays.size).toBe(0)
  })

  it('allows a custom range that stops the day before one', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')
    const { response } = await createCustom(db, token, '2026-08-28', '2026-08-30')
    expect(response.status).toBe(201)
  })

  it('refuses an edit that moves a custom range onto one', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')
    const created = await createCustom(db, token, '2026-08-20', '2026-08-21')
    const id = (created.body.holiday as unknown as { id: string }).id

    const { response, body } = await call(db, {
      token,
      method: 'PUT',
      origin: ORIGIN,
      path: `/${id}`,
      body: { startDate: '2026-08-30', endDate: '2026-08-31' },
    })

    expect(response.status).toBe(409)
    expect(body.conflict).toMatchObject({ name: 'Merdeka Day' })
  })

  it('never touches recorded workout data', async () => {
    const { db, occurrences, workoutSets } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')

    // Reads, a preference write, and a refused create.
    await list(db, token, '2026-08-01', '2026-09-30')
    await setTraining(db, token, MERDEKA, true)
    await createCustom(db, token, '2026-08-31')
    await list(db, token, '2026-08-01', '2026-09-30')

    // Holiday state is a different thing from what was trained. Nothing here
    // may create, delete or rewrite a workout - including on Merdeka Day,
    // where a real recorded session already exists in production.
    expect(occurrences.size).toBe(0)
    expect(workoutSets.size).toBe(0)
  })

  it('leaves the calendar with one Holiday truth per date', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')
    await createCustom(db, token, '2026-08-31')

    const listed = holidaysIn((await list(db, token, '2026-08-31', '2026-08-31')).body)
    expect(listed).toHaveLength(1)
    expect(listed[0].source).toBe('company')
  })
})
