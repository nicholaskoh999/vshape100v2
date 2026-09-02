import { describe, expect, it } from 'vitest'

import { createD1WorkoutStore } from '../workouts/d1Store'
import {
  applySetUpdate,
  cancelWorkoutStart,
  isCancelable,
  readWorkout,
  startWorkout,
  undoSet,
  type StartOutcome,
  type StartResult,
  type WorkoutStartInput,
  type WorkoutStore,
} from '../workouts/workouts'
import { createFakeD1 } from './fakeD1'

/**
 * Round 21 — taking back a Start that should never have happened.
 *
 * THE PROBLEM.
 *
 * Pressing Start writes a durable occurrence and a full set of pending rows.
 * Until now there was no way back, so a mis-tap became permanent history — and
 * the user is carrying several such workouts in the current week.
 *
 * WHAT MAKES THIS SAFE.
 *
 * Cancel removes ONLY an occurrence that was never worked in, and "never worked
 * in" is deliberately stronger than "looks pending right now". A workout that
 * was completed and then undone is a workout the user genuinely trained in; the
 * sets are pending again, but the training happened, and it must not become
 * disposable. That distinction is durable, not a client flag.
 *
 * And the decision lives in the WRITE. Nothing reads "all pending" and then
 * deletes — that is the stale-read shape earlier rounds already had to correct.
 */

const ACCOUNT_A = 'google-sub-a'
const ACCOUNT_B = 'google-sub-b'
const DATE = '2026-09-07'
const PAST = '2026-08-31'

function unwrap(outcome: StartOutcome): StartResult {
  if (!outcome.ok) throw new Error(`unexpected Start refusal: ${outcome.reason}`)
  return outcome.result
}

const MONDAY: WorkoutStartInput = {
  day: 'Monday',
  focus: 'Back Width + Biceps',
  intensity: 'HARD',
  sourceSessionId: null,
  exercises: [
    {
      exerciseId: 'lat-pulldown',
      name: 'Lat Pulldown',
      prescription: '4 x 10-15',
      equipment: 'BAND 20kg',
      resultKind: 'reps',
      loadMode: 'kg',
      perSide: false,
      setCount: 3,
    },
  ],
}

const EXTRA: WorkoutStartInput = { ...MONDAY, sourceSessionId: 'monday' }

function makeStore() {
  const fake = createFakeD1()
  return { fake, store: createD1WorkoutStore(fake.db) }
}

async function start(
  store: WorkoutStore,
  account = ACCOUNT_A,
  date = DATE,
  session = 'monday',
  input = MONDAY,
  now = 100,
) {
  return unwrap(await startWorkout(store, account, date, session, input, now, `token-${date}-${session}`))
}

/* ------------------------------------------------------------------ */
/* A. What may be cancelled                                            */
/* ------------------------------------------------------------------ */

describe('A. an untouched workout can be taken back', () => {
  it('cancels a freshly started, all-pending workout', async () => {
    const { store } = makeStore()
    await start(store)

    expect(await cancelWorkoutStart(store, ACCOUNT_A, DATE, 'monday')).toEqual({ ok: true })
    // The same shape a never-started workout reads as, so the Training page
    // returns to "Workout not started" with no special case.
    expect(await readWorkout(store, ACCOUNT_A, DATE, 'monday')).toBeNull()
  })

  it('cancels a PAST-DATE untouched workout', async () => {
    // Load-bearing: the user already has accidental Starts on earlier days of
    // this training week, and they have to be fixable after Round 21 ships.
    const { store } = makeStore()
    await start(store, ACCOUNT_A, PAST)

    expect(await cancelWorkoutStart(store, ACCOUNT_A, PAST, 'monday')).toEqual({ ok: true })
    expect(await readWorkout(store, ACCOUNT_A, PAST, 'monday')).toBeNull()
  })

  it('cancels an untouched Extra, without relabelling anything', async () => {
    const { store } = makeStore()
    const extra = await start(store, ACCOUNT_A, DATE, 'extra', EXTRA)
    expect(extra.occurrence.kind).toBe('extra')

    expect(await cancelWorkoutStart(store, ACCOUNT_A, DATE, 'extra')).toEqual({ ok: true })
    expect(await readWorkout(store, ACCOUNT_A, DATE, 'extra')).toBeNull()
  })

  it('removes the sets with it, leaving no orphan', async () => {
    const { fake, store } = makeStore()
    await start(store)
    expect(fake.workoutSets.size).toBe(3)

    await cancelWorkoutStart(store, ACCOUNT_A, DATE, 'monday')

    expect(fake.occurrences.size).toBe(0)
    expect(fake.workoutSets.size).toBe(0)
    expect(fake.calibrations.size).toBe(0)
  })

  it('touches nothing else: another session, another date, another account', async () => {
    const { fake, store } = makeStore()
    await start(store, ACCOUNT_A, DATE, 'monday')
    await start(store, ACCOUNT_A, DATE, 'extra', EXTRA)
    await start(store, ACCOUNT_A, PAST, 'monday')
    await start(store, ACCOUNT_B, DATE, 'monday')
    expect(fake.occurrences.size).toBe(4)

    await cancelWorkoutStart(store, ACCOUNT_A, DATE, 'monday')

    expect(fake.occurrences.size).toBe(3)
    expect(await readWorkout(store, ACCOUNT_A, DATE, 'monday')).toBeNull()
    expect(await readWorkout(store, ACCOUNT_A, DATE, 'extra')).not.toBeNull()
    expect(await readWorkout(store, ACCOUNT_A, PAST, 'monday')).not.toBeNull()
    expect(await readWorkout(store, ACCOUNT_B, DATE, 'monday')).not.toBeNull()
    expect(fake.workoutSets.size).toBe(9)
  })

  it('reports a second cancel as nothing to cancel', async () => {
    const { store } = makeStore()
    await start(store)
    await cancelWorkoutStart(store, ACCOUNT_A, DATE, 'monday')

    expect(await cancelWorkoutStart(store, ACCOUNT_A, DATE, 'monday')).toEqual({
      ok: false,
      reason: 'not_started',
    })
  })

  it('reports a never-started workout as nothing to cancel', async () => {
    const { store } = makeStore()
    expect(await cancelWorkoutStart(store, ACCOUNT_A, DATE, 'monday')).toEqual({
      ok: false,
      reason: 'not_started',
    })
  })
})

/* ------------------------------------------------------------------ */
/* B. What may NOT                                                     */
/* ------------------------------------------------------------------ */

describe('B. a workout that was worked in stays', () => {
  it('refuses when one set is completed', async () => {
    const { fake, store } = makeStore()
    await start(store)
    await applySetUpdate(store, ACCOUNT_A, DATE, 'monday', 0, 0, {
      action: 'complete', result: 12, load: { value: 20, unit: 'kg' }, band: null,
    }, 200)

    expect(await cancelWorkoutStart(store, ACCOUNT_A, DATE, 'monday')).toEqual({
      ok: false, reason: 'workout_touched',
    })
    expect(fake.occurrences.size).toBe(1)
    expect(fake.workoutSets.size).toBe(3)
  })

  it('refuses when one set is skipped', async () => {
    const { store } = makeStore()
    await start(store)
    await applySetUpdate(store, ACCOUNT_A, DATE, 'monday', 0, 0, { action: 'skip' }, 200)

    expect(await cancelWorkoutStart(store, ACCOUNT_A, DATE, 'monday')).toEqual({
      ok: false, reason: 'workout_touched',
    })
  })

  it('STILL refuses after Complete then Undo', async () => {
    // The case the whole durable marker exists for. Every set is pending again
    // and the progress summary reads 0 / 0, but this workout was genuinely
    // worked in and is not disposable.
    const { fake, store } = makeStore()
    await start(store)
    await applySetUpdate(store, ACCOUNT_A, DATE, 'monday', 0, 0, {
      action: 'complete', result: 12, load: { value: 20, unit: 'kg' }, band: null,
    }, 200)
    await undoSet(store, ACCOUNT_A, DATE, 'monday', 0, 0, 300)

    const log = await readWorkout(store, ACCOUNT_A, DATE, 'monday')
    expect(log?.sets.every((set) => set.status === 'pending')).toBe(true)

    expect(await cancelWorkoutStart(store, ACCOUNT_A, DATE, 'monday')).toEqual({
      ok: false, reason: 'workout_touched',
    })
    expect(fake.occurrences.size).toBe(1)
  })

  it('STILL refuses after Skip then Undo', async () => {
    const { store } = makeStore()
    await start(store)
    await applySetUpdate(store, ACCOUNT_A, DATE, 'monday', 0, 0, { action: 'skip' }, 200)
    await undoSet(store, ACCOUNT_A, DATE, 'monday', 0, 0, 300)

    expect(await cancelWorkoutStart(store, ACCOUNT_A, DATE, 'monday')).toEqual({
      ok: false, reason: 'workout_touched',
    })
  })

  it('refuses on stale evidence sitting on a pending row', async () => {
    // A row that says pending but still carries a recorded load contradicts
    // itself. Cancel is a destructive operation, so it fails closed.
    const { fake, store } = makeStore()
    await start(store)
    for (const row of fake.workoutSets.values()) row.actual_load_value = 20

    expect(await cancelWorkoutStart(store, ACCOUNT_A, DATE, 'monday')).toEqual({
      ok: false, reason: 'workout_touched',
    })
    expect(fake.occurrences.size).toBe(1)
  })

  it('refuses on a stale recorded result, and on a stale band', async () => {
    for (const field of ['actual_result', 'actual_band_label', 'actual_band_count'] as const) {
      const { fake, store } = makeStore()
      await start(store)
      for (const row of fake.workoutSets.values()) {
        ;(row as Record<string, unknown>)[field] = field === 'actual_band_label' ? 'Black' : 3
      }
      expect(
        await cancelWorkoutStart(store, ACCOUNT_A, DATE, 'monday'),
        field,
      ).toEqual({ ok: false, reason: 'workout_touched' })
      expect(fake.occurrences.size, field).toBe(1)
    }
  })

  it('refuses a PRE-Round-21 workout that was resolved and undone', async () => {
    // Older occurrences carry no touch marker, because the migration
    // deliberately back-fills nothing. They are protected instead by the set's
    // own clock having moved away from the moment the workout was started.
    const { fake, store } = makeStore()
    await start(store)
    await applySetUpdate(store, ACCOUNT_A, DATE, 'monday', 0, 0, {
      action: 'complete', result: 12, load: { value: 20, unit: 'kg' }, band: null,
    }, 200)
    await undoSet(store, ACCOUNT_A, DATE, 'monday', 0, 0, 300)
    // Strip the Round 21 marker, leaving exactly the shape of a workout that
    // predates it.
    for (const row of fake.occurrences.values()) row.touched_at = null

    expect(await cancelWorkoutStart(store, ACCOUNT_A, DATE, 'monday')).toEqual({
      ok: false, reason: 'workout_touched',
    })
  })

  it('still cancels a PRE-Round-21 workout that was genuinely never worked in', async () => {
    // NON-VACUITY for the condition above: the marker being absent is not by
    // itself a refusal, or the user could never take back the accidental Starts
    // they already have.
    const { store, fake } = makeStore()
    await start(store, ACCOUNT_A, PAST)
    for (const row of fake.occurrences.values()) row.touched_at = null

    expect(await cancelWorkoutStart(store, ACCOUNT_A, PAST, 'monday')).toEqual({ ok: true })
  })

  it('lets one account cancel only its own workout', async () => {
    const { fake, store } = makeStore()
    await start(store, ACCOUNT_B, DATE, 'monday')

    // A cancels; B's workout is not theirs to remove.
    expect(await cancelWorkoutStart(store, ACCOUNT_A, DATE, 'monday')).toEqual({
      ok: false, reason: 'not_started',
    })
    expect(fake.occurrences.size).toBe(1)
    expect(await readWorkout(store, ACCOUNT_B, DATE, 'monday')).not.toBeNull()
  })
})

/* ------------------------------------------------------------------ */
/* C. The advisory flag agrees with the authority                      */
/* ------------------------------------------------------------------ */

describe('C. the cancelable hint never contradicts the write', () => {
  it('says yes exactly when the write would allow it', async () => {
    const { store } = makeStore()
    await start(store)
    const fresh = await readWorkout(store, ACCOUNT_A, DATE, 'monday')
    expect(isCancelable(fresh!)).toBe(true)

    await applySetUpdate(store, ACCOUNT_A, DATE, 'monday', 0, 0, {
      action: 'complete', result: 12, load: { value: 20, unit: 'kg' }, band: null,
    }, 200)
    await undoSet(store, ACCOUNT_A, DATE, 'monday', 0, 0, 300)

    const undone = await readWorkout(store, ACCOUNT_A, DATE, 'monday')
    // Every set is pending, yet the hint says no — matching the server, so the
    // UI does not offer a button that would be refused.
    expect(undone!.sets.every((set) => set.status === 'pending')).toBe(true)
    expect(isCancelable(undone!)).toBe(false)
  })
})
