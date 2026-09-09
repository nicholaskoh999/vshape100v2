import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { authenticatedSession, mockAuthFetch, renderApp } from './authTestUtils'
import { createProgrammeServer, type ProgrammeServer } from './programmeApiTestUtils'
import { createWorkoutServer, type WorkoutServer } from './workoutApiTestUtils'
import { foundationProgramme } from '@shared/programme/foundation'

/**
 * ROUND 24 CORRECTION — the week-first Programme editor at /settings/programme.
 *
 * Two things the first cut of this screen got wrong, pinned here so they cannot
 * come back.
 *
 * BLOCKER 1 — ADDING WAS NOT REAL. "Add an exercise to Monday" was a LINK to
 * the Exercise Library, which meant the week-first screen could not perform the
 * one week-first operation that matters: weekday → add an exercise → set its
 * prescription → save. The user was pushed straight back onto the exercise-first
 * path this screen exists to replace.
 *
 * BLOCKER 2 — A CONFLICT COULD REBASE A STALE DRAFT. The draft carried no
 * revision, so `current = draft ?? base` meant an old draft survived a 409,
 * picked up whatever revision arrived next, and could then be saved AS IF it
 * had been written against work its author had never seen. That is precisely
 * the silent overwrite compare-and-swap exists to prevent.
 *
 * Everything else about the write is unchanged and asserted here too: adding
 * touches the draft only, no request is made by choosing an exercise, and the
 * week still reaches the server as ONE all-or-nothing compare-and-swap.
 */

const TODAY = new Date(2026, 8, 7, 9, 0)

let programme: ProgrammeServer
let workouts: WorkoutServer

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(TODAY)
  programme = createProgrammeServer()
  workouts = createWorkoutServer()
  mockAuthFetch({ session: authenticatedSession, programme, workouts })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function openProgramme() {
  const u = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  renderApp('/settings/programme')
  await screen.findByRole('heading', { level: 1, name: 'Programme' })
  await screen.findByRole('button', { name: /^Edit Lat Pulldown on Monday$/ })
  return u
}

const saveButton = () => screen.getByRole('button', { name: 'Save programme' })
const addPanel = () => document.querySelector('[data-add-exercise]') as HTMLElement | null
const puts = () => programme.calls.filter((call) => call.method === 'PUT')

/** Every weekday name for the exercise ids currently on Monday. */
const mondayIds = () => programme.current().sessions.monday.map((slot) => slot.exerciseId)

/* ------------------------------------------------------------------ */
/* 1. Adding an exercise to a weekday                                  */
/* ------------------------------------------------------------------ */

describe('1. weekday → add exercise', () => {
  it('adds an existing exercise to the end of the day and saves the whole week', async () => {
    const u = await openProgramme()

    await u.click(screen.getByRole('button', { name: 'Add exercise to Monday' }))
    await u.click(
      within(addPanel() as HTMLElement).getByRole('button', {
        name: 'Add Flat DB Press to Monday',
      }),
    )

    // Nothing has been written by choosing it. The week is still what the
    // server had, and the only requests so far were reads.
    expect(puts()).toHaveLength(0)
    expect(mondayIds()).toEqual([
      'lat-pulldown',
      'one-arm-db-row',
      'face-pull',
      'preacher-curl',
      'hammer-curl',
    ])

    // Its prescription editor is open, on the day it was added to.
    expect(
      await screen.findByRole('button', { name: 'Edit Flat DB Press on Monday' }),
    ).toHaveAttribute('aria-expanded', 'true')

    await u.click(saveButton())
    await waitFor(() => expect(programme.current().revision).toBe(1))

    // Appended to the END of Monday, with positions rewritten from array order.
    expect(mondayIds()).toEqual([
      'lat-pulldown',
      'one-arm-db-row',
      'face-pull',
      'preacher-curl',
      'hammer-curl',
      'flat-db-press',
    ])
    expect(programme.current().sessions.monday.map((slot) => slot.position)).toEqual([
      1, 2, 3, 4, 5, 6,
    ])

    // ONE all-or-nothing write, stating the whole programme.
    expect(puts()).toHaveLength(1)
    const body = puts()[0].body as Record<string, unknown>
    expect(body.expectedRevision).toBe(0)
    expect(Object.keys(body.sessions as object).sort()).toEqual([
      'friday',
      'monday',
      'thursday',
      'tuesday',
      'wednesday',
    ])
  })

  it('starts the new slot at the SAME default the Exercise Library uses', async () => {
    const u = await openProgramme()

    await u.click(screen.getByRole('button', { name: 'Add exercise to Monday' }))
    await u.click(
      within(addPanel() as HTMLElement).getByRole('button', {
        name: 'Add Flat DB Press to Monday',
      }),
    )
    await u.click(saveButton())
    await waitFor(() => expect(programme.current().revision).toBe(1))

    const added = programme.current().sessions.monday.at(-1)!
    // 3 × 10–15 reps, no per-side, no equipment note — the accepted default,
    // not a second one invented for this screen.
    expect(added).toMatchObject({
      exerciseId: 'flat-db-press',
      setCount: 3,
      resultKind: 'reps',
      targetMin: 10,
      targetMax: 15,
      perSide: false,
      equipment: null,
    })
  })

  it('adds to the weekday being edited, and only that one', async () => {
    const u = await openProgramme()

    await u.click(screen.getByRole('tab', { name: /^Thu · / }))
    await u.click(screen.getByRole('button', { name: 'Add exercise to Thursday' }))
    await u.click(
      within(addPanel() as HTMLElement).getByRole('button', {
        name: 'Add Plank to Thursday',
      }),
    )
    await u.click(saveButton())
    await waitFor(() => expect(programme.current().revision).toBe(1))

    const seed = foundationProgramme()
    expect(programme.current().sessions.thursday.map((s) => s.exerciseId)).toEqual([
      ...seed.sessions.thursday.map((s) => s.exerciseId),
      'plank',
    ])
    // Every other weekday is byte-for-byte what it was.
    for (const day of ['monday', 'tuesday', 'wednesday', 'friday'] as const) {
      expect(programme.current().sessions[day].map((s) => s.exerciseId)).toEqual(
        seed.sessions[day].map((s) => s.exerciseId),
      )
    }
  })
})

/* ------------------------------------------------------------------ */
/* 2. What may NOT be added                                            */
/* ------------------------------------------------------------------ */

describe('2. duplicates and archived exercises are refused', () => {
  it('never offers an exercise that is already on this weekday', async () => {
    const u = await openProgramme()

    await u.click(screen.getByRole('button', { name: 'Add exercise to Monday' }))
    const panel = within(addPanel() as HTMLElement)

    // Two slots for one exercise in one weekday cannot be told apart in the
    // workout that follows, so it is not on the menu at all.
    for (const name of [
      'Lat Pulldown',
      'One-Arm DB Row',
      'Face Pull',
      'Preacher Curl',
      'Hammer Curl',
    ]) {
      expect(panel.queryByRole('button', { name: `Add ${name} to Monday` }), name).toBeNull()
    }
    // ...while something that is NOT on Monday still is.
    expect(
      panel.getByRole('button', { name: 'Add Flat DB Press to Monday' }),
    ).toBeInTheDocument()
  })

  it('never offers an archived exercise', async () => {
    const seed = foundationProgramme()
    programme.setProgramme({
      ...seed,
      exercises: seed.exercises.map((exercise) =>
        exercise.exerciseId === 'flat-db-press' ? { ...exercise, archived: true } : exercise,
      ),
    })

    const u = await openProgramme()
    await u.click(screen.getByRole('button', { name: 'Add exercise to Monday' }))
    const panel = within(addPanel() as HTMLElement)

    // Archiving retires an exercise from FUTURE training. A screen that let one
    // back onto next Monday would make archiving mean nothing.
    expect(panel.queryByRole('button', { name: 'Add Flat DB Press to Monday' })).toBeNull()
    // A non-archived neighbour proves the list itself is working.
    expect(
      panel.getByRole('button', { name: 'Add Seated Shoulder Press to Monday' }),
    ).toBeInTheDocument()
  })

  it('keeps the day’s exercises unchanged when nothing is chosen', async () => {
    const u = await openProgramme()

    await u.click(screen.getByRole('button', { name: 'Add exercise to Monday' }))
    await u.click(screen.getByRole('button', { name: 'Cancel adding an exercise' }))

    expect(addPanel()).toBeNull()
    expect(saveButton()).toBeDisabled()
    expect(puts()).toHaveLength(0)
  })
})

/* ------------------------------------------------------------------ */
/* 3. A stale draft can never be saved against a newer revision        */
/* ------------------------------------------------------------------ */

describe('3. conflict: the draft is pinned to the revision it was written on', () => {
  /** Somebody else edits the programme: Monday loses its last exercise. */
  function concurrentEdit() {
    const seed = foundationProgramme()
    programme.setProgramme({
      revision: seed.revision + 1,
      exercises: seed.exercises,
      sessions: {
        ...seed.sessions,
        monday: seed.sessions.monday.slice(0, -1),
      },
    })
  }

  async function conflictedDraft() {
    const u = await openProgramme()

    // A. A local draft, written against revision 0.
    await u.click(screen.getByRole('button', { name: 'Add exercise to Monday' }))
    await u.click(
      within(addPanel() as HTMLElement).getByRole('button', {
        name: 'Add Flat DB Press to Monday',
      }),
    )
    expect(saveButton()).toBeEnabled()

    // C. The server moves to revision 1 underneath it.
    concurrentEdit()

    // B. The save is refused, exactly as the Worker refuses it.
    await u.click(saveButton())
    await screen.findByText('Your programme changed somewhere else')
    return u
  }

  it('refuses the save and overwrites nothing', async () => {
    await conflictedDraft()

    // E. Nothing was overwritten: the concurrent edit still stands, whole.
    expect(programme.current().revision).toBe(1)
    expect(mondayIds()).toEqual([
      'lat-pulldown',
      'one-arm-db-row',
      'face-pull',
      'preacher-curl',
    ])
    expect(mondayIds()).not.toContain('flat-db-press')
  })

  it('does not throw the author’s edits away', async () => {
    await conflictedDraft()

    // The refusal is not a punishment. What they wrote is still on screen.
    expect(
      screen.getByRole('button', { name: 'Edit Flat DB Press on Monday' }),
    ).toBeInTheDocument()
  })

  it('cannot be submitted as though it had been written on the newer revision', async () => {
    const u = await conflictedDraft()

    // D. THE POINT OF THE TEST. Saving is closed, and stays closed — editing
    // further is not a way of re-basing an old draft onto newer work.
    expect(saveButton()).toBeDisabled()

    await u.click(screen.getByRole('button', { name: 'Move Lat Pulldown down in Monday' }))
    expect(saveButton()).toBeDisabled()

    // Press it anyway. This is the harm being prevented: without the pin, the
    // draft would go up stating revision 1 and the concurrent edit would be
    // gone without anybody seeing it.
    await u.click(saveButton())

    // Every save this screen ever attempted stated revision 0 — the one it was
    // actually written against. Never 1.
    for (const call of puts()) {
      expect((call.body as Record<string, unknown>).expectedRevision).toBe(0)
    }
    expect(puts()).toHaveLength(1)
    // And the concurrent edit still stands, untouched.
    expect(programme.current().revision).toBe(1)
    expect(mondayIds()).toEqual([
      'lat-pulldown',
      'one-arm-db-row',
      'face-pull',
      'preacher-curl',
    ])
  })

  it('offers exactly one way forward, and it says what it costs', async () => {
    await conflictedDraft()

    const discard = screen.getByRole('button', {
      name: 'Discard my edits and load the latest',
    })
    expect(discard).toBeInTheDocument()
    // No "save anyway": saving anyway IS the silent overwrite.
    expect(screen.queryByRole('button', { name: /save anyway|overwrite|force/i })).toBeNull()
    expect(document.body.textContent).toMatch(/permanently lose the unsaved edits/i)
  })

  it('discards the draft and shows the authoritative programme', async () => {
    const u = await conflictedDraft()

    await u.click(
      screen.getByRole('button', { name: 'Discard my edits and load the latest' }),
    )

    // F. The newer week, read back from the server.
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Edit Hammer Curl on Monday' })).toBeNull(),
    )
    expect(
      screen.queryByRole('button', { name: 'Edit Flat DB Press on Monday' }),
    ).toBeNull()
    expect(
      await screen.findByRole('button', { name: 'Edit Preacher Curl on Monday' }),
    ).toBeInTheDocument()
    expect(screen.getByText(/Revision 1/)).toBeInTheDocument()

    // Discarding writes nothing either.
    expect(puts()).toHaveLength(1)
    expect(programme.current().revision).toBe(1)
  })
})
