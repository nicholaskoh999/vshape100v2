import { describe, expect, it } from 'vitest'

import { evaluationWindow } from '@/features/achievements/model/window'
import {
  bestStreak,
  countQualifyingSessions,
  currentStreak,
  evaluateStreaks,
  outcomeFor,
  type StreakSources,
} from '@/features/achievements/model/streak'
import { TRAINING_HISTORY_EPOCH } from '@shared/trainingHistory'
import type { WorkoutHistoryEntry } from '@shared/workoutLog'

/**
 * ROUND 25 — WHAT THE EMPTY DAYS BEFORE THE NEW DAY 1 ARE ALLOWED TO MEAN.
 *
 * The controller asked, correctly, whether `TRAINING_HISTORY_EPOCH` should move
 * with a Fresh Start — and asked for proof rather than an opinion.
 *
 * THE SHAPE OF THE WORRY. After a full reset the account has no rows at all,
 * and the new Foundation Day 1 sits weeks after the epoch. The Achievements
 * window still opens at the epoch (`evaluationWindow` takes no argument at all,
 * deliberately, since Round 18 Correction 1 — an editable preference must never
 * decide which workouts count as evidence). So the model evaluates a stretch of
 * scheduled weekdays that contain nothing. `outcomeFor` calls each of those a
 * `failure`. If a failure were counted anywhere — a missed-day tally, a
 * consistency ratio, a penalty — a reset would hand the user a wall of misses
 * they could not possibly have avoided.
 *
 * THE ANSWER, PROVEN BELOW. A failure is only ever used to STOP or RESET a run.
 * Nothing counts failures, nothing subtracts them, and no surface tallies missed
 * days: `Consistency` reads `best`, the milestones read `best`, `current` and
 * `qualifyingSessions`, and `qualifyingSessions` is counted from the logs
 * themselves. So the empty pre-Day-1 stretch produces exactly the same numbers
 * as a window that had started at Day 1 — which is what makes moving the epoch
 * unnecessary rather than merely undesirable.
 *
 * These tests are the evidence for leaving `TRAINING_HISTORY_EPOCH` alone, and
 * they are written so that they FAIL if some future surface starts counting
 * failures. That is the point: the constant stays because the behaviour is
 * proven, and the proof is now permanent.
 */

/* ------------------------------------------------------------------ */
/* A post-reset world                                                  */
/* ------------------------------------------------------------------ */

/** The new Foundation Day 1: a Monday, five weeks after the epoch. */
const NEW_DAY_1 = '2026-10-05'
/** Friday of the first new week — four scheduled days done, today is the fifth. */
const TODAY = '2026-10-09'

const WEEKDAY_SESSIONS: Record<string, string> = {
  '2026-10-05': 'monday',
  '2026-10-06': 'tuesday',
  '2026-10-07': 'wednesday',
  '2026-10-08': 'thursday',
  '2026-10-09': 'friday',
}

/** A finished scheduled workout, the only thing that qualifies for a streak. */
function finished(date: string): WorkoutHistoryEntry {
  return {
    date,
    sessionId: WEEKDAY_SESSIONS[date],
    kind: 'scheduled',
    sourceSessionId: null,
    day: 'Day',
    focus: 'Focus',
    intensity: 'HARD',
    startedAt: 1,
    updatedAt: 2,
    progress: { total: 4, completed: 4, skipped: 0, resolved: 4 },
  }
}

/**
 * Sources as they look after a reset: every read healthy and complete, no
 * holidays, no flex choices, and only whatever training happened since Day 1.
 */
function sources(entries: readonly WorkoutHistoryEntry[], from: string): StreakSources {
  return {
    today: TODAY,
    from,
    holidayStatus: 'ready',
    holidays: [],
    flexStatus: 'ready',
    flex: new Map(),
    historyStatus: 'ready',
    entries,
    coverage: 'complete',
  }
}

const window = (from: string, entries: readonly WorkoutHistoryEntry[]) => ({
  from,
  today: TODAY,
  holidays: [] as const,
  flex: new Map(),
  qualifying: new Set(entries.map((e) => `${e.date}|${e.sessionId}`)),
})

/* ------------------------------------------------------------------ */

describe('Round 25 — the empty days before the new Day 1 create no false truth', () => {
  it('the evaluation window really does still open at the epoch, not at Day 1', () => {
    // Stated first, because everything below is only interesting if this holds.
    expect(evaluationWindow(TODAY)).toEqual({ from: TRAINING_HISTORY_EPOCH, to: TODAY })
    expect(TRAINING_HISTORY_EPOCH < NEW_DAY_1).toBe(true)
  })

  it('calls every empty pre-Day-1 weekday a failure — the raw material of the worry', () => {
    const context = { today: TODAY, holidays: [], flex: new Map(), qualifying: new Set<string>() }
    // A Monday well before the new Day 1, with nothing recorded.
    expect(outcomeFor('2026-09-07', context)).toBe('failure')
    // ...and a Saturday is neutral, so the gap is not uniformly hostile.
    expect(outcomeFor('2026-09-12', context)).toBe('neutral')
  })

  it('NO STREAK PENALTY: the current streak is identical whether the window opens at the epoch or at Day 1', () => {
    const entries = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08'].map(finished)

    const fromEpoch = currentStreak(window(TRAINING_HISTORY_EPOCH, entries))
    const fromDay1 = currentStreak(window(NEW_DAY_1, entries))

    expect(fromEpoch).toBe(4)
    expect(fromEpoch).toBe(fromDay1)
  })

  it('NO STREAK PENALTY: the best streak is identical too', () => {
    const entries = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08'].map(finished)

    expect(bestStreak(window(TRAINING_HISTORY_EPOCH, entries))).toBe(4)
    expect(bestStreak(window(TRAINING_HISTORY_EPOCH, entries))).toBe(
      bestStreak(window(NEW_DAY_1, entries)),
    )
  })

  it('NO ACHIEVEMENT PROGRESS: an account with nothing recorded scores zero on every fact', () => {
    const evaluation = evaluateStreaks(sources([], TRAINING_HISTORY_EPOCH))
    expect(evaluation.status).toBe('ready')
    if (evaluation.status !== 'ready') return
    // Not negative, not penalised — simply nothing yet.
    expect(evaluation.facts).toEqual({ current: 0, best: 0, qualifyingSessions: 0 })
  })

  it('NO FALSE EVIDENCE: qualifying sessions are counted from the logs, so an empty log counts nothing', () => {
    expect(countQualifyingSessions([])).toBe(0)
    // And the pre-Day-1 stretch cannot contribute, because there is nothing in it.
    expect(countQualifyingSessions(['2026-10-05', '2026-10-06'].map(finished))).toBe(2)
  })

  it('a failure only STOPS a run — it is never counted, subtracted or tallied', () => {
    /*
     * The load-bearing property. Two worlds that differ ONLY in how many empty
     * scheduled weekdays sit before the first real training day must produce
     * identical facts. If any surface ever starts counting failures, this test
     * is the one that breaks.
     */
    const entries = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08'].map(finished)

    const wideOpen = evaluateStreaks(sources(entries, TRAINING_HISTORY_EPOCH))
    const fromDay1 = evaluateStreaks(sources(entries, NEW_DAY_1))
    // One day before Day 1 — a single empty weekday's worth of difference.
    const oneDayEarlier = evaluateStreaks(sources(entries, '2026-10-02'))

    expect(wideOpen).toEqual(fromDay1)
    expect(wideOpen).toEqual(oneDayEarlier)
    if (wideOpen.status !== 'ready') throw new Error('expected ready')
    expect(wideOpen.facts).toEqual({ current: 4, best: 4, qualifyingSessions: 4 })
  })

  it('today still counts as pending rather than missed, so an unfinished Day 5 erases nothing', () => {
    const entries = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08'].map(finished)
    const context = { today: TODAY, holidays: [], flex: new Map(), qualifying: new Set(entries.map((e) => `${e.date}|${e.sessionId}`)) }
    expect(outcomeFor(TODAY, context)).toBe('pending')
    expect(currentStreak(window(TRAINING_HISTORY_EPOCH, entries))).toBe(4)
  })

  it('training recorded on the new Day 1 itself counts — the boundary is not exclusive', () => {
    const entries = [finished(NEW_DAY_1)]
    const evaluation = evaluateStreaks(sources(entries, TRAINING_HISTORY_EPOCH))
    if (evaluation.status !== 'ready') throw new Error('expected ready')
    expect(evaluation.facts.qualifyingSessions).toBe(1)
    expect(evaluation.facts.best).toBe(1)
  })

  it('a reset does not make the model refuse to answer — the sources are simply empty', () => {
    // An empty log is a complete answer, not a failed read. Refusing here would
    // leave the user staring at "could not be loaded" on a fresh account.
    const evaluation = evaluateStreaks(sources([], NEW_DAY_1))
    expect(evaluation.status).toBe('ready')
  })
})

/**
 * CONCLUSION, recorded here so the next reader does not have to re-derive it:
 *
 * `TRAINING_HISTORY_EPOCH` does NOT need to move with a Fresh Start. The empty
 * stretch it opens on produces failures, and failures only stop or reset runs —
 * they are never counted. Every fact the Achievements surface states is
 * identical whether the window opens at the epoch or at the new Day 1.
 *
 * NO SOURCE CORRECTION IS PROPOSED BY ROUND 25 on this point. Moving the
 * constant would be an aesthetic change to a value whose comment says plainly
 * that it is "a statement about what the DATABASE can contain, not about what
 * any user prefers" — and it would reintroduce exactly the coupling Round 18
 * Correction 1 removed.
 */
