import { describe, expect, it } from 'vitest'

import {
  deriveSessionProgression,
  type ProgressionSetRow,
} from '../../shared/progression/engine'
import type { WorkoutInputType } from '../../shared/workoutInput'
import {
  isCompatibleSnapshot,
  readSetModality,
  type WorkoutLoadMode,
} from '../../shared/workoutLog'
import { readSet, type CompletedSetRow } from '../progress/performance'
import { createD1WorkoutStore } from '../workouts/d1Store'
import { readWorkout, startWorkout } from '../workouts/workouts'
import { createFakeD1 } from './fakeD1'

/**
 * Round 20 Correction 1 — the persisted snapshot read boundary.
 *
 * A stored set carries BOTH an input type and a load mode, and only three
 * pairings are meaningful:
 *
 *   weight_kg        kg or kg_each
 *   resistance_band  none
 *   bodyweight       none
 *
 * `loadModeForInputType` forces this on every write, so the application cannot
 * produce anything else. That is precisely why the READ side checks it rather
 * than trusting it: a row claiming to be band work while also carrying kilogram
 * semantics is corrupt, and believing either half would put a fiction on screen.
 *
 * The rule lives in ONE place, and every reader of a persisted set goes through
 * it, so the workout log, Progress and the Round 16 progression engine cannot
 * disagree about which rows are coherent. These tests check the rule, and then
 * check that all three consumers actually apply it.
 */

type Pairing = { $why: string; inputType: WorkoutInputType; loadMode: WorkoutLoadMode }

const INCOHERENT: Pairing[] = [
  { $why: 'a band set claiming kilograms', inputType: 'resistance_band', loadMode: 'kg' },
  { $why: 'a band set claiming per-dumbbell', inputType: 'resistance_band', loadMode: 'kg_each' },
  { $why: 'bodyweight claiming kilograms', inputType: 'bodyweight', loadMode: 'kg' },
  { $why: 'bodyweight claiming per-dumbbell', inputType: 'bodyweight', loadMode: 'kg_each' },
  { $why: 'kilograms claiming no load', inputType: 'weight_kg', loadMode: 'none' },
]

const COHERENT: Pairing[] = [
  { $why: 'kilograms', inputType: 'weight_kg', loadMode: 'kg' },
  { $why: 'kilograms per dumbbell', inputType: 'weight_kg', loadMode: 'kg_each' },
  { $why: 'band work', inputType: 'resistance_band', loadMode: 'none' },
  { $why: 'bodyweight', inputType: 'bodyweight', loadMode: 'none' },
]

/* ------------------------------------------------------------------ */
/* The rule                                                            */
/* ------------------------------------------------------------------ */

describe('the compatibility rule', () => {
  it.each(COHERENT)('accepts $$why', ({ inputType, loadMode }) => {
    expect(isCompatibleSnapshot(inputType, loadMode)).toBe(true)
    expect(readSetModality(inputType, loadMode)).toBe(inputType)
  })

  it.each(INCOHERENT)('refuses $$why', ({ inputType, loadMode }) => {
    expect(isCompatibleSnapshot(inputType, loadMode)).toBe(false)
    // Null, not a repaired value. There is no basis for choosing which half of
    // a self-contradicting row to believe.
    expect(readSetModality(inputType, loadMode)).toBeNull()
  })

  it('still refuses a modality it has never heard of', () => {
    expect(readSetModality('elastic_vibes', 'kg')).toBeNull()
  })

  it('does NOT reinterpret a legacy row', () => {
    // No snapshot at all: the row predates Round 20 and derives from its own
    // frozen load mode, which is always a coherent pair. Nothing about this
    // hardening touches the history that already exists.
    expect(readSetModality(null, 'kg')).toBe('weight_kg')
    expect(readSetModality(null, 'kg_each')).toBe('weight_kg')
    expect(readSetModality(null, 'none')).toBe('bodyweight')
    expect(readSetModality(undefined, 'kg')).toBe('weight_kg')
  })
})

/* ------------------------------------------------------------------ */
/* Consumer 1 — the workout log                                        */
/* ------------------------------------------------------------------ */

describe('the workout log applies it', () => {
  async function storedWith(inputType: string, loadMode: string) {
    const fake = createFakeD1()
    const store = createD1WorkoutStore(fake.db)
    await startWorkout(
      store,
      'sub-a',
      '2026-09-01',
      'monday',
      {
        day: 'Monday',
        focus: 'F',
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
            setCount: 1,
          },
        ],
      },
      1,
      'token-1',
    )

    // Corrupt the stored pair directly, which the application itself cannot do.
    for (const row of fake.workoutSets.values()) {
      row.input_type_snapshot = inputType
      row.load_mode_snapshot = loadMode
    }

    const log = await readWorkout(store, 'sub-a', '2026-09-01', 'monday')
    return log?.sets[0]
  }

  it.each(INCOHERENT)('reads $$why as unreadable', async ({ inputType, loadMode }) => {
    expect((await storedWith(inputType, loadMode))?.inputType).toBeNull()
  })

  it.each(COHERENT)('reads $$why normally', async ({ inputType, loadMode }) => {
    expect((await storedWith(inputType, loadMode))?.inputType).toBe(inputType)
  })
})

/* ------------------------------------------------------------------ */
/* Consumer 2 — Progress and Personal Bests                            */
/* ------------------------------------------------------------------ */

describe('Progress applies it', () => {
  function row(inputType: string, loadMode: string): CompletedSetRow {
    const loaded = loadMode !== 'none'
    return {
      exerciseId: 'lat-pulldown',
      exerciseName: 'Lat Pulldown',
      resultKind: 'reps',
      loadMode,
      perSide: 0,
      loadValue: loaded ? 50 : null,
      loadUnit: loaded ? loadMode : null,
      result: 10,
      workoutDate: '2026-09-01',
      sessionId: 'monday',
      startedAt: 1,
      inputTypeSnapshot: inputType,
      bandLabel: inputType === 'resistance_band' && !loaded ? 'Black' : null,
      bandCount: inputType === 'resistance_band' && !loaded ? 3 : null,
    }
  }

  it.each(INCOHERENT)('refuses $$why', ({ inputType, loadMode }) => {
    // Never ranked, never charted, never a Personal Best.
    expect(readSet(row(inputType, loadMode))).toEqual({ status: 'unreadable' })
  })

  it.each(COHERENT)('accepts $$why', ({ inputType, loadMode }) => {
    expect(readSet(row(inputType, loadMode)).status).toBe('eligible')
  })
})

/* ------------------------------------------------------------------ */
/* Consumer 3 — Round 16 progression                                   */
/* ------------------------------------------------------------------ */

describe('the progression engine applies it', () => {
  function slot(inputType: string, loadMode: string): ProgressionSetRow[] {
    const loaded = loadMode !== 'none'
    return [12, 12, 12].map((result, setIndex) => ({
      workoutDate: '2026-09-01',
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
  }

  function lanes(inputType: string, loadMode: string) {
    return deriveSessionProgression({
      sessionId: 'monday',
      intensity: 'HARD',
      current: slot(inputType, loadMode),
      history: [],
      calibration: [],
      historyComplete: true,
    }).lanes
  }

  it.each(INCOHERENT)('offers no guidance at all for $$why', ({ inputType, loadMode }) => {
    expect(lanes(inputType, loadMode)).toEqual([])
  })

  it.each(COHERENT)('reaches a lane for $$why', ({ inputType, loadMode }) => {
    expect(lanes(inputType, loadMode)).toHaveLength(1)
  })
})
