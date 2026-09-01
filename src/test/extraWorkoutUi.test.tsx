import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getSession } from '@/features/training/sessions'
import { buildWorkoutPlan, toStartPayload } from '@/features/training/workoutPlan'
import { authenticatedSession, mockAuthFetch, renderApp } from './authTestUtils'
import { createProgressionServer, type ProgressionServer } from './progressionApiTestUtils'
import { createWorkoutServer, type WorkoutServer } from './workoutApiTestUtils'

/**
 * Round 17 — the Extra Workout page, end to end in the real app.
 *
 * The real router, the real pages, the real client and the real hooks run
 * against the in-memory stand-ins. What these defend:
 *
 *   - looking at a template writes nothing
 *   - Start freezes the snapshot, and a later change to the Foundation source
 *     does not rewrite it
 *   - the same day resumes rather than creating a second Extra
 *   - no progression request is ever made from this flow, and no calibration
 *     control is ever rendered
 *   - Training gains an entry but the app gains no top-level destination
 */

/** 2026-09-02 is a Wednesday. */
const TODAY = new Date(2026, 8, 2, 9, 0)
const DATE = '2026-09-02'

let workouts: WorkoutServer
let progression: ProgressionServer

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(TODAY)
  workouts = createWorkoutServer()
  progression = createProgressionServer(workouts)
  mockAuthFetch({ session: authenticatedSession, workouts, progression })
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function user() {
  return userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
}

/** Seed an Extra as if it had already been started from `source`. */
function seedStartedExtra(source: string, date = DATE) {
  const session = getSession(source)!
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

  workouts.seed(date, 'extra', {
    occurrence: {
      date,
      sessionId: 'extra',
      sourceSessionId: source,
      day: session.day,
      focus: session.focus,
      intensity: session.intensity,
      startedAt: 1,
      updatedAt: 1,
    },
    sets,
  })
}

async function openExtra() {
  renderApp('/training/extra')
  await screen.findByRole('heading', { level: 1 })
}

/* ------------------------------------------------------------------ */
/* 1. Preview writes nothing                                           */
/* ------------------------------------------------------------------ */

describe('1. choosing and previewing a template writes nothing', () => {
  it('creates no occurrence however much the user changes their mind', async () => {
    await openExtra()
    await screen.findByRole('radio', { name: /Monday/ })

    await user().click(screen.getByRole('radio', { name: /Thursday/ }))
    await user().click(screen.getByRole('radio', { name: /Tuesday/ }))
    await user().click(screen.getByRole('radio', { name: /Monday/ }))

    // The preview reflects the choice…
    expect(await screen.findByText(/Lat Pulldown/)).toBeInTheDocument()
    // …and the server has been asked for nothing but the initial read.
    expect(workouts.workouts.size).toBe(0)
    expect(workouts.calls.filter((call) => call.method !== 'GET')).toHaveLength(0)
  })

  it('says plainly that nothing is recorded yet', async () => {
    await openExtra()
    expect(
      await screen.findByText(/nothing is recorded until you start/i),
    ).toBeInTheDocument()
  })
})

/* ------------------------------------------------------------------ */
/* 2. Start                                                            */
/* ------------------------------------------------------------------ */

describe('2. Start clones the chosen Foundation session', () => {
  it('creates one extra occurrence carrying its source', async () => {
    await openExtra()
    await screen.findByRole('radio', { name: /Monday/ })

    await user().click(screen.getByRole('radio', { name: /Monday/ }))
    await user().click(screen.getByRole('button', { name: /Start extra workout/i }))

    await waitFor(() => expect(workouts.workouts.size).toBe(1))

    const stored = workouts.workouts.get(`${DATE}#extra`)
    expect(stored?.occurrence.kind).toBe('extra')
    expect(stored?.occurrence.sourceSessionId).toBe('monday')
    expect(stored?.occurrence.focus).toBe('Back Width + Biceps')
    // The set structure the template implies, not an invented one.
    expect(stored?.sets).toHaveLength(15)
  })

  it('sends the source session in the start payload', async () => {
    await openExtra()
    await screen.findByRole('radio', { name: /Tuesday/ })

    await user().click(screen.getByRole('radio', { name: /Tuesday/ }))
    await user().click(screen.getByRole('button', { name: /Start extra workout/i }))

    await waitFor(() => expect(workouts.workouts.size).toBe(1))
    expect(workouts.workouts.get(`${DATE}#extra`)?.occurrence.sourceSessionId).toBe('tuesday')
  })
})

/* ------------------------------------------------------------------ */
/* 4 + 17. Resume, and the frozen snapshot                             */
/* ------------------------------------------------------------------ */

describe('4/17. an existing Extra resumes and cannot be re-templated', () => {
  it('offers Resume, names the frozen source, and shows no picker', async () => {
    seedStartedExtra('monday')
    await openExtra()

    expect(await screen.findByText(/Resume extra workout/i)).toBeInTheDocument()
    // The frozen source template identity is stated.
    expect(screen.getByText(/Based on Monday · Back Width \+ Biceps/)).toBeInTheDocument()
    // And there is no way to change it.
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /Start extra workout/i }),
    ).not.toBeInTheDocument()
  })

  it('renders the stored snapshot even after the Foundation source changes', async () => {
    seedStartedExtra('monday')
    // The stored snapshot is deliberately made to disagree with today's
    // template, which is exactly what happens when a prescription is edited
    // after a workout was started.
    const stored = workouts.workouts.get(`${DATE}#extra`)!
    stored.sets[0] = {
      ...stored.sets[0],
      exerciseName: 'Lat Pulldown',
      prescription: '4 × 10–15 (as performed)',
    }

    await openExtra()

    // What is shown is what was performed, not what the template says now.
    expect(await screen.findByText(/4 × 10–15 \(as performed\)/)).toBeInTheDocument()
  })

  it('never asks to create a second Extra for the same day', async () => {
    seedStartedExtra('monday')
    await openExtra()
    await screen.findByText(/Resume extra workout/i)

    // No Start control exists at all, so there is no path to extra-2.
    expect(workouts.calls.filter((call) => call.url.includes('/start'))).toHaveLength(0)
    expect(workouts.workouts.size).toBe(1)
  })
})

/* ------------------------------------------------------------------ */
/* 16. No progression anywhere in the Extra flow                       */
/* ------------------------------------------------------------------ */

describe('16. the Extra flow exposes no progression or calibration', () => {
  it('never requests progression, before or after Start', async () => {
    await openExtra()
    await screen.findByRole('radio', { name: /Monday/ })
    await user().click(screen.getByRole('button', { name: /Start extra workout/i }))
    await waitFor(() => expect(workouts.workouts.size).toBe(1))

    await screen.findByText(/Resume extra workout/i)

    // Not "answered with nothing" — never asked at all.
    expect(progression.calls).toHaveLength(0)
  })

  it('renders no calibration or suggestion controls in an expanded exercise', async () => {
    seedStartedExtra('monday')
    await openExtra()

    const trigger = await screen.findByRole('button', { name: /Lat Pulldown/ })
    await user().click(trigger)

    // The logging controls are there…
    expect(await screen.findByText(/Prescribed/i)).toBeInTheDocument()
    // …and none of the Round 16 guidance vocabulary is.
    for (const banned of [
      /Too Light/i,
      /Too Heavy/i,
      /How did that feel/i,
      /Use suggestion/i,
      /Build reps/i,
      /Increase load/i,
      /Reduce load/i,
      /Calibrate/i,
    ]) {
      expect(screen.queryByText(banned), String(banned)).not.toBeInTheDocument()
    }
    expect(progression.calls).toHaveLength(0)
  })
})

/* ------------------------------------------------------------------ */
/* 18 + 19. Logging inside an Extra                                    */
/* ------------------------------------------------------------------ */

describe('18/19. Complete, Skip and Undo work, and kg_each stays per dumbbell', () => {
  it('completes a set and records it against the Extra occurrence', async () => {
    seedStartedExtra('monday')
    await openExtra()

    await user().click(await screen.findByRole('button', { name: /Lat Pulldown/ }))

    const reps = await screen.findAllByLabelText(/^Reps$/i)
    await user().type(reps[0], '12')
    const complete = await screen.findAllByRole('button', { name: /^Complete$/i })
    await user().click(complete[0])

    await waitFor(() => {
      const stored = workouts.workouts.get(`${DATE}#extra`)!
      expect(stored.sets[0].status).toBe('completed')
      expect(stored.sets[0].result).toBe(12)
    })
  })

  it('labels a dumbbell load as kg each, never as a combined weight', async () => {
    seedStartedExtra('monday')
    await openExtra()

    // One-Arm DB Row is the kg_each lane on Monday.
    await user().click(await screen.findByRole('button', { name: /One-Arm DB Row/ }))

    // One label per set of that exercise, each saying "each" explicitly.
    const labels = await screen.findAllByText(/Load \(kg each\)/i)
    expect(labels.length).toBeGreaterThan(0)
    // Never a combined weight, and never a bare "kg" for dumbbell work.
    expect(screen.queryByText(/kg total/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/^Load \(kg\)$/i)).not.toBeInTheDocument()
  })
})

/* ------------------------------------------------------------------ */
/* Training entry, and no new top-level destination                    */
/* ------------------------------------------------------------------ */

describe('the Training entry', () => {
  it('offers Extra workout below the Foundation week', async () => {
    renderApp('/training')
    await screen.findByRole('heading', { level: 1, name: 'Training' })

    const link = await screen.findByRole('link', { name: /Extra workout/i })
    expect(link).toHaveAttribute('href', '/training/extra')
    // It is outside the schedule, and says so.
    expect(screen.getByText(/Outside the schedule/i)).toBeInTheDocument()
  })

  it('says Resume and names the frozen source once one exists today', async () => {
    seedStartedExtra('thursday')
    renderApp('/training')
    await screen.findByRole('heading', { level: 1, name: 'Training' })

    expect(await screen.findByRole('link', { name: /Resume extra workout/i })).toBeInTheDocument()
    expect(
      screen.getByText(/In progress · based on Thursday · Back Thickness \+ Chest \+ Biceps/),
    ).toBeInTheDocument()
  })

  it('adds no top-level navigation destination', async () => {
    renderApp('/training')
    await screen.findByRole('heading', { level: 1, name: 'Training' })

    const nav = screen.getAllByRole('navigation')[0]
    const destinations = within(nav)
      .getAllByRole('link')
      .map((link) => link.getAttribute('href'))

    // The accepted six, unchanged. Extra lives inside Training.
    expect(destinations).toEqual([
      '/today',
      '/training',
      '/progress',
      '/calendar',
      '/achievements',
      '/settings',
    ])
    expect(destinations).not.toContain('/training/extra')
  })
})

/* ------------------------------------------------------------------ */
/* 12. Progress shows the provenance                                   */
/* ------------------------------------------------------------------ */

describe('12. Recent workouts marks an Extra as an Extra', () => {
  it('labels the row and does not present it as the scheduled session', async () => {
    seedStartedExtra('monday')
    const stored = workouts.workouts.get(`${DATE}#extra`)!
    stored.sets = stored.sets.map((set) => ({ ...set, status: 'completed' as const, result: 12 }))

    renderApp('/progress')
    await screen.findByRole('heading', { level: 1, name: 'Progress' })

    const history = await screen.findByText(/Recent workouts/i)
    const card = history.closest('div')!

    expect(within(card).getByText('Extra')).toBeInTheDocument()
    expect(
      within(card).getByText(/extra, not the scheduled session/i),
    ).toBeInTheDocument()
  })
})
