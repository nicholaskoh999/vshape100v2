import { describe, expect, it } from 'vitest'

import {
  derivePerformance,
  readSet,
  variantKey,
  type CompletedSetRow,
  type EligibleSet,
} from '../progress/performance'

/**
 * Round 20 — what Progress is allowed to compare with what.
 *
 * TWO CLAIMS THIS APP MUST NEVER MAKE.
 *
 *   1. that a band set and a kilogram set of the same exercise are points on
 *      one series. They are different measurement systems, there is no
 *      conversion between them, and a "best" spanning both is not a fact about
 *      anything. The user's Triceps history is exactly this shape: legacy rows
 *      recorded as kilograms, new rows recorded as bands.
 *
 *   2. that one band colour is stronger than another. Band colours are
 *      manufacturer-specific and the app has no basis for ranking them. Black
 *      x3 and Red x3 are simply different setups.
 *
 * Both are enforced STRUCTURALLY, by the variant key, rather than by a rule
 * someone has to remember to apply: incompatible sets land in different
 * buckets, so a comparison between them cannot even be expressed. These tests
 * check the buckets AND check that the separation is doing work — a suite where
 * everything landed in its own bucket would prove nothing, so each separation
 * is paired with a control that shows compatible sets DO group together.
 */

const BASE_ROW: CompletedSetRow = {
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
  inputTypeSnapshot: 'weight_kg',
  bandLabel: null,
  bandCount: null,
}

/** The legacy row: three black bands, recorded as "3 kg" because it had to be. */
function legacyKilogramRow(over: Partial<CompletedSetRow> = {}): CompletedSetRow {
  return { ...BASE_ROW, inputTypeSnapshot: null, ...over }
}

/** A Round 20 band row: no kilograms anywhere, a named band and a count. */
function bandRow(over: Partial<CompletedSetRow> = {}): CompletedSetRow {
  return {
    ...BASE_ROW,
    loadMode: 'none',
    loadValue: null,
    loadUnit: null,
    inputTypeSnapshot: 'resistance_band',
    bandLabel: 'Black',
    bandCount: 3,
    workoutDate: '2026-09-08',
    startedAt: 200,
    ...over,
  }
}

function eligible(row: CompletedSetRow): EligibleSet {
  const read = readSet(row)
  if (read.status !== 'eligible') {
    throw new Error(`expected an eligible set, got ${read.status}`)
  }
  return read.set
}

/* ------------------------------------------------------------------ */
/* E. Kilograms and bands never meet                                   */
/* ------------------------------------------------------------------ */

describe('E. a band set and a kilogram set are never one series', () => {
  it('puts the legacy kilogram rows and the new band rows in different variants', () => {
    const variants = derivePerformance([
      eligible(legacyKilogramRow()),
      eligible(bandRow()),
    ])

    expect(variants).toHaveLength(2)
    expect(variants.map((variant) => variant.inputType).sort()).toEqual([
      'resistance_band',
      'weight_kg',
    ])
    // Each keeps its own best. Neither borrows the other's.
    const band = variants.find((variant) => variant.inputType === 'resistance_band')
    const kilograms = variants.find((variant) => variant.inputType === 'weight_kg')
    expect(band?.band).toEqual({ label: 'Black', count: 3 })
    expect(band?.personalBest?.loadValue).toBeNull()
    expect(kilograms?.band).toBeNull()
    expect(kilograms?.personalBest?.loadValue).toBe(3)
  })

  it('groups two kilogram sets of that same exercise together', () => {
    // NON-VACUITY. Everything except the modality is held constant, so the
    // separation above is caused by the modality and not by the fixtures
    // simply differing in some other way.
    const variants = derivePerformance([
      eligible(legacyKilogramRow()),
      eligible(legacyKilogramRow({ workoutDate: '2026-09-08', startedAt: 200, loadValue: 5 })),
    ])

    expect(variants).toHaveLength(1)
    expect(variants[0].points).toHaveLength(2)
  })

  it('groups two band sets of that same exercise together', () => {
    // NON-VACUITY, the other side.
    const variants = derivePerformance([
      eligible(bandRow()),
      eligible(bandRow({ workoutDate: '2026-09-15', startedAt: 300, result: 15 })),
    ])

    expect(variants).toHaveLength(1)
    expect(variants[0].points).toHaveLength(2)
  })

  it('never lets a kilogram number out of a band variant', () => {
    const [variant] = derivePerformance([eligible(bandRow())])
    expect(variant.loadMode).toBe('none')
    expect(variant.points.every((point) => point.loadValue === null)).toBe(true)
    expect(variant.personalBest?.loadValue).toBeNull()
  })
})

/* ------------------------------------------------------------------ */
/* F. Band colours are never ranked                                    */
/* ------------------------------------------------------------------ */

describe('F. one band setup is never compared with another', () => {
  it('separates two colours, so neither can be called the stronger', () => {
    const variants = derivePerformance([
      eligible(bandRow({ bandLabel: 'Black', bandCount: 3 })),
      eligible(bandRow({ bandLabel: 'Red', workoutDate: '2026-09-15', startedAt: 300 })),
    ])

    expect(variants).toHaveLength(2)
    expect(variants.map((variant) => variant.band?.label).sort()).toEqual(['Black', 'Red'])
  })

  it('separates two counts of the SAME colour', () => {
    // Two bands is not "twice" one band in any sense this app can defend, so
    // the count is part of the setup rather than a quantity to compare.
    const variants = derivePerformance([
      eligible(bandRow({ bandCount: 2 })),
      eligible(bandRow({ bandCount: 3, workoutDate: '2026-09-15', startedAt: 300 })),
    ])

    expect(variants).toHaveLength(2)
    expect(variants.map((variant) => variant.band?.count).sort()).toEqual([2, 3])
  })

  it('treats the same band written differently as the same setup', () => {
    // Case and stray spaces are noise, not a different band. This is the ONLY
    // relation defined between two labels — there is no ordering.
    const variants = derivePerformance([
      eligible(bandRow({ bandLabel: 'Black' })),
      eligible(bandRow({ bandLabel: '  black ', workoutDate: '2026-09-15', startedAt: 300 })),
    ])

    expect(variants).toHaveLength(1)
    expect(variants[0].points).toHaveLength(2)
  })

  it('ranks within ONE setup by reps alone, which is the only honest axis', () => {
    const [variant] = derivePerformance([
      eligible(bandRow({ result: 12 })),
      eligible(bandRow({ result: 15, workoutDate: '2026-09-15', startedAt: 300 })),
      eligible(bandRow({ result: 10, workoutDate: '2026-09-22', startedAt: 400 })),
    ])

    expect(variant.personalBest?.result).toBe(15)
    expect(variant.personalBest?.date).toBe('2026-09-15')
  })
})

/* ------------------------------------------------------------------ */
/* G. Reading a stored row                                             */
/* ------------------------------------------------------------------ */

describe('G. a row is read as what it says it is, or not at all', () => {
  it('reads a pre-Round-20 kilogram row as kilograms', () => {
    const read = readSet(legacyKilogramRow())
    expect(read.status).toBe('eligible')
    if (read.status !== 'eligible') return
    expect(read.set.inputType).toBe('weight_kg')
    expect(read.set.band).toBeNull()
  })

  it('reads a pre-Round-20 no-load row as bodyweight', () => {
    const read = readSet(
      legacyKilogramRow({ loadMode: 'none', loadValue: null, loadUnit: null }),
    )
    expect(read.status).toBe('eligible')
    if (read.status !== 'eligible') return
    expect(read.set.inputType).toBe('bodyweight')
  })

  it('refuses a modality it cannot name rather than assuming kilograms', () => {
    expect(readSet(legacyKilogramRow({ inputTypeSnapshot: 'elastic_vibes' }))).toEqual({
      status: 'unreadable',
    })
  })

  it('refuses a band row that also carries kilograms', () => {
    // A row contradicting itself: neither half can be trusted, so neither is
    // shown. This is the shape a partial migration or a rogue write would make.
    expect(readSet(bandRow({ loadValue: 3, loadUnit: 'kg' }))).toEqual({
      status: 'unreadable',
    })
  })

  it('refuses a kilogram row that carries a band', () => {
    expect(readSet(legacyKilogramRow({ bandLabel: 'Black', bandCount: 3 }))).toEqual({
      status: 'unreadable',
    })
  })

  it('refuses half a band record', () => {
    expect(readSet(bandRow({ bandCount: null }))).toEqual({ status: 'unreadable' })
    expect(readSet(bandRow({ bandLabel: null }))).toEqual({ status: 'unreadable' })
  })

  it('keeps a band set with no band as real history that simply cannot rank', () => {
    // Non-comparable, NOT unreadable: something was genuinely performed, it
    // just has no setup to file it under.
    expect(readSet(bandRow({ bandLabel: null, bandCount: null }))).toEqual({
      status: 'non-comparable',
    })
  })
})

/* ------------------------------------------------------------------ */
/* H. The key itself                                                   */
/* ------------------------------------------------------------------ */

describe('H. the variant key carries the modality', () => {
  const kilograms = {
    exerciseId: 'triceps-pushdown',
    resultKind: 'reps' as const,
    loadMode: 'kg' as const,
    perSide: false,
    inputType: 'weight_kg' as const,
    band: null,
  }
  const band = {
    ...kilograms,
    loadMode: 'none' as const,
    inputType: 'resistance_band' as const,
    band: { label: 'Black', count: 3 },
  }

  it('gives kilograms and bands different keys', () => {
    expect(variantKey(kilograms)).not.toBe(variantKey(band))
  })

  it('gives two band setups different keys', () => {
    expect(variantKey(band)).not.toBe(
      variantKey({ ...band, band: { label: 'Red', count: 3 } }),
    )
    expect(variantKey(band)).not.toBe(
      variantKey({ ...band, band: { label: 'Black', count: 2 } }),
    )
  })

  it('gives the same setup the same key however the label was typed', () => {
    expect(variantKey(band)).toBe(
      variantKey({ ...band, band: { label: '  BLACK  ', count: 3 } }),
    )
  })

  it('is stable for an identical variant, so grouping is not accidental', () => {
    // NON-VACUITY for this group: a key function that returned something
    // unique every call would satisfy every "different" assertion above.
    expect(variantKey(kilograms)).toBe(variantKey({ ...kilograms }))
    expect(variantKey(band)).toBe(variantKey({ ...band, band: { ...band.band } }))
  })
})
