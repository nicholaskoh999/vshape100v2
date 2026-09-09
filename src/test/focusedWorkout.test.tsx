import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getSession } from '@/features/training/sessions'
import { buildWorkoutPlan, toStartPayload } from '@/features/training/workoutPlan'
import { authenticatedSession, mockAuthFetch, renderApp } from './authTestUtils'
import { createWorkoutServer, type WorkoutServer } from './workoutApiTestUtils'
import type { WorkoutSetStatus } from '@shared/workoutLog'

/**
 * ROUND 24 CORRECTION (BLOCKER 3) — FOCUSED WORKOUT MODE.
 *
 * The redesign left the active workout as a session OVERVIEW: Resume workout,
 * collapsed exercise cards, and the whole app's navigation still on screen. It
 * looked better than what it replaced and it still was not a gym screen.
 *
 * Focused mode is the other half, and the things worth defending about it are
 * all refusals:
 *
 *   IT DOES NOT GUESS. The exercise it opens on is the one holding the first
 *   PENDING set of the persisted workout — not the first exercise, not the last
 *   one touched.
 *
 *   IT WRITES NOTHING BY BEING OPENED. Entering is a pure read of state that
 *   already exists.
 *
 *   IT INVENTS NO CURRENT SET. A workout with everything resolved says so.
 *
 *   IT CHANGES NO MODALITY. The controls come from the same component the
 *   accordion renders, against the same frozen snapshot: kg each still says per
 *   dumbbell, a band still has no kilogram field, and bodyweight still has no
 *   load field at all.
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
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function user() {
  return userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
}

/**
 * Seed a started workout, with control over which sets are already resolved.
 *
 * `resolve` is asked about every set in performance order; whatever it returns
 * becomes that set's stored status. Everything else is exactly what the API
 * would have written at Start.
 */
function seedStarted(
  sessionId: string,
  resolve: (exerciseOrder: number, setIndex: number) => WorkoutSetStatus = () => 'pending',
) {
  const session = getSession(sessionId)!
  const payload = toStartPayload(session, buildWorkoutPlan(session)!)
  const sets = payload.exercises.flatMap((exercise, exerciseOrder) =>
    Array.from({ length: exercise.setCount }, (_unused, setIndex) => {
      const status = resolve(exerciseOrder, setIndex)
      return {
        exerciseOrder,
        setIndex,
        exerciseId: exercise.exerciseId,
        exerciseName: exercise.name,
        prescription: exercise.prescription,
        equipment: exercise.equipment,
        resultKind: exercise.resultKind,
        loadMode: exercise.loadMode,
        perSide: exercise.perSide,
        inputType:
          exercise.loadMode === 'none' ? ('bodyweight' as const) : ('weight_kg' as const),
        status,
        load: null,
        band: null,
        result: status === 'completed' ? 12 : null,
        updatedAt: 1,
      }
    }),
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
    touchedAt: sets.some((set) => set.status !== 'pending') ? 2 : null,
  })
}

async function openSession(sessionId = 'monday') {
  const u = user()
  renderApp(`/training/${sessionId}`)
  await screen.findByRole('heading', { level: 1 })
  return u
}

const focus = () =>
  document.querySelector('[data-focused-workout]') as HTMLElement | null

/* ------------------------------------------------------------------ */
/* 1. Which exercise it opens on                                       */
/* ------------------------------------------------------------------ */

describe('1. the opening exercise is derived, never guessed', () => {
  it('opens on the first exercise when nothing has been logged', async () => {
    seedStarted('monday')
    const u = await openSession()
    await u.click(await screen.findByRole('button', { name: 'Continue workout' }))

    const panel = within(focus() as HTMLElement)
    expect(panel.getByText('Exercise 1 of 5')).toBeInTheDocument()
    expect(panel.getByRole('heading', { level: 2 })).toHaveTextContent('Lat Pulldown')
    expect(panel.getByText('Set 1')).toBeInTheDocument()
  })

  it('opens on the exercise holding the first PENDING set, not the first exercise', async () => {
    // Lat Pulldown is finished; One-Arm DB Row is where the workout actually is.
    seedStarted('monday', (exerciseOrder) =>
      exerciseOrder === 0 ? 'completed' : 'pending',
    )
    const u = await openSession()
    await u.click(await screen.findByRole('button', { name: 'Continue workout' }))

    const panel = within(focus() as HTMLElement)
    expect(panel.getByText('Exercise 2 of 5')).toBeInTheDocument()
    expect(panel.getByRole('heading', { level: 2 })).toHaveTextContent('One-Arm DB Row')
  })

  it('opens on the first pending SET within that exercise', async () => {
    // Two of Lat Pulldown's four sets are done; one was skipped.
    seedStarted('monday', (exerciseOrder, setIndex) => {
      if (exerciseOrder !== 0) return 'pending'
      if (setIndex === 0) return 'completed'
      if (setIndex === 1) return 'skipped'
      return 'pending'
    })
    const u = await openSession()
    await u.click(await screen.findByRole('button', { name: 'Continue workout' }))

    const panel = within(focus() as HTMLElement)
    expect(panel.getByText('Exercise 1 of 5')).toBeInTheDocument()
    expect(panel.getByText('Set 3')).toBeInTheDocument()
    expect(panel.getByText('Current set')).toBeInTheDocument()
    // A skip is never a smaller success, in this surface either.
    expect(panel.getByText('Not a completed set')).toBeInTheDocument()
  })

  it('skips over a fully SKIPPED exercise, because skipped is resolved', async () => {
    seedStarted('monday', (exerciseOrder) => (exerciseOrder === 0 ? 'skipped' : 'pending'))
    const u = await openSession()
    await u.click(await screen.findByRole('button', { name: 'Continue workout' }))

    expect(
      within(focus() as HTMLElement).getByRole('heading', { level: 2 }),
    ).toHaveTextContent('One-Arm DB Row')
  })
})

/* ------------------------------------------------------------------ */
/* 2. Entering writes nothing                                          */
/* ------------------------------------------------------------------ */

describe('2. entering focused mode is a read', () => {
  it('makes no write of any kind', async () => {
    seedStarted('monday')
    const u = await openSession()
    await screen.findByRole('button', { name: 'Continue workout' })

    const before = server.calls.length
    await u.click(screen.getByRole('button', { name: 'Continue workout' }))
    await screen.findByText('Exercise 1 of 5')

    // Reads are fine. Nothing else is.
    const after = server.calls.slice(before)
    expect(after.every((call) => call.method === 'GET')).toBe(true)
  })

  it('leaves the stored workout byte-for-byte as it was', async () => {
    seedStarted('monday')
    const u = await openSession()
    const before = JSON.stringify(server.workouts.get(`${DATE}#monday`))

    await u.click(await screen.findByRole('button', { name: 'Continue workout' }))
    await screen.findByText('Exercise 1 of 5')

    expect(JSON.stringify(server.workouts.get(`${DATE}#monday`))).toBe(before)
  })

  it('goes back to the overview without writing either', async () => {
    seedStarted('monday')
    const u = await openSession()
    await u.click(await screen.findByRole('button', { name: 'Continue workout' }))

    const before = server.calls.length
    await u.click(screen.getByRole('button', { name: 'Back to all exercises' }))

    await screen.findByText('Resume workout')
    expect(focus()).toBeNull()
    expect(server.calls.slice(before).every((call) => call.method === 'GET')).toBe(true)
  })
})

/* ------------------------------------------------------------------ */
/* 3. A finished workout has no current set to invent                  */
/* ------------------------------------------------------------------ */

describe('3. nothing left to log', () => {
  it('offers no way into focused mode once every set is resolved', async () => {
    seedStarted('monday', () => 'completed')
    await openSession()

    expect(await screen.findByText('Every set is resolved')).toBeInTheDocument()
    // There is no current set for it to open, so it is not offered.
    expect(screen.queryByRole('button', { name: 'Continue workout' })).toBeNull()
  })

  it('says the workout is complete rather than showing an empty set', async () => {
    // One pending set left, everywhere else resolved.
    seedStarted('monday', (exerciseOrder, setIndex) =>
      exerciseOrder === 0 && setIndex === 0 ? 'pending' : 'completed',
    )
    const u = await openSession()
    await u.click(await screen.findByRole('button', { name: 'Continue workout' }))

    const panel = within(focus() as HTMLElement)
    await u.click(panel.getByRole('button', { name: 'Skip' }))

    await waitFor(() =>
      expect(
        within(focus() as HTMLElement).getAllByText('Workout complete').length,
      ).toBeGreaterThan(0),
    )
    const done = within(focus() as HTMLElement)
    expect(done.queryByRole('button', { name: 'Complete set' })).toBeNull()
    expect(done.queryByText('Current set')).toBeNull()
    expect(done.getByText(/Every set in this workout is resolved/)).toBeInTheDocument()
  })
})

/* ------------------------------------------------------------------ */
/* 4. The controls are the frozen modality's, unchanged                */
/* ------------------------------------------------------------------ */

describe('4. modality-correct controls', () => {
  /** Start through the real button so the account's input types are frozen in. */
  async function startAndFocus() {
    const u = await openSession()
    await u.click(await screen.findByRole('button', { name: 'Start workout' }))
    await screen.findByText('Resume workout')
    await u.click(await screen.findByRole('button', { name: 'Continue workout' }))
    await screen.findByText('Exercise 1 of 5')
    return u
  }

  it('says per dumbbell for a kg_each exercise, and records kilograms', async () => {
    const u = await startAndFocus()

    // One-Arm DB Row is the dumbbell lift on Monday.
    await u.click(screen.getByRole('button', { name: 'Next exercise: One-Arm DB Row' }))
    const panel = within(focus() as HTMLElement)

    expect(panel.getByRole('heading', { level: 2 })).toHaveTextContent('One-Arm DB Row')
    const load = panel.getByLabelText('Load (kg each)')
    expect(load).toBeInTheDocument()
    // Never a combined weight, and it says so where the number is typed.
    expect(panel.getByText('Per dumbbell — never a combined weight.')).toBeInTheDocument()
    // Never prefilled: a default would be a weight the user did not lift.
    expect(load).toHaveValue('')

    await u.type(load, '22.5')
    await u.type(panel.getByLabelText('Reps'), '10')
    await u.click(panel.getByRole('button', { name: 'Complete set' }))

    await waitFor(() => {
      const stored = server.workouts.get(`${DATE}#monday`)!.sets.find(
        (set) => set.exerciseOrder === 1 && set.setIndex === 0,
      )!
      expect(stored.status).toBe('completed')
      expect(stored.load).toEqual({ value: 22.5, unit: 'kg_each' })
      expect(stored.band).toBeNull()
    })
  })

  it('gives a band set a label and a count, and NO kilogram field', async () => {
    server.setInputType('lat-pulldown', 'resistance_band')
    const u = await startAndFocus()
    const panel = within(focus() as HTMLElement)

    expect(panel.getByRole('heading', { level: 2 })).toHaveTextContent('Lat Pulldown')
    expect(panel.getByLabelText('Band')).toBeInTheDocument()
    expect(panel.getByLabelText('How many')).toBeInTheDocument()
    // A band is a label and a count. There is nowhere to invent kilograms.
    expect(panel.queryByLabelText(/^Load \(/)).toBeNull()

    await u.type(panel.getByLabelText('Band'), 'Black')
    await u.type(panel.getByLabelText('How many'), '3')
    await u.type(panel.getByLabelText('Reps'), '12')
    await u.click(panel.getByRole('button', { name: 'Complete set' }))

    await waitFor(() => {
      const stored = server.workouts.get(`${DATE}#monday`)!.sets[0]
      expect(stored.status).toBe('completed')
      expect(stored.band).toEqual({ label: 'Black', count: 3 })
      // The count is NOT a weight. This is the exact bug that made "12 reps ·
      // 3kg" out of three black bands.
      expect(stored.load).toBeNull()
    })
  })

  it('refuses half a band answer', async () => {
    server.setInputType('lat-pulldown', 'resistance_band')
    const u = await startAndFocus()
    const panel = within(focus() as HTMLElement)

    await u.type(panel.getByLabelText('Reps'), '12')
    await u.type(panel.getByLabelText('Band'), 'Black')
    // Which band, but not how many: an unreadable record, not a smaller one.
    expect(panel.getByRole('button', { name: 'Complete set' })).toBeDisabled()

    await u.type(panel.getByLabelText('How many'), '2')
    expect(panel.getByRole('button', { name: 'Complete set' })).toBeEnabled()
  })

  it('gives a bodyweight set no load field at all', async () => {
    server.setInputType('face-pull', 'bodyweight')
    const u = await startAndFocus()

    await u.click(screen.getByRole('button', { name: 'Next exercise: One-Arm DB Row' }))
    await u.click(screen.getByRole('button', { name: 'Next exercise: Face Pull' }))
    const panel = within(focus() as HTMLElement)

    expect(panel.getByRole('heading', { level: 2 })).toHaveTextContent('Face Pull')
    // Bodyweight invents no kilograms, and no band either.
    expect(panel.queryByLabelText(/^Load \(/)).toBeNull()
    expect(panel.queryByLabelText('Band')).toBeNull()
    expect(panel.queryByLabelText('How many')).toBeNull()
    // Reps are still recorded — the refusal is about resistance, not about the set.
    expect(panel.getByLabelText('Reps')).toBeInTheDocument()

    await u.type(panel.getByLabelText('Reps'), '15')
    await u.click(panel.getByRole('button', { name: 'Complete set' }))

    await waitFor(() => {
      const stored = server.workouts.get(`${DATE}#monday`)!.sets.find(
        (set) => set.exerciseOrder === 2 && set.setIndex === 0,
      )!
      expect(stored.status).toBe('completed')
      expect(stored.result).toBe(15)
      expect(stored.load).toBeNull()
      expect(stored.band).toBeNull()
    })
  })
})

/* ------------------------------------------------------------------ */
/* 5. The workspace itself                                             */
/* ------------------------------------------------------------------ */

describe('5. the workspace', () => {
  it('stands the mobile navigation down so Complete set owns the bottom', async () => {
    const bottomNav = () => document.querySelector('[data-bottom-nav]')

    seedStarted('monday')
    const u = await openSession()
    expect(bottomNav()).not.toBeNull()

    await u.click(await screen.findByRole('button', { name: 'Continue workout' }))
    // Two targets a few pixels apart, pressed one-handed mid-set, is a mis-tap
    // that costs the user their place in the workout.
    await waitFor(() => expect(bottomNav()).toBeNull())
    // The tablet rail and the desktop sidebar are not competing for that space
    // and are left exactly where they are.
    expect(document.querySelectorAll('nav[aria-label="Primary"]').length).toBe(2)

    await u.click(screen.getByRole('button', { name: 'Back to all exercises' }))
    await waitFor(() => expect(bottomNav()).not.toBeNull())
  })

  it('reports completed and skipped separately, never added together', async () => {
    seedStarted('monday', (exerciseOrder, setIndex) => {
      if (exerciseOrder !== 0) return 'pending'
      return setIndex === 0 ? 'completed' : setIndex === 1 ? 'skipped' : 'pending'
    })
    const u = await openSession()
    await u.click(await screen.findByRole('button', { name: 'Continue workout' }))

    const panel = within(focus() as HTMLElement)
    expect(panel.getByText('2 / 15 sets resolved')).toBeInTheDocument()
    expect(panel.getByText('1 completed · 1 skipped')).toBeInTheDocument()
  })

  it('does not move the exercise out from under you when one finishes', async () => {
    // Only Lat Pulldown's last set is left.
    seedStarted('monday', (exerciseOrder, setIndex) =>
      exerciseOrder === 0 && setIndex < 3 ? 'completed' : 'pending',
    )
    const u = await openSession()
    await u.click(await screen.findByRole('button', { name: 'Continue workout' }))

    await u.type(within(focus() as HTMLElement).getByLabelText('Reps'), '12')
    await u.click(within(focus() as HTMLElement).getByRole('button', { name: 'Complete set' }))

    // Still on Lat Pulldown, with Undo reachable — the next exercise is OFFERED,
    // not performed.
    await waitFor(() =>
      expect(within(focus() as HTMLElement).getByText('Lat Pulldown is done')).toBeInTheDocument(),
    )
    const panel = within(focus() as HTMLElement)
    expect(panel.getByText('Exercise 1 of 5')).toBeInTheDocument()
    expect(panel.getByRole('button', { name: 'Undo Set 4' })).toBeInTheDocument()
    expect(
      panel.getByRole('button', { name: 'Next exercise: One-Arm DB Row' }),
    ).toBeInTheDocument()
  })

  it('keeps the accordion overview intact behind it', async () => {
    seedStarted('monday')
    const u = await openSession()
    await u.click(await screen.findByRole('button', { name: 'Continue workout' }))
    await u.click(screen.getByRole('button', { name: 'Back to all exercises' }))

    // The session overview is not replaced by focused mode; it is the other
    // half of the same screen, and its disclosure contract is untouched.
    const trigger = await screen.findByRole('button', { name: /Lat Pulldown/ })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await u.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
  })
})
