import { describe, expect, it, vi } from 'vitest'

import type { Env } from '../auth/config'
import { createD1SessionStore } from '../auth/d1Stores'
import { createSession } from '../auth/session'
import { handleHolidayRequest } from '../holiday/routes'
import { createFakeD1 } from './fakeD1'

/**
 * Round 11 — the Holiday Mode API.
 *
 * Holiday is EXEMPT, not missed. These assert the persistence and its two
 * hard rules: an account only ever touches its own records, and ranges for one
 * account never overlap — no merging, no splitting, no silent deletion.
 */

const ORIGIN = 'https://vshapev2.nkmwei.de'
const BASE = `${ORIGIN}/api/holidays`

function makeEnv(db: D1Database): Env {
  return { DB: db, ASSETS: {} as Fetcher, APP_ORIGIN: ORIGIN }
}

async function seedToken(db: D1Database, googleSub: string, email: string) {
  return (
    await createSession(createD1SessionStore(db), { googleSub, email, trusted: true })
  ).token
}

type ReqOptions = {
  token?: string
  method?: string
  origin?: string
  path?: string
  body?: unknown
  rawBody?: string
}

function request({ token, method = 'GET', origin, path = '', body, rawBody }: ReqOptions) {
  const headers: Record<string, string> = {}
  if (token) headers.Cookie = `vshape_session=${token}`
  if (origin) headers.Origin = origin
  const payload = rawBody ?? (body === undefined ? undefined : JSON.stringify(body))
  if (payload !== undefined) headers['Content-Type'] = 'application/json'
  return new Request(`${BASE}${path}`, { method, headers, body: payload })
}

async function call(db: D1Database, options: ReqOptions) {
  const response = await handleHolidayRequest(request(options), makeEnv(db))
  if (!response) throw new Error('handler did not claim the request')
  return { response, body: (await response.json()) as Record<string, never> }
}

/** Create a Holiday the ordinary way, so tests share the real write path. */
async function create(db: D1Database, token: string, startDate: string, endDate = startDate) {
  return call(db, {
    token,
    method: 'POST',
    origin: ORIGIN,
    body: { startDate, endDate },
  })
}

function idOf(body: Record<string, never>): string {
  return (body.holiday as unknown as { id: string }).id
}

async function list(db: D1Database, token: string, from = '2026-01-01', to = '2026-12-31') {
  return call(db, { token, path: `?from=${from}&to=${to}` })
}

function dates(body: Record<string, never>) {
  return (body.holidays as unknown as { startDate: string; endDate: string }[]).map(
    (h) => `${h.startDate}..${h.endDate}`,
  )
}

/**
 * Only the account's own custom ranges.
 *
 * The approved company calendar is part of every read now, so a test about
 * custom CRUD filters it out rather than restating 16 fixed dates.
 */
function customDates(body: Record<string, never>) {
  return (
    body.holidays as unknown as { startDate: string; endDate: string; source: string }[]
  )
    .filter((h) => h.source === 'custom')
    .map((h) => `${h.startDate}..${h.endDate}`)
}

/* ------------------------------------------------------------------ */
/* Auth and isolation                                                  */
/* ------------------------------------------------------------------ */

describe('authentication', () => {
  it('rejects an unauthenticated read', async () => {
    const { db } = createFakeD1()
    const { response, body } = await call(db, { path: '?from=2026-09-01&to=2026-09-30' })
    expect(response.status).toBe(401)
    expect(body.error).toBe('unauthenticated')
  })

  it('rejects every unauthenticated write', async () => {
    const { db } = createFakeD1()
    for (const options of [
      { method: 'POST', origin: ORIGIN, body: { startDate: '2026-09-01', endDate: '2026-09-01' } },
      { method: 'PUT', origin: ORIGIN, path: '/abc', body: { startDate: '2026-09-01', endDate: '2026-09-01' } },
      { method: 'DELETE', origin: ORIGIN, path: '/abc' },
    ]) {
      const { response } = await call(db, options)
      expect(response.status).toBe(401)
    }
  })

  it('marks every response no-store', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')
    const { response } = await list(db, token)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })

  it('blocks cross-origin writes', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')
    const created = await create(db, token, '2026-09-10')

    for (const options of [
      { method: 'POST', body: { startDate: '2026-10-01', endDate: '2026-10-01' } },
      { method: 'PUT', path: `/${idOf(created.body)}`, body: { startDate: '2026-09-11', endDate: '2026-09-11' } },
      { method: 'DELETE', path: `/${idOf(created.body)}` },
    ]) {
      const { response } = await call(db, { ...options, token, origin: 'https://evil.example.com' })
      expect(response.status).toBe(403)
    }
  })

  it('never echoes the account identity', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')
    const created = await create(db, token, '2026-09-10', '2026-09-14')
    expect(JSON.stringify(created.body)).not.toContain('sub-a')
    expect(JSON.stringify(created.body)).not.toContain('googleSub')
  })

  it('ignores a client-supplied account identity', async () => {
    const { db, holidays } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')
    await call(db, {
      token,
      method: 'POST',
      origin: ORIGIN,
      body: {
        startDate: '2026-09-10',
        endDate: '2026-09-10',
        googleSub: 'sub-b',
        google_sub: 'sub-b',
      },
    })
    expect([...holidays.values()][0].google_sub).toBe('sub-a')
  })
})

describe('account isolation', () => {
  async function twoAccounts() {
    const fake = createFakeD1()
    const tokenA = await seedToken(fake.db, 'sub-a', 'a@example.com')
    const tokenB = await seedToken(fake.db, 'sub-b', 'b@example.com')
    const aHoliday = await create(fake.db, tokenA, '2026-09-10', '2026-09-14')
    return { ...fake, tokenA, tokenB, aId: idOf(aHoliday.body) }
  }

  it('A cannot read B’s Holiday', async () => {
    const { db, tokenB } = await twoAccounts()
    const { body } = await list(db, tokenB)
    // B sees the shared company calendar, and none of A's own records.
    expect(customDates(body)).toEqual([])
  })

  it('A cannot edit B’s Holiday', async () => {
    const { db, tokenB, aId, holidays } = await twoAccounts()
    const { response, body } = await call(db, {
      token: tokenB,
      method: 'PUT',
      origin: ORIGIN,
      path: `/${aId}`,
      body: { startDate: '2026-12-01', endDate: '2026-12-02' },
    })

    expect(response.status).toBe(404)
    expect(body.error).toBe('holiday_not_found')
    // A's record is untouched.
    expect([...holidays.values()][0].start_date).toBe('2026-09-10')
  })

  it('A cannot delete B’s Holiday', async () => {
    const { db, tokenB, aId, holidays } = await twoAccounts()
    const { response } = await call(db, {
      token: tokenB,
      method: 'DELETE',
      origin: ORIGIN,
      path: `/${aId}`,
    })

    expect(response.status).toBe(404)
    expect(holidays.size).toBe(1)
  })

  it('the same dates can be Holiday for two accounts independently', async () => {
    const { db, tokenB } = await twoAccounts()
    const { response } = await create(db, tokenB, '2026-09-10', '2026-09-14')
    // Non-overlap is per account, not global.
    expect(response.status).toBe(201)
  })
})

/* ------------------------------------------------------------------ */
/* Create                                                              */
/* ------------------------------------------------------------------ */

describe('create', () => {
  it('stores a single-day Holiday', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')

    const { response, body } = await create(db, token, '2026-09-10')
    expect(response.status).toBe(201)
    expect(body.holiday).toMatchObject({ startDate: '2026-09-10', endDate: '2026-09-10' })
  })

  it('stores an inclusive multi-day range', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')

    const { body } = await create(db, token, '2026-09-10', '2026-09-14')
    expect(body.holiday).toMatchObject({ startDate: '2026-09-10', endDate: '2026-09-14' })

    // Inclusive: both ends are covered by a span that only touches them.
    expect(dates((await list(db, token, '2026-09-14', '2026-09-14')).body)).toHaveLength(1)
    expect(dates((await list(db, token, '2026-09-10', '2026-09-10')).body)).toHaveLength(1)
  })

  it('stores the local dates exactly as chosen', async () => {
    const { db, holidays } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')
    // A date that a UTC-midnight interpretation would shift a day earlier.
    await create(db, token, '2026-01-02')
    expect([...holidays.values()][0].start_date).toBe('2026-01-02')
  })
})

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

describe('validation', () => {
  async function authed() {
    const fake = createFakeD1()
    const token = await seedToken(fake.db, 'sub-a', 'a@example.com')
    return { ...fake, token }
  }

  it.each([
    ['malformed start', { startDate: '2026-9-1', endDate: '2026-09-10' }, 'startDate'],
    ['malformed end', { startDate: '2026-09-01', endDate: '10-09-2026' }, 'endDate'],
    ['impossible start', { startDate: '2026-02-30', endDate: '2026-03-01' }, 'startDate'],
    ['impossible end', { startDate: '2026-09-01', endDate: '2026-13-01' }, 'endDate'],
    ['start after end', { startDate: '2026-09-10', endDate: '2026-09-01' }, 'order'],
    ['missing dates', {}, 'startDate'],
  ])('rejects %s', async (_label, payload, field) => {
    const { db, token, holidays } = await authed()
    const { response, body } = await call(db, {
      token,
      method: 'POST',
      origin: ORIGIN,
      body: payload,
    })
    expect(response.status).toBe(400)
    expect(body.error).toBe('invalid_holiday')
    expect(body.field).toBe(field)
    expect(holidays.size).toBe(0)
  })

  it('rejects a non-object body', async () => {
    const { db, token } = await authed()
    for (const payload of [[], 'holiday', 42, null]) {
      const { response } = await call(db, { token, method: 'POST', origin: ORIGIN, body: payload })
      expect(response.status).toBe(400)
    }
  })

  it('rejects malformed JSON', async () => {
    const { db, token } = await authed()
    const { response, body } = await call(db, {
      token,
      method: 'POST',
      origin: ORIGIN,
      rawBody: '{ not json',
    })
    expect(response.status).toBe(400)
    expect(body.error).toBe('invalid_json')
  })

  it('rejects an absurdly long range', async () => {
    const { db, token } = await authed()
    const { response, body } = await call(db, {
      token,
      method: 'POST',
      origin: ORIGIN,
      body: { startDate: '2026-01-01', endDate: '2030-01-01' },
    })
    expect(response.status).toBe(400)
    expect(body.field).toBe('length')
  })

  it('rejects a malformed or unbounded list span', async () => {
    const { db, token } = await authed()
    for (const query of [
      '?from=2026-9-1&to=2026-09-30',
      '?from=2026-09-01&to=notadate',
      '?from=2026-09-30&to=2026-09-01',
      '?from=2020-01-01&to=2030-01-01',
      '',
    ]) {
      const { response, body } = await call(db, { token, path: query })
      expect(response.status, query).toBe(400)
      expect(body.error).toBe('invalid_range')
    }
  })

  it('rejects a malformed id', async () => {
    const { db, token } = await authed()
    const { response, body } = await call(db, {
      token,
      method: 'DELETE',
      origin: ORIGIN,
      path: '/not a valid id!',
    })
    expect(response.status).toBe(400)
    expect(body.error).toBe('invalid_holiday_id')
  })

  it('rejects the wrong method', async () => {
    const { db, token } = await authed()
    expect((await call(db, { token, method: 'DELETE', origin: ORIGIN })).response.status).toBe(405)
    expect((await call(db, { token, method: 'POST', origin: ORIGIN, path: '/abc' })).response.status).toBe(405)
  })
})

/* ------------------------------------------------------------------ */
/* Overlap                                                             */
/* ------------------------------------------------------------------ */

describe('overlap', () => {
  async function withRange() {
    const fake = createFakeD1()
    const token = await seedToken(fake.db, 'sub-a', 'a@example.com')
    const created = await create(fake.db, token, '2026-09-10', '2026-09-14')
    return { ...fake, token, id: idOf(created.body) }
  }

  it.each([
    ['partial overlap at the start', '2026-09-08', '2026-09-11'],
    ['partial overlap at the end', '2026-09-13', '2026-09-15'],
    ['fully contained', '2026-09-11', '2026-09-12'],
    ['fully enclosing', '2026-09-01', '2026-09-15'],
    ['identical', '2026-09-10', '2026-09-14'],
    ['single day inside', '2026-09-12', '2026-09-12'],
  ])('rejects a create that is %s', async (_label, startDate, endDate) => {
    const { db, token, holidays } = await withRange()
    const { response, body } = await call(db, {
      token,
      method: 'POST',
      origin: ORIGIN,
      body: { startDate, endDate },
    })

    expect(response.status).toBe(409)
    expect(body.error).toBe('holiday_conflict')
    expect(body.conflict).toMatchObject({ startDate: '2026-09-10', endDate: '2026-09-14' })
    // Nothing merged, nothing split, nothing deleted.
    expect(holidays.size).toBe(1)
  })

  it('allows adjacent ranges', async () => {
    const { db, token, holidays } = await withRange()

    const before = await create(db, token, '2026-09-08', '2026-09-09')
    const after = await create(db, token, '2026-09-15', '2026-09-15')

    expect(before.response.status).toBe(201)
    expect(after.response.status).toBe(201)
    expect(holidays.size).toBe(3)
  })

  it('rejects an edit that moves a range onto another', async () => {
    const { db, token, id } = await withRange()
    await create(db, token, '2026-09-20', '2026-09-22')

    const { response, body } = await call(db, {
      token,
      method: 'PUT',
      origin: ORIGIN,
      path: `/${id}`,
      body: { startDate: '2026-09-19', endDate: '2026-09-21' },
    })

    expect(response.status).toBe(409)
    expect(body.conflict).toMatchObject({ startDate: '2026-09-20' })
  })

  it('does not treat a record as overlapping itself', async () => {
    const { db, token, id } = await withRange()

    // Saving the identical range, and a range still covering its own days.
    for (const payload of [
      { startDate: '2026-09-10', endDate: '2026-09-14' },
      { startDate: '2026-09-11', endDate: '2026-09-13' },
      { startDate: '2026-09-09', endDate: '2026-09-15' },
    ]) {
      const { response } = await call(db, {
        token,
        method: 'PUT',
        origin: ORIGIN,
        path: `/${id}`,
        body: payload,
      })
      expect(response.status, JSON.stringify(payload)).toBe(200)
    }
  })
})

/* ------------------------------------------------------------------ */
/* Update                                                              */
/* ------------------------------------------------------------------ */

describe('update', () => {
  async function withRange() {
    const fake = createFakeD1()
    const token = await seedToken(fake.db, 'sub-a', 'a@example.com')
    const created = await create(fake.db, token, '2026-09-10', '2026-09-14')
    return { ...fake, token, id: idOf(created.body) }
  }

  it('shortens a range', async () => {
    const { db, token, id } = await withRange()
    const { response, body } = await call(db, {
      token,
      method: 'PUT',
      origin: ORIGIN,
      path: `/${id}`,
      body: { startDate: '2026-09-10', endDate: '2026-09-12' },
    })

    expect(response.status).toBe(200)
    expect(body.holiday).toMatchObject({ startDate: '2026-09-10', endDate: '2026-09-12' })
    // The dropped days no longer have an override.
    expect(dates((await list(db, token, '2026-09-13', '2026-09-14')).body)).toEqual([])
  })

  it('extends a range', async () => {
    const { db, token, id } = await withRange()
    await call(db, {
      token,
      method: 'PUT',
      origin: ORIGIN,
      path: `/${id}`,
      body: { startDate: '2026-09-08', endDate: '2026-09-15' },
    })
    expect(customDates((await list(db, token)).body)).toEqual(['2026-09-08..2026-09-15'])
  })

  it('moves a range', async () => {
    const { db, token, id, holidays } = await withRange()
    await call(db, {
      token,
      method: 'PUT',
      origin: ORIGIN,
      path: `/${id}`,
      body: { startDate: '2026-10-01', endDate: '2026-10-03' },
    })

    expect(customDates((await list(db, token)).body)).toEqual(['2026-10-01..2026-10-03'])
    // Moved, not duplicated.
    expect(holidays.size).toBe(1)
  })

  it('keeps the original createdAt', async () => {
    const { db, token, id, holidays } = await withRange()
    const createdAt = [...holidays.values()][0].created_at
    await call(db, {
      token,
      method: 'PUT',
      origin: ORIGIN,
      path: `/${id}`,
      body: { startDate: '2026-09-11', endDate: '2026-09-13' },
    })
    expect([...holidays.values()][0].created_at).toBe(createdAt)
  })

  it('404s an unknown id', async () => {
    const { db, token } = await withRange()
    const { response, body } = await call(db, {
      token,
      method: 'PUT',
      origin: ORIGIN,
      path: '/00000000-0000-0000-0000-000000000000',
      body: { startDate: '2026-11-01', endDate: '2026-11-02' },
    })
    expect(response.status).toBe(404)
    expect(body.error).toBe('holiday_not_found')
  })
})

/* ------------------------------------------------------------------ */
/* Delete                                                              */
/* ------------------------------------------------------------------ */

describe('delete', () => {
  it('deletes an owned record and the dates revert to no override', async () => {
    const { db, holidays } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')
    const created = await create(db, token, '2026-09-10', '2026-09-14')

    const { response, body } = await call(db, {
      token,
      method: 'DELETE',
      origin: ORIGIN,
      path: `/${idOf(created.body)}`,
    })

    expect(response.status).toBe(200)
    expect(body.deleted).toBe(true)
    expect(holidays.size).toBe(0)
    // The account's own record is gone; the company calendar is untouched.
    expect(customDates((await list(db, token)).body)).toEqual([])
  })

  it('404s an unknown id rather than reporting success', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')
    const { response, body } = await call(db, {
      token,
      method: 'DELETE',
      origin: ORIGIN,
      path: '/00000000-0000-0000-0000-000000000000',
    })
    expect(response.status).toBe(404)
    expect(body.error).toBe('holiday_not_found')
  })

  it('leaves other ranges alone', async () => {
    const { db, holidays } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')
    const first = await create(db, token, '2026-09-01', '2026-09-02')
    await create(db, token, '2026-09-10', '2026-09-12')

    await call(db, { token, method: 'DELETE', origin: ORIGIN, path: `/${idOf(first.body)}` })
    expect(customDates((await list(db, token)).body)).toEqual(['2026-09-10..2026-09-12'])
    expect(holidays.size).toBe(1)
  })
})

/* ------------------------------------------------------------------ */
/* Read                                                                */
/* ------------------------------------------------------------------ */

describe('read', () => {
  async function seeded() {
    const fake = createFakeD1()
    const token = await seedToken(fake.db, 'sub-a', 'a@example.com')
    await create(fake.db, token, '2026-09-10', '2026-09-14')
    // Spans a month boundary. September into October, because every
    // August-into-September range would cross Merdeka Day.
    await create(fake.db, token, '2026-09-28', '2026-10-02')
    await create(fake.db, token, '2026-11-01', '2026-11-03')
    return { ...fake, token }
  }

  it('returns only ranges intersecting the requested span', async () => {
    const { db, token } = await seeded()
    const { body } = await list(db, token, '2026-09-01', '2026-09-30')
    // Malaysia Day is an approved company date inside the span, so it is part
    // of the answer — one model, both sources.
    expect(dates(body)).toEqual([
      '2026-09-10..2026-09-14',
      '2026-09-16..2026-09-16',
      '2026-09-28..2026-10-02',
    ])
  })

  it('includes a range that only clips the edge of the span', async () => {
    const { db, token } = await seeded()
    // The span touches only the final day of the month-spanning range.
    expect(dates((await list(db, token, '2026-10-02', '2026-10-02')).body)).toEqual([
      '2026-09-28..2026-10-02',
    ])
  })

  it('excludes a range that ends the day before the span', async () => {
    const { db, token } = await seeded()
    expect(dates((await list(db, token, '2026-09-03', '2026-09-09')).body)).toEqual([])
  })

  it('is deterministic and stable', async () => {
    const { db, token } = await seeded()
    // A span with no approved company date in it, so the order under test is
    // the custom ordering alone.
    const first = dates((await list(db, token, '2026-09-17', '2026-11-07')).body)
    const second = dates((await list(db, token, '2026-09-17', '2026-11-07')).body)
    expect(first).toEqual(second)
    expect(first).toEqual(['2026-09-28..2026-10-02', '2026-11-01..2026-11-03'])
  })

  it('returns an empty list honestly', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')
    // A window the approved calendar leaves clear, so empty really is empty.
    const { response, body } = await list(db, token, '2026-09-01', '2026-09-10')
    expect(response.status).toBe(200)
    expect(body.holidays).toEqual([])
  })
})

/* ------------------------------------------------------------------ */
/* Storage failure                                                     */
/* ------------------------------------------------------------------ */

describe('storage failure', () => {
  it('reports a controlled 500 without leaking internals', async () => {
    const { db, breakHolidays } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')
    breakHolidays(new Error('D1 exploded: SELECT FROM holiday_overrides'))
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { response, body } = await list(db, token)
    expect(response.status).toBe(500)
    expect(body.error).toBe('server_error')
    expect(JSON.stringify(body)).not.toContain('SELECT')
    errors.mockRestore()
  })
})

/* ------------------------------------------------------------------ */
/* Round 13 — name and training on a custom Holiday                    */
/* ------------------------------------------------------------------ */

describe('custom name and training', () => {
  async function make(
    db: D1Database,
    token: string,
    body: Record<string, unknown>,
  ) {
    return call(db, { token, method: 'POST', origin: ORIGIN, body })
  }

  it('stores a name and reads it back', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')

    const created = await make(db, token, {
      startDate: '2026-10-05',
      endDate: '2026-10-09',
      name: 'Family trip',
    })
    expect(created.response.status).toBe(201)
    expect(created.body.holiday).toMatchObject({ name: 'Family trip', source: 'custom' })

    const listed = (await list(db, token, '2026-10-01', '2026-10-31')).body
    expect((listed.holidays as unknown as { name: string }[])[0].name).toBe('Family trip')
  })

  it('defaults to no name and Training Off', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')

    const created = await make(db, token, { startDate: '2026-10-05', endDate: '2026-10-05' })
    expect(created.body.holiday).toMatchObject({ name: '', trainingOn: false })
  })

  it('trims a name and refuses one that is too long', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')

    const trimmed = await make(db, token, {
      startDate: '2026-10-05',
      endDate: '2026-10-05',
      name: '   Family trip   ',
    })
    expect(trimmed.body.holiday).toMatchObject({ name: 'Family trip' })

    const long = await make(db, token, {
      startDate: '2026-10-07',
      endDate: '2026-10-07',
      name: 'x'.repeat(81),
    })
    expect(long.response.status).toBe(400)
    expect(long.body.field).toBe('name')
  })

  it('keeps a training preference across a re-read', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')
    const created = await make(db, token, {
      startDate: '2026-10-05',
      endDate: '2026-10-09',
      name: 'Working trip',
      trainingOn: true,
    })
    expect(created.body.holiday).toMatchObject({ trainingOn: true })

    const listed = (await list(db, token, '2026-10-01', '2026-10-31')).body
    expect((listed.holidays as unknown as { trainingOn: boolean }[])[0].trainingOn).toBe(true)
  })

  it('toggles training through the shared endpoint', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')
    const created = await make(db, token, { startDate: '2026-10-05', endDate: '2026-10-09' })
    const id = (created.body.holiday as unknown as { id: string }).id

    const on = await call(db, {
      token,
      method: 'PUT',
      origin: ORIGIN,
      path: `/${id}/training`,
      body: { trainingOn: true },
    })
    expect(on.response.status).toBe(200)
    expect(on.body.holiday).toMatchObject({ trainingOn: true })

    // Toggling training must not move or rename the Holiday.
    expect(on.body.holiday).toMatchObject({ startDate: '2026-10-05', endDate: '2026-10-09' })
  })

  it('refuses Training On for a weekend-only custom Holiday', async () => {
    const { db, holidays } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')

    // 2026-10-10 is a Saturday and 2026-10-11 a Sunday.
    const created = await make(db, token, {
      startDate: '2026-10-10',
      endDate: '2026-10-11',
      trainingOn: true,
    })
    expect(created.response.status).toBe(400)
    expect(created.body.field).toBe('training')
    expect(holidays.size).toBe(0)
  })

  it('refuses to switch a weekend-only Holiday on afterwards', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')
    const created = await make(db, token, { startDate: '2026-10-10', endDate: '2026-10-11' })
    const id = (created.body.holiday as unknown as { id: string }).id

    const { response, body } = await call(db, {
      token,
      method: 'PUT',
      origin: ORIGIN,
      path: `/${id}/training`,
      body: { trainingOn: true },
    })
    expect(response.status).toBe(400)
    expect(body.error).toBe('holiday_not_trainable')
  })

  it('allows Training On for a range that includes a weekday', async () => {
    const { db } = createFakeD1()
    const token = await seedToken(db, 'sub-a', 'a@example.com')
    // Saturday through Monday: the Monday is the day that can train.
    const created = await make(db, token, {
      startDate: '2026-10-10',
      endDate: '2026-10-12',
      trainingOn: true,
    })
    expect(created.response.status).toBe(201)
    expect(created.body.holiday).toMatchObject({ trainingOn: true })
  })

  it('never lets one account set another"s training preference', async () => {
    const { db } = createFakeD1()
    const a = await seedToken(db, 'sub-a', 'a@example.com')
    const b = await seedToken(db, 'sub-b', 'b@example.com')

    const created = await make(db, a, { startDate: '2026-10-05', endDate: '2026-10-09' })
    const id = (created.body.holiday as unknown as { id: string }).id

    const { response, body } = await call(db, {
      token: b,
      method: 'PUT',
      origin: ORIGIN,
      path: `/${id}/training`,
      body: { trainingOn: true },
    })
    expect(response.status).toBe(404)
    expect(body.error).toBe('holiday_not_found')

    const mine = (await list(db, a, '2026-10-01', '2026-10-31')).body
    expect((mine.holidays as unknown as { trainingOn: boolean }[])[0].trainingOn).toBe(false)
  })
})
