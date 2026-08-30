/**
 * Canonical exercise media client.
 *
 * D1 is the durable source of truth for exercise media. This module never
 * reads or writes localStorage, sessionStorage or IndexedDB — the only
 * persistence is the server, and the session travels in the existing HttpOnly
 * cookie, which React can never see.
 *
 * The wire shape is mapped into the accepted Round 06 `ExerciseMediaSource`
 * here, so there is one media model in the app rather than two: everything
 * downstream of this file speaks `{ kind, url, alt }`.
 */

import type { ExerciseMediaKind, ExerciseMediaSource } from './media'

/** One canonical record as the API returns it. */
export type ExerciseMediaRecord = ExerciseMediaSource & {
  exerciseId: string
  updatedAt: number
}

/** What the editor sends. Identity is never part of the body. */
export type ExerciseMediaDraft = {
  kind: ExerciseMediaKind
  url: string
  alt: string
}

export class ExerciseMediaApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ExerciseMediaApiError'
    this.status = status
  }
}

const BASE = '/api/exercise-media'

const REQUEST_INIT: RequestInit = {
  credentials: 'same-origin',
  headers: { Accept: 'application/json' },
}

function itemUrl(exerciseId: string): string {
  return `${BASE}/${encodeURIComponent(exerciseId)}`
}

async function ensureOk(response: Response): Promise<void> {
  if (response.ok) return
  throw new ExerciseMediaApiError(
    `Exercise media request failed (${response.status})`,
    response.status,
  )
}

/** Wire row → app record. Returns null for anything that is not a full record. */
function toRecord(raw: unknown): ExerciseMediaRecord | null {
  if (typeof raw !== 'object' || raw === null) return null
  const row = raw as Partial<ExerciseMediaRecord>
  if (typeof row.exerciseId !== 'string') return null
  if (row.kind !== 'gif' && row.kind !== 'image') return null
  if (typeof row.url !== 'string' || typeof row.alt !== 'string') return null
  return {
    exerciseId: row.exerciseId,
    kind: row.kind,
    url: row.url,
    alt: row.alt,
    updatedAt: typeof row.updatedAt === 'number' ? row.updatedAt : 0,
  }
}

/** Every canonical record the signed-in account has set. */
export async function fetchExerciseMediaLibrary(
  signal?: AbortSignal,
): Promise<ExerciseMediaRecord[]> {
  const response = await fetch(BASE, { ...REQUEST_INIT, signal })
  await ensureOk(response)
  const body = (await response.json()) as { media?: unknown[] }
  return (body.media ?? []).map(toRecord).filter((row): row is ExerciseMediaRecord => row !== null)
}

/**
 * The canonical record for one exercise, or null when none is set.
 *
 * `null` is an honest answer, not a failure: it is what puts the renderer on
 * its no-media fallback.
 */
export async function fetchExerciseMedia(
  exerciseId: string,
  signal?: AbortSignal,
): Promise<ExerciseMediaRecord | null> {
  const response = await fetch(itemUrl(exerciseId), { ...REQUEST_INIT, signal })
  await ensureOk(response)
  const body = (await response.json()) as { media?: unknown }
  return toRecord(body.media)
}

/** Upsert the one canonical record for this exercise. */
export async function saveExerciseMedia(
  exerciseId: string,
  draft: ExerciseMediaDraft,
  signal?: AbortSignal,
): Promise<ExerciseMediaRecord | null> {
  const response = await fetch(itemUrl(exerciseId), {
    ...REQUEST_INIT,
    method: 'PUT',
    headers: { ...REQUEST_INIT.headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(draft),
    signal,
  })
  await ensureOk(response)
  const body = (await response.json()) as { media?: unknown }
  return toRecord(body.media)
}

/** Delete the canonical record. Idempotent on the server. */
export async function deleteExerciseMedia(
  exerciseId: string,
  signal?: AbortSignal,
): Promise<void> {
  await ensureOk(
    await fetch(itemUrl(exerciseId), { ...REQUEST_INIT, method: 'DELETE', signal }),
  )
}

/** The record as the renderer consumes it. One media model, not two. */
export function toMediaSource(
  record: ExerciseMediaRecord | null,
): ExerciseMediaSource | null {
  return record ? { kind: record.kind, url: record.url, alt: record.alt } : null
}
