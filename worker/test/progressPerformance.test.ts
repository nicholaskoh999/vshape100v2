import { describe, expect, it, vi } from 'vitest'

import {
  HISTORY_CHUNK,
  readPerformance,
  type ProgressHistoryStore,
} from '../progress/history'
import {
  derivePerformance,
  isBetter,
  readSet,
  variantKey,
  type CompletedSetRow,
  type EligibleSet,
} from '../progress/performance'

/**
 * Round 15 — Personal Bests and exercise performance, derived.
 *
 * These run against the pure derivation rather than through a simulated SQL
 * engine, deliberately: a fake database that re-implemented the ranking would
 * be testing my simulation of the rules, not the rules. The SQL that feeds
 * these functions is exercised separately, through the real route.
 *
 * The rule that most needs defending is the lexicographic one. A "best set"
 * that lets 45 kg × 15 outrank 50 kg × 6 is not reporting a fact about load at
 * all — it is quietly applying an estimated 1RM, which Round 15 does not have
 * and Round 16 is where any such judgement belongs.
 */

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

function set(over: Partial<EligibleSet> = {}): EligibleSet {
  return {
    exerciseId: 'lat-pulldown',
    exerciseName: 'Lat Pulldown',
    resultKind: 'reps',
    loadMode: 'kg',
    perSide: false,
    loadValue: 50,
    result: 10,
    workoutDate: '2026-09-07',
    sessionId: 'monday',
    ...over,
  }
}

function row(over: Partial<CompletedSetRow> = {}): CompletedSetRow {
  return {
    exerciseId: 'lat-pulldown',
    exerciseName: 'Lat Pulldown',
    resultKind: 'reps',
    loadMode: 'kg',
    perSide: 0,
    loadValue: 50,
    loadUnit: 'kg',
    result: 10,
    workoutDate: '2026-09-07',
    sessionId: 'monday',
    ...over,
  }
}

/* ------------------------------------------------------------------ */
/* 1. Reading a stored row                                             */
/* ------------------------------------------------------------------ */

describe('1. a row is read or it is refused', () => {
  it('reads a well-formed loaded set', () => {
    expect(readSet(row())).toMatchObject({ loadMode: 'kg', loadValue: 50, result: 10 })
  })

  it('reads per-side as a boolean', () => {
    expect(readSet(row({ perSide: 1 }))?.perSide).toBe(true)
    expect(readSet(row({ perSide: 0 }))?.perSide).toBe(false)
  })

  it('refuses an unknown result kind rather than defaulting it', () => {
    // Guessing 'reps' here would file a set into a variant it may not belong
    // to, and that is exactly how a PB gets manufactured.
    expect(readSet(row({ resultKind: 'distance' }))).toBeNull()
    expect(readSet(row({ resultKind: '' }))).toBeNull()
  })

  it('refuses an unknown load mode rather than defaulting it', () => {
    expect(readSet(row({ loadMode: 'lb' }))).toBeNull()
    expect(readSet(row({ loadMode: 'pood' }))).toBeNull()
  })

  it('refuses a load whose unit disagrees with its variant', () => {
    // 10 recorded as kg_each is twice the metal of 10 recorded as kg. A row
    // that disagrees with itself cannot be compared with either.
    expect(readSet(row({ loadMode: 'kg', loadUnit: 'kg_each' }))).toBeNull()
    expect(readSet(row({ loadMode: 'kg_each', loadUnit: 'kg' }))).toBeNull()
  })

  it('refuses a load recorded against an unloaded exercise', () => {
    expect(readSet(row({ loadMode: 'none', loadValue: 20, loadUnit: 'kg' }))).toBeNull()
  })

  it('reads an unloaded set', () => {
    expect(readSet(row({ loadMode: 'none', loadValue: null, loadUnit: null }))).toMatchObject({
      loadMode: 'none',
      loadValue: null,
    })
  })

  it('reads a loaded set that recorded no load', () => {
    // A real state: the reps were logged and the weight was not. It has no
    // load fact, but it is not corrupt.
    expect(readSet(row({ loadValue: null, loadUnit: null }))).toMatchObject({ loadValue: null })
  })

  it('refuses a set with no positive result', () => {
    for (const result of [0, -5, NaN]) {
      expect(readSet(row({ result })), String(result)).toBeNull()
    }
  })

  it('refuses a row with no exercise identity', () => {
    expect(readSet(row({ exerciseId: '' }))).toBeNull()
  })
})

/* ------------------------------------------------------------------ */
/* 2. Comparable variants                                              */
/* ------------------------------------------------------------------ */

describe('2. only like competes with like', () => {
  it('separates kg from kg_each', () => {
    expect(variantKey(set({ loadMode: 'kg' }))).not.toBe(variantKey(set({ loadMode: 'kg_each' })))
  })

  it('separates per-side from both-sides', () => {
    expect(variantKey(set({ perSide: true }))).not.toBe(variantKey(set({ perSide: false })))
  })

  it('separates reps from seconds', () => {
    expect(variantKey(set({ resultKind: 'reps' }))).not.toBe(
      variantKey(set({ resultKind: 'seconds' })),
    )
  })

  it('separates different exercises', () => {
    expect(variantKey(set({ exerciseId: 'a' }))).not.toBe(variantKey(set({ exerciseId: 'b' })))
  })

  it('groups by canonical id, not by display name', () => {
    // A renamed exercise is still the same exercise, and its history must not
    // split in two when the name changes.
    expect(variantKey(set({ exerciseName: 'Lat Pulldown' }))).toBe(
      variantKey(set({ exerciseName: 'Lat Pull-Down (Wide)' })),
    )
  })
})

/* ------------------------------------------------------------------ */
/* 3. Ranking                                                          */
/* ------------------------------------------------------------------ */

describe('3. loaded reps rank lexicographically', () => {
  const kind = { resultKind: 'reps', loadMode: 'kg' } as const

  it('a heavier load wins even with far fewer reps', () => {
    // The rule the whole section exists for.
    expect(isBetter({ loadValue: 50, result: 6 }, { loadValue: 45, result: 15 }, kind)).toBe(true)
    expect(isBetter({ loadValue: 45, result: 15 }, { loadValue: 50, result: 6 }, kind)).toBe(false)
  })

  it('reps break a tie on load', () => {
    expect(isBetter({ loadValue: 50, result: 8 }, { loadValue: 50, result: 6 }, kind)).toBe(true)
    expect(isBetter({ loadValue: 50, result: 6 }, { loadValue: 50, result: 8 }, kind)).toBe(false)
  })

  it('an identical performance is not better', () => {
    // Strictness is what stops a repeat from being recorded as a new PB.
    expect(isBetter({ loadValue: 50, result: 8 }, { loadValue: 50, result: 8 }, kind)).toBe(false)
  })

  it('handles fractional loads', () => {
    expect(isBetter({ loadValue: 47.5, result: 8 }, { loadValue: 45, result: 12 }, kind)).toBe(true)
    expect(isBetter({ loadValue: 47.5, result: 8 }, { loadValue: 50, result: 8 }, kind)).toBe(false)
  })

  it('never lets a set with no recorded load outrank one that has a load', () => {
    expect(isBetter({ loadValue: null, result: 30 }, { loadValue: 20, result: 5 }, kind)).toBe(false)
    expect(isBetter({ loadValue: 20, result: 5 }, { loadValue: null, result: 30 }, kind)).toBe(true)
  })

  it('falls back to reps when neither set recorded a load', () => {
    expect(isBetter({ loadValue: null, result: 12 }, { loadValue: null, result: 10 }, kind)).toBe(
      true,
    )
  })
})

describe('3b. unloaded and timed rank on one axis', () => {
  it('unloaded reps rank on reps alone', () => {
    const kind = { resultKind: 'reps', loadMode: 'none' } as const
    expect(isBetter({ loadValue: null, result: 15 }, { loadValue: null, result: 12 }, kind)).toBe(
      true,
    )
  })

  it('timed ranks on the longest hold', () => {
    const kind = { resultKind: 'seconds', loadMode: 'none' } as const
    expect(isBetter({ loadValue: null, result: 75 }, { loadValue: null, result: 60 }, kind)).toBe(
      true,
    )
  })

  it('a load never influences a timed ranking', () => {
    // Trading seconds against kilograms would be inventing a strength score.
    const kind = { resultKind: 'seconds', loadMode: 'kg' } as const
    expect(isBetter({ loadValue: 20, result: 40 }, { loadValue: 5, result: 60 }, kind)).toBe(false)
    expect(isBetter({ loadValue: 5, result: 60 }, { loadValue: 20, result: 40 }, kind)).toBe(true)
  })
})

/* ------------------------------------------------------------------ */
/* 4. One point per workout occurrence                                 */
/* ------------------------------------------------------------------ */

describe('4. one point per workout', () => {
  it('picks the heaviest set of the occurrence', () => {
    const [variant] = derivePerformance([
      set({ loadValue: 45, result: 12 }),
      set({ loadValue: 50, result: 8 }),
      set({ loadValue: 47.5, result: 10 }),
    ])

    expect(variant.points).toHaveLength(1)
    expect(variant.points[0]).toMatchObject({ loadValue: 50, result: 8 })
  })

  it('breaks a tie on load with the higher reps', () => {
    const [variant] = derivePerformance([
      set({ loadValue: 50, result: 6 }),
      set({ loadValue: 50, result: 9 }),
    ])
    expect(variant.points[0]).toMatchObject({ loadValue: 50, result: 9 })
  })

  it('picks the highest reps for an unloaded exercise', () => {
    const unloaded = (result: number) =>
      set({ exerciseId: 'push-up', loadMode: 'none', loadValue: null, result })

    const [variant] = derivePerformance([unloaded(12), unloaded(20), unloaded(15)])
    expect(variant.points[0].result).toBe(20)
  })

  it('picks the longest hold for a timed exercise', () => {
    const timed = (result: number) =>
      set({ exerciseId: 'plank', resultKind: 'seconds', loadMode: 'none', loadValue: null, result })

    const [variant] = derivePerformance([timed(45), timed(75), timed(60)])
    expect(variant.points[0].result).toBe(75)
  })

  it('collapses an exercise repeated at two positions in one workout', () => {
    // Two positions in one session is still ONE workout, so it contributes one
    // point derived from all of its eligible sets.
    const [variant] = derivePerformance([
      set({ loadValue: 45, result: 12 }),
      set({ loadValue: 52.5, result: 6 }),
    ])
    expect(variant.points).toHaveLength(1)
    expect(variant.points[0].loadValue).toBe(52.5)
  })

  it('keeps two sessions on the same date as separate occurrences', () => {
    const variants = derivePerformance([
      set({ workoutDate: '2026-09-07', sessionId: 'monday', loadValue: 50 }),
      set({ workoutDate: '2026-09-07', sessionId: 'wednesday', loadValue: 45 }),
    ])

    expect(variants[0].points).toHaveLength(2)
  })

  it('orders points oldest first', () => {
    const variants = derivePerformance([
      set({ workoutDate: '2026-09-24', loadValue: 50 }),
      set({ workoutDate: '2026-09-03', loadValue: 45 }),
      set({ workoutDate: '2026-09-17', loadValue: 47.5 }),
      set({ workoutDate: '2026-09-10', loadValue: 47.5, result: 8 }),
    ])

    expect(variants[0].points.map((point) => point.date)).toEqual([
      '2026-09-03',
      '2026-09-10',
      '2026-09-17',
      '2026-09-24',
    ])
  })

  it('never invents a point for a workout that did not happen', () => {
    const variants = derivePerformance([
      set({ workoutDate: '2026-09-03' }),
      set({ workoutDate: '2026-09-24' }),
    ])
    // Three weeks apart, two points. Nothing was interpolated between them.
    expect(variants[0].points).toHaveLength(2)
  })
})

/* ------------------------------------------------------------------ */
/* 5. Personal Bests                                                   */
/* ------------------------------------------------------------------ */

describe('5. the all-time best', () => {
  it('is the heaviest completed set across every workout', () => {
    const [variant] = derivePerformance([
      set({ workoutDate: '2026-09-03', loadValue: 45, result: 10 }),
      set({ workoutDate: '2026-09-10', loadValue: 47.5, result: 8 }),
      set({ workoutDate: '2026-09-17', loadValue: 47.5, result: 10 }),
      set({ workoutDate: '2026-09-24', loadValue: 50, result: 8 }),
    ])

    expect(variant.personalBest).toMatchObject({
      date: '2026-09-24',
      loadValue: 50,
      result: 8,
    })
  })

  it('is not displaced by a later lighter, longer set', () => {
    const [variant] = derivePerformance([
      set({ workoutDate: '2026-09-03', loadValue: 50, result: 6 }),
      set({ workoutDate: '2026-09-24', loadValue: 45, result: 20 }),
    ])
    expect(variant.personalBest).toMatchObject({ date: '2026-09-03', loadValue: 50 })
  })

  it('keeps the FIRST date an identical performance was achieved', () => {
    const [variant] = derivePerformance([
      set({ workoutDate: '2026-09-03', loadValue: 50, result: 8 }),
      set({ workoutDate: '2026-09-24', loadValue: 50, result: 8 }),
    ])
    // Repeating a performance is not becoming stronger.
    expect(variant.personalBest?.date).toBe('2026-09-03')
  })

  it('is null for nothing, and never zero', () => {
    expect(derivePerformance([])).toEqual([])
  })

  it('ranks kg and kg_each in separate variants', () => {
    const variants = derivePerformance([
      set({ exerciseId: 'db-press', loadMode: 'kg', loadValue: 30, result: 10 }),
      set({ exerciseId: 'db-press', loadMode: 'kg_each', loadValue: 20, result: 10 }),
    ])

    expect(variants).toHaveLength(2)
    const each = variants.find((variant) => variant.loadMode === 'kg_each')
    // 20 kg EACH is not folded into 40 kg total, and does not compete with the
    // 30 kg single-implement set.
    expect(each?.personalBest?.loadValue).toBe(20)
    expect(variants.find((variant) => variant.loadMode === 'kg')?.personalBest?.loadValue).toBe(30)
  })

  it('ranks per-side and both-sides in separate variants', () => {
    const variants = derivePerformance([
      set({ exerciseId: 'row', perSide: true, result: 10 }),
      set({ exerciseId: 'row', perSide: false, result: 20 }),
    ])
    expect(variants).toHaveLength(2)
  })

  it('ranks reps and seconds in separate variants', () => {
    const variants = derivePerformance([
      set({ exerciseId: 'hold', resultKind: 'reps', loadMode: 'none', loadValue: null, result: 12 }),
      set({
        exerciseId: 'hold',
        resultKind: 'seconds',
        loadMode: 'none',
        loadValue: null,
        result: 60,
      }),
    ])
    expect(variants).toHaveLength(2)
  })
})

/* ------------------------------------------------------------------ */
/* 6. Naming and ordering                                              */
/* ------------------------------------------------------------------ */

describe('6. presentation facts', () => {
  it('names an exercise from its most recent snapshot', () => {
    const [variant] = derivePerformance([
      set({ workoutDate: '2026-09-03', exerciseName: 'Lat Pulldown' }),
      set({ workoutDate: '2026-09-24', exerciseName: 'Lat Pulldown (Wide)' }),
    ])
    // The historical rows keep their own names; only the label is current.
    expect(variant.exerciseName).toBe('Lat Pulldown (Wide)')
  })

  it('orders variants most recently performed first', () => {
    const variants = derivePerformance([
      set({ exerciseId: 'old-lift', workoutDate: '2026-01-05' }),
      set({ exerciseId: 'recent-lift', workoutDate: '2026-09-24' }),
      set({ exerciseId: 'middle-lift', workoutDate: '2026-05-10' }),
    ])

    expect(variants.map((variant) => variant.exerciseId)).toEqual([
      'recent-lift',
      'middle-lift',
      'old-lift',
    ])
  })

  it('reports when each variant was last performed', () => {
    const [variant] = derivePerformance([
      set({ workoutDate: '2026-09-03' }),
      set({ workoutDate: '2026-09-24' }),
    ])
    expect(variant.lastPerformed).toBe('2026-09-24')
  })
})

/* ------------------------------------------------------------------ */
/* 7. Completeness                                                     */
/* ------------------------------------------------------------------ */

describe('7. all of history, or nothing', () => {
  /** A store holding a fixed list, paged exactly as D1 would page it. */
  function storeOf(rows: CompletedSetRow[]): ProgressHistoryStore & { calls: number } {
    const store = {
      calls: 0,
      async listCompletedSets(_googleSub: string, limit: number, offset: number) {
        store.calls += 1
        return rows.slice(offset, offset + limit)
      },
    }
    return store
  }

  it('reads a short history in one chunk', async () => {
    const store = storeOf([row(), row({ workoutDate: '2026-09-14' })])
    const read = await readPerformance(store, 'sub-a')

    expect(read.complete).toBe(true)
    expect(store.calls).toBe(1)
  })

  it('keeps reading until the history is exhausted', async () => {
    // Two and a bit chunks: the read must not stop at the first page.
    const rows = Array.from({ length: HISTORY_CHUNK * 2 + 7 }, (_, index) =>
      row({ workoutDate: `2026-01-01`, sessionId: `session-${index}`, loadValue: index + 1 }),
    )
    const store = storeOf(rows)
    const read = await readPerformance(store, 'sub-a')

    expect(read.complete).toBe(true)
    expect(read.complete && read.examined).toBe(rows.length)
    expect(store.calls).toBe(3)
  })

  it('finds a PB that lives in the OLDEST chunk', async () => {
    // The heaviest set is the very first row ever recorded, far outside any
    // recent page. A paged read that stopped early would report a lower PB and
    // nothing on screen would look wrong.
    const rows = [
      row({ workoutDate: '2020-01-01', sessionId: 'monday', loadValue: 200, result: 3 }),
      ...Array.from({ length: HISTORY_CHUNK * 2 }, (_, index) =>
        row({ workoutDate: '2026-01-01', sessionId: `s-${index}`, loadValue: 50, result: 10 }),
      ),
    ]
    const read = await readPerformance(storeOf(rows), 'sub-a')

    expect(read.complete).toBe(true)
    expect(read.complete && read.variants[0].personalBest).toMatchObject({
      date: '2020-01-01',
      loadValue: 200,
    })
  })

  it('fails closed on a row it cannot read', async () => {
    const read = await readPerformance(storeOf([row(), row({ loadMode: 'lb' })]), 'sub-a')

    // The unreadable row might have BEEN the best set. Dropping it would
    // publish a PB that is simply wrong, and a wrong PB looks exactly like a
    // right one.
    expect(read.complete).toBe(false)
    expect(read.complete === false && read.reason).toBe('unreadable')
    expect(read.variants).toEqual([])
  })

  it('fails closed rather than truncating an implausibly large history', async () => {
    // A store that never runs out: every chunk comes back full.
    const store: ProgressHistoryStore = {
      listCompletedSets: vi.fn(async (_sub: string, limit: number) =>
        Array.from({ length: limit }, () => row()),
      ),
    }

    const read = await readPerformance(store, 'sub-a')

    expect(read.complete).toBe(false)
    expect(read.complete === false && read.reason).toBe('truncated')
    // No half-answer is published.
    expect(read.variants).toEqual([])
  })

  it('reports an empty history as complete and empty', async () => {
    const read = await readPerformance(storeOf([]), 'sub-a')
    expect(read).toEqual({ complete: true, variants: [], examined: 0 })
  })
})
