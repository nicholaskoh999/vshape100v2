import { describe, expect, it } from 'vitest'

import {
  formatLoad,
  formatPerformance,
  labelVariants,
  valueHeading,
  variantDescriptor,
  variantQualifier,
  type VariantKind,
} from '@/features/progress/formatPerformance'
import type { PerformancePoint } from '@/features/progress/progressApi'

/**
 * Round 20 — how a recorded performance is written down.
 *
 * THE SENTENCE THIS ROUND EXISTS TO FIX.
 *
 * `formatLoad` used to append " kg" to whatever number it was handed, because
 * kilograms were the only resistance the app could store. A Triceps Pushdown
 * performed with three black bands had that 3 in its weight column, and this
 * function faithfully turned it into "3 kg × 12 reps" — a statement about the
 * user's training that was simply false.
 *
 * Two rules are defended here:
 *
 *   - the unit comes from the variant's own modality, so no kilogram label can
 *     be attached to something that was not kilograms
 *   - a band is NAMED and COUNTED, never scored: no kilogram equivalent is
 *     shown, offered or implied, and no band is described as heavier than
 *     another
 */

const KILOGRAMS: VariantKind = {
  resultKind: 'reps',
  loadMode: 'kg',
  perSide: false,
  inputType: 'weight_kg',
  band: null,
}

const PER_DUMBBELL: VariantKind = { ...KILOGRAMS, loadMode: 'kg_each' }

const BAND: VariantKind = {
  resultKind: 'reps',
  loadMode: 'none',
  perSide: false,
  inputType: 'resistance_band',
  band: { label: 'Black', count: 3 },
}

const BODYWEIGHT: VariantKind = {
  resultKind: 'reps',
  loadMode: 'none',
  perSide: false,
  inputType: 'bodyweight',
  band: null,
}

function point(over: Partial<PerformancePoint> = {}): PerformancePoint {
  return { date: '2026-09-08', sessionId: 'tuesday', loadValue: null, result: 12, ...over }
}

describe('writing down the resistance', () => {
  it('writes kilograms as kilograms', () => {
    expect(formatLoad(50, KILOGRAMS)).toBe('50 kg')
    expect(formatLoad(47.5, KILOGRAMS)).toBe('47.5 kg')
  })

  it('keeps per-dumbbell per dumbbell, never doubled into a total', () => {
    expect(formatLoad(20, PER_DUMBBELL)).toBe('20 kg each')
  })

  it('writes a band as its name and how many, with no unit at all', () => {
    const written = formatLoad(null, BAND)
    expect(written).toBe('Black ×3')
    expect(written).not.toMatch(/kg/i)
  })

  it('reproduces the band label as the user typed it', () => {
    // It is their word for their equipment. The app has no better one.
    expect(formatLoad(null, { ...BAND, band: { label: 'heavy RED', count: 1 } })).toBe(
      'heavy RED ×1',
    )
  })

  it('writes nothing for work with no external resistance', () => {
    expect(formatLoad(null, BODYWEIGHT)).toBeNull()
  })

  it('IGNORES a stray load value on a band variant rather than printing it', () => {
    // This is the exact shape of the bug: a number sitting in the weight
    // column of something that was not weighed. It never reaches the page.
    const written = formatLoad(3, BAND)
    expect(written).toBe('Black ×3')
    expect(written).not.toContain('3 kg')
  })

  it('IGNORES a stray load value on bodyweight work too', () => {
    expect(formatLoad(3, BODYWEIGHT)).toBeNull()
  })
})

describe('writing down the whole performance', () => {
  it('reads as a weight times a result for kilogram work', () => {
    expect(formatPerformance(point({ loadValue: 50, result: 8 }), KILOGRAMS)).toBe(
      '50 kg × 8 reps',
    )
  })

  it('reads as a band and a result for band work — the line that was wrong', () => {
    // Previously: "3 kg × 12 reps".
    expect(formatPerformance(point({ result: 12 }), BAND)).toBe('Black ×3 · 12 reps')
  })

  it('reads as the result alone for bodyweight work', () => {
    expect(formatPerformance(point({ result: 12 }), BODYWEIGHT)).toBe('12 reps')
  })

  it('keeps per-side visible on band work', () => {
    expect(formatPerformance(point({ result: 10 }), { ...BAND, perSide: true })).toBe(
      'Black ×3 · 10 reps / side',
    )
  })

  it('writes a timed band hold in seconds', () => {
    expect(
      formatPerformance(point({ result: 45 }), { ...BAND, resultKind: 'seconds' }),
    ).toBe('Black ×3 · 45s')
  })
})

describe('naming a variant', () => {
  it('names the band setup, so two setups never read as one choice', () => {
    expect(variantQualifier(BAND)).toBe('Black ×3')
    expect(variantQualifier({ ...BAND, band: { label: 'Red', count: 1 } })).toBe('Red ×1')
  })

  it('spells the band setup out in a full descriptor', () => {
    expect(variantDescriptor(BAND)).toBe('Black ×3 · reps')
    expect(variantDescriptor(KILOGRAMS)).toBe('kg · reps')
    expect(variantDescriptor(BODYWEIGHT)).toBe('no load · reps')
  })

  it('labels every variant fully when one exercise has more than one', () => {
    // The user's Triceps history is exactly this: legacy kilograms and new
    // band work under one exercise. Neither may read as the plain default.
    const labels = labelVariants([
      { ...KILOGRAMS, key: 'kg', exerciseId: 'triceps-pushdown' },
      { ...BAND, key: 'band', exerciseId: 'triceps-pushdown' },
    ])

    expect(labels.get('kg')).toBe('kg · reps')
    expect(labels.get('band')).toBe('Black ×3 · reps')
  })

  it('heads a band column with what it actually holds', () => {
    // "Best set" would imply a load axis this variant does not have.
    expect(valueHeading(BAND)).toBe('Reps')
    expect(valueHeading(KILOGRAMS)).toBe('Best set')
    expect(valueHeading({ ...BAND, resultKind: 'seconds' })).toBe('Hold')
  })
})
