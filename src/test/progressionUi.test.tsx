import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getSession } from '@/features/training/sessions'
import { buildWorkoutPlan, toStartPayload } from '@/features/training/workoutPlan'
import { authenticatedSession, mockAuthFetch, renderApp } from './authTestUtils'
import { createProgressionServer } from './progressionApiTestUtils'
import { createWorkoutServer, type ServerSet, type WorkoutServer } from './workoutApiTestUtils'

/**
 * Round 16 — derived guidance inside the active workout.
 *
 * The real client, the real hook, the real page and the REAL shared engine run
 * against in-memory stand-ins, so what is asserted here is what the app would
 * actually show. Nothing is mirrored into browser storage: a remount re-reads.
 *
 * The through-line of this file is the boundary the round is really about — a
 * suggestion is guidance, and only pressing Complete records training.
 */

const TODAY = new Date(2026, 8, 7, 9, 0)
const DATE = '2026-09-07'
const LAST_WEEK = '2026-08-31'

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

/** One slot's logged outcome: `null` leaves the set pending. */
type SlotResult = { result: number; load?: number } | 'skipped' | null

/**
 * Seed a workout exactly as the API would have stored it, then apply the given
 * outcomes to the named exercise slot.
 */
function seedWorkout(
  sessionId: string,
  date: string,
  outcomes: Record<number, SlotResult[]> = {},
  startedAt = 1,
) {
  const session = getSession(sessionId)!
  const payload = toStartPayload(session, buildWorkoutPlan(session)!)

  const sets: ServerSet[] = payload.exercises.flatMap((exercise, exerciseOrder) =>
    Array.from({ length: exercise.setCount }, (_unused, setIndex): ServerSet => {
      const outcome = outcomes[exerciseOrder]?.[setIndex] ?? null
      const base = {
        exerciseOrder,
        setIndex,
        exerciseId: exercise.exerciseId,
        exerciseName: exercise.name,
        prescription: exercise.prescription,
        equipment: exercise.equipment,
        resultKind: exercise.resultKind,
        loadMode: exercise.loadMode,
        perSide: exercise.perSide,
        // Read the way a pre-Round-20 row is: kilograms meant kilograms.
        inputType:
          exercise.loadMode === 'none' ? ('bodyweight' as const) : ('weight_kg' as const),
        band: null,
        updatedAt: startedAt,
      }
      if (outcome === null) {
        return { ...base, status: 'pending', load: null, result: null }
      }
      if (outcome === 'skipped') {
        return { ...base, status: 'skipped', load: null, result: null }
      }
      return {
        ...base,
        status: 'completed',
        result: outcome.result,
        load:
          outcome.load === undefined || exercise.loadMode === 'none'
            ? null
            : { value: outcome.load, unit: exercise.loadMode },
      }
    }),
  )

  server.seed(date, sessionId, {
    occurrence: {
      date,
      sessionId,
      day: session.day,
      focus: session.focus,
      intensity: session.intensity,
      startedAt,
      updatedAt: startedAt,
    },
    sets,
  })
}

/** Every set of one slot completed at one load. */
function atLoad(load: number, results: number[]): SlotResult[] {
  return results.map((result) => ({ result, load }))
}

async function openSession(sessionId: string) {
  const u = user()
  renderApp(`/training/${sessionId}`)
  await screen.findByRole('heading', { level: 1 })
  return u
}

/** Open one exercise row and return its panel. */
async function openExercise(u: ReturnType<typeof user>, name: string | RegExp) {
  const trigger = screen.getByRole('button', {
    name: typeof name === 'string' ? new RegExp(name) : name,
  })
  await u.click(trigger)
  const panelId = trigger.getAttribute('aria-controls')!
  return within(document.getElementById(panelId)!)
}

/** The guidance state chip for one exercise position. */
async function guidanceState(exerciseOrder: number) {
  return (await screen.findByTestId(`guidance-state-${exerciseOrder}`)).textContent
}

/* ------------------------------------------------------------------ */
/* 1. Placement                                                        */
/* ------------------------------------------------------------------ */

describe('1. guidance lives inside the active workout', () => {
  it('shows nothing until a workout has been started', async () => {
    const u = await openSession('monday')
    await screen.findByRole('button', { name: 'Start workout' })

    const panel = await openExercise(u, 'Lat Pulldown')
    expect(panel.queryByText('Guidance')).toBeNull()
    expect(screen.queryByTestId('guidance-state-0')).toBeNull()
  })

  it('appears inside the exercise panel once the workout exists', async () => {
    seedWorkout('monday', DATE)
    const u = await openSession('monday')
    await screen.findByText('Resume workout')

    const panel = await openExercise(u, 'Lat Pulldown')
    // Inside the exercise's own panel, alongside its sets — not a page of its own.
    expect(await panel.findByText('Guidance')).toBeInTheDocument()
    expect(panel.getAllByRole('button', { name: /^Complete$/ })).toHaveLength(4)
  })

  it('matches guidance to the exercise position, not the canonical slug', async () => {
    seedWorkout('monday', LAST_WEEK, { 0: atLoad(20, [15, 15, 15, 15]) })
    seedWorkout('monday', DATE)
    const u = await openSession('monday')
    await screen.findByText('Resume workout')

    await openExercise(u, 'Lat Pulldown')
    expect(await guidanceState(0)).toBe('Increase load')

    // Face Pull sits at position 2 and has no history of its own.
    await openExercise(u, 'Face Pull')
    expect(await guidanceState(2)).toBe('Find your load')
  })
})

/* ------------------------------------------------------------------ */
/* 2. Calibration (matrix 2–7)                                         */
/* ------------------------------------------------------------------ */

describe('2. starting-load calibration', () => {
  it('1, 2. asks for the first working set before offering any choice', async () => {
    seedWorkout('monday', DATE)
    const u = await openSession('monday')
    await screen.findByText('Resume workout')
    const panel = await openExercise(u, 'Lat Pulldown')

    expect(await guidanceState(0)).toBe('Find your load')
    expect(panel.queryByRole('button', { name: 'Good' })).toBeNull()
    expect(panel.queryByRole('button', { name: /^Use / })).toBeNull()
  })

  it('2. offers the choices once a first set is genuinely completed', async () => {
    seedWorkout('monday', DATE, { 0: [{ result: 12, load: 20 }, null, null, null] })
    const u = await openSession('monday')
    await screen.findByText('Resume workout')
    const panel = await openExercise(u, 'Lat Pulldown')

    expect(await panel.findByRole('button', { name: 'Too light' })).toBeInTheDocument()
    expect(panel.getByRole('button', { name: 'Good' })).toBeInTheDocument()
    expect(panel.getByRole('button', { name: 'Too heavy' })).toBeInTheDocument()
    expect(panel.getByText(/First set recorded at 20kg/)).toBeInTheDocument()
  })

  it('4. Good keeps the load that was actually lifted', async () => {
    seedWorkout('monday', DATE, { 0: [{ result: 12, load: 20 }, null, null, null] })
    const u = await openSession('monday')
    await screen.findByText('Resume workout')
    const panel = await openExercise(u, 'Lat Pulldown')

    await u.click(await panel.findByRole('button', { name: 'Good' }))

    expect(await panel.findByText(/20kg felt right/)).toBeInTheDocument()
    // Offered to the remaining sets as an explicit action, never pre-filled.
    expect(panel.getAllByRole('button', { name: 'Use 20kg' }).length).toBeGreaterThan(0)
  })

  it('3. Too light points one step up and names no number of its own', async () => {
    seedWorkout('monday', DATE, { 0: [{ result: 15, load: 20 }, null, null, null] })
    const u = await openSession('monday')
    await screen.findByText('Resume workout')
    const panel = await openExercise(u, 'Lat Pulldown')

    await u.click(await panel.findByRole('button', { name: 'Too light' }))

    expect(await panel.findByText(/Move one available step heavier/)).toBeInTheDocument()
    // No kilogram is invented, so nothing is offered to the set rows yet.
    expect(panel.queryByRole('button', { name: /^Use /})).toBeNull()
    expect(panel.getByLabelText(/Load you moved to/)).toBeInTheDocument()
  })

  it('5. Too heavy points one step down and names no number of its own', async () => {
    seedWorkout('monday', DATE, { 0: [{ result: 8, load: 20 }, null, null, null] })
    const u = await openSession('monday')
    await screen.findByText('Resume workout')
    const panel = await openExercise(u, 'Lat Pulldown')

    await u.click(await panel.findByRole('button', { name: 'Too heavy' }))

    expect(await panel.findByText(/Move one available step lighter/)).toBeInTheDocument()
    expect(panel.queryByRole('button', { name: /^Use /})).toBeNull()
  })

  it('7. a load the user chooses is remembered and offered', async () => {
    seedWorkout('monday', DATE, { 0: [{ result: 15, load: 20 }, null, null, null] })
    const u = await openSession('monday')
    await screen.findByText('Resume workout')
    const panel = await openExercise(u, 'Lat Pulldown')

    await u.click(await panel.findByRole('button', { name: 'Too light' }))
    await u.type(await panel.findByLabelText(/Load you moved to/), '25')
    await u.click(panel.getByRole('button', { name: 'Save load' }))

    expect(await panel.findByText(/Working from 25kg/)).toBeInTheDocument()
    expect(panel.getAllByRole('button', { name: 'Use 25kg' }).length).toBeGreaterThan(0)
  })

  it('6, 7. the judgement and the chosen load survive a remount', async () => {
    seedWorkout('monday', DATE, { 0: [{ result: 15, load: 20 }, null, null, null] })
    const first = await openSession('monday')
    await screen.findByText('Resume workout')
    let panel = await openExercise(first, 'Lat Pulldown')

    await first.click(await panel.findByRole('button', { name: 'Too light' }))
    await first.type(await panel.findByLabelText(/Load you moved to/), '25')
    await first.click(panel.getByRole('button', { name: 'Save load' }))
    await panel.findByText(/Working from 25kg/)

    // A reload: the whole app is torn down and rendered again, and the answer
    // comes back from the server rather than from anything in the browser.
    cleanup()
    const second = await openSession('monday')
    await screen.findByText('Resume workout')
    panel = await openExercise(second, 'Lat Pulldown')

    expect(await panel.findByText(/Working from 25kg/)).toBeInTheDocument()
    expect(panel.getByRole('button', { name: 'Too light' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect((panel.getByLabelText(/Load you moved to/) as HTMLInputElement).value).toBe('25')
  })

  it('28. undoing the first set takes the judgement with it', async () => {
    seedWorkout('monday', DATE, { 0: [{ result: 12, load: 20 }, null, null, null] })
    const u = await openSession('monday')
    await screen.findByText('Resume workout')
    const panel = await openExercise(u, 'Lat Pulldown')

    await u.click(await panel.findByRole('button', { name: 'Good' }))
    await panel.findByText(/20kg felt right/)

    await u.click(panel.getByRole('button', { name: 'Undo Set 1' }))

    // The set it was a judgement about is gone, so the judgement is too.
    await waitFor(() => {
      expect(panel.queryByRole('button', { name: 'Use 20kg' })).toBeNull()
    })
    expect(panel.queryByRole('button', { name: 'Good' })).toBeNull()
    expect(await guidanceState(0)).toBe('Find your load')
  })

  it('a judgement can be changed', async () => {
    seedWorkout('monday', DATE, { 0: [{ result: 12, load: 20 }, null, null, null] })
    const u = await openSession('monday')
    await screen.findByText('Resume workout')
    const panel = await openExercise(u, 'Lat Pulldown')

    await u.click(await panel.findByRole('button', { name: 'Good' }))
    await panel.findByText(/20kg felt right/)

    await u.click(panel.getByRole('button', { name: 'Too heavy' }))
    expect(await panel.findByText(/Move one available step lighter/)).toBeInTheDocument()
    expect(panel.queryByRole('button', { name: 'Use 20kg' })).toBeNull()
  })
})

/* ------------------------------------------------------------------ */
/* 3. Derived states from real history (matrix 8, 10)                  */
/* ------------------------------------------------------------------ */

describe('3. states derived from recorded history', () => {
  it('8. BUILD_REPS keeps the working load and says what to climb towards', async () => {
    seedWorkout('monday', LAST_WEEK, { 0: atLoad(20, [12, 12, 11, 10]) })
    seedWorkout('monday', DATE)
    const u = await openSession('monday')
    await screen.findByText('Resume workout')
    const panel = await openExercise(u, 'Lat Pulldown')

    expect(await guidanceState(0)).toBe('Build reps')
    expect(panel.getByText(/build towards 15/i)).toBeInTheDocument()
    // The factual reference is what was recorded, not a projection.
    expect(panel.getByText(new RegExp(`${LAST_WEEK}.*12 / 12 / 11 / 10.*20kg`))).toBeInTheDocument()
  })

  it('9. INCREASE_LOAD asks for a step and offers no number', async () => {
    seedWorkout('monday', LAST_WEEK, { 0: atLoad(20, [15, 15, 15, 15]) })
    seedWorkout('monday', DATE)
    const u = await openSession('monday')
    await screen.findByText('Resume workout')
    const panel = await openExercise(u, 'Lat Pulldown')

    expect(await guidanceState(0)).toBe('Increase load')
    expect(panel.getByText(/Increase one available step/)).toBeInTheDocument()
    expect(panel.queryByRole('button', { name: /^Use /})).toBeNull()
  })

  it('10. one weak session HOLDS and keeps offering the same load', async () => {
    seedWorkout('monday', LAST_WEEK, { 0: atLoad(20, [8, 8, 9, 8]) })
    seedWorkout('monday', DATE)
    const u = await openSession('monday')
    await screen.findByText('Resume workout')
    const panel = await openExercise(u, 'Lat Pulldown')

    expect(await guidanceState(0)).toBe('Hold')
    expect(panel.getByText(/one session is not a trend/i)).toBeInTheDocument()
    expect(panel.getAllByRole('button', { name: 'Use 20kg' }).length).toBeGreaterThan(0)
  })

  it('14. a skipped set last week holds rather than progressing', async () => {
    seedWorkout('monday', LAST_WEEK, {
      0: [{ result: 15, load: 20 }, { result: 15, load: 20 }, 'skipped', { result: 15, load: 20 }],
    })
    seedWorkout('monday', DATE)
    const u = await openSession('monday')
    await screen.findByText('Resume workout')
    const panel = await openExercise(u, 'Lat Pulldown')

    expect(await guidanceState(0)).toBe('Hold')
    expect(panel.getByText(/a working set was skipped/i)).toBeInTheDocument()
  })

  it('24. bodyweight work shows a target and never a load', async () => {
    seedWorkout('wednesday', '2026-09-02', {
      4: [{ result: 60 }, { result: 60 }, { result: 60 }],
    })
    seedWorkout('wednesday', DATE)
    const u = await openSession('wednesday')
    await screen.findByText('Resume workout')
    const panel = await openExercise(u, 'Plank')

    expect(await guidanceState(4)).toBe('Quality')
    expect(panel.getByText(/Bodyweight work/)).toBeInTheDocument()
    expect(panel.queryByRole('button', { name: /^Use /})).toBeNull()
    expect(panel.queryByLabelText(/^Load/)).toBeNull()
  })

  it('22. a LIGHT session stays on quality, never on more load', async () => {
    seedWorkout('wednesday', '2026-09-02', { 0: atLoad(12.5, [20, 20]) })
    seedWorkout('wednesday', DATE)
    const u = await openSession('wednesday')
    await screen.findByText('Resume workout')
    const panel = await openExercise(u, 'Lat Pulldown')

    expect(await guidanceState(0)).toBe('Quality')
    expect(panel.getByText(/Control and quality, not more load/)).toBeInTheDocument()
    // Only the same load is ever offered back.
    expect(panel.getAllByRole('button', { name: 'Use 12.5kg' }).length).toBeGreaterThan(0)
  })
})

/* ------------------------------------------------------------------ */
/* 4. A suggestion is not history (matrix 25–27)                       */
/* ------------------------------------------------------------------ */

describe('4. a suggestion never becomes what was performed', () => {
  async function buildingReps() {
    seedWorkout('monday', LAST_WEEK, { 0: atLoad(20, [12, 12, 11, 10]) })
    seedWorkout('monday', DATE)
    const u = await openSession('monday')
    await screen.findByText('Resume workout')
    const panel = await openExercise(u, 'Lat Pulldown')
    await screen.findByTestId('guidance-state-0')
    return { u, panel }
  }

  it('26. leaves every logging input blank on render', async () => {
    const { panel } = await buildingReps()

    for (const field of panel.getAllByLabelText('Load (kg)')) {
      expect((field as HTMLInputElement).value).toBe('')
    }
    for (const field of panel.getAllByLabelText('Reps')) {
      expect((field as HTMLInputElement).value).toBe('')
    }
  })

  it('26. records nothing until Complete is pressed', async () => {
    const { u, panel } = await buildingReps()

    await u.click(panel.getAllByRole('button', { name: 'Use 20kg' })[0])
    // The draft now holds 20 — and the stored set is still pending.
    expect((panel.getAllByLabelText('Load (kg)')[0] as HTMLInputElement).value).toBe('20')

    const stored = server.workouts.get(`${DATE}#monday`)!
    expect(stored.sets[0].status).toBe('pending')
    expect(stored.sets[0].load).toBeNull()
    expect(stored.sets[0].result).toBeNull()
  })

  it('27. Use suggestion touches the draft only, then Complete stores it', async () => {
    const { u, panel } = await buildingReps()

    await u.click(panel.getAllByRole('button', { name: 'Use 20kg' })[0])
    await u.type(panel.getAllByLabelText('Reps')[0], '13')
    await u.click(panel.getAllByRole('button', { name: /^Complete$/ })[0])

    await panel.findByText(/Completed · 13 reps · 20kg/)
    const stored = server.workouts.get(`${DATE}#monday`)!
    expect(stored.sets[0]).toMatchObject({
      status: 'completed',
      result: 13,
      load: { value: 20, unit: 'kg' },
    })
  })

  it('25. the suggestion is always overrideable', async () => {
    const { u, panel } = await buildingReps()

    // Take the suggestion, then think better of it.
    await u.click(panel.getAllByRole('button', { name: 'Use 20kg' })[0])
    await u.clear(panel.getAllByLabelText('Load (kg)')[0])
    await u.type(panel.getAllByLabelText('Load (kg)')[0], '17.5')
    await u.type(panel.getAllByLabelText('Reps')[0], '14')
    await u.click(panel.getAllByRole('button', { name: /^Complete$/ })[0])

    await panel.findByText(/Completed · 14 reps · 17.5kg/)
    expect(server.workouts.get(`${DATE}#monday`)!.sets[0].load).toEqual({
      value: 17.5,
      unit: 'kg',
    })
  })

  it('25b. a set can be completed with no load at all despite a suggestion', async () => {
    const { u, panel } = await buildingReps()

    await u.type(panel.getAllByLabelText('Reps')[0], '12')
    await u.click(panel.getAllByRole('button', { name: /^Complete$/ })[0])

    await panel.findByText(/Completed · 12 reps$/)
    expect(server.workouts.get(`${DATE}#monday`)!.sets[0].load).toBeNull()
  })
})

/* ------------------------------------------------------------------ */
/* 5. Guidance stays subordinate                                       */
/* ------------------------------------------------------------------ */

describe('5. guidance is subordinate to logging', () => {
  it('a failed guidance read never blocks logging', async () => {
    seedWorkout('monday', DATE)
    // The same workouts, with a guidance API that always refuses.
    const failing = createProgressionServer(server)
    failing.failReads(50)
    mockAuthFetch({ session: authenticatedSession, workouts: server, progression: failing })

    const u = await openSession('monday')
    await screen.findByText('Resume workout')
    const panel = await openExercise(u, 'Lat Pulldown')

    // No guidance — and the workout still logs perfectly.
    expect(panel.queryByText('Guidance')).toBeNull()
    await u.type(panel.getAllByLabelText('Reps')[0], '12')
    await u.click(panel.getAllByRole('button', { name: /^Complete$/ })[0])
    await panel.findByText(/Completed · 12 reps/)
  })

  it('stays on screen while it re-reads, but stops being actionable', async () => {
    seedWorkout('monday', LAST_WEEK, { 0: atLoad(20, [12, 12, 11, 10]) })
    seedWorkout('monday', DATE)
    const progression = createProgressionServer(server)
    mockAuthFetch({ session: authenticatedSession, workouts: server, progression })

    const u = await openSession('monday')
    await screen.findByText('Resume workout')
    const panel = await openExercise(u, 'Lat Pulldown')
    expect(await guidanceState(0)).toBe('Build reps')
    expect(panel.getAllByRole('button', { name: 'Use 20kg' })[0]).toBeEnabled()

    // Hold the re-read that completing a set triggers.
    const release = progression.holdReads()
    await u.type(panel.getAllByLabelText('Reps')[0], '15')
    await u.click(panel.getAllByRole('button', { name: /^Complete$/ })[0])
    await panel.findByText(/Completed · 15 reps/)

    // The previous answer is still readable — guidance never blanks
    // mid-workout — and it says so.
    expect(screen.getByTestId('guidance-state-0')).toBeInTheDocument()
    expect(await screen.findByTestId('guidance-refreshing-0')).toBeInTheDocument()

    // But it was derived from a workout that has already changed, so it is not
    // one tap from a logging field.
    const stale = panel.getAllByRole('button', { name: 'Use 20kg' })
    for (const button of stale) expect(button).toBeDisabled()
    await u.click(stale[1])
    expect((panel.getAllByLabelText('Load (kg)')[0] as HTMLInputElement).value).toBe('')

    release()

    // Actionable again only once the new derivation has answered.
    await waitFor(() => {
      expect(screen.queryByTestId('guidance-refreshing-0')).toBeNull()
    })
    expect(panel.getAllByRole('button', { name: 'Use 20kg' })[0]).toBeEnabled()
  })

  it('withholds the calibration choices while an Undo is being recomputed', async () => {
    seedWorkout('monday', DATE, { 0: [{ result: 12, load: 20 }, null, null, null] })
    const progression = createProgressionServer(server)
    mockAuthFetch({ session: authenticatedSession, workouts: server, progression })

    const u = await openSession('monday')
    await screen.findByText('Resume workout')
    const panel = await openExercise(u, 'Lat Pulldown')
    expect(await panel.findByRole('button', { name: 'Good' })).toBeEnabled()

    // Undo the very set those choices are a judgement about.
    const release = progression.holdReads()
    await u.click(panel.getByRole('button', { name: 'Undo Set 1' }))
    await panel.findByText(/^Set 1$/)

    // The panel still shows the old answer, and refuses to act on it.
    expect(await screen.findByTestId('guidance-refreshing-0')).toBeInTheDocument()
    for (const label of ['Too light', 'Good', 'Too heavy']) {
      expect(panel.getByRole('button', { name: label }), label).toBeDisabled()
    }
    await u.click(panel.getByRole('button', { name: 'Good' }))
    expect(progression.calibrations.size).toBe(0)

    release()

    // The recomputed answer is the truthful one: there is no first set to judge.
    await waitFor(() => {
      expect(panel.queryByRole('button', { name: 'Good' })).toBeNull()
    })
    expect(await guidanceState(0)).toBe('Find your load')
    expect(progression.calibrations.size).toBe(0)
  })

  it('leaves nothing actionable when the recompute fails', async () => {
    seedWorkout('monday', LAST_WEEK, { 0: atLoad(20, [12, 12, 11, 10]) })
    seedWorkout('monday', DATE)
    const progression = createProgressionServer(server)
    mockAuthFetch({ session: authenticatedSession, workouts: server, progression })

    const u = await openSession('monday')
    await screen.findByText('Resume workout')
    const panel = await openExercise(u, 'Lat Pulldown')
    expect(panel.getAllByRole('button', { name: 'Use 20kg' })[0]).toBeEnabled()

    progression.failReads(50)
    await u.type(panel.getAllByLabelText('Reps')[0], '15')
    await u.click(panel.getAllByRole('button', { name: /^Complete$/ })[0])
    await panel.findByText(/Completed · 15 reps/)

    // No stale suggestion survives a failed recompute — the panel goes.
    await waitFor(() => {
      expect(panel.queryByText('Guidance')).toBeNull()
    })
    expect(panel.queryByRole('button', { name: /^Use / })).toBeNull()
    // And logging is unaffected.
    await u.type(panel.getAllByLabelText('Reps')[0], '14')
    await u.click(panel.getAllByRole('button', { name: /^Complete$/ })[0])
    await panel.findByText(/Completed · 14 reps/)
  })

  it('keeps a failed calibration save visible on its own exercise', async () => {
    seedWorkout('monday', DATE, { 0: [{ result: 12, load: 20 }, null, null, null] })
    const progression = createProgressionServer(server)
    mockAuthFetch({ session: authenticatedSession, workouts: server, progression })

    const u = await openSession('monday')
    await screen.findByText('Resume workout')
    const panel = await openExercise(u, 'Lat Pulldown')

    progression.failMutations(1)
    await u.click(await panel.findByRole('button', { name: 'Good' }))

    // The request has finished failing: the spinner is gone and the message
    // must not have gone with it.
    const alert = await panel.findByRole('alert')
    expect(alert).toHaveTextContent(/Could not save that/)
    expect(alert).toHaveTextContent(/logged sets are unaffected/)
    expect(progression.calibrations.size).toBe(0)

    // Nothing was recorded, and the choices are usable again.
    expect(panel.getByRole('button', { name: 'Good' })).toBeEnabled()
    expect(await guidanceState(0)).toBe('Find your load')

    // A successful retry clears it.
    await u.click(panel.getByRole('button', { name: 'Good' }))
    await panel.findByText(/20kg felt right/)
    expect(panel.queryByRole('alert')).toBeNull()
  })

  it('shows a calibration failure only on the exercise it happened on', async () => {
    seedWorkout('monday', DATE, {
      0: [{ result: 12, load: 20 }, null, null, null],
      1: [{ result: 10, load: 12.5 }, null, null],
    })
    const progression = createProgressionServer(server)
    mockAuthFetch({ session: authenticatedSession, workouts: server, progression })

    const u = await openSession('monday')
    await screen.findByText('Resume workout')

    const first = await openExercise(u, 'Lat Pulldown')
    progression.failMutations(1)
    await u.click(await first.findByRole('button', { name: 'Good' }))
    await first.findByRole('alert')

    // A different exercise shows nothing of it.
    const second = await openExercise(u, 'One-Arm DB Row')
    expect(await second.findByRole('button', { name: 'Good' })).toBeInTheDocument()
    expect(second.queryByRole('alert')).toBeNull()
  })

  it('never asks for guidance before a workout exists', async () => {
    const spy = mockAuthFetch({ session: authenticatedSession, workouts: server })
    await openSession('monday')
    await screen.findByRole('button', { name: 'Start workout' })

    const asked = spy.mock.calls.some(([url]) => String(url).startsWith('/api/progression'))
    expect(asked).toBe(false)
  })

  it('11. two weak sessions ask for a step down, and offer no number', async () => {
    seedWorkout('monday', '2026-08-24', { 0: atLoad(20, [8, 8, 9, 8]) }, 1)
    seedWorkout('monday', LAST_WEEK, { 0: atLoad(20, [9, 8, 8, 9]) }, 2)
    seedWorkout('monday', DATE, {}, 3)
    const u = await openSession('monday')
    await screen.findByText('Resume workout')
    const panel = await openExercise(u, 'Lat Pulldown')

    expect(await guidanceState(0)).toBe('Reduce load')
    expect(panel.getByText(/Reduce one available step/)).toBeInTheDocument()
    expect(panel.queryByRole('button', { name: /^Use /})).toBeNull()
  })

  it('mirrors nothing into browser storage', async () => {
    seedWorkout('monday', DATE, { 0: [{ result: 12, load: 20 }, null, null, null] })
    const u = await openSession('monday')
    await screen.findByText('Resume workout')
    const panel = await openExercise(u, 'Lat Pulldown')

    await u.click(await panel.findByRole('button', { name: 'Good' }))
    await panel.findByText(/20kg felt right/)

    // The server is the only durable copy; a reload re-reads it.
    expect(window.localStorage.length).toBe(0)
    expect(window.sessionStorage.length).toBe(0)
  })

  it('Progress stays factual — it never reads or shows guidance', async () => {
    seedWorkout('monday', LAST_WEEK, { 0: atLoad(20, [15, 15, 15, 15]) })
    const spy = mockAuthFetch({ session: authenticatedSession, workouts: server })

    renderApp('/progress')
    await screen.findByRole('heading', { level: 1 })

    await waitFor(() => {
      expect(screen.getByText('Foundation 100')).toBeInTheDocument()
    })
    expect(screen.queryByText('Guidance')).toBeNull()
    expect(screen.queryByText(/Increase one available step/)).toBeNull()
    expect(
      spy.mock.calls.some(([url]) => String(url).startsWith('/api/progression')),
    ).toBe(false)
  })
})
