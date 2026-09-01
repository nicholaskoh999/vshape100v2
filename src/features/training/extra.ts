/**
 * Extra Workout — a voluntary additional workout on the current local day.
 *
 * WHAT IT IS. The user picks exactly ONE existing Foundation Monday–Friday
 * session as a template and performs it again, today, on top of whatever the
 * schedule already asked for. It is real recorded training.
 *
 * WHAT IT IS NOT. It is not a custom workout builder: nothing here creates an
 * exercise, adds or removes one, reorders anything, or edits a prescription.
 * The template is copied exactly as the Foundation session currently stands,
 * and after Start the stored snapshot is the only truth this page reads.
 *
 * IDENTITY. An Extra occupies the reserved session slug `extra`, so it is
 * (account, date, 'extra') while the real scheduled Monday workout on the same
 * date is (account, date, 'monday'). They cannot collide and they can coexist.
 * The primary key is also what makes ONE Extra per date structural: a second
 * Start is a resume, never `extra-2`.
 *
 * PROVENANCE. `sourceSessionId` records which Foundation session was copied,
 * for display and for history. It is not identity, and it is not what makes a
 * workout extra — the server derives that from the routed session id.
 */

import {
  EXTRA_SESSION_ID,
  type WorkoutKind,
} from '@shared/workoutLog'

import type { AccordionSession } from './ExerciseAccordion'
import { getSession, trainingSessions, type SessionExercise, type TrainingSession } from './sessions'
import type { WorkoutOccurrence, WorkoutSet, WorkoutStartPayload } from './workoutApi'
import { buildWorkoutPlan, toStartPayload, type PlannedExercise } from './workoutPlan'

export { EXTRA_SESSION_ID }

/**
 * The Foundation sessions an Extra may be based on.
 *
 * Exactly the accepted Monday–Friday week, in its own order. Saturday and
 * Sunday are Recovery and are not templates: an Extra performed AT the weekend
 * is a voluntary exception, but it is still a copy of a weekday session.
 */
export const extraTemplates: readonly TrainingSession[] = trainingSessions

/** Is this a session an Extra may be based on? */
export function isExtraTemplate(sessionId: string | null | undefined): boolean {
  if (typeof sessionId !== 'string') return false
  return extraTemplates.some((session) => session.id === sessionId)
}

/**
 * How an Extra's source is named to the user, e.g. `Monday · Back Width +
 * Biceps`.
 *
 * Resolved from the accepted session data when the slug is still one we know,
 * and otherwise reported as the raw slug rather than guessed at. A source
 * session that has since been renamed must not silently acquire a new label.
 */
export function extraSourceLabel(sourceSessionId: string | null): string | null {
  if (!sourceSessionId) return null
  const session = getSession(sourceSessionId)
  return session ? `${session.day} · ${session.focus}` : sourceSessionId
}

/**
 * The Start payload for an Extra built from one Foundation session.
 *
 * The snapshot is the template's CURRENT content — the same payload the
 * scheduled page would send — plus the provenance that says where it came
 * from. Nothing about the template is edited on the way through.
 */
export function toExtraStartPayload(
  session: TrainingSession,
  plan: PlannedExercise[],
): WorkoutStartPayload {
  return { ...toStartPayload(session, plan), sourceSessionId: session.id }
}

/** The set structure an Extra Start would establish, or null if unloggable. */
export function buildExtraPlan(session: TrainingSession): PlannedExercise[] | null {
  return buildWorkoutPlan(session)
}

/* ------------------------------------------------------------------ */
/* Reading a started Extra back                                        */
/* ------------------------------------------------------------------ */

/**
 * Rebuild the exercise list from the STORED snapshot.
 *
 * This is what makes a started Extra immutable in practice. Once Start has
 * frozen the snapshot, the page stops reading `trainingSessions` altogether:
 * if Monday's prescription, equipment or exercise name changes tomorrow, the
 * Extra performed today still reads exactly as it was performed. A resume
 * returns the stored truth, never a fresh copy of the template.
 *
 * One row per `exercise_order`, in order. The first set of each position
 * carries the snapshot columns — every set of one exercise shares them — so
 * the first is taken and the rest are only counted.
 */
export function extraSessionFromSnapshot(sets: readonly WorkoutSet[]): AccordionSession {
  const byOrder = new Map<number, SessionExercise>()

  for (const set of sets) {
    if (byOrder.has(set.exerciseOrder)) continue
    byOrder.set(set.exerciseOrder, {
      id: set.exerciseId,
      name: set.exerciseName,
      sets: set.prescription,
      // `undefined` rather than null: the accepted SessionExercise shape uses
      // an optional field, and an empty string would render an empty chip.
      ...(set.equipment ? { equipment: set.equipment } : {}),
    })
  }

  return {
    id: EXTRA_SESSION_ID,
    exercises: [...byOrder.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, exercise]) => exercise),
  }
}

/**
 * Is this stored occurrence really an Extra?
 *
 * Read from persisted provenance, not from the slug. Used to refuse to render
 * the Extra page around a workout that is not one, rather than trusting the
 * route that got us here.
 */
export function isExtraOccurrence(occurrence: WorkoutOccurrence | null): boolean {
  return occurrence !== null && occurrence.kind === ('extra' satisfies WorkoutKind)
}
