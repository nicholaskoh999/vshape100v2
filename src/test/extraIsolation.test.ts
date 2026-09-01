import { describe, expect, it } from 'vitest'

import { buildMilestones } from '@/features/achievements/model/milestones'
import { scheduledDayFor } from '@/features/achievements/model/schedule'
import {
  bestStreak,
  buildQualifyingIndex,
  countQualifyingSessions,
  currentStreak,
  evaluateStreaks,
  isQualifyingWorkout,
  outcomeFor,
  type StreakSources,
} from '@/features/achievements/model/streak'
import {
  DEFAULT_FOUNDATION_START,
  foundationStatus,
} from '@/features/progress/foundation'
import type { HolidayRecord } from '@shared/holiday'
import type { WorkoutHistoryEntry } from '@shared/workoutLog'

/**
 * No day was flexed — the Round 19.2 baseline that preserves what every test
 * here already meant. Flex neutrality has its own file, trainingFlex.test.ts.
 */
const NO_FLEX = new Map<string, never>()




/**
 * Round 17 — Extra Workout must be NEUTRAL to scheduled truth.
 *
 * An Extra is real recorded training. It is not the obligation, so it may
 * neither extend a streak nor break one, and it may not move any achievement
 * that counts planned sessions.
 *
 * The interesting cases are the ones where an Extra looks as much like the
 * scheduled workout as it possibly can: the same account, the same date, the
 * same source template, fully completed. If provenance were being inferred
 * rather than persisted, those are the ones that would leak.
 *
 * September 2026: the 1st is a Tuesday, the 5th a Saturday, the 6th a Sunday.
 * So Mondays are the 7th/14th/21st and Fridays the 4th/11th/18th.
 */

const MONDAY = '2026-09-07'
const TUESDAY = '2026-09-08'
const WEDNESDAY = '2026-09-09'
const SATURDAY = '2026-09-05'

type Provenance = { kind?: 'scheduled' | 'extra'; sourceSessionId?: string | null }

function entry(
  date: string,
  sessionId: string,
  counts: { total: number; completed: number; skipped: number },
  provenance: Provenance = {},
): WorkoutHistoryEntry {
  return {
    date,
    sessionId,
    kind: provenance.kind ?? 'scheduled',
    sourceSessionId: provenance.sourceSessionId ?? null,
    day: sessionId,
    focus: 'Focus',
    intensity: 'HARD',
    startedAt: 1,
    updatedAt: 2,
    progress: {
      total: counts.total,
      completed: counts.completed,
      skipped: counts.skipped,
      resolved: counts.completed + counts.skipped,
    },
  }
}

/** A finished scheduled session. */
function finished(date: string, sessionId: string): WorkoutHistoryEntry {
  return entry(date, sessionId, { total: 4, completed: 4, skipped: 0 })
}

/**
 * A finished EXTRA, filed under the reserved slug with its source recorded.
 *
 * This is what the app actually stores: an Extra never occupies a weekday
 * session id, so it carries `extra` here too.
 */
function finishedExtra(date: string, source: string): WorkoutHistoryEntry {
  return entry(
    date,
    'extra',
    { total: 4, completed: 4, skipped: 0 },
    { kind: 'extra', sourceSessionId: source },
  )
}

function holiday(
  id: string,
  startDate: string,
  endDate = startDate,
  overrides: Partial<Pick<HolidayRecord, 'name' | 'source' | 'trainingOn'>> = {},
): HolidayRecord {
  return {
    id,
    startDate,
    endDate,
    name: overrides.name ?? '',
    source: overrides.source ?? 'custom',
    trainingOn: overrides.trainingOn ?? false,
    createdAt: 1,
    updatedAt: 1,
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

function facts(over: Partial<StreakSources> = {}) {
  const result = evaluateStreaks(sources(over))
  if (result.status !== 'ready') throw new Error(`expected ready, got ${result.status}`)
  return result.facts
}

function window(over: Partial<StreakSources> = {}) {
  const input = sources(over)
  return {
    from: input.from,
    today: input.today,
    holidays: input.holidays,
    flex: input.flex,
    qualifying: buildQualifyingIndex(input.entries),
  }
}

/* ------------------------------------------------------------------ */
/* 10. Streaks                                                         */
/* ------------------------------------------------------------------ */

describe('10. an Extra can neither extend nor break a scheduled streak', () => {
  it('is not a qualifying workout, however complete it is', () => {
    const extra = finishedExtra(MONDAY, 'monday')
    // Asked about its own identity, which is the most generous question.
    expect(isQualifyingWorkout(extra, MONDAY, 'extra')).toBe(false)
    // And it cannot answer for the session it was copied from.
    expect(isQualifyingWorkout(extra, MONDAY, 'monday')).toBe(false)
  })

  it('refuses even an Extra that has been mislabelled with a weekday slug', () => {
    // Defence in depth. If a row ever reached the client filed under `monday`
    // while carrying extra provenance, `kind` is what decides — not the slug.
    const mislabelled = entry(
      MONDAY,
      'monday',
      { total: 4, completed: 4, skipped: 0 },
      { kind: 'extra', sourceSessionId: 'monday' },
    )
    expect(isQualifyingWorkout(mislabelled, MONDAY, 'monday')).toBe(false)
  })

  it('does not extend a streak', () => {
    const scheduledOnly = [finished(MONDAY, 'monday')]
    const withExtra = [...scheduledOnly, finishedExtra(TUESDAY, 'monday')]

    const before = currentStreak(window({ entries: scheduledOnly, today: MONDAY, from: MONDAY }))
    const after = currentStreak(window({ entries: withExtra, today: MONDAY, from: MONDAY }))

    expect(before).toBe(1)
    expect(after).toBe(before)
  })

  it('does not repair a broken streak', () => {
    // Tuesday's scheduled session was missed; an Extra that day does not mend
    // it, because the obligation still went unperformed.
    const entries = [finished(MONDAY, 'monday'), finishedExtra(TUESDAY, 'monday')]
    const result = currentStreak(window({ entries, today: WEDNESDAY, from: MONDAY }))

    expect(outcomeFor(TUESDAY, window({ entries, today: WEDNESDAY, from: MONDAY }))).toBe(
      'failure',
    )
    expect(result).toBe(0)
  })

  it('does not break a streak either', () => {
    // A Saturday Extra sits on a neutral day. It must leave the run intact
    // rather than introducing a judged day where there was none.
    const entries = [finished('2026-09-04', 'friday'), finishedExtra(SATURDAY, 'monday')]
    const withExtra = window({ entries, today: SATURDAY, from: '2026-09-04' })
    const withoutExtra = window({
      entries: [finished('2026-09-04', 'friday')],
      today: SATURDAY,
      from: '2026-09-04',
    })

    expect(outcomeFor(SATURDAY, withExtra)).toBe('neutral')
    expect(currentStreak(withExtra)).toBe(currentStreak(withoutExtra))
    expect(bestStreak(withExtra)).toBe(bestStreak(withoutExtra))
  })

  it('leaves every streak fact identical when Extras are added', () => {
    const scheduled = [finished(MONDAY, 'monday'), finished('2026-09-04', 'friday')]
    const extras = [
      finishedExtra(MONDAY, 'monday'),
      finishedExtra(TUESDAY, 'tuesday'),
      finishedExtra(SATURDAY, 'friday'),
    ]

    expect(facts({ entries: [...scheduled, ...extras] })).toEqual(facts({ entries: scheduled }))
  })
})

/* ------------------------------------------------------------------ */
/* 11. Achievements                                                    */
/* ------------------------------------------------------------------ */

describe('11. an Extra moves no planned-session achievement', () => {
  it('is not counted as a qualifying session', () => {
    const entries = [finished(MONDAY, 'monday'), finishedExtra(MONDAY, 'monday')]
    // One planned session was finished that day, not two.
    expect(countQualifyingSessions(entries)).toBe(1)
  })

  it('cannot unlock First session on its own', () => {
    const streak = evaluateStreaks(sources({ entries: [finishedExtra(MONDAY, 'monday')] }))
    const milestones = buildMilestones({
      streak,
      foundation: foundationStatus('2026-09-11', DEFAULT_FOUNDATION_START),
    })
    const first = milestones.find((row) => row.id === 'first-session')

    expect(first?.state.status).toBe('locked')
  })

  it('leaves First, Full week and Consistency exactly where they were', () => {
    const scheduled = [
      finished('2026-09-07', 'monday'),
      finished('2026-09-08', 'tuesday'),
      finished('2026-09-09', 'wednesday'),
    ]
    const extras = [
      finishedExtra('2026-09-07', 'monday'),
      finishedExtra('2026-09-08', 'tuesday'),
      finishedExtra('2026-09-10', 'thursday'),
      finishedExtra('2026-09-05', 'friday'),
    ]

    const before = buildMilestones({
      streak: evaluateStreaks(sources({ entries: scheduled })),
      foundation: foundationStatus('2026-09-11', DEFAULT_FOUNDATION_START),
    })
    const after = buildMilestones({
      streak: evaluateStreaks(sources({ entries: [...scheduled, ...extras] })),
      foundation: foundationStatus('2026-09-11', DEFAULT_FOUNDATION_START),
    })

    for (const id of ['first-session', 'full-week', 'consistency'] as const) {
      expect(after.find((row) => row.id === id), id).toEqual(
        before.find((row) => row.id === id),
      )
    }
    // Foundation day count is a calendar fact and is likewise untouched.
    expect(after.find((row) => row.id === 'day-10')).toEqual(
      before.find((row) => row.id === 'day-10'),
    )
  })
})

/* ------------------------------------------------------------------ */
/* 6. Holiday Training Off                                             */
/* ------------------------------------------------------------------ */

describe('6. Holiday stays Off, exempt and streak-neutral when an Extra happens', () => {
  it('leaves the day neutral rather than turning it into a training day', () => {
    const holidays = [holiday('h1', MONDAY)]

    // The schedule for that date is decided by Holiday, not by what was logged.
    expect(scheduledDayFor(MONDAY, holidays, NO_FLEX)).toEqual({
      kind: 'neutral',
      date: MONDAY,
      reason: 'holiday',
    })

    const entries = [finishedExtra(MONDAY, 'monday')]
    expect(outcomeFor(MONDAY, window({ entries, holidays, today: MONDAY, from: MONDAY }))).toBe(
      'neutral',
    )
  })

  it('keeps every streak fact identical to the Holiday with no Extra at all', () => {
    const holidays = [holiday('h1', MONDAY)]

    expect(
      facts({ holidays, entries: [finishedExtra(MONDAY, 'monday')], today: MONDAY, from: MONDAY }),
    ).toEqual(facts({ holidays, entries: [], today: MONDAY, from: MONDAY }))
  })

  it('still records the Extra as factual history', () => {
    // Neutral to the streak is not the same as forgotten. The row is real
    // recorded training, and nothing above deleted or hid it.
    const extra = finishedExtra(MONDAY, 'monday')
    expect(extra.progress.completed).toBe(4)
    expect(extra.kind).toBe('extra')
    expect(extra.sourceSessionId).toBe('monday')
  })
})

/* ------------------------------------------------------------------ */
/* 7. Holiday Training On                                              */
/* ------------------------------------------------------------------ */

describe('7. Holiday Training On keeps the scheduled session and the Extra apart', () => {
  it('counts the scheduled workout and ignores the Extra beside it', () => {
    const holidays = [holiday('h1', MONDAY, MONDAY, { trainingOn: true })]

    // Training On restores the weekday's own session as scheduled.
    expect(scheduledDayFor(MONDAY, holidays, NO_FLEX)).toEqual({
      kind: 'training',
      date: MONDAY,
      sessionId: 'monday',
    })

    const entries = [finished(MONDAY, 'monday'), finishedExtra(MONDAY, 'monday')]
    const streak = window({ entries, holidays, today: MONDAY, from: MONDAY })

    expect(outcomeFor(MONDAY, streak)).toBe('success')
    // The day succeeded once, on the strength of the scheduled workout alone.
    expect(countQualifyingSessions(entries)).toBe(1)
    expect(currentStreak(streak)).toBe(1)
  })
})

/* ------------------------------------------------------------------ */
/* 8. Today                                                            */
/* ------------------------------------------------------------------ */

describe('8. an Extra does not satisfy the scheduled Today obligation', () => {
  it('leaves the scheduled day unsatisfied when only the Extra was finished', () => {
    // Today's completion truth lives in `today_completions`, which no workout
    // write in this round touches. What a workout CAN say about a scheduled day
    // is exactly this, and an Extra says nothing.
    const entries = [finishedExtra(MONDAY, 'monday')]
    const streak = window({ entries, today: MONDAY, from: MONDAY })

    // Not 'success': the scheduled Monday session is still outstanding. It is
    // 'pending' rather than 'failure' only because the local day is not over.
    expect(outcomeFor(MONDAY, streak)).toBe('pending')

    const yesterdayStreak = window({ entries, today: TUESDAY, from: MONDAY })
    // Once the day has passed, the obligation reads as genuinely unmet.
    expect(outcomeFor(MONDAY, yesterdayStreak)).toBe('failure')
  })
})
