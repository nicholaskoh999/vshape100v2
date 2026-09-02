import { cleanup, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { authenticatedSession, mockAuthFetch, renderApp } from './authTestUtils'
import { createInputTypeServer, type InputTypeServer } from './exerciseInputTypeApiTestUtils'
import { createProgrammeServer, type ProgrammeServer } from './programmeApiTestUtils'
import { createWorkoutServer, type WorkoutServer } from './workoutApiTestUtils'
import { foundationProgramme } from '@shared/programme/foundation'
import type { Programme } from '@shared/programme/programme'
import type { WorkoutInputType } from '@shared/workoutInput'

/**
 * Round 22 Correction 1 (C3) — when the setting moves under a started workout.
 *
 * THE REAL CASE. An exercise was started as Weight (kg). The user then set it
 * to Resistance band. The running workout correctly kept its frozen kilogram
 * snapshot — and went on offering kilogram fields AND kilogram guidance, so
 * "1 kg" got entered to mean one band. That is misleading evidence the user
 * then has to undo.
 *
 * WHAT IS AND IS NOT DONE HERE. Nothing is reinterpreted, converted or
 * rewritten: the frozen controls stay, because they are what the already-logged
 * sets mean. What is withdrawn is the ACTIONABLE guidance, because confirming a
 * load in a modality the user has just said this exercise is not is the step
 * that creates the bad evidence.
 */

const TODAY = new Date(2026, 8, 7, 9, 0)

let programme: ProgrammeServer
let workouts: WorkoutServer
let inputTypes: InputTypeServer

/** Monday: one exercise, so the assertions are about one row. */
function oneExerciseMonday(): Programme {
  const seed = foundationProgramme()
  return {
    ...seed,
    revision: 1,
    sessions: {
      ...seed.sessions,
      monday: [
        {
          exerciseId: 'lat-pulldown',
          position: 1,
          setCount: 2,
          resultKind: 'reps',
          targetMin: 10,
          targetMax: 15,
          perSide: false,
          equipment: null,
        },
      ],
    },
  }
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(TODAY)
  programme = createProgrammeServer()
  workouts = createWorkoutServer()
  inputTypes = createInputTypeServer()
  programme.setProgramme(oneExerciseMonday())
  workouts.setProgramme(oneExerciseMonday())
  mockAuthFetch({ session: authenticatedSession, programme, workouts, inputTypes })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function user() {
  return userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
}

async function openMonday() {
  const u = user()
  renderApp('/training/monday')
  await waitFor(() => {
    const heading = screen.getByRole('heading', { level: 1 })
    expect(heading.textContent).not.toBe('Loading')
  })
  return u
}

const warning = () => document.querySelector('[data-modality-mismatch]')

/**
 * Start the workout under `frozen`, then move the setting to `current`.
 *
 * The order matters and is the whole scenario: the workout must already exist
 * when the setting changes, which is the only way the two can disagree.
 */
function stateInputType(inputType: WorkoutInputType) {
  // Both stand-ins, because the two halves come from different places in
  // production too: the Worker freezes from its own read at Start, and the
  // Library page reads the same setting back afterwards.
  inputTypes.rows.set('lat-pulldown', {
    exerciseId: 'lat-pulldown',
    inputType,
    updatedAt: 1,
  })
  workouts.setInputType('lat-pulldown', inputType)
}

async function startThenChangeTo(
  frozen: WorkoutInputType | null,
  current: WorkoutInputType | null,
) {
  if (frozen) stateInputType(frozen)
  const u = await openMonday()
  await u.click(await screen.findByRole('button', { name: 'Start workout' }))
  await screen.findByText('Resume workout')

  if (current) stateInputType(current)
  cleanup()
  const u2 = await openMonday()
  await screen.findByText('Resume workout')
  // Open the row, which is where the per-exercise panel lives.
  await u2.click(screen.getByRole('button', { name: /Lat Pulldown/ }))
  return u2
}

/* ------------------------------------------------------------------ */

describe('a started workout whose input type has since changed', () => {
  it('warns when kg was frozen and the setting is now Resistance band', async () => {
    await startThenChangeTo('weight_kg', 'resistance_band')

    await waitFor(() => expect(warning()).not.toBeNull())
    const text = (warning() as HTMLElement).textContent ?? ''
    expect(text).toContain('started before this exercise’s input type changed')
    // Both halves named, so the user can see which is which.
    expect(text).toContain('Weight (kg)')
    expect(text).toContain('Resistance band')
    // And the promise that nothing was touched.
    expect(text).toContain('Nothing has been converted')
    // Pointed at the accepted correction route rather than left stuck.
    expect(text).toContain('Edit recorded set')
  })

  it('warns the other way round too, when a band workout meets a kg setting', async () => {
    await startThenChangeTo('resistance_band', 'weight_kg')

    await waitFor(() => expect(warning()).not.toBeNull())
    const text = (warning() as HTMLElement).textContent ?? ''
    expect(text).toContain('Resistance band')
    expect(text).toContain('Weight (kg)')
  })

  it('warns for a bodyweight mismatch — the rule is generic, not one exercise', async () => {
    await startThenChangeTo('bodyweight', 'weight_kg')
    await waitFor(() => expect(warning()).not.toBeNull())
    expect((warning() as HTMLElement).textContent).toContain('Bodyweight / no load')
  })

  it('KEEPS the frozen controls — nothing is reinterpreted', async () => {
    await startThenChangeTo('weight_kg', 'resistance_band')
    await waitFor(() => expect(warning()).not.toBeNull())

    // The workout is still logged the way it was started: kilogram fields, not
    // band fields. Reinterpreting them would be inventing history.
    expect(screen.getAllByLabelText(/^Load \(kg\)$/i).length).toBeGreaterThan(0)
    expect(screen.queryByLabelText('Band')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('How many')).not.toBeInTheDocument()
  })

  it('withdraws the actionable load guidance while the two disagree', async () => {
    await startThenChangeTo('weight_kg', 'resistance_band')
    await waitFor(() => expect(warning()).not.toBeNull())

    // No "how did that feel?" prompt: acting on it would write calibration
    // evidence in a modality the user has just said this exercise is not.
    expect(screen.queryByText(/How did that feel/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Too light/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Too heavy/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Good$/i })).not.toBeInTheDocument()
  })
})

describe('when there is nothing to disagree about', () => {
  it('says nothing when the setting still matches the snapshot', async () => {
    await startThenChangeTo('weight_kg', 'weight_kg')
    // Give any warning a chance to appear before asserting it did not.
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(warning()).toBeNull()
  })

  it('says nothing when the account has never stated an input type', async () => {
    // Unconfigured is not kilograms, it is unanswered — Round 20 is explicit
    // that the two must not look alike, so there is nothing to disagree with.
    await startThenChangeTo(null, null)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(warning()).toBeNull()
  })

  it('says nothing before a workout has been started', async () => {
    stateInputType('resistance_band')
    const u = await openMonday()
    await screen.findByRole('button', { name: 'Start workout' })
    await u.click(screen.getByRole('button', { name: /Lat Pulldown/ }))

    // Nothing is frozen yet, so the current setting simply applies.
    expect(warning()).toBeNull()
  })
})
