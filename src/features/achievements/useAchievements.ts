import { useMemo, useState } from 'react'

import { useHolidays } from '@/features/calendar/useHolidays'
import { foundationStatus, FOUNDATION_START } from '@/features/progress/foundation'
import { useWorkoutHistoryRange } from '@/features/progress/useWorkoutHistory'
import { localWorkoutDate } from '@/features/training/workoutPlan'
import { addLocalDays } from '@shared/localDate'
import { MAX_HISTORY_RANGE_DAYS } from '@shared/workoutLog'

import { buildMilestones, type Milestone } from './model/milestones'
import { evaluateStreaks, type StreakEvaluation } from './model/streak'

/**
 * Everything the Achievements page needs, derived from existing facts.
 *
 * Nothing is persisted and nothing is written. Two reads happen — recorded
 * workouts across the window, and Holiday records across the SAME window —
 * because a streak needs both to tell a rest day from a missed one.
 */

export type AchievementsView = {
  /** Today's local calendar date. */
  today: string
  /** The inclusive window both reads cover. */
  window: { from: string; to: string }
  streak: StreakEvaluation
  milestones: Milestone[]
  reload: () => void
}

/**
 * The window a streak may be evaluated over.
 *
 * Starts at Foundation Day 1 and ends today. Both source reads are bounded, so
 * a window longer than the bound is clipped to the most recent allowed span
 * rather than being requested and refused — and a clipped window can only ever
 * shorten what is claimed, never invent history.
 *
 * Before Foundation begins there is nothing behind today to evaluate, so the
 * window collapses to today alone rather than running backwards.
 */
export function evaluationWindow(today: string): { from: string; to: string } {
  if (FOUNDATION_START > today) return { from: today, to: today }

  const earliest = addLocalDays(today, -(MAX_HISTORY_RANGE_DAYS - 1))
  const from = earliest !== null && earliest > FOUNDATION_START ? earliest : FOUNDATION_START
  return { from, to: today }
}

export function useAchievements(): AchievementsView {
  // Pinned once, like Calendar and Progress: the page must not re-derive its
  // window on every clock tick and refetch behind the user.
  const [today] = useState(() => localWorkoutDate())

  const window = useMemo(() => evaluationWindow(today), [today])

  const history = useWorkoutHistoryRange(window)
  const holidays = useHolidays(window)

  const streak = useMemo(
    () =>
      evaluateStreaks({
        today,
        from: window.from,
        holidayStatus: holidays.status,
        holidays: holidays.holidays,
        historyStatus: history.status,
        entries: history.history?.workouts ?? [],
        // No response yet means coverage is unknown, which is not "complete".
        coverage:
          history.history === null
            ? 'unknown'
            : history.history.complete
              ? 'complete'
              : 'partial',
      }),
    [today, window.from, holidays.status, holidays.holidays, history.status, history.history],
  )

  // Foundation is a pure local-calendar fact, so it stays answerable even when
  // the streak is not — Holiday never pauses it.
  const foundation = useMemo(() => foundationStatus(today), [today])

  const milestones = useMemo(
    () => buildMilestones({ streak, foundation }),
    [streak, foundation],
  )

  const reload = useMemo(
    () => () => {
      history.reload()
      holidays.reload()
    },
    [history, holidays],
  )

  return { today, window, streak, milestones, reload }
}
