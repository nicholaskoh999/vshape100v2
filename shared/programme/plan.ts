import type { WorkoutExercisePlan, WorkoutLoadMode, WorkoutStartInput } from '../workoutLog'
import {
  FALLBACK_REVISION,
  FOUNDATION_SESSION_META,
  formatPrescription,
  orderedSlots,
  PROGRAMME_SESSION_IDS,
  type Programme,
  type ProgrammeSessionId,
} from './programme'

/**
 * TURNING THE PROGRAMME INTO THE PLAN A START FREEZES.
 *
 * Round 22's hard requirement: the snapshot a Start writes is built from the
 * account's CURRENT programme, server-side, not from whatever the client sends.
 * This module is that translation, and it is pure — it writes nothing and reads
 * nothing but the programme it is handed.
 *
 * The output is deliberately the EXISTING `WorkoutStartInput` shape. Everything
 * downstream of it — the Round 20 input-type freezing, the load-mode agreement,
 * the per-set expansion, the Round 19 provenance rules — is accepted, tested
 * behaviour, and this round does not get to re-litigate any of it. All that
 * changes is where the plan comes from.
 */

/** Dumbbell work, e.g. equipment "DB + Bench Flat" or name "Incline DB Press". */
const DUMBBELL_PATTERN = /\bDB\b/i
/** Band work, e.g. equipment "BAND 20kg" or name "Seated Band Row". */
const BAND_PATTERN = /\bband\b/i

/**
 * How load is REQUESTED for one canonical exercise identity.
 *
 * Ported from the client's `resolveLoadMode` with its semantics unchanged, and
 * pointed at the programme instead of the static array. Round 20's demotion of
 * it still stands and is worth restating, because moving it must not look like
 * a promotion:
 *
 * This is only the REQUEST. The server resolves the account's saved input type
 * for the exercise and forces the frozen load mode to agree, so nothing decided
 * here can make a band set carry kilogram semantics. What survives is the
 * kg / kg_each distinction, which text is genuinely good at: a dumbbell
 * exercise means PER DUMBBELL.
 *
 * Resolved across EVERY appearance, not per weekday. Monday may list Preacher
 * Curl with "DB + Bench Preacher setup" while Thursday lists no equipment — it
 * is the same movement, so it must not be dumbbell work on one day and
 * something else on another.
 */
export function requestedLoadMode(
  programme: Programme,
  exerciseId: string,
): WorkoutLoadMode {
  const name = programme.exercises.find((e) => e.exerciseId === exerciseId)?.name ?? ''

  let sawBand = false
  let sawAppearance = false
  let allBodyweightShaped = true

  for (const sessionId of PROGRAMME_SESSION_IDS) {
    for (const slot of programme.sessions[sessionId]) {
      if (slot.exerciseId !== exerciseId) continue
      sawAppearance = true

      const text = `${name} ${slot.equipment ?? ''}`
      if (DUMBBELL_PATTERN.test(text)) return 'kg_each'
      if (BAND_PATTERN.test(text)) sawBand = true

      // Structured now, so the shape is read directly rather than re-parsed.
      if (!(slot.resultKind === 'seconds' || slot.perSide)) {
        allBodyweightShaped = false
      }
    }
  }

  if (!sawAppearance) return 'kg'
  // Kept, and still not a claim about bands: answering 'none' here would deny a
  // KILOGRAM version of a band-named exercise a load field on the strength of a
  // word. The account's configured input type is what actually decides.
  if (sawBand) return 'kg'
  return allBodyweightShaped ? 'none' : 'kg'
}

/** One weekday's slots as the exercise plans a Start would freeze. */
export function planExercises(
  programme: Programme,
  sessionId: ProgrammeSessionId,
): WorkoutExercisePlan[] {
  const archived = new Set(
    programme.exercises.filter((e) => e.archived).map((e) => e.exerciseId),
  )

  return orderedSlots(programme.sessions[sessionId])
    // An archived exercise holds no place in a future workout. Validation
    // already refuses to STORE one in a weekday; this is the read-side half of
    // the same rule, so a programme that somehow held one could not Start it.
    .filter((slot) => !archived.has(slot.exerciseId))
    .map((slot) => ({
      exerciseId: slot.exerciseId,
      name:
        programme.exercises.find((e) => e.exerciseId === slot.exerciseId)?.name ??
        slot.exerciseId,
      prescription: formatPrescription(slot),
      equipment: slot.equipment,
      resultKind: slot.resultKind,
      loadMode: requestedLoadMode(programme, slot.exerciseId),
      perSide: slot.perSide,
      setCount: slot.setCount,
    }))
}

/**
 * The whole plan a Start would freeze for one weekday template.
 *
 * `sourceSessionId` names the weekday the CONTENT comes from. For a scheduled
 * workout that is the session itself; for an Extra it is the Foundation weekday
 * the user chose to copy, and it becomes the occurrence's provenance.
 *
 * Day, focus and intensity come from the fixed Foundation metadata rather than
 * from storage, because Round 22 does not make them editable.
 */
export function planFromProgramme(
  programme: Programme,
  sourceSessionId: ProgrammeSessionId,
  kind: 'scheduled' | 'extra',
): WorkoutStartInput {
  const meta = FOUNDATION_SESSION_META[sourceSessionId]
  return {
    day: meta.day,
    focus: meta.focus,
    intensity: meta.intensity,
    // Carried only where it means something: a scheduled workout is its own
    // source. buildSnapshot enforces this again from the occurrence's own id.
    sourceSessionId: kind === 'extra' ? sourceSessionId : null,
    exercises: planExercises(programme, sourceSessionId),
  }
}

/* ------------------------------------------------------------------ */
/* Reading a Start request                                             */
/* ------------------------------------------------------------------ */

export type ProgrammeStartRequest = {
  /**
   * The revision the client was looking at. The Start is refused if the
   * programme has moved since, so a stale tab can never freeze a programme the
   * user was never shown.
   */
  expectedRevision: number
  /**
   * For an Extra: which Foundation weekday template to copy. Null for a
   * scheduled workout, which is its own source.
   */
  sourceSessionId: ProgrammeSessionId | null
}

export type ParsedProgrammeStart =
  | { ok: true; value: ProgrammeStartRequest }
  | { ok: false; field: 'body' | 'expectedRevision' | 'source_session_id' }

/**
 * Read a Start body.
 *
 * WHAT A CLIENT MAY STATE, AND WHAT IT MAY NOT.
 *
 * It may state which programme revision it was looking at, and — for an Extra —
 * which weekday template it chose. That is all. Before Round 22 the body also
 * carried the entire snapshot: every exercise, name, order, prescription and
 * set count. Those fields are now IGNORED even when present, so an old or
 * modified client cannot establish a workout whose content the server never
 * agreed to.
 *
 * Ignoring rather than rejecting them is deliberate: it keeps a cached client
 * from breaking outright, while giving it no authority whatsoever.
 */
export function parseProgrammeStart(
  body: unknown,
  sessionId: string,
): ParsedProgrammeStart {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, field: 'body' }
  }
  const raw = body as Record<string, unknown>

  /*
   * AN ABSENT REVISION MEANS THE FALLBACK, NOT "SKIP THE CHECK".
   *
   * A client that does not send one is a client built before the programme
   * existed. Reading that as revision 0 is both the truthful interpretation and
   * the safe one:
   *
   *   - for an account that has never edited, the programme IS at 0, so such a
   *     client keeps working and freezes exactly the Foundation seed it was
   *     already showing
   *   - the moment that account edits anything, the stored revision is >= 1 and
   *     every one of those old clients is refused with 409
   *
   * So compatibility is preserved precisely where nothing can be stale, and
   * withdrawn precisely where something can. Treating absence as "no check"
   * would have handed any client a way to opt out of the guarantee.
   */
  const expectedRevision =
    raw.expectedRevision === undefined ? FALLBACK_REVISION : raw.expectedRevision
  if (
    typeof expectedRevision !== 'number' ||
    !Number.isInteger(expectedRevision) ||
    expectedRevision < FALLBACK_REVISION
  ) {
    return { ok: false, field: 'expectedRevision' }
  }

  const isExtra = !(PROGRAMME_SESSION_IDS as readonly string[]).includes(sessionId)

  if (isExtra) {
    // An Extra must name the Foundation weekday it was copied from, and it must
    // be one of the five. Anything else is unknowable provenance.
    if (!(PROGRAMME_SESSION_IDS as readonly string[]).includes(raw.sourceSessionId as string)) {
      return { ok: false, field: 'source_session_id' }
    }
    return {
      ok: true,
      value: {
        expectedRevision,
        sourceSessionId: raw.sourceSessionId as ProgrammeSessionId,
      },
    }
  }

  // A scheduled workout is its own source and must not name another.
  if (raw.sourceSessionId !== undefined && raw.sourceSessionId !== null) {
    return { ok: false, field: 'source_session_id' }
  }
  return { ok: true, value: { expectedRevision, sourceSessionId: null } }
}
