/**
 * Admin Lite client.
 *
 * The server is the only authority. This module reads no localStorage, writes
 * none, and holds no notion of "am I an admin?" of its own — a 403 from the
 * server is the answer, and the only answer. There is deliberately no
 * client-side allowlist, no email comparison and no cached flag: a bundle an
 * attacker has edited still has to ask the Worker.
 */

import {
  parseAdminFoundation,
  parseAdminOverview,
  type AdminFoundation,
  type AdminOverview,
} from '@shared/admin'

export type { AdminOverview, AdminFoundation }

/** Why a request did not produce an overview. */
export type AdminErrorKind =
  /** Not signed in. */
  | 'unauthenticated'
  /** Signed in, but this account is not an admin. */
  | 'forbidden'
  /** Reached the server, but the answer was not usable. */
  | 'unreadable'
  /** Anything else: network, 5xx, a refused write. */
  | 'failed'

export class AdminApiError extends Error {
  kind: AdminErrorKind
  status: number

  constructor(kind: AdminErrorKind, message: string, status: number) {
    super(message)
    this.name = 'AdminApiError'
    this.kind = kind
    this.status = status
  }
}

const REQUEST_INIT: RequestInit = {
  credentials: 'same-origin',
  headers: { Accept: 'application/json' },
}

/** Map a non-OK response onto the four kinds the page can render. */
function toError(status: number): AdminApiError {
  if (status === 401) return new AdminApiError('unauthenticated', 'Not signed in', status)
  if (status === 403) {
    return new AdminApiError('forbidden', 'This account is not an admin', status)
  }
  return new AdminApiError('failed', `Admin request failed (${status})`, status)
}

export async function fetchAdminOverview(signal?: AbortSignal): Promise<AdminOverview> {
  const response = await fetch('/api/admin/overview', { ...REQUEST_INIT, signal })
  if (!response.ok) throw toError(response.status)

  const envelope = parseAdminOverview(await response.json())
  if (!envelope.ok) {
    // Refused rather than partially rendered. A shape this client cannot read
    // could be an error payload, a proxy's page, or a newer schema — none of
    // which should be turned into a screen of green ticks.
    throw new AdminApiError('unreadable', 'Admin response was not readable', response.status)
  }
  return envelope.overview
}

/**
 * Set Foundation Day 1.
 *
 * `confirm` is sent explicitly and the server requires it, so the write cannot
 * happen as a side effect of anything: it takes a deliberate act on this page
 * AND a body that says so.
 *
 * Returns what the SERVER stored, re-read from the row, not what was sent.
 */
export async function saveAdminFoundationStart(
  date: string,
  signal?: AbortSignal,
): Promise<AdminFoundation> {
  const response = await fetch('/api/admin/foundation-start', {
    ...REQUEST_INIT,
    method: 'PUT',
    headers: { ...REQUEST_INIT.headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ foundationStartDate: date, confirm: true }),
    signal,
  })
  if (!response.ok) throw toError(response.status)

  const envelope = parseAdminFoundation(await response.json())
  if (!envelope.ok) {
    throw new AdminApiError('unreadable', 'Save response was not readable', response.status)
  }
  return envelope.foundation
}
