/**
 * Workout logging HTTP surface.
 *
 *   GET    /api/workouts/history?limit=N
 *   GET    /api/workouts/:date/:sessionId
 *   POST   /api/workouts/:date/:sessionId/start
 *   PUT    /api/workouts/:date/:sessionId/sets/:exerciseOrder/:setIndex
 *   DELETE /api/workouts/:date/:sessionId/sets/:exerciseOrder/:setIndex
 *
 * Every route requires the existing app-owned session. The account is always
 * the `google_sub` on that session — the client never supplies an identity,
 * and one is never read from a body, query string or header. A body field
 * called `googleSub` is simply not part of any accepted payload, so sending
 * one changes nothing.
 *
 * Session handling, the same-origin guard, the JSON envelope and the rolling
 * Set-Cookie propagation come from ../http/authenticated, shared with Today
 * and exercise media, so there is exactly one copy of that algorithm in the
 * Worker.
 */

import type { Env } from '../auth/config'
import {
  isCrossOrigin,
  json,
  requireAccount,
  withSessionHeaders,
} from '../http/authenticated'
import { createD1ExerciseInputTypeStore } from '../exerciseInput/d1Store'
import { resolveInputTypes, type ExerciseInputTypeStore } from '../exerciseInput/exerciseInput'
import { createD1WorkoutStore } from './d1Store'
import {
  applySetUpdate,
  isValidStartProvenance,
  parseExerciseOrder,
  parseHistoryLimit,
  parseHistoryRange,
  readHistory,
  readHistoryRange,
  parseSessionId,
  parseSetIndex,
  parseSetUpdate,
  parseStartInput,
  parseWorkoutDate,
  readWorkout,
  startWorkout,
  summariseSets,
  undoSet,
  type SetOutcome,
  type WorkoutLog,
  type WorkoutOccurrenceRecord,
  type WorkoutSetRecord,
  type WorkoutStore,
} from './workouts'

const PREFIX = '/api/workouts/'

/* ------------------------------------------------------------------ */
/* Public shapes — no identity is ever echoed back                     */
/* ------------------------------------------------------------------ */

function toPublicOccurrence(record: WorkoutOccurrenceRecord) {
  return {
    date: record.workoutDate,
    sessionId: record.sessionId,
    // Provenance travels with the occurrence so the client never has to infer
    // it from the session slug. The ownership token deliberately does not.
    kind: record.kind,
    sourceSessionId: record.sourceSessionId,
    day: record.day,
    focus: record.focus,
    intensity: record.intensity,
    startedAt: record.startedAt,
    updatedAt: record.updatedAt,
  }
}

function toPublicSet(record: WorkoutSetRecord) {
  return {
    exerciseOrder: record.exerciseOrder,
    setIndex: record.setIndex,
    exerciseId: record.exerciseId,
    exerciseName: record.exerciseName,
    prescription: record.prescription,
    equipment: record.equipment,
    resultKind: record.resultKind,
    loadMode: record.loadMode,
    perSide: record.perSide,
    // The frozen modality, so the training controls offer the right input and
    // the log renders what actually happened. Null means the stored value could
    // not be read, which the client must show as such rather than as kilograms.
    inputType: record.inputType,
    status: record.status,
    load:
      record.loadValue === null || record.loadUnit === null
        ? null
        : { value: record.loadValue, unit: record.loadUnit },
    band:
      record.bandLabel === null || record.bandCount === null
        ? null
        : { label: record.bandLabel, count: record.bandCount },
    result: record.result,
    updatedAt: record.updatedAt,
  }
}

function toPublicLog(log: WorkoutLog) {
  return {
    occurrence: toPublicOccurrence(log.occurrence),
    sets: log.sets.map(toPublicSet),
    progress: summariseSets(log.sets),
  }
}

/* ------------------------------------------------------------------ */
/* Handlers                                                            */
/* ------------------------------------------------------------------ */

/**
 * GET /api/workouts/history?limit=N
 *
 * Read-only reporting of what this account has recorded. It never writes,
 * never backfills, and never derives a workout that was not started — an
 * absent workout is simply absent, not a "missed" one.
 */
async function handleHistory(
  request: Request,
  store: WorkoutStore,
  googleSub: string,
): Promise<Response> {
  const params = new URL(request.url).searchParams

  // A range read is a different question from a paged one: "everything in this
  // window" rather than "the newest N". Anything deriving a fact from a date
  // being ABSENT needs the first, and needs to know the read covered it.
  const asked = parseHistoryRange(params.get('from'), params.get('to'))
  if (asked.present) {
    if (asked.range === null) return json({ error: 'invalid_range' }, { status: 400 })
    const { from, to } = asked.range
    const { workouts, totals, complete } = await readHistoryRange(store, googleSub, asked.range)
    return json({ from, to, workouts, totals, complete })
  }

  const limit = parseHistoryLimit(params.get('limit'))
  if (limit === null) return json({ error: 'invalid_limit' }, { status: 400 })

  const { workouts, totals } = await readHistory(store, googleSub, limit)
  // A page proves everything only when it actually held everything recorded.
  return json({ limit, workouts, totals, complete: workouts.length >= totals.workouts })
}

/** GET /api/workouts/:date/:sessionId */
async function handleRead(
  store: WorkoutStore,
  googleSub: string,
  date: string,
  sessionId: string,
): Promise<Response> {
  const log = await readWorkout(store, googleSub, date, sessionId)
  // A workout that has not been started is an honest null, not a 404: the
  // session exists, the account simply has not begun it. This is what lets the
  // client tell "not started" from "still loading" without guessing.
  return json(
    log === null
      ? { date, sessionId, occurrence: null, sets: [], progress: null }
      : { date, sessionId, ...toPublicLog(log) },
  )
}

/** POST /api/workouts/:date/:sessionId/start */
async function handleStart(
  request: Request,
  store: WorkoutStore,
  inputTypeStore: ExerciseInputTypeStore,
  googleSub: string,
  date: string,
  sessionId: string,
): Promise<Response> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return json({ error: 'invalid_json' }, { status: 400 })
  }

  const parsed = parseStartInput(body)
  if (!parsed.ok) {
    return json({ error: 'invalid_start', field: parsed.field }, { status: 400 })
  }

  // Provenance has to match the identity being addressed. An Extra must name
  // the Foundation session it was copied from; a scheduled workout must not
  // name one at all. Refusing both directions is what stops a client from
  // attaching Extra-shaped provenance to a real scheduled obligation, or from
  // creating an Extra whose source is unknowable.
  if (!isValidStartProvenance(sessionId, parsed.value)) {
    return json({ error: 'invalid_start', field: 'source_session_id' }, { status: 400 })
  }

  // MUTUAL EXCLUSION.
  //
  // There is deliberately NO pre-read here. Round 19 Correction 2 moved the
  // decision into the occurrence claim itself, and once it lives there a
  // handler-level check earns nothing and costs something:
  //
  //   - the friendly 409 is identical either way, because the write reports the
  //     same refusal
  //   - fail-closed on an unreadable choice is already covered, because the
  //     guard's subquery matches ANY flex row for the day regardless of whether
  //     this build can name its kind
  //   - and a pre-read that fires before the resume path is reached would
  //     refuse to reopen a workout the user is in the middle of
  //
  // THE MODALITY IS RESOLVED SERVER-SIDE, FROM THE ACCOUNT'S OWN SETTINGS.
  //
  // Read here, not taken from the request: the body already carries a load
  // mode, so trusting it for the input type too would let any caller declare a
  // band exercise to be kilograms. This is the authenticated account's stored
  // answer, and an exercise it has never configured is simply absent from the
  // map, which leaves that exercise behaving exactly as it did before.
  const inputTypes = await resolveInputTypes(inputTypeStore, googleSub)

  // One decision, in one place, evaluated against committed state.
  const outcome = await startWorkout(
    store,
    googleSub,
    date,
    sessionId,
    parsed.value,
    Date.now(),
    // Let the rules mint the ownership token; only the caller's clock and the
    // account's settings are supplied here.
    undefined,
    inputTypes,
  )
  if (!outcome.ok) {
    // A stored input type that cannot be read is a server-side data problem,
    // not a bad request: the caller did nothing wrong and retrying the same
    // call will not help. Nothing was created either way — no occurrence, and
    // no sets.
    if (outcome.reason === 'input_type_unreadable') {
      return json({ error: outcome.reason }, { status: 500 })
    }
    // The authoritative refusal: the conditional insert itself declined,
    // because the day carried a flex choice at the moment the write committed.
    return json({ error: outcome.reason }, { status: 409 })
  }

  const result = outcome.result
  // 200 for a resume, 201 for a workout this request actually created.
  return json(
    { date, sessionId, created: result.created, ...toPublicLog(result) },
    { status: result.created ? 201 : 200 },
  )
}

/**
 * Map a rules-level refusal onto a controlled response.
 *
 * Derived from SetOutcome rather than re-listed, so a refusal added to the
 * rules cannot be silently dropped here: it fails to compile instead.
 *
 * `input_type_unreadable` is a corrupt stored row, not a bad request, so it
 * answers 500 — the client did nothing wrong and retrying the same call would
 * not help. Everything else is the payload's own fault, and 400 says so.
 */
type SetFailureReason = Extract<SetOutcome, { ok: false }>['reason']

function setFailure(reason: SetFailureReason) {
  if (reason === 'not_found') return json({ error: 'set_not_found' }, { status: 404 })
  if (reason === 'input_type_unreadable') return json({ error: reason }, { status: 500 })
  return json({ error: reason }, { status: 400 })
}

/** PUT /api/workouts/:date/:sessionId/sets/:exerciseOrder/:setIndex */
async function handleSetUpdate(
  request: Request,
  store: WorkoutStore,
  googleSub: string,
  date: string,
  sessionId: string,
  exerciseOrder: number,
  setIndex: number,
): Promise<Response> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return json({ error: 'invalid_json' }, { status: 400 })
  }

  const parsed = parseSetUpdate(body)
  if (!parsed.ok) {
    return json({ error: 'invalid_set', field: parsed.field }, { status: 400 })
  }

  const outcome = await applySetUpdate(
    store,
    googleSub,
    date,
    sessionId,
    exerciseOrder,
    setIndex,
    parsed.value,
  )
  if (!outcome.ok) return setFailure(outcome.reason)
  return json({ date, sessionId, set: toPublicSet(outcome.record) })
}

/** DELETE /api/workouts/:date/:sessionId/sets/:exerciseOrder/:setIndex */
async function handleSetUndo(
  store: WorkoutStore,
  googleSub: string,
  date: string,
  sessionId: string,
  exerciseOrder: number,
  setIndex: number,
): Promise<Response> {
  const outcome = await undoSet(
    store,
    googleSub,
    date,
    sessionId,
    exerciseOrder,
    setIndex,
  )
  if (!outcome.ok) return setFailure(outcome.reason)
  return json({ date, sessionId, set: toPublicSet(outcome.record) })
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
 * Route the workout API. Returns null when the request is not ours, so the
 * Worker can fall through to static assets.
 */
export async function handleWorkoutRequest(
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

    // /history, /:date/:sessionId, /:date/:sessionId/start,
    // /:date/:sessionId/sets/:exerciseOrder/:setIndex — nothing else exists.
    // A single segment was never a route before, so `history` cannot collide
    // with the date + session shape below.
    const isHistory = segments.length === 1 && segments[0] === 'history'
    const isRead = segments.length === 2
    const isStart = segments.length === 3 && segments[2] === 'start'
    const isSet = segments.length === 5 && segments[2] === 'sets'
    if (!isHistory && !isRead && !isStart && !isSet) {
      return json({ error: 'not_found' }, { status: 404 })
    }

    if (isHistory && method !== 'GET') {
      return json({ error: 'method_not_allowed' }, { status: 405 })
    }
    if (isRead && method !== 'GET') {
      return json({ error: 'method_not_allowed' }, { status: 405 })
    }
    if (isStart && method !== 'POST') {
      return json({ error: 'method_not_allowed' }, { status: 405 })
    }
    if (isSet && method !== 'PUT' && method !== 'DELETE') {
      return json({ error: 'method_not_allowed' }, { status: 405 })
    }

    const account = await requireAccount(request, env)
    if ('response' in account) return account.response
    sessionHeaders = account.headers

    // Every write is state-changing, so it carries the same same-origin guard
    // the logout route, Today and the media API apply. Reads are not guarded,
    // matching those APIs.
    if (method !== 'GET' && isCrossOrigin(request)) {
      return withSessionHeaders(json({ error: 'forbidden' }, { status: 403 }), sessionHeaders)
    }

    const store = createD1WorkoutStore(env.DB)

    // History is account-wide: it carries no date or session segment, so it
    // must answer before the date/session validation below.
    if (isHistory) {
      return withSessionHeaders(
        await handleHistory(request, store, account.googleSub),
        sessionHeaders,
      )
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

    if (isRead) {
      return withSessionHeaders(
        await handleRead(store, account.googleSub, date, sessionId),
        sessionHeaders,
      )
    }

    if (isStart) {
      return withSessionHeaders(
        await handleStart(
          request,
          store,
          createD1ExerciseInputTypeStore(env.DB),
          account.googleSub,
          date,
          sessionId,
        ),
        sessionHeaders,
      )
    }

    const exerciseOrder = parseExerciseOrder(segments[3])
    if (exerciseOrder === null) {
      return withSessionHeaders(
        json({ error: 'invalid_exercise_order' }, { status: 400 }),
        sessionHeaders,
      )
    }

    const setIndex = parseSetIndex(segments[4])
    if (setIndex === null) {
      return withSessionHeaders(
        json({ error: 'invalid_set_index' }, { status: 400 }),
        sessionHeaders,
      )
    }

    if (method === 'PUT') {
      return withSessionHeaders(
        await handleSetUpdate(
          request,
          store,
          account.googleSub,
          date,
          sessionId,
          exerciseOrder,
          setIndex,
        ),
        sessionHeaders,
      )
    }

    return withSessionHeaders(
      await handleSetUndo(
        store,
        account.googleSub,
        date,
        sessionId,
        exerciseOrder,
        setIndex,
      ),
      sessionHeaders,
    )
  } catch (error) {
    // A storage failure is reported as a controlled error. Nothing internal,
    // and no identity, ever reaches the browser.
    console.error('workout request failed', error)
    return json({ error: 'server_error' }, { status: 500, headers: sessionHeaders })
  }
}
