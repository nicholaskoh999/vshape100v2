/**
 * Notification HTTP surface.
 *
 *   GET    /api/notifications/config
 *   PUT    /api/notifications/subscription
 *   DELETE /api/notifications/subscription
 *
 * There is deliberately no GET on the subscription. A device confirms its own
 * state by reconciling (the PUT), so a read would have been redundant truth —
 * and it would have meant putting a push endpoint into a query string, where
 * proxies and access logs routinely record it.
 *
 * Every route requires the existing app-owned session. The account is always
 * the `google_sub` on that session — the client never supplies an identity,
 * and one is never read from a body, query string, path or header.
 *
 * ## What is never returned
 *
 * No endpoint, no `p256dh`, no `auth`, no account identifier, and no list of
 * anybody's subscriptions. The browser already knows its own subscription; it
 * has no reason to be told about it, and every reason not to be told about
 * anyone else's. The only thing sent back is whether THIS device is enabled.
 */

import type { Env } from '../auth/config'
import {
  isCrossOrigin,
  json,
  requireAccount,
  withSessionHeaders,
} from '../http/authenticated'
import { readVapidConfig } from './config'
import { createD1PushStore } from './d1Store'
import {
  isPushEndpoint,
  parseSubscriptionInput,
  removeSubscription,
  saveSubscription,
  toStatus,
  type PushStore,
} from './notifications'

const BASE = '/api/notifications'

/**
 * GET /api/notifications/config
 *
 * The only server value a browser genuinely needs: the VAPID PUBLIC key, which
 * `PushManager.subscribe` requires. It is public by design — it is what the
 * push service uses to check our signature — and the private half never leaves
 * the Worker.
 *
 * When VAPID is unconfigured this answers honestly rather than failing, so
 * Settings can say "unavailable" and the rest of the app is unaffected.
 */
function handleConfig(env: Env): Response {
  const vapid = readVapidConfig(env)
  return json(
    vapid
      ? { available: true, publicKey: vapid.publicKey }
      : { available: false, publicKey: null },
  )
}

/** PUT /api/notifications/subscription */
async function handleSave(
  request: Request,
  store: PushStore,
  googleSub: string,
): Promise<Response> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return json({ error: 'invalid_json' }, { status: 400 })
  }

  const parsed = parseSubscriptionInput(body)
  if (!parsed.ok) {
    // Names the field, never the value: the value is key material.
    return json({ error: 'invalid_subscription', field: parsed.field }, { status: 400 })
  }

  const row = await saveSubscription(store, googleSub, parsed.value)
  return json({ subscription: toStatus(row) })
}

/**
 * DELETE /api/notifications/subscription
 *
 * The endpoint identifies WHICH device to disable, and it is scoped to the
 * signed-in account, so this can neither silence another device of another
 * account nor probe whether one exists — an endpoint that is not this
 * account's simply reports nothing to remove.
 */
async function handleDelete(
  request: Request,
  store: PushStore,
  googleSub: string,
): Promise<Response> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return json({ error: 'invalid_json' }, { status: 400 })
  }

  const endpoint = (body as Record<string, unknown> | null)?.endpoint
  if (!isPushEndpoint(endpoint)) {
    return json({ error: 'invalid_subscription', field: 'endpoint' }, { status: 400 })
  }

  const removed = await removeSubscription(store, googleSub, endpoint)
  // Deliberately the same answer either way: "it is not receiving reminders
  // for you" is true whether it was yours and is gone, or was never yours.
  return json({ removed, subscription: toStatus(null) })
}

/**
 * Route notification requests. Returns null when the request is not ours, so
 * the Worker can fall through to static assets.
 */
export async function handleNotificationRequest(
  request: Request,
  env: Env,
): Promise<Response | null> {
  const { pathname } = new URL(request.url)
  if (!pathname.startsWith(`${BASE}/`)) return null

  const resource = pathname.slice(BASE.length + 1)
  if (resource !== 'config' && resource !== 'subscription') return null

  let sessionHeaders: HeadersInit = {}

  try {
    const method = request.method

    if (resource === 'config' && method !== 'GET') {
      return json({ error: 'method_not_allowed' }, { status: 405 })
    }
    // No GET on the subscription: a device learns its own state by
    // reconciling, and asking would have meant putting a push endpoint into a
    // query string where proxies and access logs record it.
    if (resource === 'subscription' && method !== 'PUT' && method !== 'DELETE') {
      return json({ error: 'method_not_allowed' }, { status: 405 })
    }

    // Even the public key is behind the session: an unauthenticated caller has
    // no business enumerating this deployment's configuration.
    const account = await requireAccount(request, env)
    if ('response' in account) return account.response
    sessionHeaders = account.headers

    if (method !== 'GET' && isCrossOrigin(request)) {
      return withSessionHeaders(json({ error: 'forbidden' }, { status: 403 }), sessionHeaders)
    }

    if (resource === 'config') {
      return withSessionHeaders(handleConfig(env), sessionHeaders)
    }

    const store = createD1PushStore(env.DB)

    if (method === 'PUT') {
      return withSessionHeaders(
        await handleSave(request, store, account.googleSub),
        sessionHeaders,
      )
    }
    return withSessionHeaders(
      await handleDelete(request, store, account.googleSub),
      sessionHeaders,
    )
  } catch (error) {
    // Never surface the underlying error: it can carry endpoints or keys.
    console.error('notification request failed')
    void error
    return json({ error: 'server_error' }, { status: 500, headers: sessionHeaders })
  }
}
