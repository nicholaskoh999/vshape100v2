import { afterEach, describe, expect, it, vi } from 'vitest'

import { fetchProgression } from '@/features/training/progressionApi'
import {
  EVIDENCE_GAPS,
  PROGRESSION_REASON_CODES,
  PROGRESSION_STATES,
} from '@shared/progression/engine'

/**
 * Round 16 — reading the progression wire.
 *
 * The browser is the last place a value can be refused before it reaches a
 * suggestion, a button or an input. A lane it cannot read whole is DROPPED:
 * an exercise with no guidance simply shows no guidance, which is honest,
 * whereas a half-read lane would still look like advice.
 *
 * Nothing here is cosmetic. Every field below either drives an action or names
 * what a state means, and the vocabularies are checked against the very lists
 * the engine is built from — not a second copy that could drift from them.
 */

const DATE = '2026-09-07'
const SESSION = 'monday'

/** One completely well-formed lane, as the server sends it. */
function validLane(overrides: Record<string, unknown> = {}) {
  return {
    exerciseOrder: 0,
    exerciseId: 'lat-pulldown',
    exerciseName: 'Lat Pulldown',
    prescription: '4 × 10–15',
    fingerprint: 'v1|monday|lat-pulldown|4|10|15|reps|kg|both',
    lane: {
      sessionId: 'monday',
      exerciseId: 'lat-pulldown',
      setCount: 4,
      lower: 10,
      upper: 15,
      resultKind: 'reps',
      loadMode: 'kg',
      perSide: false,
      inputType: 'weight_kg',
    },
    state: 'build_reps',
    reasonCode: 'below_upper_bound',
    gap: null,
    reason: 'Keep 20kg and build towards 15 on every set.',
    suggestedLoad: { value: 20, unit: 'kg' },
    loadDirection: null,
    target: {
      text: '10–15',
      lower: 10,
      upper: 15,
      resultKind: 'reps',
      perSide: false,
      setCount: 4,
    },
    lastResult: {
      date: '2026-08-31',
      results: [12, 12, 11, 10],
      load: { value: 20, unit: 'kg' },
      prescribed: 4,
      completed: 4,
      skipped: 0,
      pending: 0,
    },
    calibration: null,
    ...overrides,
  }
}

function serve(body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    ),
  )
}

/** Read one lane payload through the real client. */
async function read(lane: unknown) {
  serve({ date: DATE, sessionId: SESSION, started: true, intensity: 'HARD', ruleset: 'hard', lanes: [lane] })
  return (await fetchProgression(DATE, SESSION)).lanes
}

/** A payload that must be refused leaves the exercise with no guidance. */
async function dropped(overrides: Record<string, unknown>) {
  return (await read(validLane(overrides))).length === 0
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('a well-formed lane', () => {
  it('is read whole', async () => {
    const [lane] = await read(validLane())
    expect(lane).toMatchObject({
      exerciseOrder: 0,
      exerciseId: 'lat-pulldown',
      state: 'build_reps',
      reasonCode: 'below_upper_bound',
      suggestedLoad: { value: 20, unit: 'kg' },
      loadDirection: null,
    })
    expect(lane.lane).toMatchObject({ sessionId: 'monday', perSide: false })
    expect(lane.target).toMatchObject({ lower: 10, upper: 15 })
    expect(lane.lastResult).toMatchObject({ date: '2026-08-31', results: [12, 12, 11, 10] })
  })

  it('accepts every state, reason code and evidence gap the engine can produce', async () => {
    for (const state of PROGRESSION_STATES) {
      expect((await read(validLane({ state }))).length, state).toBe(1)
    }
    for (const reasonCode of PROGRESSION_REASON_CODES) {
      expect((await read(validLane({ reasonCode }))).length, reasonCode).toBe(1)
    }
    for (const gap of EVIDENCE_GAPS) {
      const [lane] = await read(validLane({ state: 'hold', reasonCode: 'evidence_incomplete', gap }))
      expect(lane.gap, gap).toBe(gap)
    }
  })
})

describe('vocabularies are checked, never cast', () => {
  it('drops a lane whose state is not one the engine produces', async () => {
    for (const state of ['deload', 'BUILD_REPS', '', 7, null]) {
      expect(await dropped({ state }), String(state)).toBe(true)
    }
  })

  it('drops a lane whose reason code is not one the engine produces', async () => {
    for (const reasonCode of ['because', 'BELOW_UPPER_BOUND', '', 3, null]) {
      expect(await dropped({ reasonCode }), String(reasonCode)).toBe(true)
    }
  })

  it('drops a lane whose evidence gap is not one the engine produces', async () => {
    for (const gap of ['tired', 'PENDING_SET', 5, {}]) {
      expect(await dropped({ gap }), String(gap)).toBe(true)
    }
  })

  it('still accepts an absent gap, which is the ordinary case', async () => {
    expect((await read(validLane({ gap: null }))).length).toBe(1)
    const bare = validLane()
    delete (bare as Record<string, unknown>).gap
    expect((await read(bare)).length).toBe(1)
  })
})

describe('actionable fields fail the whole lane', () => {
  it('drops a lane whose suggested load is present but not a load', async () => {
    for (const suggestedLoad of [
      { value: 'twenty', unit: 'kg' },
      { value: Number.NaN, unit: 'kg' },
      { value: Number.POSITIVE_INFINITY, unit: 'kg' },
      { value: -5, unit: 'kg' },
      { value: 20, unit: 'lbs' },
      { value: 20 },
      '20kg',
    ]) {
      expect(await dropped({ suggestedLoad }), JSON.stringify(suggestedLoad)).toBe(true)
    }
  })

  it('drops a lane whose load direction is present but not a direction', async () => {
    for (const loadDirection of ['up', 'INCREASE', 1, {}]) {
      expect(await dropped({ loadDirection }), String(loadDirection)).toBe(true)
    }
  })

  it('drops a lane whose calibration is present but unreadable', async () => {
    // An unreadable calibration would leave the Too light / Good / Too heavy
    // buttons describing nothing.
    for (const calibration of [
      { stage: 'thinking' },
      {},
      'settled',
      // Contradicts its own stage: settled means a judgement was made.
      { stage: 'settled', observedLoad: { value: 20, unit: 'kg' }, feedback: 'fine' },
      { stage: 'settled', observedLoad: { value: 20, unit: 'kg' }, feedback: null },
      { stage: 'settled', observedLoad: null, feedback: 'good' },
      // Awaiting a first set, yet carrying one.
      { stage: 'awaiting_first_set', observedLoad: { value: 20, unit: 'kg' } },
      { stage: 'awaiting_first_set', feedback: 'good' },
      // Awaiting a judgement, yet already carrying one.
      { stage: 'awaiting_feedback', observedLoad: { value: 20, unit: 'kg' }, feedback: 'good' },
      // A first set with no load is not a set calibration can be about.
      { stage: 'awaiting_feedback', observedLoad: null },
      { stage: 'settled', observedLoad: { value: 20, unit: 'kg' }, feedback: 'good', chosenLoad: { value: 25, unit: 'lbs' } },
    ]) {
      expect(await dropped({ calibration }), JSON.stringify(calibration)).toBe(true)
    }
  })

  it('reads each coherent calibration stage', async () => {
    const cases = [
      { stage: 'awaiting_first_set', observedLoad: null, feedback: null, chosenLoad: null },
      {
        stage: 'awaiting_feedback',
        observedLoad: { value: 20, unit: 'kg' },
        feedback: null,
        chosenLoad: null,
      },
      {
        stage: 'settled',
        observedLoad: { value: 20, unit: 'kg' },
        feedback: 'too_light',
        chosenLoad: { value: 25, unit: 'kg' },
      },
    ]
    for (const calibration of cases) {
      const [lane] = await read(validLane({ state: 'calibrate', reasonCode: 'awaiting_first_set', calibration }))
      expect(lane.calibration, calibration.stage).toMatchObject({ stage: calibration.stage })
    }
  })
})

describe('lane primitives are real values', () => {
  it('requires an actual boolean for per side', async () => {
    for (const perSide of ['false', 0, 1, null, undefined]) {
      expect(await dropped({ lane: { ...validLane().lane, perSide } }), String(perSide)).toBe(true)
      expect(await dropped({ target: { ...validLane().target, perSide } }), String(perSide)).toBe(
        true,
      )
    }
  })

  it('requires finite whole numbers for the lane bounds', async () => {
    for (const patch of [
      { setCount: 0 },
      { setCount: 4.5 },
      { setCount: Number.NaN },
      { lower: 0 },
      { upper: Number.POSITIVE_INFINITY },
      { lower: 15, upper: 10 },
      { lower: '10' },
    ]) {
      expect(await dropped({ lane: { ...validLane().lane, ...patch } }), JSON.stringify(patch)).toBe(
        true,
      )
      expect(
        await dropped({ target: { ...validLane().target, ...patch } }),
        JSON.stringify(patch),
      ).toBe(true)
    }
  })

  it('requires a whole exercise position and a real exercise id', async () => {
    expect(await dropped({ exerciseOrder: -1 })).toBe(true)
    expect(await dropped({ exerciseOrder: 1.5 })).toBe(true)
    expect(await dropped({ exerciseOrder: '0' })).toBe(true)
    expect(await dropped({ exerciseId: '' })).toBe(true)
    expect(await dropped({ reason: '' })).toBe(true)
  })

  it('never shortens a recorded session by filtering out a bad result', async () => {
    const lastResult = { ...validLane().lastResult, results: [12, 'twelve', 11, 10] }
    // Dropping the bad entry would show four prescribed sets as three
    // performed ones. The whole lane goes instead.
    expect(await dropped({ lastResult })).toBe(true)
  })

  it('requires whole counts on the factual reference', async () => {
    for (const patch of [{ completed: -1 }, { prescribed: 1.5 }, { skipped: 'none' }]) {
      expect(
        await dropped({ lastResult: { ...validLane().lastResult, ...patch } }),
        JSON.stringify(patch),
      ).toBe(true)
    }
  })
})

describe('the session envelope', () => {
  it('reports an unknown ruleset as none rather than guessing one', async () => {
    serve({
      date: DATE,
      sessionId: SESSION,
      started: true,
      intensity: 'DELOAD',
      ruleset: null,
      lanes: [],
    })
    const guidance = await fetchProgression(DATE, SESSION)
    expect(guidance.ruleset).toBeNull()
    expect(guidance.intensity).toBe('DELOAD')
  })

  it('reads a not-started workout as started: false', async () => {
    serve({ date: DATE, sessionId: SESSION, started: false, intensity: null, ruleset: null, lanes: [] })
    const guidance = await fetchProgression(DATE, SESSION)
    expect(guidance.started).toBe(false)
    expect(guidance.lanes).toEqual([])
  })

  it('drops only the unreadable lane, not the readable ones beside it', async () => {
    serve({
      date: DATE,
      sessionId: SESSION,
      started: true,
      intensity: 'HARD',
      ruleset: 'hard',
      lanes: [validLane(), validLane({ exerciseOrder: 1, state: 'nonsense' })],
    })
    const guidance = await fetchProgression(DATE, SESSION)
    expect(guidance.lanes.map((lane) => lane.exerciseOrder)).toEqual([0])
  })
})
