import { describe, expect, it } from 'vitest'

import { buildMilestones } from '@/features/achievements/model/milestones'
import {
  countQualifyingSessions,
  evaluateStreaks,
  isQualifyingWorkout,
  type StreakSources,
} from '@/features/achievements/model/streak'
import {
  DEFAULT_FOUNDATION_START,
  foundationStatus,
} from '@/features/progress/foundation'
import { readProvenance, type WorkoutHistoryEntry } from '@shared/workoutLog'

/**
 * No day was flexed — the Round 19.2 baseline that preserves what this test
 * already meant. Flex neutrality has its own file, trainingFlex.test.ts.
 */
const NO_FLEX = new Map<string, never>()


/**
 * Round 17 correction 1, finding 3 — the client half of failing closed.
 *
 * `scheduled` is the most privileged status the app has: it can satisfy a
 * training day, extend a streak, unlock an achievement and suppress a
 * reminder. Nothing unreadable may be promoted into it, and the wire parsers
 * must not quietly do so either.
 *
 * September 2026: Mondays are the 7th/14th/21st, Fridays the 4th/11th/18th.
 */

const MONDAY = '2026-09-07'

function entry(
  over: Partial<WorkoutHistoryEntry> = {},
): WorkoutHistoryEntry {
  return {
    date: MONDAY,
    sessionId: 'monday',
    kind: 'scheduled',
    sourceSessionId: null,
    day: 'Monday',
    focus: 'Focus',
    intensity: 'HARD',
    startedAt: 1,
    updatedAt: 2,
    progress: { total: 4, completed: 4, skipped: 0, resolved: 4 },
    ...over,
  }
}

function sources(over: Partial<StreakSources> = {}): StreakSources {
  return {
    today: '2026-09-11',
    from: '2026-08-31',
    holidayStatus: 'ready',
    holidays: [],
    flexStatus: 'ready',
    flex: NO_FLEX,
    historyStatus: 'ready',
    entries: [],
    coverage: 'complete',
    ...over,
  }
}

/* ------------------------------------------------------------------ */
/* readProvenance — the single rule                                    */
/* ------------------------------------------------------------------ */

describe('readProvenance refuses rather than guessing', () => {
  it('accepts the two legitimate shapes', () => {
    expect(readProvenance('scheduled', null)).toEqual({
      kind: 'scheduled',
      sourceSessionId: null,
    })
    // An absent column and an empty string both mean "no source".
    expect(readProvenance('scheduled', undefined)).toEqual({
      kind: 'scheduled',
      sourceSessionId: null,
    })
    expect(readProvenance('scheduled', '')).toEqual({
      kind: 'scheduled',
      sourceSessionId: null,
    })
    expect(readProvenance('extra', 'monday')).toEqual({
      kind: 'extra',
      sourceSessionId: 'monday',
    })
  })

  it('refuses an unknown, missing or future kind — it does NOT become scheduled', () => {
    for (const kind of [null, undefined, '', 'Scheduled', 'SCHEDULED', 'superset', 42, {}]) {
      expect(readProvenance(kind, null), String(kind)).toBeNull()
    }
  })

  it('refuses the two internal contradictions', () => {
    // A scheduled workout IS its session; a source is a second, conflicting
    // answer, and there is no way to tell which half is the mistake.
    expect(readProvenance('scheduled', 'tuesday')).toBeNull()
    // An Extra that cannot say what it was copied from is not describable.
    expect(readProvenance('extra', null)).toBeNull()
    expect(readProvenance('extra', '')).toBeNull()
  })

  it('refuses an Extra sourced from the reserved Extra slug', () => {
    expect(readProvenance('extra', 'extra')).toBeNull()
  })

  it('refuses a source that is not a bounded slug', () => {
    expect(readProvenance('extra', 'Not A Slug!')).toBeNull()
    expect(readProvenance('extra', 'a'.repeat(200))).toBeNull()
    expect(readProvenance('extra', 42)).toBeNull()
  })
})

/* ------------------------------------------------------------------ */
/* 1 + 2. Streaks and planned-session achievements                     */
/* ------------------------------------------------------------------ */

describe('1/2. unreadable provenance cannot reach streaks or achievements', () => {
  it('is not a qualifying workout', () => {
    const unknown = entry({ kind: null })
    expect(isQualifyingWorkout(unknown, MONDAY, 'monday')).toBe(false)
  })

  it('is not counted as a qualifying planned session', () => {
    expect(countQualifyingSessions([entry({ kind: null })])).toBe(0)
  })

  it('makes the streak REFUSE rather than state a number', () => {
    // The important half of this. Simply ignoring the row would be wrong in
    // the other direction: an unreadable SCHEDULED workout read as absent
    // invents a broken streak from data we could not understand.
    const result = evaluateStreaks(sources({ entries: [entry({ kind: null })] }))

    expect(result.status).toBe('unavailable')
    expect(result).toEqual({ status: 'unavailable', reason: 'provenance' })
  })

  it('leaves every training milestone unresolved, never locked or unlocked', () => {
    const streak = evaluateStreaks(sources({ entries: [entry({ kind: null })] }))
    const milestones = buildMilestones({
      streak,
      foundation: foundationStatus('2026-09-11', DEFAULT_FOUNDATION_START),
    })

    for (const id of ['first-session', 'full-week', 'consistency'] as const) {
      const milestone = milestones.find((row) => row.id === id)
      // "Unresolved" is the honest state: we do not know, so nothing is
      // claimed in either direction.
      expect(milestone?.state.status, id).toBe('unresolved')
    }
  })

  it('does not silence a streak over a corrupt row outside the window', () => {
    // A corrupt occurrence from months ago could not have borne on this window,
    // so it must not take the answer away.
    const old = entry({ date: '2026-01-05', kind: null })
    const good = entry({ date: MONDAY })
    const result = evaluateStreaks(sources({ entries: [old, good] }))

    expect(result.status).toBe('ready')
  })

  it('7. valid migrated scheduled rows keep working exactly as before', () => {
    const result = evaluateStreaks(sources({ entries: [entry()] }))
    if (result.status !== 'ready') throw new Error(`expected ready, got ${result.status}`)

    expect(result.facts.qualifyingSessions).toBe(1)
    expect(result.facts.best).toBeGreaterThanOrEqual(1)
  })
})

/* ------------------------------------------------------------------ */
/* 6. Wire parsers must not coerce                                     */
/* ------------------------------------------------------------------ */

describe('6. the client wire parsers never coerce an unknown kind to scheduled', () => {
  it('history marks the row unknown instead of calling it scheduled', async () => {
    const { fetchWorkoutHistory } = await import('@/features/progress/historyApi')

    const body = {
      limit: 20,
      complete: true,
      totals: { workouts: 1, sets: 1, completed: 1, skipped: 0 },
      workouts: [
        {
          date: MONDAY,
          sessionId: 'monday',
          kind: 'something-else',
          sourceSessionId: null,
          day: 'Monday',
          focus: 'Focus',
          intensity: 'HARD',
          startedAt: 1,
          updatedAt: 2,
          progress: { total: 1, completed: 1, skipped: 0 },
        },
      ],
    }

    const fetchMock = async () =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    vi.stubGlobal('fetch', fetchMock)

    const history = await fetchWorkoutHistory({ limit: 20 })
    // The row survives — the sets are real recorded training…
    expect(history.workouts).toHaveLength(1)
    // …but its provenance is explicitly unknown.
    expect(history.workouts[0].kind).toBeNull()
    expect(history.workouts[0].sourceSessionId).toBeNull()

    vi.unstubAllGlobals()
  })

  it('history refuses a contradictory pair in both directions', async () => {
    const { fetchWorkoutHistory } = await import('@/features/progress/historyApi')

    const row = (kind: string, sourceSessionId: string | null) => ({
      date: MONDAY,
      sessionId: 'monday',
      kind,
      sourceSessionId,
      day: 'Monday',
      focus: 'Focus',
      intensity: 'HARD',
      startedAt: 1,
      updatedAt: 2,
      progress: { total: 1, completed: 1, skipped: 0 },
    })

    const body = {
      limit: 20,
      complete: true,
      totals: { workouts: 2, sets: 2, completed: 2, skipped: 0 },
      workouts: [row('scheduled', 'tuesday'), row('extra', null)],
    }

    vi.stubGlobal(
      'fetch',
      async () =>
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    )

    const history = await fetchWorkoutHistory({ limit: 20 })
    expect(history.workouts.map((workout) => workout.kind)).toEqual([null, null])

    vi.unstubAllGlobals()
  })

  it('the workout read FAILS rather than reporting an unstarted workout', async () => {
    const { fetchWorkout, WorkoutApiError } = await import('@/features/training/workoutApi')

    const body = {
      date: MONDAY,
      sessionId: 'monday',
      occurrence: {
        date: MONDAY,
        sessionId: 'monday',
        kind: 'mystery',
        sourceSessionId: null,
        day: 'Monday',
        focus: 'Focus',
        intensity: 'HARD',
        startedAt: 1,
        updatedAt: 2,
      },
      sets: [],
      progress: { total: 0, completed: 0, skipped: 0, resolved: 0 },
    }

    vi.stubGlobal(
      'fetch',
      async () =>
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    )

    // Reporting `occurrence: null` would read as "not started" and offer to
    // Start a workout that already exists. Throwing puts the page into its
    // honest error state instead.
    await expect(fetchWorkout(MONDAY, 'monday')).rejects.toBeInstanceOf(WorkoutApiError)

    vi.unstubAllGlobals()
  })

  it('still parses a valid scheduled and a valid extra occurrence', async () => {
    const { fetchWorkout } = await import('@/features/training/workoutApi')

    const make = (sessionId: string, kind: string, source: string | null) => ({
      date: MONDAY,
      sessionId,
      occurrence: {
        date: MONDAY,
        sessionId,
        kind,
        sourceSessionId: source,
        day: 'Monday',
        focus: 'Focus',
        intensity: 'HARD',
        startedAt: 1,
        updatedAt: 2,
      },
      sets: [],
      progress: { total: 0, completed: 0, skipped: 0, resolved: 0 },
    })

    vi.stubGlobal(
      'fetch',
      async (url: string) =>
        new Response(
          JSON.stringify(
            url.includes('/extra')
              ? make('extra', 'extra', 'monday')
              : make('monday', 'scheduled', null),
          ),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    )

    expect((await fetchWorkout(MONDAY, 'monday')).occurrence?.kind).toBe('scheduled')
    const extra = await fetchWorkout(MONDAY, 'extra')
    expect(extra.occurrence?.kind).toBe('extra')
    expect(extra.occurrence?.sourceSessionId).toBe('monday')

    vi.unstubAllGlobals()
  })
})
