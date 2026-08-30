/**
 * Turning an accepted prescription string into a loggable set structure.
 *
 * Foundation prescriptions are display text — `4 × 10–15`, `3 × 10 / side`,
 * `3 × 30–60s`. Logging needs three things out of them: how many sets, whether
 * a set records reps or seconds, and whether reps are per side. This module
 * derives exactly that and nothing more.
 *
 * It is deliberately NOT a progression engine. Nothing here infers a next
 * load, judges a result against its target range, or reads history. The target
 * text is carried through verbatim for display only.
 *
 * An unrecognised prescription returns null rather than a guess: a fabricated
 * set count would silently invent history.
 */

import type {
  WorkoutExercisePlan,
  WorkoutLoadMode,
  WorkoutResultKind,
} from '@shared/workoutLog'
import { trainingSessions, type SessionExercise, type TrainingSession } from './sessions'

/** What one prescription string means for logging. */
export type PrescriptionPlan = {
  setCount: number
  resultKind: WorkoutResultKind
  /** True for "10 / side" — the logged number is per side. */
  perSide: boolean
  /** The rep/second target as written, e.g. "10–15". Display only. */
  target: string
}

/** `<count> × <rest>` — the multiplication sign is U+00D7, as authored. */
const PRESCRIPTION_PATTERN = /^(\d+)\s*×\s*(.+)$/
/** A single number or a range, using an en dash or a plain hyphen. */
const TARGET_PATTERN = /^\d+(?:\s*[–-]\s*\d+)?$/
/** Trailing "/ side". */
const PER_SIDE_PATTERN = /\s*\/\s*side$/i
/** A seconds target ends in `s`, e.g. "30–60s". */
const SECONDS_PATTERN = /^(.*\d)\s*s$/i

/** Most sets any single Foundation prescription may ask for. */
const MAX_PARSED_SETS = 20

/**
 * Parse one prescription, or return null when it is not a shape we understand.
 */
export function parsePrescription(raw: string | null | undefined): PrescriptionPlan | null {
  if (typeof raw !== 'string') return null

  const match = PRESCRIPTION_PATTERN.exec(raw.trim())
  if (!match) return null

  const setCount = Number(match[1])
  if (!Number.isInteger(setCount) || setCount < 1 || setCount > MAX_PARSED_SETS) return null

  let rest = match[2].trim()

  // "/ side" qualifies the reps; strip it before reading the number.
  const perSide = PER_SIDE_PATTERN.test(rest)
  if (perSide) rest = rest.replace(PER_SIDE_PATTERN, '').trim()

  // A trailing `s` makes it a hold in seconds. Checked after "/ side" so a
  // hypothetical "30s / side" would still read as seconds.
  let resultKind: WorkoutResultKind = 'reps'
  const seconds = SECONDS_PATTERN.exec(rest)
  if (seconds) {
    resultKind = 'seconds'
    rest = seconds[1].trim()
  }

  if (!TARGET_PATTERN.test(rest)) return null

  return { setCount, resultKind, perSide, target: rest }
}

/* ------------------------------------------------------------------ */
/* Load semantics                                                      */
/* ------------------------------------------------------------------ */

/** Dumbbell work, e.g. equipment "DB + Bench Flat" or name "Incline DB Press". */
const DUMBBELL_PATTERN = /\bDB\b/i
/** Band work, e.g. equipment "BAND 20kg" or name "Seated Band Row". */
const BAND_PATTERN = /\bband\b/i

type LoadSignal = 'dumbbell' | 'band' | null

function readLoadSignal(exercise: SessionExercise): LoadSignal {
  const text = `${exercise.name} ${exercise.equipment ?? ''}`
  if (DUMBBELL_PATTERN.test(text)) return 'dumbbell'
  if (BAND_PATTERN.test(text)) return 'band'
  return null
}

/**
 * How load is meant for one canonical exercise identity.
 *
 * Resolved across EVERY appearance of the exercise, not per session. Monday
 * lists Preacher Curl with "DB + Bench Preacher setup" while Thursday lists no
 * equipment at all — but it is the same movement, so it must not be dumbbell
 * work on one day and something else on another. Prescriptions stay
 * per-session; only this semantic is canonical.
 *
 *   dumbbell anywhere → kg_each (PER DUMBBELL, never the combined weight)
 *   band anywhere     → kg
 *   otherwise, when every appearance is a timed hold or per-side core work
 *                     → none, so no load field is forced onto bodyweight work
 *   otherwise         → kg, an optional single-implement load
 *
 * The last case is a deliberate default rather than a claim: four Foundation
 * exercises carry no equipment text, so the accepted data does not say what
 * they are loaded with. `kg` records an honest number without asserting the
 * "each" semantic that only dumbbells have.
 */
export function resolveLoadMode(exerciseId: string): WorkoutLoadMode {
  let sawBand = false
  let sawAppearance = false
  let allBodyweightShaped = true

  for (const session of trainingSessions) {
    for (const exercise of session.exercises) {
      if (exercise.id !== exerciseId) continue
      sawAppearance = true

      const signal = readLoadSignal(exercise)
      if (signal === 'dumbbell') return 'kg_each'
      if (signal === 'band') sawBand = true

      const plan = parsePrescription(exercise.sets)
      // Unparseable prescriptions must not make an exercise look bodyweight.
      if (!plan || !(plan.resultKind === 'seconds' || plan.perSide)) {
        allBodyweightShaped = false
      }
    }
  }

  if (!sawAppearance) return 'kg'
  if (sawBand) return 'kg'
  return allBodyweightShaped ? 'none' : 'kg'
}

/* ------------------------------------------------------------------ */
/* Session plan                                                        */
/* ------------------------------------------------------------------ */

/** One exercise's plan, plus the display target the set rows show. */
export type PlannedExercise = WorkoutExercisePlan & { target: string }

/**
 * The set structure a Start would establish for one session.
 *
 * Order is the session's own order, which becomes `exercise_order` — the field
 * that keeps a repeated canonical exercise from colliding with itself.
 * Returns null when any prescription in the session cannot be parsed, so the
 * UI offers to start a workout only when it can log every set of it honestly.
 */
export function buildWorkoutPlan(session: TrainingSession): PlannedExercise[] | null {
  const planned: PlannedExercise[] = []

  for (const exercise of session.exercises) {
    const plan = parsePrescription(exercise.sets)
    if (!plan) return null

    planned.push({
      exerciseId: exercise.id,
      name: exercise.name,
      prescription: exercise.sets,
      equipment: exercise.equipment ?? null,
      resultKind: plan.resultKind,
      loadMode: resolveLoadMode(exercise.id),
      perSide: plan.perSide,
      setCount: plan.setCount,
      target: plan.target,
    })
  }

  return planned
}

/** The Start payload for a session. Identity is never part of it. */
export function toStartPayload(session: TrainingSession, plan: PlannedExercise[]) {
  return {
    day: session.day,
    focus: session.focus,
    intensity: session.intensity,
    // `target` is display-only and is deliberately not sent: the server
    // stores the prescription text itself, not a derived field.
    exercises: plan.map((exercise) => ({
      exerciseId: exercise.exerciseId,
      name: exercise.name,
      prescription: exercise.prescription,
      equipment: exercise.equipment,
      resultKind: exercise.resultKind,
      loadMode: exercise.loadMode,
      perSide: exercise.perSide,
      setCount: exercise.setCount,
    })),
  }
}

/* ------------------------------------------------------------------ */
/* Workout date                                                        */
/* ------------------------------------------------------------------ */

/**
 * Today's date on the user's own calendar, as `YYYY-MM-DD`.
 *
 * Built from local date parts, never from `toISOString()`: the UTC date is a
 * different day for most of the world for part of every day, which would file
 * an evening workout under tomorrow — or yesterday. No timezone is hardcoded;
 * whatever the device's calendar says today is, is the workout date.
 */
export function localWorkoutDate(now: Date = new Date()): string {
  const year = String(now.getFullYear()).padStart(4, '0')
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
