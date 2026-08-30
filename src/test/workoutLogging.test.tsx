import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getSession } from '@/features/training/sessions'
import { buildWorkoutPlan, toStartPayload } from '@/features/training/workoutPlan'
import { authenticatedSession, mockAuthFetch, renderApp } from './authTestUtils'
import { createWorkoutServer, type WorkoutServer } from './workoutApiTestUtils'

/**
 * Round 08 — set-by-set workout logging in the training session page.
 *
 * These run the real client, the real hook and the real page against an
 * in-memory stand-in for the API, so start/resume, logging, undo, hydration
 * and failure handling are exercised end to end. Nothing is mirrored into
 * browser storage: a remount re-reads the server.
 */

const TODAY = new Date(2026, 7, 31, 9, 0)
const DATE = '2026-08-31'

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

/** Seed a workout as if it had already been started, exactly as the API would. */
function seedStarted(sessionId: string) {
  const session = getSession(sessionId)!
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
      status: 'pending' as const,
      load: null,
      result: null,
      updatedAt: 1,
    })),
  )
  server.seed(DATE, sessionId, {
    occurrence: {
      date: DATE,
      sessionId,
      day: session.day,
      focus: session.focus,
      intensity: session.intensity,
      startedAt: 1,
      updatedAt: 1,
    },
    sets,
  })
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

/** Start the workout through the real button. */
async function startWorkout(u: ReturnType<typeof user>) {
  await u.click(await screen.findByRole('button', { name: 'Start workout' }))
  await screen.findByText('Resume workout')
}

/* ------------------------------------------------------------------ */
/* 1. Loading, start and resume                                        */
/* ------------------------------------------------------------------ */

describe('1. start and resume', () => {
  it('never flashes "Start workout" before the resume check resolves', async () => {
    const release = server.holdReads()
    renderApp(`/training/monday`)
    await screen.findByRole('heading', { level: 1 })

    // The read is still open: the page must not claim the workout is unstarted.
    expect(screen.getByText('Checking your workout…')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Start workout' })).toBeNull()
    expect(screen.queryByText('Resume workout')).toBeNull()

    release()
    await screen.findByRole('button', { name: 'Start workout' })
  })

  it('offers Start workout when nothing has been started', async () => {
    await openSession('monday')
    expect(await screen.findByRole('button', { name: 'Start workout' })).toBeInTheDocument()
    expect(screen.getByText('Workout not started')).toBeInTheDocument()
    expect(screen.getByText(/5 exercises · 15 sets to log/)).toBeInTheDocument()
  })

  it('offers Resume workout when an occurrence already exists', async () => {
    seedStarted('monday')
    await openSession('monday')

    expect(await screen.findByText('Resume workout')).toBeInTheDocument()
    expect(screen.getByText(/Workout in progress/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Start workout' })).toBeNull()
  })

  it('creates the workout for today’s local date and this session', async () => {
    const u = await openSession('monday')
    await startWorkout(u)

    expect([...server.workouts.keys()]).toEqual([`${DATE}#monday`])
    expect(server.workouts.get(`${DATE}#monday`)!.sets).toHaveLength(15)
  })

  it('shows no set controls before the workout is started', async () => {
    const u = await openSession('monday')
    await screen.findByRole('button', { name: 'Start workout' })
    const panel = await openExercise(u, 'Lat Pulldown')

    expect(panel.queryByRole('button', { name: 'Complete' })).toBeNull()
    expect(panel.queryByLabelText(/Reps/)).toBeNull()
    // The accepted prescription view is untouched.
    expect(panel.getByText('4 × 10–15')).toBeInTheDocument()
  })

  it('renders the expected sets once started', async () => {
    const u = await openSession('monday')
    await startWorkout(u)
    const panel = await openExercise(u, 'Lat Pulldown')

    expect(panel.getByText('Set 1')).toBeInTheDocument()
    expect(panel.getByText('Set 4')).toBeInTheDocument()
    expect(panel.queryByText('Set 5')).toBeNull()
    expect(panel.getAllByRole('button', { name: 'Complete' })).toHaveLength(4)
  })
})

/* ------------------------------------------------------------------ */
/* 2. Result and load semantics                                        */
/* ------------------------------------------------------------------ */

describe('2. result and load semantics', () => {
  it('labels band work as plain kg', async () => {
    const u = await openSession('monday')
    await startWorkout(u)
    const panel = await openExercise(u, 'Lat Pulldown')

    expect(panel.getAllByLabelText('Load (kg)')).toHaveLength(4)
    expect(panel.queryByLabelText('Load (kg each)')).toBeNull()
  })

  it('labels dumbbell work as kg each, never a combined weight', async () => {
    const u = await openSession('monday')
    await startWorkout(u)
    const panel = await openExercise(u, 'One-Arm DB Row')

    expect(panel.getAllByLabelText('Load (kg each)')).toHaveLength(3)
  })

  it('asks for seconds on a timed hold, with no load field', async () => {
    const u = await openSession('wednesday')
    await startWorkout(u)
    const panel = await openExercise(u, 'Plank')

    expect(panel.getAllByLabelText('Seconds')).toHaveLength(3)
    expect(panel.queryByLabelText(/^Load/)).toBeNull()
  })

  it('asks for reps per side on per-side core work', async () => {
    const u = await openSession('wednesday')
    await startWorkout(u)
    const panel = await openExercise(u, 'Dead Bug')

    expect(panel.getAllByLabelText('Reps / side')).toHaveLength(3)
    expect(panel.queryByLabelText(/^Load/)).toBeNull()
  })

  it('asks for plain reps where the prescription is not per side', async () => {
    const u = await openSession('monday')
    await startWorkout(u)
    const panel = await openExercise(u, 'Lat Pulldown')

    expect(panel.getAllByLabelText('Reps')).toHaveLength(4)
  })

  it('gives every input an explicit label', async () => {
    const u = await openSession('monday')
    await startWorkout(u)
    const panel = await openExercise(u, 'Lat Pulldown')

    for (const input of panel.getAllByRole('textbox')) {
      expect(input).toHaveAccessibleName()
    }
  })
})

/* ------------------------------------------------------------------ */
/* 3. Completing, skipping, undoing                                    */
/* ------------------------------------------------------------------ */

describe('3. logging a set', () => {
  async function openStartedMonday() {
    const u = await openSession('monday')
    await startWorkout(u)
    return { u, panel: await openExercise(u, 'Lat Pulldown') }
  }

  it('will not complete a set until a real result is entered', async () => {
    const { panel } = await openStartedMonday()
    const complete = panel.getAllByRole('button', { name: 'Complete' })[0]
    expect(complete).toBeDisabled()
  })

  it('will not accept a zero or negative result', async () => {
    const { u, panel } = await openStartedMonday()
    const reps = panel.getAllByLabelText('Reps')[0]

    await u.type(reps, '0')
    expect(panel.getAllByRole('button', { name: 'Complete' })[0]).toBeDisabled()

    await u.clear(reps)
    await u.type(reps, '12')
    expect(panel.getAllByRole('button', { name: 'Complete' })[0]).toBeEnabled()
  })

  it('records a completed set and shows exactly what was stored', async () => {
    const { u, panel } = await openStartedMonday()

    await u.type(panel.getAllByLabelText('Load (kg)')[0], '20')
    await u.type(panel.getAllByLabelText('Reps')[0], '12')
    await u.click(panel.getAllByRole('button', { name: 'Complete' })[0])

    expect(await panel.findByText(/Completed · 12 reps · 20kg/)).toBeInTheDocument()
    const stored = server.workouts.get(`${DATE}#monday`)!.sets[0]
    expect(stored.status).toBe('completed')
    expect(stored.result).toBe(12)
    expect(stored.load).toEqual({ value: 20, unit: 'kg' })
  })

  it('records a completed set with no load when none is entered', async () => {
    const { u, panel } = await openStartedMonday()

    await u.type(panel.getAllByLabelText('Reps')[0], '15')
    await u.click(panel.getAllByRole('button', { name: 'Complete' })[0])

    expect(await panel.findByText(/Completed · 15 reps/)).toBeInTheDocument()
    expect(server.workouts.get(`${DATE}#monday`)!.sets[0].load).toBeNull()
  })

  it('shows a dumbbell result with its "each" meaning intact', async () => {
    const u = await openSession('monday')
    await startWorkout(u)
    const panel = await openExercise(u, 'One-Arm DB Row')

    await u.type(panel.getAllByLabelText('Load (kg each)')[0], '10')
    await u.type(panel.getAllByLabelText('Reps')[0], '9')
    await u.click(panel.getAllByRole('button', { name: 'Complete' })[0])

    expect(await panel.findByText(/Completed · 9 reps · 10kg each/)).toBeInTheDocument()
  })

  it('shows a timed hold in seconds', async () => {
    const u = await openSession('wednesday')
    await startWorkout(u)
    const panel = await openExercise(u, 'Plank')

    await u.type(panel.getAllByLabelText('Seconds')[0], '45')
    await u.click(panel.getAllByRole('button', { name: 'Complete' })[0])

    expect(await panel.findByText(/Completed · 45s/)).toBeInTheDocument()
  })

  it('marks a set skipped, visibly distinct from completed', async () => {
    const { u, panel } = await openStartedMonday()

    await u.click(panel.getAllByRole('button', { name: 'Skip' })[0])

    expect(await panel.findByText('Skipped')).toBeInTheDocument()
    expect(panel.queryByText(/Completed/)).toBeNull()
    const stored = server.workouts.get(`${DATE}#monday`)!.sets[0]
    expect(stored.status).toBe('skipped')
    // A skip never records a result.
    expect(stored.result).toBeNull()
  })

  it('undoes a completed set back to pending and clears its values', async () => {
    const { u, panel } = await openStartedMonday()

    await u.type(panel.getAllByLabelText('Load (kg)')[0], '20')
    await u.type(panel.getAllByLabelText('Reps')[0], '12')
    await u.click(panel.getAllByRole('button', { name: 'Complete' })[0])
    await panel.findByText(/Completed · 12 reps/)

    await u.click(panel.getByRole('button', { name: 'Undo Set 1' }))

    await waitFor(() => expect(panel.queryByText(/Completed/)).toBeNull())
    const stored = server.workouts.get(`${DATE}#monday`)!.sets[0]
    expect(stored.status).toBe('pending')
    expect(stored.result).toBeNull()
    expect(stored.load).toBeNull()
    // The expected set is still there — undo clears logging, not history.
    expect(server.workouts.get(`${DATE}#monday`)!.sets).toHaveLength(15)
  })

  it('undoes a skipped set back to pending', async () => {
    const { u, panel } = await openStartedMonday()

    await u.click(panel.getAllByRole('button', { name: 'Skip' })[0])
    await panel.findByText('Skipped')
    await u.click(panel.getByRole('button', { name: 'Undo Set 1' }))

    await waitFor(() => expect(panel.queryByText('Skipped')).toBeNull())
    expect(server.workouts.get(`${DATE}#monday`)!.sets[0].status).toBe('pending')
  })

  it('logs only the set that was acted on', async () => {
    const { u, panel } = await openStartedMonday()

    await u.type(panel.getAllByLabelText('Reps')[1], '11')
    await u.click(panel.getAllByRole('button', { name: 'Complete' })[1])
    await panel.findByText(/Completed · 11 reps/)

    const sets = server.workouts.get(`${DATE}#monday`)!.sets
    expect(sets[0].status).toBe('pending')
    expect(sets[1].status).toBe('completed')
    expect(sets[2].status).toBe('pending')
  })
})

/* ------------------------------------------------------------------ */
/* 4. Progress                                                         */
/* ------------------------------------------------------------------ */

describe('4. progress', () => {
  it('counts resolved sets and keeps skips distinct from completions', async () => {
    const u = await openSession('monday')
    await startWorkout(u)
    const panel = await openExercise(u, 'Lat Pulldown')

    expect(screen.getByText(/0 \/ 15 sets resolved/)).toBeInTheDocument()

    await u.type(panel.getAllByLabelText('Reps')[0], '12')
    await u.click(panel.getAllByRole('button', { name: 'Complete' })[0])
    await panel.findByText(/Completed/)
    await u.click(panel.getAllByRole('button', { name: 'Skip' })[0])
    await panel.findByText('Skipped')

    expect(screen.getByText(/2 \/ 15 sets resolved/)).toBeInTheDocument()
    expect(screen.getByText(/1 completed · 1 skipped/)).toBeInTheDocument()
  })

  it('exposes progress to assistive technology', async () => {
    const u = await openSession('monday')
    await startWorkout(u)

    const bar = screen.getByRole('progressbar', { name: 'Sets resolved' })
    expect(bar).toHaveAttribute('aria-valuenow', '0')
    expect(bar).toHaveAttribute('aria-valuemax', '15')
  })

  it('shows a per-exercise resolved count on the compact row', async () => {
    const u = await openSession('monday')
    await startWorkout(u)
    const panel = await openExercise(u, 'Lat Pulldown')

    await u.type(panel.getAllByLabelText('Reps')[0], '12')
    await u.click(panel.getAllByRole('button', { name: 'Complete' })[0])
    await panel.findByText(/Completed/)

    expect(screen.getByRole('button', { name: /Lat Pulldown/ })).toHaveTextContent('1/4')
  })
})

/* ------------------------------------------------------------------ */
/* 5. Refresh and resume                                               */
/* ------------------------------------------------------------------ */

describe('5. refresh and resume', () => {
  it('hydrates the exact persisted state after a real remount', async () => {
    const u = await openSession('monday')
    await startWorkout(u)
    let panel = await openExercise(u, 'Lat Pulldown')

    await u.type(panel.getAllByLabelText('Load (kg)')[0], '20')
    await u.type(panel.getAllByLabelText('Reps')[0], '12')
    await u.click(panel.getAllByRole('button', { name: 'Complete' })[0])
    await panel.findByText(/Completed · 12 reps · 20kg/)
    await u.click(panel.getAllByRole('button', { name: 'Skip' })[0])
    await panel.findByText('Skipped')

    // A real refresh: the tree is torn down and rebuilt, so everything comes
    // back from the server or not at all.
    cleanup()
    const u2 = await openSession('monday')
    await screen.findByText('Resume workout')
    panel = await openExercise(u2, 'Lat Pulldown')

    expect(panel.getByText(/Completed · 12 reps · 20kg/)).toBeInTheDocument()
    expect(panel.getByText('Skipped')).toBeInTheDocument()
    expect(screen.getByText(/2 \/ 15 sets resolved/)).toBeInTheDocument()
    // Pending sets are still pending.
    expect(panel.getAllByRole('button', { name: 'Complete' })).toHaveLength(2)
  })

  it('resumes the same occurrence rather than creating a second one', async () => {
    const u = await openSession('monday')
    await startWorkout(u)

    cleanup()
    await openSession('monday')
    await screen.findByText('Resume workout')

    expect([...server.workouts.keys()]).toEqual([`${DATE}#monday`])
    const starts = server.calls.filter((call) => call.url.endsWith('/start'))
    expect(starts).toHaveLength(1)
  })

  it('keeps a different session’s workout separate', async () => {
    const u = await openSession('monday')
    await startWorkout(u)

    cleanup()
    const u2 = await openSession('wednesday')
    // Wednesday is its own occurrence, so it is still unstarted.
    expect(await screen.findByRole('button', { name: 'Start workout' })).toBeInTheDocument()
    await startWorkout(u2)

    expect([...server.workouts.keys()].sort()).toEqual([
      `${DATE}#monday`,
      `${DATE}#wednesday`,
    ])
  })

  it('does not mirror workout state into browser storage', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    const u = await openSession('monday')
    await startWorkout(u)
    const panel = await openExercise(u, 'Lat Pulldown')

    await u.type(panel.getAllByLabelText('Reps')[0], '12')
    await u.click(panel.getAllByRole('button', { name: 'Complete' })[0])
    await panel.findByText(/Completed/)

    expect(setItem).not.toHaveBeenCalled()
  })
})

/* ------------------------------------------------------------------ */
/* 6. Failure handling                                                 */
/* ------------------------------------------------------------------ */

describe('6. failure handling', () => {
  it('reports a failed load and recovers on retry', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    server.failReads()

    const u = await openSession('monday')
    expect(await screen.findByText(/Could not load this workout/)).toBeInTheDocument()
    // A failed read must not be reported as "not started".
    expect(screen.queryByRole('button', { name: 'Start workout' })).toBeNull()

    await u.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('button', { name: 'Start workout' })).toBeInTheDocument()
    errors.mockRestore()
  })

  it('keeps the persisted state visible when a set fails to save', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const u = await openSession('monday')
    await startWorkout(u)
    const panel = await openExercise(u, 'Lat Pulldown')

    server.failMutations()
    await u.type(panel.getAllByLabelText('Reps')[0], '12')
    await u.click(panel.getAllByRole('button', { name: 'Complete' })[0])

    expect(await screen.findByText(/Could not save this set/)).toBeInTheDocument()
    // Nothing was wiped and nothing was invented.
    expect(server.workouts.get(`${DATE}#monday`)!.sets[0].status).toBe('pending')
    expect(screen.getByText(/0 \/ 15 sets resolved/)).toBeInTheDocument()
    expect(panel.getAllByRole('button', { name: 'Complete' })).toHaveLength(4)
    errors.mockRestore()
  })

  it('recovers after a failed set save', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const u = await openSession('monday')
    await startWorkout(u)
    const panel = await openExercise(u, 'Lat Pulldown')

    server.failMutations()
    await u.type(panel.getAllByLabelText('Reps')[0], '12')
    await u.click(panel.getAllByRole('button', { name: 'Complete' })[0])
    await screen.findByText(/Could not save this set/)

    await u.click(panel.getAllByRole('button', { name: 'Complete' })[0])
    expect(await panel.findByText(/Completed · 12 reps/)).toBeInTheDocument()
    errors.mockRestore()
  })

  it('prevents a duplicate submit while a set is saving', async () => {
    const u = await openSession('monday')
    await startWorkout(u)
    const panel = await openExercise(u, 'Lat Pulldown')

    await u.type(panel.getAllByLabelText('Reps')[0], '12')
    const release = server.hold()
    const complete = panel.getAllByRole('button', { name: 'Complete' })[0]

    await u.click(complete)
    // The row reports progress and every control is locked.
    expect(await panel.findByText('Saving…')).toBeInTheDocument()
    expect(complete).toBeDisabled()
    expect(panel.getAllByRole('button', { name: 'Skip' })[0]).toBeDisabled()

    await u.click(complete)
    await u.click(panel.getAllByRole('button', { name: 'Skip' })[1])

    release()
    await panel.findByText(/Completed · 12 reps/)

    // Exactly one write reached the server.
    const writes = server.calls.filter((call) => call.method !== 'GET')
    expect(writes.filter((call) => call.url.includes('/sets/'))).toHaveLength(1)
  })

  it('prevents a duplicate start', async () => {
    const u = await openSession('monday')
    const release = server.hold()

    const start = await screen.findByRole('button', { name: 'Start workout' })
    await u.click(start)
    await u.click(start)

    release()
    await screen.findByText('Resume workout')

    expect(server.calls.filter((call) => call.url.endsWith('/start'))).toHaveLength(1)
  })
})

/* ------------------------------------------------------------------ */
/* 7. Training regressions                                             */
/* ------------------------------------------------------------------ */

describe('7. the accepted training view still holds', () => {
  it('keeps each session’s own prescription, not a canonical lookup', async () => {
    const u = await openSession('wednesday')
    await startWorkout(u)
    const panel = await openExercise(u, 'Lat Pulldown')

    // Wednesday's Lat Pulldown is 2 × 15–20, not Monday's 4 × 10–15.
    expect(panel.getByText('2 × 15–20')).toBeInTheDocument()
    expect(panel.queryByText('4 × 10–15')).toBeNull()
    expect(panel.getAllByRole('button', { name: 'Complete' })).toHaveLength(2)
  })

  it('logs the session’s own occurrence for a repeated canonical exercise', async () => {
    const u = await openSession('wednesday')
    await startWorkout(u)
    const panel = await openExercise(u, 'Lat Pulldown')

    await u.type(panel.getAllByLabelText('Reps')[0], '18')
    await u.click(panel.getAllByRole('button', { name: 'Complete' })[0])
    await panel.findByText(/Completed · 18 reps/)

    // Monday's Lat Pulldown shares the canonical identity but not the log.
    expect(server.workouts.has(`${DATE}#monday`)).toBe(false)
    const stored = server.workouts.get(`${DATE}#wednesday`)!.sets[0]
    expect(stored.exerciseId).toBe('lat-pulldown')
    expect(stored.prescription).toBe('2 × 15–20')
  })

  it('keeps single-open accordion behaviour', async () => {
    const u = await openSession('monday')
    await startWorkout(u)

    const lat = screen.getByRole('button', { name: /Lat Pulldown/ })
    const row = screen.getByRole('button', { name: /One-Arm DB Row/ })

    await u.click(lat)
    expect(lat).toHaveAttribute('aria-expanded', 'true')

    // Opening one row closes whichever was open. Asserted on the trigger state
    // rather than on how many panels are still animating out.
    await u.click(row)
    await waitFor(() => expect(lat).toHaveAttribute('aria-expanded', 'false'))
    expect(row).toHaveAttribute('aria-expanded', 'true')
  })

  it('still offers the exercise detail link', async () => {
    const u = await openSession('monday')
    await startWorkout(u)
    const panel = await openExercise(u, 'Lat Pulldown')

    expect(panel.getByRole('link', { name: /Open exercise details/ })).toHaveAttribute(
      'href',
      '/exercises/lat-pulldown?from=monday',
    )
  })

  it('still reports an unknown session', async () => {
    renderApp('/training/someday')
    expect(
      await screen.findByRole('heading', { name: 'Session not found' }),
    ).toBeInTheDocument()
  })
})
