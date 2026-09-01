/**
 * Account settings HTTP surface.
 *
 *   GET /api/settings
 *   PUT /api/settings
 *
 * Both routes require the existing app-owned session. The account is always the
 * `google_sub` on that session — the client never supplies an identity, and one
 * is never read from a body, query string or header. A body field called
 * `googleSub` is simply not part of any accepted payload, so sending one
 * changes nothing.
 *
 * Session handling, the same-origin guard, the JSON envelope and the rolling
 * Set-Cookie propagation come from ../http/authenticated, shared with Today,
 * workouts and progression, so there is exactly one copy of that algorithm.
 */

import type { Env } from '../auth/config'
import {
  isCrossOrigin,
  json,
  requireAccount,
  withSessionHeaders,
} from '../http/authenticated'
import { createD1SettingsStore } from './d1Store'
import {
  parseSettingsUpdate,
  readSettings,
  writeSettings,
  type AccountSettings,
} from './settings'

const PATH = '/api/settings'

/**
 * What the API returns.
 *
 * `foundationStartDate` stays null when the account has chosen nothing. The
 * default is NOT substituted here: the client needs to tell "unset" from an
 * explicit choice so Settings can show the field honestly, and one shared
 * helper applies the fallback for display.
 */
function toPublic(settings: AccountSettings) {
  return { foundationStartDate: settings.foundationStartDate }
}

export async function handleSettingsRequest(
  request: Request,
  env: Env,
): Promise<Response | null> {
  const { pathname } = new URL(request.url)
  // Exact match only, so a future /api/settings/<something> cannot be captured
  // here by accident and answered as if it were this route.
  if (pathname !== PATH) return null

  // Any Set-Cookie the session resolution produced has to survive every exit
  // path below, including the error one: once D1 has rolled the session
  // forward, `refreshed` will not be true again for weeks.
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
    // logout route, Today, media, workouts and progression apply. Reads are not
    // guarded, matching those APIs.
    if (method !== 'GET' && isCrossOrigin(request)) {
      return withSessionHeaders(json({ error: 'forbidden' }, { status: 403 }), sessionHeaders)
    }

    const store = createD1SettingsStore(env.DB)

    if (method === 'GET') {
      const read = await readSettings(store, account.googleSub)
      // Fail closed. A stored value we cannot trust is reported as an error, so
      // the client shows its error state; answering `null` here would have been
      // read as "no preference" and silently become the legacy default.
      if (read.status === 'unreadable') {
        return withSessionHeaders(
          json({ error: 'settings_unreadable' }, { status: 500 }),
          sessionHeaders,
        )
      }
      return withSessionHeaders(json(toPublic(read.settings)), sessionHeaders)
    }

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return withSessionHeaders(json({ error: 'invalid_json' }, { status: 400 }), sessionHeaders)
    }

    const parsed = parseSettingsUpdate(body)
    if (!parsed.ok) {
      // An impossible calendar date lands here, not in the database: the
      // column's GLOB can only prove the shape.
      return withSessionHeaders(
        json({ error: 'invalid_settings', field: parsed.field }, { status: 400 }),
        sessionHeaders,
      )
    }

    const stored = await writeSettings(store, account.googleSub, parsed.value)
    // The same refusal on the write path. Only a validated value is ever sent
    // to the store, so this should be unreachable — but "should be" is not a
    // reason to hand back a default if the row reads back as something else.
    if (stored.status === 'unreadable') {
      return withSessionHeaders(
        json({ error: 'settings_unreadable' }, { status: 500 }),
        sessionHeaders,
      )
    }
    return withSessionHeaders(json(toPublic(stored.settings)), sessionHeaders)
  } catch (error) {
    // A storage failure is reported as a controlled error. Nothing internal,
    // and no identity, ever reaches the browser.
    console.error('settings request failed', error)
    return json({ error: 'server_error' }, { status: 500, headers: sessionHeaders })
  }
}
