import { useMemo } from 'react'

import { foundationStatus } from '@/features/progress/foundation'
import { useLocalToday } from '@/features/progress/useLocalToday'
import { useFoundationStart } from '@/features/settings/FoundationStartContext'

import { buildMilestones, type Milestone } from './model/milestones'
import { evaluateStreaks, type StreakEvaluation } from './model/streak'
import { evaluationChunks, evaluationWindow, type DateRange } from './model/window'
import {
  useHolidayChunks,
  useTrainingFlexChunks,
  useWorkoutChunks,
} from './useEvaluationSources'

/**
 * Everything the Achievements page needs, derived from existing facts.
 *
 * Nothing is persisted and nothing is written. Two sources are read across the
 * WHOLE of recorded training history — recorded workouts, and Holiday records
 * over the same days — because a streak needs both to tell a rest day from a
 * missed one, and because an achievement already earned must not expire.
 *
 * The period is read in adjacent bounded chunks. Every chunk must succeed and
 * report itself complete before any number is stated.
 *
 * TWO INDEPENDENT AUTHORITIES, deliberately kept apart (Round 18 Correction 1):
 *
 *   training evidence → the fixed history epoch. Not editable by anyone, so
 *                       streaks and training milestones cannot be moved by a
 *                       settings change.
 *   Foundation days   → the account's chosen start date. It numbers days and
 *                       the Day 10/50/100 milestones, and nothing else.
 *
 * Because they are separate, an unreadable start date leaves the training
 * milestones fully answerable — only the Foundation ones withhold.
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
  /** The shared Foundation start contract, so the page can show its states. */
  foundationStart: ReturnType<typeof useFoundationStart>
}

export function useAchievements(): AchievementsView {
  // Round 18: the local date, kept current. It changes at most once a day —
  // `useLocalToday` fires on the next local midnight and on visibility/focus
  // recovery, never on a clock tick — so this does not refetch behind the user,
  // and at midnight the evaluation period genuinely should extend to the new
  // day rather than silently stopping at yesterday.
  const today = useLocalToday()

  // The one shared start date. Used ONLY for Foundation day numbering below;
  // never for the evaluation window.
  const foundationStart = useFoundationStart()

  // Round 18 Correction 1: the evaluation window is derived from TODAY and the
  // fixed history epoch alone. `foundationStart` is deliberately NOT an input —
  // it numbers Foundation days below, and it decides nothing about which
  // workouts count as evidence.
  const window = useMemo(() => evaluationWindow(today), [today])
  const chunks = useMemo(() => evaluationChunks(window), [window])

  const workouts = useWorkoutChunks(chunks)
  const holidays = useHolidayChunks(chunks)
  // Explicit training choices over the same period. A day resolved as Recovery
  // or Fitness Boxing is neutral — it neither extends nor breaks a streak —
  // and this is where that truth reaches the evaluation.
  const flex = useTrainingFlexChunks(chunks)

  const streak = useMemo(
    () =>
      evaluateStreaks({
        today,
        from: window.from,
        holidayStatus: holidays.status,
        holidays: holidays.holidays,
        flexStatus: flex.status,
        flex: flex.flex,
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
      flex.status,
      flex.flex,
      workouts.status,
      workouts.entries,
      workouts.complete,
    ],
  )

  // Foundation is a pure local-calendar fact, so it stays answerable even when
  // the streak is not — Holiday never pauses it.
  const foundation = useMemo(
    // Withheld until the account's start date is known: a day number derived
    // from a guessed start would look authoritative and be wrong.
    () =>
      foundationStart.status === 'ready'
        ? foundationStatus(today, foundationStart.startDate)
        : null,
    [today, foundationStart.status, foundationStart.startDate],
  )

  const milestones = useMemo(
    () => buildMilestones({ streak, foundation }),
    [streak, foundation],
  )

  const reload = useMemo(
    () => () => {
      workouts.reload()
      holidays.reload()
      flex.reload()
    },
    [workouts, holidays, flex],
  )

  return { today, window, chunks, streak, milestones, reload, foundationStart }
}
