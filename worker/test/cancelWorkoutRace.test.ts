import { describe, expect, it } from 'vitest'

import { createD1WorkoutStore } from '../workouts/d1Store'
import {
  applySetUpdate,
  cancelWorkoutStart,
  readWorkout,
  startWorkout,
  type WorkoutStartInput,
} from '../workouts/workouts'
import { createFakeD1 } from './fakeD1'

/**
 * Round 21 — Cancel Start against a set completion, in both orders.
 *
 * THE SHAPE OF THE BUG THIS PREVENTS.
 *
 * Cancel could have been written as "read the sets, see all pending, delete the
 * occurrence". Two requests then race: the completion commits after the read
 * and before the delete, and a real recorded set is destroyed by a judgement
 * formed before it existed. Earlier rounds had to correct exactly this shape
 * twice, so it is not hypothetical.
 *
 * The fix is that the eligibility test travels INSIDE the delete. These tests
 * prove it by forcing both interleavings deterministically: one side is driven
 * past its pre-read and PARKED at its actual write, the other is allowed to
 * commit, and only then is the parked write released.
 *
 * Nothing here relies on Promise timing or on `Promise.all` happening to
 * interleave. The stand-in parks the statement itself, and D1's single writer
 * is modelled by committing parked writes one at a time.
 */

const ACCOUNT = 'google-sub-a'
const DATE = '2026-09-07'
const SESSION = 'monday'

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
      equipment: null,
      resultKind: 'reps',
      loadMode: 'kg',
      perSide: false,
      setCount: 3,
    },
  ],
}

async function started() {
  const fake = createFakeD1()
  const store = createD1WorkoutStore(fake.db)
  await startWorkout(store, ACCOUNT, DATE, SESSION, MONDAY, 100, 'token-1')
  return { fake, store }
}

const COMPLETE = {
  action: 'complete',
  result: 12,
  load: { value: 20, unit: 'kg' },
  band: null,
} as const

/* ------------------------------------------------------------------ */
/* CASE A — the cancellation commits first                             */
/* ------------------------------------------------------------------ */

describe('CASE A — cancel wins', () => {
  it('leaves no ghost success for a set that no longer exists', async () => {
    const { fake, store } = await started()

    // The completion runs its pre-read and is parked at its actual write.
    const release = fake.holdSetWrites()
    const completion = applySetUpdate(store, ACCOUNT, DATE, SESSION, 0, 0, COMPLETE, 200)

    // The cancellation commits while the completion is still parked.
    const cancelled = await cancelWorkoutStart(store, ACCOUNT, DATE, SESSION)
    expect(cancelled).toEqual({ ok: true })
    expect(fake.occurrences.size).toBe(0)
    expect(fake.workoutSets.size).toBe(0)

    // Now the parked write lands, against a row that is gone.
    release()
    const outcome = await completion

    // The whole point: a controlled refusal, not a success for a row that no
    // longer exists. An UPDATE that quietly matched nothing would otherwise
    // report a completed set inside a cancelled workout.
    expect(outcome).toEqual({ ok: false, reason: 'not_found' })
  })

  it('does not recreate the occurrence or resurrect any row', async () => {
    const { fake, store } = await started()

    const release = fake.holdSetWrites()
    const completion = applySetUpdate(store, ACCOUNT, DATE, SESSION, 0, 0, COMPLETE, 200)
    await cancelWorkoutStart(store, ACCOUNT, DATE, SESSION)
    release()
    await completion

    // Nothing came back: no occurrence, no sets, no calibration, no orphan.
    expect(fake.occurrences.size).toBe(0)
    expect(fake.workoutSets.size).toBe(0)
    expect(fake.calibrations.size).toBe(0)
    expect(await readWorkout(store, ACCOUNT, DATE, SESSION)).toBeNull()
  })

  it('refuses a parked SKIP the same way', async () => {
    const { fake, store } = await started()

    const release = fake.holdSetWrites()
    const skip = applySetUpdate(store, ACCOUNT, DATE, SESSION, 0, 0, { action: 'skip' }, 200)
    await cancelWorkoutStart(store, ACCOUNT, DATE, SESSION)
    release()

    expect(await skip).toEqual({ ok: false, reason: 'not_found' })
    expect(fake.workoutSets.size).toBe(0)
  })
})

/* ------------------------------------------------------------------ */
/* CASE B — the completion commits first                               */
/* ------------------------------------------------------------------ */

describe('CASE B — completion wins', () => {
  it('refuses the cancellation and keeps the completed set exactly', async () => {
    const { fake, store } = await started()

    // The cancellation is parked at its actual write, AFTER any read it does.
    const release = fake.holdCancelWrites()
    const cancelling = cancelWorkoutStart(store, ACCOUNT, DATE, SESSION)

    // The completion commits while the cancellation is parked.
    const completed = await applySetUpdate(store, ACCOUNT, DATE, SESSION, 0, 0, COMPLETE, 200)
    expect(completed.ok).toBe(true)

    // Now the parked delete evaluates its guard against committed state, which
    // now contains a real completed set.
    release()
    expect(await cancelling).toEqual({ ok: false, reason: 'workout_touched' })

    // The workout survives, and the set is byte-for-byte what was recorded.
    expect(fake.occurrences.size).toBe(1)
    expect(fake.workoutSets.size).toBe(3)
    const log = await readWorkout(store, ACCOUNT, DATE, SESSION)
    const set = log?.sets.find((row) => row.exerciseOrder === 0 && row.setIndex === 0)
    expect(set?.status).toBe('completed')
    expect(set?.result).toBe(12)
    expect(set?.loadValue).toBe(20)
    expect(set?.loadUnit).toBe('kg')
  })

  it('performs no partial delete: the other pending sets survive too', async () => {
    const { fake, store } = await started()

    const release = fake.holdCancelWrites()
    const cancelling = cancelWorkoutStart(store, ACCOUNT, DATE, SESSION)
    await applySetUpdate(store, ACCOUNT, DATE, SESSION, 0, 0, COMPLETE, 200)
    release()
    await cancelling

    // All three rows are still there. The children are removed only BECAUSE the
    // parent went, so a refused delete removes nothing at all.
    expect(fake.workoutSets.size).toBe(3)
    const log = await readWorkout(store, ACCOUNT, DATE, SESSION)
    expect(log?.sets).toHaveLength(3)
    expect(log?.sets.filter((set) => set.status === 'pending')).toHaveLength(2)
  })

  it('refuses even when the winning write was a SKIP', async () => {
    const { fake, store } = await started()

    const release = fake.holdCancelWrites()
    const cancelling = cancelWorkoutStart(store, ACCOUNT, DATE, SESSION)
    await applySetUpdate(store, ACCOUNT, DATE, SESSION, 0, 0, { action: 'skip' }, 200)
    release()

    expect(await cancelling).toEqual({ ok: false, reason: 'workout_touched' })
    expect(fake.occurrences.size).toBe(1)
  })
})

/* ------------------------------------------------------------------ */
/* Non-vacuity                                                         */
/* ------------------------------------------------------------------ */

describe('the race tests are not vacuous', () => {
  it('cancels normally when nothing races it', async () => {
    // Without a competing write, the very same call succeeds — so CASE B is
    // about the RACE, not about cancellation being broken.
    const { store } = await started()
    expect(await cancelWorkoutStart(store, ACCOUNT, DATE, SESSION)).toEqual({ ok: true })
  })

  it('completes normally when nothing races it', async () => {
    // And CASE A is about the race, not about completion being broken.
    const { store } = await started()
    const outcome = await applySetUpdate(store, ACCOUNT, DATE, SESSION, 0, 0, COMPLETE, 200)
    expect(outcome.ok).toBe(true)
  })
})
