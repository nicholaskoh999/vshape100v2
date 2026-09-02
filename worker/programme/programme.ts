import { foundationProgramme } from '../../shared/programme/foundation'
import {
  FALLBACK_REVISION,
  compactPositions,
  isCustomExerciseId,
  mintCustomExerciseId,
  orderedSlots,
  parseProgrammeText,
  PROGRAMME_SESSION_IDS,
  validateProgramme,
  type Programme,
  type ProgrammeExercise,
  type ProgrammeIssue,
  type ProgrammeSessionId,
  type ProgrammeSessions,
  type ProgrammeSlot,
} from '../../shared/programme/programme'
import { isWorkoutInputType, type WorkoutInputType } from '../../shared/workoutInput'
import { MAX_EXERCISE_NAME_LENGTH } from '../../shared/workoutLog'

/**
 * THE PROGRAMME, SERVER SIDE.
 *
 * Two responsibilities, kept apart from storage on purpose so the rules can be
 * tested directly:
 *
 *   RESOLVE   what is this account's programme right now
 *   SAVE      apply a whole desired programme, if the writer is not stale
 *
 * THE FALLBACK IS A READ, NOT A WRITE.
 *
 * An account with no stored programme resolves to the shared Foundation seed
 * at revision 0. Reading creates nothing — no row, no revision, no side effect.
 * That matters for more than tidiness: a write-on-read would mean the first
 * person to open the app on a new device silently froze the seed for that
 * account, and two devices doing it at once would race over a materialisation
 * neither user asked for.
 *
 * THE FIRST EDIT MATERIALISES.
 *
 * The first real edit writes the whole resolved programme AND the edit in one
 * transaction, moving the account from revision 0 to revision 1. Exactly one
 * writer can do that; a second writer starting from revision 0 loses cleanly
 * and is told the programme moved, rather than establishing a second, mixed
 * programme.
 *
 * SAVES ARE WHOLE-PROGRAMME.
 *
 * A save states the entire desired programme, not a patch. That is what makes
 * "rename, three weekday toggles, two prescription edits and a reorder" one
 * all-or-nothing write instead of six writes that can half-fail. The store
 * guards every statement on a single compare-and-swap, so a save either lands
 * completely or changes nothing at all.
 */

/* ------------------------------------------------------------------ */
/* Storage boundary                                                    */
/* ------------------------------------------------------------------ */

/** The account's stored programme, or null when it has never been edited. */
export type StoredProgramme = {
  revision: number
  exercises: ProgrammeExercise[]
  sessions: ProgrammeSessions
}

/**
 * One whole-programme write.
 *
 * `expectedRevision` is the revision the author read. `writeToken` is how the
 * store proves, within one batch, that this writer won the compare-and-swap —
 * see the D1 implementation and migration 0015.
 */
export type ProgrammeWrite = {
  expectedRevision: number
  nextRevision: number
  writeToken: string
  now: number
  exercises: ProgrammeExercise[]
  sessions: ProgrammeSessions
  /**
   * A custom exercise's canonical input type, written in the SAME transaction
   * as the exercise itself. Round 22 requires an input type at creation, and a
   * custom exercise without one would be unstartable — so neither is allowed to
   * land without the other.
   */
  inputType?: { exerciseId: string; inputType: WorkoutInputType }
}

export interface ProgrammeStore {
  /** The stored programme, or null when this account has never edited. */
  read(googleSub: string): Promise<StoredProgramme | null>
  /**
   * Apply one whole-programme write.
   *
   * Returns false when the compare-and-swap lost — the stored revision was not
   * `expectedRevision` — in which case NOTHING was written.
   */
  write(googleSub: string, write: ProgrammeWrite): Promise<boolean>
}

/* ------------------------------------------------------------------ */
/* Resolve                                                             */
/* ------------------------------------------------------------------ */

/**
 * This account's current programme.
 *
 * Never writes. Never returns null: an account that has not edited resolves to
 * the shared Foundation seed, which is what it has always been shown.
 */
export async function resolveProgramme(
  store: ProgrammeStore,
  googleSub: string,
): Promise<Programme> {
  const stored = await store.read(googleSub)
  if (!stored) return foundationProgramme()
  return {
    revision: stored.revision,
    exercises: stored.exercises,
    sessions: normaliseSessions(stored.sessions),
  }
}

/** Every weekday present, each in stored order. */
function normaliseSessions(sessions: ProgrammeSessions): ProgrammeSessions {
  const out = {} as ProgrammeSessions
  for (const sessionId of PROGRAMME_SESSION_IDS) {
    out[sessionId] = orderedSlots(sessions[sessionId] ?? [])
  }
  return out
}

/* ------------------------------------------------------------------ */
/* Save                                                                */
/* ------------------------------------------------------------------ */

export type SaveOutcome =
  | { ok: true; programme: Programme }
  | { ok: false; reason: 'invalid'; issues: ProgrammeIssue[] }
  | { ok: false; reason: 'conflict'; programme: Programme }

/**
 * Apply a whole desired programme on top of `expectedRevision`.
 *
 * Validation happens BEFORE the write, so an invalid programme never reaches
 * the database and "nothing was written" is a property of the control flow
 * rather than of a rollback path. The compare-and-swap then happens INSIDE the
 * write, because a read followed by an unconditional write cannot promise the
 * revision did not move in between, however carefully the read is done.
 */
export async function saveProgramme(
  store: ProgrammeStore,
  googleSub: string,
  desired: { exercises: ProgrammeExercise[]; sessions: ProgrammeSessions },
  expectedRevision: number,
  now: number,
  writeToken: string,
  inputType?: { exerciseId: string; inputType: WorkoutInputType },
): Promise<SaveOutcome> {
  // ARRAY ORDER IS THE ORDER, and `position` on the wire is ignored entirely.
  //
  // This is the contract, not an implementation detail. A Move Up in the
  // editor swaps two entries in the array; if this re-sorted by the incoming
  // `position` first it would put them straight back and the move would
  // silently do nothing. Positions are then rewritten 1..n, so a stored
  // weekday is contiguous by construction rather than by the caller
  // remembering to renumber.
  const sessions = {} as ProgrammeSessions
  for (const sessionId of PROGRAMME_SESSION_IDS) {
    sessions[sessionId] = compactPositions(desired.sessions[sessionId] ?? [])
  }

  const candidate: Programme = {
    revision: expectedRevision + 1,
    exercises: desired.exercises,
    sessions,
  }

  const issues = validateProgramme(candidate)
  if (issues.length > 0) return { ok: false, reason: 'invalid', issues }

  const wrote = await store.write(googleSub, {
    expectedRevision,
    nextRevision: expectedRevision + 1,
    writeToken,
    now,
    exercises: candidate.exercises,
    sessions: candidate.sessions,
    inputType,
  })

  if (!wrote) {
    // Somebody else moved the programme between this author's read and this
    // write. Hand back the truth rather than a bare refusal, so the editor can
    // offer to reload it instead of guessing.
    return { ok: false, reason: 'conflict', programme: await resolveProgramme(store, googleSub) }
  }

  return { ok: true, programme: candidate }
}

/* ------------------------------------------------------------------ */
/* Custom exercise creation                                            */
/* ------------------------------------------------------------------ */

export type CreateExerciseInput = {
  name: string
  inputType: WorkoutInputType
}

export type CreateExerciseOutcome =
  | { ok: true; exerciseId: string; programme: Programme }
  | { ok: false; reason: 'programme_invalid'; issues: ProgrammeIssue[] }
  | { ok: false; reason: 'conflict'; programme: Programme }

export type ParsedCreateExercise =
  | { ok: true; value: CreateExerciseInput; expectedRevision: number }
  | { ok: false; field: 'body' | 'name' | 'input_type' | 'expectedRevision' }

/**
 * Read a create-exercise body. Never trusts a client-supplied id.
 *
 * The expected revision travels on the same body: creating an exercise moves
 * the programme, so it takes part in the same optimistic-concurrency contract
 * as any other edit.
 */
export function parseCreateExercise(body: unknown): ParsedCreateExercise {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, field: 'body' }
  }
  const raw = body as Record<string, unknown>
  const name = parseProgrammeText(raw.name, MAX_EXERCISE_NAME_LENGTH)
  if (name === null) return { ok: false, field: 'name' }
  if (!isWorkoutInputType(raw.inputType)) return { ok: false, field: 'input_type' }
  if (
    typeof raw.expectedRevision !== 'number' ||
    !Number.isInteger(raw.expectedRevision) ||
    raw.expectedRevision < FALLBACK_REVISION
  ) {
    return { ok: false, field: 'expectedRevision' }
  }
  return {
    ok: true,
    value: { name, inputType: raw.inputType },
    expectedRevision: raw.expectedRevision,
  }
}

/**
 * Create a custom exercise.
 *
 * The id is MINTED HERE and never accepted from the client: an id is identity,
 * and a client that could choose one could collide with a Foundation exercise
 * and inherit its media, its input type and its personal bests.
 *
 * The new exercise joins the library with NO weekday usage. That is deliberate
 * — the user adds it to the days they want afterwards, and an exercise sitting
 * in the library unused is a normal state, not a broken one.
 */
export async function createCustomExercise(
  store: ProgrammeStore,
  googleSub: string,
  input: CreateExerciseInput,
  expectedRevision: number,
  now: number,
  writeToken: string,
  random: () => number = Math.random,
): Promise<CreateExerciseOutcome> {
  const current = await resolveProgramme(store, googleSub)

  // Mint against the CURRENT library so a collision is impossible even in the
  // vanishingly unlikely case the random half repeats.
  const taken = new Set(current.exercises.map((e) => e.exerciseId))
  let exerciseId = mintCustomExerciseId(random)
  let attempts = 0
  while (taken.has(exerciseId)) {
    if (++attempts > 8) throw new Error('could not mint a free custom exercise id')
    exerciseId = mintCustomExerciseId(random)
  }

  const exercises: ProgrammeExercise[] = [
    ...current.exercises,
    { exerciseId, name: input.name, archived: false, custom: true },
  ]

  const outcome = await saveProgramme(
    store,
    googleSub,
    { exercises, sessions: current.sessions },
    expectedRevision,
    now,
    writeToken,
    // Atomic with the exercise itself: no orphan custom exercise without the
    // input type it is required to have.
    { exerciseId, inputType: input.inputType },
  )

  if (outcome.ok) return { ok: true, exerciseId, programme: outcome.programme }
  if (outcome.reason === 'conflict') {
    return { ok: false, reason: 'conflict', programme: outcome.programme }
  }
  return { ok: false, reason: 'programme_invalid', issues: outcome.issues }
}

/* ------------------------------------------------------------------ */
/* Reading a desired programme off the wire                            */
/* ------------------------------------------------------------------ */

export type ParsedProgrammeBody =
  | {
      ok: true
      expectedRevision: number
      exercises: ProgrammeExercise[]
      sessions: ProgrammeSessions
    }
  | { ok: false; field: string }

/**
 * Read a whole-programme save body.
 *
 * Shape only — the semantic rules are `validateProgramme`, which runs on the
 * assembled candidate so one rule set governs both the wire and the store.
 *
 * `custom` is NOT read from the wire. Whether an exercise is custom follows
 * from its server-minted id, so a client cannot relabel a Foundation exercise
 * as its own or vice versa.
 */
export function parseProgrammeBody(body: unknown): ParsedProgrammeBody {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, field: 'body' }
  }
  const raw = body as Record<string, unknown>

  if (
    typeof raw.expectedRevision !== 'number' ||
    !Number.isInteger(raw.expectedRevision) ||
    raw.expectedRevision < FALLBACK_REVISION
  ) {
    return { ok: false, field: 'expectedRevision' }
  }

  if (!Array.isArray(raw.exercises)) return { ok: false, field: 'exercises' }
  const exercises: ProgrammeExercise[] = []
  for (const entry of raw.exercises) {
    if (typeof entry !== 'object' || entry === null) return { ok: false, field: 'exercises' }
    const row = entry as Record<string, unknown>
    if (typeof row.exerciseId !== 'string') return { ok: false, field: 'exercises' }
    const name = parseProgrammeText(row.name, MAX_EXERCISE_NAME_LENGTH)
    if (name === null) return { ok: false, field: 'exercises' }
    if (typeof row.archived !== 'boolean') return { ok: false, field: 'exercises' }
    exercises.push({
      exerciseId: row.exerciseId,
      name,
      archived: row.archived,
      custom: isCustomExerciseId(row.exerciseId),
    })
  }

  if (typeof raw.sessions !== 'object' || raw.sessions === null) {
    return { ok: false, field: 'sessions' }
  }
  const rawSessions = raw.sessions as Record<string, unknown>
  const sessions = {} as ProgrammeSessions
  for (const sessionId of PROGRAMME_SESSION_IDS) {
    const list = rawSessions[sessionId]
    if (!Array.isArray(list)) return { ok: false, field: `sessions.${sessionId}` }
    const slots: ProgrammeSlot[] = []
    for (const entry of list) {
      const slot = parseSlot(entry)
      if (!slot) return { ok: false, field: `sessions.${sessionId}` }
      slots.push(slot)
    }
    sessions[sessionId] = slots
  }

  return { ok: true, expectedRevision: raw.expectedRevision, exercises, sessions }
}

function parseSlot(raw: unknown): ProgrammeSlot | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const row = raw as Record<string, unknown>
  if (typeof row.exerciseId !== 'string') return null
  if (row.resultKind !== 'reps' && row.resultKind !== 'seconds') return null
  if (typeof row.setCount !== 'number') return null
  if (typeof row.targetMin !== 'number' || typeof row.targetMax !== 'number') return null
  if (typeof row.perSide !== 'boolean') return null

  let equipment: string | null = null
  if (row.equipment !== undefined && row.equipment !== null) {
    if (typeof row.equipment !== 'string') return null
    const trimmed = row.equipment.trim()
    equipment = trimmed.length === 0 ? null : trimmed
  }

  return {
    exerciseId: row.exerciseId,
    // Recomputed from array order on save; a wire value is never trusted.
    position: typeof row.position === 'number' ? row.position : 0,
    setCount: row.setCount,
    resultKind: row.resultKind,
    targetMin: row.targetMin,
    targetMax: row.targetMax,
    perSide: row.perSide,
    equipment,
  }
}

/** The weekdays one exercise currently appears on, for the library view. */
export function weekdaysFor(
  programme: Programme,
  exerciseId: string,
): ProgrammeSessionId[] {
  return PROGRAMME_SESSION_IDS.filter((sessionId) =>
    programme.sessions[sessionId].some((slot) => slot.exerciseId === exerciseId),
  )
}
