import { describe, expect, it } from 'vitest'

import type { WorkoutInputType } from '../../shared/workoutInput'
import { createD1WorkoutStore } from '../workouts/d1Store'
import {
  applySetUpdate,
  parseSetUpdate,
  readWorkout,
  startWorkout,
  type SetOutcome,
  type StartOutcome,
  type StartResult,
  type WorkoutSetRecord,
  type WorkoutSetUpdate,
  type WorkoutStartInput,
  type WorkoutStore,
} from '../workouts/workouts'
import { createFakeD1 } from './fakeD1'

/**
 * Round 20 — the modality of a set, from Start to storage.
 *
 * THE DEFECT.
 *
 * Triceps Pushdown performed with a black band, three deep, was stored and
 * displayed as "3 kg x 12 reps". The count of bands had gone into the weight
 * column, because the weight column was the only place a number could go.
 *
 * WHAT THESE TESTS DEFEND.
 *
 *   1. the SERVER decides the modality, from the account's own saved setting,
 *      never from the request body
 *   2. it is FROZEN at Start, so reconfiguring an exercise mid-session cannot
 *      change what the workout in progress is recording
 *   3. a hybrid is UNREPRESENTABLE: a band set carries no kilograms and a
 *      kilogram set carries no band, enforced on write
 *   4. a legacy row keeps its own meaning, read from the load mode it froze
 *   5. an unreadable modality FAILS CLOSED rather than defaulting to kilograms
 *
 * The mismatch guard is checked for NON-VACUITY explicitly: every refusal is
 * paired with a control showing the same payload succeeds once the modality
 * actually matches. Without that pairing a test suite that refused everything
 * would look identical to one that refused the right things.
 */

const ACCOUNT_A = 'google-sub-a'
const ACCOUNT_B = 'google-sub-b'
const DATE = '2026-09-01'

function unwrap(outcome: StartOutcome): StartResult {
  if (!outcome.ok) throw new Error(`unexpected Start refusal: ${outcome.reason}`)
  return outcome.result
}

function makeStore(): WorkoutStore {
  return createD1WorkoutStore(createFakeD1().db)
}

/**
 * Tuesday as the client would send it, INCLUDING the old wrong load mode.
 *
 * Triceps asks for 'kg' because that is what the client's plan resolver
 * produces for it: the exercise carries no equipment text, so it falls to the
 * kilogram default. The server is expected to override that from the account's
 * own setting — that override is the fix.
 */
const TUESDAY: WorkoutStartInput = {
  day: 'Tuesday',
  focus: 'Chest + Triceps',
  intensity: 'HARD',
  sourceSessionId: null,
  exercises: [
    {
      exerciseId: 'incline-db-press',
      name: 'Incline DB Press',
      prescription: '4 x 8-12',
      equipment: 'DB + Bench Incline',
      resultKind: 'reps',
      loadMode: 'kg_each',
      perSide: false,
      setCount: 2,
    },
    {
      exerciseId: 'triceps-pushdown',
      name: 'Triceps Pushdown',
      prescription: '3 x 12-15',
      equipment: 'BAND',
      resultKind: 'reps',
      loadMode: 'kg',
      perSide: false,
      setCount: 2,
    },
  ],
}

const TRICEPS_BAND = new Map<string, WorkoutInputType>([
  ['triceps-pushdown', 'resistance_band'],
])

async function start(
  store: WorkoutStore,
  inputTypes: Map<string, WorkoutInputType> = new Map(),
): Promise<StartResult> {
  return unwrap(
    await startWorkout(store, ACCOUNT_A, DATE, 'tuesday', TUESDAY, 1, 'token-1', inputTypes),
  )
}

/** The stored set for one exercise position. */
function setAt(result: StartResult, exerciseOrder: number): WorkoutSetRecord {
  const found = result.sets.find((row) => row.exerciseOrder === exerciseOrder)
  if (!found) throw new Error(`no set at exercise order ${exerciseOrder}`)
  return found
}

function complete(
  result: number,
  over: Partial<Extract<WorkoutSetUpdate, { action: 'complete' }>> = {},
): WorkoutSetUpdate {
  return { action: 'complete', result, load: null, band: null, ...over }
}

/* ------------------------------------------------------------------ */
/* A. The server decides, and freezes                                  */
/* ------------------------------------------------------------------ */

describe('A. the modality is resolved server-side and frozen at Start', () => {
  it('takes the account setting, not the load mode the client asked for', async () => {
    const store = makeStore()
    const result = await start(store, TRICEPS_BAND)

    const triceps = setAt(result, 1)
    expect(triceps.inputType).toBe('resistance_band')
    // And the load mode is FORCED to agree. This is what makes a band set that
    // still carries kilogram semantics unrepresentable rather than unlikely —
    // the request asked for 'kg' and did not get it.
    expect(TUESDAY.exercises[1].loadMode).toBe('kg')
    expect(triceps.loadMode).toBe('none')
  })

  it('leaves an unconfigured exercise behaving exactly as it did before', async () => {
    const store = makeStore()
    const result = await start(store, TRICEPS_BAND)

    // Incline DB Press was never configured, so nothing about it changes: it
    // is still kilograms, still PER DUMBBELL.
    const press = setAt(result, 0)
    expect(press.inputType).toBe('weight_kg')
    expect(press.loadMode).toBe('kg_each')
  })

  it('is one account’s answer only', async () => {
    const store = makeStore()
    // Account A says bands; account B has said nothing at all.
    await startWorkout(store, ACCOUNT_A, DATE, 'tuesday', TUESDAY, 1, 'a', TRICEPS_BAND)
    await startWorkout(store, ACCOUNT_B, DATE, 'tuesday', TUESDAY, 1, 'b', new Map())

    const a = await readWorkout(store, ACCOUNT_A, DATE, 'tuesday')
    const b = await readWorkout(store, ACCOUNT_B, DATE, 'tuesday')

    expect(a?.sets.find((row) => row.exerciseOrder === 1)?.inputType).toBe('resistance_band')
    expect(b?.sets.find((row) => row.exerciseOrder === 1)?.inputType).toBe('weight_kg')
  })

  it('does not change a workout already underway when the setting changes', async () => {
    const store = makeStore()
    await start(store, new Map())

    // The user switches Triceps to bands MID-SESSION. A resume must return the
    // workout they are actually doing, not a retitled one.
    const resumed = unwrap(
      await startWorkout(store, ACCOUNT_A, DATE, 'tuesday', TUESDAY, 9, 'token-2', TRICEPS_BAND),
    )

    expect(resumed.created).toBe(false)
    expect(setAt(resumed, 1).inputType).toBe('weight_kg')
    expect(setAt(resumed, 1).loadMode).toBe('kg')
  })
})

/* ------------------------------------------------------------------ */
/* B. What may be recorded, per modality                               */
/* ------------------------------------------------------------------ */

describe('B. a completed set is validated against its frozen snapshot', () => {
  async function bandStore(): Promise<WorkoutStore> {
    const store = makeStore()
    await start(store, TRICEPS_BAND)
    return store
  }

  /** The band set: exercise order 1. The kilogram set: order 0. */
  const BAND_SET = { order: 1, index: 0 }
  const KG_SET = { order: 0, index: 0 }

  async function put(
    store: WorkoutStore,
    at: { order: number; index: number },
    update: WorkoutSetUpdate,
  ): Promise<SetOutcome> {
    return applySetUpdate(store, ACCOUNT_A, DATE, 'tuesday', at.order, at.index, update, 5)
  }

  it('records a band as a name and a count, with no kilograms anywhere', async () => {
    const store = await bandStore()
    const outcome = await put(
      store,
      BAND_SET,
      complete(12, { band: { label: 'Black', count: 3 } }),
    )

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.record.bandLabel).toBe('Black')
    expect(outcome.record.bandCount).toBe(3)
    expect(outcome.record.loadValue).toBeNull()
    expect(outcome.record.loadUnit).toBeNull()
    expect(outcome.record.result).toBe(12)
  })

  it('refuses kilograms on a band set — and the same payload is fine on the kg set', async () => {
    const store = await bandStore()
    const kilograms = complete(12, { load: { value: 20, unit: 'kg_each' } })

    const refused = await put(store, BAND_SET, kilograms)
    expect(refused).toEqual({ ok: false, reason: 'modality_mismatch' })

    // NON-VACUITY. The identical payload succeeds against a set whose frozen
    // modality genuinely is kilograms, so the refusal above is about the
    // MISMATCH and not about the payload being unacceptable in general.
    const accepted = await put(store, KG_SET, kilograms)
    expect(accepted.ok).toBe(true)
  })

  it('refuses a band on a kilogram set — and the same payload is fine on the band set', async () => {
    const store = await bandStore()
    const band = complete(12, { band: { label: 'Black', count: 3 } })

    const refused = await put(store, KG_SET, band)
    expect(refused).toEqual({ ok: false, reason: 'modality_mismatch' })

    // NON-VACUITY, the other way round.
    const accepted = await put(store, BAND_SET, band)
    expect(accepted.ok).toBe(true)
  })

  it('refuses a set carrying BOTH, whichever modality it was started as', async () => {
    const store = await bandStore()
    const hybrid = complete(12, {
      load: { value: 20, unit: 'kg' },
      band: { label: 'Black', count: 3 },
    })

    expect(await put(store, BAND_SET, hybrid)).toEqual({
      ok: false,
      reason: 'modality_mismatch',
    })
    expect(await put(store, KG_SET, hybrid)).toEqual({
      ok: false,
      reason: 'modality_mismatch',
    })
  })

  it('refuses a completed band set that does not say which band', async () => {
    const store = await bandStore()
    // Real reps, no band named. There is nothing to compare it with later and
    // nothing honest to display, so it is not stored as a blank.
    expect(await put(store, BAND_SET, complete(12))).toEqual({
      ok: false,
      reason: 'band_required',
    })

    // NON-VACUITY: naming the band is the only thing that changed.
    const named = await put(store, BAND_SET, complete(12, { band: { label: 'Black', count: 3 } }))
    expect(named.ok).toBe(true)
  })

  it('clears the band when the set is skipped', async () => {
    const store = await bandStore()
    await put(store, BAND_SET, complete(12, { band: { label: 'Black', count: 3 } }))

    const skipped = await put(store, BAND_SET, { action: 'skip' })
    expect(skipped.ok).toBe(true)
    if (!skipped.ok) return
    // A skipped set records nothing about resistance. It must never read as a
    // completed working set with a band still attached.
    expect(skipped.record.bandLabel).toBeNull()
    expect(skipped.record.bandCount).toBeNull()
    expect(skipped.record.result).toBeNull()
  })
})

/* ------------------------------------------------------------------ */
/* C. Bounds on what a band may be                                     */
/* ------------------------------------------------------------------ */

/**
 * These run against `parseSetUpdate`, which is the boundary the HTTP route
 * actually crosses. It is the same division the load field already has: the
 * parser decides whether a value is WELL-FORMED, and the rules decide whether a
 * well-formed value belongs on this particular set.
 */
describe('C. a band record must be usable, or the request never becomes one', () => {
  const rejected = [
    { $why: 'an unnamed band', band: { label: '   ', count: 3 } },
    { $why: 'a missing label', band: { count: 3 } },
    { $why: 'a missing count', band: { label: 'Black' } },
    { $why: 'a count of zero', band: { label: 'Black', count: 0 } },
    { $why: 'a negative count', band: { label: 'Black', count: -2 } },
    { $why: 'a fractional count', band: { label: 'Black', count: 2.5 } },
    { $why: 'an absurd count', band: { label: 'Black', count: 999 } },
    { $why: 'a count sent as text', band: { label: 'Black', count: '3' } },
    { $why: 'a band that is not an object', band: 'Black x3' },
    { $why: 'an over-long label', band: { label: 'B'.repeat(33), count: 1 } },
  ]

  it.each(rejected)('refuses $$why', ({ band }) => {
    expect(parseSetUpdate({ action: 'complete', result: 12, band })).toEqual({
      ok: false,
      field: 'band',
    })
  })

  it('accepts a well-formed band, so the refusals above are about the VALUE', () => {
    // NON-VACUITY for the whole group.
    expect(
      parseSetUpdate({ action: 'complete', result: 12, band: { label: 'Black', count: 3 } }),
    ).toEqual({
      ok: true,
      value: { action: 'complete', result: 12, load: null, band: { label: 'Black', count: 3 } },
    })
  })

  it('trims the label but keeps its capitalisation, because it is the user’s word', () => {
    const parsed = parseSetUpdate({
      action: 'complete',
      result: 12,
      band: { label: '  Heavy Red  ', count: 2 },
    })
    expect(parsed.ok && parsed.value.action === 'complete' && parsed.value.band).toEqual({
      label: 'Heavy Red',
      count: 2,
    })
  })

  it('reads an absent band as no band at all, not as a malformed one', () => {
    // The ordinary kilogram and bodyweight case: nothing sent, nothing wrong.
    expect(parseSetUpdate({ action: 'complete', result: 12 })).toEqual({
      ok: true,
      value: { action: 'complete', result: 12, load: null, band: null },
    })
  })
})

/* ------------------------------------------------------------------ */
/* D. Legacy rows keep their own meaning                               */
/* ------------------------------------------------------------------ */

describe('D. a row written before Round 20 is read, never rewritten', () => {
  it('reads a stored kilogram row as kilograms', async () => {
    const db = createFakeD1()
    const store = createD1WorkoutStore(db.db)
    await startWorkout(store, ACCOUNT_A, DATE, 'tuesday', TUESDAY, 1, 'token-1')

    // Strip the snapshot from the stored rows, which is exactly the shape a
    // row written before this migration has.
    for (const row of db.workoutSets.values()) row.input_type_snapshot = null

    const log = await readWorkout(store, ACCOUNT_A, DATE, 'tuesday')
    const triceps = log?.sets.find((row) => row.exerciseOrder === 1)
    // 'kg' meant kilograms at the time, and still does.
    expect(triceps?.loadMode).toBe('kg')
    expect(triceps?.inputType).toBe('weight_kg')
  })

  it('reads a stored no-load row as bodyweight', async () => {
    const db = createFakeD1()
    const store = createD1WorkoutStore(db.db)
    await startWorkout(store, ACCOUNT_A, DATE, 'tuesday', TUESDAY, 1, 'token-1')

    for (const row of db.workoutSets.values()) {
      row.input_type_snapshot = null
      row.load_mode_snapshot = 'none'
    }

    const log = await readWorkout(store, ACCOUNT_A, DATE, 'tuesday')
    expect(log?.sets.every((row) => row.inputType === 'bodyweight')).toBe(true)
  })

  it('fails closed on a stored modality it cannot name', async () => {
    const db = createFakeD1()
    const store = createD1WorkoutStore(db.db)
    await startWorkout(store, ACCOUNT_A, DATE, 'tuesday', TUESDAY, 1, 'token-1')

    for (const row of db.workoutSets.values()) row.input_type_snapshot = 'elastic_vibes'

    const log = await readWorkout(store, ACCOUNT_A, DATE, 'tuesday')
    // Null, NOT kilograms. Guessing here is precisely how a band set came to
    // be recorded as a weight in the first place.
    expect(log?.sets.every((row) => row.inputType === null)).toBe(true)

    const outcome = await applySetUpdate(
      store,
      ACCOUNT_A,
      DATE,
      'tuesday',
      0,
      0,
      complete(10, { load: { value: 20, unit: 'kg_each' } }),
      5,
    )
    expect(outcome).toEqual({ ok: false, reason: 'input_type_unreadable' })
  })

  it('accepts that same payload once the modality is readable', async () => {
    // NON-VACUITY for the fail-closed branch above: the ONLY difference is a
    // stored value this build can name.
    const store = makeStore()
    await start(store)

    const outcome = await applySetUpdate(
      store,
      ACCOUNT_A,
      DATE,
      'tuesday',
      0,
      0,
      complete(10, { load: { value: 20, unit: 'kg_each' } }),
      5,
    )
    expect(outcome.ok).toBe(true)
  })
})
