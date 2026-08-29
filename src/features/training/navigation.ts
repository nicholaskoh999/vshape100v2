import { getSession, type TrainingSession } from './sessions'

/**
 * Session-origin context for the exercise detail route.
 *
 * An exercise can belong to several training days — Lat Pulldown is on Monday,
 * Wednesday and Thursday — so the return target cannot be derived from the
 * exercise. It has to come from the session the user actually opened it from,
 * which travels in the URL as `?from=<session id>`:
 *
 *     /exercises/lat-pulldown?from=monday   → ← Monday → /training/monday
 *     /exercises/lat-pulldown?from=thursday → ← Thursday → /training/thursday
 *
 * Because it lives in the URL, a refresh or a shared link still resolves the
 * same contextual return. Nothing is stored anywhere.
 */

/** Query parameter carrying the session the exercise was opened from. */
export const ORIGIN_PARAM = 'from'

export type ExerciseReturn = {
  /** In-app path to navigate back to. */
  to: string
  /** Text shown next to the back arrow. */
  label: string
  /** True when a valid session origin was supplied. */
  contextual: boolean
}

/** Where an exercise detail returns to when there is no valid session origin. */
export const TRAINING_OVERVIEW: ExerciseReturn = {
  to: '/training',
  label: 'Training',
  contextual: false,
}

function returnToSession(session: TrainingSession): ExerciseReturn {
  // The path is rebuilt from our own session id, never from the raw input.
  return { to: `/training/${session.id}`, label: session.day, contextual: true }
}

/**
 * Resolve a raw `?from=` value into a safe return target.
 *
 * The raw value is only ever used as a lookup key against the accepted
 * training sessions — it is never treated as a path, and never interpolated
 * into one. Anything that is not an exact known session id (absent, empty,
 * misspelt, a path, an absolute URL, a protocol-relative host) resolves to the
 * Training overview, so an attacker-supplied query string cannot redirect the
 * back control anywhere.
 */
export function resolveExerciseReturn(
  from: string | null | undefined,
): ExerciseReturn {
  if (typeof from !== 'string' || from === '') return TRAINING_OVERVIEW
  const session = getSession(from)
  return session ? returnToSession(session) : TRAINING_OVERVIEW
}

/**
 * Link target for an exercise opened from a training session.
 *
 * `fromSessionId` comes from the accepted session data, so it is a known slug;
 * it is still encoded so the URL is well formed whatever a future id contains.
 */
export function exercisePath(exerciseId: string, fromSessionId?: string): string {
  const path = `/exercises/${encodeURIComponent(exerciseId)}`
  return fromSessionId
    ? `${path}?${ORIGIN_PARAM}=${encodeURIComponent(fromSessionId)}`
    : path
}
