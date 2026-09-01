import { describe, expect, it } from 'vitest'

import { buildMilestones, type Milestone } from '@/features/achievements/model/milestones'
import { evaluateStreaks, type StreakSources } from '@/features/achievements/model/streak'
import { evaluationWindow } from '@/features/achievements/model/window'
import { foundationStatus } from '@/features/progress/foundation'
import type { WorkoutHistoryEntry } from '@shared/workoutLog'
import { TRAINING_HISTORY_EPOCH } from '@shared/trainingHistory'

/**
 * Round 18 Correction 1 — the Foundation Start Date is not training authority.
 *
 * THE BUG THIS DEFENDS AGAINST.
 *
 * Achievements evaluated training evidence over a window that began at the
 * account's chosen Foundation Day 1. The window decides which workouts are
 * fetched and judged at all, so moving Day 1 forward silently DELETED evidence:
 * completed scheduled sessions before the new start stopped counting, and
 * `Sessions finished`, `First Session`, `Full Week`, `Consistency` and both
 * streaks changed because a display preference changed.
 *
 * The seeded history below sits BEFORE the later of the two start dates and
 * inside valid application history, which is precisely the case the old code got
 * wrong. Under the old behaviour these assertions fail loudly: the later start
 * would see four sessions instead of ten.
 */

/* 2026-08-31 is a Monday. Two unbroken training weeks, weekend between. */
const WEEK_ONE = [
  ['2026-08-31', 'monday'],
  ['2026-09-01', 'tuesday'],
  ['2026-09-02', 'wednesday'],
  ['2026-09-03', 'thursday'],
  ['2026-09-04', 'friday'],
] as const
const WEEK_TWO = [
  ['2026-09-07', 'monday'],
  ['2026-09-08', 'tuesday'],
  ['2026-09-09', 'wednesday'],
  ['2026-09-10', 'thursday'],
  ['2026-09-11', 'friday'],
] as const

const TODAY = '2026-09-11'

/** The two start dates the correction names. The second is mid-history. */
const EARLIER_START = '2026-09-01'
const LATER_START = '2026-09-08'

function finished([date, sessionId]: readonly [string, string]): WorkoutHistoryEntry {
  return {
    date,
    sessionId,
    kind: 'scheduled',
    sourceSessionId: null,
    day: 'Day',
    focus: 'Focus',
    intensity: 'HARD',
    startedAt: 1,
    updatedAt: 2,
    progress: { total: 4, completed: 4, skipped: 0, resolved: 4 },
  } as WorkoutHistoryEntry
}

const HISTORY = [...WEEK_ONE, ...WEEK_TWO].map(finished)

/**
 * The Achievements pipeline exactly as `useAchievements` composes it: the
 * window from today alone, the streak from that window, the milestones from the
 * streak plus a Foundation status built from the account's start date.
 */
function evaluateWith(startDate: string) {
  const window = evaluationWindow(TODAY)
  const sources: StreakSources = {
    today: TODAY,
    from: window.from,
    holidayStatus: 'ready',
    holidays: [],
    historyStatus: 'ready',
    entries: HISTORY,
    coverage: 'complete',
  }
  const streak = evaluateStreaks(sources)
  const milestones = buildMilestones({
    streak,
    foundation: foundationStatus(TODAY, startDate),
  })
  return { window, streak, milestones }
}

function milestone(milestones: Milestone[], id: string) {
  const found = milestones.find((m) => m.id === id)
  if (!found) throw new Error(`no milestone ${id}`)
  return found
}

describe('a completed session before the chosen start date still counts', () => {
  const earlier = evaluateWith(EARLIER_START)
  const later = evaluateWith(LATER_START)

  it('reads the same window whichever start date is in force', () => {
    // The window is the thing that used to move. It is now anchored to the
    // epoch and takes no start date at all.
    expect(earlier.window).toEqual({ from: TRAINING_HISTORY_EPOCH, to: TODAY })
    expect(later.window).toEqual(earlier.window)
  })

  it('sees the sessions that predate the later start date', () => {
    // Guards the test itself: if the fixture stopped covering history before
    // 2026-09-08 the comparison below would pass without proving anything.
    const beforeLaterStart = HISTORY.filter((entry) => entry.date < LATER_START)
    expect(beforeLaterStart.length).toBe(6)
    expect(beforeLaterStart.some((entry) => entry.date < EARLIER_START)).toBe(true)
  })

  it('does not change any training fact when the start date moves', () => {
    if (earlier.streak.status !== 'ready' || later.streak.status !== 'ready') {
      throw new Error('expected both evaluations to be ready')
    }

    // Ten unbroken training days across two weeks; the weekend is neutral.
    expect(earlier.streak.facts.qualifyingSessions).toBe(10)
    expect(earlier.streak.facts.current).toBe(10)
    expect(earlier.streak.facts.best).toBe(10)

    // The whole point: identical under both start dates.
    expect(later.streak.facts).toEqual(earlier.streak.facts)
  })

  it.each(['first-session', 'full-week', 'consistency'])(
    'leaves the %s milestone untouched',
    (id) => {
      expect(milestone(later.milestones, id).state).toEqual(
        milestone(earlier.milestones, id).state,
      )
      // And each is genuinely unlocked, so this is not comparing two blanks.
      expect(milestone(earlier.milestones, id).state.status).toBe('unlocked')
    },
  )

  it('positive control: the old start-date-anchored window DID change the facts', () => {
    // This reconstructs the removed behaviour rather than asserting the current
    // one. Without it, the equality assertions above could pass simply because
    // the fixture happened to hold no history before the later start date — the
    // exact way a regression test quietly stops testing anything.
    const asIfAnchoredTo = (startDate: string) =>
      evaluateStreaks({
        today: TODAY,
        from: startDate,
        holidayStatus: 'ready',
        holidays: [],
        historyStatus: 'ready',
        entries: HISTORY,
        coverage: 'complete',
      })

    const oldEarlier = asIfAnchoredTo(EARLIER_START)
    const oldLater = asIfAnchoredTo(LATER_START)
    if (oldEarlier.status !== 'ready' || oldLater.status !== 'ready') {
      throw new Error('expected both control evaluations to be ready')
    }

    // Under the old window the later start lost six days of real training:
    // the streak collapsed from ten to four and Consistency would have relocked.
    expect(oldEarlier.facts.best).toBe(9)
    expect(oldLater.facts.best).toBe(4)
    expect(oldLater.facts).not.toEqual(oldEarlier.facts)
  })

  it('still moves the Foundation day milestones, which the start date does own', () => {
    // The other half of the contract: the setting must keep working for the
    // one thing it is for. Day 11 under the earlier start, Day 4 under the later.
    expect(foundationStatus(TODAY, EARLIER_START)!.day).toBe(11)
    expect(foundationStatus(TODAY, LATER_START)!.day).toBe(4)

    expect(milestone(earlier.milestones, 'day-10').state).toEqual({ status: 'unlocked' })
    expect(milestone(later.milestones, 'day-10').state).toEqual({
      status: 'locked',
      value: 4,
      target: 10,
    })

    for (const id of ['day-50', 'day-100']) {
      expect(milestone(earlier.milestones, id).state).not.toEqual(
        milestone(later.milestones, id).state,
      )
    }
  })
})
