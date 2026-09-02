import { describe, expect, it } from 'vitest'

import {
  deriveSessionProgression,
  type ProgressionSetRow,
} from '../../shared/progression/engine'
import { readSet, type CompletedSetRow } from '../progress/performance'
import { createD1WorkoutStore } from '../workouts/d1Store'
import { readWorkout, startWorkout } from '../workouts/workouts'
import { createFakeD1 } from './fakeD1'

/**
 * Round 20 Correction 2 — the three consumers must AGREE.
 *
 * THE DEFECT THIS EXISTS TO PIN.
 *
 * `readSetModality` is the shared compatibility boundary, but it used to take
 * an already-narrowed load mode, so every caller had to narrow first. The
 * workout D1 mapper narrowed by COERCING an unknown stored value to 'none'.
 * A row saying:
 *
 *   input_type_snapshot = 'bodyweight'
 *   load_mode_snapshot  = 'future_mode'
 *
 * therefore reached the shared rule as `bodyweight` + `none` — a perfectly
 * coherent pair — and the Workout Log read it as ordinary bodyweight work.
 * Progress and the Round 16 progression engine saw the raw value and refused
 * it. One stored row, three consumers, two different answers about whether it
 * was readable at all.
 *
 * A shared rule that each caller may pre-sanitise is not a shared rule. So this
 * file does not test the rule again — `snapshotCompatibility.test.ts` does
 * that. It tests the thing the rule exists FOR: that the three consumers reach
 * the same verdict about the same stored row.
 */

const ACCOUNT = 'sub-a'
const DATE = '2026-09-01'
const SESSION = 'monday'

/** The row the reviewer named, plus the other two shapes of raw corruption. */
const UNREADABLE_RAW = [
  { $why: 'bodyweight with an unknown load mode', inputType: 'bodyweight', loadMode: 'future_mode' },
  { $why: 'band work with an unknown load mode', inputType: 'resistance_band', loadMode: 'elastic_vibes' },
  { $why: 'kilograms with an unknown load mode', inputType: 'weight_kg', loadMode: 'unknown' },
]

/** The same shapes, stored coherently. Every consumer must accept these. */
const READABLE = [
  { $why: 'bodyweight', inputType: 'bodyweight', loadMode: 'none' },
  { $why: 'band work', inputType: 'resistance_band', loadMode: 'none' },
  { $why: 'kilograms', inputType: 'weight_kg', loadMode: 'kg' },
]

/* ------------------------------------------------------------------ */
/* Consumer 1 — the workout log, through the real D1 mapping           */
/* ------------------------------------------------------------------ */

async function workoutLogReads(inputType: string, loadMode: string) {
  const fake = createFakeD1()
  const store = createD1WorkoutStore(fake.db)
  await startWorkout(
    store,
    ACCOUNT,
    DATE,
    SESSION,
    {
      day: 'Monday',
      focus: 'F',
      intensity: 'HARD',
      sourceSessionId: null,
      exercises: [
        {
          exerciseId: 'lat-pulldown',
          name: 'Lat Pulldown',
          prescription: '4 × 10–15',
          equipment: null,
          resultKind: 'reps',
          loadMode: 'kg',
          perSide: false,
          setCount: 1,
        },
      ],
    },
    1,
    'token-1',
  )

  // Write the corrupt pair straight into storage — the application itself
  // cannot produce it, which is exactly why the reader must not trust it.
  for (const row of fake.workoutSets.values()) {
    row.input_type_snapshot = inputType
    row.load_mode_snapshot = loadMode
  }

  const log = await readWorkout(store, ACCOUNT, DATE, SESSION)
  return log?.sets[0]?.inputType ?? null
}

/* ------------------------------------------------------------------ */
/* Consumer 2 — Progress                                               */
/* ------------------------------------------------------------------ */

function progressReads(inputType: string, loadMode: string) {
  const loaded = loadMode === 'kg' || loadMode === 'kg_each'
  const row: CompletedSetRow = {
    exerciseId: 'lat-pulldown',
    exerciseName: 'Lat Pulldown',
    resultKind: 'reps',
    loadMode,
    perSide: 0,
    loadValue: loaded ? 50 : null,
    loadUnit: loaded ? loadMode : null,
    result: 10,
    workoutDate: DATE,
    sessionId: SESSION,
    startedAt: 1,
    inputTypeSnapshot: inputType,
    bandLabel: inputType === 'resistance_band' && !loaded ? 'Black' : null,
    bandCount: inputType === 'resistance_band' && !loaded ? 3 : null,
  }
  return readSet(row).status
}

/* ------------------------------------------------------------------ */
/* Consumer 3 — Round 16 progression                                   */
/* ------------------------------------------------------------------ */

function progressionReads(inputType: string, loadMode: string) {
  const loaded = loadMode === 'kg' || loadMode === 'kg_each'
  const current: ProgressionSetRow[] = [12, 12, 12].map((result, setIndex) => ({
    workoutDate: DATE,
    exerciseOrder: 0,
    setIndex,
    exerciseId: 'lat-pulldown',
    exerciseName: 'Lat Pulldown',
    prescription: '4 × 10–15',
    resultKind: 'reps',
    loadMode,
    perSide: false,
    status: 'completed',
    loadValue: loaded ? 50 : null,
    loadUnit: loaded ? loadMode : null,
    result,
    inputTypeSnapshot: inputType,
    bandLabel: inputType === 'resistance_band' && !loaded ? 'Black' : null,
    bandCount: inputType === 'resistance_band' && !loaded ? 3 : null,
  }))

  return deriveSessionProgression({
    sessionId: SESSION,
    intensity: 'HARD',
    current,
    history: [],
    calibration: [],
    historyComplete: true,
  }).lanes.length
}

/* ------------------------------------------------------------------ */
/* They agree                                                          */
/* ------------------------------------------------------------------ */

describe('a raw stored load mode this build cannot name', () => {
  it.each(UNREADABLE_RAW)(
    'is refused by ALL THREE consumers — $$why',
    async ({ inputType, loadMode }) => {
      // The Workout Log: null modality, so nothing may be logged against it.
      // This is the one that used to say `bodyweight`, because the mapper had
      // already turned `future_mode` into `none`.
      expect(await workoutLogReads(inputType, loadMode)).toBeNull()

      // Progress: never ranked, charted, or made a Personal Best.
      expect(progressReads(inputType, loadMode)).toBe('unreadable')

      // Progression: no lane at all, so no guidance is derived from it.
      expect(progressionReads(inputType, loadMode)).toBe(0)
    },
  )
})

describe('a raw stored load mode that IS valid', () => {
  it.each(READABLE)(
    'is accepted by ALL THREE consumers — $$why',
    async ({ inputType, loadMode }) => {
      // NON-VACUITY for the agreement above: three consumers that refused
      // everything would agree just as neatly and be useless.
      expect(await workoutLogReads(inputType, loadMode)).toBe(inputType)
      expect(progressReads(inputType, loadMode)).toBe('eligible')
      expect(progressionReads(inputType, loadMode)).toBe(1)
    },
  )
})

describe('legacy rows are not reinterpreted by any of them', () => {
  const legacy = [
    { $why: 'kg', loadMode: 'kg', expected: 'weight_kg' },
    { $why: 'kg_each', loadMode: 'kg_each', expected: 'weight_kg' },
    { $why: 'none', loadMode: 'none', expected: 'bodyweight' },
  ]

  it.each(legacy)('reads a pre-Round-20 $$why row consistently', async ({ loadMode, expected }) => {
    // No snapshot at all: the shape every row in the existing history has. It
    // derives from its own frozen load mode, in all three consumers alike.
    const fake = createFakeD1()
    const store = createD1WorkoutStore(fake.db)
    await startWorkout(
      store,
      ACCOUNT,
      DATE,
      SESSION,
      {
        day: 'Monday',
        focus: 'F',
        intensity: 'HARD',
        sourceSessionId: null,
        exercises: [
          {
            exerciseId: 'lat-pulldown',
            name: 'Lat Pulldown',
            prescription: '4 × 10–15',
            equipment: null,
            resultKind: 'reps',
            loadMode: 'kg',
            perSide: false,
            setCount: 1,
          },
        ],
      },
      1,
      'token-1',
    )
    for (const row of fake.workoutSets.values()) {
      row.input_type_snapshot = null
      row.load_mode_snapshot = loadMode
    }

    const log = await readWorkout(store, ACCOUNT, DATE, SESSION)
    expect(log?.sets[0]?.inputType).toBe(expected)
    expect(progressReads(null as unknown as string, loadMode)).toBe('eligible')
    expect(progressionReads(null as unknown as string, loadMode)).toBe(1)
  })
})
