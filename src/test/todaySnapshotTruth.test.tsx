import { cleanup, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { authenticatedSession, mockAuthFetch, renderApp } from './authTestUtils'
import { createProgrammeServer, type ProgrammeServer } from './programmeApiTestUtils'
import { createWorkoutServer, type WorkoutServer } from './workoutApiTestUtils'
import { foundationProgramme } from '@shared/programme/foundation'
import { planExercises } from '@shared/programme/plan'
import { FOUNDATION_SESSION_META, type Programme } from '@shared/programme/programme'
import { inputTypeForLegacyLoadMode } from '@shared/workoutLog'

/**
 * ROUND 24 CORRECTION — TODAY MUST NOT MIX A LIVE PROGRAMME WITH A FROZEN
 * WORKOUT.
 *
 * The contradiction this pins was visible on one card: Today's training hero
 * said "4 exercises · 11 sets to log" while, two lines below, its own progress
 * rail said "6 / 15 sets resolved". Both numbers were real. Neither described
 * the same thing.
 *
 * `TodayPage` derived the hero's focus, intensity and counts from the CURRENT
 * programme, while `useScheduledStarted` derived progress from the STARTED
 * workout. Before Start those two agree, so the bug is invisible; the moment
 * the programme is edited after a Start they diverge, and the card presents
 * the difference as one coherent workout.
 *
 * A started workout is frozen historical truth. Editing Monday's programme
 * does not retroactively make the workout you began this morning shorter, and
 * a screen that says otherwise is not a cosmetic problem — it is the app
 * telling the user something false about training they have already done.
 *
 * THE RULE, in one line: before Start, Today describes the programme; after
 * Start, Today describes the snapshot, and the programme may not relabel or
 * resize it.
 */

/** A real Wednesday, so the day plans a session and the hero is rendered. */
const WEDNESDAY = new Date(2026, 8, 9, 9, 0)
const DATE = '2026-09-09'

let programme: ProgrammeServer
let workouts: WorkoutServer

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(WEDNESDAY)
  programme = createProgrammeServer()
  workouts = createWorkoutServer()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

/* ------------------------------------------------------------------ */
/* The two programmes, and the workout frozen from the first           */
/* ------------------------------------------------------------------ */

/** Wednesday at revision N: FIVE exercises, FIFTEEN sets. */
function wednesdayBefore(): Programme {
  const seed = foundationProgramme()
  const counts: Record<string, number> = {
    'lat-pulldown': 4,
    'face-pull': 3,
    'rear-delt-fly': 3,
    'dead-bug': 3,
    plank: 2,
  }
  return {
    ...seed,
    revision: 4,
    sessions: {
      ...seed.sessions,
      wednesday: seed.sessions.wednesday.map((slot) => ({
        ...slot,
        setCount: counts[slot.exerciseId] ?? slot.setCount,
      })),
    },
  }
}

/** Wednesday at revision N+1: FOUR exercises, ELEVEN sets. Lat Pulldown gone. */
function wednesdayAfter(): Programme {
  const before = wednesdayBefore()
  return {
    ...before,
    revision: before.revision + 1,
    sessions: {
      ...before.sessions,
      wednesday: before.sessions.wednesday
        .filter((slot) => slot.exerciseId !== 'lat-pulldown')
        .map((slot, index) => ({ ...slot, position: index + 1 })),
    },
  }
}

/**
 * Freeze a Wednesday workout from the programme as it stood at revision N,
 * then resolve six of its fifteen sets: five completed, one skipped.
 *
 * Built with the same `planExercises` the server builds a Start snapshot with,
 * so the seeded snapshot is the one a real Start would have written.
 */
function seedStartedWednesday(source: Programme) {
  const plan = planExercises(source, 'wednesday')
  let resolvedSoFar = 0
  const sets = plan.flatMap((exercise, exerciseOrder) =>
    Array.from({ length: exercise.setCount }, (_unused, setIndex) => {
      // Five completed, then one skipped, then everything else pending.
      const rank = resolvedSoFar
      resolvedSoFar += 1
      const status = rank < 5 ? 'completed' : rank === 5 ? 'skipped' : 'pending'
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
        inputType: inputTypeForLegacyLoadMode(exercise.loadMode),
        status: status as 'completed' | 'skipped' | 'pending',
        load: null,
        band: null,
        result: status === 'completed' ? 12 : null,
        updatedAt: 2,
      }
    }),
  )

  const meta = FOUNDATION_SESSION_META.wednesday
  workouts.seed(DATE, 'wednesday', {
    occurrence: {
      date: DATE,
      sessionId: 'wednesday',
      day: meta.day,
      focus: meta.focus,
      intensity: meta.intensity,
      startedAt: 1,
      updatedAt: 2,
    },
    sets,
    touchedAt: 2,
  })
  return { exercises: plan.length, sets: sets.length }
}

async function renderToday() {
  mockAuthFetch({ session: authenticatedSession, programme, workouts })
  const u = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  const router = renderApp('/today')
  await screen.findByRole('heading', { name: 'Today', level: 1 })
  await waitFor(() =>
    expect(screen.queryByText(/Loading your saved progress/)).not.toBeInTheDocument(),
  )
  return { u, router }
}

/* ------------------------------------------------------------------ */
/* 1. Before Start — the programme IS the truth                        */
/* ------------------------------------------------------------------ */

describe('1. before Start, Today describes the current programme', () => {
  it('shows the current programme’s exercise and set counts', async () => {
    programme.setProgramme(wednesdayBefore())
    await renderToday()

    await screen.findByText('5 exercises')
    expect(screen.getByText('15 sets to log')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /^Start / })).toBeInTheDocument()
    // Nothing is in progress, so no progress is claimed.
    expect(screen.queryByText(/sets resolved/)).toBeNull()
  })

  it('follows the programme when it changes and nothing has been started', async () => {
    programme.setProgramme(wednesdayAfter())
    await renderToday()

    await screen.findByText('4 exercises')
    expect(screen.getByText('11 sets to log')).toBeInTheDocument()
  })
})

/* ------------------------------------------------------------------ */
/* 2. After Start — the SNAPSHOT is the truth                          */
/* ------------------------------------------------------------------ */

describe('2. after Start, Today describes the started workout', () => {
  it('keeps the frozen counts when the programme has shrunk underneath it', async () => {
    // A. Wednesday at revision N: 5 exercises, 15 sets.
    const frozen = seedStartedWednesday(wednesdayBefore())
    expect(frozen).toEqual({ exercises: 5, sets: 15 })

    // B + C. Started, and six sets resolved.
    // D. The programme is then edited to revision N+1: 4 exercises, 11 sets.
    programme.setProgramme(wednesdayAfter())

    // E. Open Today.
    await renderToday()

    // It is in progress, and the progress is the workout's own.
    expect(await screen.findByText('In progress')).toBeInTheDocument()
    expect(
      screen.getByText(/6 \/ 15 sets resolved · 5 completed · 1 skipped/),
    ).toBeInTheDocument()

    // THE POINT OF THE TEST. The card describes the workout that was started,
    // not the programme as it stands now.
    expect(screen.getByText('5 exercises')).toBeInTheDocument()
    expect(screen.getByText('15 sets')).toBeInTheDocument()

    // And never the new programme's numbers presented as this workout.
    expect(screen.queryByText('4 exercises')).toBeNull()
    expect(screen.queryByText('11 sets to log')).toBeNull()
    expect(screen.queryByText('11 sets')).toBeNull()
  })

  it('keeps the frozen focus and intensity', async () => {
    seedStartedWednesday(wednesdayBefore())
    const renamed = wednesdayAfter()
    programme.setProgramme(renamed)
    await renderToday()

    await screen.findByText('In progress')
    // The stored occurrence's own identity, which a programme edit cannot move.
    expect(
      screen.getByRole('heading', { level: 2, name: 'Light Back + Rear Delts + Core' }),
    ).toBeInTheDocument()
  })

  it('offers Continue, and it opens the frozen workout', async () => {
    seedStartedWednesday(wednesdayBefore())
    programme.setProgramme(wednesdayAfter())
    const { u } = await renderToday()

    const cont = await screen.findByRole('link', { name: /^Continue / })
    await u.click(cont)

    // The session page renders the SNAPSHOT: Lat Pulldown is still in this
    // workout even though the programme no longer lists it on Wednesday.
    expect(await screen.findByText('Resume workout')).toBeInTheDocument()
    expect(
      screen.getByText(/Workout in progress · 6 \/ 15 sets resolved/),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Lat Pulldown/ })).toBeInTheDocument()
  })

  it('states nothing rather than borrowing the programme’s counts', async () => {
    /*
     * FAIL CLOSED. A started occurrence whose snapshot carries no rows: the
     * workout exists, but its size cannot be established from it.
     *
     * The tempting fallback is the current programme's counts — they are right
     * there, and they would make the card look complete. They would also be a
     * confident description of a workout they are not about. An unstated count
     * is a gap; a borrowed one is a lie with a progress bar under it.
     */
    const meta = FOUNDATION_SESSION_META.wednesday
    workouts.seed(DATE, 'wednesday', {
      occurrence: {
        date: DATE,
        sessionId: 'wednesday',
        day: meta.day,
        focus: meta.focus,
        intensity: meta.intensity,
        startedAt: 1,
        updatedAt: 1,
      },
      sets: [],
    })
    programme.setProgramme(wednesdayAfter())
    await renderToday()

    expect(await screen.findByText(/size could not be read/i)).toBeInTheDocument()
    // Not the programme's numbers under a started heading.
    expect(screen.queryByText('4 exercises')).toBeNull()
    expect(screen.queryByText('11 sets to log')).toBeNull()
    expect(screen.queryByText('11 sets')).toBeNull()
    // The workout's own identity is still stated — that part IS known.
    expect(
      screen.getByRole('heading', { level: 2, name: 'Light Back + Rear Delts + Core' }),
    ).toBeInTheDocument()
  })

  it('writes nothing merely by rendering Today', async () => {
    seedStartedWednesday(wednesdayBefore())
    programme.setProgramme(wednesdayAfter())
    await renderToday()
    await screen.findByText('In progress')

    const writes = [...workouts.calls, ...programme.calls].filter(
      (call) => call.method !== 'GET',
    )
    expect(writes).toEqual([])
  })
})
