import { FOUNDATION_SESSION_META, formatPrescription, type Programme } from '../../shared/programme/programme'
import type { Env } from '../auth/config'
import { isCrossOrigin, json, requireAccount, withSessionHeaders } from '../http/authenticated'
import { createD1ProgrammeStore, type ProgrammeD1 } from './d1Store'
import {
  createCustomExercise,
  parseCreateExercise,
  parseProgrammeBody,
  resolveProgramme,
  saveProgramme,
  type ProgrammeStore,
} from './programme'

/**
 * The programme HTTP surface.
 *
 *   GET  /api/programme            the account's current programme + revision
 *   PUT  /api/programme            save a whole programme, on a stated revision
 *   POST /api/programme/exercises  create a custom exercise (server-minted id)
 *
 * IDENTITY IS NEVER ON THE WIRE. The account is always the `google_sub` on the
 * app-owned session. No route reads an account from a body, a query string or a
 * header, so one account's programme is structurally unreachable from another's
 * request.
 *
 * REVISION IS ALWAYS ON THE WIRE. Every response carries the revision it
 * describes, and every write states the revision its author read. A write on a
 * revision that has moved is refused with 409 and changes nothing — the client
 * is told the programme changed elsewhere, and handed the current truth so it
 * can offer to reload rather than silently overwrite.
 */

const COLLECTION = '/api/programme'
const EXERCISES = '/api/programme/exercises'

/**
 * The public shape of a programme.
 *
 * The rendered prescription is included alongside the structured fields. The
 * client needs both — the text to display and the parts to edit — and deriving
 * the text HERE, from the one shared formatter, means the two can never
 * disagree about what a slot says.
 *
 * Session day/focus/intensity come from the fixed Foundation metadata, not from
 * storage. Round 22 does not make them editable, so they are not persisted and
 * no write can reach them.
 */
function toPublicProgramme(programme: Programme) {
  return {
    revision: programme.revision,
    exercises: programme.exercises.map((exercise) => ({
      exerciseId: exercise.exerciseId,
      name: exercise.name,
      archived: exercise.archived,
      custom: exercise.custom,
    })),
    sessions: Object.values(FOUNDATION_SESSION_META).map((meta) => ({
      id: meta.id,
      day: meta.day,
      focus: meta.focus,
      intensity: meta.intensity,
      slots: programme.sessions[meta.id].map((slot) => ({
        exerciseId: slot.exerciseId,
        position: slot.position,
        setCount: slot.setCount,
        resultKind: slot.resultKind,
        targetMin: slot.targetMin,
        targetMax: slot.targetMax,
        perSide: slot.perSide,
        equipment: slot.equipment,
        prescription: formatPrescription(slot),
      })),
    })),
  }
}

/** GET /api/programme */
async function handleRead(store: ProgrammeStore, googleSub: string): Promise<Response> {
  // A read never materialises. An account that has not edited resolves the
  // shared Foundation seed at revision 0 and no row is created.
  return json({ programme: toPublicProgramme(await resolveProgramme(store, googleSub)) })
}

/** PUT /api/programme */
async function handleSave(
  request: Request,
  store: ProgrammeStore,
  googleSub: string,
  now: number,
  writeToken: string,
): Promise<Response> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return json({ error: 'invalid_programme', field: 'body' }, { status: 400 })
  }

  const parsed = parseProgrammeBody(body)
  if (!parsed.ok) {
    return json({ error: 'invalid_programme', field: parsed.field }, { status: 400 })
  }

  const outcome = await saveProgramme(
    store,
    googleSub,
    { exercises: parsed.exercises, sessions: parsed.sessions },
    parsed.expectedRevision,
    now,
    writeToken,
  )

  if (outcome.ok) return json({ programme: toPublicProgramme(outcome.programme) })

  if (outcome.reason === 'conflict') {
    // 409, with the current truth attached. The editor says the programme
    // changed elsewhere and offers Reload latest; it must never auto-overwrite.
    return json(
      {
        error: 'programme_conflict',
        programme: toPublicProgramme(outcome.programme),
      },
      { status: 409 },
    )
  }

  return json({ error: 'invalid_programme', issues: outcome.issues }, { status: 400 })
}

/** POST /api/programme/exercises */
async function handleCreateExercise(
  request: Request,
  store: ProgrammeStore,
  googleSub: string,
  now: number,
  writeToken: string,
): Promise<Response> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return json({ error: 'invalid_exercise', field: 'name' }, { status: 400 })
  }

  const parsed = parseCreateExercise(body)
  if (!parsed.ok) {
    return json({ error: 'invalid_exercise', field: parsed.field }, { status: 400 })
  }

  const outcome = await createCustomExercise(
    store,
    googleSub,
    parsed.value,
    parsed.expectedRevision,
    now,
    writeToken,
  )

  if (outcome.ok) {
    return json(
      { exerciseId: outcome.exerciseId, programme: toPublicProgramme(outcome.programme) },
      { status: 201 },
    )
  }
  if (outcome.reason === 'conflict') {
    return json(
      { error: 'programme_conflict', programme: toPublicProgramme(outcome.programme) },
      { status: 409 },
    )
  }
  // The remaining case is `programme_invalid`; `invalid` was already refused
  // above, before any store call, by parseCreateExercise.
  return json({ error: 'invalid_programme', issues: outcome.issues }, { status: 400 })
}

/**
 * Route the programme API. Returns null when the request is not ours, so the
 * Worker can fall through to the next handler and then to static assets.
 */
export async function handleProgrammeRequest(
  request: Request,
  env: Env,
): Promise<Response | null> {
  const { pathname } = new URL(request.url)
  const isCollection = pathname === COLLECTION
  const isExercises = pathname === EXERCISES
  if (!isCollection && !isExercises) return null

  let sessionHeaders: HeadersInit = {}

  try {
    const method = request.method

    if (isCollection && method !== 'GET' && method !== 'PUT') {
      return json({ error: 'method_not_allowed' }, { status: 405 })
    }
    if (isExercises && method !== 'POST') {
      return json({ error: 'method_not_allowed' }, { status: 405 })
    }

    // Same-origin guard on every mutation, as elsewhere in the Worker.
    if (method !== 'GET' && isCrossOrigin(request)) {
      return json({ error: 'forbidden' }, { status: 403 })
    }

    const account = await requireAccount(request, env)
    if ('response' in account) return account.response
    sessionHeaders = account.headers

    // One documented cast, at the composition root. The store is typed against
    // the narrow slice of D1 it actually uses so the REAL statements can be
    // executed against real SQLite in the suite; `D1Database` provides that
    // slice, but TypeScript will not infer the compatibility through `batch`.
    const store = createD1ProgrammeStore(env.DB as unknown as ProgrammeD1)
    const now = Date.now()
    // Opaque per-write marker. Only ever used inside one batch to prove which
    // writer won the compare-and-swap; never returned and never identity.
    const writeToken = crypto.randomUUID()

    if (isExercises) {
      return withSessionHeaders(
        await handleCreateExercise(request, store, account.googleSub, now, writeToken),
        sessionHeaders,
      )
    }

    if (method === 'GET') {
      return withSessionHeaders(
        await handleRead(store, account.googleSub),
        sessionHeaders,
      )
    }

    return withSessionHeaders(
      await handleSave(request, store, account.googleSub, now, writeToken),
      sessionHeaders,
    )
  } catch (error) {
    console.error('programme request failed', error)
    return json({ error: 'server_error' }, { status: 500, headers: sessionHeaders })
  }
}
