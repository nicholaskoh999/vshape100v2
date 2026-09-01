import { describe, expect, it } from 'vitest'

import {
  buildMilestones,
  milestoneProgressLabel,
  type Milestone,
  type MilestoneId,
} from '@/features/achievements/model/milestones'
import { scheduledDayFor } from '@/features/achievements/model/schedule'
import { sessionIdForWeekday } from '@/features/today/model/routines'
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
  evaluationChunks,
  evaluationWindow,
  MAX_CHUNK_DAYS,
  rangeLength,
} from '@/features/achievements/model/window'
import {
  DEFAULT_FOUNDATION_START,
  foundationStatus,
} from '@/features/progress/foundation'
import type { HolidayRecord } from '@shared/holiday'
import { addLocalDays, daysBetween } from '@shared/localDate'
import type { WorkoutHistoryEntry } from '@shared/workoutLog'

/**
 * Round 12 — the streak and milestone rules.
 *
 * A streak counts SCHEDULED TRAINING DAYS. The two things these tests defend
 * hardest are the ones that would hurt a real person: a planned Holiday must
 * never read as a miss, and a number must never be stated from truth the app
 * does not actually have.
 *
 * September 2026: the 1st is a Tuesday, the 5th a Saturday, the 6th a Sunday.
 * So Mondays are the 7th/14th/21st and Fridays the 4th/11th/18th.
 */

/* ------------------------------------------------------------------ */
/* Builders                                                            */
/* ------------------------------------------------------------------ */

function entry(
  date: string,
  sessionId: string,
  counts: { total: number; completed: number; skipped: number },
  // Round 17: every pre-existing case is a scheduled workout, which is what
  // these rules have always been about. Extra is opted into explicitly.
  provenance: { kind?: 'scheduled' | 'extra'; sourceSessionId?: string | null } = {},
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

/** A finished session: every set resolved, at least one actually completed. */
function finished(date: string, sessionId: string): WorkoutHistoryEntry {
  return entry(date, sessionId, { total: 4, completed: 4, skipped: 0 })
}

/**
 * A Holiday record. Training Off by default — the exempt default, and the
 * behaviour every Round 12 assertion below was written against.
 */
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

/** Streak sources with everything settled, so a test states only its subject. */
function sources(over: Partial<StreakSources> = {}): StreakSources {
  return {
    today: '2026-09-11',
    from: '2026-08-31',
    holidayStatus: 'ready',
    holidays: [],
    historyStatus: 'ready',
    entries: [],
    coverage: 'complete',
    ...over,
  }
}

function facts(over: Partial<StreakSources> = {}) {
  const result = evaluateStreaks(sources(over))
  if (result.status !== 'ready') {
    throw new Error(`expected ready streak, got ${result.status}`)
  }
  return result.facts
}

function window(over: Partial<StreakSources> = {}) {
  const input = sources(over)
  return {
    from: input.from,
    today: input.today,
    holidays: input.holidays,
    qualifying: buildQualifyingIndex(input.entries),
  }
}

function milestone(list: Milestone[], id: MilestoneId): Milestone {
  const found = list.find((row) => row.id === id)
  if (!found) throw new Error(`no milestone ${id}`)
  return found
}

/* ------------------------------------------------------------------ */
/* 1. The schedule a date plans                                        */
/* ------------------------------------------------------------------ */

describe('1. scheduled days', () => {
  it('maps Monday to Friday to their own training sessions', () => {
    const weekdays: [string, string][] = [
      ['2026-09-07', 'monday'],
      ['2026-09-08', 'tuesday'],
      ['2026-09-09', 'wednesday'],
      ['2026-09-10', 'thursday'],
      ['2026-09-11', 'friday'],
    ]

    for (const [date, sessionId] of weekdays) {
      expect(scheduledDayFor(date, []), date).toEqual({ kind: 'training', date, sessionId })
    }
  })

  it('treats Saturday as neutral, not a missed session', () => {
    expect(scheduledDayFor('2026-09-12', [])).toEqual({
      kind: 'neutral',
      date: '2026-09-12',
      reason: 'saturday',
    })
  })

  it('treats Sunday as neutral', () => {
    expect(scheduledDayFor('2026-09-13', [])).toEqual({
      kind: 'neutral',
      date: '2026-09-13',
      reason: 'sunday',
    })
  })

  it('treats a Holiday weekday as neutral, overriding its training day', () => {
    const days = [holiday('h1', '2026-09-07', '2026-09-11')]
    // A Monday that would otherwise plan the Monday session.
    expect(scheduledDayFor('2026-09-07', days)).toEqual({
      kind: 'neutral',
      date: '2026-09-07',
      reason: 'holiday',
    })
  })

  it('refuses to classify something that is not a calendar date', () => {
    expect(scheduledDayFor('2026-02-30', [])).toBeNull()
    expect(scheduledDayFor('not-a-date', [])).toBeNull()
  })
})

/* ------------------------------------------------------------------ */
/* 2. What counts as a finished session                                */
/* ------------------------------------------------------------------ */

describe('2. qualifying workouts', () => {
  it('requires every set to be resolved', () => {
    const partial = entry('2026-09-07', 'monday', { total: 4, completed: 2, skipped: 0 })
    expect(isQualifyingWorkout(partial, '2026-09-07', 'monday')).toBe(false)
  })

  it('accepts a mix of completed and skipped, because something was trained', () => {
    const mixed = entry('2026-09-07', 'monday', { total: 4, completed: 3, skipped: 1 })
    expect(isQualifyingWorkout(mixed, '2026-09-07', 'monday')).toBe(true)
  })

  it('rejects a workout that was entirely skipped', () => {
    // Fully resolved, and not trained at all. This is the case `resolved`
    // alone would get wrong.
    const allSkipped = entry('2026-09-07', 'monday', { total: 4, completed: 0, skipped: 4 })
    expect(allSkipped.progress.resolved).toBe(allSkipped.progress.total)
    expect(isQualifyingWorkout(allSkipped, '2026-09-07', 'monday')).toBe(false)
  })

  it('rejects a workout that was only started', () => {
    const started = entry('2026-09-07', 'monday', { total: 4, completed: 0, skipped: 0 })
    expect(isQualifyingWorkout(started, '2026-09-07', 'monday')).toBe(false)
  })

  it('rejects a workout with no sets at all', () => {
    const empty = entry('2026-09-07', 'monday', { total: 0, completed: 0, skipped: 0 })
    expect(isQualifyingWorkout(empty, '2026-09-07', 'monday')).toBe(false)
  })

  it('does not let another day’s session satisfy this one', () => {
    const tuesdayLog = finished('2026-09-07', 'tuesday')
    // Monday the 7th plans 'monday'. A finished 'tuesday' log on that date is
    // not the session the day planned.
    expect(isQualifyingWorkout(tuesdayLog, '2026-09-07', 'monday')).toBe(false)

    const outcome = outcomeFor('2026-09-07', {
      today: '2026-09-11',
      holidays: [],
      qualifying: buildQualifyingIndex([tuesdayLog]),
    })
    expect(outcome).toBe('failure')
  })
})

/* ------------------------------------------------------------------ */
/* 3. Current streak                                                   */
/* ------------------------------------------------------------------ */

describe('3. current streak', () => {
  it('breaks on a past training day with nothing recorded', () => {
    // Thu finished; Fri the 11th passed with nothing recorded. Today is the
    // following Monday, so Friday is genuinely in the past — a miss, not a
    // day still open.
    const entries = [finished('2026-09-10', 'thursday')]
    expect(currentStreak(window({ entries, today: '2026-09-14' }))).toBe(0)
  })

  it('does not treat today’s own unfinished session as that miss', () => {
    // The same facts with today AS the Friday: it is pending, so the streak
    // still stands on Thursday.
    const entries = [finished('2026-09-10', 'thursday')]
    expect(currentStreak(window({ entries, today: '2026-09-11' }))).toBe(1)
  })

  it('counts across a weekend without breaking', () => {
    const entries = [
      finished('2026-09-11', 'friday'),
      finished('2026-09-14', 'monday'),
    ]
    // Sat 12th and Sun 13th sit between them and are neutral.
    expect(currentStreak(window({ entries, today: '2026-09-14', from: '2026-09-11' }))).toBe(2)
  })

  it('counts across a Holiday without breaking', () => {
    const entries = [
      finished('2026-09-10', 'thursday'),
      finished('2026-09-11', 'friday'),
      finished('2026-09-15', 'tuesday'),
    ]
    // Monday the 14th is a Holiday: exempt, so it neither counts nor breaks.
    const holidays = [holiday('h1', '2026-09-14')]
    const result = currentStreak(
      window({ entries, holidays, today: '2026-09-15', from: '2026-09-10' }),
    )
    // The brief's own example: 3 training days, not 6 calendar days.
    expect(result).toBe(3)
  })

  it('does not break while today is still unfinished', () => {
    const entries = [
      finished('2026-09-09', 'wednesday'),
      finished('2026-09-10', 'thursday'),
    ]
    // Friday is today and has nothing recorded yet — still pending.
    expect(outcomeFor('2026-09-11', {
      today: '2026-09-11',
      holidays: [],
      qualifying: buildQualifyingIndex(entries),
    })).toBe('pending')

    expect(currentStreak(window({ entries, today: '2026-09-11', from: '2026-09-09' }))).toBe(2)
  })

  it('extends when today is finished', () => {
    const entries = [
      finished('2026-09-09', 'wednesday'),
      finished('2026-09-10', 'thursday'),
      finished('2026-09-11', 'friday'),
    ]
    expect(currentStreak(window({ entries, today: '2026-09-11', from: '2026-09-09' }))).toBe(3)
  })

  it('never counts a Holiday as a success', () => {
    // A whole week of Holiday with nothing recorded is not a streak of five.
    const holidays = [holiday('h1', '2026-09-07', '2026-09-11')]
    expect(currentStreak(window({ holidays, today: '2026-09-11', from: '2026-09-07' }))).toBe(0)
  })

  it('ignores dates after today', () => {
    const entries = [finished('2026-09-18', 'friday')]
    expect(currentStreak(window({ entries, today: '2026-09-11', from: '2026-09-07' }))).toBe(0)
  })
})

/* ------------------------------------------------------------------ */
/* 4. Best streak                                                      */
/* ------------------------------------------------------------------ */

describe('4. best streak', () => {
  it('resets after a real failure and starts again', () => {
    const entries = [
      // Run of two…
      finished('2026-09-01', 'tuesday'),
      finished('2026-09-02', 'wednesday'),
      // …the 3rd is missed…
      // …then a run of three.
      finished('2026-09-04', 'friday'),
      finished('2026-09-07', 'monday'),
      finished('2026-09-08', 'tuesday'),
    ]
    const result = bestStreak(window({ entries, today: '2026-09-08', from: '2026-09-01' }))
    expect(result).toBe(3)
  })

  it('does not let Holidays inflate the best run', () => {
    // Two finished days with a Holiday week between them is a run of two,
    // not a run of seven.
    const entries = [
      finished('2026-09-04', 'friday'),
      finished('2026-09-14', 'monday'),
    ]
    const holidays = [holiday('h1', '2026-09-07', '2026-09-11')]
    expect(bestStreak(window({ entries, holidays, today: '2026-09-14', from: '2026-09-04' })))
      .toBe(2)
  })

  it('keeps the best run when the current one has been broken', () => {
    const entries = [
      finished('2026-09-01', 'tuesday'),
      finished('2026-09-02', 'wednesday'),
      finished('2026-09-03', 'thursday'),
      // 4th missed, and today is the 4th's future.
    ]
    const result = evaluateStreaks(
      sources({ entries, today: '2026-09-07', from: '2026-09-01' }),
    )
    expect(result.status).toBe('ready')
    if (result.status === 'ready') {
      expect(result.facts.best).toBe(3)
      expect(result.facts.current).toBe(0)
    }
  })
})

/* ------------------------------------------------------------------ */
/* 5. Finished-session count                                           */
/* ------------------------------------------------------------------ */

describe('5. qualifying session count', () => {
  it('counts only genuinely finished planned sessions', () => {
    const entries = [
      finished('2026-09-07', 'monday'),
      entry('2026-09-08', 'tuesday', { total: 4, completed: 0, skipped: 4 }),
      entry('2026-09-09', 'wednesday', { total: 4, completed: 1, skipped: 0 }),
      finished('2026-09-10', 'thursday'),
    ]
    expect(countQualifyingSessions(entries)).toBe(2)
  })

  it('does not count a session logged against the wrong weekday', () => {
    expect(countQualifyingSessions([finished('2026-09-07', 'friday')])).toBe(0)
  })

  it('counts a session finished on a real Holiday without moving any streak', () => {
    // The whole rule in one evaluation: an ACTUAL Holiday record covering the
    // date, and a genuinely finished matching weekday workout on it.
    const entries = [finished('2026-09-07', 'monday')]
    const holidays = [holiday('h1', '2026-09-07')]
    const result = evaluateStreaks(
      sources({ entries, holidays, today: '2026-09-07', from: '2026-09-07' }),
    )

    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return

    // The work happened, so it counts as a session finished…
    expect(result.facts.qualifyingSessions).toBe(1)
    // …and First session can unlock from it.
    const list = buildMilestones({ streak: result, foundation: foundationStatus('2026-09-07', DEFAULT_FOUNDATION_START) })
    expect(milestone(list, 'first-session').state.status).toBe('unlocked')

    // …but the date stays EXEMPT, so neither streak moves.
    expect(result.facts.current).toBe(0)
    expect(result.facts.best).toBe(0)
    expect(outcomeFor('2026-09-07', {
      today: '2026-09-07',
      holidays,
      qualifying: buildQualifyingIndex(entries),
    })).toBe('neutral')
  })
})

/* ------------------------------------------------------------------ */
/* 6. Refusing to answer                                               */
/* ------------------------------------------------------------------ */

describe('6. incomplete truth', () => {
  it('states no streak while Holiday truth is still loading', () => {
    expect(evaluateStreaks(sources({ holidayStatus: 'loading' }))).toEqual({
      status: 'checking',
    })
  })

  it('states no streak when Holiday truth failed', () => {
    // Without it, a planned Holiday and a missed session are indistinguishable.
    expect(evaluateStreaks(sources({ holidayStatus: 'error' }))).toEqual({
      status: 'unavailable',
      reason: 'holidays',
    })
  })

  it('states no streak when the workout read failed', () => {
    expect(evaluateStreaks(sources({ historyStatus: 'error' }))).toEqual({
      status: 'unavailable',
      reason: 'workouts',
    })
  })

  it('treats a truncated workout read as unproven, not as an empty week', () => {
    // The trap: these entries would otherwise compute a confident streak of 0
    // and claim every other day was missed.
    const entries = [finished('2026-09-11', 'friday')]
    expect(evaluateStreaks(sources({ entries, coverage: 'partial' }))).toEqual({
      status: 'unavailable',
      reason: 'coverage',
    })
    expect(evaluateStreaks(sources({ entries, coverage: 'unknown' }))).toEqual({
      status: 'unavailable',
      reason: 'coverage',
    })
  })

  it('refuses a window that is not a usable pair of dates', () => {
    expect(evaluateStreaks(sources({ from: '2026-09-20', today: '2026-09-11' }))).toEqual({
      status: 'unavailable',
      reason: 'range',
    })
    expect(evaluateStreaks(sources({ today: 'nonsense' }))).toEqual({
      status: 'unavailable',
      reason: 'range',
    })
  })

  it('answers normally once every source is settled and complete', () => {
    expect(facts({ entries: [finished('2026-09-11', 'friday')] })).toMatchObject({
      current: 1,
    })
  })
})

/* ------------------------------------------------------------------ */
/* 7. The evaluation window                                            */
/* ------------------------------------------------------------------ */

describe('7. evaluation window', () => {
  it('starts at Foundation Day 1', () => {
    expect(evaluationWindow('2026-09-11', DEFAULT_FOUNDATION_START)).toEqual({ from: '2026-08-31', to: '2026-09-11' })
  })

  it('collapses to today before Foundation begins, rather than running backwards', () => {
    expect(evaluationWindow('2026-08-01', DEFAULT_FOUNDATION_START)).toEqual({ from: '2026-08-01', to: '2026-08-01' })
  })

  it('still reaches back to Day 1 years later, never a rolling year', () => {
    // The correction. A rolling window would quietly rewrite history: a run
    // reached in 2026 would stop counting once it aged out, and an
    // achievement already earned would lock itself again.
    const result = evaluationWindow('2030-01-01', DEFAULT_FOUNDATION_START)
    expect(result).toEqual({ from: '2026-08-31', to: '2030-01-01' })
  })
})

/* ------------------------------------------------------------------ */
/* 7b. Reading that period in bounded chunks                           */
/* ------------------------------------------------------------------ */

describe('7b. evaluation chunks', () => {
  it('asks for one chunk when the period fits in one request', () => {
    expect(evaluationChunks({ from: '2026-08-31', to: '2026-09-11' })).toEqual([
      { from: '2026-08-31', to: '2026-09-11' },
    ])
  })

  it('keeps every chunk inside the per-request bound', () => {
    const chunks = evaluationChunks(evaluationWindow('2030-01-01', DEFAULT_FOUNDATION_START))
    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      expect(rangeLength(chunk), `${chunk.from}..${chunk.to}`).toBeLessThanOrEqual(
        MAX_CHUNK_DAYS,
      )
    }
  })

  it('tiles the whole period exactly — no gap and no overlap', () => {
    const window = evaluationWindow('2030-01-01', DEFAULT_FOUNDATION_START)
    const chunks = evaluationChunks(window)

    expect(chunks[0].from).toBe(window.from)
    expect(chunks[chunks.length - 1].to).toBe(window.to)

    for (let i = 1; i < chunks.length; i += 1) {
      // Each chunk begins the day AFTER the previous one ends: adjacent, so
      // no date is missed, and non-overlapping, so none is counted twice.
      expect(addLocalDays(chunks[i - 1].to, 1)).toBe(chunks[i].from)
    }
  })

  it('covers every date in the period', () => {
    const window = evaluationWindow('2028-03-17', DEFAULT_FOUNDATION_START)
    const chunks = evaluationChunks(window)
    const covered = chunks.reduce((sum, chunk) => sum + rangeLength(chunk), 0)
    expect(covered).toBe(rangeLength(window))
  })

  it('returns nothing for a period that is not usable', () => {
    expect(evaluationChunks({ from: '2026-09-30', to: '2026-09-01' })).toEqual([])
    expect(evaluationChunks({ from: 'nonsense', to: '2026-09-01' })).toEqual([])
  })
})

/* ------------------------------------------------------------------ */
/* 8. Milestones                                                       */
/* ------------------------------------------------------------------ */

describe('8. milestones', () => {
  const ready = (over: Partial<StreakSources> = {}) => evaluateStreaks(sources(over))

  it('unlocks First session on one finished session', () => {
    const list = buildMilestones({
      streak: ready({ entries: [finished('2026-09-11', 'friday')] }),
      foundation: foundationStatus('2026-09-11', DEFAULT_FOUNDATION_START),
    })
    expect(milestone(list, 'first-session').state.status).toBe('unlocked')
  })

  it('shows honest progress toward Full week', () => {
    const entries = [
      finished('2026-09-09', 'wednesday'),
      finished('2026-09-10', 'thursday'),
      finished('2026-09-11', 'friday'),
    ]
    const list = buildMilestones({
      streak: ready({ entries, today: '2026-09-11', from: '2026-09-09' }),
      foundation: foundationStatus('2026-09-11', DEFAULT_FOUNDATION_START),
    })
    const week = milestone(list, 'full-week')
    expect(week.state).toEqual({ status: 'locked', value: 3, target: 5 })
    expect(milestoneProgressLabel(week)).toBe('3 / 5 training days')
  })

  it('unlocks Full week at five and Consistency at ten', () => {
    // Two full weeks of finished weekdays, weekends in between.
    const dates: [string, string][] = [
      ['2026-09-07', 'monday'],
      ['2026-09-08', 'tuesday'],
      ['2026-09-09', 'wednesday'],
      ['2026-09-10', 'thursday'],
      ['2026-09-11', 'friday'],
      ['2026-09-14', 'monday'],
      ['2026-09-15', 'tuesday'],
      ['2026-09-16', 'wednesday'],
      ['2026-09-17', 'thursday'],
      ['2026-09-18', 'friday'],
    ]
    const streak = ready({
      entries: dates.map(([date, session]) => finished(date, session)),
      today: '2026-09-18',
      from: '2026-09-07',
    })
    const list = buildMilestones({ streak, foundation: foundationStatus('2026-09-18', DEFAULT_FOUNDATION_START) })

    expect(milestone(list, 'full-week').state.status).toBe('unlocked')
    expect(milestone(list, 'consistency').state.status).toBe('unlocked')
  })

  it('unlocks Foundation days by the calendar alone', () => {
    // Day 10 is 2026-09-09; Day 50 is 2026-10-19; Day 100 is 2026-12-08.
    const atDay10 = buildMilestones({
      streak: ready(),
      foundation: foundationStatus('2026-09-09', DEFAULT_FOUNDATION_START),
    })
    expect(milestone(atDay10, 'day-10').state.status).toBe('unlocked')
    expect(milestone(atDay10, 'day-50').state).toEqual({
      status: 'locked',
      value: 10,
      target: 50,
    })

    const atDay100 = buildMilestones({
      streak: ready(),
      foundation: foundationStatus('2026-12-08', DEFAULT_FOUNDATION_START),
    })
    expect(milestone(atDay100, 'day-50').state.status).toBe('unlocked')
    expect(milestone(atDay100, 'day-100').state.status).toBe('unlocked')
  })

  it('needs no workout at all to reach a Foundation day', () => {
    const list = buildMilestones({
      streak: ready({ entries: [] }),
      foundation: foundationStatus('2026-09-09', DEFAULT_FOUNDATION_START),
    })
    expect(milestone(list, 'day-10').state.status).toBe('unlocked')
  })

  it('invents no Day 0 before Foundation starts', () => {
    const list = buildMilestones({
      streak: ready(),
      foundation: foundationStatus('2026-08-01', DEFAULT_FOUNDATION_START),
    })
    const day10 = milestone(list, 'day-10')
    expect(day10.state).toEqual({ status: 'locked', value: null, target: 10 })
    expect(milestoneProgressLabel(day10)).toBe('Foundation not started')
    expect(milestoneProgressLabel(day10)).not.toMatch(/Day 0/)
  })

  it('keeps Foundation days counting through a Holiday', () => {
    // Holiday suspends the routine, never the calendar.
    const holidays = [holiday('h1', '2026-09-01', '2026-09-09')]
    const list = buildMilestones({
      streak: ready({ holidays, today: '2026-09-09' }),
      foundation: foundationStatus('2026-09-09', DEFAULT_FOUNDATION_START),
    })
    expect(milestone(list, 'day-10').state.status).toBe('unlocked')
  })

  it('leaves training milestones unresolved when the streak is not known', () => {
    const list = buildMilestones({
      streak: ready({ holidayStatus: 'error' }),
      foundation: foundationStatus('2026-09-09', DEFAULT_FOUNDATION_START),
    })
    // Not "locked" — locked would be a claim that they have not been reached.
    expect(milestone(list, 'first-session').state.status).toBe('unresolved')
    expect(milestone(list, 'full-week').state.status).toBe('unresolved')
    expect(milestone(list, 'consistency').state.status).toBe('unresolved')
    // The calendar ones are still answerable.
    expect(milestone(list, 'day-10').state.status).toBe('unlocked')
  })

  it('keeps the six accepted slots, in order', () => {
    const list = buildMilestones({
      streak: ready(),
      foundation: foundationStatus('2026-09-09', DEFAULT_FOUNDATION_START),
    })
    expect(list.map((row) => row.id)).toEqual([
      'first-session',
      'full-week',
      'day-10',
      'consistency',
      'day-50',
      'day-100',
    ])
  })
})

/* ------------------------------------------------------------------ */
/* 9. History does not expire                                          */
/* ------------------------------------------------------------------ */

/**
 * Round 12 correction 1 — an achievement must not un-happen.
 *
 * The candidate evaluated only the most recent 366 days, which turned
 * "historical Foundation truth" into a silent rolling year: a run reached
 * early in Foundation would stop counting once it aged out, and Consistency,
 * already earned, would lock itself again purely because time passed.
 *
 * Every test below places the achievement-producing history FAR outside that
 * old rolling window, so any return to clipping fails here.
 */

/** Ten consecutive training days early in Foundation: 7–18 September 2026. */
const OLD_RUN: [string, string][] = [
  ['2026-09-07', 'monday'],
  ['2026-09-08', 'tuesday'],
  ['2026-09-09', 'wednesday'],
  ['2026-09-10', 'thursday'],
  ['2026-09-11', 'friday'],
  // 12th and 13th are the weekend: neutral, and they bridge the run.
  ['2026-09-14', 'monday'],
  ['2026-09-15', 'tuesday'],
  ['2026-09-16', 'wednesday'],
  ['2026-09-17', 'thursday'],
  ['2026-09-18', 'friday'],
]

/** Long after the old run — well past any rolling-year cutoff. */
const MUCH_LATER = '2028-03-17'

function oldRunEntries() {
  return OLD_RUN.map(([date, session]) => finished(date, session))
}

describe('9. an old run still counts, years later', () => {
  it('is genuinely older than the rolling window that used to clip it', () => {
    // Guards the premise of this whole section.
    const age = daysBetween('2026-09-18', MUCH_LATER)
    expect(age).not.toBeNull()
    expect(age as number).toBeGreaterThan(MAX_CHUNK_DAYS)
  })

  it('keeps a ten-day run as the best streak and leaves Consistency unlocked', () => {
    const streak = evaluateStreaks(
      sources({ entries: oldRunEntries(), today: MUCH_LATER, from: evaluationWindow(MUCH_LATER, DEFAULT_FOUNDATION_START).from }),
    )
    expect(streak.status).toBe('ready')
    if (streak.status !== 'ready') return

    expect(streak.facts.best).toBeGreaterThanOrEqual(10)

    const list = buildMilestones({ streak, foundation: foundationStatus(MUCH_LATER, DEFAULT_FOUNDATION_START) })
    expect(milestone(list, 'consistency').state.status).toBe('unlocked')
    expect(milestone(list, 'full-week').state.status).toBe('unlocked')
  })

  it('does not let a weaker recent streak replace the historical best', () => {
    const entries = [
      ...oldRunEntries(),
      // Only two training days at the current end of the timeline.
      finished('2028-03-16', 'thursday'),
      finished('2028-03-17', 'friday'),
    ]
    const streak = evaluateStreaks(sources({ entries, today: MUCH_LATER, from: evaluationWindow(MUCH_LATER, DEFAULT_FOUNDATION_START).from }))
    if (streak.status !== 'ready') throw new Error('expected ready')

    expect(streak.facts.best).toBe(10)
    // The current streak is its own fact and does not overwrite the best.
    expect(streak.facts.current).toBe(2)
  })

  it('still represents an old first session', () => {
    const streak = evaluateStreaks(
      sources({ entries: oldRunEntries(), today: MUCH_LATER, from: evaluationWindow(MUCH_LATER, DEFAULT_FOUNDATION_START).from }),
    )
    if (streak.status !== 'ready') throw new Error('expected ready')

    expect(streak.facts.qualifyingSessions).toBe(10)

    const list = buildMilestones({ streak, foundation: foundationStatus(MUCH_LATER, DEFAULT_FOUNDATION_START) })
    expect(milestone(list, 'first-session').state.status).toBe('unlocked')
  })

  it('does not relock Full week or Consistency as the history ages', () => {
    const entries = oldRunEntries()
    const unlockedAt = (today: string) => {
      const streak = evaluateStreaks(sources({ entries, today, from: evaluationWindow(today, DEFAULT_FOUNDATION_START).from }))
      const list = buildMilestones({ streak, foundation: foundationStatus(today, DEFAULT_FOUNDATION_START) })
      return {
        week: milestone(list, 'full-week').state.status,
        consistency: milestone(list, 'consistency').state.status,
      }
    }

    // The day the run finished…
    const then = unlockedAt('2026-09-18')
    // …and long after it aged past the old cutoff.
    const later = unlockedAt(MUCH_LATER)

    expect(then).toEqual({ week: 'unlocked', consistency: 'unlocked' })
    // Identical. Time passing is not an event that takes an achievement away.
    expect(later).toEqual(then)
  })

  it('reports the current streak from the current end, not from the old run', () => {
    // The old run is long over and nothing recent was trained.
    const streak = evaluateStreaks(
      sources({ entries: oldRunEntries(), today: MUCH_LATER, from: evaluationWindow(MUCH_LATER, DEFAULT_FOUNDATION_START).from }),
    )
    if (streak.status !== 'ready') throw new Error('expected ready')

    expect(streak.facts.current).toBe(0)
    // …while the historical best is untouched by that.
    expect(streak.facts.best).toBe(10)
  })

  it('keeps a weekend and a Holiday inside an old run neutral', () => {
    const entries = [
      finished('2026-09-07', 'monday'),
      finished('2026-09-08', 'tuesday'),
      finished('2026-09-09', 'wednesday'),
      finished('2026-09-10', 'thursday'),
      finished('2026-09-11', 'friday'),
      // Monday the 14th is a Holiday — exempt, so it bridges rather than breaks.
      finished('2026-09-15', 'tuesday'),
      finished('2026-09-16', 'wednesday'),
      finished('2026-09-17', 'thursday'),
      finished('2026-09-18', 'friday'),
    ]
    const holidays = [holiday('h1', '2026-09-14')]
    const streak = evaluateStreaks(
      sources({ entries, holidays, today: MUCH_LATER, from: evaluationWindow(MUCH_LATER, DEFAULT_FOUNDATION_START).from }),
    )
    if (streak.status !== 'ready') throw new Error('expected ready')

    // Nine finished days, bridged by a weekend AND a Holiday.
    expect(streak.facts.best).toBe(9)
  })

  it('still breaks an old run on a real failure inside it', () => {
    const entries = oldRunEntries().filter((row) => row.date !== '2026-09-09')
    const streak = evaluateStreaks(sources({ entries, today: MUCH_LATER, from: evaluationWindow(MUCH_LATER, DEFAULT_FOUNDATION_START).from }))
    if (streak.status !== 'ready') throw new Error('expected ready')

    // Two before the missed Wednesday, seven after it.
    expect(streak.facts.best).toBe(7)
    const list = buildMilestones({ streak, foundation: foundationStatus(MUCH_LATER, DEFAULT_FOUNDATION_START) })
    expect(milestone(list, 'consistency').state.status).toBe('locked')
    expect(milestone(list, 'full-week').state.status).toBe('unlocked')
  })
})

/* ------------------------------------------------------------------ */
/* 10. Round 13 - Holiday training and the streak                      */
/* ------------------------------------------------------------------ */

/**
 * A Holiday no longer means "no training".
 *
 * Training Off stays fully exempt: neutral, neither counted nor broken.
 * Training On makes that weekday a scheduled training day again, judged by
 * exactly the same success rule as any other day.
 *
 * The weekend rule is the fail-safe: a Saturday or Sunday is neutral however
 * the preference was stored, so corrupted or forged data cannot manufacture a
 * missed session out of a rest day.
 *
 * 2026-09-14 is a Monday, 2026-09-15 a Tuesday, 2026-09-12 a Saturday.
 */

/** A Holiday the user chose to keep training on. */
function trainingHoliday(id: string, startDate: string, endDate = startDate) {
  return holiday(id, startDate, endDate, { trainingOn: true })
}

describe('10. Holiday training', () => {
  it('is neutral while training is off', () => {
    const days = [holiday('h1', '2026-09-14')]
    expect(scheduledDayFor('2026-09-14', days)).toEqual({
      kind: 'neutral',
      date: '2026-09-14',
      reason: 'holiday',
    })
  })

  it('becomes that weekday"s scheduled training day when training is on', () => {
    const days = [trainingHoliday('h1', '2026-09-14')]
    expect(scheduledDayFor('2026-09-14', days)).toEqual({
      kind: 'training',
      date: '2026-09-14',
      sessionId: 'monday',
    })
  })

  it('increments the streak when that session is finished', () => {
    const holidays = [trainingHoliday('h1', '2026-09-14')]
    const entries = [finished('2026-09-14', 'monday')]
    const result = facts({ entries, holidays, today: '2026-09-14', from: '2026-09-14' })
    expect(result.current).toBe(1)
    expect(result.best).toBe(1)
  })

  it('breaks the streak when a past Training-On day was missed', () => {
    // Friday finished, then a Training-On Monday with nothing recorded.
    const holidays = [trainingHoliday('h1', '2026-09-14')]
    const entries = [finished('2026-09-11', 'friday')]
    const result = facts({ entries, holidays, today: '2026-09-15', from: '2026-09-11' })
    // The Monday is a real missed training day now, so the run is over.
    expect(result.current).toBe(0)
    expect(result.best).toBe(1)
  })

  it('does not break while a Training-On today is still unfinished', () => {
    const holidays = [trainingHoliday('h1', '2026-09-15')]
    const entries = [finished('2026-09-14', 'monday')]
    expect(
      outcomeFor('2026-09-15', {
        today: '2026-09-15',
        holidays,
        qualifying: buildQualifyingIndex(entries),
      }),
    ).toBe('pending')

    const result = facts({ entries, holidays, today: '2026-09-15', from: '2026-09-14' })
    expect(result.current).toBe(1)
  })

  it('keeps a weekend Holiday neutral even when training is on', () => {
    // The fail-safe. There is no Saturday session to restore, so nothing is
    // scheduled and nothing can be missed.
    const holidays = [trainingHoliday('h1', '2026-09-12')]
    expect(scheduledDayFor('2026-09-12', holidays)).toEqual({
      kind: 'neutral',
      date: '2026-09-12',
      reason: 'holiday',
    })
    const result = facts({ holidays, today: '2026-09-12', from: '2026-09-12' })
    expect(result.current).toBe(0)
    expect(result.best).toBe(0)
  })

  it('keeps weekend days inside a Training-On RANGE neutral', () => {
    // Saturday through Monday with training on: only the Monday is scheduled.
    const holidays = [trainingHoliday('h1', '2026-09-12', '2026-09-14')]
    expect(scheduledDayFor('2026-09-12', holidays)?.kind).toBe('neutral')
    expect(scheduledDayFor('2026-09-13', holidays)?.kind).toBe('neutral')
    expect(scheduledDayFor('2026-09-14', holidays)).toEqual({
      kind: 'training',
      date: '2026-09-14',
      sessionId: 'monday',
    })
  })

  it('is not satisfied by the wrong session', () => {
    const holidays = [trainingHoliday('h1', '2026-09-14')]
    // A finished Friday log on a Training-On Monday is not that day"s session.
    const entries = [finished('2026-09-14', 'friday')]
    expect(
      outcomeFor('2026-09-14', {
        today: '2026-09-15',
        holidays,
        qualifying: buildQualifyingIndex(entries),
      }),
    ).toBe('failure')
  })

  it('is not satisfied by a session that was only skipped', () => {
    const holidays = [trainingHoliday('h1', '2026-09-14')]
    const entries = [entry('2026-09-14', 'monday', { total: 4, completed: 0, skipped: 4 })]
    expect(
      outcomeFor('2026-09-14', {
        today: '2026-09-15',
        holidays,
        qualifying: buildQualifyingIndex(entries),
      }),
    ).toBe('failure')
  })

  it('is not satisfied by a session that is still unfinished', () => {
    const holidays = [trainingHoliday('h1', '2026-09-14')]
    const entries = [entry('2026-09-14', 'monday', { total: 4, completed: 2, skipped: 0 })]
    expect(
      outcomeFor('2026-09-14', {
        today: '2026-09-15',
        holidays,
        qualifying: buildQualifyingIndex(entries),
      }),
    ).toBe('failure')
  })

  it('counts a Training-Off finished session without moving the streak', () => {
    // The accepted asymmetry, restated against Round 13: the work happened,
    // so it counts, but the day itself stays exempt.
    const holidays = [holiday('h1', '2026-09-14')]
    const entries = [finished('2026-09-14', 'monday')]
    const result = facts({ entries, holidays, today: '2026-09-14', from: '2026-09-14' })

    expect(result.qualifyingSessions).toBe(1)
    expect(result.current).toBe(0)
    expect(result.best).toBe(0)
  })

  it('lets Training On make that same session satisfy the day as well', () => {
    const holidays = [trainingHoliday('h1', '2026-09-14')]
    const entries = [finished('2026-09-14', 'monday')]
    const result = facts({ entries, holidays, today: '2026-09-14', from: '2026-09-14' })

    expect(result.qualifyingSessions).toBe(1)
    expect(result.current).toBe(1)
  })

  it('leaves Foundation untouched either way', () => {
    // Holiday never pauses the calendar, and neither choice changes it.
    for (const holidays of [[holiday('h1', '2026-09-09')], [trainingHoliday('h1', '2026-09-09')]]) {
      const streak = evaluateStreaks(
        sources({ holidays, today: '2026-09-09', from: '2026-08-31' }),
      )
      const list = buildMilestones({ streak, foundation: foundationStatus('2026-09-09', DEFAULT_FOUNDATION_START) })
      // 2026-09-09 is Foundation Day 10 whatever the day is called.
      expect(milestone(list, 'day-10').state.status).toBe('unlocked')
    }
  })

  it('reads the session from the one accepted weekday mapping', () => {
    // No second Monday-to-Friday table: a Training-On Holiday resolves to
    // exactly what sessionIdForWeekday says, for every weekday.
    const weekdays = ['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18']
    for (const date of weekdays) {
      const day = scheduledDayFor(date, [trainingHoliday(`h-${date}`, date)])
      const weekday = new Date(
        Number(date.slice(0, 4)),
        Number(date.slice(5, 7)) - 1,
        Number(date.slice(8, 10)),
      ).getDay()
      expect(day, date).toEqual({
        kind: 'training',
        date,
        sessionId: sessionIdForWeekday(weekday),
      })
    }
  })
})
