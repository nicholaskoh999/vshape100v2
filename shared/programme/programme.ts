import {
  MAX_EQUIPMENT_LENGTH,
  MAX_EXERCISE_NAME_LENGTH,
  MAX_EXERCISES_PER_SESSION,
  MAX_SETS_PER_EXERCISE,
  MAX_SETS_PER_OCCURRENCE,
  MAX_WORKOUT_EXERCISE_ID_LENGTH,
  parseWorkoutExerciseId,
  type WorkoutResultKind,
} from '../workoutLog'

/**
 * THE EDITABLE PROGRAMME.
 *
 * Round 22 turns the Foundation programme from a hardcoded array into account
 * truth the user owns. Everything about that ownership is defined here, in
 * shared/, because the Worker and the React app must agree on it exactly: the
 * Worker builds workout snapshots from it at Start, and the client renders it
 * before Start. One definition, so the two can never drift.
 *
 * WHAT IS EDITABLE, AND WHAT IS NOT.
 *
 * Editable: which exercises exist, what they are called, which weekdays they
 * appear on, and how each of those appearances is prescribed.
 *
 * Fixed: the five weekday session identities themselves — their id, day name,
 * focus and intensity. Round 22 changes programme CONTENT; it does not
 * redesign the weekly obligation model, and Saturday/Sunday are not programme
 * at all. Those live in FOUNDATION_SESSION_META and no route may write them.
 *
 * IDENTITY IS STABLE AND DISPLAY IS NOT.
 *
 * `exerciseId` is the permanent identity. It keys media, input type, personal
 * bests and every historical workout row ever written. Renaming an exercise
 * changes `name` and NOTHING else — which is the whole point: the user can
 * call `lat-pulldown` "Band Lat Pulldown" without orphaning a single record.
 *
 * ONE EXERCISE, MANY PRESCRIPTIONS.
 *
 * A canonical exercise appears at most once per weekday but may appear on
 * several. Each appearance is its own slot with its own sets, target, per-side
 * and equipment, so Monday 4 × 10–15 and Wednesday 2 × 15–20 are the same
 * exercise trained two ways, not two exercises.
 */

/* ------------------------------------------------------------------ */
/* Fixed session identities                                            */
/* ------------------------------------------------------------------ */

export const PROGRAMME_SESSION_IDS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
] as const

export type ProgrammeSessionId = (typeof PROGRAMME_SESSION_IDS)[number]

export function isProgrammeSessionId(value: unknown): value is ProgrammeSessionId {
  return (
    typeof value === 'string' &&
    (PROGRAMME_SESSION_IDS as readonly string[]).includes(value)
  )
}

export type SessionIntensity = 'HARD' | 'LIGHT' | 'PUMP'

export type ProgrammeSessionMeta = {
  id: ProgrammeSessionId
  day: string
  focus: string
  intensity: SessionIntensity
}

/**
 * The weekday skeleton, exactly as accepted in the V START handoff.
 *
 * NOT editable in Round 22. It is stated once here and read by both runtimes;
 * the programme store never persists these, so no edit can reach them.
 */
export const FOUNDATION_SESSION_META: Record<
  ProgrammeSessionId,
  ProgrammeSessionMeta
> = {
  monday: {
    id: 'monday',
    day: 'Monday',
    focus: 'Back Width + Biceps',
    intensity: 'HARD',
  },
  tuesday: {
    id: 'tuesday',
    day: 'Tuesday',
    focus: 'Upper Chest + Shoulders + Triceps',
    intensity: 'HARD',
  },
  wednesday: {
    id: 'wednesday',
    day: 'Wednesday',
    focus: 'Light Back + Rear Delts + Core',
    intensity: 'LIGHT',
  },
  thursday: {
    id: 'thursday',
    day: 'Thursday',
    focus: 'Back Thickness + Chest + Biceps',
    intensity: 'HARD',
  },
  friday: {
    id: 'friday',
    day: 'Friday',
    focus: 'Upper Chest + Shoulders + Arms',
    intensity: 'PUMP',
  },
}

/* ------------------------------------------------------------------ */
/* The model                                                           */
/* ------------------------------------------------------------------ */

/** One canonical exercise the account owns. */
export type ProgrammeExercise = {
  /** Permanent. Keys media, input type, history and personal bests. */
  exerciseId: string
  /** Editable display name. */
  name: string
  /** Archived exercises keep every record but hold no weekday slot. */
  archived: boolean
  /** True for an exercise the user created, false for a Foundation one. */
  custom: boolean
}

/**
 * One appearance of a canonical exercise on one weekday.
 *
 * The prescription is STRUCTURED, never free text. The rendered string is
 * derived by `formatPrescription`, which is proved against the accepted parser
 * so a programme can never author a prescription the logger cannot read.
 */
export type ProgrammeSlot = {
  exerciseId: string
  /** 1-based, contiguous within its weekday. No gaps, no duplicates. */
  position: number
  setCount: number
  resultKind: WorkoutResultKind
  /** Authored target bounds. A single target has min === max. */
  targetMin: number
  targetMax: number
  perSide: boolean
  equipment: string | null
}

export type ProgrammeSessions = Record<ProgrammeSessionId, ProgrammeSlot[]>

/**
 * The whole resolved programme for one account.
 *
 * `revision` is the optimistic-concurrency token. It is part of every
 * authoritative response and every write carries the revision the writer read.
 * Revision 0 is the unpersisted fallback — see foundation.ts.
 */
export type Programme = {
  revision: number
  exercises: ProgrammeExercise[]
  sessions: ProgrammeSessions
}

/** The revision a programme reports before the account has ever edited it. */
export const FALLBACK_REVISION = 0

/* ------------------------------------------------------------------ */
/* Structured prescription -> the accepted prescription grammar        */
/* ------------------------------------------------------------------ */

/** The multiplication sign the accepted grammar uses. U+00D7. */
const TIMES = '×'
/** The range dash the accepted grammar uses. U+2013. */
const EN_DASH = '–'

/**
 * Render a slot as a prescription string.
 *
 * This is the ONLY place structured programme data becomes prescription text,
 * and the output is deliberately in the grammar `parsePrescriptionShape`
 * already accepts — the same one every stored snapshot uses. Round-trip tests
 * prove that for every slot this module can validate, formatting it and
 * parsing it back yields the same set count, result kind, per-side flag and
 * target. There is no second prescription grammar.
 *
 * Field order matters and mirrors the parser: number, then the seconds `s`,
 * then the trailing "/ side".
 */
export function formatPrescription(
  slot: Pick<
    ProgrammeSlot,
    'setCount' | 'resultKind' | 'targetMin' | 'targetMax' | 'perSide'
  >,
): string {
  const target =
    slot.targetMin === slot.targetMax
      ? String(slot.targetMin)
      : `${slot.targetMin}${EN_DASH}${slot.targetMax}`
  const seconds = slot.resultKind === 'seconds' ? 's' : ''
  const perSide = slot.perSide ? ' / side' : ''
  return `${slot.setCount} ${TIMES} ${target}${seconds}${perSide}`
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

/** Smallest and largest target a programme may author. */
export const MIN_TARGET = 1
export const MAX_TARGET = 10000

export type ProgrammeIssue =
  | { code: 'session_unknown'; sessionId: string }
  | { code: 'session_empty'; sessionId: ProgrammeSessionId }
  | { code: 'session_too_long'; sessionId: ProgrammeSessionId }
  | { code: 'exercise_id_invalid'; exerciseId: string }
  | { code: 'exercise_name_invalid'; exerciseId: string }
  | { code: 'exercise_duplicate'; exerciseId: string }
  | { code: 'slot_exercise_unknown'; sessionId: ProgrammeSessionId; exerciseId: string }
  | { code: 'slot_exercise_archived'; sessionId: ProgrammeSessionId; exerciseId: string }
  | { code: 'slot_duplicate'; sessionId: ProgrammeSessionId; exerciseId: string }
  | { code: 'slot_position_invalid'; sessionId: ProgrammeSessionId }
  | { code: 'slot_set_count_invalid'; sessionId: ProgrammeSessionId; exerciseId: string }
  | { code: 'slot_target_invalid'; sessionId: ProgrammeSessionId; exerciseId: string }
  | { code: 'slot_equipment_invalid'; sessionId: ProgrammeSessionId; exerciseId: string }
  | { code: 'slot_prescription_unreadable'; sessionId: ProgrammeSessionId; exerciseId: string }
  | { code: 'occurrence_too_many_sets'; sessionId: ProgrammeSessionId }

/** A bounded, non-empty display string, or null when it is not one. */
export function parseProgrammeText(raw: unknown, max: number): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (trimmed.length === 0 || trimmed.length > max) return null
  return trimmed
}

/**
 * Every rule a stored programme must satisfy, checked in one place.
 *
 * Returns the issues rather than throwing, so a route can refuse with a
 * precise reason and the editor can disable Save for exactly the field that is
 * wrong. An empty array means the programme is storable.
 */
export function validateProgramme(programme: Programme): ProgrammeIssue[] {
  const issues: ProgrammeIssue[] = []

  const byId = new Map<string, ProgrammeExercise>()
  for (const exercise of programme.exercises) {
    if (parseWorkoutExerciseId(exercise.exerciseId) === null) {
      issues.push({ code: 'exercise_id_invalid', exerciseId: exercise.exerciseId })
      continue
    }
    if (parseProgrammeText(exercise.name, MAX_EXERCISE_NAME_LENGTH) === null) {
      issues.push({ code: 'exercise_name_invalid', exerciseId: exercise.exerciseId })
    }
    if (byId.has(exercise.exerciseId)) {
      issues.push({ code: 'exercise_duplicate', exerciseId: exercise.exerciseId })
      continue
    }
    byId.set(exercise.exerciseId, exercise)
  }

  for (const sessionId of PROGRAMME_SESSION_IDS) {
    const slots = programme.sessions[sessionId]
    if (!Array.isArray(slots)) {
      issues.push({ code: 'session_unknown', sessionId })
      continue
    }

    // v1 refuses an empty weekday outright: a scheduled session with nothing
    // in it is not a lighter day, it is a day the app cannot Start.
    if (slots.length === 0) {
      issues.push({ code: 'session_empty', sessionId })
      continue
    }
    if (slots.length > MAX_EXERCISES_PER_SESSION) {
      issues.push({ code: 'session_too_long', sessionId })
      continue
    }

    const seen = new Set<string>()
    const positions: number[] = []
    let totalSets = 0

    for (const slot of slots) {
      const exercise = byId.get(slot.exerciseId)
      if (!exercise) {
        issues.push({
          code: 'slot_exercise_unknown',
          sessionId,
          exerciseId: slot.exerciseId,
        })
        continue
      }
      // An archived exercise keeps its history and its media; what it must not
      // keep is a place in a FUTURE workout.
      if (exercise.archived) {
        issues.push({
          code: 'slot_exercise_archived',
          sessionId,
          exerciseId: slot.exerciseId,
        })
      }
      if (seen.has(slot.exerciseId)) {
        issues.push({ code: 'slot_duplicate', sessionId, exerciseId: slot.exerciseId })
      }
      seen.add(slot.exerciseId)
      positions.push(slot.position)

      if (
        !Number.isInteger(slot.setCount) ||
        slot.setCount < 1 ||
        slot.setCount > MAX_SETS_PER_EXERCISE
      ) {
        issues.push({
          code: 'slot_set_count_invalid',
          sessionId,
          exerciseId: slot.exerciseId,
        })
      } else {
        totalSets += slot.setCount
      }

      if (
        !Number.isInteger(slot.targetMin) ||
        !Number.isInteger(slot.targetMax) ||
        slot.targetMin < MIN_TARGET ||
        slot.targetMax > MAX_TARGET ||
        slot.targetMin > slot.targetMax
      ) {
        issues.push({
          code: 'slot_target_invalid',
          sessionId,
          exerciseId: slot.exerciseId,
        })
      }

      if (slot.equipment !== null) {
        if (parseProgrammeText(slot.equipment, MAX_EQUIPMENT_LENGTH) === null) {
          issues.push({
            code: 'slot_equipment_invalid',
            sessionId,
            exerciseId: slot.exerciseId,
          })
        }
      }

      if (slot.resultKind !== 'reps' && slot.resultKind !== 'seconds') {
        issues.push({
          code: 'slot_prescription_unreadable',
          sessionId,
          exerciseId: slot.exerciseId,
        })
      }
    }

    // Contiguous 1..n, each exactly once. Checked as a set rather than by
    // sorting in place, so a caller's array order is never mutated here.
    const wanted = positions.length
    const unique = new Set(positions)
    const contiguous =
      unique.size === wanted &&
      positions.every((p) => Number.isInteger(p) && p >= 1 && p <= wanted)
    if (!contiguous) issues.push({ code: 'slot_position_invalid', sessionId })

    if (totalSets > MAX_SETS_PER_OCCURRENCE) {
      issues.push({ code: 'occurrence_too_many_sets', sessionId })
    }
  }

  return issues
}

/* ------------------------------------------------------------------ */
/* Ordering                                                            */
/* ------------------------------------------------------------------ */

/**
 * Return the slots renumbered 1..n in their current array order.
 *
 * Removing a slot compacts what is left; inserting shifts the rest. Doing it
 * by rewriting every position from the array order means a stored weekday is
 * contiguous by construction rather than by the caller remembering to be
 * careful.
 */
export function compactPositions(slots: ProgrammeSlot[]): ProgrammeSlot[] {
  return slots.map((slot, index) => ({ ...slot, position: index + 1 }))
}

/** Slots in stored order: by position, which validation guarantees is 1..n. */
export function orderedSlots(slots: readonly ProgrammeSlot[]): ProgrammeSlot[] {
  return [...slots].sort((a, b) => a.position - b.position)
}

/* ------------------------------------------------------------------ */
/* Custom exercise identity                                            */
/* ------------------------------------------------------------------ */

/** Every server-minted custom exercise id starts with this. */
export const CUSTOM_EXERCISE_PREFIX = 'custom-'

/**
 * Is this a custom exercise id?
 *
 * Used to keep a client from claiming a Foundation id for something it
 * invented, and to tell the two apart in the library without a second column.
 */
export function isCustomExerciseId(exerciseId: string): boolean {
  return exerciseId.startsWith(CUSTOM_EXERCISE_PREFIX)
}

/**
 * Mint a custom exercise id.
 *
 * SERVER-ONLY and immutable once minted: a rename never regenerates it, so
 * media, input type and every stored history row keep pointing at the same
 * exercise. The random half is lowercase hex, which keeps the whole id inside
 * the accepted slug grammar and well inside the id length bound.
 */
export function mintCustomExerciseId(random: () => number = Math.random): string {
  let suffix = ''
  while (suffix.length < 16) {
    suffix += Math.floor(random() * 0x100000000)
      .toString(16)
      .padStart(8, '0')
  }
  const id = `${CUSTOM_EXERCISE_PREFIX}${suffix.slice(0, 16)}`
  // Cheap belt-and-braces: the id we mint must satisfy the same validator
  // every other exercise id in the system is held to.
  if (
    parseWorkoutExerciseId(id) === null ||
    id.length > MAX_WORKOUT_EXERCISE_ID_LENGTH
  ) {
    throw new Error('minted an exercise id that fails the accepted id contract')
  }
  return id
}
