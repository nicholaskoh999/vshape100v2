import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { authenticatedSession, mockAuthFetch, renderApp } from './authTestUtils'
import { createProgrammeServer, type ProgrammeServer } from './programmeApiTestUtils'
import { createWorkoutServer, type WorkoutServer } from './workoutApiTestUtils'
import { foundationProgramme } from '@shared/programme/foundation'
import type { Programme } from '@shared/programme/programme'

/**
 * Round 22 Correction 1 — a STARTED scheduled workout renders its snapshot.
 *
 * THE BUG THIS PINS. `ExerciseAccordion` renders each row's name, prescription
 * and equipment from `session.exercises[index]`, while the logging controls for
 * that row are matched by `exerciseOrder === index`. So if the page keeps
 * handing it the CURRENT programme after Start, a rename or a reorder pairs a
 * current row with somebody else's frozen sets — and the user logs against the
 * wrong exercise with nothing on screen to say so.
 *
 * Extra had the right model already. This is the same rule for the scheduled
 * page: before Start, the current programme; after Start, the stored snapshot
 * and nothing else.
 */

const TODAY = new Date(2026, 8, 7, 9, 0)
const DATE = '2026-09-07'

let programme: ProgrammeServer
let workouts: WorkoutServer

/** Monday: Lat Pulldown then Face Pull, each with its own prescription. */
function beforeProgramme(): Programme {
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
          equipment: 'BAND 20kg',
        },
        {
          exerciseId: 'face-pull',
          position: 2,
          setCount: 1,
          resultKind: 'reps',
          targetMin: 15,
          targetMax: 20,
          perSide: false,
          equipment: null,
        },
      ],
    },
  }
}

/** The same weekday after a rename, a reorder and new prescriptions. */
function afterProgramme(): Programme {
  const base = beforeProgramme()
  return {
    ...base,
    revision: 2,
    exercises: base.exercises.map((exercise) =>
      exercise.exerciseId === 'lat-pulldown'
        ? { ...exercise, name: 'Band Lat Pulldown' }
        : exercise.exerciseId === 'face-pull'
          ? { ...exercise, name: 'Face Pull New' }
          : exercise,
    ),
    sessions: {
      ...base.sessions,
      monday: [
        {
          exerciseId: 'face-pull',
          position: 1,
          setCount: 5,
          resultKind: 'reps',
          targetMin: 5,
          targetMax: 6,
          perSide: false,
          equipment: 'ROPE',
        },
        {
          exerciseId: 'lat-pulldown',
          position: 2,
          setCount: 7,
          resultKind: 'reps',
          targetMin: 3,
          targetMax: 4,
          perSide: false,
          equipment: 'BAND 99kg',
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
  programme.setProgramme(beforeProgramme())
  workouts.setProgramme(beforeProgramme())
  mockAuthFetch({ session: authenticatedSession, programme, workouts })
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
  renderApp(`/training/monday`)
  await waitFor(() => {
    const heading = screen.getByRole('heading', { level: 1 })
    expect(heading.textContent).not.toBe('Loading')
  })
  return u
}

/** Every compact row, in list order. */
function rows() {
  return [...document.querySelectorAll('li[data-exercise-row], main ol > li')]
}

function rowTexts() {
  return rows().map((row) => (row.textContent ?? '').replace(/\s+/g, ' ').trim())
}

/* ------------------------------------------------------------------ */

describe('a started scheduled workout renders its frozen snapshot', () => {
  it('keeps the old names, order and prescriptions after the programme moves', async () => {
    const u = await openMonday()

    // Before Start: the current programme, which is the point of Round 22.
    await screen.findByText('Lat Pulldown')
    expect(screen.getByText('Face Pull')).toBeInTheDocument()

    await u.click(await screen.findByRole('button', { name: 'Start workout' }))
    await screen.findByText('Resume workout')

    // The programme now moves under the started workout: both exercises
    // renamed, swapped, re-prescribed and re-equipped.
    programme.setProgramme(afterProgramme())
    workouts.setProgramme(afterProgramme())

    cleanup()
    await openMonday()
    await screen.findByText('Resume workout')

    const texts = rowTexts()

    // Step 1 is still Lat Pulldown, with the prescription it was started under.
    expect(texts[0]).toContain('Lat Pulldown')
    expect(texts[0]).not.toContain('Band Lat Pulldown')
    expect(texts[0]).toContain('2 × 10–15')

    // Step 2 is still Face Pull, under its own old prescription.
    expect(texts[1]).toContain('Face Pull')
    expect(texts[1]).not.toContain('Face Pull New')
    expect(texts[1]).toContain('1 × 15–20')

    // And none of the new programme's text is on screen at all.
    const main = document.querySelector('main') as HTMLElement
    expect(main.textContent).not.toContain('Band Lat Pulldown')
    expect(main.textContent).not.toContain('Face Pull New')
    expect(main.textContent).not.toContain('BAND 99kg')
    expect(main.textContent).not.toContain('ROPE')
  })

  it('keeps the logging controls for exerciseOrder 0 attached to Lat Pulldown', async () => {
    const u = await openMonday()
    await u.click(await screen.findByRole('button', { name: 'Start workout' }))
    await screen.findByText('Resume workout')

    programme.setProgramme(afterProgramme())
    workouts.setProgramme(afterProgramme())
    cleanup()
    const u2 = await openMonday()
    await screen.findByText('Resume workout')

    // Open the FIRST row and log its first set. The stored set at
    // exerciseOrder 0 is Lat Pulldown's, so the row that offers it must be the
    // row that says Lat Pulldown.
    const first = rows()[0]
    expect(first.textContent).toContain('Lat Pulldown')
    await u2.click(within(first as HTMLElement).getByRole('button', { name: /Lat Pulldown/ }))

    // Round 20 typed input: this exercise is unconfigured, so it requests
    // kilograms and Complete stays disabled until a load and a result exist.
    const panel = document.querySelector('[role="region"]') ?? document.body
    const fields = [...panel.querySelectorAll('input[type="text"]')]
    const setValue = (el: Element, value: string) => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )!.set!
      setter.call(el, value)
      el.dispatchEvent(new Event('input', { bubbles: true }))
    }
    for (const field of fields.slice(0, 2)) setValue(field, '10')

    const complete = await screen.findAllByRole('button', { name: 'Complete' })
    await u2.click(complete[0])

    await waitFor(() => {
      const stored = workouts.workouts.get(`${DATE}#monday`)
      const set = stored?.sets.find((s) => s.exerciseOrder === 0 && s.setIndex === 0)
      expect(set?.status).toBe('completed')
      // The set that was completed is Lat Pulldown's, which is what the row
      // claimed to be. Pairing the current programme against frozen positions
      // would have completed a set the user believed was a different exercise.
      expect(set?.exerciseId).toBe('lat-pulldown')
    })
  })

  it('keeps the header day, focus and intensity the workout was begun under', async () => {
    const u = await openMonday()
    await u.click(await screen.findByRole('button', { name: 'Start workout' }))
    await screen.findByText('Resume workout')

    // A programme edit cannot reach the occurrence's own header either.
    programme.setProgramme(afterProgramme())
    workouts.setProgramme(afterProgramme())
    cleanup()
    await openMonday()
    await screen.findByText('Resume workout')

    expect(
      screen.getByRole('heading', { level: 1, name: 'Back Width + Biceps' }),
    ).toBeInTheDocument()
  })

  it('still shows the CURRENT programme before a Start', async () => {
    // The other half of the contract, so the fix cannot be "always show the
    // snapshot" — a workout that has not begun has no snapshot to show.
    programme.setProgramme(afterProgramme())
    workouts.setProgramme(afterProgramme())
    await openMonday()

    await screen.findByText('Band Lat Pulldown')
    expect(screen.getByText('Face Pull New')).toBeInTheDocument()
    const texts = rowTexts()
    expect(texts[0]).toContain('Face Pull New')
    expect(texts[1]).toContain('Band Lat Pulldown')
  })
})
