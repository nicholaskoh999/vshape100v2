/**
 * Safe post-login redirect handling.
 *
 * Shared by the Worker (which decides where the callback sends the browser)
 * and the React app (which builds `?next=` and reads it back). An attacker
 * must never be able to turn our login flow into an open redirect.
 */

export const DEFAULT_AFTER_LOGIN = '/today'

/**
 * Control characters (including newlines) can smuggle past naive checks and
 * enable header/response splitting, so reject them outright.
 */
function hasControlChars(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i)
    if (code < 0x20 || code === 0x7f) return true
  }
  return false
}

/**
 * Accept only same-app absolute paths.
 *
 * Rejected: absolute URLs (`https://evil.com`), protocol-relative (`//evil.com`),
 * backslash variants that browsers normalise to `//`, non-`/` paths, and
 * `/login` itself (which would bounce the user straight back).
 */
export function isSafeNextPath(value: string | null | undefined): value is string {
  if (!value) return false
  if (!value.startsWith('/')) return false
  if (value.startsWith('//') || value.startsWith('/\\')) return false
  if (hasControlChars(value)) return false
  const path = value.split('?')[0].split('#')[0]
  if (path === '/login') return false
  return true
}

/** Normalise an untrusted `next` value to something safe to redirect to. */
export function safeNextPath(value: string | null | undefined): string {
  return isSafeNextPath(value) ? value : DEFAULT_AFTER_LOGIN
}

/** Build the login URL that preserves where the user was heading. */
export function loginUrlFor(pathname: string, search = '', hash = ''): string {
  const target = `${pathname}${search}${hash}`
  if (!isSafeNextPath(target) || target === DEFAULT_AFTER_LOGIN) return '/login'
  return `/login?next=${encodeURIComponent(target)}`
}
