import { describe, expect, it } from 'vitest'

import { trainingSessions } from '@/features/training/sessions'
import {
  buildWorkoutPlan,
  localWorkoutDate,
  parsePrescription,
  resolveLoadMode,
  toStartPayload,
} from '@/features/training/workoutPlan'

/**
 * Round 08 — deriving loggable structure from accepted prescription text.
 *
 * Nothing here is a progression engine: no test asserts a suggested load or a
 * judgement of a result against its target.
 */

describe('parsePrescription', () => {
  it('reads a plain rep range', () => {
    expect(parsePrescription('4 × 10–15')).toEqual({
      setCount: 4,
      resultKind: 'reps',
      perSide: false,
      target: '10–15',
    })
  })

  it('reads a per-side rep prescription', () => {
    expect(parsePrescription('3 × 10 / side')).toEqual({
      setCount: 3,
      resultKind: 'reps',
      perSide: true,
      target: '10',
    })
  })

  it('reads a seconds hold', () => {
    expect(parsePrescription('3 × 30–60s')).toEqual({
      setCount: 3,
      resultKind: 'seconds',
      perSide: false,
      target: '30–60',
    })
  })

  it('reads a single-number target', () => {
    expect(parsePrescription('2 × 12')).toEqual({
      setCount: 2,
      resultKind: 'reps',
      perSide: false,
      target: '12',
    })
  })

  it('accepts a plain hyphen as well as an en dash', () => {
    expect(parsePrescription('3 × 8-12')?.target).toBe('8-12')
  })

  it('tolerates surrounding whitespace', () => {
    expect(parsePrescription('  4 × 10–15  ')?.setCount).toBe(4)
  })

  it.each([
    ['an empty string', ''],
    ['prose', 'as many as you can'],
    ['a missing set count', '× 10–15'],
    ['a missing target', '4 × '],
    ['a non-numeric target', '4 × many'],
    ['an ASCII x instead of ×', '4 x 10–15'],
    ['zero sets', '0 × 10'],
    ['an absurd set count', '900 × 10'],
    ['a null value', null],
    ['an undefined value', undefined],
  ])('fails honestly on %s rather than fabricating a plan', (_label, input) => {
    expect(parsePrescription(input as string | null | undefined)).toBeNull()
  })
})

/* ------------------------------------------------------------------ */
/* Every accepted Foundation prescription                              */
/* ------------------------------------------------------------------ */

describe('the accepted Foundation week', () => {
  it('parses every prescription in every session', () => {
    for (const session of trainingSessions) {
      for (const exercise of session.exercises) {
        const plan = parsePrescription(exercise.sets)
        expect(
          plan,
          `${session.id} / ${exercise.id} (${exercise.sets}) did not parse`,
        ).not.toBeNull()
        expect(plan!.setCount).toBeGreaterThan(0)
      }
    }
  })

  it('builds a plan for every session', () => {
    for (const session of trainingSessions) {
      const plan = buildWorkoutPlan(session)
      expect(plan, `${session.id} has no plan`).not.toBeNull()
      expect(plan).toHaveLength(session.exercises.length)
    }
  })

  it('derives the accepted set counts for Monday', () => {
    const plan = buildWorkoutPlan(trainingSessions[0])!
    expect(plan.map((exercise) => exercise.setCount)).toEqual([4, 3, 3, 3, 2])
  })

  it('reads Wednesday’s core work as seconds and per side', () => {
    const wednesday = trainingSessions.find((session) => session.id === 'wednesday')!
    const plan = buildWorkoutPlan(wednesday)!

    const deadBug = plan.find((exercise) => exercise.exerciseId === 'dead-bug')!
    expect(deadBug.resultKind).toBe('reps')
    expect(deadBug.perSide).toBe(true)
    expect(deadBug.setCount).toBe(3)

    const plank = plan.find((exercise) => exercise.exerciseId === 'plank')!
    expect(plank.resultKind).toBe('seconds')
    expect(plank.perSide).toBe(false)
    expect(plank.setCount).toBe(3)
  })

  it('keeps the same exercise’s prescription per session, not canonical', () => {
    const monday = buildWorkoutPlan(trainingSessions.find((s) => s.id === 'monday')!)!
    const wednesday = buildWorkoutPlan(trainingSessions.find((s) => s.id === 'wednesday')!)!

    const mondayLat = monday.find((e) => e.exerciseId === 'lat-pulldown')!
    const wednesdayLat = wednesday.find((e) => e.exerciseId === 'lat-pulldown')!

    expect(mondayLat.prescription).toBe('4 × 10–15')
    expect(wednesdayLat.prescription).toBe('2 × 15–20')
    expect(mondayLat.setCount).toBe(4)
    expect(wednesdayLat.setCount).toBe(2)
  })
})

/* ------------------------------------------------------------------ */
/* Load semantics                                                      */
/* ------------------------------------------------------------------ */

describe('resolveLoadMode', () => {
  it('treats dumbbell work as kg each, never a combined weight', () => {
    for (const id of [
      'one-arm-db-row',
      'hammer-curl',
      'incline-db-press',
      'flat-db-press',
      'chest-supported-db-row',
      'preacher-curl',
    ]) {
      expect(resolveLoadMode(id), id).toBe('kg_each')
    }
  })

  it('treats band work as plain kg', () => {
    for (const id of ['lat-pulldown', 'face-pull', 'seated-band-row']) {
      expect(resolveLoadMode(id), id).toBe('kg')
    }
  })

  it('asks for no load on bodyweight core work', () => {
    expect(resolveLoadMode('plank')).toBe('none')
    expect(resolveLoadMode('dead-bug')).toBe('none')
  })

  it('is canonical: one exercise has one load meaning on every day', () => {
    // Monday lists Preacher Curl with "DB + Bench Preacher setup"; Thursday and
    // Friday list no equipment. It is still the same movement.
    const days = ['monday', 'thursday', 'friday']
    const modes = days.map((day) => {
      const session = trainingSessions.find((s) => s.id === day)!
      return buildWorkoutPlan(session)!.find((e) => e.exerciseId === 'preacher-curl')
        ?.loadMode
    })
    expect(modes).toEqual(['kg_each', 'kg_each', 'kg_each'])
  })

  it('falls back to plain kg where the accepted data names no equipment', () => {
    // Not a claim about the equipment — just an honest number without the
    // "each" semantic that only dumbbells carry.
    for (const id of [
      'seated-shoulder-press',
      'lateral-raise',
      'triceps-pushdown',
      'rear-delt-fly',
    ]) {
      expect(resolveLoadMode(id), id).toBe('kg')
    }
  })

  it('does not claim a load mode for an exercise outside the week', () => {
    expect(resolveLoadMode('not-an-exercise')).toBe('kg')
  })
})

/* ------------------------------------------------------------------ */
/* Start payload                                                       */
/* ------------------------------------------------------------------ */

describe('toStartPayload', () => {
  it('carries the session header and every exercise in order', () => {
    const monday = trainingSessions.find((session) => session.id === 'monday')!
    const payload = toStartPayload(monday, buildWorkoutPlan(monday)!)

    expect(payload.day).toBe('Monday')
    expect(payload.focus).toBe('Back Width + Biceps')
    expect(payload.intensity).toBe('HARD')
    expect(payload.exercises.map((exercise) => exercise.exerciseId)).toEqual([
      'lat-pulldown',
      'one-arm-db-row',
      'face-pull',
      'preacher-curl',
      'hammer-curl',
    ])
  })

  it('sends the prescription text but not the derived display target', () => {
    const monday = trainingSessions.find((session) => session.id === 'monday')!
    const payload = toStartPayload(monday, buildWorkoutPlan(monday)!)

    expect(payload.exercises[0].prescription).toBe('4 × 10–15')
    expect(payload.exercises[0]).not.toHaveProperty('target')
  })

  it('sends a null equipment rather than inventing one', () => {
    const thursday = trainingSessions.find((session) => session.id === 'thursday')!
    const payload = toStartPayload(thursday, buildWorkoutPlan(thursday)!)
    expect(payload.exercises[0].equipment).toBeNull()
  })
})

/* ------------------------------------------------------------------ */
/* Workout date                                                        */
/* ------------------------------------------------------------------ */

describe('localWorkoutDate', () => {
  it('uses the local calendar date, not the UTC one', () => {
    // Just after local midnight. East of UTC the ISO date is the previous day,
    // so a UTC-derived date would file this workout under yesterday.
    expect(localWorkoutDate(new Date(2026, 0, 1, 0, 30))).toBe('2026-01-01')
  })

  it('does not roll a late-evening workout into tomorrow', () => {
    // Late local evening. West of UTC the ISO date is already the next day.
    expect(localWorkoutDate(new Date(2026, 11, 31, 23, 45))).toBe('2026-12-31')
  })

  it('pads month and day', () => {
    expect(localWorkoutDate(new Date(2026, 8, 5, 12, 0))).toBe('2026-09-05')
  })

  it('matches the device calendar for an arbitrary moment', () => {
    const now = new Date(2026, 6, 14, 17, 26)
    expect(localWorkoutDate(now)).toBe(
      `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
        now.getDate(),
      ).padStart(2, '0')}`,
    )
  })
})
