import { useMemo, useState } from 'react'

import { foundationStatus } from '@/features/progress/foundation'
import { localWorkoutDate } from '@/features/training/workoutPlan'

import { buildMilestones, type Milestone } from './model/milestones'
import { evaluateStreaks, type StreakEvaluation } from './model/streak'
import { evaluationChunks, evaluationWindow, type DateRange } from './model/window'
import { useHolidayChunks, useWorkoutChunks } from './useEvaluationSources'

/**
 * Everything the Achievements page needs, derived from existing facts.
 *
 * Nothing is persisted and nothing is written. Two sources are read across the
 * WHOLE Foundation period — recorded workouts, and Holiday records over the
 * same days — because a streak needs both to tell a rest day from a missed
 * one, and because an achievement already earned must not expire.
 *
 * The period is read in adjacent bounded chunks. Every chunk must succeed and
 * report itself complete before any number is stated.
 */

export type AchievementsView = {
  /** Today's local calendar date. */
  today: string
  /** The full inclusive period being evaluated: Foundation Day 1 → today. */
  window: DateRange
  /** How that period was actually requested. */
  chunks: DateRange[]
  streak: StreakEvaluation
  milestones: Milestone[]
  reload: () => void
}

export function useAchievements(): AchievementsView {
  // Pinned once, like Calendar and Progress: the page must not re-derive its
  // period on every clock tick and refetch behind the user.
  const [today] = useState(() => localWorkoutDate())

  const window = useMemo(() => evaluationWindow(today), [today])
  const chunks = useMemo(() => evaluationChunks(window), [window])

  const workouts = useWorkoutChunks(chunks)
  const holidays = useHolidayChunks(chunks)

  const streak = useMemo(
    () =>
      evaluateStreaks({
        today,
        from: window.from,
        holidayStatus: holidays.status,
        holidays: holidays.holidays,
        historyStatus: workouts.status,
        entries: workouts.entries,
        // Complete only when every chunk covered its own span. Anything less
        // and an absent workout proves nothing.
        coverage: workouts.complete ? 'complete' : 'partial',
      }),
    [
      today,
      window.from,
      holidays.status,
      holidays.holidays,
      workouts.status,
      workouts.entries,
      workouts.complete,
    ],
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
      workouts.reload()
      holidays.reload()
    },
    [workouts, holidays],
  )

  return { today, window, chunks, streak, milestones, reload }
}
