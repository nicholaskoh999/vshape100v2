import { daysBetween, isLocalDate } from './localDate'

/**
 * Workout logging contract and validation.
 *
 * Shared by the Worker (which decides what may be stored) and the React app
 * (which must not offer to save something the server will reject), following
 * shared/exerciseMedia.ts. One definition, so the set controls and the API can
 * never disagree about what is valid.
 *
 * Two identity layers meet here and must not be confused:
 *
 *   canonical exercise identity  — `lat-pulldown`, one shared media record
 *   workout occurrence           — (account, workout date, session id)
 *
 * A set is filed under the occurrence *plus* its position in that session
 * (`exercise_order`, `set_index`). Lat Pulldown on Monday and on Wednesday are
 * therefore separate logs even though they share one canonical identity and
 * one media record.
 */

/* ------------------------------------------------------------------ */
/* Vocabulary                                                          */
/* ------------------------------------------------------------------ */

/** A set is pending until it is resolved either way. */
export type WorkoutSetStatus = 'pending' | 'completed' | 'skipped'

/** What a completed set records: repetitions, or a hold in seconds. */
export type WorkoutResultKind = 'reps' | 'seconds'

/**
 * How load is meant.
 *
 *   kg      — one implement / stack, e.g. a band or a machine
 *   kg_each — PER DUMBBELL. 10kg each is two 10kg dumbbells, never 10kg total.
 *
 * The distinction is stored, not implied by the UI label, so historical rows
 * stay readable without knowing which component rendered them.
 */
export type WorkoutLoadUnit = 'kg' | 'kg_each'

/** Whether an exercise takes a load at all, and in which sense. */
export type WorkoutLoadMode = 'none' | WorkoutLoadUnit

export const SET_STATUSES: readonly WorkoutSetStatus[] = [
  'pending',
  'completed',
  'skipped',
]
export const RESULT_KINDS: readonly WorkoutResultKind[] = ['reps', 'seconds']
export const LOAD_UNITS: readonly WorkoutLoadUnit[] = ['kg', 'kg_each']
export const LOAD_MODES: readonly WorkoutLoadMode[] = ['none', 'kg', 'kg_each']

/* ------------------------------------------------------------------ */
/* Bounds                                                              */
/* ------------------------------------------------------------------ */

/** Real session slugs are ~9 characters. */
export const MAX_SESSION_ID_LENGTH = 64
/** Real exercise slugs are ~24 characters. */
export const MAX_WORKOUT_EXERCISE_ID_LENGTH = 64
export const MAX_EXERCISE_NAME_LENGTH = 80
export const MAX_PRESCRIPTION_LENGTH = 80
export const MAX_EQUIPMENT_LENGTH = 80
export const MAX_DAY_LABEL_LENGTH = 32
export const MAX_FOCUS_LENGTH = 120
export const MAX_INTENSITY_LENGTH = 16

/** A malformed payload must not be able to create thousands of rows. */
export const MAX_EXERCISES_PER_SESSION = 24
export const MAX_SETS_PER_EXERCISE = 20
export const MAX_SETS_PER_OCCURRENCE = 200

/** Largest reps / seconds a single set may record. */
export const MAX_SET_RESULT = 10_000
/** Largest load a single set may record, in kg. */
export const MAX_SET_LOAD = 1_000

/* ------------------------------------------------------------------ */
/* Primitive validation                                                */
/* ------------------------------------------------------------------ */

/** Lowercase slug, e.g. `monday` or `lat-pulldown`. */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/**
 * A real calendar date in `YYYY-MM-DD`, so 2026-02-30 is rejected.
 *
 * This is the user's LOCAL workout date. Validation lives in
 * shared/localDate.ts so Holiday, Foundation and workout dates all agree on
 * what a calendar date is rather than each carrying their own copy.
 */
export function isWorkoutDate(value: unknown): value is string {
  return isLocalDate(value)
}

/** Validate the workout date, returning it or null. */
export function parseWorkoutDate(raw: unknown): string | null {
  return isWorkoutDate(raw) ? raw : null
}

/**
 * Validate a session slug's *shape*. Membership of the training week stays the
 * client's single source of truth, the same split Today applies to item ids.
 */
export function parseSessionId(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  if (raw.length === 0 || raw.length > MAX_SESSION_ID_LENGTH) return null
  return SLUG_PATTERN.test(raw) ? raw : null
}

/** Validate an exercise slug's shape. */
export function parseWorkoutExerciseId(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  if (raw.length === 0 || raw.length > MAX_WORKOUT_EXERCISE_ID_LENGTH) return null
  return SLUG_PATTERN.test(raw) ? raw : null
}

/** A non-negative integer index within `limit` (exclusive). NaN/Infinity rejected. */
export function parseIndex(raw: unknown, limit: number): number | null {
  const value =
    typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : Number.NaN
  if (!Number.isInteger(value)) return null
  if (value < 0 || value >= limit) return null
  return value
}

export function parseExerciseOrder(raw: unknown): number | null {
  return parseIndex(raw, MAX_EXERCISES_PER_SESSION)
}

export function parseSetIndex(raw: unknown): number | null {
  return parseIndex(raw, MAX_SETS_PER_EXERCISE)
}

export function isSetStatus(value: unknown): value is WorkoutSetStatus {
  return typeof value === 'string' && (SET_STATUSES as readonly string[]).includes(value)
}

export function isResultKind(value: unknown): value is WorkoutResultKind {
  return typeof value === 'string' && (RESULT_KINDS as readonly string[]).includes(value)
}

export function isLoadUnit(value: unknown): value is WorkoutLoadUnit {
  return typeof value === 'string' && (LOAD_UNITS as readonly string[]).includes(value)
}

export function isLoadMode(value: unknown): value is WorkoutLoadMode {
  return typeof value === 'string' && (LOAD_MODES as readonly string[]).includes(value)
}

/**
 * A completed set's result: a positive, finite, whole number of reps or
 * seconds. Zero is rejected — a set of zero reps was not completed, it was
 * skipped, and the two must not be conflated.
 */
export function isSetResult(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value > 0 &&
    value <= MAX_SET_RESULT
  )
}

/**
 * A load in kg: finite and non-negative. Zero is allowed — an assisted or
 * unloaded working set is a real thing to record. Halves are allowed because
 * dumbbells come in 2.5kg steps.
 */
export function isSetLoad(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= MAX_SET_LOAD
  )
}

/** A bounded, non-empty snapshot string. */
function parseText(raw: unknown, max: number): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (trimmed.length === 0 || trimmed.length > max) return null
  return trimmed
}

/** A bounded optional snapshot string. Absent and empty both mean "none". */
function parseOptionalText(raw: unknown, max: number): string | null | undefined {
  if (raw === undefined || raw === null) return null
  if (typeof raw !== 'string') return undefined
  const trimmed = raw.trim()
  if (trimmed.length === 0) return null
  return trimmed.length <= max ? trimmed : undefined
}

/* ------------------------------------------------------------------ */
/* Start payload                                                       */
/* ------------------------------------------------------------------ */

/** One exercise of the snapshot a Start establishes. */
export type WorkoutExercisePlan = {
  exerciseId: string
  name: string
  prescription: string
  equipment: string | null
  resultKind: WorkoutResultKind
  loadMode: WorkoutLoadMode
  perSide: boolean
  setCount: number
}

/** The whole snapshot a Start establishes. Identity is never part of it. */
export type WorkoutStartInput = {
  day: string
  focus: string
  intensity: string
  exercises: WorkoutExercisePlan[]
}

/** Which part of a start payload was rejected. Never echoes the value. */
export type StartField =
  | 'body'
  | 'day'
  | 'focus'
  | 'intensity'
  | 'exercises'
  | 'exercise'
  | 'setCount'
  | 'total_sets'

export type ParsedStart =
  | { ok: true; value: WorkoutStartInput }
  | { ok: false; field: StartField }

function parseExercisePlan(raw: unknown): WorkoutExercisePlan | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const row = raw as Record<string, unknown>

  const exerciseId = parseWorkoutExerciseId(row.exerciseId)
  if (!exerciseId) return null

  const name = parseText(row.name, MAX_EXERCISE_NAME_LENGTH)
  if (name === null) return null

  const prescription = parseText(row.prescription, MAX_PRESCRIPTION_LENGTH)
  if (prescription === null) return null

  const equipment = parseOptionalText(row.equipment, MAX_EQUIPMENT_LENGTH)
  if (equipment === undefined) return null

  if (!isResultKind(row.resultKind)) return null
  if (!isLoadMode(row.loadMode)) return null
  if (typeof row.perSide !== 'boolean') return null

  return {
    exerciseId,
    name,
    prescription,
    equipment,
    resultKind: row.resultKind,
    loadMode: row.loadMode,
    perSide: row.perSide,
    // Bounded by the caller so the failing field can be reported precisely.
    setCount: 0,
  }
}

/**
 * Validate a Start body into a storable snapshot.
 *
 * Everything is bounded: a hostile payload cannot ask for thousands of
 * exercises or sets, and no string can grow without limit.
 */
export function parseStartInput(body: unknown): ParsedStart {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, field: 'body' }
  }
  const raw = body as Record<string, unknown>

  const day = parseText(raw.day, MAX_DAY_LABEL_LENGTH)
  if (day === null) return { ok: false, field: 'day' }

  const focus = parseText(raw.focus, MAX_FOCUS_LENGTH)
  if (focus === null) return { ok: false, field: 'focus' }

  const intensity = parseText(raw.intensity, MAX_INTENSITY_LENGTH)
  if (intensity === null) return { ok: false, field: 'intensity' }

  if (!Array.isArray(raw.exercises)) return { ok: false, field: 'exercises' }
  if (raw.exercises.length === 0 || raw.exercises.length > MAX_EXERCISES_PER_SESSION) {
    return { ok: false, field: 'exercises' }
  }

  const exercises: WorkoutExercisePlan[] = []
  let totalSets = 0

  for (const entry of raw.exercises) {
    const plan = parseExercisePlan(entry)
    if (!plan) return { ok: false, field: 'exercise' }

    const setCount = (entry as Record<string, unknown>).setCount
    if (
      typeof setCount !== 'number' ||
      !Number.isInteger(setCount) ||
      setCount < 1 ||
      setCount > MAX_SETS_PER_EXERCISE
    ) {
      return { ok: false, field: 'setCount' }
    }

    totalSets += setCount
    if (totalSets > MAX_SETS_PER_OCCURRENCE) return { ok: false, field: 'total_sets' }

    exercises.push({ ...plan, setCount })
  }

  return { ok: true, value: { day, focus, intensity, exercises } }
}

/* ------------------------------------------------------------------ */
/* Set mutation payload                                                */
/* ------------------------------------------------------------------ */

/** What a PUT asks of one expected set. */
export type WorkoutSetUpdate =
  | {
      action: 'complete'
      result: number
      load: { value: number; unit: WorkoutLoadUnit } | null
    }
  | { action: 'skip' }

export type SetField = 'body' | 'action' | 'result' | 'load' | 'unit'

export type ParsedSetUpdate =
  | { ok: true; value: WorkoutSetUpdate }
  | { ok: false; field: SetField }

/**
 * Validate a set mutation.
 *
 * A completed set must carry a real result — the server never invents one.
 * A skipped set carries no result and no load: skipping is not a quiet way to
 * record a completed working set.
 */
export function parseSetUpdate(body: unknown): ParsedSetUpdate {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, field: 'body' }
  }
  const raw = body as Record<string, unknown>

  if (raw.action === 'skip') return { ok: true, value: { action: 'skip' } }
  if (raw.action !== 'complete') return { ok: false, field: 'action' }

  if (!isSetResult(raw.result)) return { ok: false, field: 'result' }

  if (raw.load === undefined || raw.load === null) {
    return { ok: true, value: { action: 'complete', result: raw.result, load: null } }
  }
  if (typeof raw.load !== 'object' || Array.isArray(raw.load)) {
    return { ok: false, field: 'load' }
  }

  const load = raw.load as Record<string, unknown>
  if (!isSetLoad(load.value)) return { ok: false, field: 'load' }
  if (!isLoadUnit(load.unit)) return { ok: false, field: 'unit' }

  return {
    ok: true,
    value: {
      action: 'complete',
      result: raw.result,
      load: { value: load.value, unit: load.unit },
    },
  }
}

/* ------------------------------------------------------------------ */
/* Display helpers                                                     */
/* ------------------------------------------------------------------ */

export type WorkoutProgress = {
  total: number
  completed: number
  skipped: number
  /** completed + skipped — how far the workout has been traversed. */
  resolved: number
}

/**
 * How far a workout has been logged.
 *
 * `resolved` counts a skipped set, because traversal is what the progress line
 * describes. `completed` and `skipped` stay separate so nothing downstream can
 * read a skip as successful training.
 */
export function summariseSets(
  sets: readonly { status: WorkoutSetStatus }[],
): WorkoutProgress {
  let completed = 0
  let skipped = 0
  for (const set of sets) {
    if (set.status === 'completed') completed += 1
    else if (set.status === 'skipped') skipped += 1
  }
  return { total: sets.length, completed, skipped, resolved: completed + skipped }
}

/* ------------------------------------------------------------------ */
/* Recorded history                                                    */
/* ------------------------------------------------------------------ */

/** Default number of recent workouts a history read returns. */
export const DEFAULT_HISTORY_LIMIT = 20
/** Most a single history read may ask for. */
export const MAX_HISTORY_LIMIT = 50

/**
 * Validate a `?limit=` value.
 *
 * Absent means the default. Anything else must be a whole number inside the
 * bound — a malformed or unbounded limit is rejected rather than quietly
 * clamped, so a caller is told its request was wrong instead of silently
 * getting a different page than it asked for.
 */
export function parseHistoryLimit(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined || raw === '') return DEFAULT_HISTORY_LIMIT
  const value = Number(raw)
  if (!Number.isInteger(value)) return null
  if (value < 1 || value > MAX_HISTORY_LIMIT) return null
  return value
}

/**
 * Most days one range read may span.
 *
 * Matches the Holiday range bound, so a caller asking both surfaces about the
 * same window can never be answered by one and refused by the other.
 */
export const MAX_HISTORY_RANGE_DAYS = 366

/**
 * Most rows one range read may return.
 *
 * A bound is required even with a bounded range, because a single date can
 * hold more than one session. When it truncates, the response says so rather
 * than presenting a partial answer as the whole truth.
 */
export const MAX_HISTORY_RANGE_ROWS = 400

/** A validated inclusive `from`/`to` span. */
export type HistoryRange = { from: string; to: string }

/**
 * Validate a `?from=&to=` pair.
 *
 * Returns null when either is absent, so a caller can tell "no range asked
 * for" from "a range was asked for and it was wrong" — those are a normal
 * paged read and a 400 respectively.
 */
export function parseHistoryRange(
  from: string | null | undefined,
  to: string | null | undefined,
): { present: false } | { present: true; range: HistoryRange | null } {
  if ((from ?? '') === '' && (to ?? '') === '') return { present: false }
  if (!isWorkoutDate(from) || !isWorkoutDate(to)) return { present: true, range: null }
  if (from > to) return { present: true, range: null }

  const span = daysBetween(from, to)
  if (span === null || span + 1 > MAX_HISTORY_RANGE_DAYS) return { present: true, range: null }
  return { present: true, range: { from, to } }
}

/**
 * One recorded workout, as history reports it.
 *
 * Every field is a fact that was persisted. Nothing here is inferred: a
 * workout that was never started simply is not in history, and this round
 * never invents one to represent it.
 */
export type WorkoutHistoryEntry = {
  date: string
  sessionId: string
  day: string
  focus: string
  intensity: string
  startedAt: number
  updatedAt: number
  progress: WorkoutProgress
}

/** Totals across everything an account has recorded, not just one page. */
export type WorkoutHistoryTotals = {
  workouts: number
  sets: number
  completed: number
  skipped: number
  resolved: number
}

/**
 * True when every expected set of a workout has been resolved either way.
 *
 * Deliberately NOT called "complete": a workout whose sets were all skipped is
 * fully traversed and not trained at all. Callers that care about training
 * must read `completed`.
 */
export function isFullyResolved(progress: WorkoutProgress): boolean {
  return progress.total > 0 && progress.resolved === progress.total
}

/** How many expected sets are still untouched. */
export function pendingSets(progress: WorkoutProgress): number {
  return Math.max(0, progress.total - progress.resolved)
}

/** "kg each" for dumbbells, "kg" otherwise. Never abbreviated away. */
export function loadUnitLabel(unit: WorkoutLoadUnit): string {
  return unit === 'kg_each' ? 'kg each' : 'kg'
}

/** "Reps", "Reps / side" or "Seconds" — the label on a set's result input. */
export function resultLabel(kind: WorkoutResultKind, perSide: boolean): string {
  if (kind === 'seconds') return 'Seconds'
  return perSide ? 'Reps / side' : 'Reps'
}
