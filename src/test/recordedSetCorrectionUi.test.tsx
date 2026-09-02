import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { authenticatedSession, mockAuthFetch, renderApp } from './authTestUtils'
import { createWorkoutServer, type WorkoutServer } from './workoutApiTestUtils'

/**
 * Round 21 — correcting recorded history, and taking back a past accidental
 * Start, from Progress → Recent Workouts.
 *
 * This is where the user actually meets both problems: their Triceps sets say
 * "3 kg × 12" for what were three black bands, and their accidental Monday and
 * Wednesday Starts are sitting in the list with nothing recorded in them.
 *
 * The real router, page, client and stand-in run together. The stand-in mirrors
 * the server's rules — optimistic concurrency, no-op detection, and the
 * untouched test — rather than inventing its own answers.
 */

const TODAY = new Date(2026, 8, 7, 9, 0)
const SESSION = 'tuesday'
const DATE = '2026-09-01'

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

/** One recorded workout holding the real legacy defect: bands stored as kg. */
function seedLegacyTriceps(date = DATE) {
  server.seed(date, SESSION, {
    occurrence: {
      date,
      sessionId: SESSION,
      day: 'Tuesday',
      focus: 'Chest + Triceps',
      intensity: 'HARD',
      startedAt: 1,
      updatedAt: 5,
    },
    touchedAt: 5,
    sets: [
      {
        exerciseOrder: 0,
        setIndex: 0,
        exerciseId: 'triceps-pushdown',
        exerciseName: 'Triceps Pushdown',
        prescription: '3 × 12–15',
        equipment: 'BAND',
        resultKind: 'reps',
        loadMode: 'kg',
        perSide: false,
        inputType: 'weight_kg',
        status: 'completed',
        load: { value: 3, unit: 'kg' },
        band: null,
        result: 12,
        updatedAt: 5,
      },
      {
        exerciseOrder: 0,
        setIndex: 1,
        exerciseId: 'triceps-pushdown',
        exerciseName: 'Triceps Pushdown',
        prescription: '3 × 12–15',
        equipment: 'BAND',
        resultKind: 'reps',
        loadMode: 'kg',
        perSide: false,
        inputType: 'weight_kg',
        status: 'pending',
        load: null,
        band: null,
        result: null,
        updatedAt: 1,
      },
    ],
  })
}

/** An untouched workout on an earlier day — an accidental Start. */
function seedAccidentalStart(date: string) {
  server.seed(date, 'monday', {
    occurrence: {
      date,
      sessionId: 'monday',
      day: 'Monday',
      focus: 'Back Width + Biceps',
      intensity: 'HARD',
      startedAt: 1,
      updatedAt: 1,
    },
    sets: [
      {
        exerciseOrder: 0,
        setIndex: 0,
        exerciseId: 'lat-pulldown',
        exerciseName: 'Lat Pulldown',
        prescription: '4 × 10–15',
        equipment: null,
        resultKind: 'reps',
        loadMode: 'kg',
        perSide: false,
        inputType: 'weight_kg',
        status: 'pending',
        load: null,
        band: null,
        result: null,
        updatedAt: 1,
      },
    ],
  })
}

async function openProgress() {
  const u = user()
  renderApp('/progress')
  await screen.findByRole('heading', { level: 1 })
  return u
}

async function openRecordedSets(u: ReturnType<typeof user>, label = /Recorded sets/) {
  const toggle = await screen.findByRole('button', { name: label })
  await u.click(toggle)
  return toggle
}

/* ------------------------------------------------------------------ */
/* Correcting a recorded set                                           */
/* ------------------------------------------------------------------ */

describe('correcting a recorded set', () => {
  it('lists only the COMPLETED sets, showing what each recorded', async () => {
    seedLegacyTriceps()
    const u = await openProgress()
    await openRecordedSets(u)

    // The legacy defect, as the user sees it today.
    await screen.findByText(/3 kg × 12 reps/)
    // The pending set has no recorded performance to correct, so it is not
    // offered — a correction must never look like a way to complete a set.
    expect(screen.getAllByRole('button', { name: 'Edit recorded set' })).toHaveLength(1)
  })

  it('corrects 3 kg × 12 into Black ×3 · 12 reps', async () => {
    seedLegacyTriceps()
    const u = await openProgress()
    await openRecordedSets(u)
    await u.click(await screen.findByRole('button', { name: 'Edit recorded set' }))

    await u.click(screen.getByRole('radio', { name: 'Resistance band' }))
    await u.type(screen.getByLabelText('Band'), 'Black')
    await u.type(screen.getByLabelText('How many'), '3')
    await u.click(screen.getByRole('button', { name: 'Save correction' }))

    // The line now says what actually happened, with no kilograms in it.
    await screen.findByText(/Black ×3 · 12 reps/)
    expect(screen.queryByText(/3 kg × 12 reps/)).not.toBeInTheDocument()

    // And the stored set agrees.
    const stored = server.workouts.get(`${DATE}#${SESSION}`)!.sets[0]
    expect(stored.inputType).toBe('resistance_band')
    expect(stored.band).toEqual({ label: 'Black', count: 3 })
    expect(stored.load).toBeNull()
    // Still completed: a correction changes the reading, not the training.
    expect(stored.status).toBe('completed')
  })

  it('marks the set as Corrected afterwards', async () => {
    seedLegacyTriceps()
    const u = await openProgress()
    await openRecordedSets(u)
    await u.click(await screen.findByRole('button', { name: 'Edit recorded set' }))
    await u.click(screen.getByRole('radio', { name: 'Resistance band' }))
    await u.type(screen.getByLabelText('Band'), 'Black')
    await u.type(screen.getByLabelText('How many'), '3')
    await u.click(screen.getByRole('button', { name: 'Save correction' }))

    await screen.findByText('Corrected')
  })

  it('says so, and writes nothing, when the correction changes nothing', async () => {
    seedLegacyTriceps()
    const u = await openProgress()
    await openRecordedSets(u)
    await u.click(await screen.findByRole('button', { name: 'Edit recorded set' }))

    // The form is prefilled with the current truth; saving it unchanged is not
    // a correction, and must not be recorded as one.
    await u.click(screen.getByRole('button', { name: 'Save correction' }))

    await screen.findByText(/already what this set records/i)
    expect(server.workouts.get(`${DATE}#${SESSION}`)!.corrections ?? []).toHaveLength(0)
  })

  it('explains that it does not change workout completion', async () => {
    seedLegacyTriceps()
    const u = await openProgress()
    await openRecordedSets(u)
    await u.click(await screen.findByRole('button', { name: 'Edit recorded set' }))

    await screen.findByText(/does not change workout completion/i)
  })

  it('refuses to save an incomplete band correction', async () => {
    seedLegacyTriceps()
    const u = await openProgress()
    await openRecordedSets(u)
    await u.click(await screen.findByRole('button', { name: 'Edit recorded set' }))
    await u.click(screen.getByRole('radio', { name: 'Resistance band' }))

    // A band with no name records nothing usable.
    await u.type(screen.getByLabelText('How many'), '3')
    expect(screen.getByRole('button', { name: 'Save correction' })).toBeDisabled()

    await u.type(screen.getByLabelText('Band'), 'Black')
    expect(screen.getByRole('button', { name: 'Save correction' })).toBeEnabled()
  })

  it('keeps kg_each meaning PER DUMBBELL', async () => {
    seedLegacyTriceps()
    const u = await openProgress()
    await openRecordedSets(u)
    await u.click(await screen.findByRole('button', { name: 'Edit recorded set' }))

    await u.click(screen.getByRole('radio', { name: 'kg each' }))
    await u.clear(screen.getByLabelText('Load'))
    await u.type(screen.getByLabelText('Load'), '12')
    await u.click(screen.getByRole('button', { name: 'Save correction' }))

    await screen.findByText(/12 kg each × 12 reps/)
    expect(server.workouts.get(`${DATE}#${SESSION}`)!.sets[0].load).toEqual({
      value: 12,
      unit: 'kg_each',
    })
  })

  it('refuses to overwrite a set that changed while the editor was open', async () => {
    seedLegacyTriceps()
    const u = await openProgress()
    await openRecordedSets(u)
    await u.click(await screen.findByRole('button', { name: 'Edit recorded set' }))

    // Somebody else corrects the set in between.
    const stored = server.workouts.get(`${DATE}#${SESSION}`)!
    stored.sets[0].load = { value: 9, unit: 'kg' }
    stored.sets[0].updatedAt = 99

    await u.click(screen.getByRole('radio', { name: 'Resistance band' }))
    await u.type(screen.getByLabelText('Band'), 'Black')
    await u.type(screen.getByLabelText('How many'), '3')
    await u.click(screen.getByRole('button', { name: 'Save correction' }))

    await screen.findByText(/changed while you were editing/i)
    // Nothing was overwritten: the other change survives.
    expect(stored.sets[0].load).toEqual({ value: 9, unit: 'kg' })
    expect(stored.sets[0].band).toBeNull()
  })

  it('reports a failure without changing anything', async () => {
    seedLegacyTriceps()
    const u = await openProgress()
    await openRecordedSets(u)
    await u.click(await screen.findByRole('button', { name: 'Edit recorded set' }))
    server.failMutations(1)

    await u.click(screen.getByRole('radio', { name: 'Resistance band' }))
    await u.type(screen.getByLabelText('Band'), 'Black')
    await u.type(screen.getByLabelText('How many'), '3')
    await u.click(screen.getByRole('button', { name: 'Save correction' }))

    await screen.findByText(/Could not save the correction/i)
    expect(server.workouts.get(`${DATE}#${SESSION}`)!.sets[0].load).toEqual({
      value: 3,
      unit: 'kg',
    })
  })
})

/* ------------------------------------------------------------------ */
/* Taking back a past accidental Start                                 */
/* ------------------------------------------------------------------ */

describe('cancelling a past accidental Start from Recent Workouts', () => {
  it('offers Cancel on an untouched past workout, and removes it', async () => {
    seedAccidentalStart('2026-09-02')
    const u = await openProgress()
    await openRecordedSets(u)

    await screen.findByText('No completed sets in this workout.')
    await u.click(await screen.findByRole('button', { name: 'Cancel workout start' }))
    await screen.findByText('Cancel this workout?')
    await u.click(screen.getByRole('button', { name: 'Cancel workout' }))

    await waitFor(() => expect(server.workouts.size).toBe(0))
  })

  it('does NOT offer Cancel on a workout with recorded sets', async () => {
    seedLegacyTriceps()
    const u = await openProgress()
    await openRecordedSets(u)

    await screen.findByText(/3 kg × 12 reps/)
    expect(screen.queryByRole('button', { name: 'Cancel workout start' })).toBeNull()
  })

  it('keeps the workout when the user backs out', async () => {
    seedAccidentalStart('2026-09-02')
    const u = await openProgress()
    await openRecordedSets(u)
    await u.click(await screen.findByRole('button', { name: 'Cancel workout start' }))
    await u.click(screen.getByRole('button', { name: 'Keep workout' }))

    expect(screen.queryByText('Cancel this workout?')).not.toBeInTheDocument()
    expect(server.workouts.size).toBe(1)
  })

  it('says so, and keeps everything, when the server refuses', async () => {
    seedAccidentalStart('2026-09-02')
    const u = await openProgress()
    await openRecordedSets(u)
    await u.click(await screen.findByRole('button', { name: 'Cancel workout start' }))

    // It is worked in between opening the dialog and confirming.
    const stored = server.workouts.get('2026-09-02#monday')!
    stored.touchedAt = 9
    stored.sets[0].status = 'completed'
    stored.sets[0].result = 10
    stored.sets[0].updatedAt = 9

    await u.click(screen.getByRole('button', { name: 'Cancel workout' }))

    await screen.findByText(/cannot be cancelled/i)
    expect(server.workouts.size).toBe(1)
  })
})

/* ------------------------------------------------------------------ */
/* What a correction must not disturb                                  */
/* ------------------------------------------------------------------ */

describe('a correction does not move completion truth', () => {
  it('leaves every set’s status exactly as it was', async () => {
    seedLegacyTriceps()
    const u = await openProgress()

    const statuses = () =>
      server.workouts
        .get(`${DATE}#${SESSION}`)!
        .sets.map((set) => `${set.exerciseOrder}:${set.setIndex}=${set.status}`)
    const before = statuses()

    await openRecordedSets(u)
    await u.click(await screen.findByRole('button', { name: 'Edit recorded set' }))
    await u.click(screen.getByRole('radio', { name: 'Resistance band' }))
    await u.type(screen.getByLabelText('Band'), 'Black')
    await u.type(screen.getByLabelText('How many'), '3')
    await u.click(screen.getByRole('button', { name: 'Save correction' }))
    await screen.findByText(/Black ×3 · 12 reps/)

    // The measurement changed; what happened did not. Completed-set counts,
    // the scheduled streak and Achievement qualification all read from these
    // statuses, so none of them can move.
    expect(statuses()).toEqual(before)
    expect(before).toEqual(['0:0=completed', '0:1=pending'])
  })

  it('leaves the workout occurrence itself untouched', async () => {
    seedLegacyTriceps()
    const u = await openProgress()
    const occurrence = { ...server.workouts.get(`${DATE}#${SESSION}`)!.occurrence }

    await openRecordedSets(u)
    await u.click(await screen.findByRole('button', { name: 'Edit recorded set' }))
    await u.click(screen.getByRole('radio', { name: 'Resistance band' }))
    await u.type(screen.getByLabelText('Band'), 'Black')
    await u.type(screen.getByLabelText('How many'), '3')
    await u.click(screen.getByRole('button', { name: 'Save correction' }))
    await screen.findByText(/Black ×3 · 12 reps/)

    // Date, session, provenance and the frozen snapshots are not the
    // correction's to touch.
    expect(server.workouts.get(`${DATE}#${SESSION}`)!.occurrence).toEqual(occurrence)
  })
})
