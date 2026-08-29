/**
 * Today completion HTTP surface.
 *
 *   GET    /api/today/completions?from=YYYY-MM-DD&to=YYYY-MM-DD
 *   PUT    /api/today/completions/:occurrenceKey
 *   DELETE /api/today/completions/:occurrenceKey
 *
 * Every route requires the existing app-owned session. The account is always
 * the `google_sub` on that session — the client never supplies an identity,
 * and one is never read from a body, query string or header.
 */

import type { Env } from '../auth/config'
import { createD1SessionStore } from '../auth/d1Stores'
import { readCookie, resolveSession, SESSION_COOKIE } from '../auth/session'
import {
  completeOccurrence,
  listCompletions,
  parseDayRange,
  parseOccurrenceKey,
  undoOccurrence,
  type CompletionRecord,
  type CompletionStore,
} from './completions'
import { createD1CompletionStore } from './d1Store'

const PREFIX = '/api/today/'
const COLLECTION = '/api/today/completions'

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      // Per-account state must never be cached by a proxy or the browser.
      'Cache-Control': 'no-store',
      ...(init.headers ?? {}),
    },
  })
}

/**
 * Same-origin guard for state-changing requests — the same rule the existing
 * logout route applies, so this API does not introduce a weaker model.
 */
function isCrossOrigin(request: Request): boolean {
  const origin = request.headers.get('Origin')
  return origin !== null && origin !== new URL(request.url).origin
}

/** The public shape of one completion. No identity is echoed back. */
function toPublicCompletion(record: CompletionRecord) {
  return {
    key: record.occurrenceKey,
    anchorDay: record.anchorDay,
    completedAt: record.completedAt,
  }
}

/**
 * Resolve the caller. Returns the account key, or the 401 to send back.
 * Identity is derived here and nowhere else.
 */
async function requireAccount(
  request: Request,
  env: Env,
): Promise<{ googleSub: string } | { response: Response }> {
  const token = readCookie(request.headers.get('Cookie'), SESSION_COOKIE)
  const result = await resolveSession(createD1SessionStore(env.DB), token)

  if (result.status !== 'valid') {
    return {
      response: json(
        { error: 'unauthenticated', reason: result.status === 'missing' ? null : result.status },
        { status: 401 },
      ),
    }
  }

  return { googleSub: result.session.googleSub }
}

/** GET /api/today/completions?from=&to= */
async function handleList(
  request: Request,
  store: CompletionStore,
  googleSub: string,
): Promise<Response> {
  const url = new URL(request.url)
  const range = parseDayRange(url.searchParams.get('from'), url.searchParams.get('to'))
  if (!range) return json({ error: 'invalid_range' }, { status: 400 })

  const records = await listCompletions(store, googleSub, range)
  return json({ completions: records.map(toPublicCompletion) })
}

/** PUT / DELETE /api/today/completions/:occurrenceKey */
async function handleMutate(
  request: Request,
  store: CompletionStore,
  googleSub: string,
  rawKey: string,
): Promise<Response> {
  if (isCrossOrigin(request)) return json({ error: 'forbidden' }, { status: 403 })

  let decoded: string
  try {
    decoded = decodeURIComponent(rawKey)
  } catch {
    return json({ error: 'invalid_occurrence_key' }, { status: 400 })
  }

  const occurrence = parseOccurrenceKey(decoded)
  if (!occurrence) return json({ error: 'invalid_occurrence_key' }, { status: 400 })

  if (request.method === 'PUT') {
    await completeOccurrence(store, googleSub, occurrence)
    // No timestamp is echoed: a repeat keeps the *first* completed_at, so
    // reporting this request's time would claim something that was not
    // stored. The read path returns the stored value.
    return json({ key: occurrence.occurrenceKey, completed: true })
  }

  await undoOccurrence(store, googleSub, occurrence)
  return json({ key: occurrence.occurrenceKey, completed: false })
}

/**
 * Route the Today API. Returns null when the request is not ours, so the
 * Worker can fall through to static assets.
 */
export async function handleTodayRequest(
  request: Request,
  env: Env,
): Promise<Response | null> {
  const { pathname } = new URL(request.url)
  if (!pathname.startsWith(PREFIX)) return null

  try {
    const isCollection = pathname === COLLECTION
    const isItem = pathname.startsWith(`${COLLECTION}/`)
    if (!isCollection && !isItem) return json({ error: 'not_found' }, { status: 404 })

    const method = request.method
    if (isCollection && method !== 'GET') {
      return json({ error: 'method_not_allowed' }, { status: 405 })
    }
    if (isItem && method !== 'PUT' && method !== 'DELETE') {
      return json({ error: 'method_not_allowed' }, { status: 405 })
    }

    const account = await requireAccount(request, env)
    if ('response' in account) return account.response

    const store = createD1CompletionStore(env.DB)

    if (isCollection) return await handleList(request, store, account.googleSub)

    const rawKey = pathname.slice(COLLECTION.length + 1)
    if (rawKey === '') return json({ error: 'invalid_occurrence_key' }, { status: 400 })
    return await handleMutate(request, store, account.googleSub, rawKey)
  } catch (error) {
    // A storage failure is reported as a controlled error. Nothing internal,
    // and no identity, ever reaches the browser.
    console.error('today request failed', error)
    return json({ error: 'server_error' }, { status: 500 })
  }
}
