/**
 * Today Training Flex client.
 *
 * D1 is the durable source of truth. This module never reads or writes
 * localStorage, sessionStorage or IndexedDB — the only persistence is the
 * server, and the session travels in the existing HttpOnly cookie, which React
 * can never see. A refresh re-reads; it never replays a cache.
 */

import { isLocalDate } from '@shared/localDate'
import {
  readTrainingFlexKind,
  type TrainingFlexChoice,
  type TrainingFlexKind,
} from '@shared/trainingFlex'

export class TrainingFlexApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'TrainingFlexApiError'
    this.status = status
  }
}

const URL_PATH = '/api/training-flex'

const REQUEST_INIT: RequestInit = {
  credentials: 'same-origin',
  headers: { Accept: 'application/json' },
}

/**
 * Read one choice out of a response, refusing rather than guessing.
 *
 * The client re-classifies independently of the server: both boundaries fail
 * closed separately, so neither relies on the other having done it. A kind this
 * build does not recognise is an error, never "no choice" — reading it as no
 * choice would tell the user their day is unresolved when it is not.
 */
function toChoice(raw: unknown, status: number): TrainingFlexChoice {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new TrainingFlexApiError('Training flex response was not readable', status)
  }
  const row = raw as Record<string, unknown>
  const value = readTrainingFlexKind(row.kind)
  if (value.kind !== 'choice' || !isLocalDate(row.date)) {
    throw new TrainingFlexApiError('Training flex response was not readable', status)
  }
  return { date: row.date as string, kind: value.value }
}

function ensureOk(response: Response): void {
  if (response.ok) return
  throw new TrainingFlexApiError(
    `Training flex request failed (${response.status})`,
    response.status,
  )
}

/** Every stored choice in the inclusive range. */
export async function fetchTrainingFlex(
  from: string,
  to: string,
  signal?: AbortSignal,
): Promise<TrainingFlexChoice[]> {
  const query = new URLSearchParams({ from, to })
  const response = await fetch(`${URL_PATH}?${query.toString()}`, { ...REQUEST_INIT, signal })
  ensureOk(response)

  const body = (await response.json()) as unknown
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new TrainingFlexApiError('Training flex response was not readable', response.status)
  }
  const choices = (body as Record<string, unknown>).choices
  // The field must be PRESENT and an array. An absent key is a malformed
  // envelope, not an empty day.
  if (!Array.isArray(choices)) {
    throw new TrainingFlexApiError('Training flex response was not readable', response.status)
  }
  return choices.map((row) => toChoice(row, response.status))
}

/**
 * Save or clear the choice for one date.
 *
 * Returns what the SERVER stored, not what was sent, so the UI adopts persisted
 * truth. `null` clears the day, which is how "I will do the scheduled workout
 * after all" is expressed.
 */
export async function saveTrainingFlex(
  date: string,
  kind: TrainingFlexKind | null,
  signal?: AbortSignal,
): Promise<TrainingFlexChoice | null> {
  const response = await fetch(URL_PATH, {
    ...REQUEST_INIT,
    method: 'PUT',
    headers: { ...REQUEST_INIT.headers, 'Content-Type': 'application/json' },
    // No identity is sent. The account is the one on the session.
    body: JSON.stringify({ date, kind }),
    signal,
  })
  ensureOk(response)

  const body = (await response.json()) as unknown
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new TrainingFlexApiError('Training flex response was not readable', response.status)
  }
  const raw = body as Record<string, unknown>
  if (!Object.hasOwn(raw, 'choice')) {
    throw new TrainingFlexApiError('Training flex response was not readable', response.status)
  }
  if (raw.choice === null) return null
  return toChoice(raw.choice, response.status)
}
