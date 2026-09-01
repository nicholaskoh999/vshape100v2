import { useCallback, useEffect, useMemo, useState } from 'react'

import { fetchHolidays, type HolidayRecord } from '@/features/calendar/holidayApi'
import { fetchWorkoutHistory } from '@/features/progress/historyApi'
import { fetchTrainingFlex } from '@/features/today/trainingFlexApi'
import type { WorkoutHistoryEntry } from '@shared/workoutLog'
import type { TrainingFlexKind } from '@shared/trainingFlex'

import type { DateRange } from './model/window'

/**
 * The two source reads behind Achievements, taken in bounded chunks.
 *
 * Each chunk is a separate request inside the per-request span limit, and the
 * chunks tile the whole Foundation period. Composing them is what lets the
 * evaluation see every day since Day 1 without any single request being
 * unbounded.
 *
 * Every chunk must succeed before anything definitive is reported:
 *
 *   any chunk still in flight → loading
 *   any chunk failed         → error
 *   any workout chunk that did not cover its own span → not complete
 *
 * Partial success is treated as no answer at all. A chunk that failed would
 * otherwise contribute zero workouts, and zero workouts across a stretch of
 * weekdays reads exactly like a stretch of missed training.
 */

export type SourceStatus = 'loading' | 'ready' | 'error'

export type WorkoutChunkState = {
  status: SourceStatus
  entries: WorkoutHistoryEntry[]
  /** True only when EVERY chunk reported that it covered its own span. */
  complete: boolean
  reload: () => void
}

export type TrainingFlexChunkState = {
  status: SourceStatus
  /** Every explicit choice in the period, by local date. */
  flex: ReadonlyMap<string, TrainingFlexKind>
  reload: () => void
}

export type HolidayChunkState = {
  status: SourceStatus
  holidays: HolidayRecord[]
  reload: () => void
}

const NO_ENTRIES: WorkoutHistoryEntry[] = []
const NO_HOLIDAYS: HolidayRecord[] = []

/** Ranges as a stable key, so identity churn cannot drive a refetch loop. */
function keyOf(ranges: readonly DateRange[]): string {
  return ranges.map((range) => `${range.from}..${range.to}`).join(',')
}

type Attempt = { key: string; ranges: DateRange[] }

/** One attempt per distinct set of ranges, re-keyed by an explicit retry. */
function useAttempt(ranges: readonly DateRange[]): { attempt: Attempt; reload: () => void } {
  const [retries, setRetries] = useState(0)
  const key = keyOf(ranges)

  const attempt = useMemo(
    // Rebuilt from the key, so the caller may hand a fresh array every render.
    () => ({
      key: `${key}#${retries}`,
      ranges: key === '' ? [] : key.split(',').map((part) => {
        const [from, to] = part.split('..')
        return { from, to }
      }),
    }),
    [key, retries],
  )

  const reload = useCallback(() => setRetries((n) => n + 1), [])
  return { attempt, reload }
}

/* ------------------------------------------------------------------ */
/* Workouts                                                            */
/* ------------------------------------------------------------------ */

type LoadedWorkouts = { key: string; entries: WorkoutHistoryEntry[]; complete: boolean }

export function useWorkoutChunks(ranges: readonly DateRange[]): WorkoutChunkState {
  const { attempt, reload } = useAttempt(ranges)
  const [loaded, setLoaded] = useState<LoadedWorkouts | null>(null)
  const [failedKey, setFailedKey] = useState<string | null>(null)

  const matched = loaded?.key === attempt.key
  const empty = attempt.ranges.length === 0

  const status: SourceStatus = empty
    ? 'ready'
    : matched
      ? 'ready'
      : failedKey === attempt.key
        ? 'error'
        : 'loading'

  useEffect(() => {
    if (attempt.ranges.length === 0) return

    const controller = new AbortController()
    let active = true

    Promise.all(
      attempt.ranges.map((range) =>
        fetchWorkoutHistory({ from: range.from, to: range.to }, controller.signal),
      ),
    )
      .then((results) => {
        if (!active) return

        // Adjacent chunks never overlap, so this cannot drop a real workout —
        // it is a guard against a duplicate being counted as a second session.
        const seen = new Set<string>()
        const entries: WorkoutHistoryEntry[] = []
        for (const result of results) {
          for (const entry of result.workouts) {
            const id = `${entry.date}|${entry.sessionId}`
            if (seen.has(id)) continue
            seen.add(id)
            entries.push(entry)
          }
        }

        setLoaded({
          key: attempt.key,
          entries,
          // One chunk that could not cover its own span makes the whole
          // composed history unprovable.
          complete: results.every((result) => result.complete),
        })
      })
      .catch((error: unknown) => {
        if (!active || controller.signal.aborted) return
        console.error('Workout history could not be loaded', error)
        setFailedKey(attempt.key)
      })

    return () => {
      active = false
      controller.abort()
    }
  }, [attempt])

  return {
    status,
    entries: matched ? (loaded as LoadedWorkouts).entries : NO_ENTRIES,
    complete: matched ? (loaded as LoadedWorkouts).complete : empty,
    reload,
  }
}

/* ------------------------------------------------------------------ */
/* Holidays                                                            */
/* ------------------------------------------------------------------ */

type LoadedHolidays = { key: string; holidays: HolidayRecord[] }

export function useHolidayChunks(ranges: readonly DateRange[]): HolidayChunkState {
  const { attempt, reload } = useAttempt(ranges)
  const [loaded, setLoaded] = useState<LoadedHolidays | null>(null)
  const [failedKey, setFailedKey] = useState<string | null>(null)

  const matched = loaded?.key === attempt.key
  const empty = attempt.ranges.length === 0

  const status: SourceStatus = empty
    ? 'ready'
    : matched
      ? 'ready'
      : failedKey === attempt.key
        ? 'error'
        : 'loading'

  useEffect(() => {
    if (attempt.ranges.length === 0) return

    const controller = new AbortController()
    let active = true

    Promise.all(
      attempt.ranges.map((range) => fetchHolidays(range, controller.signal)),
    )
      .then((results) => {
        if (!active) return

        // A Holiday spanning a chunk boundary is returned by BOTH chunks that
        // it intersects, because each read reports every record touching its
        // span. De-duplicating by id keeps one record with its FULL range, so
        // the days it covers are unchanged by where the boundary happened to
        // fall.
        const byId = new Map<string, HolidayRecord>()
        for (const result of results) {
          for (const record of result) {
            if (!byId.has(record.id)) byId.set(record.id, record)
          }
        }

        setLoaded({ key: attempt.key, holidays: [...byId.values()] })
      })
      .catch((error: unknown) => {
        if (!active || controller.signal.aborted) return
        // Never fall back to "no holidays": that would put the routine's
        // pressure back on a day the user planned to be exempt.
        console.error('Holidays could not be loaded', error)
        setFailedKey(attempt.key)
      })

    return () => {
      active = false
      controller.abort()
    }
  }, [attempt])

  return {
    status,
    holidays: matched ? (loaded as LoadedHolidays).holidays : NO_HOLIDAYS,
    reload,
  }
}

const NO_FLEX: ReadonlyMap<string, TrainingFlexKind> = new Map()

type LoadedFlex = { key: string; flex: ReadonlyMap<string, TrainingFlexKind> }

/**
 * The explicit training choices across the period, in the same bounded chunks.
 *
 * Read exactly like Holiday, and withheld exactly like Holiday: a failed read
 * must never collapse to "no days were flexed", because a day the user
 * deliberately resolved as Recovery would then read as a missed session and
 * invent a broken streak.
 */
export function useTrainingFlexChunks(
  ranges: readonly DateRange[],
): TrainingFlexChunkState {
  const { attempt, reload } = useAttempt(ranges)
  const [loaded, setLoaded] = useState<LoadedFlex | null>(null)
  const [failedKey, setFailedKey] = useState<string | null>(null)

  const matched = loaded?.key === attempt.key
  const empty = attempt.ranges.length === 0

  const status: SourceStatus = empty
    ? 'ready'
    : matched
      ? 'ready'
      : failedKey === attempt.key
        ? 'error'
        : 'loading'

  useEffect(() => {
    if (attempt.ranges.length === 0) return

    const controller = new AbortController()
    let active = true

    Promise.all(
      attempt.ranges.map((range) =>
        fetchTrainingFlex(range.from, range.to, controller.signal),
      ),
    )
      .then((results) => {
        if (!active) return
        // Chunks tile the period without overlapping and a choice belongs to a
        // single date, so no de-duplication is needed — one date, one row.
        const byDate = new Map<string, TrainingFlexKind>()
        for (const result of results) {
          for (const choice of result) byDate.set(choice.date, choice.kind)
        }
        setLoaded({ key: attempt.key, flex: byDate })
      })
      .catch((error: unknown) => {
        if (!active || controller.signal.aborted) return
        console.error('Training choices could not be loaded', error)
        setFailedKey(attempt.key)
      })

    return () => {
      active = false
      controller.abort()
    }
  }, [attempt])

  return {
    status,
    flex: matched ? (loaded as LoadedFlex).flex : NO_FLEX,
    reload,
  }
}
