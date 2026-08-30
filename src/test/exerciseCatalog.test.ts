import { describe, expect, it } from 'vitest'

import {
  exerciseCatalog,
  getCatalogExercise,
  usedInSummary,
} from '@/features/training/catalog'
import { trainingSessions } from '@/features/training/sessions'

/**
 * Round 07 — the canonical exercise catalog.
 *
 * ONE EXERCISE IDENTITY = ONE ENTRY. The week trains Lat Pulldown on Monday,
 * Wednesday and Thursday; the library must list it once and say where it is
 * used, and the per-day prescriptions must be left exactly as they are.
 */

describe('one entry per exercise identity', () => {
  it('dedupes repeated exercise ids', () => {
    const ids = exerciseCatalog.map((entry) => entry.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('lat-pulldown appears exactly once', () => {
    const matches = exerciseCatalog.filter((entry) => entry.id === 'lat-pulldown')
    expect(matches).toHaveLength(1)
    expect(matches[0].name).toBe('Lat Pulldown')
  })

  it('covers every exercise the training week contains, and nothing else', () => {
    const fromSessions = new Set(
      trainingSessions.flatMap((session) =>
        session.exercises.map((exercise) => exercise.id),
      ),
    )
    expect(new Set(exerciseCatalog.map((entry) => entry.id))).toEqual(fromSessions)
  })

  it('is deterministic — rebuilding gives the same order', () => {
    expect(exerciseCatalog.map((entry) => entry.id)).toEqual(
      exerciseCatalog.map((entry) => entry.id),
    )
    // First-appearance order: Monday's first exercise leads.
    expect(exerciseCatalog[0].id).toBe('lat-pulldown')
  })

  it('preserves the canonical exercise name', () => {
    for (const entry of exerciseCatalog) {
      const source = trainingSessions
        .flatMap((session) => session.exercises)
        .find((exercise) => exercise.id === entry.id)
      expect(entry.name).toBe(source?.name)
    }
  })
})

describe('Used In', () => {
  it('lat-pulldown is used in Monday, Wednesday and Thursday', () => {
    const entry = getCatalogExercise('lat-pulldown')
    expect(entry?.appearances.map((a) => a.day)).toEqual([
      'Monday',
      'Wednesday',
      'Thursday',
    ])
    expect(usedInSummary(entry!)).toBe('Monday · Wednesday · Thursday')
  })

  it('keeps the session slug alongside the day', () => {
    const entry = getCatalogExercise('lat-pulldown')
    expect(entry?.appearances.map((a) => a.sessionId)).toEqual([
      'monday',
      'wednesday',
      'thursday',
    ])
  })

  it('a single-day exercise lists only that day', () => {
    const entry = getCatalogExercise('dead-bug')
    expect(entry?.appearances.map((a) => a.day)).toEqual(['Wednesday'])
  })

  it('lists no day twice', () => {
    for (const entry of exerciseCatalog) {
      const ids = entry.appearances.map((a) => a.sessionId)
      expect(new Set(ids).size).toBe(ids.length)
    }
  })

  it('returns undefined for an unknown slug', () => {
    expect(getCatalogExercise('not-an-exercise')).toBeUndefined()
    expect(getCatalogExercise(undefined)).toBeUndefined()
  })
})

describe('session prescriptions are untouched', () => {
  it('lat-pulldown keeps a different prescription on each day', () => {
    const prescriptions = trainingSessions
      .filter((session) => session.exercises.some((e) => e.id === 'lat-pulldown'))
      .map((session) => ({
        day: session.day,
        sets: session.exercises.find((e) => e.id === 'lat-pulldown')?.sets,
        equipment: session.exercises.find((e) => e.id === 'lat-pulldown')?.equipment,
      }))

    expect(prescriptions).toEqual([
      { day: 'Monday', sets: '4 × 10–15', equipment: 'BAND 20kg' },
      { day: 'Wednesday', sets: '2 × 15–20', equipment: undefined },
      { day: 'Thursday', sets: '4 × 10–15', equipment: undefined },
    ])
  })

  it('a catalog entry carries no prescription at all', () => {
    const entry = getCatalogExercise('lat-pulldown')!
    expect(Object.keys(entry).sort()).toEqual(['appearances', 'id', 'name'])
  })
})
