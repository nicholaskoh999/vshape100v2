/**
 * Today completion client.
 *
 * D1 is the durable source of truth for what has been ticked. This module
 * never reads or writes localStorage, sessionStorage or IndexedDB — the only
 * persistence is the server, and the session travels in the existing HttpOnly
 * cookie, which React can never see.
 */

export type Completion = {
  /** `<YYYY-MM-DD>:<item id>` — the accepted occurrence identity. */
  key: string
  anchorDay: string
  completedAt: number
}

export class CompletionApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'CompletionApiError'
    this.status = status
  }
}

const BASE = '/api/today/completions'

const REQUEST_INIT: RequestInit = {
  credentials: 'same-origin',
  headers: { Accept: 'application/json' },
}

function itemUrl(key: string): string {
  return `${BASE}/${encodeURIComponent(key)}`
}

async function ensureOk(response: Response): Promise<void> {
  if (response.ok) return
  throw new CompletionApiError(
    `Today completions request failed (${response.status})`,
    response.status,
  )
}

/** Every completion saved for the signed-in account in an inclusive day range. */
export async function fetchCompletions(
  range: { from: string; to: string },
  signal?: AbortSignal,
): Promise<Completion[]> {
  const query = new URLSearchParams({ from: range.from, to: range.to })
  const response = await fetch(`${BASE}?${query.toString()}`, { ...REQUEST_INIT, signal })
  await ensureOk(response)
  const body = (await response.json()) as { completions?: Completion[] }
  return body.completions ?? []
}

/** Mark one occurrence complete. Idempotent on the server. */
export async function putCompletion(key: string, signal?: AbortSignal): Promise<void> {
  await ensureOk(await fetch(itemUrl(key), { ...REQUEST_INIT, method: 'PUT', signal }))
}

/** Undo one occurrence. Idempotent on the server. */
export async function deleteCompletion(key: string, signal?: AbortSignal): Promise<void> {
  await ensureOk(await fetch(itemUrl(key), { ...REQUEST_INIT, method: 'DELETE', signal }))
}
