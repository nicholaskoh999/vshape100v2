import { isLocalDate } from './localDate.ts'
import { isIanaTimeZone, localDateIn } from './timeZone.ts'

/**
 * Today Training Flex — the contract shared by the Worker and the React app.
 *
 * WHAT THIS IS.
 *
 * Some days the Foundation strength workout is not the right thing to do. Flex
 * lets the user say so EXPLICITLY, for the current local day only, choosing
 * between the scheduled workout, a deliberate Recovery day, and one named
 * alternative activity.
 *
 * WHAT THIS IS NOT, and the distinction matters more than the feature does:
 *
 *   - It is not a workout. Choosing Recovery or Fitness Boxing records a
 *     DECISION about the day, never a training result. No occurrence, no sets,
 *     no load, no reps, no personal best, and nothing Round 16 progression can
 *     read. The tables that hold training evidence are not touched at all.
 *   - It is not a schedule builder. It cannot add, move, rename or remove a
 *     session, and it says nothing about tomorrow.
 *   - It is not a holiday. Holiday Training Off/On stays the authority on
 *     whether a day plans training in the first place; flex only ever answers
 *     what the user did about a day that DOES plan it.
 *   - It is not a completion. A day resolved as Recovery is not a finished
 *     Monday, and nothing here may make it look like one.
 *
 * STREAK RULE (v1): both kinds are NEUTRAL. A flex day neither extends nor
 * breaks the planned-strength streak — the same standing weekends and Holidays
 * already have. Extending it would reward not doing the session; breaking it
 * would punish an honest, deliberate choice the product asked the user to make.
 */

/**
 * The allowed kinds, exhaustively.
 *
 * An explicit allowlist, not an open string: an unrecognised value must be
 * refused rather than stored and rendered later as something nobody chose.
 * "Arbitrary alternative activities" is an explicit non-goal.
 */
export const TRAINING_FLEX_KINDS = ['recovery', 'fitness_boxing_2'] as const

export type TrainingFlexKind = (typeof TRAINING_FLEX_KINDS)[number]

/** How each kind is named to the user, everywhere it appears. */
export const TRAINING_FLEX_LABELS: Record<TrainingFlexKind, string> = {
  recovery: 'Recovery today',
  fitness_boxing_2: 'Nintendo Fitness Boxing 2',
}

/** One-line explanation of what each choice means. */
export const TRAINING_FLEX_DESCRIPTIONS: Record<TrainingFlexKind, string> = {
  recovery: 'Deliberate rest. No strength session today, and no missed day.',
  fitness_boxing_2: 'An alternative activity instead of the strength session.',
}

/** A stored choice: one kind, on one local date, for one account. */
export type TrainingFlexChoice = {
  date: string
  kind: TrainingFlexKind
}

export function isTrainingFlexKind(value: unknown): value is TrainingFlexKind {
  return (
    typeof value === 'string' &&
    (TRAINING_FLEX_KINDS as readonly string[]).includes(value)
  )
}

/* ------------------------------------------------------------------ */
/* Reading stored / transported values — fail closed                   */
/* ------------------------------------------------------------------ */

/**
 * What a stored or transported flex kind turned out to be.
 *
 * The same three-way split the account settings contract uses, and for the same
 * reason: "no choice made" and "a value we cannot read" are different facts,
 * and collapsing them lets corruption quietly become a real-looking answer.
 */
export type TrainingFlexValue =
  | { kind: 'none' }
  | { kind: 'choice'; value: TrainingFlexKind }
  | { kind: 'unreadable' }

export function readTrainingFlexKind(raw: unknown): TrainingFlexValue {
  if (raw === null || raw === undefined) return { kind: 'none' }
  if (isTrainingFlexKind(raw)) return { kind: 'choice', value: raw }
  return { kind: 'unreadable' }
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

export type TrainingFlexField = 'body' | 'timezone' | 'date' | 'kind'

export type ParsedTrainingFlexUpdate =
  | { ok: true; value: { date: string; kind: TrainingFlexKind | null } }
  | { ok: false; field: TrainingFlexField }

/**
 * Validate an update body.
 *
 * `kind: null` clears the day's choice, which is how "actually, I will do the
 * scheduled workout after all" is expressed. It is a real intention, not an
 * error, and it deletes rather than storing a third kind.
 *
 * IDENTITY IS NOT PART OF THIS SHAPE. The account is the `google_sub` on the
 * authenticated session, resolved server-side; there is no `googleSub` field in
 * any accepted payload, so sending one changes nothing.
 */
export function parseTrainingFlexUpdate(
  body: unknown,
  now: Date,
): ParsedTrainingFlexUpdate {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, field: 'body' }
  }
  const raw = body as Record<string, unknown>

  // The zone is validated FIRST, because without a usable zone there is no such
  // thing as the caller's "today" and therefore nothing to compare the date
  // against. Missing, malformed or unknown all fail closed here — there is no
  // silent fall back to UTC, which would be a different day from the user's for
  // part of every day.
  if (!isIanaTimeZone(raw.timezone)) return { ok: false, field: 'timezone' }
  const today = localDateIn(now, raw.timezone)
  if (today === null) return { ok: false, field: 'timezone' }

  if (!Object.hasOwn(raw, 'date') || !isLocalDate(raw.date)) {
    return { ok: false, field: 'date' }
  }
  const date = raw.date as string

  // EXACTLY today in the caller's own zone. Not "close to" today: yesterday is
  // past backfill and tomorrow is future scheduling, and Round 19 locked both
  // out. A flex choice describes the day the user is actually living.
  if (date !== today) return { ok: false, field: 'date' }

  if (!Object.hasOwn(raw, 'kind')) return { ok: false, field: 'kind' }
  const kind = raw.kind
  if (kind === null) return { ok: true, value: { date, kind: null } }
  if (!isTrainingFlexKind(kind)) return { ok: false, field: 'kind' }

  return { ok: true, value: { date, kind } }
}

