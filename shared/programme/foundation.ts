import {
  FALLBACK_REVISION,
  type Programme,
  type ProgrammeExercise,
  type ProgrammeSessionId,
  type ProgrammeSessions,
  type ProgrammeSlot,
} from './programme'

/**
 * THE FOUNDATION SEED — the one definition, for both runtimes.
 *
 * This is the accepted Mon–Fri programme, restated as structured data. Before
 * Round 22 it lived as prescription STRINGS in
 * `src/features/training/sessions.ts`, readable only by the React app. The
 * Worker now has to build workout snapshots from the same programme, so the
 * definition moved here — to shared/ — and there is exactly one of it.
 *
 * It is deliberately NOT copied into a server-side array. A second copy is a
 * second truth, and the first time somebody edited one and not the other, a
 * Start would freeze a programme the user was never shown.
 *
 * WHAT THIS IS FOR.
 *
 * It is the FALLBACK, not the live programme. An account that has never edited
 * its programme resolves to exactly this, at `FALLBACK_REVISION`, and reading
 * it writes nothing. The first real edit materialises these rows into the
 * account's own programme and applies the edit in the same transaction. After
 * that this file is history: it is the default a new account starts from, and
 * it is never consulted again for an account that has its own rows.
 *
 * Every prescription below reproduces the accepted string exactly. The
 * round-trip test asserts that formatting each slot yields the same text the
 * old static array carried, character for character, so Round 22 changes who
 * OWNS the programme without changing what it says.
 */

/** One row of the seed, written the way the accepted array wrote it. */
type SeedSlot = {
  exerciseId: string
  name: string
  setCount: number
  targetMin: number
  targetMax: number
  resultKind?: 'reps' | 'seconds'
  perSide?: boolean
  equipment?: string
}

const SEED: Record<ProgrammeSessionId, SeedSlot[]> = {
  monday: [
    {
      exerciseId: 'lat-pulldown',
      name: 'Lat Pulldown',
      setCount: 4,
      targetMin: 10,
      targetMax: 15,
      equipment: 'BAND 20kg',
    },
    {
      exerciseId: 'one-arm-db-row',
      name: 'One-Arm DB Row',
      setCount: 3,
      targetMin: 8,
      targetMax: 12,
      equipment: 'DB + Bench Flat',
    },
    {
      exerciseId: 'face-pull',
      name: 'Face Pull',
      setCount: 3,
      targetMin: 15,
      targetMax: 20,
      equipment: 'BAND 10kg',
    },
    {
      exerciseId: 'preacher-curl',
      name: 'Preacher Curl',
      setCount: 3,
      targetMin: 10,
      targetMax: 15,
      equipment: 'DB + Bench Preacher setup',
    },
    {
      exerciseId: 'hammer-curl',
      name: 'Hammer Curl',
      setCount: 2,
      targetMin: 10,
      targetMax: 15,
      equipment: 'DB',
    },
  ],
  tuesday: [
    {
      exerciseId: 'incline-db-press',
      name: 'Incline DB Press',
      setCount: 4,
      targetMin: 8,
      targetMax: 12,
    },
    {
      exerciseId: 'seated-shoulder-press',
      name: 'Seated Shoulder Press',
      setCount: 3,
      targetMin: 8,
      targetMax: 12,
    },
    {
      exerciseId: 'flat-db-press',
      name: 'Flat DB Press',
      setCount: 3,
      targetMin: 10,
      targetMax: 15,
    },
    {
      exerciseId: 'lateral-raise',
      name: 'Lateral Raise',
      setCount: 3,
      targetMin: 12,
      targetMax: 20,
    },
    {
      exerciseId: 'triceps-pushdown',
      name: 'Triceps Pushdown',
      setCount: 3,
      targetMin: 10,
      targetMax: 15,
    },
  ],
  wednesday: [
    {
      exerciseId: 'lat-pulldown',
      name: 'Lat Pulldown',
      setCount: 2,
      targetMin: 15,
      targetMax: 20,
    },
    {
      exerciseId: 'face-pull',
      name: 'Face Pull',
      setCount: 3,
      targetMin: 15,
      targetMax: 20,
    },
    {
      exerciseId: 'rear-delt-fly',
      name: 'Rear Delt Fly',
      setCount: 2,
      targetMin: 15,
      targetMax: 20,
    },
    {
      exerciseId: 'dead-bug',
      name: 'Dead Bug',
      setCount: 3,
      targetMin: 10,
      targetMax: 10,
      perSide: true,
    },
    {
      exerciseId: 'plank',
      name: 'Plank',
      setCount: 3,
      targetMin: 30,
      targetMax: 60,
      resultKind: 'seconds',
    },
  ],
  thursday: [
    {
      exerciseId: 'lat-pulldown',
      name: 'Lat Pulldown',
      setCount: 4,
      targetMin: 10,
      targetMax: 15,
    },
    {
      exerciseId: 'chest-supported-db-row',
      name: 'Chest-Supported DB Row',
      setCount: 3,
      targetMin: 10,
      targetMax: 15,
    },
    {
      exerciseId: 'seated-band-row',
      name: 'Seated Band Row',
      setCount: 3,
      targetMin: 12,
      targetMax: 15,
    },
    {
      exerciseId: 'flat-db-press',
      name: 'Flat DB Press',
      setCount: 2,
      targetMin: 10,
      targetMax: 15,
    },
    {
      exerciseId: 'preacher-curl',
      name: 'Preacher Curl',
      setCount: 2,
      targetMin: 10,
      targetMax: 15,
    },
  ],
  friday: [
    {
      exerciseId: 'incline-db-press',
      name: 'Incline DB Press',
      setCount: 2,
      targetMin: 12,
      targetMax: 15,
    },
    {
      exerciseId: 'lateral-raise',
      name: 'Lateral Raise',
      setCount: 3,
      targetMin: 15,
      targetMax: 20,
    },
    {
      exerciseId: 'face-pull',
      name: 'Face Pull',
      setCount: 3,
      targetMin: 15,
      targetMax: 20,
    },
    {
      exerciseId: 'preacher-curl',
      name: 'Preacher Curl',
      setCount: 2,
      targetMin: 12,
      targetMax: 15,
    },
    {
      exerciseId: 'triceps-pushdown',
      name: 'Triceps Pushdown',
      setCount: 3,
      targetMin: 12,
      targetMax: 20,
    },
    {
      exerciseId: 'hammer-curl',
      name: 'Hammer Curl',
      setCount: 2,
      targetMin: 12,
      targetMax: 15,
    },
  ],
}

/**
 * The canonical exercises the Foundation programme uses, in first-appearance
 * order across Monday→Friday.
 *
 * Derived from the seed rather than listed again, so an exercise can never be
 * in a weekday but missing from the library, or named one thing in one place
 * and another elsewhere.
 */
function seedExercises(): ProgrammeExercise[] {
  const byId = new Map<string, ProgrammeExercise>()
  for (const sessionId of Object.keys(SEED) as ProgrammeSessionId[]) {
    for (const slot of SEED[sessionId]) {
      if (byId.has(slot.exerciseId)) continue
      byId.set(slot.exerciseId, {
        exerciseId: slot.exerciseId,
        name: slot.name,
        archived: false,
        custom: false,
      })
    }
  }
  return [...byId.values()]
}

function seedSlots(sessionId: ProgrammeSessionId): ProgrammeSlot[] {
  return SEED[sessionId].map((slot, index) => ({
    exerciseId: slot.exerciseId,
    position: index + 1,
    setCount: slot.setCount,
    resultKind: slot.resultKind ?? 'reps',
    targetMin: slot.targetMin,
    targetMax: slot.targetMax,
    perSide: slot.perSide ?? false,
    equipment: slot.equipment ?? null,
  }))
}

/**
 * The Foundation programme, as a fresh resolved value.
 *
 * A NEW OBJECT every call, deliberately. The seed is shared module state and a
 * caller that mutated a returned slot would silently change what every future
 * account starts from.
 */
export function foundationProgramme(): Programme {
  const sessions = {} as ProgrammeSessions
  for (const sessionId of Object.keys(SEED) as ProgrammeSessionId[]) {
    sessions[sessionId] = seedSlots(sessionId)
  }
  return {
    revision: FALLBACK_REVISION,
    exercises: seedExercises(),
    sessions,
  }
}
