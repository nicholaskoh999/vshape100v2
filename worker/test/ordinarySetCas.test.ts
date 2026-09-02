import { describe, expect, it } from 'vitest'

import { createD1WorkoutStore } from '../workouts/d1Store'
import {
  applySetUpdate,
  cancelWorkoutStart,
  correctSet,
  readWorkout,
  startWorkout,
  undoSet,
  type WorkoutSetRecord,
  type WorkoutSetUpdate,
  type WorkoutStartInput,
  type WorkoutStore,
} from '../workouts/workouts'
import { createFakeD1 } from './fakeD1'

/**
 * Round 21 Correction 3 — ordinary set mutations are compare-and-swap writes.
 *
 * THE SHAPE OF THE BUG THIS PREVENTS.
 *
 * `nextSetVersion` made a successful write always produce a version ahead of
 * the one it replaced. That closed the same-millisecond hole for History
 * Correction, but it said nothing about two ordinary requests reading the same
 * version before either of them wrote:
 *
 *   stored version T
 *   B reads T, C reads T
 *   both compute nextSetVersion(T, T) = T + 1
 *   B commits: version T + 1
 *   C commits: version T + 1
 *
 * Two requests changed the same recorded set, both were told it worked, and the
 * version moved once. C silently replaced B. Worse, an editor who opened the
 * set between the two writes read T + 1 — which still matches after C — so a
 * History Correction saved against it would discard C as well, without the
 * conflict the contract promises.
 *
 * D1 does not save this. Its single writer serialises the two WRITES. It does
 * not stop the two READS from both happening first.
 *
 * The fix is that the version the caller read travels into the UPDATE's own
 * WHERE clause. The second write then matches no row, and loses honestly.
 *
 * Nothing below relies on Promise timing. Both racers are driven past their
 * pre-reads and PARKED at their actual writes, then released one at a time in a
 * chosen order. The clock never moves either: every mutation is handed the same
 * instant, because it is the CAS condition and not the clock that must decide.
 */

const ACCOUNT = 'google-sub-a'
const DATE = '2026-09-07'
const SESSION = 'monday'
/** One fixed instant. Every write in this file is handed exactly this. */
const T = 200

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

/** A workout whose sets are all stored at version T. */
async function started() {
  const fake = createFakeD1()
  const store = createD1WorkoutStore(fake.db)
  await startWorkout(store, ACCOUNT, DATE, SESSION, MONDAY, T, 'token-1')
  return { fake, store }
}

const COMPLETE = {
  action: 'complete',
  result: 12,
  load: { value: 20, unit: 'kg' },
  band: null,
} as const

const OTHER_COMPLETE = {
  action: 'complete',
  result: 8,
  load: { value: 35, unit: 'kg' },
  band: null,
} as const

const SKIP = { action: 'skip' } as const

const ADDRESS = {
  googleSub: ACCOUNT,
  workoutDate: DATE,
  sessionId: SESSION,
  exerciseOrder: 0,
  setIndex: 0,
} as const

async function storedSet(store: WorkoutStore): Promise<WorkoutSetRecord> {
  const set = await store.findSet(ACCOUNT, DATE, SESSION, 0, 0)
  if (!set) throw new Error('the set should exist')
  return set
}

/**
 * The store, with every occurrence touch counted.
 *
 * A write that lost must not mark the workout as worked in. With the clock
 * standing still a second touch would write the same numbers as the first, so
 * counting the calls at the store boundary is what actually distinguishes one
 * touch from two.
 */
function countingTouches(store: WorkoutStore) {
  const touches: number[] = []
  const wrapped: WorkoutStore = {
    ...store,
    async touchOccurrence(googleSub, workoutDate, sessionId, updatedAt) {
      touches.push(updatedAt)
      return store.touchOccurrence(googleSub, workoutDate, sessionId, updatedAt)
    },
  }
  return { store: wrapped, touches }
}

/* ------------------------------------------------------------------ */
/* The store contract, on its own                                      */
/* ------------------------------------------------------------------ */

describe('the store write carries the version the caller read', () => {
  it('changes nothing when the expected version is not the stored one', async () => {
    const { store } = await started()
    const existing = await storedSet(store)
    expect(existing.updatedAt).toBe(T)

    const landed = await store.updateSet(
      {
        ...existing,
        status: 'completed',
        loadValue: 20,
        loadUnit: 'kg',
        result: 12,
        updatedAt: T + 1,
      },
      T - 1,
    )

    expect(landed).toBe(false)
    // And it really did not write: the row is exactly as it was.
    const after = await storedSet(store)
    expect(after.status).toBe('pending')
    expect(after.result).toBeNull()
    expect(after.loadValue).toBeNull()
    expect(after.updatedAt).toBe(T)
  })

  it('writes when the expected version is the stored one, and moves it on', async () => {
    const { store } = await started()
    const existing = await storedSet(store)

    const landed = await store.updateSet(
      {
        ...existing,
        status: 'completed',
        loadValue: 20,
        loadUnit: 'kg',
        result: 12,
        updatedAt: T + 1,
      },
      T,
    )

    expect(landed).toBe(true)
    const after = await storedSet(store)
    expect(after.status).toBe('completed')
    expect(after.result).toBe(12)
    expect(after.updatedAt).toBeGreaterThan(T)
  })

  it('refuses the SAME write a second time, because the version has moved', async () => {
    // NON-VACUITY for the pair above: the refusal is about the version, not
    // about that particular record being unwritable.
    const { store } = await started()
    const existing = await storedSet(store)
    const record: WorkoutSetRecord = {
      ...existing,
      status: 'completed',
      result: 12,
      updatedAt: T + 1,
    }

    expect(await store.updateSet(record, T)).toBe(true)
    expect(await store.updateSet(record, T)).toBe(false)
  })
})

/* ------------------------------------------------------------------ */
/* Two ordinary writes that both pre-read the same version             */
/* ------------------------------------------------------------------ */

/**
 * Drive two mutations past their pre-reads, park them both, then commit them
 * one at a time. `first` is released first, and is expected to win.
 */
async function raceTwoWrites(
  store: WorkoutStore,
  fake: ReturnType<typeof createFakeD1>,
  first: WorkoutSetUpdate,
  second: WorkoutSetUpdate,
) {
  const queue = fake.queueSetWrites()

  const winner = applySetUpdate(store, ACCOUNT, DATE, SESSION, 0, 0, first, T)
  await queue.waitForParked(1)
  // Started only now, so its pre-read runs while the first write is still
  // parked. Both genuinely hold version T.
  const loser = applySetUpdate(store, ACCOUNT, DATE, SESSION, 0, 0, second, T)
  await queue.waitForParked(2)

  queue.releaseNext()
  const won = await winner
  queue.releaseNext()
  const lost = await loser
  queue.stop()

  return { won, lost }
}

describe('CASE A — Complete commits first, Skip loses', () => {
  it('lets exactly one of them succeed', async () => {
    const { fake, store } = await started()
    const { won, lost } = await raceTwoWrites(store, fake, COMPLETE, SKIP)

    expect(won.ok).toBe(true)
    // The loser is refused, not quietly accepted. Its write matched no row, and
    // the existing controlled failure says so.
    expect(lost).toEqual({ ok: false, reason: 'not_found' })
  })

  it('keeps the winning performance exactly', async () => {
    const { fake, store } = await started()
    await raceTwoWrites(store, fake, COMPLETE, SKIP)

    const set = await storedSet(store)
    // Had the Skip overwritten the Complete, this set would be `skipped` with no
    // result at all — a set the user did, recorded as one they walked away from.
    expect(set.status).toBe('completed')
    expect(set.result).toBe(12)
    expect(set.loadValue).toBe(20)
    expect(set.loadUnit).toBe('kg')
  })

  it('advances the version once, to the winner version', async () => {
    const { fake, store } = await started()
    const { won } = await raceTwoWrites(store, fake, COMPLETE, SKIP)
    if (!won.ok) throw new Error('the released write should have won')

    const set = await storedSet(store)
    expect(set.updatedAt).toBeGreaterThan(T)
    expect(set.updatedAt).toBe(won.record.updatedAt)
  })

  it('does not touch the occurrence on behalf of the loser', async () => {
    const { fake, store } = await started()
    const counted = countingTouches(store)
    await raceTwoWrites(counted.store, fake, COMPLETE, SKIP)

    // One landed write, one touch. A loser that touched would mark the workout
    // as worked in on the strength of a write that never happened, and quietly
    // change what Cancel Start is allowed to do.
    expect(counted.touches).toHaveLength(1)
  })
})

describe('CASE B — Skip commits first, Complete loses', () => {
  it('lets exactly one of them succeed, whichever way round', async () => {
    const { fake, store } = await started()
    const { won, lost } = await raceTwoWrites(store, fake, SKIP, COMPLETE)

    expect(won.ok).toBe(true)
    expect(lost).toEqual({ ok: false, reason: 'not_found' })
  })

  it('keeps the skip, and records no performance the user did not give', async () => {
    const { fake, store } = await started()
    await raceTwoWrites(store, fake, SKIP, COMPLETE)

    const set = await storedSet(store)
    expect(set.status).toBe('skipped')
    expect(set.result).toBeNull()
    expect(set.loadValue).toBeNull()
  })

  it('does not touch the occurrence on behalf of the loser', async () => {
    const { fake, store } = await started()
    const counted = countingTouches(store)
    await raceTwoWrites(counted.store, fake, SKIP, COMPLETE)

    expect(counted.touches).toHaveLength(1)
  })
})

describe('CASE C — two completions that disagree', () => {
  it('keeps the first to commit, not the last to arrive', async () => {
    // The point is not which ACTION wins. It is that the first valid write wins
    // and the second cannot overwrite it.
    const { fake, store } = await started()
    const { won, lost } = await raceTwoWrites(store, fake, COMPLETE, OTHER_COMPLETE)

    expect(won.ok).toBe(true)
    expect(lost).toEqual({ ok: false, reason: 'not_found' })

    const set = await storedSet(store)
    expect(set.result).toBe(12)
    expect(set.loadValue).toBe(20)
  })
})

describe('the race tests are not vacuous', () => {
  it('completes normally when nothing races it', async () => {
    const { store } = await started()
    expect((await applySetUpdate(store, ACCOUNT, DATE, SESSION, 0, 0, COMPLETE, T)).ok).toBe(true)
    expect((await storedSet(store)).result).toBe(12)
  })

  it('accepts a second mutation that reads the version the first one left', async () => {
    // The refusals above are about a STALE version, not about a set being
    // writable only once. Sequential writes, same instant on the clock, both
    // land — because each reads what the one before it wrote.
    const { store } = await started()
    expect((await applySetUpdate(store, ACCOUNT, DATE, SESSION, 0, 0, COMPLETE, T)).ok).toBe(true)
    expect((await applySetUpdate(store, ACCOUNT, DATE, SESSION, 0, 0, SKIP, T)).ok).toBe(true)
    expect((await undoSet(store, ACCOUNT, DATE, SESSION, 0, 0, T)).ok).toBe(true)
  })
})

/* ------------------------------------------------------------------ */
/* Undo                                                                */
/* ------------------------------------------------------------------ */

describe('Undo is a compare-and-swap write too', () => {
  it('cannot be overwritten by a completion that pre-read the same version', async () => {
    const { fake, store } = await started()
    // Give the set something to undo.
    await applySetUpdate(store, ACCOUNT, DATE, SESSION, 0, 0, COMPLETE, T)
    const version = (await storedSet(store)).updatedAt

    const queue = fake.queueSetWrites()
    const undoing = undoSet(store, ACCOUNT, DATE, SESSION, 0, 0, T)
    await queue.waitForParked(1)
    const recompleting = applySetUpdate(store, ACCOUNT, DATE, SESSION, 0, 0, OTHER_COMPLETE, T)
    await queue.waitForParked(2)

    queue.releaseNext()
    const undone = await undoing
    queue.releaseNext()
    const recompleted = await recompleting
    queue.stop()

    expect(undone.ok).toBe(true)
    expect(recompleted).toEqual({ ok: false, reason: 'not_found' })

    const set = await storedSet(store)
    expect(set.status).toBe('pending')
    expect(set.result).toBeNull()
    expect(set.updatedAt).toBeGreaterThan(version)
  })

  it('loses when the completion commits first', async () => {
    const { fake, store } = await started()
    await applySetUpdate(store, ACCOUNT, DATE, SESSION, 0, 0, COMPLETE, T)

    const queue = fake.queueSetWrites()
    const recompleting = applySetUpdate(store, ACCOUNT, DATE, SESSION, 0, 0, OTHER_COMPLETE, T)
    await queue.waitForParked(1)
    const undoing = undoSet(store, ACCOUNT, DATE, SESSION, 0, 0, T)
    await queue.waitForParked(2)

    queue.releaseNext()
    expect((await recompleting).ok).toBe(true)
    queue.releaseNext()
    // An Undo that lost must not blank out a completion that landed after it
    // read the set. That is the user watching their working set vanish.
    expect(await undoing).toEqual({ ok: false, reason: 'not_found' })
    queue.stop()

    const set = await storedSet(store)
    expect(set.status).toBe('completed')
    expect(set.result).toBe(8)
    expect(set.loadValue).toBe(35)
  })

  it('refuses to clear a set whose version has moved on', async () => {
    // The store contract for the Undo record specifically: the cleared record
    // cannot be written against a version that is no longer stored.
    const { store } = await started()
    await applySetUpdate(store, ACCOUNT, DATE, SESSION, 0, 0, COMPLETE, T)
    const current = await storedSet(store)

    const cleared: WorkoutSetRecord = {
      ...current,
      status: 'pending',
      loadValue: null,
      loadUnit: null,
      bandLabel: null,
      bandCount: null,
      result: null,
      updatedAt: current.updatedAt + 1,
    }

    expect(await store.updateSet(cleared, current.updatedAt - 1)).toBe(false)
    expect((await storedSet(store)).status).toBe('completed')
    expect(await store.updateSet(cleared, current.updatedAt)).toBe(true)
    expect((await storedSet(store)).status).toBe('pending')
  })
})

/* ------------------------------------------------------------------ */
/* The whole optimistic-concurrency chain                              */
/* ------------------------------------------------------------------ */

describe('an ordinary write and a History Correction share one version line', () => {
  it('makes a correction stale behind the ordinary write that followed it', async () => {
    const { fake, store } = await started()

    // Two ordinary writes both read T; the first to commit wins, and the loser
    // cannot overwrite it.
    const { won, lost } = await raceTwoWrites(store, fake, COMPLETE, OTHER_COMPLETE)
    expect(won.ok).toBe(true)
    expect(lost).toEqual({ ok: false, reason: 'not_found' })
    expect((await storedSet(store)).result).toBe(12)

    // An editor opens the recorded set and reads the version it is at.
    const editorVersion = (await storedSet(store)).updatedAt
    expect(editorVersion).toBeGreaterThan(T)

    // Another ordinary mutation lands, at the SAME instant on the clock.
    const later = await applySetUpdate(store, ACCOUNT, DATE, SESSION, 0, 0, OTHER_COMPLETE, T)
    expect(later.ok).toBe(true)
    const latest = await storedSet(store)
    expect(latest.updatedAt).toBeGreaterThan(editorVersion)

    // The editor saves against the version it read.
    const outcome = await correctSet(
      store,
      ADDRESS,
      {
        inputType: 'weight_kg',
        loadMode: 'kg',
        load: { value: 99, unit: 'kg' },
        band: null,
        result: 3,
      },
      editorVersion,
      'c-editor',
      T,
    )
    expect(outcome).toEqual({ ok: false, reason: 'stale' })

    // No audit event for a correction that did not happen.
    expect(fake.workoutSetCorrections.size).toBe(0)

    // And the latest ordinary truth survives, untouched by any of it.
    const final = await storedSet(store)
    expect(final.result).toBe(8)
    expect(final.loadValue).toBe(35)
    expect(final.updatedAt).toBe(latest.updatedAt)
  })

  it('accepts the correction from the version that is actually current', async () => {
    // NON-VACUITY: the conflict above is about the version, not about
    // corrections having stopped working.
    const { fake, store } = await started()
    await applySetUpdate(store, ACCOUNT, DATE, SESSION, 0, 0, COMPLETE, T)
    const current = await storedSet(store)

    const outcome = await correctSet(
      store,
      ADDRESS,
      {
        inputType: 'weight_kg',
        loadMode: 'kg',
        load: { value: 99, unit: 'kg' },
        band: null,
        result: 3,
      },
      current.updatedAt,
      'c-editor',
      T,
    )

    expect(outcome).toMatchObject({ ok: true, corrected: true })
    expect(fake.workoutSetCorrections.size).toBe(1)
    expect((await storedSet(store)).result).toBe(3)
  })
})

/* ------------------------------------------------------------------ */
/* Cancel Start still behaves                                          */
/* ------------------------------------------------------------------ */

describe('the new condition does not disturb Cancel Start', () => {
  it('still refuses a set write against a cancelled workout', async () => {
    // Zero rows now has two causes — the row is gone, or its version moved on.
    // Both must stay a controlled refusal rather than a ghost success.
    const { fake, store } = await started()
    await cancelWorkoutStart(store, ACCOUNT, DATE, SESSION)

    const outcome = await applySetUpdate(store, ACCOUNT, DATE, SESSION, 0, 0, COMPLETE, T)
    expect(outcome).toEqual({ ok: false, reason: 'not_found' })
    expect(fake.workoutSets.size).toBe(0)
    expect(await readWorkout(store, ACCOUNT, DATE, SESSION)).toBeNull()
  })

  it('still cancels a workout whose sets were never written to', async () => {
    const { store } = await started()
    expect(await cancelWorkoutStart(store, ACCOUNT, DATE, SESSION)).toEqual({ ok: true })
  })
})
