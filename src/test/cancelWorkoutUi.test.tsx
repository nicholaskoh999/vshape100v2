import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { authenticatedSession, mockAuthFetch, renderApp } from './authTestUtils'
import { createWorkoutServer, type WorkoutServer } from './workoutApiTestUtils'

/**
 * Round 21 — taking back an accidental Start, from the page.
 *
 * The real router, the real page, the real hook and the real client run against
 * an in-memory stand-in that mirrors the server's eligibility rule.
 *
 * The distinction that matters most on screen: a workout showing "0 completed ·
 * 0 skipped" is NOT necessarily cancellable. One that was completed and then
 * undone reads exactly the same, and must not be offered the button — the
 * training happened, even though the sets were put back.
 */

const TODAY = new Date(2026, 8, 7, 9, 0)
const DATE = '2026-09-07'
const SESSION = 'monday'

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

async function startWorkout(u: ReturnType<typeof user>) {
  await u.click(await screen.findByRole('button', { name: 'Start workout' }))
  await screen.findByText('Resume workout')
}

async function openExercise(u: ReturnType<typeof user>, name: RegExp) {
  const trigger = screen.getByRole('button', { name })
  await u.click(trigger)
  return within(document.getElementById(trigger.getAttribute('aria-controls')!)!)
}

describe('cancelling an accidental Start', () => {
  it('offers Cancel on a freshly started, untouched workout', async () => {
    const u = await openSession()
    await startWorkout(u)

    expect(
      await screen.findByRole('button', { name: 'Cancel workout start' }),
    ).toBeInTheDocument()
  })

  it('asks for confirmation rather than cancelling on one tap', async () => {
    const u = await openSession()
    await startWorkout(u)
    await u.click(screen.getByRole('button', { name: 'Cancel workout start' }))

    await screen.findByText('Cancel this workout?')
    await screen.findByText(/No sets have been recorded/i)
    // Nothing was removed just by asking.
    expect(server.workouts.size).toBe(1)
    expect(screen.getByText('Resume workout')).toBeInTheDocument()
  })

  it('keeps the workout when the user backs out', async () => {
    const u = await openSession()
    await startWorkout(u)
    await u.click(screen.getByRole('button', { name: 'Cancel workout start' }))
    await u.click(screen.getByRole('button', { name: 'Keep workout' }))

    expect(screen.queryByText('Cancel this workout?')).not.toBeInTheDocument()
    expect(screen.getByText('Resume workout')).toBeInTheDocument()
    expect(server.workouts.size).toBe(1)
  })

  it('returns the page to Workout not started once confirmed', async () => {
    const u = await openSession()
    await startWorkout(u)
    await u.click(screen.getByRole('button', { name: 'Cancel workout start' }))
    await u.click(screen.getByRole('button', { name: 'Cancel workout' }))

    await screen.findByRole('button', { name: 'Start workout' })
    expect(screen.getByText('Workout not started')).toBeInTheDocument()
    expect(screen.queryByText('Resume workout')).not.toBeInTheDocument()
    // And it is gone from the server, not merely hidden.
    expect(server.workouts.size).toBe(0)
  })

  it('does NOT offer Cancel once a set has been completed', async () => {
    const u = await openSession()
    await startWorkout(u)
    const panel = await openExercise(u, /Lat Pulldown/)
    await u.type(panel.getAllByLabelText('Load (kg)')[0], '20')
    await u.type(panel.getAllByLabelText(/^Reps/)[0], '12')
    await u.click(panel.getAllByRole('button', { name: 'Complete' })[0])
    await panel.findByText(/Completed/)

    expect(screen.queryByRole('button', { name: 'Cancel workout start' })).toBeNull()
  })

  it('does NOT offer Cancel after Complete then Undo, though it reads 0 / 0', async () => {
    // The whole reason the marker is durable. The summary line says nothing was
    // recorded, and the workout is still not disposable.
    const u = await openSession()
    await startWorkout(u)
    const panel = await openExercise(u, /Lat Pulldown/)
    await u.type(panel.getAllByLabelText('Load (kg)')[0], '20')
    await u.type(panel.getAllByLabelText(/^Reps/)[0], '12')
    await u.click(panel.getAllByRole('button', { name: 'Complete' })[0])
    await panel.findByText(/Completed/)
    await u.click(panel.getAllByRole('button', { name: /^Undo/ })[0])
    // Back to pending: the load field is offered again on every set.
    await waitFor(() => expect(panel.getAllByLabelText('Load (kg)')).toHaveLength(4))

    expect(screen.getByText(/0 completed · 0 skipped/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancel workout start' })).toBeNull()
  })

  it('says so, and keeps everything, when the server refuses', async () => {
    const u = await openSession()
    await startWorkout(u)
    await u.click(screen.getByRole('button', { name: 'Cancel workout start' }))

    // The workout is worked in between opening the dialog and confirming.
    const stored = server.workouts.get(`${DATE}#${SESSION}`)!
    stored.touchedAt = 5
    stored.sets[0].status = 'completed'
    stored.sets[0].result = 12
    stored.sets[0].updatedAt = 5

    await u.click(screen.getByRole('button', { name: 'Cancel workout' }))

    await screen.findByText(/cannot be cancelled/i)
    // Nothing was deleted, and the page shows the truthful workout again.
    expect(server.workouts.size).toBe(1)
    expect(await screen.findByText('Resume workout')).toBeInTheDocument()
  })

  it('reports a connection failure without removing anything', async () => {
    const u = await openSession()
    await startWorkout(u)
    server.failMutations(1)

    await u.click(screen.getByRole('button', { name: 'Cancel workout start' }))
    await u.click(screen.getByRole('button', { name: 'Cancel workout' }))

    await screen.findByText(/Could not cancel this workout/i)
    expect(server.workouts.size).toBe(1)
  })
})
