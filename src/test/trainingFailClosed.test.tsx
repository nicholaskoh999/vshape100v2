import { cleanup, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { authenticatedSession, mockAuthFetch, renderApp } from './authTestUtils'
import { createProgrammeServer, type ProgrammeServer } from './programmeApiTestUtils'
import { createWorkoutServer, type WorkoutServer } from './workoutApiTestUtils'

/**
 * ROUND 24 (Q6 C) — TRAINING FAILS CLOSED ON AN UNREADABLE PROGRAMME.
 *
 * `TrainingPage` has always refused to fall back to the static Foundation week
 * when the account's own programme cannot be read, and the reason is written
 * into the component:
 *
 *   "Showing the default programme to somebody whose real one could not be read
 *    would show them a session they may have edited away."
 *
 * That is a real safety property — the user could start a workout against a
 * session they deleted, and the snapshot frozen at Start would record training
 * they never planned.
 *
 * The Round 24 audit found it had NO regression test at all. Searching the
 * whole suite for `data-training-week`, or for the error copy, returned
 * nothing. It was therefore exactly the kind of behaviour a redesign drops
 * silently while every existing test stays green — and this round rewrote that
 * component.
 *
 * So it is pinned here, from the outside, through the real router and provider:
 * on a failed read the page must show the failure, offer a retry, and list NO
 * sessions — not one, and above all not the Foundation defaults.
 */

let programme: ProgrammeServer
let workouts: WorkoutServer

beforeEach(() => {
  programme = createProgrammeServer()
  workouts = createWorkoutServer()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

/** The five focus strings of the built-in Foundation week. */
const FOUNDATION_FOCUSES = [
  'Back Width + Biceps',
  'Upper Chest + Shoulders + Triceps',
  'Light Back + Rear Delts + Core',
  'Back Thickness + Chest + Biceps',
  'Upper Chest + Shoulders + Arms',
]

describe('Training fails closed when the programme cannot be read', () => {
  it('shows the failure and NOT the default Foundation week', async () => {
    programme.failWith(500)
    mockAuthFetch({ session: authenticatedSession, programme, workouts })

    renderApp('/training')
    await screen.findByRole('heading', { level: 1, name: 'Training' })

    // The failure is stated, and announced.
    const failure = await screen.findByRole('alert')
    expect(failure).toHaveTextContent(/could not be loaded/i)

    // The marker the component has always carried for this branch.
    await waitFor(() =>
      expect(document.querySelector('[data-training-week="error"]')).not.toBeNull(),
    )

    // THE POINT OF THE TEST. Not one Foundation session is listed — the page
    // would otherwise be offering a session the user may have edited away.
    for (const focus of FOUNDATION_FOCUSES) {
      expect(screen.queryByText(focus), focus).not.toBeInTheDocument()
    }

    // And no session link exists to start one from.
    expect(
      screen.queryAllByRole('link', { name: /Back Width|Upper Chest|Light Back/ }),
    ).toHaveLength(0)
  })

  it('offers exactly one way forward, and it is a retry', async () => {
    programme.failWith(500)
    mockAuthFetch({ session: authenticatedSession, programme, workouts })

    renderApp('/training')
    await screen.findByRole('heading', { level: 1, name: 'Training' })

    const retry = await screen.findByRole('button', { name: /retry|try again/i })
    expect(retry).toBeInTheDocument()

    // Not an automatic retry loop: the read is attempted once and then waits
    // for the user. Anything else would hammer a failing server from a screen
    // the user is only looking at.
    const before = programme.calls.filter((call) => call.method === 'GET').length
    await new Promise((resolve) => setTimeout(resolve, 250))
    expect(
      programme.calls.filter((call) => call.method === 'GET').length,
    ).toBe(before)
  })

  it('lists the week again once the programme reads cleanly', async () => {
    mockAuthFetch({ session: authenticatedSession, programme, workouts })

    renderApp('/training')
    await screen.findByRole('heading', { level: 1, name: 'Training' })

    // A healthy read shows the real week, so the refusal above is genuinely
    // about the failure and not about the page being unable to render at all.
    await waitFor(() =>
      expect(document.querySelector('[data-training-week="error"]')).toBeNull(),
    )
    for (const focus of FOUNDATION_FOCUSES) {
      expect(await screen.findByText(focus)).toBeInTheDocument()
    }
  })
})
