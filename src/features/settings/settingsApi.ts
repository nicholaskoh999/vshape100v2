/**
 * Account settings client.
 *
 * D1 is the durable source of truth. This module never reads or writes
 * localStorage, sessionStorage or IndexedDB — the only persistence is the
 * server, and the session travels in the existing HttpOnly cookie, which React
 * can never see. A refresh re-reads; it never replays a cache.
 */

import { parseFoundationStartDate, type AccountSettings } from '@shared/settings'

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
 * An unreadable stored date reads as "no preference", which resolves to the
 * legacy default — the same fail-closed direction the server takes.
 */
function toSettings(body: unknown): AccountSettings {
  const raw = (body ?? {}) as Record<string, unknown>
  return { foundationStartDate: parseFoundationStartDate(raw.foundationStartDate) }
}

async function ensureOk(response: Response): Promise<void> {
  if (response.ok) return
  throw new SettingsApiError(`Settings request failed (${response.status})`, response.status)
}

export async function fetchSettings(signal?: AbortSignal): Promise<AccountSettings> {
  const response = await fetch(URL_PATH, { ...REQUEST_INIT, signal })
  await ensureOk(response)
  return toSettings(await response.json())
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
  return toSettings(await response.json())
}
