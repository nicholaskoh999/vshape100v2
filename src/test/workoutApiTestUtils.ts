/**
 * In-memory stand-in for the workout logging API.
 *
 * Tests drive the real client, the real hook and the real pages against this,
 * so start/resume, logging, undo, hydration and failure handling are exercised
 * end to end without a network.
 *
 * It mirrors the server's invariants rather than approximating them: one
 * occurrence per (date, session), an insert-only snapshot, and a set that must
 * already exist before it can be logged against.
 */

import type {
  WorkoutLoadMode,
  WorkoutResultKind,
  WorkoutSetStatus,
} from '@shared/workoutLog'

export type ServerSet = {
  exerciseOrder: number
  setIndex: number
  exerciseId: string
  exerciseName: string
  prescription: string
  equipment: string | null
  resultKind: WorkoutResultKind
  loadMode: WorkoutLoadMode
  perSide: boolean
  status: WorkoutSetStatus
  load: { value: number; unit: 'kg' | 'kg_each' } | null
  result: number | null
  updatedAt: number
}

export type ServerOccurrence = {
  date: string
  sessionId: string
  day: string
  focus: string
  intensity: string
  startedAt: number
  updatedAt: number
}

type Stored = { occurrence: ServerOccurrence; sets: ServerSet[] }

export type WorkoutServer = {
  /** The "database": one entry per (date, session), exactly like D1. */
  workouts: Map<string, Stored>
  /** Every request the client made, in order. */
  calls: { method: string; url: string }[]
  /** Seed a workout as if it had already been started. */
  seed: (date: string, sessionId: string, stored: Stored) => void
  /** Fail the next `count` reads. */
  failReads: (count?: number) => void
  /** Fail the next `count` writes. */
  failMutations: (count?: number) => void
  /** Hold every write until the returned function is called. */
  hold: () => () => void
  /** Hold every read until the returned function is called. */
  holdReads: () => () => void
  handle: (url: string, init?: RequestInit) => Promise<Response>
}

const BASE = '/api/workouts'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function key(date: string, sessionId: string): string {
  return `${date}#${sessionId}`
}

function summarise(sets: ServerSet[]) {
  const completed = sets.filter((set) => set.status === 'completed').length
  const skipped = sets.filter((set) => set.status === 'skipped').length
  return { total: sets.length, completed, skipped, resolved: completed + skipped }
}

export function createWorkoutServer(): WorkoutServer {
  const workouts = new Map<string, Stored>()
  const calls: WorkoutServer['calls'] = []

  let readFailures = 0
  let mutationFailures = 0
  let gate: Promise<void> | null = null
  let readGate: Promise<void> | null = null
  let clock = 1

  async function handle(url: string, init?: RequestInit): Promise<Response> {
    const method = init?.method ?? 'GET'
    const [path] = url.split('?')
    calls.push({ method, url })

    const segments = path.slice(BASE.length + 1).split('/')
    const [date, sessionId] = segments
    const id = key(date, sessionId)

    if (method === 'GET') {
      if (readGate) await readGate
      if (readFailures > 0) {
        readFailures -= 1
        return jsonResponse({ error: 'server_error' }, 500)
      }
      const stored = workouts.get(id)
      return jsonResponse(
        stored
          ? {
              date,
              sessionId,
              occurrence: stored.occurrence,
              sets: stored.sets,
              progress: summarise(stored.sets),
            }
          : { date, sessionId, occurrence: null, sets: [], progress: null },
      )
    }

    if (gate) await gate
    if (mutationFailures > 0) {
      mutationFailures -= 1
      return jsonResponse({ error: 'server_error' }, 500)
    }

    if (segments[2] === 'start') {
      const body = JSON.parse(String(init?.body ?? '{}')) as {
        day: string
        focus: string
        intensity: string
        exercises: {
          exerciseId: string
          name: string
          prescription: string
          equipment: string | null
          resultKind: WorkoutResultKind
          loadMode: WorkoutLoadMode
          perSide: boolean
          setCount: number
        }[]
      }

      const existing = workouts.get(id)
      // Insert-only: a second start returns the stored snapshot untouched.
      if (existing) {
        return jsonResponse({
          date,
          sessionId,
          created: false,
          occurrence: existing.occurrence,
          sets: existing.sets,
          progress: summarise(existing.sets),
        })
      }

      const startedAt = clock++
      const sets: ServerSet[] = []
      body.exercises.forEach((exercise, exerciseOrder) => {
        for (let setIndex = 0; setIndex < exercise.setCount; setIndex += 1) {
          sets.push({
            exerciseOrder,
            setIndex,
            exerciseId: exercise.exerciseId,
            exerciseName: exercise.name,
            prescription: exercise.prescription,
            equipment: exercise.equipment,
            resultKind: exercise.resultKind,
            loadMode: exercise.loadMode,
            perSide: exercise.perSide,
            status: 'pending',
            load: null,
            result: null,
            updatedAt: startedAt,
          })
        }
      })

      const stored: Stored = {
        occurrence: {
          date,
          sessionId,
          day: body.day,
          focus: body.focus,
          intensity: body.intensity,
          startedAt,
          updatedAt: startedAt,
        },
        sets,
      }
      workouts.set(id, stored)
      return jsonResponse(
        {
          date,
          sessionId,
          created: true,
          occurrence: stored.occurrence,
          sets: stored.sets,
          progress: summarise(stored.sets),
        },
        201,
      )
    }

    if (segments[2] !== 'sets') return jsonResponse({ error: 'not_found' }, 404)

    const exerciseOrder = Number(segments[3])
    const setIndex = Number(segments[4])
    const stored = workouts.get(id)
    const set = stored?.sets.find(
      (row) => row.exerciseOrder === exerciseOrder && row.setIndex === setIndex,
    )
    // A set must already exist: logging never creates history.
    if (!stored || !set) return jsonResponse({ error: 'set_not_found' }, 404)

    if (method === 'DELETE') {
      set.status = 'pending'
      set.result = null
      set.load = null
      set.updatedAt = clock++
      return jsonResponse({ date, sessionId, set })
    }

    if (method === 'PUT') {
      const body = JSON.parse(String(init?.body ?? '{}')) as {
        action?: string
        result?: number
        load?: { value: number; unit: 'kg' | 'kg_each' } | null
      }

      if (body.action === 'skip') {
        set.status = 'skipped'
        set.result = null
        set.load = null
        set.updatedAt = clock++
        return jsonResponse({ date, sessionId, set })
      }

      if (body.action !== 'complete' || typeof body.result !== 'number') {
        return jsonResponse({ error: 'invalid_set', field: 'result' }, 400)
      }
      if (body.load && set.loadMode === 'none') {
        return jsonResponse({ error: 'load_not_applicable' }, 400)
      }
      if (body.load && body.load.unit !== set.loadMode) {
        return jsonResponse({ error: 'load_unit_mismatch' }, 400)
      }

      set.status = 'completed'
      set.result = body.result
      set.load = body.load ?? null
      set.updatedAt = clock++
      return jsonResponse({ date, sessionId, set })
    }

    return jsonResponse({ error: 'method_not_allowed' }, 405)
  }

  return {
    workouts,
    calls,
    seed: (date, sessionId, stored) => {
      workouts.set(key(date, sessionId), stored)
    },
    failReads: (count = 1) => {
      readFailures = count
    },
    failMutations: (count = 1) => {
      mutationFailures = count
    },
    hold: () => {
      let release!: () => void
      gate = new Promise<void>((resolve) => {
        release = resolve
      })
      return () => {
        gate = null
        release()
      }
    },
    holdReads: () => {
      let release!: () => void
      readGate = new Promise<void>((resolve) => {
        release = resolve
      })
      return () => {
        readGate = null
        release()
      }
    },
    handle,
  }
}
