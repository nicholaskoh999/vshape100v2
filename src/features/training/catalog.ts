/**
 * Canonical exercise catalog.
 *
 * ONE EXERCISE IDENTITY = ONE ENTRY.
 *
 * The training week lists Lat Pulldown three times — Monday, Wednesday and
 * Thursday — because the *prescription* differs on each day. The exercise
 * itself does not: it is one thing, with one name and one media record. This
 * module collapses the week down to that identity so the Exercise Library can
 * show each exercise exactly once while still saying where it is used.
 *
 * It is derived from `trainingSessions`, which stays the single source of
 * truth for the training data and stays in the client. Nothing here changes
 * a session's sets, reps, resistance or equipment — those remain per-session
 * and are deliberately not part of a catalog entry.
 */

import { trainingSessions, type TrainingSession } from './sessions'

/** Where one exercise is used, in training-week order. */
export type ExerciseAppearance = {
  /** Session slug, e.g. 'monday'. */
  sessionId: string
  /** Display name of the day, e.g. 'Monday'. */
  day: string
}

export type CatalogExercise = {
  /** Stable slug — the canonical media key. */
  id: string
  /** Canonical exercise name, taken from its first appearance. */
  name: string
  /** Every session the exercise appears in, in week order, no duplicates. */
  appearances: ExerciseAppearance[]
}

/**
 * Build the catalog from the accepted training week.
 *
 * Deterministic: entries come out in first-appearance order (Monday's
 * exercises first, then anything new on Tuesday, and so on), and each
 * entry's appearances are in the same week order. A repeated exercise id
 * adds an appearance to the existing entry — it never adds a second entry.
 */
function buildCatalog(sessions: readonly TrainingSession[]): CatalogExercise[] {
  const byId = new Map<string, CatalogExercise>()

  for (const session of sessions) {
    for (const exercise of session.exercises) {
      const existing = byId.get(exercise.id)
      if (!existing) {
        byId.set(exercise.id, {
          id: exercise.id,
          name: exercise.name,
          appearances: [{ sessionId: session.id, day: session.day }],
        })
        continue
      }
      // A session could in principle list the same exercise twice; that is
      // still one appearance of that day.
      if (existing.appearances.some((a) => a.sessionId === session.id)) continue
      existing.appearances.push({ sessionId: session.id, day: session.day })
    }
  }

  return [...byId.values()]
}

/** The canonical exercise list — one entry per unique exercise identity. */
export const exerciseCatalog: CatalogExercise[] = buildCatalog(trainingSessions)

/** Catalog entry for a slug, or undefined when the slug is not in the week. */
export function getCatalogExercise(id: string | undefined): CatalogExercise | undefined {
  if (!id) return undefined
  return exerciseCatalog.find((entry) => entry.id === id)
}

/** "Monday · Wednesday · Thursday" — the Used In summary line. */
export function usedInSummary(entry: CatalogExercise): string {
  return entry.appearances.map((appearance) => appearance.day).join(' · ')
}
