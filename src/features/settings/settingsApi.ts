/**
 * Account settings client.
 *
 * D1 is the durable source of truth. This module never reads or writes
 * localStorage, sessionStorage or IndexedDB — the only persistence is the
 * server, and the session travels in the existing HttpOnly cookie, which React
 * can never see. A refresh re-reads; it never replays a cache.
 */

import { parseSettingsEnvelope, type AccountSettings } from '@shared/settings'

export type { AccountSettings }

export class SettingsApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'SettingsApiError'
    this.status = status
  }
}

const URL_PATH = '/api/settings'

const REQUEST_INIT: RequestInit = {
  credentials: 'same-origin',
  headers: { Accept: 'application/json' },
}

/**
 * Read the response, refusing rather than guessing.
 *
 * Round 18 Correction 1: this used to coerce anything unrecognised to `null`,
 * which the rest of the app reads as "no preference" and resolves to the legacy
 * 2026-08-31. A corrupt column, a wrong type, or a value from a schema newer
 * than this client therefore became an authoritative-looking Day number.
 *
 * Round 18 Correction 2: the ENVELOPE is now validated before the field is
 * classified. This function used to begin `(body ?? {})`, which turned a `null`
 * body into an empty object, and then read an absent `foundationStartDate` as
 * "unset" — so `{}`, a bare `null`, an error payload carrying only `{ error }`,
 * or a future schema that moved the field all resolved to the legacy date. "No
 * preference" has exactly one wire spelling, `{ foundationStartDate: null }`,
 * and anything else is a response this client cannot read.
 *
 * The client re-classifies independently of the server rather than trusting the
 * envelope: the two boundaries fail closed separately, so neither relies on the
 * other having done it. An unreadable response is an error, and the provider
 * shows its error state instead of a day count.
 */
function toSettings(body: unknown, status: number): AccountSettings {
  const envelope = parseSettingsEnvelope(body)
  if (!envelope.ok) {
    throw new SettingsApiError(
      envelope.reason === 'malformed'
        ? 'Settings response was not in a readable shape'
        : 'Settings response could not be read',
      status,
    )
  }
  return envelope.settings
}

async function ensureOk(response: Response): Promise<void> {
  if (response.ok) return
  throw new SettingsApiError(`Settings request failed (${response.status})`, response.status)
}

export async function fetchSettings(signal?: AbortSignal): Promise<AccountSettings> {
  const response = await fetch(URL_PATH, { ...REQUEST_INIT, signal })
  await ensureOk(response)
  return toSettings(await response.json(), response.status)
}

/**
 * Save the Foundation start date.
 *
 * Returns what the SERVER stored, not what was sent, so the UI adopts persisted
 * truth. `null` clears the preference and returns the account to the default.
 */
export async function saveFoundationStartDate(
  date: string | null,
  signal?: AbortSignal,
): Promise<AccountSettings> {
  const response = await fetch(URL_PATH, {
    ...REQUEST_INIT,
    method: 'PUT',
    headers: { ...REQUEST_INIT.headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ foundationStartDate: date }),
    signal,
  })
  await ensureOk(response)
  return toSettings(await response.json(), response.status)
}
