import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { authenticatedSession, mockAuthFetch, renderApp } from './authTestUtils'
import { createProgressServer, type ProgressServer } from './progressApiTestUtils'
import { createWorkoutServer, type WorkoutServer } from './workoutApiTestUtils'

/**
 * Round 21 production correction 1 — a correction must not leave the page
 * contradicting itself.
 *
 * Observed in production at commit 6628bed: correcting a recorded set from
 * 18 reps to 16 updated the recorded row to "16 reps · CORRECTED" while
 * Personal Best and Exercise Performance, on the same screen, went on saying
 * 18. A reload showed 16. The server was right the whole time; the client
 * simply never went back for the derived truth.
 *
 * Progress owns two independent read domains — `useWorkoutHistory` and
 * `usePerformance`. RecordedWorkoutSets adopted the corrected set locally and
 * told nobody, so the domain that ranks bests across the whole of history was
 * never re-read.
 *
 * WHAT MAKES THIS TEST REAL. The performance endpoint is answered from the
 * WORKOUT STORE at the moment it is read, not from a fixture the test swaps by
 * hand. So Personal Best can only change because the correction was actually
 * persisted server-side, and the page can only show the new value because it
 * went and asked again.
 */

const TODAY = new Date(2026, 8, 7, 9, 0)
const DATE = '2026-09-02'
const SESSION = 'wednesday'

let workouts: WorkoutServer
let progress: ProgressServer

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(TODAY)
  workouts = createWorkoutServer()
  progress = createProgressServer()

  seedRecordedBandSet()
  // The whole point: derived performance is computed from what the workout
  // store holds RIGHT NOW, exactly as the real server derives it from D1.
  progress.setPerformance(() => performanceFromStore())

  mockAuthFetch({ session: authenticatedSession, workouts, progress })
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

/** One completed band set: Lat Pulldown, Black ×1, 18 reps. */
function seedRecordedBandSet() {
  workouts.seed(DATE, SESSION, {
    occurrence: {
      date: DATE,
      sessionId: SESSION,
      day: 'Wednesday',
      focus: 'Light Back + Rear Delts + Core',
      intensity: 'LIGHT',
      startedAt: 1,
      updatedAt: 5,
    },
    touchedAt: 5,
    sets: [
      {
        exerciseOrder: 0,
        setIndex: 0,
        exerciseId: 'lat-pulldown',
        exerciseName: 'Lat Pulldown',
        prescription: '2 × 15–20',
        equipment: null,
        resultKind: 'reps',
        loadMode: 'none',
        perSide: false,
        inputType: 'resistance_band',
        status: 'completed',
        load: null,
        band: { label: 'Black', count: 1 },
        result: 18,
        updatedAt: 5,
      },
    ],
  })
}

/** The stored Lat Pulldown set, read straight out of the stand-in's store. */
function storedSet() {
  const stored = workouts.workouts.get(`${DATE}#${SESSION}`)
  if (!stored) throw new Error('the seeded workout is missing from the store')
  const set = stored.sets.find((row) => row.exerciseOrder === 0 && row.setIndex === 0)
  if (!set) throw new Error('the seeded set is missing from the store')
  return set
}

/**
 * Derive the performance payload from the store, the way the Worker derives it
 * from D1: the best completed set, as it is currently recorded.
 */
function performanceFromStore() {
  const set = storedSet()
  const point = { date: DATE, sessionId: SESSION, loadValue: null, result: set.result ?? 0 }
  return {
    complete: true,
    examined: 1,
    variants: [
      {
        key: 'lat-pulldown:band:Black:1',
        exerciseId: 'lat-pulldown',
        exerciseName: 'Lat Pulldown',
        resultKind: 'reps',
        loadMode: 'none',
        perSide: false,
        inputType: 'resistance_band',
        band: set.band,
        personalBest: point,
        points: [point],
        lastPerformed: DATE,
      },
    ],
  }
}

const pbCard = () => document.querySelector('[data-personal-best]') as HTMLElement
const perfCard = () =>
  document.querySelector('[data-exercise-performance]') as HTMLElement

const performanceReads = () =>
  progress.calls.filter((call) => call.url.startsWith('/api/progress/performance')).length

const correctionWrites = () =>
  workouts.calls.filter((call) => call.url.includes('/correction')).length

async function openProgress() {
  const u = user()
  renderApp('/progress')
  await screen.findByRole('heading', { level: 1 })
  await waitFor(() =>
    expect(pbCard()?.getAttribute('data-personal-best-state')).toBe('ready'),
  )
  return u
}

/** Open the disclosure, open the editor, set the reps, save. */
async function correctRepsTo(u: ReturnType<typeof user>, reps: string) {
  await u.click(await screen.findByRole('button', { name: /Recorded sets/ }))
  await u.click(await screen.findByRole('button', { name: 'Edit recorded set' }))
  await u.clear(screen.getByLabelText('Reps'))
  await u.type(screen.getByLabelText('Reps'), reps)
  await u.click(screen.getByRole('button', { name: 'Save correction' }))
}

/* ------------------------------------------------------------------ */
/* 1. The blocker                                                      */
/* ------------------------------------------------------------------ */

describe('1. a correction refreshes the derived panels it invalidates', () => {
  it('moves the recorded row, Personal Best and Exercise Performance together', async () => {
    const u = await openProgress()

    // The factual starting state, on all three surfaces.
    expect(within(pbCard()).getByText(/Black ×1 · 18 reps/)).toBeInTheDocument()
    expect(within(perfCard()).getByText(/Black ×1 · 18 reps/)).toBeInTheDocument()

    await correctRepsTo(u, '16')

    // The corrected row, adopted immediately from the PUT response.
    await screen.findByText(/Black ×1 · 16 reps/)
    await screen.findByText('Corrected')

    // And — with no reload, no navigation, no reopening of the accordion —
    // the two derived panels follow the server.
    await waitFor(() =>
      expect(within(pbCard()).getByText(/Black ×1 · 16 reps/)).toBeInTheDocument(),
    )
    await waitFor(() =>
      expect(within(perfCard()).getByText(/Black ×1 · 16 reps/)).toBeInTheDocument(),
    )

    // Nothing anywhere still claims the old number.
    expect(within(pbCard()).queryByText(/18 reps/)).not.toBeInTheDocument()
    expect(within(perfCard()).queryByText(/18 reps/)).not.toBeInTheDocument()
  })

  it('writes the correction exactly once and re-reads performance after it', async () => {
    const u = await openProgress()
    const readsBefore = performanceReads()

    await correctRepsTo(u, '16')
    await screen.findByText(/Black ×1 · 16 reps/)
    await waitFor(() =>
      expect(within(pbCard()).getByText(/Black ×1 · 16 reps/)).toBeInTheDocument(),
    )

    // One correction, not two — the refresh must not resubmit anything.
    expect(correctionWrites()).toBe(1)
    // And the derived domain was actually asked again.
    expect(performanceReads()).toBeGreaterThan(readsBefore)
    // The persisted truth is the corrected one.
    expect(storedSet().result).toBe(16)
  })

  it('takes the new best from the server, never from an optimistic guess', async () => {
    const u = await openProgress()

    // The server is made to keep answering 18 even after the correction lands.
    // If the client were rewriting Personal Best locally it would now show 16,
    // which would be a number no server ever said.
    progress.setPerformance({
      complete: true,
      examined: 1,
      variants: [
        {
          key: 'lat-pulldown:band:Black:1',
          exerciseId: 'lat-pulldown',
          exerciseName: 'Lat Pulldown',
          resultKind: 'reps',
          loadMode: 'none',
          perSide: false,
          inputType: 'resistance_band',
          band: { label: 'Black', count: 1 },
          personalBest: { date: DATE, sessionId: SESSION, loadValue: null, result: 18 },
          points: [{ date: DATE, sessionId: SESSION, loadValue: null, result: 18 }],
          lastPerformed: DATE,
        },
      ],
    })

    await correctRepsTo(u, '16')

    // The recorded row moves, because the PUT response said so.
    await screen.findByText(/Black ×1 · 16 reps/)
    // The derived panel does not, because the server did not say so.
    await waitFor(() => expect(performanceReads()).toBeGreaterThan(1))
    expect(within(pbCard()).getByText(/Black ×1 · 18 reps/)).toBeInTheDocument()
  })
})

/* ------------------------------------------------------------------ */
/* 2. The refresh failing does not undo the correction                 */
/* ------------------------------------------------------------------ */

describe('2. a failed refresh never rolls the correction back', () => {
  it('keeps the correction, and refuses to present the stale best as current', async () => {
    const u = await openProgress()
    expect(within(pbCard()).getByText(/Black ×1 · 18 reps/)).toBeInTheDocument()

    // The correction will succeed; the performance re-read will not.
    await u.click(await screen.findByRole('button', { name: /Recorded sets/ }))
    await u.click(await screen.findByRole('button', { name: 'Edit recorded set' }))
    await u.clear(screen.getByLabelText('Reps'))
    await u.type(screen.getByLabelText('Reps'), '16')
    progress.failWith(500)
    await u.click(screen.getByRole('button', { name: 'Save correction' }))

    // The correction is persisted and shown.
    await screen.findByText(/Black ×1 · 16 reps/)
    expect(storedSet().result).toBe(16)
    expect(correctionWrites()).toBe(1)

    // The derived panel reports that it could not be read, rather than going on
    // displaying 18 as though it were still the current best.
    await waitFor(() =>
      expect(pbCard()?.getAttribute('data-personal-best-state')).toBe('error'),
    )
    expect(within(pbCard()).queryByText(/18 reps/)).not.toBeInTheDocument()
  })
})
