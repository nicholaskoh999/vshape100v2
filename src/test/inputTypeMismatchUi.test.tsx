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
const unverified = () => document.querySelector('[data-modality-unverified]')

/** Everything the panel OFFERS, which is exactly what must fail closed. */
function actionableControls() {
  return {
    tooLight: screen.queryByRole('button', { name: 'Too light' }),
    good: screen.queryByRole('button', { name: 'Good' }),
    tooHeavy: screen.queryByRole('button', { name: 'Too heavy' }),
    useSuggestion: screen.queryByRole('button', { name: /^Use / }),
  }
}

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

/* ------------------------------------------------------------------ */
/* ROUND 22 CORRECTION 2 — the verdict must FAIL CLOSED                */
/* ------------------------------------------------------------------ */

/**
 * WHY THIS BLOCK EXISTS.
 *
 * Correction 1 detects the disagreement only once the input-type library has
 * been read. While that read is in flight — or after it has failed — the
 * library is EMPTY, and an empty library used to look exactly like "this
 * account has configured nothing", which is the accepted, quiet, guidance-on
 * case.
 *
 * So the kilogram calibration prompt and the kilogram suggestion rendered
 * before anything had been verified. On a slow or broken read that is the
 * whole Round 20 problem back again, reached by assumption instead of by a
 * stale setting: the user confirms "20kg felt right" on an exercise that may
 * already be band work.
 *
 * Everything below is about that window. Logging is never touched: the frozen
 * controls stay, because they are what the recorded sets mean.
 */

/**
 * A started kg workout with its first set completed AND judged.
 *
 * The judgement matters. Until a first set is judged there is no suggested
 * load, so "no suggested load" would pass for the wrong reason; after it there
 * is a stored `Use 20kg` the panel would offer on every later mount. That is
 * what the assertions below are actually withholding.
 *
 * `configured: false` states no input type at all, which is the genuinely
 * unconfigured account — the workout still freezes kilograms, from the load
 * mode the plan asked for, exactly as a pre-Round-20 account does.
 */
async function startedKgWorkoutWithGuidance(options: { configured: boolean }) {
  if (options.configured) stateInputType('weight_kg')

  const u = await openMonday()
  await u.click(await screen.findByRole('button', { name: 'Start workout' }))
  await screen.findByText('Resume workout')
  await u.click(screen.getByRole('button', { name: /Lat Pulldown/ }))

  await u.type(screen.getAllByLabelText(/^Load \(kg\)$/i)[0], '20')
  await u.type(screen.getAllByLabelText('Reps')[0], '12')
  await u.click(screen.getAllByRole('button', { name: /^Complete$/ })[0])
  await screen.findByText(/Completed · 12 reps/)

  await u.click(await screen.findByRole('button', { name: 'Good' }))
  await screen.findByText(/20kg felt right/)
  // The setup is only useful if it really did leave something to withhold.
  expect(screen.getAllByRole('button', { name: 'Use 20kg' }).length).toBeGreaterThan(0)

  cleanup()
}

/**
 * Reopen the page with the row expanded, WITHOUT waiting for guidance.
 *
 * Waiting for the guidance panel would beg the question — the point is what is
 * on screen while the modality is still unknown.
 */
async function remountWithRowOpen() {
  const u = await openMonday()
  await screen.findByText('Resume workout')
  await u.click(screen.getByRole('button', { name: /Lat Pulldown/ }))
  return u
}

/** The note's own machine-readable reason, so the two cases stay distinct. */
function unverifiedReason(): string | null {
  const node = unverified()
  return node ? node.getAttribute('data-unverified-reason') : null
}

describe('Correction 2 — nothing actionable before the current input type is verified', () => {
  it('1. pauses guidance and the suggestion while the input-type read is still in flight', async () => {
    await startedKgWorkoutWithGuidance({ configured: true })

    // Progression will answer. The input-type library will not.
    const release = inputTypes.holdReads()
    try {
      await remountWithRowOpen()

      /*
       * The note renders only where there IS guidance to pause, so its
       * presence is the proof of the exact state this test is about:
       * progression READY, current input type NOT.
       */
      await waitFor(() => expect(unverified()).not.toBeNull())
      expect(unverifiedReason()).toBe('loading')
      expect((unverified() as HTMLElement).textContent).toContain(
        'Load guidance is paused',
      )

      const controls = actionableControls()
      expect(controls.tooLight, 'Too light').toBeNull()
      expect(controls.good, 'Good').toBeNull()
      expect(controls.tooHeavy, 'Too heavy').toBeNull()
      // A stored 20kg suggestion exists and is still withheld.
      expect(controls.useSuggestion, 'Use 20kg').toBeNull()

      // No mismatch has been MANUFACTURED either: an unread library is not a
      // disagreement, and saying so would be a different lie.
      expect(warning()).toBeNull()

      // Logging is untouched. Failing closed withdraws what is OFFERED, never
      // the controls the recorded sets are written against.
      expect(screen.getAllByLabelText(/^Load \(kg\)$/i).length).toBeGreaterThan(0)
      expect(
        screen.getAllByRole('button', { name: /^Complete$/ }).length,
      ).toBeGreaterThan(0)
    } finally {
      release()
    }
  })

  it('2. and when it resolves to Resistance band, the warning appears and guidance stays paused', async () => {
    await startedKgWorkoutWithGuidance({ configured: true })

    const release = inputTypes.holdReads()
    await remountWithRowOpen()
    await waitFor(() => expect(unverified()).not.toBeNull())

    // The answer that was in flight all along: this exercise is band work now.
    stateInputType('resistance_band')
    release()

    await waitFor(() => expect(warning()).not.toBeNull())
    // The placeholder gives way to the real finding — one statement, not two.
    expect(unverified()).toBeNull()
    expect((warning() as HTMLElement).textContent).toContain('Resistance band')

    const controls = actionableControls()
    expect(controls.tooLight, 'Too light').toBeNull()
    expect(controls.good, 'Good').toBeNull()
    expect(controls.tooHeavy, 'Too heavy').toBeNull()
    expect(controls.useSuggestion, 'Use 20kg').toBeNull()
  })

  it('3. and when it resolves to Weight (kg), there is no mismatch and guidance returns', async () => {
    await startedKgWorkoutWithGuidance({ configured: true })

    const release = inputTypes.holdReads()
    await remountWithRowOpen()
    await waitFor(() => expect(unverified()).not.toBeNull())
    expect(actionableControls().good, 'paused while unverified').toBeNull()

    release()

    // Verified AND agreeing: the accepted panel comes back in full.
    expect(await screen.findByRole('button', { name: 'Good' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Too light' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Too heavy' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Use 20kg' }).length).toBeGreaterThan(0)
    expect(warning()).toBeNull()
    expect(unverified()).toBeNull()
  })

  it('4. keeps guidance paused when the input-type read FAILS', async () => {
    await startedKgWorkoutWithGuidance({ configured: true })

    // Every read, so a retry cannot quietly rescue the assertion.
    inputTypes.failReads(50)
    await remountWithRowOpen()

    await waitFor(() => expect(unverified()).not.toBeNull())
    expect(unverifiedReason()).toBe('error')
    expect((unverified() as HTMLElement).textContent).toContain('could not be verified')

    const controls = actionableControls()
    expect(controls.tooLight, 'Too light').toBeNull()
    expect(controls.good, 'Good').toBeNull()
    expect(controls.tooHeavy, 'Too heavy').toBeNull()
    expect(controls.useSuggestion, 'Use 20kg').toBeNull()

    // A failed read is not evidence of a change, so none is claimed.
    expect(warning()).toBeNull()
    // And the workout is still fully loggable.
    expect(screen.getAllByLabelText(/^Load \(kg\)$/i).length).toBeGreaterThan(0)
  })

  it('5. READY with nothing configured keeps the accepted unconfigured semantics', async () => {
    await startedKgWorkoutWithGuidance({ configured: false })

    await remountWithRowOpen()

    // Unanswered is not a disagreement, and — once the read has SUCCEEDED —
    // it is not an unverified answer either. Round 20's accepted behaviour.
    expect(await screen.findByRole('button', { name: 'Good' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Use 20kg' }).length).toBeGreaterThan(0)
    expect(warning()).toBeNull()
    expect(unverified()).toBeNull()

    // The library was genuinely read: this is READY-and-empty, not still loading.
    expect(
      inputTypes.calls.some((call) => call.method === 'GET' && call.exerciseId === null),
    ).toBe(true)
  })
})
