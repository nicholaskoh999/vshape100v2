/**
 * Admin Lite / System Health HTTP surface.
 *
 *   GET /api/admin/overview          read-only status, counts and account facts
 *   PUT /api/admin/foundation-start  the one safe control this feature offers
 *
 * WHAT IS NOT HERE, ON PURPOSE.
 *
 * There is no reset route, no SQL passthrough, no table browser, no migration
 * verb, no maintenance toggle, no deploy control and no user administration.
 * The Fresh Activity Reset is DESCRIBED by the overview and cannot be RUN by
 * it: `available` is a literal `false` in this file, and no request — no
 * method, path, header or body — reaches a delete. The Round 25 production
 * reset stays where it was accepted, in the standalone operator, behind an
 * explicit authorisation.
 *
 * AUTHORISATION IS TWO GATES, IN ORDER.
 *
 *   1. `requireAccount` — the shared session algorithm every private API uses.
 *      An unauthenticated caller gets 401 and a cleared cookie.
 *   2. `isAdminAccount` — the server-side allowlist. An authenticated but
 *      non-admin caller gets 403, with no hint about why, who is on the list,
 *      or whether one is configured.
 *
 * A normal authenticated user is NOT an admin. Nothing on the client can change
 * that: the route is decided from the `google_sub` on the session and a Worker
 * variable, so a hidden UI route, an edited bundle or a fabricated localStorage
 * flag all arrive here and are refused identically.
 */

import type { AdminFoundation } from '../../shared/admin'
import { parseFoundationStartDate } from '../../shared/settings'
import type { Env } from '../auth/config'
import {
  isCrossOrigin,
  json,
  requireAccount,
  withSessionHeaders,
} from '../http/authenticated'
import { readVapidConfig } from '../notifications/config'
import { createD1SettingsStore } from '../settings/d1Store'
import { readSettings, writeSettings } from '../settings/settings'
import { isAdminAccount } from './access'
import { createAdminReader } from './d1Store'
import { classifyCron } from './health'

const PREFIX = '/api/admin/'
const OVERVIEW = '/api/admin/overview'
const FOUNDATION = '/api/admin/foundation-start'

/**
 * Maintenance mode, as this build can honestly report it.
 *
 * `off` is not an assumption. Nothing in this build reads a maintenance flag,
 * and nothing here can write one, so the app is in normal mode by construction
 * — which is exactly what `enforced: false, controllable: false` says out loud.
 * The investigation behind the deferral is in
 * design/admin-lite/00_ADMIN_LITE_SPIKE.md.
 */
const MAINTENANCE = {
  state: 'off',
  enforced: false,
  controllable: false,
  reason: 'no_persistent_store',
} as const

/**
 * The danger zone descriptor. Constant, and constant on purpose.
 *
 * This is the only mention of the Fresh Activity Reset anywhere in the running
 * app, and it is a sentence, not a switch.
 */
const DANGER_ZONE = {
  freshActivityReset: {
    available: false,
    managedBy: 'round25-operator',
  },
} as const

/** Translate the settings read into the admin contract's three-way answer. */
function toFoundation(read: Awaited<ReturnType<typeof readSettings>>): AdminFoundation {
  if (read.status === 'unreadable') return { status: 'unreadable' }
  const date = read.settings.foundationStartDate
  return date === null ? { status: 'unset' } : { status: 'set', date }
}

async function handleOverview(env: Env, googleSub: string): Promise<Response> {
  const reader = createAdminReader(env.DB)
  const now = Date.now()

  // Every read below is independent and independently fail-closed, so one
  // unreadable table costs that one metric its answer and nothing else.
  const [d1Ok, migrationLevel, activity, pushDevices, activeSessions, programme, sweep, settings] =
    await Promise.all([
      reader.probe(),
      reader.migrationLevel(),
      reader.activity(googleSub),
      reader.pushDevices(googleSub),
      reader.activeSessions(googleSub, now),
      reader.programme(googleSub),
      reader.lastSweep(googleSub),
      readSettings(createD1SettingsStore(env.DB), googleSub).catch(
        () => ({ status: 'unreadable' }) as const,
      ),
    ])

  const cron = classifyCron({
    vapidConfigured: readVapidConfig(env) !== null,
    sweep,
    now,
  })

  return json({
    system: {
      // The only claim this response can make about itself. It is being
      // served, so the API is up; that says nothing about the rest.
      api: 'healthy',
      d1: d1Ok ? 'healthy' : 'error',
      cron: cron.status,
      cronReason: cron.reason,
      cronLastSweepAt: cron.lastSweepAt,
      // Reported only when the deployment supplies it. Never derived, never
      // guessed, never back-filled from package.json — an Unknown SHA is more
      // useful than a confident wrong one.
      buildSha: env.BUILD_SHA?.trim() || null,
      migrationLevel,
    },
    account: {
      // No identity is echoed here — not the email, and certainly not the
      // `google_sub`. The page reads who is signed in from the auth context,
      // which is this app's one authority on that question. Nothing about the
      // allowlist or the configuration is observable from this response either.
      foundation: toFoundation(settings),
      programme,
      pushDevices,
      activeSessions,
    },
    activity,
    maintenance: MAINTENANCE,
    dangerZone: DANGER_ZONE,
  })
}

/**
 * PUT /api/admin/foundation-start — set the account's Day 1.
 *
 * WHY THIS IS SAFE, POINT BY POINT.
 *
 *   - admin only, decided server-side, before the body is even read
 *   - same-origin guarded, like every other state-changing route here
 *   - an explicit `confirm: true` is REQUIRED. A body without it is refused, so
 *     no stray or replayed request can move Day 1 by accident
 *   - the date must be a real Gregorian date; 2026-02-30 is rejected here, not
 *     rolled over into March
 *   - it writes through the EXISTING account-settings store, whose upsert
 *     preserves `created_at` and touches `updated_at` only. There is no second
 *     statement in the codebase that can write this row
 *   - it deletes nothing. No activity table, no history row, no occurrence, no
 *     set is read or written on this path
 *   - it is NOT the Fresh Reset, and cannot become it: changing Day 1 renumbers
 *     Foundation days and milestones and nothing else
 *
 * Unlike the ordinary settings route this one does NOT accept `null`. Clearing
 * the preference is an everyday action that already lives on the Settings
 * screen; the admin control exists to set an explicit date, so the narrower
 * surface is the correct one.
 */
async function handleFoundationWrite(
  request: Request,
  env: Env,
  googleSub: string,
  sessionHeaders: HeadersInit,
): Promise<Response> {
  if (isCrossOrigin(request)) {
    return withSessionHeaders(json({ error: 'forbidden' }, { status: 403 }), sessionHeaders)
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return withSessionHeaders(json({ error: 'invalid_json' }, { status: 400 }), sessionHeaders)
  }

  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return withSessionHeaders(
      json({ error: 'invalid_request', field: 'body' }, { status: 400 }),
      sessionHeaders,
    )
  }
  const payload = body as Record<string, unknown>

  // The confirmation is checked BEFORE the value, so an unconfirmed request is
  // refused whether or not the date it carried was any good.
  if (payload.confirm !== true) {
    return withSessionHeaders(
      json({ error: 'confirmation_required' }, { status: 400 }),
      sessionHeaders,
    )
  }

  const date = parseFoundationStartDate(payload.foundationStartDate)
  if (date === null) {
    return withSessionHeaders(
      json({ error: 'invalid_settings', field: 'foundation_start_date' }, { status: 400 }),
      sessionHeaders,
    )
  }

  const stored = await writeSettings(createD1SettingsStore(env.DB), googleSub, {
    foundationStartDate: date,
  })
  // The row is re-read and THAT is returned. A caller that believed its own
  // payload would show a date the database might not hold.
  if (stored.status === 'unreadable') {
    return withSessionHeaders(
      json({ error: 'settings_unreadable' }, { status: 500 }),
      sessionHeaders,
    )
  }

  return withSessionHeaders(json({ foundation: toFoundation(stored) }), sessionHeaders)
}

export async function handleAdminRequest(
  request: Request,
  env: Env,
): Promise<Response | null> {
  const { pathname } = new URL(request.url)
  if (!pathname.startsWith(PREFIX)) return null

  let sessionHeaders: HeadersInit = {}

  try {
    const account = await requireAccount(request, env)
    if ('response' in account) return account.response
    sessionHeaders = account.headers

    // GATE 2. Server-side, before any admin path is dispatched, so an unknown
    // /api/admin/* path cannot be probed by a non-admin either: every caller
    // who is not on the allowlist sees the same 403, whatever they asked for.
    if (!isAdminAccount(account.googleSub, env)) {
      return withSessionHeaders(json({ error: 'forbidden' }, { status: 403 }), sessionHeaders)
    }

    if (pathname === OVERVIEW) {
      if (request.method !== 'GET') {
        return withSessionHeaders(
          json({ error: 'method_not_allowed' }, { status: 405 }),
          sessionHeaders,
        )
      }
      const response = await handleOverview(env, account.googleSub)
      return withSessionHeaders(response, sessionHeaders)
    }

    if (pathname === FOUNDATION) {
      if (request.method !== 'PUT') {
        return withSessionHeaders(
          json({ error: 'method_not_allowed' }, { status: 405 }),
          sessionHeaders,
        )
      }
      return await handleFoundationWrite(request, env, account.googleSub, sessionHeaders)
    }

    return withSessionHeaders(json({ error: 'not_found' }, { status: 404 }), sessionHeaders)
  } catch (error) {
    // Controlled. Nothing internal, no identity and no configuration ever
    // reaches the browser.
    console.error('admin request failed', error)
    return json({ error: 'server_error' }, { status: 500, headers: sessionHeaders })
  }
}
