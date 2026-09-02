import { describe, expect, it } from 'vitest'

import { deriveSessionProgression, type ProgressionSetRow } from '../../shared/progression/engine'
import { laneFingerprint } from '../../shared/progression/lane'
import { derivePerformance, readSet, type CompletedSetRow } from '../progress/performance'

/**
 * Round 21 — what a correction changes downstream, and what it must not.
 *
 * ONE CANONICAL EVIDENCE SOURCE. Progress, Personal Bests, Exercise Performance
 * and Round 16 progression all already derive from the stored sets. A
 * correction rewrites those stored facts, so every derived surface follows for
 * free — there is deliberately no second "corrected history" engine to keep in
 * step with the first.
 *
 * These tests hold the derivation to that promise, and check the two things
 * that must NOT move: the set is still completed, so completion counts, streaks
 * and Achievements are untouched; and a corrected band set stops being kilogram
 * evidence entirely rather than being converted into some.
 */

/** A stored row as it reads BEFORE correction: the legacy "3 kg × 12". */
function legacyKilogramRow(over: Partial<CompletedSetRow> = {}): CompletedSetRow {
  return {
    exerciseId: 'triceps-pushdown',
    exerciseName: 'Triceps Pushdown',
    resultKind: 'reps',
    loadMode: 'kg',
    perSide: 0,
    loadValue: 3,
    loadUnit: 'kg',
    result: 12,
    workoutDate: '2026-09-01',
    sessionId: 'tuesday',
    startedAt: 100,
    inputTypeSnapshot: null,
    bandLabel: null,
    bandCount: null,
    ...over,
  }
}

/** The same row AFTER the user corrects it to three black bands. */
function correctedBandRow(over: Partial<CompletedSetRow> = {}): CompletedSetRow {
  return legacyKilogramRow({
    loadMode: 'none',
    loadValue: null,
    loadUnit: null,
    inputTypeSnapshot: 'resistance_band',
    bandLabel: 'Black',
    bandCount: 3,
    ...over,
  })
}

function eligible(row: CompletedSetRow) {
  const read = readSet(row)
  if (read.status !== 'eligible') throw new Error(`expected eligible, got ${read.status}`)
  return read.set
}

/* ------------------------------------------------------------------ */
/* Progress, PB and Exercise Performance                               */
/* ------------------------------------------------------------------ */

describe('a correction moves the evidence, and the derivation follows', () => {
  it('stops reporting the old kilogram best once the row says bands', () => {
    const before = derivePerformance([eligible(legacyKilogramRow())])
    expect(before[0].inputType).toBe('weight_kg')
    expect(before[0].personalBest?.loadValue).toBe(3)

    const after = derivePerformance([eligible(correctedBandRow())])
    // The "3 kg × 12" reading is gone from this set's factual read.
    expect(after).toHaveLength(1)
    expect(after[0].inputType).toBe('resistance_band')
    expect(after[0].band).toEqual({ label: 'Black', count: 3 })
    expect(after[0].personalBest?.loadValue).toBeNull()
    expect(after[0].personalBest?.result).toBe(12)
  })

  it('files the corrected set in the BAND comparable bucket, apart from kilograms', () => {
    // A kilogram set of the same exercise on another day, left uncorrected.
    const kilograms = eligible(
      legacyKilogramRow({ workoutDate: '2026-08-25', startedAt: 50, loadValue: 5 }),
    )
    const corrected = eligible(correctedBandRow())

    const variants = derivePerformance([kilograms, corrected])
    expect(variants).toHaveLength(2)
    expect(variants.map((v) => v.inputType).sort()).toEqual(['resistance_band', 'weight_kg'])

    // No comparison between them is even expressible: different buckets, and
    // the band bucket carries no kilogram number to compare with.
    const band = variants.find((v) => v.inputType === 'resistance_band')
    expect(band?.points.every((p) => p.loadValue === null)).toBe(true)
  })

  it('does not rank one band setup against another', () => {
    const black = eligible(correctedBandRow())
    const red = eligible(
      correctedBandRow({ bandLabel: 'Red', bandCount: 2, workoutDate: '2026-09-08', startedAt: 200 }),
    )
    const variants = derivePerformance([black, red])
    // Separate buckets, so nothing has to decide which band is stronger.
    expect(variants).toHaveLength(2)
  })

  it('keeps a corrected KILOGRAM set comparable with its own history', () => {
    // NON-VACUITY: a correction that stays within kilograms still belongs in
    // the same bucket, so the separation above is about the modality.
    const older = eligible(legacyKilogramRow({ workoutDate: '2026-08-25', startedAt: 50 }))
    const corrected = eligible(
      legacyKilogramRow({ inputTypeSnapshot: 'weight_kg', loadValue: 12 }),
    )
    const variants = derivePerformance([older, corrected])
    expect(variants).toHaveLength(1)
    expect(variants[0].personalBest?.loadValue).toBe(12)
  })
})

/* ------------------------------------------------------------------ */
/* Round 16 progression                                                */
/* ------------------------------------------------------------------ */

function progressionRow(over: Partial<ProgressionSetRow> = {}): ProgressionSetRow {
  return {
    workoutDate: '2026-09-01',
    exerciseOrder: 0,
    setIndex: 0,
    exerciseId: 'triceps-pushdown',
    exerciseName: 'Triceps Pushdown',
    prescription: '3 × 12–15',
    resultKind: 'reps',
    loadMode: 'kg',
    perSide: false,
    status: 'completed',
    loadValue: 10,
    loadUnit: 'kg',
    result: 15,
    inputTypeSnapshot: null,
    bandLabel: null,
    bandCount: null,
    ...over,
  }
}

function slot(over: Partial<ProgressionSetRow> = {}, results = [15, 15, 15]) {
  return results.map((result, setIndex) => progressionRow({ ...over, setIndex, result }))
}

function lanes(input: {
  current: ProgressionSetRow[]
  history?: ProgressionSetRow[]
  calibration?: Parameters<typeof deriveSessionProgression>[0]['calibration']
}) {
  return deriveSessionProgression({
    sessionId: 'tuesday',
    intensity: 'HARD',
    current: input.current,
    history: input.history ?? [],
    calibration: input.calibration ?? [],
    historyComplete: true,
  }).lanes
}

describe('progression reads the corrected facts', () => {
  it('derives from the corrected kilogram load, not the old one', () => {
    const beforeLane = lanes({ current: slot({ loadValue: 10 }) })[0]
    expect(beforeLane.reason).toMatch(/10\s?kg/)

    // The user corrects the recorded load from 10 kg to 12 kg.
    const afterLane = lanes({ current: slot({ loadValue: 12, inputTypeSnapshot: 'weight_kg' }) })[0]
    expect(afterLane.reason).toMatch(/12\s?kg/)
    expect(afterLane.reason).not.toMatch(/10\s?kg/)
  })

  it('stops being kilogram evidence once corrected to bands', () => {
    const lane = lanes({
      current: slot({
        loadMode: 'none',
        loadValue: null,
        loadUnit: null,
        inputTypeSnapshot: 'resistance_band',
        bandLabel: 'Black',
        bandCount: 3,
      }),
    })[0]

    // Refused outright, with no kilogram number anywhere in the guidance.
    expect(lane.reasonCode).toBe('band_not_progressable')
    expect(lane.suggestedLoad).toBeNull()
    expect(lane.loadDirection).toBeNull()
    expect(lane.reason).not.toMatch(/\d+\s?kg/i)
  })

  it('cannot use a corrected band session as history for a kilogram lane', () => {
    const lane = lanes({
      current: slot({ inputTypeSnapshot: 'weight_kg', loadValue: 12 }),
      history: slot(
        {
          workoutDate: '2026-08-25',
          loadMode: 'none',
          loadValue: null,
          loadUnit: null,
          inputTypeSnapshot: 'resistance_band',
          bandLabel: 'Black',
          bandCount: 3,
        },
      ),
    })[0]

    // The corrected band session is not this lane's past.
    expect(lane.lastResult).toBeNull()
  })

  it('DOES use a corrected kilogram session as history', () => {
    // NON-VACUITY for the exclusion above.
    const lane = lanes({
      current: slot({ inputTypeSnapshot: 'weight_kg', loadValue: 12 }),
      history: slot({ workoutDate: '2026-08-25', inputTypeSnapshot: 'weight_kg', loadValue: 12 }),
    })[0]
    expect(lane.lastResult).not.toBeNull()
    expect(lane.lastResult?.date).toBe('2026-08-25')
  })
})

/* ------------------------------------------------------------------ */
/* Calibration fails closed, by its existing design                    */
/* ------------------------------------------------------------------ */

describe('stale calibration cannot guide after a correction', () => {
  /** Round 16 stores the load the user's feedback was ABOUT. */
  function calibrationFor(observed: { value: number; unit: 'kg' | 'kg_each' }) {
    const lane = {
      sessionId: 'tuesday',
      exerciseId: 'triceps-pushdown',
      setCount: 3,
      lower: 12,
      upper: 15,
      resultKind: 'reps' as const,
      loadMode: 'kg' as const,
      perSide: false,
      inputType: 'weight_kg' as const,
    }
    return [
      {
        exerciseOrder: 0,
        fingerprint: laneFingerprint(lane),
        feedback: 'too_light' as const,
        observedLoad: observed,
        chosenLoad: { value: 14, unit: 'kg' as const },
      },
    ]
  }

  it('applies while the observed load still matches what is recorded', () => {
    // NON-VACUITY first: this calibration genuinely influences guidance, so the
    // refusals below are about the CORRECTION and not about calibration being
    // inert.
    const lane = lanes({
      current: slot({ loadValue: 10, inputTypeSnapshot: 'weight_kg' }, [12, 12, 12]),
      calibration: calibrationFor({ value: 10, unit: 'kg' }),
    })[0]
    expect(lane.calibration?.stage).toBe('settled')
    expect(lane.reasonCode).toBe('calibrated_too_light')
    // The load the USER chose after judging the set - repeated, never computed.
    expect(lane.suggestedLoad).toEqual({ value: 14, unit: 'kg' })
  })

  it('stops applying once the set is corrected to a DIFFERENT kilogram load', () => {
    // The feedback was about 10 kg. The set now says 12 kg, so the judgement is
    // about a load that is no longer recorded. Round 16's existing read-time
    // guard already fails closed on exactly this — it matches the stored
    // observed load against what the set says — and a correction is simply
    // another way for them to stop matching. No new invalidation engine.
    const lane = lanes({
      current: slot({ loadValue: 12, inputTypeSnapshot: 'weight_kg' }, [12, 12, 12]),
      calibration: calibrationFor({ value: 10, unit: 'kg' }),
    })[0]

    // Back to asking, rather than carrying the stale judgement forward.
    expect(lane.calibration?.stage).toBe('awaiting_feedback')
    expect(lane.reasonCode).not.toBe('calibrated_too_light')
    // And crucially the load the user chose for the OLD reading is not
    // suggested for the new one.
    expect(lane.suggestedLoad).not.toEqual({ value: 14, unit: 'kg' })
  })

  it('cannot influence guidance at all once the set is corrected to bands', () => {
    const lane = lanes({
      current: slot(
        {
          loadMode: 'none',
          loadValue: null,
          loadUnit: null,
          inputTypeSnapshot: 'resistance_band',
          bandLabel: 'Black',
          bandCount: 3,
        },
        [12, 12, 12],
      ),
      calibration: calibrationFor({ value: 10, unit: 'kg' }),
    })[0]

    expect(lane.reasonCode).toBe('band_not_progressable')
    expect(lane.calibration).toBeNull()
    expect(lane.suggestedLoad).toBeNull()
  })

  it('never deletes the stored calibration row, it just stops matching it', () => {
    // The architecture is read-time, not a cleanup pass. A correction makes the
    // stored feedback stop applying; it does not go and remove it, so nothing
    // here can destroy a judgement that another lane might still match.
    const stored = calibrationFor({ value: 10, unit: 'kg' })
    lanes({
      current: slot({ loadValue: 12, inputTypeSnapshot: 'weight_kg' }, [12, 12, 12]),
      calibration: stored,
    })

    expect(stored).toHaveLength(1)
    expect(stored[0].observedLoad).toEqual({ value: 10, unit: 'kg' })
    expect(stored[0].chosenLoad).toEqual({ value: 14, unit: 'kg' })
  })
})

/* ------------------------------------------------------------------ */
/* What a correction must NOT move                                     */
/* ------------------------------------------------------------------ */

describe('completion truth is untouched by a correction', () => {
  it('keeps the set completed, so counts and streaks cannot shift', () => {
    // Both readings are of a COMPLETED set. Nothing about a correction changes
    // whether the training happened, so completed-set totals, planned-session
    // Achievement qualification and the scheduled streak all read the same
    // before and after.
    expect(readSet(legacyKilogramRow()).status).toBe('eligible')
    expect(readSet(correctedBandRow()).status).toBe('eligible')

    const before = derivePerformance([eligible(legacyKilogramRow())])
    const after = derivePerformance([eligible(correctedBandRow())])
    // One completed set before, one after: the same amount of training.
    expect(before[0].points).toHaveLength(1)
    expect(after[0].points).toHaveLength(1)
    expect(before[0].lastPerformed).toBe(after[0].lastPerformed)
  })
})
