import type { Env } from '../auth/config'
import { isCrossOrigin, json, requireAccount, withSessionHeaders } from '../http/authenticated'
import { isLocalDate } from '../../shared/localDate'
import {
  fromWeightTenths,
  isBodyWeightRange,
  parseBodyWeightInput,
  todayIn,
  type BodyWeightRange,
} from '../../shared/bodyWeight'
import { readBodyWeight, type BodyWeightStore } from './bodyWeight'
import { createD1BodyWeightStore, createD1ProgressHistoryStore } from './d1Store'
import { readPerformance, type ProgressHistoryStore } from './history'

/**
 * Progress HTTP surface.
 *
 *   GET    /api/progress/weight?range=30d|90d|all&timezone=IANA
 *   PUT    /api/progress/weight
 *   DELETE /api/progress/weight/:date
 *   GET    /api/progress/performance
 *
 * Every route requires the existing app-owned session. The account is always
 * the `google_sub` on that session — the client never supplies an identity, and
 * one is never read from a body, query string or header. A field called
 * `googleSub`, `account` or `email` is not part of any accepted payload, so
 * sending one changes nothing.
 *
 * Session handling, the same-origin guard, the JSON envelope and the rolling
 * Set-Cookie propagation come from ../http/authenticated, shared with Today,
 * workouts, media, Holiday and notifications, so there is exactly one copy of
 * that algorithm in the Worker.
 */

const PREFIX = '/api/progress/'

/* ------------------------------------------------------------------ */
/* Body weight                                                         */
/* ------------------------------------------------------------------ */

/**
 * Public shape of one measurement.
 *
 * Weight travels as kilograms for the client to render, and as tenths so the
 * client can do exact arithmetic without re-introducing the float error the
 * integer storage exists to avoid.
 */
function toPublicPoint(point: { date: string; tenths: number }) {
  return { date: point.date, weightKg: fromWeightTenths(point.tenths), tenths: point.tenths }
}

function toPublicSummary(summary: Awaited<ReturnType<typeof readBodyWeight>>['summary']) {
  return {
    latest: summary.latest ? toPublicPoint(summary.latest) : null,
    previous: summary.previous ? toPublicPoint(summary.previous) : null,
    first: summary.first ? toPublicPoint(summary.first) : null,
    // Null, not zero, when there is only one measurement: "no change" and
    // "nothing to compare with" are different facts.
    changeFromPreviousTenths: summary.changeFromPrevious,
    changeFromFirstTenths: summary.changeFromFirst,
    count: summary.count,
  }
}

/** GET /api/progress/weight?range=…&timezone=… */
async function handleWeightRead(
  request: Request,
  store: BodyWeightStore,
  googleSub: string,
  now: Date,
): Promise<Response> {
  const params = new URL(request.url).searchParams

  const rawRange = params.get('range') ?? 'all'
  if (!isBodyWeightRange(rawRange)) return json({ error: 'invalid_range' }, { status: 400 })
  const range: BodyWeightRange = rawRange

  // The window ends on the user's own Today, so the zone is required for a
  // bounded range. `all` needs no window and therefore no zone, which keeps
  // the whole history readable even if the browser cannot report one.
  const today = todayIn(params.get('timezone'), now)
  if (range !== 'all' && today === null) {
    return json({ error: 'invalid_timezone' }, { status: 400 })
  }

  const { points, summary } = await readBodyWeight(store, googleSub, range, today ?? '')

  return json({
    range,
    // Real measurements only. A date with no measurement is absent from this
    // list; it is never filled in, carried forward or interpolated.
    points: points.map(toPublicPoint),
    summary: toPublicSummary(summary),
  })
}

/** PUT /api/progress/weight */
async function handleWeightWrite(
  request: Request,
  store: BodyWeightStore,
  googleSub: string,
  now: Date,
): Promise<Response> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return json({ error: 'invalid_json' }, { status: 400 })
  }

  const parsed = parseBodyWeightInput(body, now)
  if (!parsed.ok) {
    // The field names a category of problem, never a stored value and never
    // anything internal.
    return json({ error: 'invalid_weight', field: parsed.field }, { status: 400 })
  }

  await store.save({
    googleSub,
    localDate: parsed.value.localDate,
    weightTenths: parsed.value.weightTenths,
    now: now.getTime(),
  })

  return json({
    entry: toPublicPoint({ date: parsed.value.localDate, tenths: parsed.value.weightTenths }),
  })
}

/**
 * DELETE /api/progress/weight/:date
 *
 * The response is deliberately identical whether a measurement was there or
 * not. Reporting "removed: false" would answer a question the browser never
 * needs to ask, and the same route under a different account would then reveal
 * whether that account has an entry on a given date.
 */
async function handleWeightDelete(
  store: BodyWeightStore,
  googleSub: string,
  date: string,
): Promise<Response> {
  await store.remove(googleSub, date)
  return json({ date })
}

/* ------------------------------------------------------------------ */
/* Performance                                                         */
/* ------------------------------------------------------------------ */

/**
 * GET /api/progress/performance
 *
 * Personal Bests and per-workout performance points for every comparable
 * variant this account has completed history for. Derived, never stored.
 *
 * The response is already aggregated: one point per workout occurrence per
 * variant, rather than every raw set. The browser never receives the full set
 * history and never does the ranking, so a client-side cap cannot silently
 * become the definition of "all-time".
 */
function toPublicPerformance(point: {
  date: string
  sessionId: string
  loadValue: number | null
  result: number
}) {
  return {
    date: point.date,
    sessionId: point.sessionId,
    loadValue: point.loadValue,
    result: point.result,
  }
}

async function handlePerformance(
  store: ProgressHistoryStore,
  googleSub: string,
): Promise<Response> {
  const read = await readPerformance(store, googleSub)

  if (!read.complete) {
    // Fails closed. A partial history can only produce a PB that is too low,
    // and one that is too low looks exactly like a correct one on screen.
    return json({ complete: false, reason: read.reason, variants: [] })
  }

  return json({
    complete: true,
    examined: read.examined,
    variants: read.variants.map((variant) => ({
      key: variant.key,
      exerciseId: variant.exerciseId,
      exerciseName: variant.exerciseName,
      resultKind: variant.resultKind,
      // kg_each stays kg_each all the way to the browser: it is per dumbbell,
      // and nothing here converts it to a total.
      loadMode: variant.loadMode,
      perSide: variant.perSide,
      // `startedAt` is stripped from both: the browser needs the ORDER these
      // came in, which the server has already applied, not the clock they
      // happened on.
      personalBest: variant.personalBest ? toPublicPerformance(variant.personalBest) : null,
      points: variant.points.map(toPublicPerformance),
      lastPerformed: variant.lastPerformed,
    })),
  })
}

/* ------------------------------------------------------------------ */
/* Routing                                                             */
/* ------------------------------------------------------------------ */

/** Decode one path segment, or null when it is not valid percent-encoding. */
function decodeSegment(raw: string): string | null {
  try {
    return decodeURIComponent(raw)
  } catch {
    return null
  }
}

/**
 * Route the Progress API. Returns null when the request is not ours, so the
 * Worker can fall through to static assets.
 */
export async function handleProgressRequest(
  request: Request,
  env: Env,
): Promise<Response | null> {
  const { pathname } = new URL(request.url)
  if (!pathname.startsWith(PREFIX)) return null

  // Any Set-Cookie the session resolution produced has to survive every exit
  // path below, including the error one.
  let sessionHeaders: HeadersInit = {}

  try {
    const segments = pathname.slice(PREFIX.length).split('/')
    const method = request.method

    const isWeight = segments.length === 1 && segments[0] === 'weight'
    const isWeightDate = segments.length === 2 && segments[0] === 'weight'
    const isPerformance = segments.length === 1 && segments[0] === 'performance'
    if (!isWeight && !isWeightDate && !isPerformance) {
      return json({ error: 'not_found' }, { status: 404 })
    }

    if (isWeight && method !== 'GET' && method !== 'PUT') {
      return json({ error: 'method_not_allowed' }, { status: 405 })
    }
    if (isWeightDate && method !== 'DELETE') {
      return json({ error: 'method_not_allowed' }, { status: 405 })
    }
    if (isPerformance && method !== 'GET') {
      return json({ error: 'method_not_allowed' }, { status: 405 })
    }

    const account = await requireAccount(request, env)
    if ('response' in account) return account.response
    sessionHeaders = account.headers

    // Every write carries the same same-origin guard the rest of the API
    // applies. Reads are not guarded, matching those APIs.
    if (method !== 'GET' && isCrossOrigin(request)) {
      return withSessionHeaders(json({ error: 'forbidden' }, { status: 403 }), sessionHeaders)
    }

    const now = new Date()

    if (isPerformance) {
      return withSessionHeaders(
        await handlePerformance(createD1ProgressHistoryStore(env.DB), account.googleSub),
        sessionHeaders,
      )
    }

    const store = createD1BodyWeightStore(env.DB)

    if (isWeight) {
      return withSessionHeaders(
        method === 'GET'
          ? await handleWeightRead(request, store, account.googleSub, now)
          : await handleWeightWrite(request, store, account.googleSub, now),
        sessionHeaders,
      )
    }

    const rawDate = decodeSegment(segments[1])
    if (rawDate === null || !isLocalDate(rawDate)) {
      return withSessionHeaders(json({ error: 'invalid_date' }, { status: 400 }), sessionHeaders)
    }

    return withSessionHeaders(
      await handleWeightDelete(store, account.googleSub, rawDate),
      sessionHeaders,
    )
  } catch (error) {
    // A storage failure is reported as a controlled error. Nothing internal,
    // and no identity, ever reaches the browser.
    console.error('progress request failed', error)
    return json({ error: 'server_error' }, { status: 500, headers: sessionHeaders })
  }
}
