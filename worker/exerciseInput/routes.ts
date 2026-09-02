/**
 * Exercise input type HTTP surface.
 *
 *   GET /api/exercise-input-types
 *   GET /api/exercise-input-types/:exerciseId
 *   PUT /api/exercise-input-types/:exerciseId
 *
 * One setting per authenticated account per exercise identity. The account is
 * always the `google_sub` on the app-owned session — the client never supplies
 * an identity, and one is never read from a body, query string or header.
 *
 * There is deliberately no DELETE. "Unset" is not a state the user can be in
 * halfway through a programme: an exercise either has a configured modality or
 * has never been touched, and re-declaring it as Weight (kg) is the honest way
 * to say "this one really is kilograms".
 *
 * Session handling, the same-origin guard, the JSON envelope and the rolling
 * Set-Cookie propagation come from ../http/authenticated, shared with Today and
 * exercise media, so there is exactly one copy of that algorithm in the Worker.
 */

import type { Env } from '../auth/config'
import {
  isCrossOrigin,
  json,
  requireAccount,
  withSessionHeaders,
} from '../http/authenticated'
import { createD1ExerciseInputTypeStore } from './d1Store'
import {
  listInputTypes,
  parseExerciseId,
  parseInputTypeInput,
  readInputType,
  saveInputType,
  type ExerciseInputTypeRecord,
  type ExerciseInputTypeStore,
} from './exerciseInput'

const COLLECTION = '/api/exercise-input-types'

/** The public shape of one setting. No identity is echoed back. */
function toPublicInputType(record: ExerciseInputTypeRecord) {
  return {
    exerciseId: record.exerciseId,
    inputType: record.inputType,
    updatedAt: record.updatedAt,
  }
}

/** GET /api/exercise-input-types */
async function handleList(
  store: ExerciseInputTypeStore,
  googleSub: string,
): Promise<Response> {
  const library = await listInputTypes(store, googleSub)
  return json({
    inputTypes: library.records.map(toPublicInputType),
    // Reported, not omitted. A corrupt setting left out of this list would show
    // in the Library as "not set", inviting the user to answer a question they
    // have already answered — and hiding that their workouts are being refused.
    unreadable: library.unreadable,
  })
}

/** GET /api/exercise-input-types/:exerciseId */
async function handleRead(
  store: ExerciseInputTypeStore,
  googleSub: string,
  exerciseId: string,
): Promise<Response> {
  const stored = await readInputType(store, googleSub, exerciseId)

  // THREE STATES ON THE WIRE, ALL OF THEM 200.
  //
  // Correction 1 answered 500 for `unreadable`, which was wrong in a way that
  // mattered: the Library told the user their setting could not be read and to
  // set it again, and then the editor — seeing a failed request — disabled
  // every choice. The user was instructed to fix something the app would not
  // let them fix.
  //
  // `unreadable` is a KNOWN, REPAIRABLE state of persisted data, not a
  // failure of the request. It is reported as such, and the client can offer a
  // replacement. A genuine storage failure still throws and still answers 500
  // from the catch below, which keeps that case failing closed.
  //
  // `absent` is likewise an honest answer, not a 404: the exercise exists, its
  // modality has simply never been stated. The client must not read it as
  // "kilograms" — it means "not yet answered".
  return json({
    exerciseId,
    state: stored.state,
    inputType: stored.state === 'readable' ? toPublicInputType(stored.record) : null,
  })
}

/** PUT /api/exercise-input-types/:exerciseId */
async function handleSave(
  request: Request,
  store: ExerciseInputTypeStore,
  googleSub: string,
  exerciseId: string,
): Promise<Response> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return json({ error: 'invalid_json' }, { status: 400 })
  }

  const parsed = parseInputTypeInput(body)
  if (!parsed.ok) {
    return json({ error: 'invalid_input_type', field: parsed.field }, { status: 400 })
  }

  const record = await saveInputType(store, googleSub, exerciseId, parsed.value)
  return json({ exerciseId, inputType: toPublicInputType(record) })
}

/**
 * Route the exercise input type API. Returns null when the request is not
 * ours, so the Worker can fall through to static assets.
 */
export async function handleExerciseInputTypeRequest(
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

    if (isCollection && method !== 'GET') {
      return json({ error: 'method_not_allowed' }, { status: 405 })
    }
    if (isItem && method !== 'GET' && method !== 'PUT') {
      return json({ error: 'method_not_allowed' }, { status: 405 })
    }

    const account = await requireAccount(request, env)
    if ('response' in account) return account.response
    sessionHeaders = account.headers

    const store = createD1ExerciseInputTypeStore(env.DB)

    if (isCollection) {
      return withSessionHeaders(await handleList(store, account.googleSub), sessionHeaders)
    }

    // A write is state-changing, so it carries the same same-origin guard the
    // logout route and the Today API apply. Reads are not guarded, matching
    // Today and exercise media.
    if (method !== 'GET' && isCrossOrigin(request)) {
      return withSessionHeaders(json({ error: 'forbidden' }, { status: 403 }), sessionHeaders)
    }

    const rawId = pathname.slice(COLLECTION.length + 1)
    // Nothing is nested under an exercise, so a deeper path is a route that
    // does not exist rather than a malformed identity.
    if (rawId.includes('/')) {
      return withSessionHeaders(json({ error: 'not_found' }, { status: 404 }), sessionHeaders)
    }

    let decoded: string
    try {
      decoded = decodeURIComponent(rawId)
    } catch {
      return withSessionHeaders(
        json({ error: 'invalid_exercise_id' }, { status: 400 }),
        sessionHeaders,
      )
    }

    const exerciseId = parseExerciseId(decoded)
    if (!exerciseId) {
      return withSessionHeaders(
        json({ error: 'invalid_exercise_id' }, { status: 400 }),
        sessionHeaders,
      )
    }

    if (method === 'GET') {
      return withSessionHeaders(
        await handleRead(store, account.googleSub, exerciseId),
        sessionHeaders,
      )
    }
    return withSessionHeaders(
      await handleSave(request, store, account.googleSub, exerciseId),
      sessionHeaders,
    )
  } catch (error) {
    // A storage failure is reported as a controlled error. Nothing internal,
    // and no identity, ever reaches the browser.
    console.error('exercise input type request failed', error)
    return json({ error: 'server_error' }, { status: 500, headers: sessionHeaders })
  }
}
