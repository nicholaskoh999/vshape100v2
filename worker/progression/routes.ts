/**
 * Training progression HTTP surface.
 *
 *   GET    /api/progression/:date/:sessionId
 *   PUT    /api/progression/:date/:sessionId/calibration/:exerciseOrder
 *   DELETE /api/progression/:date/:sessionId/calibration/:exerciseOrder
 *
 * Every route requires the existing app-owned session. The account is always
 * the `google_sub` on that session — the client never supplies an identity, and
 * one is never read from a body, query string or header. A body field called
 * `googleSub` is simply not part of any accepted payload, so sending one
 * changes nothing.
 *
 * Session handling, the same-origin guard, the JSON envelope and the rolling
 * Set-Cookie propagation come from ../http/authenticated, shared with Today,
 * workouts, media, Holiday, notifications and Progress, so there is exactly one
 * copy of that algorithm in the Worker.
 *
 * The prefix carries its trailing slash on purpose: `/api/progress/` and
 * `/api/progression/` are different APIs, and a prefix without the slash would
 * make one swallow the other.
 */

import type { Env } from '../auth/config'
import {
  isCrossOrigin,
  json,
  requireAccount,
  withSessionHeaders,
} from '../http/authenticated'
import { parseCalibrationInput } from '../../shared/progression/lane'
import {
  isExtraSessionId,
  parseExerciseOrder,
  parseSessionId,
  parseWorkoutDate,
} from '../../shared/workoutLog'
import { createD1ProgressionStore } from './d1Store'
import {
  clearCalibration,
  readSessionProgression,
  saveCalibration,
  type CalibrationOutcome,
  type ProgressionRead,
  type ProgressionStore,
} from './progression'

const PREFIX = '/api/progression/'

/* ------------------------------------------------------------------ */
/* Public shape — guidance only, never a result                        */
/* ------------------------------------------------------------------ */

/**
 * What a read answers with.
 *
 * `started: false` is an honest answer, not a 404: the session exists and the
 * account simply has not begun it, which is what lets the client tell "nothing
 * to guide yet" from "still loading".
 *
 * Nothing in this shape is a logged value. `suggestedLoad` is a recommendation;
 * it is never written to a set, and only an explicit Complete records anything.
 */
function toPublic(read: ProgressionRead, date: string, sessionId: string) {
  if (!read.started) {
    return { date, sessionId, started: false, intensity: null, ruleset: null, lanes: [] }
  }
  return {
    date,
    sessionId,
    started: true,
    intensity: read.progression.intensity,
    ruleset: read.progression.ruleset,
    lanes: read.progression.lanes,
  }
}

/** Map a rules-level refusal onto a controlled response. */
function calibrationFailure(reason: Exclude<CalibrationOutcome, { ok: true }>['reason']) {
  if (reason === 'not_started') return json({ error: 'workout_not_started' }, { status: 404 })
  if (reason === 'slot_not_found') return json({ error: 'slot_not_found' }, { status: 404 })
  return json({ error: reason }, { status: 409 })
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

async function handleCalibrationWrite(
  request: Request,
  store: ProgressionStore,
  googleSub: string,
  date: string,
  sessionId: string,
  exerciseOrder: number,
): Promise<Response> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return json({ error: 'invalid_json' }, { status: 400 })
  }

  const parsed = parseCalibrationInput(body)
  if (!parsed.ok) {
    return json({ error: 'invalid_calibration', field: parsed.field }, { status: 400 })
  }

  const outcome = await saveCalibration(
    store,
    googleSub,
    date,
    sessionId,
    exerciseOrder,
    parsed.value,
  )
  if (!outcome.ok) return calibrationFailure(outcome.reason)
  return json(toPublic(outcome.read, date, sessionId))
}

/**
 * Route the progression API. Returns null when the request is not ours, so the
 * Worker can fall through to the next API and then to static assets.
 */
export async function handleProgressionRequest(
  request: Request,
  env: Env,
): Promise<Response | null> {
  const { pathname } = new URL(request.url)
  if (!pathname.startsWith(PREFIX)) return null

  // Any Set-Cookie the session resolution produced has to survive every exit
  // path below, including the error one: once D1 has rolled the session
  // forward, `refreshed` will not be true again for weeks.
  let sessionHeaders: HeadersInit = {}

  try {
    const segments = pathname.slice(PREFIX.length).split('/')
    const method = request.method

    const isRead = segments.length === 2
    const isCalibration = segments.length === 4 && segments[2] === 'calibration'
    if (!isRead && !isCalibration) {
      return json({ error: 'not_found' }, { status: 404 })
    }
    if (isRead && method !== 'GET') {
      return json({ error: 'method_not_allowed' }, { status: 405 })
    }
    if (isCalibration && method !== 'PUT' && method !== 'DELETE') {
      return json({ error: 'method_not_allowed' }, { status: 405 })
    }

    const account = await requireAccount(request, env)
    if ('response' in account) return account.response
    sessionHeaders = account.headers

    // Every write is state-changing, so it carries the same same-origin guard
    // the logout route, Today, media and the workout API apply. Reads are not
    // guarded, matching those APIs.
    if (method !== 'GET' && isCrossOrigin(request)) {
      return withSessionHeaders(json({ error: 'forbidden' }, { status: 403 }), sessionHeaders)
    }

    const rawDate = decodeSegment(segments[0])
    const date = rawDate === null ? null : parseWorkoutDate(rawDate)
    if (!date) {
      return withSessionHeaders(
        json({ error: 'invalid_workout_date' }, { status: 400 }),
        sessionHeaders,
      )
    }

    const rawSession = decodeSegment(segments[1])
    const sessionId = rawSession === null ? null : parseSessionId(rawSession)
    if (!sessionId) {
      return withSessionHeaders(
        json({ error: 'invalid_session_id' }, { status: 400 }),
        sessionHeaders,
      )
    }

    // Round 17: progression is a property of the SCHEDULED programme. An Extra
    // Workout logs actual set truth and nothing else — it has no calibration,
    // no lane state and no recommendation — so the whole surface is refused
    // for it rather than answered with an empty one. An empty answer would
    // still be an answer, and a client could render controls around it.
    //
    // Defence in depth: the Extra UI never calls this, the store's reads are
    // scheduled-only, and this refuses the request outright. Any one of the
    // three would do; all three are cheap.
    if (isExtraSessionId(sessionId)) {
      return withSessionHeaders(
        json({ error: 'progression_not_available' }, { status: 404 }),
        sessionHeaders,
      )
    }

    const store = createD1ProgressionStore(env.DB)

    if (isRead) {
      const read = await readSessionProgression(store, account.googleSub, date, sessionId)
      return withSessionHeaders(json(toPublic(read, date, sessionId)), sessionHeaders)
    }

    const exerciseOrder = parseExerciseOrder(segments[3])
    if (exerciseOrder === null) {
      return withSessionHeaders(
        json({ error: 'invalid_exercise_order' }, { status: 400 }),
        sessionHeaders,
      )
    }

    if (method === 'PUT') {
      return withSessionHeaders(
        await handleCalibrationWrite(
          request,
          store,
          account.googleSub,
          date,
          sessionId,
          exerciseOrder,
        ),
        sessionHeaders,
      )
    }

    const outcome = await clearCalibration(
      store,
      account.googleSub,
      date,
      sessionId,
      exerciseOrder,
    )
    if (!outcome.ok) return withSessionHeaders(calibrationFailure(outcome.reason), sessionHeaders)
    return withSessionHeaders(json(toPublic(outcome.read, date, sessionId)), sessionHeaders)
  } catch (error) {
    // A storage failure is reported as a controlled error. Nothing internal,
    // and no identity, ever reaches the browser.
    console.error('progression request failed', error)
    return json({ error: 'server_error' }, { status: 500, headers: sessionHeaders })
  }
}
