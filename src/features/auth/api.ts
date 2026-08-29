/**
 * Auth client.
 *
 * The server is the only authority on whether the user is signed in — this
 * module never reads or writes localStorage, and the session cookie is
 * HttpOnly so React cannot see it either.
 */

export type PublicUser = {
  email: string
  name: string | null
  picture: string | null
}

/** Why a session stopped being valid, when the server can tell us. */
export type SessionEndReason = 'expired' | 'revoked' | null

export type SessionState =
  | { authenticated: true; user: PublicUser }
  | { authenticated: false; reason: SessionEndReason }

export async function fetchSession(signal?: AbortSignal): Promise<SessionState> {
  const response = await fetch('/api/auth/session', {
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
    signal,
  })

  if (!response.ok) {
    // Treat any non-OK answer as "not signed in" rather than guessing.
    return { authenticated: false, reason: null }
  }

  const body = (await response.json()) as SessionState
  return body.authenticated
    ? { authenticated: true, user: body.user }
    : { authenticated: false, reason: body.reason ?? null }
}

export async function postLogout(): Promise<void> {
  await fetch('/api/auth/logout', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  })
}

/** Build the server URL that starts the Google flow. */
export function googleStartUrl(next: string, trustDevice: boolean): string {
  const params = new URLSearchParams()
  if (next && next !== '/today') params.set('next', next)
  if (trustDevice) params.set('trust', '1')
  const query = params.toString()
  return `/api/auth/google/start${query ? `?${query}` : ''}`
}

/**
 * Full-page navigation to the server, which then redirects to Google.
 * Isolated here so tests can observe it without a real navigation.
 */
export function navigateToGoogle(url: string): void {
  window.location.assign(url)
}
