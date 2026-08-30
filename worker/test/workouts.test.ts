import { describe, expect, it } from 'vitest'

import { createD1WorkoutStore } from '../workouts/d1Store'
import {
  applySetUpdate,
  readWorkout,
  startWorkout,
  summariseSets,
  undoSet,
  type WorkoutStartInput,
  type WorkoutStore,
} from '../workouts/workouts'
import { createFakeD1 } from './fakeD1'

/**
 * Round 08 — the workout log store and its rules.
 *
 * The real rules and the real D1 mapping layer run together against the
 * in-memory D1 stand-in, so the SQL the Worker actually issues is exercised.
 */

const ACCOUNT_A = 'google-sub-a'
const ACCOUNT_B = 'google-sub-b'
const DATE = '2026-08-31'
const OTHER_DATE = '2026-09-01'

function makeStore(): { store: WorkoutStore; db: ReturnType<typeof createFakeD1> } {
  const db = createFakeD1()
  return { store: createD1WorkoutStore(db.db), db }
}

/** Monday as the accepted week has it: Lat Pulldown first, on a band. */
const MONDAY: WorkoutStartInput = {
  day: 'Monday',
  focus: 'Back Width + Biceps',
  intensity: 'HARD',
  exercises: [
    {
      exerciseId: 'lat-pulldown',
      name: 'Lat Pulldown',
      prescription: '4 × 10–15',
      equipment: 'BAND 20kg',
      resultKind: 'reps',
      loadMode: 'kg',
      perSide: false,
      setCount: 4,
    },
    {
      exerciseId: 'one-arm-db-row',
      name: 'One-Arm DB Row',
      prescription: '3 × 8–12',
      equipment: 'DB + Bench Flat',
      resultKind: 'reps',
      loadMode: 'kg_each',
      perSide: false,
      setCount: 3,
    },
  ],
}

/** Wednesday's Lat Pulldown: same canonical exercise, different prescription. */
const WEDNESDAY: WorkoutStartInput = {
  day: 'Wednesday',
  focus: 'Light Back + Rear Delts + Core',
  intensity: 'LIGHT',
  exercises: [
    {
      exerciseId: 'lat-pulldown',
      name: 'Lat Pulldown',
      prescription: '2 × 15–20',
      equipment: null,
      resultKind: 'reps',
      loadMode: 'kg',
      perSide: false,
      setCount: 2,
    },
    {
      exerciseId: 'plank',
      name: 'Plank',
      prescription: '3 × 30–60s',
      equipment: null,
      resultKind: 'seconds',
      loadMode: 'none',
      perSide: false,
      setCount: 3,
    },
  ],
}

/* ------------------------------------------------------------------ */
/* Start                                                               */
/* ------------------------------------------------------------------ */

describe('starting a workout', () => {
  it('creates the occurrence and every expected set, all pending', async () => {
    const { store } = makeStore()

    const result = await startWorkout(store, ACCOUNT_A, DATE, 'monday', MONDAY)

    expect(result.created).toBe(true)
    expect(result.occurrence.day).toBe('Monday')
    expect(result.occurrence.focus).toBe('Back Width + Biceps')
    expect(result.occurrence.intensity).toBe('HARD')
    // 4 + 3 sets exist from the start, so the workout's shape is history too.
    expect(result.sets).toHaveLength(7)
    expect(result.sets.every((set) => set.status === 'pending')).toBe(true)
    expect(result.sets.every((set) => set.result === null)).toBe(true)
    expect(result.sets.every((set) => set.loadValue === null)).toBe(true)
  })

  it('returns sets in deterministic performance order', async () => {
    const { store } = makeStore()
    await startWorkout(store, ACCOUNT_A, DATE, 'monday', MONDAY)

    const log = await readWorkout(store, ACCOUNT_A, DATE, 'monday')
    expect(log?.sets.map((set) => `${set.exerciseOrder}:${set.setIndex}`)).toEqual([
      '0:0',
      '0:1',
      '0:2',
      '0:3',
      '1:0',
      '1:1',
      '1:2',
    ])
  })

  it('carries the snapshot onto every set of its exercise', async () => {
    const { store } = makeStore()
    const result = await startWorkout(store, ACCOUNT_A, DATE, 'monday', MONDAY)

    const first = result.sets.filter((set) => set.exerciseOrder === 0)
    expect(first).toHaveLength(4)
    for (const set of first) {
      expect(set.exerciseId).toBe('lat-pulldown')
      expect(set.exerciseName).toBe('Lat Pulldown')
      expect(set.prescription).toBe('4 × 10–15')
      expect(set.equipment).toBe('BAND 20kg')
      expect(set.resultKind).toBe('reps')
      expect(set.loadMode).toBe('kg')
      expect(set.perSide).toBe(false)
    }
  })

  it('keeps a null equipment snapshot null rather than inventing one', async () => {
    const { store } = makeStore()
    const result = await startWorkout(store, ACCOUNT_A, DATE, 'wednesday', WEDNESDAY)
    expect(result.sets[0].equipment).toBeNull()
  })

  it('is idempotent — a second start creates nothing', async () => {
    const { store, db } = makeStore()

    await startWorkout(store, ACCOUNT_A, DATE, 'monday', MONDAY)
    const second = await startWorkout(store, ACCOUNT_A, DATE, 'monday', MONDAY)

    expect(second.created).toBe(false)
    expect(second.sets).toHaveLength(7)
    expect(db.occurrences.size).toBe(1)
    expect(db.workoutSets.size).toBe(7)
  })

  it('reports not-started as null rather than an empty workout', async () => {
    const { store } = makeStore()
    expect(await readWorkout(store, ACCOUNT_A, DATE, 'monday')).toBeNull()
  })
})

/* ------------------------------------------------------------------ */
/* The historical snapshot invariant                                   */
/* ------------------------------------------------------------------ */

describe('historical snapshot immutability', () => {
  it('keeps the first snapshot when a newer source payload starts again', async () => {
    const { store } = makeStore()

    // Snapshot A — the workout as it was actually prescribed on the day.
    await startWorkout(store, ACCOUNT_A, DATE, 'monday', MONDAY)

    // Snapshot B — sessions.ts has since changed: different prescription,
    // different equipment, different name, different focus, more sets.
    const changed: WorkoutStartInput = {
      day: 'Monday',
      focus: 'Rebuilt Back Focus',
      intensity: 'PUMP',
      exercises: [
        {
          exerciseId: 'lat-pulldown',
          name: 'Lat Pulldown (Wide)',
          prescription: '6 × 5–8',
          equipment: 'BAND 40kg',
          resultKind: 'reps',
          loadMode: 'kg_each',
          perSide: true,
          setCount: 6,
        },
      ],
    }
    const resumed = await startWorkout(store, ACCOUNT_A, DATE, 'monday', changed)

    expect(resumed.created).toBe(false)
    // The stored history still describes what was actually performed.
    expect(resumed.occurrence.focus).toBe('Back Width + Biceps')
    expect(resumed.occurrence.intensity).toBe('HARD')
    expect(resumed.sets).toHaveLength(7)
    expect(resumed.sets[0].prescription).toBe('4 × 10–15')
    expect(resumed.sets[0].exerciseName).toBe('Lat Pulldown')
    expect(resumed.sets[0].equipment).toBe('BAND 20kg')
    expect(resumed.sets[0].loadMode).toBe('kg')
    expect(resumed.sets[0].perSide).toBe(false)
  })

  it('does not lose logged results when a later start is attempted', async () => {
    const { store } = makeStore()
    await startWorkout(store, ACCOUNT_A, DATE, 'monday', MONDAY)
    await applySetUpdate(store, ACCOUNT_A, DATE, 'monday', 0, 0, {
      action: 'complete',
      result: 12,
      load: { value: 20, unit: 'kg' },
    })

    const resumed = await startWorkout(store, ACCOUNT_A, DATE, 'monday', MONDAY)

    expect(resumed.sets[0].status).toBe('completed')
    expect(resumed.sets[0].result).toBe(12)
    expect(resumed.sets[0].loadValue).toBe(20)
  })
})

/* ------------------------------------------------------------------ */
/* Isolation                                                           */
/* ------------------------------------------------------------------ */

describe('isolation', () => {
  it('keeps two accounts apart on the same date and session', async () => {
    const { store } = makeStore()

    await startWorkout(store, ACCOUNT_A, DATE, 'monday', MONDAY)
    await applySetUpdate(store, ACCOUNT_A, DATE, 'monday', 0, 0, {
      action: 'complete',
      result: 12,
      load: null,
    })

    // B has not started the same date + session at all.
    expect(await readWorkout(store, ACCOUNT_B, DATE, 'monday')).toBeNull()

    await startWorkout(store, ACCOUNT_B, DATE, 'monday', MONDAY)
    const bLog = await readWorkout(store, ACCOUNT_B, DATE, 'monday')
    expect(bLog?.sets[0].status).toBe('pending')

    // A's log is untouched by B starting.
    const aLog = await readWorkout(store, ACCOUNT_A, DATE, 'monday')
    expect(aLog?.sets[0].result).toBe(12)
  })

  it('cannot mutate another account’s set', async () => {
    const { store } = makeStore()
    await startWorkout(store, ACCOUNT_A, DATE, 'monday', MONDAY)

    const outcome = await applySetUpdate(store, ACCOUNT_B, DATE, 'monday', 0, 0, {
      action: 'complete',
      result: 99,
      load: null,
    })

    expect(outcome).toEqual({ ok: false, reason: 'not_found' })
    const aLog = await readWorkout(store, ACCOUNT_A, DATE, 'monday')
    expect(aLog?.sets[0].status).toBe('pending')
  })

  it('keeps the same session apart on different dates', async () => {
    const { store } = makeStore()

    await startWorkout(store, ACCOUNT_A, DATE, 'monday', MONDAY)
    await startWorkout(store, ACCOUNT_A, OTHER_DATE, 'monday', MONDAY)
    await applySetUpdate(store, ACCOUNT_A, DATE, 'monday', 0, 0, {
      action: 'complete',
      result: 10,
      load: null,
    })

    const later = await readWorkout(store, ACCOUNT_A, OTHER_DATE, 'monday')
    expect(later?.sets[0].status).toBe('pending')
  })

  it('keeps a repeated canonical exercise apart across sessions', async () => {
    const { store } = makeStore()

    // Lat Pulldown is exercise_order 0 on both days and shares the canonical
    // identity that owns ONE media record — but the logs are separate.
    await startWorkout(store, ACCOUNT_A, DATE, 'monday', MONDAY)
    await startWorkout(store, ACCOUNT_A, DATE, 'wednesday', WEDNESDAY)

    await applySetUpdate(store, ACCOUNT_A, DATE, 'monday', 0, 0, {
      action: 'complete',
      result: 12,
      load: { value: 20, unit: 'kg' },
    })

    const monday = await readWorkout(store, ACCOUNT_A, DATE, 'monday')
    const wednesday = await readWorkout(store, ACCOUNT_A, DATE, 'wednesday')

    expect(monday?.sets[0].exerciseId).toBe('lat-pulldown')
    expect(wednesday?.sets[0].exerciseId).toBe('lat-pulldown')
    // Same canonical exercise, different occurrence: no collision either way.
    expect(monday?.sets[0].result).toBe(12)
    expect(wednesday?.sets[0].status).toBe('pending')
    expect(wednesday?.sets[0].result).toBeNull()
    // And the historical prescriptions stay per-session.
    expect(monday?.sets[0].prescription).toBe('4 × 10–15')
    expect(wednesday?.sets[0].prescription).toBe('2 × 15–20')
  })

  it('keeps sets of the same exercise apart by set index', async () => {
    const { store } = makeStore()
    await startWorkout(store, ACCOUNT_A, DATE, 'monday', MONDAY)

    await applySetUpdate(store, ACCOUNT_A, DATE, 'monday', 0, 2, {
      action: 'complete',
      result: 11,
      load: null,
    })

    const log = await readWorkout(store, ACCOUNT_A, DATE, 'monday')
    expect(log?.sets.map((set) => set.status)).toEqual([
      'pending',
      'pending',
      'completed',
      'pending',
      'pending',
      'pending',
      'pending',
    ])
  })

  it('keeps sets of different exercises apart by exercise order', async () => {
    const { store } = makeStore()
    await startWorkout(store, ACCOUNT_A, DATE, 'monday', MONDAY)

    await applySetUpdate(store, ACCOUNT_A, DATE, 'monday', 1, 0, {
      action: 'complete',
      result: 9,
      load: { value: 10, unit: 'kg_each' },
    })

    const log = await readWorkout(store, ACCOUNT_A, DATE, 'monday')
    const second = log?.sets.find((set) => set.exerciseOrder === 1 && set.setIndex === 0)
    const first = log?.sets.find((set) => set.exerciseOrder === 0 && set.setIndex === 0)
    expect(second?.result).toBe(9)
    expect(second?.loadUnit).toBe('kg_each')
    expect(first?.status).toBe('pending')
  })
})

/* ------------------------------------------------------------------ */
/* Logging a set                                                       */
/* ------------------------------------------------------------------ */

describe('logging sets', () => {
  it('records a completed set with its load and result', async () => {
    const { store } = makeStore()
    await startWorkout(store, ACCOUNT_A, DATE, 'monday', MONDAY)

    const outcome = await applySetUpdate(store, ACCOUNT_A, DATE, 'monday', 1, 0, {
      action: 'complete',
      result: 10,
      load: { value: 12.5, unit: 'kg_each' },
    })

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.record.status).toBe('completed')
    expect(outcome.record.result).toBe(10)
    expect(outcome.record.loadValue).toBe(12.5)
    // The "each" semantic is stored, not implied by whichever label rendered.
    expect(outcome.record.loadUnit).toBe('kg_each')
  })

  it('records a completed set with no load where load does not apply', async () => {
    const { store } = makeStore()
    await startWorkout(store, ACCOUNT_A, DATE, 'wednesday', WEDNESDAY)

    // Plank: seconds, bodyweight.
    const outcome = await applySetUpdate(store, ACCOUNT_A, DATE, 'wednesday', 1, 0, {
      action: 'complete',
      result: 45,
      load: null,
    })

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.record.resultKind).toBe('seconds')
    expect(outcome.record.result).toBe(45)
    expect(outcome.record.loadValue).toBeNull()
    expect(outcome.record.loadUnit).toBeNull()
  })

  it('refuses a load on an exercise that takes none', async () => {
    const { store } = makeStore()
    await startWorkout(store, ACCOUNT_A, DATE, 'wednesday', WEDNESDAY)

    const outcome = await applySetUpdate(store, ACCOUNT_A, DATE, 'wednesday', 1, 0, {
      action: 'complete',
      result: 45,
      load: { value: 20, unit: 'kg' },
    })

    expect(outcome).toEqual({ ok: false, reason: 'load_not_applicable' })
  })

  it('refuses a load whose unit contradicts the snapshot', async () => {
    const { store } = makeStore()
    await startWorkout(store, ACCOUNT_A, DATE, 'monday', MONDAY)

    // Exercise 0 is band work — storing it as "each" would change its meaning.
    const outcome = await applySetUpdate(store, ACCOUNT_A, DATE, 'monday', 0, 0, {
      action: 'complete',
      result: 12,
      load: { value: 20, unit: 'kg_each' },
    })

    expect(outcome).toEqual({ ok: false, reason: 'load_unit_mismatch' })
  })

  it('marks a set skipped with no result and no load', async () => {
    const { store } = makeStore()
    await startWorkout(store, ACCOUNT_A, DATE, 'monday', MONDAY)

    const outcome = await applySetUpdate(store, ACCOUNT_A, DATE, 'monday', 0, 1, {
      action: 'skip',
    })

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.record.status).toBe('skipped')
    // A skip must never read as a completed working set.
    expect(outcome.record.result).toBeNull()
    expect(outcome.record.loadValue).toBeNull()
  })

  it('clears a previous result when a completed set is later skipped', async () => {
    const { store } = makeStore()
    await startWorkout(store, ACCOUNT_A, DATE, 'monday', MONDAY)
    await applySetUpdate(store, ACCOUNT_A, DATE, 'monday', 0, 0, {
      action: 'complete',
      result: 12,
      load: { value: 20, unit: 'kg' },
    })

    const outcome = await applySetUpdate(store, ACCOUNT_A, DATE, 'monday', 0, 0, {
      action: 'skip',
    })

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.record.status).toBe('skipped')
    expect(outcome.record.result).toBeNull()
    expect(outcome.record.loadValue).toBeNull()
  })

  it('reports an unknown set rather than creating one', async () => {
    const { store, db } = makeStore()
    await startWorkout(store, ACCOUNT_A, DATE, 'monday', MONDAY)

    // Exercise 0 has 4 sets, so index 9 does not exist.
    const outcome = await applySetUpdate(store, ACCOUNT_A, DATE, 'monday', 0, 9, {
      action: 'complete',
      result: 12,
      load: null,
    })

    expect(outcome).toEqual({ ok: false, reason: 'not_found' })
    expect(db.workoutSets.size).toBe(7)
  })
})

/* ------------------------------------------------------------------ */
/* Undo                                                                */
/* ------------------------------------------------------------------ */

describe('undo', () => {
  it('returns a completed set to pending and clears what was logged', async () => {
    const { store } = makeStore()
    await startWorkout(store, ACCOUNT_A, DATE, 'monday', MONDAY)
    await applySetUpdate(store, ACCOUNT_A, DATE, 'monday', 0, 0, {
      action: 'complete',
      result: 12,
      load: { value: 20, unit: 'kg' },
    })

    const outcome = await undoSet(store, ACCOUNT_A, DATE, 'monday', 0, 0)

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.record.status).toBe('pending')
    expect(outcome.record.result).toBeNull()
    expect(outcome.record.loadValue).toBeNull()
    expect(outcome.record.loadUnit).toBeNull()
  })

  it('returns a skipped set to pending', async () => {
    const { store } = makeStore()
    await startWorkout(store, ACCOUNT_A, DATE, 'monday', MONDAY)
    await applySetUpdate(store, ACCOUNT_A, DATE, 'monday', 0, 0, { action: 'skip' })

    const outcome = await undoSet(store, ACCOUNT_A, DATE, 'monday', 0, 0)
    expect(outcome.ok && outcome.record.status).toBe('pending')
  })

  it('keeps the expected set row and the occurrence snapshot', async () => {
    const { store, db } = makeStore()
    await startWorkout(store, ACCOUNT_A, DATE, 'monday', MONDAY)
    await applySetUpdate(store, ACCOUNT_A, DATE, 'monday', 0, 0, {
      action: 'complete',
      result: 12,
      load: null,
    })

    await undoSet(store, ACCOUNT_A, DATE, 'monday', 0, 0)

    // Undo clears what was logged; it never deletes history.
    expect(db.occurrences.size).toBe(1)
    expect(db.workoutSets.size).toBe(7)
    const log = await readWorkout(store, ACCOUNT_A, DATE, 'monday')
    expect(log?.sets[0].prescription).toBe('4 × 10–15')
    expect(log?.occurrence.focus).toBe('Back Width + Biceps')
  })

  it('reports an unknown set rather than inventing one', async () => {
    const { store } = makeStore()
    await startWorkout(store, ACCOUNT_A, DATE, 'monday', MONDAY)
    expect(await undoSet(store, ACCOUNT_A, DATE, 'monday', 5, 0)).toEqual({
      ok: false,
      reason: 'not_found',
    })
  })
})

/* ------------------------------------------------------------------ */
/* Progress                                                            */
/* ------------------------------------------------------------------ */

describe('progress', () => {
  it('counts a skip as resolved but never as completed', async () => {
    const { store } = makeStore()
    await startWorkout(store, ACCOUNT_A, DATE, 'monday', MONDAY)
    await applySetUpdate(store, ACCOUNT_A, DATE, 'monday', 0, 0, {
      action: 'complete',
      result: 12,
      load: null,
    })
    await applySetUpdate(store, ACCOUNT_A, DATE, 'monday', 0, 1, { action: 'skip' })

    const log = await readWorkout(store, ACCOUNT_A, DATE, 'monday')
    expect(summariseSets(log?.sets ?? [])).toEqual({
      total: 7,
      completed: 1,
      skipped: 1,
      resolved: 2,
    })
  })
})

/* ------------------------------------------------------------------ */
/* Storage failure                                                     */
/* ------------------------------------------------------------------ */

describe('storage failure', () => {
  it('propagates a store failure rather than reporting a false empty workout', async () => {
    const { store, db } = makeStore()
    db.breakWorkouts()

    await expect(readWorkout(store, ACCOUNT_A, DATE, 'monday')).rejects.toThrow(
      'D1 unavailable',
    )
  })
})
