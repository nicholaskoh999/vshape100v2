import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getSession } from '@/features/training/sessions'
import { buildWorkoutPlan, toStartPayload } from '@/features/training/workoutPlan'
import { authenticatedSession, mockAuthFetch, renderApp } from './authTestUtils'
import { createWorkoutServer, type WorkoutServer } from './workoutApiTestUtils'

/**
 * Round 20 — logging a set against the resistance it was actually done with.
 *
 * The real client, the real hook and the real page run against an in-memory
 * stand-in that mirrors the server's Round 20 rules: it resolves the input type
 * from the account's saved setting at Start, forces the load mode to agree, and
 * refuses a payload describing the other modality.
 *
 * THE LINE THIS ROUND EXISTS TO CHANGE is the one under a completed set. It
 * used to read "12 reps · 3kg" for three black bands, because the count had
 * gone into the weight column and the formatter appended "kg" to whatever
 * number it was given.
 */

const TODAY = new Date(2026, 8, 1, 9, 0)
const DATE = '2026-09-01'
/** Tuesday trains Triceps Pushdown, which is the exercise the user does on bands. */
const SESSION = 'tuesday'
const TRICEPS = /Triceps Pushdown/

let server: WorkoutServer

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(TODAY)
  server = createWorkoutServer()
  mockAuthFetch({ session: authenticatedSession, workouts: server })
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function user() {
  return userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
}

async function openSession() {
  const u = user()
  renderApp(`/training/${SESSION}`)
  await screen.findByRole('heading', { level: 1 })
  return u
}

async function openExercise(u: ReturnType<typeof user>, name: RegExp) {
  const trigger = screen.getByRole('button', { name })
  await u.click(trigger)
  const panelId = trigger.getAttribute('aria-controls')!
  return within(document.getElementById(panelId)!)
}

async function startWorkout(u: ReturnType<typeof user>) {
  await u.click(await screen.findByRole('button', { name: 'Start workout' }))
  await screen.findByText('Resume workout')
}

/** Seed a started workout whose Triceps rows carry a given frozen modality. */
function seedStarted(over: (exerciseId: string) => Partial<{
  inputType: 'weight_kg' | 'resistance_band' | 'bodyweight'
}>) {
  const session = getSession(SESSION)!
  const payload = toStartPayload(session, buildWorkoutPlan(session)!)
  const sets = payload.exercises.flatMap((exercise, exerciseOrder) =>
    Array.from({ length: exercise.setCount }, (_unused, setIndex) => ({
      exerciseOrder,
      setIndex,
      exerciseId: exercise.exerciseId,
      exerciseName: exercise.name,
      prescription: exercise.prescription,
      equipment: exercise.equipment,
      resultKind: exercise.resultKind,
      loadMode: exercise.loadMode,
      perSide: exercise.perSide,
      inputType: 'weight_kg' as const,
      status: 'pending' as const,
      load: null,
      band: null,
      result: null,
      updatedAt: 1,
      ...over(exercise.exerciseId),
    })),
  )
  server.seed(DATE, SESSION, {
    occurrence: {
      date: DATE,
      sessionId: SESSION,
      day: session.day,
      focus: session.focus,
      intensity: session.intensity,
      startedAt: 1,
      updatedAt: 1,
    },
    sets,
  })
}

/* ------------------------------------------------------------------ */
/* The controls a set offers                                           */
/* ------------------------------------------------------------------ */

describe('the controls follow the set’s frozen modality', () => {
  it('asks for a band and a count, not a weight, on a band exercise', async () => {
    server.setInputType('triceps-pushdown', 'resistance_band')
    const u = await openSession()
    await startWorkout(u)
    const panel = await openExercise(u, TRICEPS)

    expect(panel.getAllByLabelText('Band')).not.toHaveLength(0)
    expect(panel.getAllByLabelText('How many')).not.toHaveLength(0)
    // No kilogram field anywhere on this exercise. There is no weight here to
    // ask for, and offering the field is what invited the wrong answer.
    expect(panel.queryByLabelText('Load (kg)')).toBeNull()
  })

  it('still asks for a weight on an exercise the user has not reconfigured', async () => {
    // NON-VACUITY: the same page, the same session, a different exercise.
    server.setInputType('triceps-pushdown', 'resistance_band')
    const u = await openSession()
    await startWorkout(u)
    const panel = await openExercise(u, /Incline DB Press/)

    expect(panel.getAllByLabelText('Load (kg each)')).not.toHaveLength(0)
    expect(panel.queryByLabelText('Band')).toBeNull()
  })

  it('asks for neither on bodyweight work', async () => {
    server.setInputType('triceps-pushdown', 'bodyweight')
    const u = await openSession()
    await startWorkout(u)
    const panel = await openExercise(u, TRICEPS)

    expect(panel.queryByLabelText('Load (kg)')).toBeNull()
    expect(panel.queryByLabelText('Band')).toBeNull()
  })
})

/* ------------------------------------------------------------------ */
/* Recording a band                                                    */
/* ------------------------------------------------------------------ */

describe('recording a band', () => {
  it('stores the band as a name and a count, and reads it back that way', async () => {
    server.setInputType('triceps-pushdown', 'resistance_band')
    const u = await openSession()
    await startWorkout(u)
    const panel = await openExercise(u, TRICEPS)

    await u.type(panel.getAllByLabelText('Band')[0], 'Black')
    await u.type(panel.getAllByLabelText('How many')[0], '3')
    await u.type(panel.getAllByLabelText(/^Reps/)[0], '12')
    await u.click(panel.getAllByRole('button', { name: 'Complete' })[0])

    // THE LINE THAT USED TO SAY "12 reps · 3kg".
    await panel.findByText('Completed · 12 reps · Black ×3')

    const stored = server.workouts.get(`${DATE}#${SESSION}`)!.sets.find(
      (set) => set.exerciseId === 'triceps-pushdown' && set.setIndex === 0,
    )!
    expect(stored.band).toEqual({ label: 'Black', count: 3 })
    // And no kilogram number was invented on the way.
    expect(stored.load).toBeNull()
    expect(stored.loadMode).toBe('none')
  })

  it('refuses to complete a band set until it says WHICH band', async () => {
    server.setInputType('triceps-pushdown', 'resistance_band')
    const u = await openSession()
    await startWorkout(u)
    const panel = await openExercise(u, TRICEPS)

    await u.type(panel.getAllByLabelText(/^Reps/)[0], '12')
    // Reps alone is not a band record. Half an answer is not a smaller record,
    // it is an unreadable one.
    expect(panel.getAllByRole('button', { name: 'Complete' })[0]).toBeDisabled()

    await u.type(panel.getAllByLabelText('Band')[0], 'Black')
    expect(panel.getAllByRole('button', { name: 'Complete' })[0]).toBeDisabled()

    // NON-VACUITY: the count is the only thing still missing.
    await u.type(panel.getAllByLabelText('How many')[0], '3')
    expect(panel.getAllByRole('button', { name: 'Complete' })[0]).toBeEnabled()
  })

  it('clears the band when the set is skipped and then undone', async () => {
    server.setInputType('triceps-pushdown', 'resistance_band')
    const u = await openSession()
    await startWorkout(u)
    const panel = await openExercise(u, TRICEPS)

    await u.type(panel.getAllByLabelText('Band')[0], 'Black')
    await u.type(panel.getAllByLabelText('How many')[0], '3')
    await u.type(panel.getAllByLabelText(/^Reps/)[0], '12')
    await u.click(panel.getAllByRole('button', { name: 'Complete' })[0])
    await panel.findByText('Completed · 12 reps · Black ×3')

    await u.click(panel.getAllByRole('button', { name: /^Undo/ })[0])
    // Back to pending: the band fields are offered again, empty.
    await waitFor(() => expect(panel.getAllByLabelText('Band')).toHaveLength(3))

    const stored = server.workouts.get(`${DATE}#${SESSION}`)!.sets.find(
      (set) => set.exerciseId === 'triceps-pushdown' && set.setIndex === 0,
    )!
    expect(stored.band).toBeNull()
    expect(stored.status).toBe('pending')
  })
})

/* ------------------------------------------------------------------ */
/* The snapshot governs, and unreadable fails closed                   */
/* ------------------------------------------------------------------ */

describe('the frozen snapshot governs a workout already underway', () => {
  it('keeps the kilogram field when the setting changes mid-session', async () => {
    // Started as kilograms…
    seedStarted(() => ({}))
    // …and the user reconfigures the exercise while it is underway.
    server.setInputType('triceps-pushdown', 'resistance_band')

    const u = await openSession()
    await screen.findByText('Resume workout')
    const panel = await openExercise(u, TRICEPS)

    // The workout they are actually doing is unchanged. The new setting
    // applies to the NEXT Start.
    expect(panel.getAllByLabelText('Load (kg)')).not.toHaveLength(0)
    expect(panel.queryByLabelText('Band')).toBeNull()
  })

  it('refuses to log a set whose modality could not be read', async () => {
    // The server could not name the stored input type, so it sent null.
    seedStarted((exerciseId) =>
      exerciseId === 'triceps-pushdown'
        ? ({ inputType: 'elastic_vibes' } as unknown as { inputType: 'weight_kg' })
        : {},
    )

    const u = await openSession()
    await screen.findByText('Resume workout')
    const panel = await openExercise(u, TRICEPS)

    // One per pending set of this exercise: each refuses on its own terms.
    await waitFor(() =>
      expect(panel.getAllByText(/input type could not be read/i)).toHaveLength(3),
    )
    await u.type(panel.getAllByLabelText(/^Reps/)[0], '12')
    // Disabled even with a valid result: guessing the resistance is exactly
    // what produced the wrong data in the first place.
    expect(panel.getAllByRole('button', { name: 'Complete' })[0]).toBeDisabled()
  })

  it('logs that same set normally once its modality is readable', async () => {
    // NON-VACUITY for the refusal above.
    seedStarted(() => ({}))

    const u = await openSession()
    await screen.findByText('Resume workout')
    const panel = await openExercise(u, TRICEPS)

    await u.type(panel.getAllByLabelText(/^Reps/)[0], '12')
    expect(panel.getAllByRole('button', { name: 'Complete' })[0]).toBeEnabled()
  })
})
