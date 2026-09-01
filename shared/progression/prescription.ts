/**
 * Reading an authored prescription.
 *
 * Round 08 established that a prescription string carries loggable STRUCTURE:
 * how many sets, reps or seconds, per side or not. Round 16 needs one more
 * thing out of the same text — the authored TARGET RANGE — because double
 * progression is defined against the range the plan actually wrote down.
 *
 * Both readings live here, in shared/, because the Worker now derives guidance
 * from the prescription snapshot it stored, and the React app still derives the
 * set structure it offers to log. One parser, so the two can never disagree
 * about what `4 × 10–15` means.
 *
 * Nothing here invents a target. An unrecognised prescription returns null, and
 * a lane built on it fails closed rather than guessing bounds.
 */

import type { WorkoutResultKind } from '../workoutLog'

/** What one prescription means for LOGGING. Round 08's reading, unchanged. */
export type PrescriptionShape = {
  setCount: number
  resultKind: WorkoutResultKind
  /** True for "10 / side" — the logged number is per side. */
  perSide: boolean
  /** The rep/second target as written, e.g. "10–15". Display only. */
  target: string
}

/**
 * What one prescription means for PROGRESSION: the same shape plus the
 * authored bounds as numbers.
 *
 * `lower` and `upper` are the gates double progression is judged against. A
 * single-number target such as "10" has lower === upper === 10, which is a
 * real authored target and not a degenerate range.
 */
export type PrescriptionTarget = PrescriptionShape & {
  lower: number
  upper: number
}

/** `<count> × <rest>` — the multiplication sign is U+00D7, as authored. */
const PRESCRIPTION_PATTERN = /^(\d+)\s*×\s*(.+)$/
/** A single number or a range, using an en dash or a plain hyphen. */
const TARGET_PATTERN = /^\d+(?:\s*[–-]\s*\d+)?$/
/** Trailing "/ side". */
const PER_SIDE_PATTERN = /\s*\/\s*side$/i
/** A seconds target ends in `s`, e.g. "30–60s". */
const SECONDS_PATTERN = /^(.*\d)\s*s$/i
/** The two halves of a range, however it was punctuated. */
const RANGE_PATTERN = /^(\d+)\s*[–-]\s*(\d+)$/

/** Most sets any single Foundation prescription may ask for. */
const MAX_PARSED_SETS = 20

/**
 * Parse one prescription's loggable shape, or null when it is not a shape we
 * understand.
 *
 * This is the Round 08 reading, moved here verbatim in behaviour: the same
 * accepted strings parse, the same ones refuse, and `target` is still the
 * text as written rather than a normalised form.
 */
export function parsePrescriptionShape(
  raw: string | null | undefined,
): PrescriptionShape | null {
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

/**
 * Parse one prescription's authored TARGET, or null when no usable range can
 * be read from it.
 *
 * Stricter than the shape reading on purpose. Progression is judged against
 * these two numbers, so a target that cannot be read as an ordered range is
 * refused outright rather than half-understood:
 *
 *   - a descending range ("15–10") names no gate to climb towards
 *   - a zero lower bound is not a rep target anyone authored
 *
 * The shape reading is deliberately NOT tightened to match. It answers "how
 * many rows do I draw", which stays answerable for text this function refuses,
 * and Round 08's accepted logging behaviour must not change underneath it.
 */
export function parsePrescriptionTarget(
  raw: string | null | undefined,
): PrescriptionTarget | null {
  const shape = parsePrescriptionShape(raw)
  if (!shape) return null

  const range = RANGE_PATTERN.exec(shape.target)
  if (range) {
    const lower = Number(range[1])
    const upper = Number(range[2])
    if (!Number.isInteger(lower) || !Number.isInteger(upper)) return null
    if (lower <= 0 || upper <= 0) return null
    // A range must be written low-to-high. Silently swapping the two would
    // invent an authored intent nobody wrote.
    if (lower > upper) return null
    return { ...shape, lower, upper }
  }

  const single = Number(shape.target)
  if (!Number.isInteger(single) || single <= 0) return null
  // A single authored number is a real target, not a missing range: the gate
  // to reach and the gate to hold are the same number.
  return { ...shape, lower: single, upper: single }
}
