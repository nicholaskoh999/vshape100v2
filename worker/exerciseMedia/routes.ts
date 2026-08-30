/**
 * Canonical exercise media HTTP surface.
 *
 *   GET    /api/exercise-media
 *   GET    /api/exercise-media/:exerciseId
 *   PUT    /api/exercise-media/:exerciseId
 *   DELETE /api/exercise-media/:exerciseId
 *
 * One record per authenticated account per exercise identity. The account is
 * always the `google_sub` on the app-owned session — the client never supplies
 * an identity, and one is never read from a body, query string or header.
 *
 * Session handling, the same-origin guard, the JSON envelope and the rolling
 * Set-Cookie propagation come from ../http/authenticated, shared with Today,
 * so there is exactly one copy of that algorithm in the Worker.
 */

import type { Env } from '../auth/config'
import {
  isCrossOrigin,
  json,
  requireAccount,
  withSessionHeaders,
} from '../http/authenticated'
import { createD1ExerciseMediaStore } from './d1Store'
import {
  listMedia,
  parseExerciseId,
  parseMediaInput,
  readMedia,
  removeMedia,
  saveMedia,
  type ExerciseMediaRecord,
  type ExerciseMediaStore,
} from './media'

const COLLECTION = '/api/exercise-media'

/** The public shape of one record. No identity is echoed back. */
function toPublicMedia(record: ExerciseMediaRecord) {
  return {
    exerciseId: record.exerciseId,
    kind: record.kind,
    url: record.url,
    alt: record.alt,
    updatedAt: record.updatedAt,
  }
}

/** GET /api/exercise-media */
async function handleList(
  store: ExerciseMediaStore,
  googleSub: string,
): Promise<Response> {
  const records = await listMedia(store, googleSub)
  return json({ media: records.map(toPublicMedia) })
}

/** GET /api/exercise-media/:exerciseId */
async function handleRead(
  store: ExerciseMediaStore,
  googleSub: string,
  exerciseId: string,
): Promise<Response> {
  const record = await readMedia(store, googleSub, exerciseId)
  // An exercise with no media set is an honest null, not a 404: the exercise
  // exists, the account simply has not given it media yet.
  return json({ exerciseId, media: record ? toPublicMedia(record) : null })
}

/** PUT /api/exercise-media/:exerciseId */
async function handleSave(
  request: Request,
  store: ExerciseMediaStore,
  googleSub: string,
  exerciseId: string,
): Promise<Response> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return json({ error: 'invalid_json' }, { status: 400 })
  }

  const parsed = parseMediaInput(body)
  if (!parsed.ok) {
    return json({ error: 'invalid_media', field: parsed.field }, { status: 400 })
  }

  const record = await saveMedia(store, googleSub, exerciseId, parsed.value)
  return json({ exerciseId, media: toPublicMedia(record) })
}

/** DELETE /api/exercise-media/:exerciseId */
async function handleRemove(
  store: ExerciseMediaStore,
  googleSub: string,
  exerciseId: string,
): Promise<Response> {
  await removeMedia(store, googleSub, exerciseId)
  // The record is gone, so the item's media is now null — the same shape the
  // read path returns, which is what puts the UI back on its honest fallback.
  return json({ exerciseId, media: null })
}

/**
 * Route the exercise media API. Returns null when the request is not ours, so
 * the Worker can fall through to static assets.
 */
export async function handleExerciseMediaRequest(
  request: Request,
  env: Env,
): Promise<Response | null> {
  const { pathname } = new URL(request.url)
  const isCollection = pathname === COLLECTION
  const isItem = pathname.startsWith(`${COLLECTION}/`)
  if (!isCollection && !isItem) return null

  // Any Set-Cookie the session resolution produced has to survive every exit
  // path below, including the error one: once D1 has rolled the session
  // forward, `refreshed` will not be true again for weeks.
  let sessionHeaders: HeadersInit = {}

  try {
    const method = request.method

    if (isCollection && method !== 'GET') {
      return json({ error: 'method_not_allowed' }, { status: 405 })
    }
    if (isItem && method !== 'GET' && method !== 'PUT' && method !== 'DELETE') {
      return json({ error: 'method_not_allowed' }, { status: 405 })
    }

    const account = await requireAccount(request, env)
    if ('response' in account) return account.response
    sessionHeaders = account.headers

    const store = createD1ExerciseMediaStore(env.DB)

    if (isCollection) {
      return withSessionHeaders(await handleList(store, account.googleSub), sessionHeaders)
    }

    // A write is state-changing, so it carries the same same-origin guard the
    // logout route and the Today API apply. Reads are not guarded, matching
    // Today.
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
    if (method === 'PUT') {
      return withSessionHeaders(
        await handleSave(request, store, account.googleSub, exerciseId),
        sessionHeaders,
      )
    }
    return withSessionHeaders(
      await handleRemove(store, account.googleSub, exerciseId),
      sessionHeaders,
    )
  } catch (error) {
    // A storage failure is reported as a controlled error. Nothing internal,
    // and no identity, ever reaches the browser.
    console.error('exercise media request failed', error)
    return json({ error: 'server_error' }, { status: 500, headers: sessionHeaders })
  }
}
