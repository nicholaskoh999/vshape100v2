/**
 * Holiday HTTP surface.
 *
 *   GET    /api/holidays?from=YYYY-MM-DD&to=YYYY-MM-DD
 *   POST   /api/holidays
 *   PUT    /api/holidays/:id
 *   PUT    /api/holidays/:id/training
 *   DELETE /api/holidays/:id
 *
 * Every route requires the existing app-owned session. The account is always
 * the `google_sub` on that session — the client never supplies an identity,
 * and one is never read from a body, query string, path or header. `google_sub`
 * is part of every account-scoped lookup, so another account's record is
 * simply not found.
 *
 * `:id/training` is the ONE place a Training preference is written, for
 * company and custom Holidays alike. Keeping it single means the rule that a
 * weekend-only Holiday cannot train lives in exactly one place and cannot be
 * bypassed by using the other endpoint.
 *
 * No GET writes anything. The company calendar is seeded by migration and read
 * only; nothing here creates a company row on demand.
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
  parseTrainingPreference,
  setTrainingPreference,
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
    name: record.name,
    source: record.source,
    trainingOn: record.trainingOn,
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

/** Read a JSON body, or the 400 that replaces it. */
async function readJson(request: Request): Promise<{ body: unknown } | { response: Response }> {
  try {
    return { body: await request.json() }
  } catch {
    return { response: json({ error: 'invalid_json' }, { status: 400 }) }
  }
}

/** POST /api/holidays */
async function handleCreate(
  request: Request,
  store: HolidayStore,
  googleSub: string,
): Promise<Response> {
  const read = await readJson(request)
  if ('response' in read) return read.response

  const parsed = parseHolidayInput(read.body)
  if (!parsed.ok) {
    return json({ error: 'invalid_holiday', field: parsed.field }, { status: 400 })
  }

  const outcome = await createHoliday(store, googleSub, parsed.value)
  if (!outcome.ok) {
    // Ranges never merge, so an overlap is reported rather than absorbed. The
    // blocking range can be an approved company date, which the user cannot
    // edit — the message names it either way.
    return json(
      {
        error: 'holiday_conflict',
        conflict: outcome.conflict ? toPublicHoliday(outcome.conflict) : null,
      },
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
  const read = await readJson(request)
  if ('response' in read) return read.response

  const parsed = parseHolidayInput(read.body)
  if (!parsed.ok) {
    return json({ error: 'invalid_holiday', field: parsed.field }, { status: 400 })
  }

  const outcome = await updateHoliday(store, googleSub, id, parsed.value)
  if (!outcome.ok) {
    if (outcome.reason === 'immutable') {
      // A company date is the company's calendar, not the account's.
      return json({ error: 'holiday_immutable' }, { status: 403 })
    }
    if (outcome.reason === 'not_found') {
      return json({ error: 'holiday_not_found' }, { status: 404 })
    }
    return json(
      {
        error: 'holiday_conflict',
        conflict: outcome.conflict ? toPublicHoliday(outcome.conflict) : null,
      },
      { status: 409 },
    )
  }
  return json({ holiday: toPublicHoliday(outcome.record) })
}

/** PUT /api/holidays/:id/training */
async function handleTraining(
  request: Request,
  store: HolidayStore,
  googleSub: string,
  id: string,
): Promise<Response> {
  const read = await readJson(request)
  if ('response' in read) return read.response

  const trainingOn = parseTrainingPreference(read.body)
  if (trainingOn === null) {
    return json({ error: 'invalid_training' }, { status: 400 })
  }

  const outcome = await setTrainingPreference(store, googleSub, id, trainingOn)
  if (!outcome.ok) {
    if (outcome.reason === 'not_trainable') {
      // A Saturday/Sunday-only Holiday has no planned session to restore, so
      // the preference is refused rather than stored and quietly ignored.
      return json({ error: 'holiday_not_trainable' }, { status: 400 })
    }
    return json({ error: 'holiday_not_found' }, { status: 404 })
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
  if (!outcome.ok) {
    if (outcome.reason === 'immutable') {
      return json({ error: 'holiday_immutable' }, { status: 403 })
    }
    return json({ error: 'holiday_not_found' }, { status: 404 })
  }
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

    // Everything under the collection is a single record, optionally with the
    // `training` sub-resource. Both accept writes only.
    const segments = isItem ? pathname.slice(COLLECTION.length + 1).split('/') : []
    const isTraining = segments.length === 2 && segments[1] === 'training'

    if (isItem) {
      if (segments.length > 2) {
        return json({ error: 'not_found' }, { status: 404 })
      }
      if (isTraining && method !== 'PUT') {
        return json({ error: 'method_not_allowed' }, { status: 405 })
      }
      if (!isTraining && method !== 'PUT' && method !== 'DELETE') {
        return json({ error: 'method_not_allowed' }, { status: 405 })
      }
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

    let decoded: string
    try {
      decoded = decodeURIComponent(segments[0] ?? '')
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

    if (isTraining) {
      return withSessionHeaders(
        await handleTraining(request, store, account.googleSub, id),
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
