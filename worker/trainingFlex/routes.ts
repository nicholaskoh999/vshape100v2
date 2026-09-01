/**
 * Today Training Flex HTTP surface.
 *
 *   GET /api/training-flex?from=YYYY-MM-DD&to=YYYY-MM-DD
 *   PUT /api/training-flex
 *
 * Both routes require the existing app-owned session. The account is always the
 * `google_sub` on that session — the client never supplies an identity, and one
 * is never read from a body, query string or header. A body field called
 * `googleSub` is simply not part of any accepted payload, so sending one
 * changes nothing.
 *
 * Session handling, the same-origin guard, the JSON envelope and the rolling
 * Set-Cookie propagation come from ../http/authenticated, shared with Today,
 * workouts, progression and settings, so there is exactly one copy of that
 * algorithm.
 */

import type { Env } from '../auth/config.ts'
import {
  isCrossOrigin,
  json,
  requireAccount,
  withSessionHeaders,
} from '../http/authenticated.ts'
import { daysBetween, isLocalDate } from '../../shared/localDate.ts'
import {
  isPlausibleToday,
  parseTrainingFlexUpdate,
} from '../../shared/trainingFlex.ts'
import { createD1TrainingFlexStore } from './d1Store.ts'
import { readTrainingFlexRange, writeTrainingFlex } from './trainingFlex.ts'

const PATH = '/api/training-flex'

/** The widest span one read may cover — the same bound history and Holiday use. */
export const MAX_FLEX_RANGE_DAYS = 366

export async function handleTrainingFlexRequest(
  request: Request,
  env: Env,
): Promise<Response | null> {
  const url = new URL(request.url)
  // Exact match only, so a future /api/training-flex/<something> cannot be
  // captured here by accident and answered as if it were this route.
  if (url.pathname !== PATH) return null

  // Any Set-Cookie the session resolution produced has to survive every exit
  // path below, including the error one.
  let sessionHeaders: HeadersInit = {}

  try {
    const method = request.method
    if (method !== 'GET' && method !== 'PUT') {
      return json({ error: 'method_not_allowed' }, { status: 405 })
    }

    const account = await requireAccount(request, env)
    if ('response' in account) return account.response
    sessionHeaders = account.headers

    // The write is state-changing, so it carries the same same-origin guard the
    // logout route, Today, media, workouts, progression and settings apply.
    if (method !== 'GET' && isCrossOrigin(request)) {
      return withSessionHeaders(json({ error: 'forbidden' }, { status: 403 }), sessionHeaders)
    }

    const store = createD1TrainingFlexStore(env.DB)

    if (method === 'GET') {
      const from = url.searchParams.get('from')
      const to = url.searchParams.get('to')
      if (!isLocalDate(from) || !isLocalDate(to)) {
        return withSessionHeaders(
          json({ error: 'invalid_range', field: 'range' }, { status: 400 }),
          sessionHeaders,
        )
      }
      const span = daysBetween(from, to)
      if (span === null || span < 0 || span + 1 > MAX_FLEX_RANGE_DAYS) {
        return withSessionHeaders(
          json({ error: 'invalid_range', field: 'range' }, { status: 400 }),
          sessionHeaders,
        )
      }

      const read = await readTrainingFlexRange(store, account.googleSub, from, to)
      // Fail closed: a stored kind this build cannot read is reported as an
      // error, never as "no choice made" — that would understate what the user
      // did and would let a resolved day look unresolved.
      if (read.status === 'unreadable') {
        return withSessionHeaders(
          json({ error: 'flex_unreadable' }, { status: 500 }),
          sessionHeaders,
        )
      }
      return withSessionHeaders(json({ choices: read.choices }), sessionHeaders)
    }

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return withSessionHeaders(json({ error: 'invalid_json' }, { status: 400 }), sessionHeaders)
    }

    const parsed = parseTrainingFlexUpdate(body)
    if (!parsed.ok) {
      return withSessionHeaders(
        json({ error: 'invalid_flex', field: parsed.field }, { status: 400 }),
        sessionHeaders,
      )
    }

    // TODAY ONLY. The server cannot know the caller's timezone, so it cannot
    // compute their local today — but it can refuse anything that could not be
    // anyone's today. That is what blocks past backfill and future scheduling
    // without breaking a legitimate caller on the other side of the date line.
    if (!isPlausibleToday(parsed.value.date, Date.now())) {
      return withSessionHeaders(
        json({ error: 'invalid_flex', field: 'date' }, { status: 400 }),
        sessionHeaders,
      )
    }

    const stored = await writeTrainingFlex(
      store,
      account.googleSub,
      parsed.value.date,
      parsed.value.kind,
    )
    if (stored.status === 'unreadable') {
      return withSessionHeaders(
        json({ error: 'flex_unreadable' }, { status: 500 }),
        sessionHeaders,
      )
    }

    return withSessionHeaders(
      json({ choice: stored.choices[0] ?? null }),
      sessionHeaders,
    )
  } catch (error) {
    // A storage failure is reported as a controlled error. Nothing internal,
    // and no identity, ever reaches the browser.
    console.error('training flex request failed', error)
    return json({ error: 'server_error' }, { status: 500, headers: sessionHeaders })
  }
}
