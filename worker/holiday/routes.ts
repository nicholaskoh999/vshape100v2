/**
 * Holiday Mode HTTP surface.
 *
 *   GET    /api/holidays?from=YYYY-MM-DD&to=YYYY-MM-DD
 *   POST   /api/holidays
 *   PUT    /api/holidays/:id
 *   DELETE /api/holidays/:id
 *
 * Every route requires the existing app-owned session. The account is always
 * the `google_sub` on that session — the client never supplies an identity,
 * and one is never read from a body, query string or header. `google_sub` is
 * part of every lookup, so another account's record is simply not found.
 *
 * Session handling, the same-origin guard, the JSON envelope and the rolling
 * Set-Cookie propagation come from ../http/authenticated, shared with Today,
 * exercise media and workouts.
 */

import type { Env } from '../auth/config'
import {
  isCrossOrigin,
  json,
  requireAccount,
  withSessionHeaders,
} from '../http/authenticated'
import { createD1HolidayStore } from './d1Store'
import {
  createHoliday,
  deleteHoliday,
  listHolidays,
  parseHolidayId,
  parseHolidayInput,
  updateHoliday,
  MAX_HOLIDAY_RANGE_DAYS,
  type HolidayRecord,
  type HolidayStore,
} from './holiday'
import { daysBetween, isLocalDate } from '../../shared/localDate'

const COLLECTION = '/api/holidays'

/** The public shape of one Holiday. No identity is echoed back. */
function toPublicHoliday(record: HolidayRecord) {
  return {
    id: record.id,
    startDate: record.startDate,
    endDate: record.endDate,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

/** A bounded, valid `from`/`to` span, or null. */
function parseSpan(url: URL): { from: string; to: string } | null {
  const from = url.searchParams.get('from')
  const to = url.searchParams.get('to')
  if (!isLocalDate(from) || !isLocalDate(to)) return null
  if (from > to) return null

  const gap = daysBetween(from, to)
  // Bounded: a caller cannot ask the database to walk everything.
  if (gap === null || gap + 1 > MAX_HOLIDAY_RANGE_DAYS) return null
  return { from, to }
}

/** GET /api/holidays?from=&to= */
async function handleList(
  request: Request,
  store: HolidayStore,
  googleSub: string,
): Promise<Response> {
  const span = parseSpan(new URL(request.url))
  if (!span) return json({ error: 'invalid_range' }, { status: 400 })

  const records = await listHolidays(store, googleSub, span.from, span.to)
  return json({ from: span.from, to: span.to, holidays: records.map(toPublicHoliday) })
}

/** POST /api/holidays */
async function handleCreate(
  request: Request,
  store: HolidayStore,
  googleSub: string,
): Promise<Response> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return json({ error: 'invalid_json' }, { status: 400 })
  }

  const parsed = parseHolidayInput(body)
  if (!parsed.ok) {
    return json({ error: 'invalid_holiday', field: parsed.field }, { status: 400 })
  }

  const outcome = await createHoliday(store, googleSub, parsed.value)
  if (!outcome.ok) {
    // Ranges never merge, so an overlap is reported rather than absorbed.
    return json(
      { error: 'holiday_conflict', conflict: toPublicHoliday(outcome.conflict) },
      { status: 409 },
    )
  }
  return json({ holiday: toPublicHoliday(outcome.record) }, { status: 201 })
}

/** PUT /api/holidays/:id */
async function handleUpdate(
  request: Request,
  store: HolidayStore,
  googleSub: string,
  id: string,
): Promise<Response> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return json({ error: 'invalid_json' }, { status: 400 })
  }

  const parsed = parseHolidayInput(body)
  if (!parsed.ok) {
    return json({ error: 'invalid_holiday', field: parsed.field }, { status: 400 })
  }

  const outcome = await updateHoliday(store, googleSub, id, parsed.value)
  if (!outcome.ok) {
    if (outcome.reason === 'not_found') {
      return json({ error: 'holiday_not_found' }, { status: 404 })
    }
    return json(
      { error: 'holiday_conflict', conflict: toPublicHoliday(outcome.conflict) },
      { status: 409 },
    )
  }
  return json({ holiday: toPublicHoliday(outcome.record) })
}

/** DELETE /api/holidays/:id */
async function handleDelete(
  store: HolidayStore,
  googleSub: string,
  id: string,
): Promise<Response> {
  const outcome = await deleteHoliday(store, googleSub, id)
  if (!outcome.ok) return json({ error: 'holiday_not_found' }, { status: 404 })
  // The dates it covered now have no override, so they fall back to the
  // normal Home-derived route.
  return json({ id, deleted: true })
}

/**
 * Route the Holiday API. Returns null when the request is not ours, so the
 * Worker can fall through to static assets.
 */
export async function handleHolidayRequest(
  request: Request,
  env: Env,
): Promise<Response | null> {
  const { pathname } = new URL(request.url)
  const isCollection = pathname === COLLECTION
  const isItem = pathname.startsWith(`${COLLECTION}/`)
  if (!isCollection && !isItem) return null

  // Any Set-Cookie the session resolution produced has to survive every exit
  // path below, including the error one.
  let sessionHeaders: HeadersInit = {}

  try {
    const method = request.method

    if (isCollection && method !== 'GET' && method !== 'POST') {
      return json({ error: 'method_not_allowed' }, { status: 405 })
    }
    if (isItem && method !== 'PUT' && method !== 'DELETE') {
      return json({ error: 'method_not_allowed' }, { status: 405 })
    }

    const account = await requireAccount(request, env)
    if ('response' in account) return account.response
    sessionHeaders = account.headers

    // Every write is state-changing, so it carries the same same-origin guard
    // the rest of the API applies. Reads are not guarded, matching them.
    if (method !== 'GET' && isCrossOrigin(request)) {
      return withSessionHeaders(json({ error: 'forbidden' }, { status: 403 }), sessionHeaders)
    }

    const store = createD1HolidayStore(env.DB)

    if (isCollection) {
      return withSessionHeaders(
        method === 'GET'
          ? await handleList(request, store, account.googleSub)
          : await handleCreate(request, store, account.googleSub),
        sessionHeaders,
      )
    }

    const rawId = pathname.slice(COLLECTION.length + 1)
    // Nothing is nested under a Holiday, so a deeper path is a route that does
    // not exist rather than a malformed id.
    if (rawId.includes('/')) {
      return withSessionHeaders(json({ error: 'not_found' }, { status: 404 }), sessionHeaders)
    }

    let decoded: string
    try {
      decoded = decodeURIComponent(rawId)
    } catch {
      return withSessionHeaders(
        json({ error: 'invalid_holiday_id' }, { status: 400 }),
        sessionHeaders,
      )
    }

    const id = parseHolidayId(decoded)
    if (!id) {
      return withSessionHeaders(
        json({ error: 'invalid_holiday_id' }, { status: 400 }),
        sessionHeaders,
      )
    }

    if (method === 'PUT') {
      return withSessionHeaders(
        await handleUpdate(request, store, account.googleSub, id),
        sessionHeaders,
      )
    }
    return withSessionHeaders(
      await handleDelete(store, account.googleSub, id),
      sessionHeaders,
    )
  } catch (error) {
    // A storage failure is reported as a controlled error. Nothing internal,
    // and no identity, ever reaches the browser.
    console.error('holiday request failed', error)
    return json({ error: 'server_error' }, { status: 500, headers: sessionHeaders })
  }
}
