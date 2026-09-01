import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getSession, trainingSessions } from '@/features/training/sessions'
import { buildWorkoutPlan, toStartPayload } from '@/features/training/workoutPlan'
import { authenticatedSession, mockAuthFetch, renderApp } from './authTestUtils'
import { createProgressionServer, type ProgressionServer } from './progressionApiTestUtils'
import { createWorkoutServer, type WorkoutServer } from './workoutApiTestUtils'

/**
 * Round 17 correction 1 — findings 1 and 2.
 *
 * FINDING 1. "Extra Workout is CURRENT LOCAL DAY only" was enforced by reading
 * the date once at mount, which is only true until midnight. Open the chooser
 * at 23:58, cross into the next day, press Start at 00:05, and the workout was
 * filed under YESTERDAY — a day the user did not train on.
 *
 * The fix follows the accepted `useLocalToday` pattern: one armed timeout for
 * the next local midnight, plus a resync when the tab becomes visible or
 * regains focus so a slept-through timer is harmless. A workout that has
 * already STARTED is pinned to its own date instead, because the sets logged
 * against it happened then and history is not moved.
 *
 * FINDING 2. A started Extra described itself by looking its source slug up in
 * the CURRENT Foundation week, so renaming Monday would have silently rewritten
 * what an already-recorded workout said it was. Framing now comes from the
 * frozen snapshot.
 */

/** 2026-09-02 is a Wednesday; 2026-09-03 the Thursday after it. */
const BEFORE_MIDNIGHT = new Date(2026, 8, 2, 23, 58, 0)
const AFTER_MIDNIGHT = new Date(2026, 8, 3, 0, 5, 0)
const D1 = '2026-09-02'
const D2 = '2026-09-03'

let workouts: WorkoutServer
let progression: ProgressionServer

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(BEFORE_MIDNIGHT)
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

/** Move the clock over midnight and let the armed timeout fire. */
async function crossMidnight() {
  await act(async () => {
    vi.setSystemTime(AFTER_MIDNIGHT)
    // Past the 23:58 -> 00:00:00.250 wait the helper arms.
    await vi.advanceTimersByTimeAsync(3 * 60 * 1000)
  })
}

/** Move the clock WITHOUT letting timers fire — a slept tab. */
function sleepPastMidnight() {
  vi.setSystemTime(AFTER_MIDNIGHT)
}

async function wake(event: 'visibilitychange' | 'focus') {
  await act(async () => {
    if (event === 'focus') window.dispatchEvent(new Event('focus'))
    else document.dispatchEvent(new Event('visibilitychange'))
    await Promise.resolve()
  })
}

/** Seed a started Extra on `date`, sourced from `source`. */
function seedStartedExtra(date: string, source: string) {
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

/** Which dates the client has asked about, in order. */
function readDates(): string[] {
  return workouts.calls
    .filter((call) => call.method === 'GET' && call.url.includes('/extra'))
    .map((call) => call.url.split('/api/workouts/')[1].split('/')[0])
}

/* ------------------------------------------------------------------ */
/* Finding 1 — the Extra page                                          */
/* ------------------------------------------------------------------ */

describe('finding 1: an unstarted Extra follows the current local day', () => {
  it('1-5. crossing midnight moves the identity, and Start writes only the new day', async () => {
    renderApp('/training/extra')
    await screen.findByRole('radio', { name: /Monday/ })

    // 1 + 2. Opened before midnight, so the first read is yesterday's date.
    expect(readDates()).toContain(D1)
    expect(workouts.workouts.size).toBe(0)

    await crossMidnight()

    // 3. The identity followed the clock without a reload.
    await waitFor(() => expect(readDates()).toContain(D2))

    // 4. Start now writes the day the workout is actually being performed on.
    await user().click(screen.getByRole('button', { name: /Start extra workout/i }))
    await waitFor(() => expect(workouts.workouts.size).toBe(1))

    expect(workouts.workouts.has(`${D2}#extra`)).toBe(true)
    // 5. And yesterday received nothing at all — this is the bug itself.
    expect(workouts.workouts.has(`${D1}#extra`)).toBe(false)

    const writes = workouts.calls.filter((call) => call.method === 'POST')
    expect(writes).toHaveLength(1)
    expect(writes[0].url).toContain(`/api/workouts/${D2}/extra/start`)
    expect(writes[0].url).not.toContain(D1)
  })

  it('6a. a slept tab resyncs on visibilitychange', async () => {
    renderApp('/training/extra')
    await screen.findByRole('radio', { name: /Monday/ })
    expect(readDates()).toContain(D1)

    // The timer never fired — a closed laptop, or a backgrounded tab.
    sleepPastMidnight()
    expect(readDates()).not.toContain(D2)

    await wake('visibilitychange')
    await waitFor(() => expect(readDates()).toContain(D2))
  })

  it('6b. a slept tab resyncs on focus', async () => {
    renderApp('/training/extra')
    await screen.findByRole('radio', { name: /Monday/ })

    sleepPastMidnight()
    await wake('focus')
    await waitFor(() => expect(readDates()).toContain(D2))
  })

  it('does not churn when the day has not actually changed', async () => {
    renderApp('/training/extra')
    await screen.findByRole('radio', { name: /Monday/ })
    const before = readDates().length

    // A resync that finds the same date must be a no-op, not a refetch loop.
    await wake('focus')
    await wake('visibilitychange')

    expect(readDates()).toHaveLength(before)
  })
})

describe('finding 1: a STARTED Extra stays bound to its own date', () => {
  it('7. does not migrate across midnight mid-session', async () => {
    seedStartedExtra(D1, 'monday')

    renderApp('/training/extra')
    await screen.findByText(/Resume extra workout/i)
    expect(readDates()).toContain(D1)

    await crossMidnight()

    // Still the SAME occurrence: the sets logged against it happened
    // yesterday, and history is never moved or copied across dates.
    await screen.findByText(/Resume extra workout/i)
    expect(readDates()).not.toContain(D2)
    expect(workouts.workouts.size).toBe(1)
    expect(workouts.workouts.has(`${D1}#extra`)).toBe(true)
    expect(workouts.workouts.has(`${D2}#extra`)).toBe(false)

    // And nothing was written by the rollover.
    expect(workouts.calls.filter((call) => call.method !== 'GET')).toHaveLength(0)
  })
})

/* ------------------------------------------------------------------ */
/* Finding 1 — the Training entry                                      */
/* ------------------------------------------------------------------ */

describe('finding 1: the Training entry follows the current local day', () => {
  it('stops claiming yesterday’s Extra is in progress once the day turns', async () => {
    seedStartedExtra(D1, 'monday')

    renderApp('/training')
    await screen.findByRole('heading', { level: 1, name: 'Training' })
    expect(await screen.findByRole('link', { name: /Resume extra workout/i })).toBeInTheDocument()

    await crossMidnight()

    // Today has no Extra yet, so the card goes back to offering one rather
    // than pointing at a workout performed on a different day.
    await waitFor(() =>
      expect(screen.getByRole('link', { name: /Extra workout/i })).toBeInTheDocument(),
    )
    expect(screen.queryByRole('link', { name: /Resume extra workout/i })).not.toBeInTheDocument()
    expect(readDates()).toContain(D2)
  })
})

/* ------------------------------------------------------------------ */
/* Finding 2 — frozen source identity                                  */
/* ------------------------------------------------------------------ */

describe('finding 2: a started Extra keeps the identity it was started with', () => {
  /** Rename the CURRENT Foundation template, as a later round might. */
  function renameMonday(day: string, focus: string) {
    const monday = trainingSessions.find((session) => session.id === 'monday')!
    const original = { day: monday.day, focus: monday.focus }
    monday.day = day
    monday.focus = focus
    return () => {
      monday.day = original.day
      monday.focus = original.focus
    }
  }

  it('1-3. resume still shows the ORIGINAL persisted source identity', async () => {
    // 1. Started and stored while Monday was "Back Width + Biceps".
    seedStartedExtra(D1, 'monday')

    // 2. Foundation is later re-authored.
    const restore = renameMonday('Monday', 'Pull Strength')
    try {
      renderApp('/training/extra')
      await screen.findByText(/Resume extra workout/i)

      // 3. History still says what it was.
      expect(
        screen.getByText(/Based on Monday · Back Width \+ Biceps/),
      ).toBeInTheDocument()
      expect(screen.queryByText(/Pull Strength/)).not.toBeInTheDocument()
    } finally {
      restore()
    }
  })

  it('the Training entry also uses the frozen identity', async () => {
    seedStartedExtra(D1, 'monday')
    const restore = renameMonday('Monday', 'Pull Strength')
    try {
      renderApp('/training')
      await screen.findByRole('heading', { level: 1, name: 'Training' })
      const entry = await screen.findByRole('link', { name: /Resume extra workout/i })

      expect(
        within(entry).getByText(/In progress · based on Monday · Back Width \+ Biceps/),
      ).toBeInTheDocument()
      // Scoped to the entry: the Foundation week list above it legitimately
      // shows the RENAMED template, because that is today's plan. Only the
      // already-recorded workout must keep its original identity.
      expect(within(entry).queryByText(/Pull Strength/)).not.toBeInTheDocument()
    } finally {
      restore()
    }
  })

  it('Recent workouts describes an Extra from its snapshot, not the template', async () => {
    seedStartedExtra(D1, 'monday')
    const stored = workouts.workouts.get(`${D1}#extra`)!
    stored.sets = stored.sets.map((set) => ({
      ...set,
      status: 'completed' as const,
      result: 12,
    }))

    const restore = renameMonday('Moonday', 'Pull Strength')
    try {
      renderApp('/progress')
      await screen.findByRole('heading', { level: 1, name: 'Progress' })
      await screen.findByText(/Recent workouts/i)

      // The frozen day snapshot, and the frozen focus.
      expect(await screen.findByText(/Back Width \+ Biceps/)).toBeInTheDocument()
      expect(screen.queryByText(/Moonday/)).not.toBeInTheDocument()
      expect(screen.queryByText(/Pull Strength/)).not.toBeInTheDocument()
    } finally {
      restore()
    }
  })

  it('4. the exercise snapshot stays frozen too', async () => {
    seedStartedExtra(D1, 'monday')
    const stored = workouts.workouts.get(`${D1}#extra`)!
    stored.sets[0] = { ...stored.sets[0], prescription: '4 × 10–15 (as performed)' }

    const restore = renameMonday('Monday', 'Pull Strength')
    try {
      renderApp('/training/extra')
      await screen.findByText(/Resume extra workout/i)
      expect(await screen.findByText(/4 × 10–15 \(as performed\)/)).toBeInTheDocument()
    } finally {
      restore()
    }
  })
})
