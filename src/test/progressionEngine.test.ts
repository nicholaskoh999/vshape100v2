import { describe, expect, it } from 'vitest'

import {
  deriveSessionProgression,
  type LaneRecommendation,
  type ProgressionInput,
  type ProgressionSetRow,
  type StoredCalibration,
} from '@shared/progression/engine'
import { laneFingerprint } from '@shared/progression/lane'
import { hardwareStep, resolveStep } from '@shared/progression/hardware'
import { parsePrescriptionTarget } from '@shared/progression/prescription'

/**
 * Round 16 — the progression engine, against the locked semantics.
 *
 * Every fixture here is stored workout truth in the shape D1 holds it. Nothing
 * is mocked: the real reader, the real lane identity and the real gates run.
 *
 * The tests are deliberately written as "what may this engine say, given what
 * actually happened" — never "does it produce the number I expected", because
 * the whole point of the round is that a number is only ever repeated from
 * history, never manufactured.
 */

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

type SetSpec = {
  status?: 'pending' | 'completed' | 'skipped' | string
  result?: number | null
  load?: number | null
  unit?: string | null
}

type SlotSpec = {
  date: string
  order?: number
  exerciseId?: string
  exerciseName?: string
  prescription?: string
  resultKind?: string
  loadMode?: string
  perSide?: boolean | number
  sets: SetSpec[]
}

/** Build the stored rows of one exercise slot in one occurrence. */
function slot(spec: SlotSpec): ProgressionSetRow[] {
  const loadMode = spec.loadMode ?? 'kg'
  return spec.sets.map((set, setIndex) => {
    const status = set.status ?? 'completed'
    const hasLoad = set.load !== undefined && set.load !== null
    return {
      workoutDate: spec.date,
      exerciseOrder: spec.order ?? 0,
      setIndex,
      exerciseId: spec.exerciseId ?? 'lat-pulldown',
      exerciseName: spec.exerciseName ?? 'Lat Pulldown',
      prescription: spec.prescription ?? '4 × 10–15',
      resultKind: spec.resultKind ?? 'reps',
      loadMode,
      perSide: spec.perSide ?? false,
      status,
      loadValue: hasLoad ? (set.load as number) : null,
      loadUnit: hasLoad ? (set.unit ?? loadMode) : (set.unit ?? null),
      result: status === 'completed' ? (set.result ?? null) : null,
    }
  })
}

/** A clean occurrence: every prescribed set completed at one load. */
function clean(date: string, load: number, results: number[], extra: Partial<SlotSpec> = {}) {
  return slot({
    date,
    sets: results.map((result) => ({ result, load })),
    ...extra,
  })
}

/** The pending sets a freshly started workout has. */
function fresh(setCount: number, extra: Partial<SlotSpec> = {}) {
  return slot({
    date: '2026-09-07',
    sets: Array.from({ length: setCount }, () => ({ status: 'pending' as const })),
    ...extra,
  })
}

function derive(input: Partial<ProgressionInput> & { current: ProgressionSetRow[] }) {
  return deriveSessionProgression({
    sessionId: 'monday',
    intensity: 'HARD',
    history: [],
    calibration: [],
    historyComplete: true,
    ...input,
  })
}

/** The single lane of a one-exercise fixture. */
function only(input: Partial<ProgressionInput> & { current: ProgressionSetRow[] }): LaneRecommendation {
  const lanes = derive(input).lanes
  expect(lanes).toHaveLength(1)
  return lanes[0]
}

/** Nothing in these states may ever come out of ambiguous evidence. */
function neverMoves(lane: LaneRecommendation) {
  expect(lane.state).not.toBe('increase_load')
  expect(lane.state).not.toBe('reduce_load')
  expect(lane.loadDirection).toBeNull()
}

/* ------------------------------------------------------------------ */
/* 1 — the authored target                                             */
/* ------------------------------------------------------------------ */

describe('authored targets', () => {
  it('reads the lower and upper bound of a range', () => {
    expect(parsePrescriptionTarget('4 × 10–15')).toMatchObject({
      setCount: 4,
      lower: 10,
      upper: 15,
      resultKind: 'reps',
      perSide: false,
    })
  })

  it('reads a single-number target as a real target, not a missing range', () => {
    expect(parsePrescriptionTarget('3 × 10 / side')).toMatchObject({
      setCount: 3,
      lower: 10,
      upper: 10,
      perSide: true,
    })
  })

  it('reads a seconds hold', () => {
    expect(parsePrescriptionTarget('3 × 30–60s')).toMatchObject({
      lower: 30,
      upper: 60,
      resultKind: 'seconds',
    })
  })

  it('refuses text it cannot read a range from, rather than guessing one', () => {
    for (const raw of ['', 'as many as you can', '4 × many', '4 x 10–15', null, undefined]) {
      expect(parsePrescriptionTarget(raw as string | null | undefined), String(raw)).toBeNull()
    }
  })

  it('refuses a descending range instead of silently swapping it', () => {
    expect(parsePrescriptionTarget('4 × 15–10')).toBeNull()
  })
})

/* ------------------------------------------------------------------ */
/* 2 — calibration (matrix 1–5)                                        */
/* ------------------------------------------------------------------ */

describe('starting-load calibration', () => {
  it('1. a loaded lane with no comparable history starts in CALIBRATE', () => {
    const lane = only({ current: fresh(4) })
    expect(lane.state).toBe('calibrate')
    expect(lane.calibration?.stage).toBe('awaiting_first_set')
    expect(lane.suggestedLoad).toBeNull()
    neverMoves(lane)
  })

  it('1b. reps logged with no load are history, and still no comparable load', () => {
    const lane = only({
      current: fresh(4),
      history: slot({
        date: '2026-08-31',
        sets: [{ result: 12 }, { result: 12 }, { result: 12 }, { result: 12 }],
      }),
    })
    expect(lane.state).toBe('calibrate')
    expect(lane.calibration?.stage).toBe('awaiting_first_set')
  })

  it('2. the choices appear once the first working set is genuinely completed', () => {
    const lane = only({
      current: slot({
        date: '2026-09-07',
        sets: [
          { result: 12, load: 20 },
          { status: 'pending' },
          { status: 'pending' },
          { status: 'pending' },
        ],
      }),
    })
    expect(lane.state).toBe('calibrate')
    expect(lane.calibration?.stage).toBe('awaiting_feedback')
    expect(lane.calibration?.observedLoad).toEqual({ value: 20, unit: 'kg' })
    // Still no suggestion: nothing has been said about that set yet.
    expect(lane.suggestedLoad).toBeNull()
  })

  it('2b. a pending first set offers no choices at all', () => {
    const lane = only({
      current: slot({
        date: '2026-09-07',
        sets: [{ status: 'pending' }, { result: 12, load: 20 }, { status: 'pending' }, { status: 'pending' }],
      }),
    })
    // The lowest completed set with a load IS the first working set that was
    // completed, so this one calibrates from set 2 — a fact, not a guess.
    expect(lane.calibration?.observedLoad).toEqual({ value: 20, unit: 'kg' })
  })

  const firstSet = slot({
    date: '2026-09-07',
    sets: [
      { result: 12, load: 20 },
      { status: 'pending' },
      { status: 'pending' },
      { status: 'pending' },
    ],
  })

  const stored = (over: Partial<StoredCalibration> = {}): StoredCalibration => ({
    exerciseOrder: 0,
    fingerprint: laneFingerprint({
      sessionId: 'monday',
      exerciseId: 'lat-pulldown',
      setCount: 4,
      lower: 10,
      upper: 15,
      resultKind: 'reps',
      loadMode: 'kg',
      perSide: false,
    }),
    feedback: 'good',
    observedLoad: { value: 20, unit: 'kg' },
    chosenLoad: null,
    ...over,
  })

  it('3. Too Light points one available step up and names no number of its own', () => {
    const lane = only({
      current: firstSet,
      calibration: [stored({ feedback: 'too_light' })],
    })
    expect(lane.state).toBe('calibrate')
    expect(lane.reasonCode).toBe('calibrated_too_light')
    expect(lane.loadDirection).toBe('increase')
    // V2 models no hardware ladder, so there is no number to give.
    expect(lane.suggestedLoad).toBeNull()
    expect(lane.reason).toMatch(/one available step/)
  })

  it('3b. Too Light with a load the USER chose carries that number, not a computed one', () => {
    const lane = only({
      current: firstSet,
      calibration: [stored({ feedback: 'too_light', chosenLoad: { value: 25, unit: 'kg' } })],
    })
    expect(lane.suggestedLoad).toEqual({ value: 25, unit: 'kg' })
    expect(lane.loadDirection).toBe('increase')
  })

  it('4. Good keeps the load the first set actually recorded', () => {
    const lane = only({ current: firstSet, calibration: [stored({ feedback: 'good' })] })
    expect(lane.reasonCode).toBe('calibrated_good')
    expect(lane.suggestedLoad).toEqual({ value: 20, unit: 'kg' })
    expect(lane.loadDirection).toBeNull()
  })

  it('5. Too Heavy points one available step down and names no number of its own', () => {
    const lane = only({
      current: firstSet,
      calibration: [stored({ feedback: 'too_heavy' })],
    })
    expect(lane.reasonCode).toBe('calibrated_too_heavy')
    expect(lane.loadDirection).toBe('reduce')
    expect(lane.suggestedLoad).toBeNull()
  })

  it('never rewrites the completed set the judgement was about', () => {
    const lane = only({
      current: firstSet,
      calibration: [stored({ feedback: 'too_light', chosenLoad: { value: 25, unit: 'kg' } })],
    })
    // The observed load is still what was performed, whatever was suggested.
    expect(lane.calibration?.observedLoad).toEqual({ value: 20, unit: 'kg' })
  })

  it('ignores a judgement given about a load that is no longer recorded', () => {
    // The first set was corrected from 20 to 22.5 after the feedback.
    const lane = only({
      current: slot({
        date: '2026-09-07',
        sets: [
          { result: 12, load: 22.5 },
          { status: 'pending' },
          { status: 'pending' },
          { status: 'pending' },
        ],
      }),
      calibration: [stored({ feedback: 'too_light' })],
    })
    expect(lane.calibration?.stage).toBe('awaiting_feedback')
    expect(lane.suggestedLoad).toBeNull()
  })

  it('ignores a judgement given under a different lane', () => {
    const lane = only({
      current: firstSet,
      calibration: [stored({ feedback: 'good', fingerprint: 'v1|wednesday|lat-pulldown|2|15|20|reps|kg|both' })],
    })
    expect(lane.calibration?.stage).toBe('awaiting_feedback')
  })

  it('returns to asking when the first set is undone', () => {
    const lane = only({
      current: fresh(4),
      calibration: [stored({ feedback: 'good' })],
    })
    expect(lane.calibration?.stage).toBe('awaiting_first_set')
    expect(lane.suggestedLoad).toBeNull()
  })
})

/* ------------------------------------------------------------------ */
/* 3 — HARD double progression (matrix 8–12)                           */
/* ------------------------------------------------------------------ */

describe('HARD double progression', () => {
  it('8. BUILD_REPS: keeps the working load and climbs inside the range', () => {
    const lane = only({
      current: fresh(4),
      history: clean('2026-08-31', 20, [12, 12, 11, 10]),
    })
    expect(lane.state).toBe('build_reps')
    expect(lane.suggestedLoad).toEqual({ value: 20, unit: 'kg' })
    expect(lane.loadDirection).toBeNull()
    expect(lane.reason).toMatch(/build towards 15/i)
  })

  it('8b. one set short of the upper bound is still BUILD_REPS', () => {
    const lane = only({
      current: fresh(4),
      history: clean('2026-08-31', 20, [15, 15, 15, 14]),
    })
    expect(lane.state).toBe('build_reps')
    expect(lane.suggestedLoad).toEqual({ value: 20, unit: 'kg' })
  })

  it('9. INCREASE_LOAD only when EVERY prescribed set reached the upper bound', () => {
    const lane = only({
      current: fresh(4),
      history: clean('2026-08-31', 20, [15, 15, 15, 15]),
    })
    expect(lane.state).toBe('increase_load')
    expect(lane.loadDirection).toBe('increase')
    // No ladder exists, so no kilogram is invented for the next step.
    expect(lane.suggestedLoad).toBeNull()
  })

  it('9b. exceeding the upper bound counts too', () => {
    const lane = only({
      current: fresh(4),
      history: clean('2026-08-31', 20, [17, 16, 15, 18]),
    })
    expect(lane.state).toBe('increase_load')
  })

  it('9c. three of four at the upper bound does not increase', () => {
    const lane = only({
      current: fresh(4),
      history: clean('2026-08-31', 20, [15, 15, 15, 13]),
    })
    expect(lane.state).toBe('build_reps')
    neverMoves(lane)
  })

  it('10. one weak session HOLDS — it never deloads on its own', () => {
    const lane = only({
      current: fresh(4),
      history: clean('2026-08-31', 20, [8, 8, 9, 8]),
    })
    expect(lane.state).toBe('hold')
    expect(lane.reasonCode).toBe('single_weak_session')
    expect(lane.suggestedLoad).toEqual({ value: 20, unit: 'kg' })
    neverMoves(lane)
  })

  it('11. REDUCE_LOAD after two consecutive eligible sessions at the same load', () => {
    const lane = only({
      current: fresh(4),
      history: [
        ...clean('2026-08-24', 20, [8, 8, 9, 8]),
        ...clean('2026-08-31', 20, [9, 8, 8, 9]),
      ],
    })
    expect(lane.state).toBe('reduce_load')
    expect(lane.loadDirection).toBe('reduce')
    expect(lane.suggestedLoad).toBeNull()
  })

  it('12. a second poor session at a DIFFERENT load does not satisfy the gate', () => {
    const lane = only({
      current: fresh(4),
      history: [
        ...clean('2026-08-24', 22.5, [8, 8, 9, 8]),
        ...clean('2026-08-31', 20, [9, 8, 8, 9]),
      ],
    })
    expect(lane.state).toBe('hold')
    expect(lane.reasonCode).toBe('single_weak_session')
    neverMoves(lane)
  })

  it('12b. an unreadable session between two strikes breaks the pair', () => {
    const lane = only({
      current: fresh(4),
      history: [
        ...clean('2026-08-17', 20, [8, 8, 9, 8]),
        // Incomplete: this occurrence proves nothing either way.
        ...slot({
          date: '2026-08-24',
          sets: [
            { result: 9, load: 20 },
            { status: 'skipped' },
            { result: 8, load: 20 },
            { result: 8, load: 20 },
          ],
        }),
        ...clean('2026-08-31', 20, [9, 8, 8, 9]),
      ],
    })
    expect(lane.state).toBe('hold')
    neverMoves(lane)
  })

  it('12c. one strike that is only just under the lower bound still holds', () => {
    const lane = only({
      current: fresh(4),
      history: clean('2026-08-31', 20, [9, 9, 9, 9]),
    })
    expect(lane.state).toBe('hold')
  })

  it('the newest session governs, even when an older one was clean', () => {
    const lane = only({
      current: fresh(4),
      history: [
        ...clean('2026-08-24', 20, [15, 15, 15, 15]),
        // Last session could not be read as evidence. An older clean session
        // must not speak over it and add load.
        ...slot({
          date: '2026-08-31',
          sets: [
            { result: 15, load: 20 },
            { result: 15, load: 20 },
            { status: 'skipped' },
            { result: 15, load: 20 },
          ],
        }),
      ],
    })
    expect(lane.state).toBe('hold')
    expect(lane.gap).toBe('skipped_set')
    neverMoves(lane)
  })
})

/* ------------------------------------------------------------------ */
/* 4 — failing closed (matrix 13–17, 20, 30)                           */
/* ------------------------------------------------------------------ */

describe('evidence that must fail closed', () => {
  it('13. a pending set never triggers a load change', () => {
    const lane = only({
      current: fresh(4),
      history: slot({
        date: '2026-08-31',
        sets: [
          { result: 15, load: 20 },
          { result: 15, load: 20 },
          { result: 15, load: 20 },
          { status: 'pending' },
        ],
      }),
    })
    expect(lane.state).toBe('hold')
    expect(lane.gap).toBe('pending_set')
    neverMoves(lane)
  })

  it('14. a skipped working set never triggers a load change', () => {
    const lane = only({
      current: fresh(4),
      history: slot({
        date: '2026-08-31',
        sets: [
          { result: 15, load: 20 },
          { result: 15, load: 20 },
          { result: 15, load: 20 },
          { status: 'skipped' },
        ],
      }),
    })
    expect(lane.state).toBe('hold')
    expect(lane.gap).toBe('skipped_set')
    neverMoves(lane)
  })

  it('15. a completed set with no recorded load never triggers a load change', () => {
    const lane = only({
      current: fresh(4),
      history: slot({
        date: '2026-08-31',
        sets: [
          { result: 15, load: 20 },
          { result: 15, load: 20 },
          { result: 15, load: 20 },
          { result: 15 },
        ],
      }),
    })
    expect(lane.state).toBe('hold')
    expect(lane.gap).toBe('missing_load')
    neverMoves(lane)
  })

  it('16. two different working loads inside one session never trigger a change', () => {
    const lane = only({
      current: fresh(4),
      history: slot({
        date: '2026-08-31',
        sets: [
          { result: 15, load: 20 },
          { result: 15, load: 20 },
          { result: 15, load: 22.5 },
          { result: 15, load: 20 },
        ],
      }),
    })
    expect(lane.state).toBe('hold')
    expect(lane.gap).toBe('mixed_load')
    neverMoves(lane)
    // No single comparable load existed, so none is repeated back.
    expect(lane.suggestedLoad).toBeNull()
  })

  it('17. a kg / kg_each mismatch inside one slot fails the lane closed', () => {
    const lane = only({
      current: fresh(4),
      history: slot({
        date: '2026-08-31',
        loadMode: 'kg',
        sets: [
          { result: 15, load: 20 },
          { result: 15, load: 20, unit: 'kg_each' },
          { result: 15, load: 20 },
          { result: 15, load: 20 },
        ],
      }),
    })
    expect(lane.state).toBe('unavailable')
    expect(lane.reasonCode).toBe('unreadable_history')
    neverMoves(lane)
  })

  it('17b. kg history never feeds a kg_each lane — they are different lanes', () => {
    const lane = only({
      current: fresh(4, { loadMode: 'kg_each' }),
      history: clean('2026-08-31', 20, [15, 15, 15, 15], { loadMode: 'kg' }),
    })
    // 20 kg on a stack is not 20 kg in each hand. No evidence carries across.
    expect(lane.state).toBe('calibrate')
    neverMoves(lane)
  })

  it('20. the same exercise twice in one session with one prescription fails closed', () => {
    const lanes = derive({
      current: [...fresh(4), ...fresh(4, { order: 1 })],
      history: clean('2026-08-31', 20, [15, 15, 15, 15]),
    }).lanes

    expect(lanes).toHaveLength(2)
    for (const lane of lanes) {
      expect(lane.state).toBe('unavailable')
      expect(lane.reasonCode).toBe('ambiguous_slot')
      neverMoves(lane)
    }
  })

  it('20b. an ambiguous duplicate in HISTORY fails closed rather than picking one', () => {
    const lane = only({
      current: fresh(4),
      history: [
        ...clean('2026-08-31', 20, [15, 15, 15, 15]),
        ...clean('2026-08-31', 12.5, [15, 15, 15, 15], { order: 3 }),
      ],
    })
    expect(lane.state).toBe('unavailable')
    expect(lane.reasonCode).toBe('ambiguous_history')
    neverMoves(lane)
  })

  it('20c. the same exercise twice with DIFFERENT prescriptions is two clean lanes', () => {
    const lanes = derive({
      current: [
        ...fresh(4),
        ...fresh(2, { order: 1, prescription: '2 × 15–20' }),
      ],
      history: [
        ...clean('2026-08-31', 20, [15, 15, 15, 15]),
        ...clean('2026-08-31', 12.5, [16, 16], { order: 1, prescription: '2 × 15–20' }),
      ],
    }).lanes

    expect(lanes.map((lane) => lane.state)).toEqual(['increase_load', 'build_reps'])
    // Each lane repeated only its OWN load.
    expect(lanes[1].suggestedLoad).toEqual({ value: 12.5, unit: 'kg' })
  })

  it('30. an unreadable stored status fails the lane closed', () => {
    const lane = only({
      current: fresh(4),
      history: slot({
        date: '2026-08-31',
        sets: [
          { status: 'done', result: 15, load: 20 },
          { result: 15, load: 20 },
          { result: 15, load: 20 },
          { result: 15, load: 20 },
        ],
      }),
    })
    expect(lane.state).toBe('unavailable')
    expect(lane.reasonCode).toBe('unreadable_history')
    neverMoves(lane)
  })

  it('30b. a completed set with no result fails closed', () => {
    const lane = only({
      current: fresh(4),
      history: slot({
        date: '2026-08-31',
        sets: [
          { result: null, load: 20 },
          { result: 15, load: 20 },
          { result: 15, load: 20 },
          { result: 15, load: 20 },
        ],
      }),
    })
    expect(lane.state).toBe('unavailable')
  })

  it('30c. a load recorded against a set that was skipped fails closed', () => {
    const lane = only({
      current: fresh(4),
      history: slot({
        date: '2026-08-31',
        sets: [
          { status: 'skipped', load: 20 },
          { result: 15, load: 20 },
          { result: 15, load: 20 },
          { result: 15, load: 20 },
        ],
      }),
    })
    expect(lane.state).toBe('unavailable')
  })

  it('30d. a prescription with no readable target offers no guidance', () => {
    const lane = only({ current: fresh(4, { prescription: 'as many as you can' }) })
    expect(lane.state).toBe('unavailable')
    expect(lane.reasonCode).toBe('unreadable_prescription')
    expect(lane.target).toBeNull()
  })

  it('30e. a history read that could not prove its window fails every lane closed', () => {
    const lane = only({
      current: fresh(4),
      history: clean('2026-08-31', 20, [15, 15, 15, 15]),
      historyComplete: false,
    })
    expect(lane.state).toBe('unavailable')
    expect(lane.reasonCode).toBe('history_truncated')
    neverMoves(lane)
  })

  it('a session whose stored set count disagrees with its prescription holds', () => {
    const lane = only({
      current: fresh(4),
      history: slot({
        date: '2026-08-31',
        sets: [
          { result: 15, load: 20 },
          { result: 15, load: 20 },
          { result: 15, load: 20 },
        ],
      }),
    })
    expect(lane.state).toBe('hold')
    expect(lane.gap).toBe('structure_mismatch')
    neverMoves(lane)
  })
})

/* ------------------------------------------------------------------ */
/* 5 — lane isolation (matrix 18, 19, 21)                              */
/* ------------------------------------------------------------------ */

describe('lane isolation', () => {
  const base = {
    exerciseId: 'lat-pulldown',
    setCount: 4,
    lower: 10,
    upper: 15,
    resultKind: 'reps',
    loadMode: 'kg',
    perSide: false,
  } as const

  it('18. the same canonical exercise in two sessions is two lanes', () => {
    expect(laneFingerprint({ ...base, sessionId: 'monday' })).not.toBe(
      laneFingerprint({ ...base, sessionId: 'wednesday' }),
    )
  })

  it('19. a changed prescription starts a separate lane', () => {
    const lane = only({
      current: fresh(4, { prescription: '4 × 10–15' }),
      // The plan used to prescribe three sets of 8–12 here.
      history: clean('2026-08-31', 20, [12, 12, 12], { prescription: '3 × 8–12' }),
    })
    // The old lane's evidence is not this lane's, so this one starts fresh.
    expect(lane.state).toBe('calibrate')
    neverMoves(lane)

    expect(laneFingerprint({ ...base, sessionId: 'monday' })).not.toBe(
      laneFingerprint({ ...base, sessionId: 'monday', setCount: 3, lower: 8, upper: 12 }),
    )
  })

  it('19b. a purely typographic prescription change keeps one lane', () => {
    const lane = only({
      current: fresh(4, { prescription: '4 × 10-15' }),
      history: clean('2026-08-31', 20, [15, 15, 15, 15], { prescription: '4 × 10–15' }),
    })
    // An en dash and a hyphen prescribe exactly the same work.
    expect(lane.state).toBe('increase_load')
  })

  it('21. a per-side lane never draws on both-sides history', () => {
    const lane = only({
      current: fresh(4, { perSide: true }),
      history: clean('2026-08-31', 20, [15, 15, 15, 15], { perSide: false }),
    })
    expect(lane.state).toBe('calibrate')
    expect(laneFingerprint({ ...base, sessionId: 'monday', perSide: true })).not.toBe(
      laneFingerprint({ ...base, sessionId: 'monday', perSide: false }),
    )
  })

  it('an exercise that moved position in the session keeps its lane', () => {
    const lane = only({
      current: fresh(4, { order: 2 }),
      history: clean('2026-08-31', 20, [15, 15, 15, 15], { order: 0 }),
    })
    // Position identifies the workout slot, not the training work.
    expect(lane.state).toBe('increase_load')
  })

  it('one exercise cannot pick up another exercise’s history', () => {
    const lane = only({
      current: fresh(4, { exerciseId: 'face-pull', exerciseName: 'Face Pull' }),
      history: clean('2026-08-31', 20, [15, 15, 15, 15]),
    })
    expect(lane.state).toBe('calibrate')
  })
})

/* ------------------------------------------------------------------ */
/* 6 — LIGHT / PUMP and no-load (matrix 22–24)                         */
/* ------------------------------------------------------------------ */

describe('LIGHT, PUMP and work with no load', () => {
  it('22. LIGHT never auto-increases, even from a perfect session', () => {
    const lane = only({
      intensity: 'LIGHT',
      sessionId: 'wednesday',
      current: fresh(2, { prescription: '2 × 15–20' }),
      history: clean('2026-08-26', 12.5, [20, 20], { prescription: '2 × 15–20' }),
    })
    expect(lane.state).toBe('quality')
    expect(lane.loadDirection).toBeNull()
    // Only the SAME load is repeated back — a fact, never an increase.
    expect(lane.suggestedLoad).toEqual({ value: 12.5, unit: 'kg' })
    neverMoves(lane)
  })

  it('23. PUMP never auto-increases, even from a perfect session', () => {
    const lane = only({
      intensity: 'PUMP',
      sessionId: 'friday',
      current: fresh(3, { prescription: '3 × 15–20' }),
      history: clean('2026-08-28', 10, [20, 20, 20], { prescription: '3 × 15–20' }),
    })
    expect(lane.state).toBe('quality')
    expect(lane.suggestedLoad).toEqual({ value: 10, unit: 'kg' })
    neverMoves(lane)
  })

  it('22b. LIGHT never two-strikes its way into a reduction', () => {
    const lane = only({
      intensity: 'LIGHT',
      sessionId: 'wednesday',
      current: fresh(2, { prescription: '2 × 15–20' }),
      history: [
        ...clean('2026-08-19', 12.5, [10, 11], { prescription: '2 × 15–20' }),
        ...clean('2026-08-26', 12.5, [11, 10], { prescription: '2 × 15–20' }),
      ],
    })
    expect(lane.state).toBe('quality')
    neverMoves(lane)
  })

  it('22c. a LIGHT loaded lane with no history still calibrates', () => {
    const lane = only({
      intensity: 'LIGHT',
      sessionId: 'wednesday',
      current: fresh(2, { prescription: '2 × 15–20' }),
    })
    expect(lane.state).toBe('calibrate')
  })

  it('an unrecognised intensity never gets the HARD gates', () => {
    const lane = only({
      intensity: 'hard',
      current: fresh(4),
      history: clean('2026-08-31', 20, [15, 15, 15, 15]),
    })
    expect(lane.state).toBe('quality')
    neverMoves(lane)
  })

  it('24. bodyweight work never grows a load', () => {
    const lane = only({
      sessionId: 'wednesday',
      intensity: 'LIGHT',
      current: fresh(3, {
        exerciseId: 'plank',
        exerciseName: 'Plank',
        prescription: '3 × 30–60s',
        resultKind: 'seconds',
        loadMode: 'none',
      }),
      history: slot({
        date: '2026-08-26',
        exerciseId: 'plank',
        exerciseName: 'Plank',
        prescription: '3 × 30–60s',
        resultKind: 'seconds',
        loadMode: 'none',
        sets: [{ result: 60 }, { result: 60 }, { result: 60 }],
      }),
    })
    expect(lane.state).toBe('quality')
    expect(lane.suggestedLoad).toBeNull()
    expect(lane.loadDirection).toBeNull()
    expect(lane.target?.text).toBe('30–60s')
  })

  it('24b. per-side bodyweight work keeps its authored target', () => {
    const lane = only({
      sessionId: 'wednesday',
      intensity: 'LIGHT',
      current: fresh(3, {
        exerciseId: 'dead-bug',
        exerciseName: 'Dead Bug',
        prescription: '3 × 10 / side',
        loadMode: 'none',
        perSide: true,
      }),
    })
    expect(lane.state).toBe('quality')
    expect(lane.suggestedLoad).toBeNull()
    expect(lane.target).toMatchObject({ lower: 10, upper: 10, perSide: true })
  })

  it('a HARD timed hold is guided on its target, not on load', () => {
    const lane = only({
      intensity: 'HARD',
      current: fresh(3, {
        prescription: '3 × 30–60s',
        resultKind: 'seconds',
        loadMode: 'kg',
      }),
      history: slot({
        date: '2026-08-31',
        prescription: '3 × 30–60s',
        resultKind: 'seconds',
        sets: [
          { result: 60, load: 10 },
          { result: 60, load: 10 },
          { result: 60, load: 10 },
        ],
      }),
    })
    expect(lane.state).toBe('quality')
    neverMoves(lane)
  })
})

/* ------------------------------------------------------------------ */
/* 7 — the hardware ladder                                             */
/* ------------------------------------------------------------------ */

describe('hardware steps', () => {
  it('names no step, because V2 models no authoritative ladder', () => {
    expect(hardwareStep({ value: 20, unit: 'kg' }, 'increase')).toEqual({ known: false })
    expect(hardwareStep({ value: 20, unit: 'kg' }, 'reduce')).toEqual({ known: false })
    expect(hardwareStep({ value: 10, unit: 'kg_each' }, 'increase')).toEqual({ known: false })
  })

  it('does not infer 2.5kg — or any increment — from a load that permits halves', () => {
    for (const value of [20, 22.5, 12.5, 0]) {
      expect(hardwareStep({ value, unit: 'kg' }, 'increase')).toEqual({ known: false })
    }
  })

  it('steps along a real ladder when one genuinely exists', () => {
    const ladder = [10, 12.5, 15, 20] as const
    expect(resolveStep(ladder, { value: 12.5, unit: 'kg' }, 'increase')).toEqual({
      known: true,
      value: 15,
      unit: 'kg',
    })
    expect(resolveStep(ladder, { value: 12.5, unit: 'kg' }, 'reduce')).toEqual({
      known: true,
      value: 10,
      unit: 'kg',
    })
  })

  it('refuses to extrapolate past either end of a real ladder', () => {
    const ladder = [10, 12.5, 15] as const
    expect(resolveStep(ladder, { value: 15, unit: 'kg' }, 'increase')).toEqual({ known: false })
    expect(resolveStep(ladder, { value: 10, unit: 'kg' }, 'reduce')).toEqual({ known: false })
  })

  it('refuses to step from a load that is not on the ladder at all', () => {
    expect(resolveStep([10, 15], { value: 11, unit: 'kg' }, 'increase')).toEqual({ known: false })
  })
})

/* ------------------------------------------------------------------ */
/* 8 — the factual reference                                           */
/* ------------------------------------------------------------------ */

describe('the last factual reference', () => {
  it('reports what was actually recorded, nothing more', () => {
    const lane = only({
      current: fresh(4),
      history: [
        ...clean('2026-08-24', 20, [15, 15, 15, 15]),
        ...slot({
          date: '2026-08-31',
          sets: [
            { result: 12, load: 22.5 },
            { result: 11, load: 22.5 },
            { status: 'skipped' },
            { result: 10, load: 22.5 },
          ],
        }),
      ],
    })

    expect(lane.lastResult).toEqual({
      date: '2026-08-31',
      results: [12, 11, 10],
      load: { value: 22.5, unit: 'kg' },
      prescribed: 4,
      completed: 3,
      skipped: 1,
      pending: 0,
    })
    // A factual reference is not evidence: it still holds.
    expect(lane.state).toBe('hold')
  })

  it('has nothing to report before the lane has ever been performed', () => {
    expect(only({ current: fresh(4) }).lastResult).toBeNull()
  })
})
