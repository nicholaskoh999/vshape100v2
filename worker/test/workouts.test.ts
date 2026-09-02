import { describe, expect, it } from 'vitest'

import { createD1WorkoutStore } from '../workouts/d1Store'
import {
  applySetUpdate,
  readWorkout,
  startWorkout,
  summariseSets,
  undoSet,
  type StartOutcome,
  type StartResult,
  type WorkoutStartInput,
  type WorkoutStore,
} from '../workouts/workouts'
import { createFakeD1 } from './fakeD1'

/**
 * Round 19 Correction 2 made Start return an outcome rather than a log, because
 * the conditional write can now legitimately refuse. These tests are about the
 * ordinary path, so they assert the refusal never happens and read through.
 */
function unwrap(outcome: StartOutcome): StartResult {
  if (!outcome.ok) throw new Error(`unexpected Start refusal: ${outcome.reason}`)
  return outcome.result
}

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
  sourceSessionId: null,
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
  sourceSessionId: null,
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

    const result = unwrap(await startWorkout(store, ACCOUNT_A, DATE, 'monday', MONDAY))

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
    const result = unwrap(await startWorkout(store, ACCOUNT_A, DATE, 'monday', MONDAY))

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
    const result = unwrap(await startWorkout(store, ACCOUNT_A, DATE, 'wednesday', WEDNESDAY))
    expect(result.sets[0].equipment).toBeNull()
  })

  it('is idempotent — a second start creates nothing', async () => {
    const { store, db } = makeStore()

    await startWorkout(store, ACCOUNT_A, DATE, 'monday', MONDAY)
    const second = unwrap(await startWorkout(store, ACCOUNT_A, DATE, 'monday', MONDAY))

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
      sourceSessionId: null,
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
    const resumed = unwrap(await startWorkout(store, ACCOUNT_A, DATE, 'monday', changed))

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
      band: null,
    })

    const resumed = unwrap(await startWorkout(store, ACCOUNT_A, DATE, 'monday', MONDAY))

    expect(resumed.sets[0].status).toBe('completed')
    expect(resumed.sets[0].result).toBe(12)
    expect(resumed.sets[0].loadValue).toBe(20)
  })
})

/* ------------------------------------------------------------------ */
/* Concurrent first Start                                              */
/* ------------------------------------------------------------------ */

/**
 * Two first Starts, neither having seen the other.
 *
 * The payloads are deliberately different shapes, and EACH holds set positions
 * the other does not:
 *
 *   A only: (2,0)
 *   B only: (0,2) (0,3) (1,1) (1,2)
 *
 * so whichever loses has rows that would not collide with the winner's. Under
 * a plain per-row ON CONFLICT those rows would have inserted underneath the
 * winner's occurrence and produced a hybrid workout.
 */
const RACE_A: WorkoutStartInput = {
  day: 'Monday',
  focus: 'Winner A focus',
  intensity: 'HARD',
  sourceSessionId: null,
  exercises: [
    {
      exerciseId: 'lat-pulldown',
      name: 'Lat Pulldown A',
      prescription: '2 × 10–12',
      equipment: 'BAND 20kg',
      resultKind: 'reps',
      loadMode: 'kg',
      perSide: false,
      setCount: 2,
    },
    {
      exerciseId: 'face-pull',
      name: 'Face Pull A',
      prescription: '1 × 15–20',
      equipment: 'BAND 10kg',
      resultKind: 'reps',
      loadMode: 'kg',
      perSide: false,
      setCount: 1,
    },
    {
      exerciseId: 'dead-bug',
      name: 'Dead Bug A',
      prescription: '1 × 10 / side',
      equipment: null,
      resultKind: 'reps',
      loadMode: 'none',
      perSide: true,
      setCount: 1,
    },
  ],
}

const RACE_B: WorkoutStartInput = {
  day: 'Monday',
  focus: 'Winner B focus',
  intensity: 'PUMP',
  sourceSessionId: null,
  exercises: [
    {
      exerciseId: 'lat-pulldown',
      name: 'Lat Pulldown B',
      prescription: '4 × 5–8',
      equipment: 'DB',
      resultKind: 'reps',
      loadMode: 'kg_each',
      perSide: true,
      setCount: 4,
    },
    {
      exerciseId: 'plank',
      name: 'Plank B',
      prescription: '3 × 30–60s',
      equipment: null,
      resultKind: 'seconds',
      loadMode: 'none',
      perSide: false,
      setCount: 3,
    },
  ],
}

/** Every (exerciseOrder, setIndex) a payload would occupy. */
function keysOf(input: WorkoutStartInput): string[] {
  return input.exercises.flatMap((exercise, order) =>
    Array.from({ length: exercise.setCount }, (_unused, index) => `${order}:${index}`),
  )
}

/** Let both Starts finish their pre-read and park in persistence. */
async function flushMicrotasks(times = 30) {
  for (let i = 0; i < times; i += 1) await Promise.resolve()
}

/**
 * Drive two first Starts so both observe "not started" before either persists.
 * `first` is the one that reaches persistence first, and therefore wins.
 */
async function raceStarts(first: WorkoutStartInput, second: WorkoutStartInput) {
  const { store, db } = makeStore()

  // Record what each Start saw when it asked whether the workout existed.
  const observed: (string | null)[] = []
  const recording: WorkoutStore = {
    ...store,
    async findOccurrence(googleSub, workoutDate, sessionId) {
      const found = await store.findOccurrence(googleSub, workoutDate, sessionId)
      observed.push(found ? found.snapshotId : null)
      return found
    },
  }

  const release = db.holdBatches()
  const firstStart = startWorkout(
    recording,
    ACCOUNT_A,
    DATE,
    'monday',
    first,
    1_000,
    'snapshot-first',
  )
  const secondStart = startWorkout(
    recording,
    ACCOUNT_A,
    DATE,
    'monday',
    second,
    2_000,
    'snapshot-second',
  )

  await flushMicrotasks()
  release()
  const [firstOutcome, secondOutcome] = await Promise.all([firstStart, secondStart])

  return {
    store,
    db,
    observed,
    firstResult: unwrap(firstOutcome),
    secondResult: unwrap(secondOutcome),
  }
}

/** Assert the stored workout is EXACTLY `winner` and carries nothing of `loser`. */
async function expectExactly(
  store: WorkoutStore,
  db: ReturnType<typeof createFakeD1>,
  winner: WorkoutStartInput,
  loser: WorkoutStartInput,
) {
  expect(db.occurrences.size).toBe(1)

  const log = await readWorkout(store, ACCOUNT_A, DATE, 'monday')
  expect(log).not.toBeNull()
  const stored = log!

  // The session header is the winner's, with no column taken from the loser.
  expect(stored.occurrence.focus).toBe(winner.focus)
  expect(stored.occurrence.intensity).toBe(winner.intensity)

  const winnerKeys = keysOf(winner)
  const loserOnly = keysOf(loser).filter((key) => !winnerKeys.includes(key))
  // The premise of the test: the loser really did hold positions of its own.
  expect(loserOnly.length).toBeGreaterThan(0)

  // Exact set count, exact orders, exact indexes.
  expect(stored.sets).toHaveLength(winnerKeys.length)
  expect(stored.sets.map((set) => `${set.exerciseOrder}:${set.setIndex}`)).toEqual(
    winnerKeys,
  )
  expect(db.workoutSets.size).toBe(winnerKeys.length)

  // Not one loser-only position exists, in the read or in the raw table.
  const rawKeys = [...db.workoutSets.values()].map(
    (row) => `${row.exercise_order}:${row.set_index}`,
  )
  for (const key of loserOnly) expect(rawKeys).not.toContain(key)

  // Every set snapshot belongs to the same winner — no mixed columns.
  for (const set of stored.sets) {
    const exercise = winner.exercises[set.exerciseOrder]
    expect(set.exerciseId).toBe(exercise.exerciseId)
    expect(set.exerciseName).toBe(exercise.name)
    expect(set.prescription).toBe(exercise.prescription)
    expect(set.equipment).toBe(exercise.equipment)
    expect(set.resultKind).toBe(exercise.resultKind)
    expect(set.loadMode).toBe(exercise.loadMode)
    expect(set.perSide).toBe(exercise.perSide)
    // And to the same Start, by ownership token.
    expect(set.snapshotId).toBe(stored.occurrence.snapshotId)
  }

  return stored
}

describe('concurrent first start', () => {
  it('lets both Starts observe an unstarted workout before either persists', async () => {
    const { observed } = await raceStarts(RACE_A, RACE_B)
    // The window the ownership token exists to close was genuinely open.
    expect(observed.slice(0, 2)).toEqual([null, null])
  })

  it('stores exactly the winning payload when A reaches persistence first', async () => {
    const { store, db } = await raceStarts(RACE_A, RACE_B)
    const stored = await expectExactly(store, db, RACE_A, RACE_B)

    expect(stored.occurrence.snapshotId).toBe('snapshot-first')
    expect(stored.sets).toHaveLength(4)
  })

  it('stores exactly the winning payload when B reaches persistence first', async () => {
    const { store, db } = await raceStarts(RACE_B, RACE_A)
    const stored = await expectExactly(store, db, RACE_B, RACE_A)

    expect(stored.occurrence.snapshotId).toBe('snapshot-first')
    expect(stored.sets).toHaveLength(7)
  })

  it('reports exactly one Start as the creator', async () => {
    const { firstResult, secondResult } = await raceStarts(RACE_A, RACE_B)
    expect([firstResult.created, secondResult.created]).toEqual([true, false])
  })

  it('gives both callers the same coherent winning snapshot', async () => {
    const { firstResult, secondResult } = await raceStarts(RACE_A, RACE_B)

    // The loser is told the truth: the workout that exists, not the one it sent.
    expect(secondResult.occurrence.focus).toBe(RACE_A.focus)
    expect(secondResult.occurrence.snapshotId).toBe(firstResult.occurrence.snapshotId)
    expect(secondResult.sets).toHaveLength(firstResult.sets.length)
    expect(secondResult.sets.map((set) => set.exerciseName)).toEqual(
      firstResult.sets.map((set) => set.exerciseName),
    )
    // Neither caller is holding a hybrid.
    for (const result of [firstResult, secondResult]) {
      for (const set of result.sets) {
        expect(set.snapshotId).toBe(result.occurrence.snapshotId)
      }
    }
  })

  it('writes nothing at all for the losing Start', async () => {
    const { db } = await raceStarts(RACE_A, RACE_B)
    const tokens = new Set([...db.workoutSets.values()].map((row) => row.snapshot_id))
    // One token across every stored row: the loser contributed no history.
    expect([...tokens]).toEqual(['snapshot-first'])
  })

  it('leaves the raced workout logging normally afterwards', async () => {
    const { store, db } = await raceStarts(RACE_A, RACE_B)

    const outcome = await applySetUpdate(store, ACCOUNT_A, DATE, 'monday', 0, 0, {
      action: 'complete',
      result: 11,
      load: { value: 20, unit: 'kg' },
      band: null,
    })
    expect(outcome.ok).toBe(true)

    // And a later ordinary Start still resumes the winner rather than
    // reopening the race.
    const resumed = unwrap(await startWorkout(store, ACCOUNT_A, DATE, 'monday', RACE_B))
    expect(resumed.created).toBe(false)
    expect(resumed.occurrence.focus).toBe(RACE_A.focus)
    expect(resumed.sets).toHaveLength(4)
    expect(resumed.sets[0].result).toBe(11)
    expect(db.workoutSets.size).toBe(4)
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
      band: null,
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
      band: null,
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
      band: null,
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
      band: null,
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
      band: null,
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
      band: null,
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
      band: null,
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
      band: null,
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
      band: null,
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
      band: null,
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
      band: null,
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
      band: null,
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
      band: null,
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
      band: null,
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
      band: null,
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
