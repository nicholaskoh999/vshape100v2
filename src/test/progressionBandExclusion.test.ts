import { describe, expect, it } from 'vitest'

import {
  deriveSessionProgression,
  type LaneRecommendation,
  type ProgressionInput,
  type ProgressionSetRow,
} from '@shared/progression/engine'

/**
 * Round 20 — what Round 16's progression engine may and may not judge.
 *
 * DOUBLE PROGRESSION IS A METHOD ABOUT KILOGRAMS.
 *
 * "Hold the load until every set reaches the top of the range, then add one
 * step" only means something where a step is a real number of kilograms from an
 * authoritative ladder — the gym's plates, the dumbbell rack. There is no such
 * ladder for bands. A black band is not a quantity this app can add to, and
 * turning "one more band" into kilograms would be inventing a measurement.
 *
 * So band work is REFUSED rather than approximated. That is a smaller answer
 * than the user might want from a training app, and it is the only honest one
 * available.
 *
 * NON-VACUITY. Every refusal here is paired with a control: the identical lane,
 * identical prescription, identical history, differing only in the modality,
 * which DOES receive a full recommendation. Without that pairing, an engine
 * that had simply stopped working would pass every test below.
 */

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

type SetSpec = { result: number; load?: number | null }

type SlotSpec = {
  date: string
  /** Round 20's frozen modality. Null is a row written before it. */
  inputTypeSnapshot?: string | null
  band?: { label: string; count: number }
  loadMode?: string
  prescription?: string
  sets: SetSpec[]
}

/** Stored rows for one exercise position in one occurrence. */
function slot(spec: SlotSpec): ProgressionSetRow[] {
  const loadMode = spec.loadMode ?? 'kg'
  return spec.sets.map((set, setIndex) => ({
    workoutDate: spec.date,
    exerciseOrder: 0,
    setIndex,
    exerciseId: 'triceps-pushdown',
    exerciseName: 'Triceps Pushdown',
    prescription: spec.prescription ?? '3 × 12–15',
    resultKind: 'reps',
    loadMode,
    perSide: false,
    status: 'completed',
    loadValue: set.load ?? null,
    loadUnit: set.load === undefined || set.load === null ? null : loadMode,
    result: set.result,
    inputTypeSnapshot: spec.inputTypeSnapshot ?? null,
    bandLabel: spec.band?.label ?? null,
    bandCount: spec.band?.count ?? null,
  }))
}

/** Band work: no kilograms anywhere, and a named band on every set. */
function bandSlot(date: string, results: number[]): ProgressionSetRow[] {
  return slot({
    date,
    loadMode: 'none',
    inputTypeSnapshot: 'resistance_band',
    band: { label: 'Black', count: 3 },
    sets: results.map((result) => ({ result })),
  })
}

/** The SAME lane in kilograms — the control for every band assertion. */
function kilogramSlot(date: string, load: number, results: number[]): ProgressionSetRow[] {
  return slot({
    date,
    loadMode: 'kg',
    inputTypeSnapshot: 'weight_kg',
    sets: results.map((result) => ({ result, load })),
  })
}

/** Bodyweight work: no load, and no band either. */
function bodyweightSlot(date: string, results: number[]): ProgressionSetRow[] {
  return slot({
    date,
    loadMode: 'none',
    inputTypeSnapshot: 'bodyweight',
    sets: results.map((result) => ({ result })),
  })
}

function only(input: Partial<ProgressionInput> & { current: ProgressionSetRow[] }): LaneRecommendation {
  const { lanes } = deriveSessionProgression({
    sessionId: 'tuesday',
    intensity: 'HARD',
    history: [],
    calibration: [],
    historyComplete: true,
    ...input,
  })
  expect(lanes).toHaveLength(1)
  return lanes[0]
}

/* ------------------------------------------------------------------ */
/* I. Band work is excluded, and says so                               */
/* ------------------------------------------------------------------ */

describe('I. band work receives no load progression', () => {
  it('refuses to recommend a load, and explains why in the user’s terms', () => {
    const lane = only({
      current: bandSlot('2026-09-15', [15, 15, 15]),
      history: [...bandSlot('2026-09-01', [15, 15, 15]), ...bandSlot('2026-09-08', [15, 15, 15])],
    })

    expect(lane.reasonCode).toBe('band_not_progressable')
    expect(lane.state).toBe('quality')
    // The three things that would each be a lie about band resistance.
    expect(lane.suggestedLoad).toBeNull()
    expect(lane.loadDirection).toBeNull()
    expect(lane.calibration).toBeNull()
    // And it does not silently become "kilograms" in the wording either.
    expect(lane.reason).toMatch(/band/i)
    expect(lane.reason).not.toMatch(/\d+\s?kg/i)
  })

  it('refuses EVEN WHEN every set hit the top of the range twice over', () => {
    // This is exactly the evidence that makes a kilogram lane add a step. It
    // is the strongest case for progressing, and it still does not apply.
    const lane = only({
      current: bandSlot('2026-09-15', [15, 15, 15]),
      history: bandSlot('2026-09-08', [15, 15, 15]),
    })

    expect(lane.reasonCode).toBe('band_not_progressable')
    expect(lane.suggestedLoad).toBeNull()
  })

  it('DOES progress the identical lane in kilograms', () => {
    // NON-VACUITY. Same exercise, same prescription, same rep history, same
    // shape of evidence — differing only in the modality.
    const lane = only({
      current: kilogramSlot('2026-09-15', 30, [15, 15, 15]),
      history: kilogramSlot('2026-09-08', 30, [15, 15, 15]),
    })

    expect(lane.reasonCode).toBe('all_sets_at_upper_bound')
    // It reaches a real verdict about the load. Whether it can also name the
    // next number depends on whether an authoritative hardware ladder covers
    // this exercise — which is Round 16's business, not this round's. What
    // matters here is that the band lane never gets this far at all.
    expect(lane.reason).toMatch(/\d+\s?kg/i)
    expect(lane.reason).toMatch(/increase/i)
  })

  it('never asks a band lane to calibrate a starting load', () => {
    // Calibration asks "how did that weight feel". There is no weight.
    const lane = only({ current: bandSlot('2026-09-15', [12, 12, 12]) })

    expect(lane.reasonCode).toBe('band_not_progressable')
    expect(lane.calibration).toBeNull()
  })

  it('DOES ask the kilogram lane to calibrate, from the same position', () => {
    // NON-VACUITY for the calibration refusal.
    const lane = only({ current: kilogramSlot('2026-09-15', 30, [12, 12, 12]) })

    expect(lane.reasonCode).not.toBe('band_not_progressable')
    expect(lane.calibration).not.toBeNull()
  })
})

/* ------------------------------------------------------------------ */
/* I (cont). Modalities are not each other's evidence                  */
/* ------------------------------------------------------------------ */

describe('I. one modality is never evidence about another', () => {
  it('does not let a band lane inherit kilogram history', () => {
    const lane = only({
      current: bandSlot('2026-09-15', [12, 12, 12]),
      history: kilogramSlot('2026-09-08', 30, [15, 15, 15]),
    })

    // Refused on modality, and carrying nothing at all from the 30 kg session.
    expect(lane.reasonCode).toBe('band_not_progressable')
    expect(lane.suggestedLoad).toBeNull()
    expect(lane.lastResult).toBeNull()
  })

  it('does not let a kilogram lane inherit band history', () => {
    const lane = only({
      current: kilogramSlot('2026-09-15', 30, [12, 12, 12]),
      history: bandSlot('2026-09-08', [15, 15, 15]),
    })

    // The band session is not this lane's past. With no comparable history the
    // kilogram lane starts where it genuinely is: calibrating.
    expect(lane.lastResult).toBeNull()
    expect(lane.calibration).not.toBeNull()
  })

  it('does let a kilogram lane inherit KILOGRAM history', () => {
    // NON-VACUITY for both exclusions above: history is found when it is
    // genuinely the same kind of work.
    const lane = only({
      current: kilogramSlot('2026-09-15', 30, [12, 12, 12]),
      history: kilogramSlot('2026-09-08', 30, [15, 15, 15]),
    })

    expect(lane.lastResult).not.toBeNull()
    expect(lane.lastResult?.date).toBe('2026-09-08')
  })

  it('keeps band and bodyweight apart, though both record no load', () => {
    // The load mode alone cannot tell these two apart — both freeze 'none' —
    // so the modality is matched explicitly. A set done with a band is not
    // evidence about a set done with nothing.
    const lane = only({
      current: bodyweightSlot('2026-09-15', [12, 12, 12]),
      history: bandSlot('2026-09-08', [15, 15, 15]),
    })

    expect(lane.reasonCode).toBe('no_load_target')
    expect(lane.lastResult).toBeNull()
  })
})

/* ------------------------------------------------------------------ */
/* I (cont). Everything else is unchanged                              */
/* ------------------------------------------------------------------ */

describe('I. the exclusion is narrow', () => {
  it('still calls bodyweight work bodyweight, not band work', () => {
    // Band work also freezes a load mode of 'none'. Answering "Bodyweight
    // work" for a band set would be true about the kilograms and false about
    // the training, so the two have separate answers.
    const lane = only({ current: bodyweightSlot('2026-09-15', [12, 12, 12]) })

    expect(lane.reasonCode).toBe('no_load_target')
    expect(lane.reason).toMatch(/bodyweight/i)
    expect(lane.suggestedLoad).toBeNull()
  })

  it('reads a pre-Round-20 kilogram row as kilograms and judges it normally', () => {
    // No snapshot at all — the shape every row in the user's existing history
    // has. It resolves from the load mode, not from the exercise's current
    // setting, so switching Triceps to bands today does not retroactively
    // silence last week's kilogram guidance.
    const lane = only({
      current: slot({
        date: '2026-09-15',
        loadMode: 'kg',
        inputTypeSnapshot: null,
        sets: [15, 15, 15].map((result) => ({ result, load: 30 })),
      }),
      history: slot({
        date: '2026-09-08',
        loadMode: 'kg',
        inputTypeSnapshot: null,
        sets: [15, 15, 15].map((result) => ({ result, load: 30 })),
      }),
    })

    expect(lane.reasonCode).toBe('all_sets_at_upper_bound')
    expect(lane.reason).toMatch(/30\s?kg/i)
  })

  it('fails closed when the stored modality cannot be read', () => {
    const unreadable = {
      date: '2026-09-15',
      loadMode: 'kg',
      inputTypeSnapshot: 'elastic_vibes',
      sets: [15, 15, 15].map((result) => ({ result, load: 30 })),
    }

    const { lanes } = deriveSessionProgression({
      sessionId: 'tuesday',
      intensity: 'HARD',
      current: slot(unreadable),
      history: [],
      calibration: [],
      historyComplete: true,
    })

    // No lane at all. An unreadable modality joins the engine's existing
    // fail-closed set — an unknown result kind, a load without its unit — and
    // withholds the whole surface rather than guessing that it was kilograms.
    expect(lanes).toEqual([])

    // NON-VACUITY: the identical rows with a modality this build can name
    // produce a lane.
    const readable = deriveSessionProgression({
      sessionId: 'tuesday',
      intensity: 'HARD',
      current: slot({ ...unreadable, inputTypeSnapshot: 'weight_kg' }),
      history: [],
      calibration: [],
      historyComplete: true,
    })
    expect(readable.lanes).toHaveLength(1)
  })
})
