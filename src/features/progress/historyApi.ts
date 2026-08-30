/**
 * Workout history client.
 *
 * Read-only. D1 is the source of truth; nothing is mirrored into browser
 * storage, and this module never writes history — Progress reports what was
 * logged and cannot change it.
 */

import type {
  WorkoutHistoryEntry,
  WorkoutHistoryTotals,
  WorkoutProgress,
} from '@shared/workoutLog'

export type { WorkoutHistoryEntry, WorkoutHistoryTotals }

export type WorkoutHistory = {
  limit: number
  workouts: WorkoutHistoryEntry[]
  totals: WorkoutHistoryTotals
}

export class WorkoutHistoryApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'WorkoutHistoryApiError'
    this.status = status
  }
}

const URL_PATH = '/api/workouts/history'

const REQUEST_INIT: RequestInit = {
  credentials: 'same-origin',
  headers: { Accept: 'application/json' },
}

const EMPTY_TOTALS: WorkoutHistoryTotals = {
  workouts: 0,
  sets: 0,
  completed: 0,
  skipped: 0,
  resolved: 0,
}

function toProgress(raw: unknown): WorkoutProgress | null {
  if (typeof raw !== 'object' || raw === null) return null
  const row = raw as Partial<WorkoutProgress>
  if (
    typeof row.total !== 'number' ||
    typeof row.completed !== 'number' ||
    typeof row.skipped !== 'number'
  ) {
    return null
  }
  return {
    total: row.total,
    completed: row.completed,
    skipped: row.skipped,
    // Derived rather than trusted, so completed and skipped stay the facts.
    resolved: row.completed + row.skipped,
  }
}

/** Returns null for anything that is not a full history row. */
function toEntry(raw: unknown): WorkoutHistoryEntry | null {
  if (typeof raw !== 'object' || raw === null) return null
  const row = raw as Record<string, unknown>
  if (typeof row.date !== 'string' || typeof row.sessionId !== 'string') return null
  const progress = toProgress(row.progress)
  if (!progress) return null

  return {
    date: row.date,
    sessionId: row.sessionId,
    day: typeof row.day === 'string' ? row.day : '',
    focus: typeof row.focus === 'string' ? row.focus : '',
    intensity: typeof row.intensity === 'string' ? row.intensity : '',
    startedAt: typeof row.startedAt === 'number' ? row.startedAt : 0,
    updatedAt: typeof row.updatedAt === 'number' ? row.updatedAt : 0,
    progress,
  }
}

function toTotals(raw: unknown): WorkoutHistoryTotals {
  if (typeof raw !== 'object' || raw === null) return EMPTY_TOTALS
  const row = raw as Partial<WorkoutHistoryTotals>
  const completed = typeof row.completed === 'number' ? row.completed : 0
  const skipped = typeof row.skipped === 'number' ? row.skipped : 0
  return {
    workouts: typeof row.workouts === 'number' ? row.workouts : 0,
    sets: typeof row.sets === 'number' ? row.sets : 0,
    completed,
    skipped,
    resolved: completed + skipped,
  }
}

/** Recent recorded workouts for the signed-in account, newest first. */
export async function fetchWorkoutHistory(
  options: { limit?: number } = {},
  signal?: AbortSignal,
): Promise<WorkoutHistory> {
  const query =
    options.limit === undefined ? '' : `?${new URLSearchParams({ limit: String(options.limit) })}`

  const response = await fetch(`${URL_PATH}${query}`, { ...REQUEST_INIT, signal })
  if (!response.ok) {
    throw new WorkoutHistoryApiError(
      `Workout history request failed (${response.status})`,
      response.status,
    )
  }

  const body = (await response.json()) as Record<string, unknown>
  return {
    limit: typeof body.limit === 'number' ? body.limit : 0,
    workouts: Array.isArray(body.workouts)
      ? body.workouts.map(toEntry).filter((row): row is WorkoutHistoryEntry => row !== null)
      : [],
    totals: toTotals(body.totals),
  }
}
