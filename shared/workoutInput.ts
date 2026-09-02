/**
 * How an exercise is actually loaded — the truth Round 20 was written for.
 *
 * THE DEFECT THIS EXISTS TO FIX.
 *
 * Every recorded set used to be kilograms, because kilograms were the only
 * thing the schema could express. A Triceps Pushdown performed with a black
 * band, three bands deep, was stored and displayed as "3 kg × 12" — a sentence
 * about the user's training that was simply not true. The quantity of bands had
 * been written into the weight column.
 *
 * So the modality is now typed, and it is a property of the EXERCISE that the
 * user configures, not something inferred from an English name or an old
 * programme label. "Contains BAND" was never going to survive contact with a
 * real gym.
 *
 * THREE KINDS, AND ONLY THREE.
 *
 *   weight_kg        a numeric load in kilograms, keeping the existing
 *                    kg / kg_each distinction where kg_each is PER DUMBBELL
 *   resistance_band  a named band and how many of them; never a number of kg
 *   bodyweight       no external resistance at all; reps or seconds only
 *
 * This is deliberately NOT an equipment inventory, a band hierarchy, or a
 * conversion table. There is no arithmetic that turns a black band into
 * kilograms, because no such arithmetic is true.
 *
 * This module is a LEAF: it is the vocabulary, and it imports nothing. The
 * rules that reconcile an input type with the older load-mode model live in
 * shared/workoutLog.ts, which owns the logging contract, so the dependency runs
 * one way only.
 */

export const WORKOUT_INPUT_TYPES = [
  'weight_kg',
  'resistance_band',
  'bodyweight',
] as const

export type WorkoutInputType = (typeof WORKOUT_INPUT_TYPES)[number]

/** How each kind is named to the user, everywhere it appears. */
export const WORKOUT_INPUT_TYPE_LABELS: Record<WorkoutInputType, string> = {
  weight_kg: 'Weight (kg)',
  resistance_band: 'Resistance band',
  bodyweight: 'Bodyweight / no load',
}

/** One line explaining what each kind records. */
export const WORKOUT_INPUT_TYPE_DESCRIPTIONS: Record<WorkoutInputType, string> = {
  weight_kg: 'A numeric load in kilograms.',
  resistance_band: 'A named band and how many of them. Never converted to kg.',
  bodyweight: 'No external resistance — reps or seconds only.',
}

export function isWorkoutInputType(value: unknown): value is WorkoutInputType {
  return (
    typeof value === 'string' &&
    (WORKOUT_INPUT_TYPES as readonly string[]).includes(value)
  )
}

/* ------------------------------------------------------------------ */
/* Bounds                                                              */
/* ------------------------------------------------------------------ */

/** A band label is a short factual name like "Black" or "Heavy red". */
export const MAX_BAND_LABEL_LENGTH = 32

/**
 * How many bands may be stacked on one set.
 *
 * A bound, not a judgement: nothing here reads the number as resistance, and
 * two bands are not "twice" one band in any sense this app claims.
 */
export const MAX_BAND_COUNT = 20

/**
 * Read a band label.
 *
 * Trimmed, bounded, and non-empty — a completed band set that cannot say WHICH
 * band was used records nothing useful, and blank text would read later as if
 * the information had been lost rather than never captured.
 */
export function parseBandLabel(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (trimmed.length === 0 || trimmed.length > MAX_BAND_LABEL_LENGTH) return null
  return trimmed
}

/** Read a band quantity: a positive whole number of bands, bounded. */
export function parseBandCount(raw: unknown): number | null {
  if (typeof raw !== 'number' || !Number.isInteger(raw)) return null
  if (raw < 1 || raw > MAX_BAND_COUNT) return null
  return raw
}

/**
 * Compare two band labels for the purposes of "is this the same setup".
 *
 * Case and surrounding space are noise; everything else is significant. This is
 * ONLY an equality test. It deliberately provides no ordering, because ordering
 * band labels would mean claiming black is stronger than red, and this app has
 * no basis for that claim.
 */
export function normalizeBandLabel(label: string): string {
  return label.trim().toLowerCase()
}
