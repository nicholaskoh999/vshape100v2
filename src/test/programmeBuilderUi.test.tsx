import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { authenticatedSession, mockAuthFetch, renderApp } from './authTestUtils'
import { createProgrammeServer, type ProgrammeServer } from './programmeApiTestUtils'
import { createWorkoutServer, type WorkoutServer } from './workoutApiTestUtils'
import { foundationProgramme } from '@shared/programme/foundation'
import { formatPrescription } from '@shared/programme/programme'

/**
 * Round 22 — the Programme Builder, through the real UI.
 *
 * The real router, pages, provider, client and stand-in run together. The
 * stand-in enforces the same optimistic-concurrency rule the Worker does, so a
 * save that would be refused in production is refused here.
 *
 * These are the acceptance cases that can only be judged at the screen: that a
 * rename does not move identity, that two weekdays are independent, that a
 * reorder actually persists, that archiving is refused rather than emptying a
 * day, that a restore does not guess placements back, and that a stale save is
 * told so instead of silently winning.
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

function user() {
  return userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
}

/** Open one exercise's settings and wait past the programme's loading header. */
async function openExercise(exerciseId = 'lat-pulldown') {
  const u = user()
  renderApp(`/settings/exercises/${exerciseId}`)
  await waitFor(() => {
    const heading = screen.getByRole('heading', { level: 1 })
    expect(heading.textContent).not.toBe('Loading')
  })
  return u
}

const nameField = () => screen.getByLabelText('Name') as HTMLInputElement
const weekday = (day: string) =>
  document.querySelector(`[data-weekday="${day}"]`) as HTMLElement
const saveButton = () => screen.getByRole('button', { name: 'Save changes' })

/* ------------------------------------------------------------------ */
/* D. Rename                                                           */
/* ------------------------------------------------------------------ */

describe('D. renaming an exercise', () => {
  it('changes the display name and NOT the identity', async () => {
    const u = await openExercise()

    await u.clear(nameField())
    await u.type(nameField(), 'Band Lat Pulldown')
    await u.click(saveButton())

    await waitFor(() => expect(programme.current().revision).toBe(1))

    const stored = programme.current()
    const exercise = stored.exercises.find((e) => e.exerciseId === 'lat-pulldown')
    expect(exercise?.name).toBe('Band Lat Pulldown')

    // Identity is untouched everywhere it appears — which is what keeps media,
    // input type and every recorded set pointing at the same exercise.
    const seed = foundationProgramme()
    for (const sessionId of ['monday', 'wednesday', 'thursday'] as const) {
      expect(stored.sessions[sessionId].map((s) => s.exerciseId)).toEqual(
        seed.sessions[sessionId].map((s) => s.exerciseId),
      )
    }
    // And no second exercise was invented.
    expect(stored.exercises).toHaveLength(seed.exercises.length)
  })

  it('shows the new name in the Exercise Library afterwards', async () => {
    const u = await openExercise()
    await u.clear(nameField())
    await u.type(nameField(), 'Band Lat Pulldown')
    await u.click(saveButton())
    await waitFor(() => expect(programme.current().revision).toBe(1))

    cleanup()
    renderApp('/settings/exercises')
    await screen.findByRole('link', { name: 'Edit settings for Band Lat Pulldown' })
    expect(
      screen.queryByRole('link', { name: 'Edit settings for Lat Pulldown' }),
    ).not.toBeInTheDocument()
  })

  it('refuses to save an empty name', async () => {
    const u = await openExercise()
    await u.clear(nameField())
    expect(saveButton()).toBeDisabled()
  })
})

/* ------------------------------------------------------------------ */
/* E / F. Weekday independence and toggling                            */
/* ------------------------------------------------------------------ */

describe('E/F. weekdays', () => {
  it('edits Monday without touching Wednesday', async () => {
    const u = await openExercise()

    const monday = within(weekday('monday'))
    await u.clear(monday.getByLabelText('Sets'))
    await u.type(monday.getByLabelText('Sets'), '5')
    await u.click(saveButton())
    await waitFor(() => expect(programme.current().revision).toBe(1))

    const stored = programme.current()
    const mondaySlot = stored.sessions.monday.find((s) => s.exerciseId === 'lat-pulldown')!
    const wednesdaySlot = stored.sessions.wednesday.find(
      (s) => s.exerciseId === 'lat-pulldown',
    )!
    expect(formatPrescription(mondaySlot)).toBe('5 × 10–15')
    // Untouched, and still its own prescription.
    expect(formatPrescription(wednesdaySlot)).toBe('2 × 15–20')
  })

  it('adds a weekday and removes another in one save', async () => {
    const u = await openExercise()

    await u.click(within(weekday('friday')).getByLabelText('Train on Friday'))
    await u.click(within(weekday('thursday')).getByLabelText('Train on Thursday'))
    await u.click(saveButton())
    await waitFor(() => expect(programme.current().revision).toBe(1))

    const stored = programme.current()
    expect(stored.sessions.friday.some((s) => s.exerciseId === 'lat-pulldown')).toBe(true)
    expect(stored.sessions.thursday.some((s) => s.exerciseId === 'lat-pulldown')).toBe(false)
    // Thursday's remaining slots are compacted, with no gap left behind.
    expect(stored.sessions.thursday.map((s) => s.position)).toEqual([1, 2, 3, 4])
  })
})

/* ------------------------------------------------------------------ */
/* G. Reorder                                                          */
/* ------------------------------------------------------------------ */

describe('G. reordering', () => {
  it('moves an exercise down its weekday and persists it', async () => {
    const u = await openExercise()

    // Monday's Lat Pulldown is step 1 of 5.
    const monday = within(weekday('monday'))
    expect(monday.getByText('Step 1 of 5')).toBeInTheDocument()

    await u.click(monday.getByRole('button', { name: /Move .* down on Monday/ }))
    expect(within(weekday('monday')).getByText('Step 2 of 5')).toBeInTheDocument()

    await u.click(saveButton())
    await waitFor(() => expect(programme.current().revision).toBe(1))

    const stored = programme.current()
    expect(stored.sessions.monday.map((s) => s.exerciseId)).toEqual([
      'one-arm-db-row',
      'lat-pulldown',
      'face-pull',
      'preacher-curl',
      'hammer-curl',
    ])
    // Contiguous, with no duplicate step.
    expect(stored.sessions.monday.map((s) => s.position)).toEqual([1, 2, 3, 4, 5])
  })

  it('will not move past either end', async () => {
    await openExercise()
    const monday = within(weekday('monday'))
    expect(monday.getByRole('button', { name: /Move .* up on Monday/ })).toBeDisabled()
  })

  it('offers move controls as real buttons, not drag targets', async () => {
    await openExercise()
    // Named for a screen reader, and operable from a keyboard — the acceptance
    // requirement is explicit controls, not drag and drop.
    const buttons = screen.getAllByRole('button', { name: /Move .* (up|down) on / })
    expect(buttons.length).toBeGreaterThan(0)
    for (const button of buttons) expect(button.tagName).toBe('BUTTON')
  })
})

/* ------------------------------------------------------------------ */
/* I / J. Archive and restore                                          */
/* ------------------------------------------------------------------ */

describe('I/J. archive and restore', () => {
  it('asks for confirmation, then clears every future weekday in one write', async () => {
    const u = await openExercise()

    await u.click(screen.getByRole('button', { name: 'Archive exercise' }))
    // Confirmation, not a one-tap destructive action.
    expect(screen.getByText('Archive this exercise?')).toBeInTheDocument()
    await u.click(screen.getByRole('button', { name: 'Archive' }))

    await waitFor(() => expect(programme.current().revision).toBe(1))
    const stored = programme.current()
    expect(
      stored.exercises.find((e) => e.exerciseId === 'lat-pulldown')?.archived,
    ).toBe(true)
    for (const slots of Object.values(stored.sessions)) {
      expect(slots.some((s) => s.exerciseId === 'lat-pulldown')).toBe(false)
      // And no weekday was emptied on the way.
      expect(slots.length).toBeGreaterThan(0)
    }
  })

  it('REFUSES to archive the last exercise on a weekday, and says why', async () => {
    // A programme whose Monday holds one exercise only.
    const seed = foundationProgramme()
    programme.setProgramme({
      ...seed,
      revision: 1,
      sessions: {
        ...seed.sessions,
        monday: seed.sessions.monday.slice(0, 1),
        wednesday: seed.sessions.wednesday.filter((s) => s.exerciseId !== 'lat-pulldown'),
        thursday: seed.sessions.thursday.filter((s) => s.exerciseId !== 'lat-pulldown'),
      },
    })

    await openExercise()
    expect(screen.getByRole('button', { name: 'Archive exercise' })).toBeDisabled()
    expect(document.querySelector('[data-archive-blocked]')).not.toBeNull()
    // Nothing was written.
    expect(programme.current().revision).toBe(1)
  })

  it('restores WITHOUT putting it back on its old weekdays', async () => {
    const seed = foundationProgramme()
    programme.setProgramme({
      ...seed,
      revision: 3,
      exercises: seed.exercises.map((e) =>
        e.exerciseId === 'lat-pulldown' ? { ...e, archived: true } : e,
      ),
      sessions: {
        ...seed.sessions,
        monday: seed.sessions.monday.filter((s) => s.exerciseId !== 'lat-pulldown'),
        wednesday: seed.sessions.wednesday.filter((s) => s.exerciseId !== 'lat-pulldown'),
        thursday: seed.sessions.thursday.filter((s) => s.exerciseId !== 'lat-pulldown'),
      },
    })

    const u = await openExercise()
    await u.click(screen.getByRole('button', { name: 'Restore exercise' }))
    await waitFor(() => expect(programme.current().revision).toBe(4))

    const stored = programme.current()
    expect(
      stored.exercises.find((e) => e.exerciseId === 'lat-pulldown')?.archived,
    ).toBe(false)
    // Available again, and placed nowhere: the user chooses the days.
    for (const slots of Object.values(stored.sessions)) {
      expect(slots.some((s) => s.exerciseId === 'lat-pulldown')).toBe(false)
    }
  })

  it('lists archived exercises in their own section of the library', async () => {
    const seed = foundationProgramme()
    programme.setProgramme({
      ...seed,
      revision: 2,
      exercises: seed.exercises.map((e) =>
        e.exerciseId === 'plank' ? { ...e, archived: true } : e,
      ),
      sessions: {
        ...seed.sessions,
        wednesday: seed.sessions.wednesday.filter((s) => s.exerciseId !== 'plank'),
      },
    })

    renderApp('/settings/exercises')
    await screen.findByRole('heading', { level: 1, name: 'Exercise Library' })
    const archived = await waitFor(() => {
      const section = document.querySelector('[data-archived-section]')
      expect(section).not.toBeNull()
      return section as HTMLElement
    })
    expect(within(archived).getByText('Plank')).toBeInTheDocument()
  })
})

/* ------------------------------------------------------------------ */
/* K. Stale save                                                       */
/* ------------------------------------------------------------------ */

describe('K. a stale save', () => {
  it('is told the programme changed, and offered the latest, never overwritten', async () => {
    const u = await openExercise()

    programme.failNextSaveWithConflict()
    await u.clear(nameField())
    await u.type(nameField(), 'Should Not Land')
    await u.click(saveButton())

    await waitFor(() =>
      expect(document.querySelector('[data-programme-conflict]')).not.toBeNull(),
    )
    expect(
      screen.getByText(/changed in another tab\. Reload the latest version/),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reload latest' })).toBeInTheDocument()

    // Nothing was written, and nothing was auto-overwritten.
    expect(programme.current().revision).toBe(0)
    expect(
      programme.current().exercises.find((e) => e.exerciseId === 'lat-pulldown')?.name,
    ).toBe('Lat Pulldown')

    // The user's own edit is still on screen — theirs to keep or discard.
    expect(nameField().value).toBe('Should Not Land')
  })

  it('reloads the latest when asked, discarding nothing silently', async () => {
    const u = await openExercise()
    programme.failNextSaveWithConflict()
    await u.clear(nameField())
    await u.type(nameField(), 'Mine')
    await u.click(saveButton())
    await waitFor(() =>
      expect(document.querySelector('[data-programme-conflict]')).not.toBeNull(),
    )

    // Somebody else's change, now visible.
    programme.setProgramme({
      ...foundationProgramme(),
      revision: 9,
      exercises: foundationProgramme().exercises.map((e) =>
        e.exerciseId === 'lat-pulldown' ? { ...e, name: 'Theirs' } : e,
      ),
    })
    await u.click(screen.getByRole('button', { name: 'Reload latest' }))
    await waitFor(() => expect(nameField().value).toBe('Theirs'))
  })
})

/* ------------------------------------------------------------------ */
/* Unsaved changes, and invalid saves                                  */
/* ------------------------------------------------------------------ */

describe('unsaved changes and validity', () => {
  it('says there are unsaved changes, and can discard them', async () => {
    const u = await openExercise()
    expect(document.querySelector('[data-programme-dirty]')).toBeNull()

    await u.clear(nameField())
    await u.type(nameField(), 'Edited')
    expect(document.querySelector('[data-programme-dirty]')).not.toBeNull()

    await u.click(screen.getByRole('button', { name: 'Discard' }))
    expect(nameField().value).toBe('Lat Pulldown')
    expect(document.querySelector('[data-programme-dirty]')).toBeNull()
  })

  it('disables Save and explains when a weekday would be emptied', async () => {
    const seed = foundationProgramme()
    programme.setProgramme({
      ...seed,
      revision: 1,
      sessions: { ...seed.sessions, monday: seed.sessions.monday.slice(0, 1) },
    })
    const u = await openExercise()

    await u.click(within(weekday('monday')).getByLabelText('Train on Monday'))

    expect(document.querySelector('[data-programme-invalid]')?.textContent).toMatch(
      /Monday would have no exercises/,
    )
    expect(saveButton()).toBeDisabled()
  })

  it('disables Save on a descending target range', async () => {
    const u = await openExercise()
    const monday = within(weekday('monday'))
    await u.clear(monday.getByLabelText('Reps from'))
    await u.type(monday.getByLabelText('Reps from'), '20')
    expect(saveButton()).toBeDisabled()
    expect(document.querySelector('[data-programme-invalid]')?.textContent).toMatch(
      /lower number first/,
    )
  })
})

/* ------------------------------------------------------------------ */
/* H. Custom exercise                                                  */
/* ------------------------------------------------------------------ */

describe('H. adding a custom exercise', () => {
  it('requires a name AND an input type before it can be added', async () => {
    const u = user()
    renderApp('/settings/exercises')
    await screen.findByRole('heading', { level: 1, name: 'Exercise Library' })

    await u.click(await screen.findByRole('button', { name: /Add exercise/ }))
    const add = screen.getByRole('button', { name: 'Add exercise' })
    expect(add).toBeDisabled()

    await u.type(screen.getByLabelText('Name'), 'Cable Crossover')
    // A name alone is not enough: an exercise with no modality cannot be started.
    expect(screen.getByRole('button', { name: 'Add exercise' })).toBeDisabled()

    await u.click(screen.getByRole('radio', { name: 'Resistance band' }))
    expect(screen.getByRole('button', { name: 'Add exercise' })).toBeEnabled()
  })

  it('creates it with a server-minted id and no weekday yet', async () => {
    const u = user()
    renderApp('/settings/exercises')
    await screen.findByRole('heading', { level: 1, name: 'Exercise Library' })

    await u.click(await screen.findByRole('button', { name: /Add exercise/ }))
    await u.type(screen.getByLabelText('Name'), 'Cable Crossover')
    await u.click(screen.getByRole('radio', { name: 'Resistance band' }))
    await u.click(screen.getByRole('button', { name: 'Add exercise' }))

    await waitFor(() => expect(programme.current().revision).toBe(1))
    const created = programme
      .current()
      .exercises.find((e) => e.name === 'Cable Crossover')
    expect(created).toBeDefined()
    expect(created?.custom).toBe(true)
    expect(created?.exerciseId.startsWith('custom-')).toBe(true)

    // No weekday yet — a normal state, not an unfinished one.
    for (const slots of Object.values(programme.current().sessions)) {
      expect(slots.some((s) => s.exerciseId === created?.exerciseId)).toBe(false)
    }
  })
})

/* ------------------------------------------------------------------ */
/* Cross-feature: Training reflects the current programme              */
/* ------------------------------------------------------------------ */

describe('cross-feature: Training shows the current programme', () => {
  it('shows a renamed exercise and an edited prescription before Start', async () => {
    const seed = foundationProgramme()
    programme.setProgramme({
      ...seed,
      revision: 4,
      exercises: seed.exercises.map((e) =>
        e.exerciseId === 'lat-pulldown' ? { ...e, name: 'Band Lat Pulldown' } : e,
      ),
      sessions: {
        ...seed.sessions,
        monday: seed.sessions.monday.map((slot) =>
          slot.exerciseId === 'lat-pulldown'
            ? { ...slot, setCount: 3, targetMin: 8, targetMax: 12 }
            : slot,
        ),
      },
    })

    renderApp('/training/monday')
    await waitFor(() => {
      const heading = screen.getByRole('heading', { level: 1 })
      expect(heading.textContent).not.toBe('Loading')
    })

    await screen.findByText('Band Lat Pulldown')
    // The prescription is rendered inside the compact row summary.
    const main = document.querySelector('main') as HTMLElement
    expect(main.textContent).toContain('3 × 8–12')
    expect(main.textContent).not.toContain('4 × 10–15')
  })

  it('counts the weekday exercises from the programme on the Training week', async () => {
    const seed = foundationProgramme()
    programme.setProgramme({
      ...seed,
      revision: 2,
      sessions: { ...seed.sessions, monday: seed.sessions.monday.slice(0, 2) },
    })

    renderApp('/training')
    await screen.findByRole('heading', { level: 1, name: 'Training' })
    await waitFor(() => expect(screen.getByText('2 exercises')).toBeInTheDocument())
  })
})
