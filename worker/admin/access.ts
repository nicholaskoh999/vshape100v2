/**
 * Who is an admin.
 *
 * THE WHOLE AUTHORISATION MODEL IS SERVER-SIDE AND LIVES HERE.
 *
 * The decision is made from exactly two things: the `google_sub` on the
 * app-owned session, resolved by the shared `requireAccount`, and a Worker
 * allowlist that never leaves the server. Nothing else is consulted — not a
 * request body, not a query string, not a header, not a cookie other than the
 * session, and certainly not anything the browser stores.
 *
 * FOUR THINGS THIS DELIBERATELY DOES NOT DO.
 *
 * 1. It does not compare emails. An email is a display attribute that the
 *    identity provider can change or reassign; `google_sub` is the stable
 *    subject the rest of this codebase already keys every account on.
 * 2. It does not reuse ALLOWED_GOOGLE_EMAILS. That list decides who may sign in
 *    at all. Every ordinary user is on it, so reusing it would make every
 *    signed-in user an admin — which is precisely the failure this module
 *    exists to prevent.
 * 3. It does not open when unconfigured. An empty allowlist admits nobody.
 * 4. It never reports the allowlist, its size, or whether a particular subject
 *    is on it, to any client. The only observable is 200 or 403.
 */

import type { Env } from '../auth/config'

/**
 * Parse the comma-separated allowlist.
 *
 * Whitespace is trimmed and empty entries dropped, so a trailing comma or a
 * value wrapped in spaces cannot silently become an entry that matches an empty
 * subject. Comparison is exact and case-sensitive: a Google subject is an opaque
 * identifier, not a name, and lower-casing it would be inventing an equivalence
 * Google never promised.
 */
export function parseAdminSubs(raw: string | undefined): string[] {
  if (!raw) return []
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

/**
 * Whether this subject is an admin.
 *
 * An empty allowlist returns false for every subject INCLUDING the empty
 * string, which is the case a naive `allowed.includes(sub)` on unparsed input
 * would have got wrong.
 */
export function isAdminSub(googleSub: string, allowed: string[]): boolean {
  if (allowed.length === 0) return false
  if (googleSub.length === 0) return false
  return allowed.includes(googleSub)
}

/** Whether the account on this session may use the admin API. */
export function isAdminAccount(googleSub: string, env: Env): boolean {
  return isAdminSub(googleSub, parseAdminSubs(env.ADMIN_GOOGLE_SUBS))
}
