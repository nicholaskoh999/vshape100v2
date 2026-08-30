/**
 * Shared plumbing for the app's private JSON APIs.
 *
 * Extracted verbatim from the accepted Round 04 Today routes so a second API
 * cannot end up with a subtly different copy of the session algorithm. The
 * rules are unchanged — this is a move, not a redesign:
 *
 *   - identity is always the `google_sub` on the app-owned session
 *   - a trusted session that D1 rolls forward re-issues its cookie, and that
 *     Set-Cookie has to survive success *and* error exits
 *   - an invalid or expired session gets a controlled 401 and its dead cookie
 *     cleared
 *   - state-changing methods are same-origin guarded
 *   - every response is Cache-Control: no-store
 */

import { resolveSecureCookies, type Env } from '../auth/config'
import { createD1SessionStore } from '../auth/d1Stores'
import {
  buildClearedSessionCookie,
  buildSessionCookie,
  readCookie,
  resolveSession,
  sessionLifetimeMs,
  SESSION_COOKIE,
} from '../auth/session'

export function json(body: unknown, init: ResponseInit = {}): Response {
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
 * logout route applies, so no API introduces a weaker model.
 */
export function isCrossOrigin(request: Request): boolean {
  const origin = request.headers.get('Origin')
  return origin !== null && origin !== new URL(request.url).origin
}

export type Account = { googleSub: string; headers: HeadersInit }

/**
 * Resolve the caller. Returns the account key plus any headers the session
 * resolution produced, or the 401 to send back. Identity is derived here and
 * nowhere else.
 *
 * `resolveSession` rolls a trusted session forward in D1 once it is near
 * expiry. When it does, the browser cookie must be re-issued with a matching
 * Max-Age — otherwise the cookie would expire before the D1 row it points at.
 * That is the accepted Round 02 rolling-session rule, and it applies to every
 * authenticated route, not only `/api/auth/session`.
 */
export async function requireAccount(
  request: Request,
  env: Env,
): Promise<Account | { response: Response }> {
  const token = readCookie(request.headers.get('Cookie'), SESSION_COOKIE)
  const secure = resolveSecureCookies(env, new URL(request.url))
  const result = await resolveSession(createD1SessionStore(env.DB), token)

  if (result.status !== 'valid') {
    // Clear a cookie that can no longer authenticate, so the browser stops
    // sending it — the same thing `/api/auth/session` does.
    const headers: HeadersInit = token
      ? { 'Set-Cookie': buildClearedSessionCookie(secure) }
      : {}
    return {
      response: json(
        { error: 'unauthenticated', reason: result.status === 'missing' ? null : result.status },
        { status: 401, headers },
      ),
    }
  }

  const headers: HeadersInit = result.refreshed
    ? {
        // The same opaque token, with a Max-Age matching the rolled lifetime.
        'Set-Cookie': buildSessionCookie(
          token as string,
          sessionLifetimeMs(result.session.trusted),
          secure,
        ),
      }
    : {}

  return { googleSub: result.session.googleSub, headers }
}

/** Attach the session headers to a response without rebuilding its body. */
export function withSessionHeaders(response: Response, headers: HeadersInit): Response {
  const entries = Object.entries(headers as Record<string, string>)
  if (entries.length === 0) return response

  const merged = new Headers(response.headers)
  for (const [name, value] of entries) merged.set(name, value)
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: merged,
  })
}
