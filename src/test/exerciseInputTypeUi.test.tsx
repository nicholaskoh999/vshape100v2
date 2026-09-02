import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { authenticatedSession, mockAuthFetch, renderApp } from './authTestUtils'
import {
  createInputTypeServer,
  type InputTypeServer,
} from './exerciseInputTypeApiTestUtils'

/**
 * Round 20 — Settings → Exercise Library → the input type selector.
 *
 * The real router, the real page, the real client and the real hook run against
 * an in-memory stand-in for the API.
 *
 * THIS IS WHERE THE USER TELLS THE APP WHAT ITS OWN DATA MEANS. The app used to
 * decide by pattern-matching the exercise's name and equipment text, which is
 * how a Triceps Pushdown done with three black bands was stored as "3 kg". So
 * the tests below care most about what the page does NOT do: it does not
 * pre-select an answer, it does not claim an exercise is kilograms before the
 * server has spoken, and it does not present a failed load as "not set".
 */

const TRICEPS = '/settings/exercises/triceps-pushdown'

let server: InputTypeServer

beforeEach(() => {
  server = createInputTypeServer()
  mockAuthFetch({ session: authenticatedSession, inputTypes: server })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function user() {
  return userEvent.setup()
}

async function renderAt(path: string) {
  const router = renderApp(path)
  await screen.findByRole('heading', { level: 1 })
  return router
}

/**
 * The input-type group alone.
 *
 * The page also carries the media-kind radios, so every query here is scoped:
 * a bare `getAllByRole('radio')` would silently include controls belonging to
 * a different question.
 */
function group() {
  return within(screen.getByRole('radiogroup', { name: 'Input type' }))
}

function options() {
  return group().getAllByRole('radio')
}

function option(name: string) {
  return group().getByRole('radio', { name: new RegExp(name, 'i') })
}

describe('the input type selector', () => {
  it('offers exactly the three input types, and nothing else', async () => {
    await renderAt(TRICEPS)
    await screen.findByText('Not set yet — this exercise still records the way it always has.')

    const shown = options()
    expect(shown).toHaveLength(3)
    expect(shown.map((node) => node.textContent)).toEqual([
      expect.stringContaining('Weight (kg)'),
      expect.stringContaining('Resistance band'),
      expect.stringContaining('Bodyweight / no load'),
    ])
  })

  it('starts with NOTHING chosen when the exercise has never been answered for', async () => {
    await renderAt(TRICEPS)
    await screen.findByText('Not set yet — this exercise still records the way it always has.')

    // "Never answered" is not "kilograms". Pre-selecting one would put an
    // answer in the user's mouth, which is exactly how the bad data got there.
    for (const node of options()) {
      expect(node).toHaveAttribute('aria-checked', 'false')
    }
  })

  it('marks the programme text’s guess as a SUGGESTION, not as the answer', async () => {
    // Lat Pulldown is the case the text CAN say something about: the Foundation
    // lists it as "BAND 20kg". Even then the guess is offered, not applied.
    await renderAt('/settings/exercises/lat-pulldown')
    await screen.findByText('Not set yet — this exercise still records the way it always has.')

    const band = option('Resistance band')
    expect(band).toHaveTextContent('Suggested')
    expect(band).toHaveAttribute('aria-checked', 'false')
  })

  it('suggests nothing where the programme text says nothing', async () => {
    // Triceps Pushdown carries no equipment text at all, which is exactly why
    // deriving the modality from text could never have worked: the app has no
    // evidence here, and it says so by offering no guess rather than falling
    // back to kilograms.
    await renderAt(TRICEPS)
    await screen.findByText('Not set yet — this exercise still records the way it always has.')

    expect(screen.queryByText('Suggested')).not.toBeInTheDocument()
  })

  it('saves the user’s answer and reflects what the server confirmed', async () => {
    await renderAt(TRICEPS)
    await screen.findByText('Not set yet — this exercise still records the way it always has.')

    await user().click(option('Resistance band'))

    await screen.findByText('Saved.')
    expect(option('Resistance band')).toHaveAttribute('aria-checked', 'true')
    expect(option('Weight \\(kg\\)')).toHaveAttribute('aria-checked', 'false')
    expect(server.rows.get('triceps-pushdown')?.inputType).toBe('resistance_band')
  })

  it('shows the saved answer on a later visit, with no suggestion beside it', async () => {
    server.rows.set('triceps-pushdown', {
      exerciseId: 'triceps-pushdown',
      inputType: 'resistance_band',
      updatedAt: 1,
    })
    await renderAt(TRICEPS)

    await waitFor(() =>
      expect(option('Resistance band')).toHaveAttribute('aria-checked', 'true'),
    )
    // Once the user has answered, the app stops guessing at them.
    expect(screen.queryByText('Suggested')).not.toBeInTheDocument()
  })

  it('replaces the answer rather than accumulating opinions', async () => {
    await renderAt(TRICEPS)
    await screen.findByText('Not set yet — this exercise still records the way it always has.')

    await user().click(option('Resistance band'))
    await screen.findByText('Saved.')
    await user().click(option('Weight \\(kg\\)'))

    await waitFor(() =>
      expect(option('Weight \\(kg\\)')).toHaveAttribute('aria-checked', 'true'),
    )
    expect(option('Resistance band')).toHaveAttribute('aria-checked', 'false')
    expect(server.rows.size).toBe(1)
  })

  it('says a load failed rather than showing a false "not set"', async () => {
    server.failReads(1)
    await renderAt(TRICEPS)

    await screen.findByText('The saved input type could not be loaded.')
    // Critically NOT the unanswered message: that would invite the user to
    // re-answer a question they may have already answered.
    expect(
      screen.queryByText('Not set yet — this exercise still records the way it always has.'),
    ).not.toBeInTheDocument()
    // And nothing is selectable while the truth is unknown.
    for (const node of options()) {
      expect(node).toBeDisabled()
    }
  })

  it('recovers on retry', async () => {
    server.failReads(1)
    await renderAt(TRICEPS)
    await screen.findByText('The saved input type could not be loaded.')

    server.rows.set('triceps-pushdown', {
      exerciseId: 'triceps-pushdown',
      inputType: 'bodyweight',
      updatedAt: 1,
    })
    await user().click(screen.getByRole('button', { name: 'Retry' }))

    await waitFor(() =>
      expect(option('Bodyweight / no load')).toHaveAttribute('aria-checked', 'true'),
    )
  })

  it('says a save failed, and keeps showing the answer that is actually stored', async () => {
    server.rows.set('triceps-pushdown', {
      exerciseId: 'triceps-pushdown',
      inputType: 'weight_kg',
      updatedAt: 1,
    })
    await renderAt(TRICEPS)
    await waitFor(() =>
      expect(option('Weight \\(kg\\)')).toHaveAttribute('aria-checked', 'true'),
    )

    server.failMutations(1)
    await user().click(option('Resistance band'))

    await screen.findByText('Could not save the input type. Nothing was changed.')
    // The selection does not move to the value that failed to save.
    expect(option('Weight \\(kg\\)')).toHaveAttribute('aria-checked', 'true')
    expect(server.rows.get('triceps-pushdown')?.inputType).toBe('weight_kg')
  })

  it('tells the user this changes future workouts, not recorded ones', async () => {
    await renderAt(TRICEPS)
    // The promise the whole round rests on, said where the user makes the
    // decision rather than only in the code.
    await screen.findByText(/sets you have already recorded are never altered/i)
  })

  it('reads and writes the one canonical record for this exercise slug', async () => {
    await renderAt(TRICEPS)
    await screen.findByText('Not set yet — this exercise still records the way it always has.')
    await user().click(option('Bodyweight / no load'))
    await screen.findByText('Saved.')

    // Every call named this exercise and no other. One canonical answer, shared
    // by every day it is trained.
    expect(server.calls.every((call) => call.exerciseId === 'triceps-pushdown')).toBe(true)
    expect(server.calls.some((call) => call.method === 'PUT')).toBe(true)
  })

  it('shows on the Library list which exercises have been answered for', async () => {
    server.rows.set('triceps-pushdown', {
      exerciseId: 'triceps-pushdown',
      inputType: 'resistance_band',
      updatedAt: 1,
    })
    await renderAt('/settings/exercises')

    const triceps = await screen.findByRole('link', {
      name: 'Edit settings for Triceps Pushdown',
    })
    expect(within(triceps).getByText('Resistance band')).toBeInTheDocument()

    // An exercise nobody has answered for says exactly that. "Not set" and
    // "kilograms" are different facts and must not look alike.
    const latPulldown = screen.getByRole('link', {
      name: 'Edit settings for Lat Pulldown',
    })
    expect(within(latPulldown).getByText('Input type not set')).toBeInTheDocument()
  })

  it('says it is still checking rather than claiming nothing is set', async () => {
    server.failReads(1)
    await renderAt('/settings/exercises')

    const rows = await screen.findAllByRole('link', { name: /^Edit settings for / })
    // The read failed, so the answer is unknown — never rendered as "not set".
    expect(within(rows[0]).getByText('Checking input type')).toBeInTheDocument()
    expect(screen.queryByText('Input type not set')).not.toBeInTheDocument()
  })
})

/* ------------------------------------------------------------------ */
/* Correction 2 — an unreadable setting must be repairable HERE        */
/* ------------------------------------------------------------------ */

/**
 * The Library tells the user their setting could not be read and to set it
 * again. Correction 1 answered 500 for that item read, so the editor saw a
 * failed request and disabled every choice: the user was instructed to fix
 * something the app would not let them fix, and the only ways out were the API
 * or the database.
 *
 * `unreadable` and "the read failed" are different facts, and the difference
 * decides whether the user can act. These tests hold both apart.
 */
describe('repairing an unreadable input type', () => {
  /** A stored row holding a value this build cannot read. */
  function seedUnreadable() {
    server.rows.set('triceps-pushdown', {
      exerciseId: 'triceps-pushdown',
      inputType: 'elastic_vibes',
      updatedAt: 1,
    })
  }

  it('says so on the Library row', async () => {
    seedUnreadable()
    await renderAt('/settings/exercises')

    const row = await screen.findByRole('link', {
      name: 'Edit settings for Triceps Pushdown',
    })
    expect(within(row).getByText(/could not be read/i)).toBeInTheDocument()
    // Not "not set": the user HAS answered, and saying otherwise hides that
    // this exercise's workouts are being refused.
    expect(within(row).queryByText('Input type not set')).not.toBeInTheDocument()
  })

  it('offers the choices ENABLED, with nothing selected and no false "not set"', async () => {
    seedUnreadable()
    await renderAt(TRICEPS)

    await screen.findByText(/Saved input type could not be read/i)
    expect(
      screen.queryByText('Not set yet — this exercise still records the way it always has.'),
    ).not.toBeInTheDocument()

    for (const node of options()) {
      expect(node).toBeEnabled()
      expect(node).toHaveAttribute('aria-checked', 'false')
    }
    // And no suggestion: putting the programme's guess in front of the user
    // would present their deliberate choice as though it were never made.
    expect(screen.queryByText('Suggested')).not.toBeInTheDocument()
  })

  it('replaces the corrupt row when the user chooses, and reads back readable', async () => {
    seedUnreadable()
    await renderAt(TRICEPS)
    await screen.findByText(/Saved input type could not be read/i)

    await user().click(option('Resistance band'))
    await screen.findByText('Saved.')

    // The row was REPLACED through the ordinary upsert — one row, not two.
    expect(server.rows.size).toBe(1)
    expect(server.rows.get('triceps-pushdown')?.inputType).toBe('resistance_band')
    expect(option('Resistance band')).toHaveAttribute('aria-checked', 'true')
    // The warning is gone, because the setting is no longer unreadable.
    expect(screen.queryByText(/Saved input type could not be read/i)).not.toBeInTheDocument()
  })

  it('reads back as an ordinary readable setting afterwards', async () => {
    seedUnreadable()
    await renderAt(TRICEPS)
    await screen.findByText(/Saved input type could not be read/i)
    await user().click(option('Resistance band'))
    await screen.findByText('Saved.')

    // A fresh visit: the repair is durable, not a local optimism.
    cleanup()
    await renderAt(TRICEPS)
    await waitFor(() =>
      expect(option('Resistance band')).toHaveAttribute('aria-checked', 'true'),
    )
    expect(screen.queryByText(/could not be read/i)).not.toBeInTheDocument()
  })

  it('shows the Library row as repaired afterwards', async () => {
    seedUnreadable()
    await renderAt(TRICEPS)
    await screen.findByText(/Saved input type could not be read/i)
    await user().click(option('Resistance band'))
    await screen.findByText('Saved.')

    cleanup()
    await renderAt('/settings/exercises')
    const row = await screen.findByRole('link', {
      name: 'Edit settings for Triceps Pushdown',
    })
    expect(within(row).getByText('Resistance band')).toBeInTheDocument()
    expect(within(row).queryByText(/could not be read/i)).not.toBeInTheDocument()
  })

  it('never repairs, deletes or defaults the setting on its own', async () => {
    seedUnreadable()
    await renderAt(TRICEPS)
    await screen.findByText(/Saved input type could not be read/i)

    // Merely opening the editor changes nothing. The app does not know what the
    // user meant, and guessing is the failure this round exists to remove.
    expect(server.rows.get('triceps-pushdown')?.inputType).toBe('elastic_vibes')
    expect(server.calls.every((call) => call.method === 'GET')).toBe(true)
  })

  /* ---- the control: a genuine read failure still fails closed ------ */

  it('DISABLES the choices when the read itself failed', async () => {
    // The distinction that matters. Here we do not know WHICH state the stored
    // setting is in, so offering to overwrite it blind would risk destroying a
    // perfectly good answer.
    server.failReads(1)
    await renderAt(TRICEPS)

    await screen.findByText('The saved input type could not be loaded.')
    expect(screen.queryByText(/Saved input type could not be read/i)).not.toBeInTheDocument()
    for (const node of options()) {
      expect(node).toBeDisabled()
    }
    // And a way back that re-establishes the truth rather than overwriting it.
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })

  it('writes nothing while the read is failed, even if a choice is clicked', async () => {
    server.rows.set('triceps-pushdown', {
      exerciseId: 'triceps-pushdown',
      inputType: 'weight_kg',
      updatedAt: 1,
    })
    server.failReads(1)
    await renderAt(TRICEPS)
    await screen.findByText('The saved input type could not be loaded.')

    await user().click(option('Resistance band'))

    // The perfectly good stored answer survives.
    expect(server.rows.get('triceps-pushdown')?.inputType).toBe('weight_kg')
    expect(server.calls.some((call) => call.method === 'PUT')).toBe(false)
  })
})
