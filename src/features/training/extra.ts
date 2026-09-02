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
import type { SessionExercise, TrainingSession } from './sessions'
import type { WorkoutOccurrence, WorkoutSet, WorkoutStartPayload } from './workoutApi'
import { buildWorkoutPlan, type PlannedExercise } from './workoutPlan'

export { EXTRA_SESSION_ID }

/**
 * The Foundation sessions an Extra may be based on.
 *
 * Exactly the accepted Monday–Friday week, in its own order. Saturday and
 * Sunday are Recovery and are not templates: an Extra performed AT the weekend
 * is a voluntary exception, but it is still a copy of a weekday session.
 */
/**
 * How a STARTED Extra's source is named to the user, e.g. `Monday · Back Width
 * + Biceps`.
 *
 * Built ONLY from what was persisted at Start — the frozen `day` and `focus`
 * snapshot columns, with the stored source slug as the last resort. It
 * deliberately does not look the slug up in `trainingSessions`.
 *
 * That lookup is exactly the bug this replaces. An Extra started from
 * "Monday · Back Width + Biceps" would have re-rendered as
 * "Monday · Pull Strength" the moment the Foundation template was renamed,
 * quietly rewriting the identity of a workout that had already happened. The
 * snapshot is history; the template is today's plan; a historical row must be
 * described by the first.
 */
export function extraSnapshotLabel(
  occurrence: {
    day: string
    focus: string
    sourceSessionId: string | null
  } | null,
): string | null {
  if (!occurrence) return null

  const day = occurrence.day.trim()
  const focus = occurrence.focus.trim()
  if (day && focus) return `${day} · ${focus}`
  // A snapshot missing one half is still described by the half it has, and
  // failing that by the slug it recorded. Nothing is filled in from elsewhere.
  return day || focus || occurrence.sourceSessionId
}

/**
 * The Start payload for an Extra built from one Foundation weekday.
 *
 * ROUND 22. It no longer carries the template's content. It states the
 * programme revision the chooser was showing and which weekday was chosen; the
 * server resolves THAT weekday from the account's current programme and freezes
 * it. An Extra can therefore never be started from a template the user was not
 * looking at.
 */
export function toExtraStartPayload(
  sessionId: string,
  expectedRevision: number,
): WorkoutStartPayload {
  return { expectedRevision, sourceSessionId: sessionId }
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
