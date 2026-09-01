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
import { createD1WorkoutStore, UnreadableProvenanceError } from '../workouts/d1Store'
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
      let log
      try {
        log = await readWorkout(createD1WorkoutStore(db), googleSub, date, sessionId)
      } catch (error) {
        // A workout whose provenance cannot be read has NOT been shown to be
        // finished, so it answers "not finished" and the reminder still goes
        // out. Deliberately not the `null` a storage failure returns: null
        // withholds the whole notification, and withholding is the one outcome
        // that costs the user the training day this reminder exists to
        // protect. A storage failure still returns null, below.
        if (error instanceof UnreadableProvenanceError) return false
        return null
      }

      try {
        // Never started is a real answer: not finished.
        if (!log) return false

        // Round 17: only the SCHEDULED workout can answer for the scheduled
        // reminder. The sweep asks about the weekday's own session id, which an
        // Extra never occupies, so this cannot currently be reached — it is
        // stated anyway, because "did the user finish the thing we are about to
        // remind them about" must never be satisfiable by voluntary extra work.
        // Suppressing a real reminder is the failure that costs a training day.
        if (log.occurrence.kind !== 'scheduled') return false

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
