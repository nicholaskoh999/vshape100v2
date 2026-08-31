/**
 * The reads a scheduled sweep needs, wired to the accepted stores.
 *
 * Nothing here decides anything. It fetches the same Holiday records the
 * Calendar reads, the same completions Today reads and the same workout the
 * training page reads, and converts each into the shape the sweep expects —
 * with one rule applied throughout: a read that fails returns null, never an
 * empty value.
 *
 * That distinction is the whole point. "No holidays" and "nothing completed"
 * are ANSWERS; a failed read has not earned the right to give them, because
 * either one would turn into a reminder for a day that was taken off, or for
 * work that was already finished.
 */

import { createD1HolidayStore } from '../holiday/d1Store'
import { listHolidays } from '../holiday/holiday'
import { createD1CompletionStore } from '../today/d1Store'
import { listCompletions } from '../today/completions'
import { createD1WorkoutStore } from '../workouts/d1Store'
import { readWorkout } from '../workouts/workouts'
import { isFullyResolved, summariseSets } from '../../shared/workoutLog'
import { holidayDaysOf } from '../../shared/today/holidayDays'
import type { ScheduleTruth } from './scheduler'

export function createD1ScheduleTruth(db: D1Database): ScheduleTruth {
  return {
    async holidaysFor(googleSub, from, to) {
      try {
        const records = await listHolidays(createD1HolidayStore(db), googleSub, from, to)
        // The same expansion the Calendar and Today use.
        return holidayDaysOf(records, { from, to })
      } catch {
        return null
      }
    },

    async completionsFor(googleSub, from, to) {
      try {
        const rows = await listCompletions(createD1CompletionStore(db), googleSub, {
          from,
          to,
        })
        // The occurrence key IS the identity Today uses, so a completion made
        // on the page suppresses the reminder for the same occurrence.
        return new Set(rows.map((row) => row.occurrenceKey))
      } catch {
        return null
      }
    },

    async workoutFinished(googleSub, date, sessionId) {
      try {
        const log = await readWorkout(createD1WorkoutStore(db), googleSub, date, sessionId)
        // Never started is a real answer: not finished.
        if (!log) return false

        const progress = summariseSets(log.sets)
        // Exactly the accepted rule. `resolved` counts skips, so a workout
        // whose every set was skipped is traversed and was NOT trained, and
        // must not suppress the reminder.
        return isFullyResolved(progress) && progress.completed > 0
      } catch {
        return null
      }
    },
  }
}
