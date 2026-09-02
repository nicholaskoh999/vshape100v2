import { parsePrescriptionTarget } from '../../shared/progression/prescription'
import { PROGRAMME_SESSION_IDS } from '../../shared/programme/programme'
import type { SeedProgramme } from './fakeD1'

/**
 * Turning a pre-Round-22 Start body into the AUTHORITATIVE programme.
 *
 * Every suite that starts a workout used to declare its plan as a Start body:
 * a day, a focus, an intensity and a list of exercises with prescription
 * strings. Round 22 took that authority away from the client, so those plans
 * have to be established where the server actually reads them.
 *
 * Rather than rewriting each suite's fixture by hand — and risking quietly
 * changing what a test was about — this reads the plan the suite already
 * declares and seeds it as the account's programme. The test keeps its exact
 * intent; only the place the server learns it from moves.
 *
 * The prescription is parsed with the accepted parser, so a fixture carrying a
 * prescription the app cannot read fails loudly here instead of silently
 * seeding something else.
 */

export type LegacyExercise = {
  exerciseId: string
  name: string
  prescription: string
  setCount: number
  /* The remaining legacy fields are read from the prescription, not trusted. */
  equipment?: string | null
  perSide?: boolean
  resultKind?: string
  loadMode?: string
  day?: string
}

export type LegacyPlan = {
  exercises: readonly LegacyExercise[]
}

/**
 * Seed one weekday from a legacy plan.
 *
 * The other four weekdays are given a single placeholder slot built from the
 * same first exercise. They are never started in these suites, and leaving them
 * empty would model an account whose programme could not be saved.
 */
export function programmeFromLegacyPlan(
  sessionId: string,
  plan: LegacyPlan,
  revision = 1,
): SeedProgramme {
  const exercises = plan.exercises.map((exercise) => ({
    exerciseId: exercise.exerciseId,
    name: exercise.name,
  }))

  const slots = plan.exercises.map((exercise) => {
    const target = parsePrescriptionTarget(exercise.prescription)
    if (!target) {
      throw new Error(
        `programmeFromLegacyPlan: unreadable prescription "${exercise.prescription}"`,
      )
    }
    return {
      exerciseId: exercise.exerciseId,
      setCount: exercise.setCount,
      targetMin: target.lower,
      targetMax: target.upper,
      resultKind: target.resultKind,
      perSide: target.perSide,
      equipment: exercise.equipment ?? null,
    }
  })

  const sessions: SeedProgramme['sessions'] = {}
  // The weekday under test carries the plan verbatim.
  sessions[sessionId] = slots
  // The rest carry one slot so no weekday is empty, which is what a real stored
  // programme must satisfy. None of them is started by these suites.
  for (const other of PROGRAMME_SESSION_IDS) {
    if (other === sessionId) continue
    sessions[other] = [slots[0]]
  }

  return { revision, exercises, sessions }
}

/** The Start body a client may now send for a seeded programme. */
export function startBody(revision = 1, sourceSessionId?: string) {
  return sourceSessionId === undefined
    ? { expectedRevision: revision }
    : { expectedRevision: revision, sourceSessionId }
}
