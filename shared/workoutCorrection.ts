import {
  isWorkoutInputType,
  parseBandCount,
  parseBandLabel,
  type WorkoutInputType,
} from './workoutInput'
import {
  isLoadUnit,
  isSetLoad,
  isSetResult,
  loadModeForInputType,
  type WorkoutLoadMode,
  type WorkoutLoadUnit,
} from './workoutLog'

/**
 * Correcting a set that recorded the wrong thing.
 *
 * WHY THIS EXISTS, AND WHY IT IS NARROW.
 *
 * Round 20 gave resistance a type, and deliberately refused to reinterpret the
 * history written before it. That was right: a set stored as "3 kg × 12" when
 * it was three black bands is a wrong record, and guessing which wrong records
 * to rewrite would have replaced one inaccuracy with another.
 *
 * So the user says so, explicitly, one set at a time. This module defines what
 * they are allowed to assert.
 *
 * IT CORRECTS WHAT WAS MEASURED, NEVER WHAT HAPPENED.
 *
 * The performance evidence — the modality, the load, the band, the result — is
 * editable, because that is the part that can be factually wrong. Everything
 * that says WHICH set this is stays untouched: the date, the session, the
 * provenance, the exercise, its order, the set index, the prescription, the
 * result kind, the per-side semantics, and above all the STATUS. A correction
 * never turns a skipped set into a completed one, or the reverse. It changes
 * the reading, not the training.
 *
 * THE ONE EXCEPTION TO SNAPSHOT IMMUTABILITY.
 *
 * `input_type_snapshot` and `load_mode_snapshot` are frozen at Start and no
 * ordinary route may touch them. This is the single audited exception, because
 * the modality itself is exactly what the old record got wrong. Nothing else
 * gains that power, and every use of it is recorded permanently.
 *
 * THE TARGET MODALITY IS ASSERTED, NEVER INFERRED.
 *
 * It is not read from the exercise's current Exercise Library setting. The user
 * is saying what THAT HISTORICAL SET actually was, which may differ from how
 * they train the exercise today — and in the case this round exists for, it
 * does.
 */

/** The factual performance a correction asserts the set really recorded. */
export type WorkoutSetCorrection = {
  inputType: WorkoutInputType
  /** Forced to agree with the input type, so a hybrid is unrepresentable. */
  loadMode: WorkoutLoadMode
  load: { value: number; unit: WorkoutLoadUnit } | null
  band: { label: string; count: number } | null
  result: number
}

export type CorrectionField =
  | 'body'
  | 'inputType'
  | 'load'
  | 'unit'
  | 'band'
  | 'result'
  | 'expectedUpdatedAt'

export type ParsedCorrection =
  | { ok: true; value: WorkoutSetCorrection; expectedUpdatedAt: number }
  | { ok: false; field: CorrectionField }

/**
 * Read a correction request.
 *
 * The envelope is checked before any field, so a body that is not an object at
 * all is reported as such rather than as a missing modality — the distinction a
 * client needs to tell a malformed request from a rejected value.
 *
 * `expectedUpdatedAt` is the version the editor actually read. It is required:
 * a correction is a rewrite of history, and rewriting a value somebody else has
 * changed since you looked at it is precisely the mistake this feature must not
 * make. There is no last-write-wins path.
 */
export function parseSetCorrection(body: unknown): ParsedCorrection {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, field: 'body' }
  }
  const raw = body as Record<string, unknown>

  if (!isWorkoutInputType(raw.inputType)) return { ok: false, field: 'inputType' }
  const inputType = raw.inputType

  // A whole millisecond timestamp, as the server issued it. Anything else is a
  // client that did not read before it wrote.
  if (
    typeof raw.expectedUpdatedAt !== 'number' ||
    !Number.isInteger(raw.expectedUpdatedAt) ||
    raw.expectedUpdatedAt < 0
  ) {
    return { ok: false, field: 'expectedUpdatedAt' }
  }

  // A correction only ever describes a COMPLETED set, so a result is always
  // required. There is no way to correct a set into having no performance.
  if (!isSetResult(raw.result)) return { ok: false, field: 'result' }

  const band = readBand(raw.band)
  if (band === 'invalid') return { ok: false, field: 'band' }

  const load = readLoad(raw.load)
  if (load === 'invalid-value') return { ok: false, field: 'load' }
  if (load === 'invalid-unit') return { ok: false, field: 'unit' }

  // COHERENCE. Each modality admits exactly one shape of evidence, and a
  // payload carrying the other kind is refused outright rather than having the
  // surplus quietly dropped — silently discarding half of what someone asserted
  // is how a correction ends up recording something they did not mean.
  if (inputType === 'resistance_band') {
    if (load !== null) return { ok: false, field: 'load' }
    if (band === null) return { ok: false, field: 'band' }
  } else if (inputType === 'bodyweight') {
    if (load !== null) return { ok: false, field: 'load' }
    if (band !== null) return { ok: false, field: 'band' }
  } else {
    // weight_kg
    if (band !== null) return { ok: false, field: 'band' }
    // A kilogram set must say how many kilograms. "Weight, amount unknown" is
    // not a correction, it is a gap.
    if (load === null) return { ok: false, field: 'load' }
  }

  return {
    ok: true,
    expectedUpdatedAt: raw.expectedUpdatedAt,
    value: {
      inputType,
      // Derived, never taken from the request: this is what keeps the stored
      // pair coherent by construction rather than by hope.
      loadMode: loadModeForInputType(inputType, load?.unit),
      load,
      band,
      result: raw.result,
    },
  }
}

/** `null` = absent, `'invalid'` = present but unusable. */
function readBand(raw: unknown): { label: string; count: number } | null | 'invalid' {
  if (raw === undefined || raw === null) return null
  if (typeof raw !== 'object' || Array.isArray(raw)) return 'invalid'
  const row = raw as Record<string, unknown>
  const label = parseBandLabel(row.label)
  const count = parseBandCount(row.count)
  // Half a band record is not a smaller record, it is an unreadable one.
  if (label === null || count === null) return 'invalid'
  return { label, count }
}

function readLoad(
  raw: unknown,
): { value: number; unit: WorkoutLoadUnit } | null | 'invalid-value' | 'invalid-unit' {
  if (raw === undefined || raw === null) return null
  if (typeof raw !== 'object' || Array.isArray(raw)) return 'invalid-value'
  const row = raw as Record<string, unknown>
  if (!isSetLoad(row.value)) return 'invalid-value'
  if (!isLoadUnit(row.unit)) return 'invalid-unit'
  return { value: row.value, unit: row.unit }
}

/** The stored performance of a set, as the correction path compares it. */
export type CorrectableFacts = {
  inputType: WorkoutInputType | null
  loadMode: WorkoutLoadMode
  loadValue: number | null
  loadUnit: WorkoutLoadUnit | null
  bandLabel: string | null
  bandCount: number | null
  result: number | null
}

/**
 * Would this correction actually change anything?
 *
 * A correction that asserts exactly what is already stored is not a correction.
 * Writing an audit event for it would put a permanent record of a rewrite that
 * never happened into the history — which is its own small dishonesty — so the
 * route answers "no change" instead.
 *
 * Compared on the STORED shape, including the frozen load mode, so switching a
 * legacy row from an inferred modality to the same modality explicitly still
 * counts as a change when the stored snapshot genuinely differs.
 */
export function isNoOpCorrection(
  before: CorrectableFacts,
  after: WorkoutSetCorrection,
): boolean {
  return (
    before.inputType === after.inputType &&
    before.loadMode === after.loadMode &&
    before.loadValue === (after.load ? after.load.value : null) &&
    before.loadUnit === (after.load ? after.load.unit : null) &&
    before.bandLabel === (after.band ? after.band.label : null) &&
    before.bandCount === (after.band ? after.band.count : null) &&
    before.result === after.result
  )
}
