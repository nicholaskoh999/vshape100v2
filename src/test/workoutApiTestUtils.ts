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

import { isNoOpCorrection, parseSetCorrection } from '@shared/workoutCorrection'
import type { WorkoutInputType } from '@shared/workoutInput'
import {
  inputTypeForLegacyLoadMode,
  kindForSessionId,
  loadModeForInputType,
} from '@shared/workoutLog'
import type {
  WorkoutKind,
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
  /** Frozen at Start, exactly as the real server freezes it. */
  inputType: WorkoutInputType
  status: WorkoutSetStatus
  load: { value: number; unit: 'kg' | 'kg_each' } | null
  band: { label: string; count: number } | null
  result: number | null
  updatedAt: number
  /** Round 21. When this set was last corrected, or null if it never was. */
  correctedAt?: number | null
}

export type ServerOccurrence = {
  date: string
  sessionId: string
  /**
   * Provenance, mirrored from the server. It is DERIVED from the routed
   * session id here too, so a test cannot accidentally prove isolation by
   * labelling a row itself — the stand-in has to earn the label the same way.
   */
  kind: WorkoutKind
  sourceSessionId: string | null
  day: string
  focus: string
  intensity: string
  startedAt: number
  updatedAt: number
}

type Stored = {
  occurrence: ServerOccurrence
  sets: ServerSet[]
  /**
   * Round 21. When any set was FIRST resolved, or null if none ever was.
   *
   * Mirrors the real `workout_occurrences.touched_at`: it is what stops a
   * workout that was completed and then undone from looking disposable.
   */
  touchedAt?: number | null
  /** Round 21. The INSERT-only correction audit for this workout. */
  corrections?: { exerciseOrder: number; setIndex: number; correctedAt: number }[]
}

/**
 * What a test hands to `seed`.
 *
 * Provenance is optional and derived from the session id when it is absent, so
 * the many existing seeds keep meaning exactly what they meant — a scheduled
 * workout — and a Round 17 test can seed an Extra just by using the reserved
 * slug. Deriving it here rather than making every call site restate it keeps
 * the stand-in honest: a test cannot label a row something the server would
 * not have.
 */
export type SeedStored = {
  occurrence: Omit<ServerOccurrence, 'kind' | 'sourceSessionId'> &
    Partial<Pick<ServerOccurrence, 'kind' | 'sourceSessionId'>>
  sets: ServerSet[]
  /**
   * Round 21. Omit it to seed a workout that was never worked in — which is
   * exactly what an accidental Start looks like.
   */
  touchedAt?: number | null
}

export type WorkoutServer = {
  /** The "database": one entry per (date, session), exactly like D1. */
  workouts: Map<string, Stored>
  /** Every request the client made, in order. */
  calls: { method: string; url: string }[]
  /**
   * Configure an exercise's input type, as the Exercise Library would.
   *
   * Applies to the next Start only: a workout already underway keeps the
   * modality it was started with.
   */
  setInputType: (exerciseId: string, inputType: WorkoutInputType) => void
  /** Seed a workout as if it had already been started. */
  seed: (date: string, sessionId: string, stored: SeedStored) => void
  /** Fail the next `count` reads. */
  failReads: (count?: number) => void
  /** Fail the next `count` writes. */
  failMutations: (count?: number) => void
  /** Hold every write until the returned function is called. */
  hold: () => () => void
  /** Hold every read until the returned function is called. */
  holdReads: () => () => void
  /** Return at most `rows` for a range read, so it reports itself incomplete. */
  capRange: (rows: number | null) => void
  handle: (url: string, init?: RequestInit) => Promise<Response>
}

const BASE = '/api/workouts'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * Round 21 — is this workout genuinely untouched?
 *
 * Mirrors the server's conditional DELETE: never resolved, no evidence on any
 * row, and no set whose own clock has moved away from the Start.
 */
function isUntouched(stored: Stored): boolean {
  if (stored.touchedAt !== null && stored.touchedAt !== undefined) return false
  return stored.sets.every(
    (set) =>
      set.status === 'pending' &&
      set.load === null &&
      set.band === null &&
      set.result === null &&
      set.updatedAt === stored.occurrence.startedAt,
  )
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
  /** The account's saved input types, which a Start resolves against. */
  const inputTypes = new Map<string, WorkoutInputType>()
  const calls: WorkoutServer['calls'] = []

  let readFailures = 0
  let mutationFailures = 0
  let gate: Promise<void> | null = null
  let readGate: Promise<void> | null = null
  let clock = 1
  // null = a range read returns everything it found, and says so.
  let rangeCap: number | null = null

  async function handle(url: string, init?: RequestInit): Promise<Response> {
    const method = init?.method ?? 'GET'
    const [path, search] = url.split('?')
    calls.push({ method, url })

    const segments = path.slice(BASE.length + 1).split('/')

    // GET /api/workouts/history?limit=N — read-only reporting.
    if (segments.length === 1 && segments[0] === 'history') {
      if (readGate) await readGate
      if (readFailures > 0) {
        readFailures -= 1
        return jsonResponse({ error: 'server_error' }, 500)
      }

      const params = new URLSearchParams(search ?? '')

      const all = [...workouts.values()].sort((a, b) => {
        if (a.occurrence.date !== b.occurrence.date) {
          return b.occurrence.date.localeCompare(a.occurrence.date)
        }
        if (a.occurrence.startedAt !== b.occurrence.startedAt) {
          return b.occurrence.startedAt - a.occurrence.startedAt
        }
        return a.occurrence.sessionId.localeCompare(b.occurrence.sessionId)
      })

      const everySet = all.flatMap((entry) => entry.sets)
      const completed = everySet.filter((set) => set.status === 'completed').length
      const skipped = everySet.filter((set) => set.status === 'skipped').length
      const totals = {
        workouts: all.length,
        sets: everySet.length,
        completed,
        skipped,
        resolved: completed + skipped,
      }

      const toRow = (entry: Stored) => ({
        date: entry.occurrence.date,
        sessionId: entry.occurrence.sessionId,
        kind: entry.occurrence.kind,
        sourceSessionId: entry.occurrence.sourceSessionId,
        day: entry.occurrence.day,
        focus: entry.occurrence.focus,
        intensity: entry.occurrence.intensity,
        startedAt: entry.occurrence.startedAt,
        updatedAt: entry.occurrence.updatedAt,
        progress: summarise(entry.sets),
      })

      // Range read: everything inside an inclusive local-date window.
      const from = params.get('from')
      const to = params.get('to')
      if ((from ?? '') !== '' || (to ?? '') !== '') {
        const shape = /^\d{4}-\d{2}-\d{2}$/
        if (from === null || to === null || !shape.test(from) || !shape.test(to) || from > to) {
          return jsonResponse({ error: 'invalid_range' }, 400)
        }
        const inRange = all.filter(
          (entry) => entry.occurrence.date >= from && entry.occurrence.date <= to,
        )
        // A cap lets a test reproduce a truncated read, where absence proves
        // nothing and no streak may be claimed.
        const cap = rangeCap ?? inRange.length
        return jsonResponse({
          from,
          to,
          workouts: inRange.slice(0, cap).map(toRow),
          totals,
          complete: inRange.length <= cap,
        })
      }

      const raw = params.get('limit')
      let limit = 20
      if (raw !== null && raw !== '') {
        const value = Number(raw)
        if (!Number.isInteger(value) || value < 1 || value > 50) {
          return jsonResponse({ error: 'invalid_limit' }, 400)
        }
        limit = value
      }

      return jsonResponse({
        limit,
        workouts: all.slice(0, limit).map(toRow),
        totals,
        complete: Math.min(limit, all.length) >= all.length,
      })
    }
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
              sets: stored.sets.map((set) => ({
                ...set,
                correctedAt:
                  stored.corrections?.find(
                    (row) =>
                      row.exerciseOrder === set.exerciseOrder && row.setIndex === set.setIndex,
                  )?.correctedAt ?? null,
              })),
              progress: summarise(stored.sets),
              cancelable: isUntouched(stored),
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
        sourceSessionId?: string | null
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
          cancelable: isUntouched(existing),
        })
      }

      const startedAt = clock++
      const sets: ServerSet[] = []
      body.exercises.forEach((exercise, exerciseOrder) => {
        // Resolved server-side from the account's saved setting, never from the
        // request. An exercise nobody has configured keeps its previous
        // behaviour, read from the load mode the plan asked for.
        const inputType =
          inputTypes.get(exercise.exerciseId) ??
          inputTypeForLegacyLoadMode(exercise.loadMode)
        for (let setIndex = 0; setIndex < exercise.setCount; setIndex += 1) {
          sets.push({
            exerciseOrder,
            setIndex,
            exerciseId: exercise.exerciseId,
            exerciseName: exercise.name,
            prescription: exercise.prescription,
            equipment: exercise.equipment,
            resultKind: exercise.resultKind,
            // Forced to agree with the modality, as the real Start does: a
            // band or bodyweight exercise cannot carry kilogram semantics.
            loadMode: loadModeForInputType(inputType, exercise.loadMode),
            perSide: exercise.perSide,
            inputType,
            status: 'pending',
            load: null,
            band: null,
            result: null,
            updatedAt: startedAt,
          })
        }
      })

      const kind = kindForSessionId(sessionId)
      const stored: Stored = {
        occurrence: {
          date,
          sessionId,
          kind,
          // Carried only where it means something, exactly as the server does.
          sourceSessionId: kind === 'extra' ? (body.sourceSessionId ?? null) : null,
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
          // A brand-new workout has never been worked in.
          cancelable: isUntouched(stored),
        },
        201,
      )
    }

    // Round 21 — Cancel Start. DELETE on the workout itself.
    if (segments.length === 2 && method === 'DELETE') {
      if (mutationFailures > 0) {
        mutationFailures -= 1
        return jsonResponse({ error: 'server_error' }, 500)
      }
      const stored = workouts.get(id)
      if (!stored) return jsonResponse({ error: 'not_started' }, 404)
      // The same eligibility rule the server applies, and for the same reason:
      // a workout that was resolved and undone is NOT disposable.
      if (!isUntouched(stored)) {
        return jsonResponse({ error: 'workout_touched' }, 409)
      }
      workouts.delete(id)
      return jsonResponse({ date, sessionId, occurrence: null, sets: [], progress: null })
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
      // Undo TOUCHES the workout too: putting the sets back does not put back
      // the fact that they were resolved.
      stored.touchedAt = stored.touchedAt ?? clock
      set.status = 'pending'
      set.result = null
      set.load = null
      set.band = null
      set.updatedAt = clock++
      return jsonResponse({ date, sessionId, set })
    }

    // Round 21 — correcting one completed set's recorded performance.
    if (segments.length === 6 && segments[5] === 'correction') {
      if (method !== 'PUT') return jsonResponse({ error: 'method_not_allowed' }, 405)
      if (mutationFailures > 0) {
        mutationFailures -= 1
        return jsonResponse({ error: 'server_error' }, 500)
      }
      if (!stored || !set) return jsonResponse({ error: 'set_not_found' }, 404)
      if (set.status !== 'completed') return jsonResponse({ error: 'not_completed' }, 400)

      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      const parsed = parseSetCorrection(body)
      if (!parsed.ok) {
        return jsonResponse({ error: 'invalid_correction', field: parsed.field }, 400)
      }

      const before = {
        inputType: set.inputType,
        loadMode: set.loadMode,
        loadValue: set.load ? set.load.value : null,
        loadUnit: set.load ? set.load.unit : null,
        bandLabel: set.band ? set.band.label : null,
        bandCount: set.band ? set.band.count : null,
        result: set.result,
      }
      // No-op first, so a correction that changes nothing writes no audit — and
      // reports whatever the set's real history already said, never a fresh
      // timestamp for an event that did not happen.
      if (isNoOpCorrection(before, parsed.value)) {
        const existing =
          stored.corrections?.find(
            (row) => row.exerciseOrder === exerciseOrder && row.setIndex === setIndex,
          )?.correctedAt ?? null
        return jsonResponse({
          date,
          sessionId,
          corrected: false,
          set: { ...set, correctedAt: existing },
        })
      }
      // Optimistic concurrency: the editor must submit the version it read.
      if (set.updatedAt !== parsed.expectedUpdatedAt) {
        return jsonResponse({ error: 'stale' }, 409)
      }

      const after = parsed.value
      set.inputType = after.inputType
      set.loadMode = after.loadMode
      set.load = after.load
      set.band = after.band
      set.result = after.result
      set.updatedAt = clock++
      // The audit and the mutation land together, as they do in production.
      stored.corrections = [
        ...(stored.corrections ?? []).filter(
          (row) => !(row.exerciseOrder === exerciseOrder && row.setIndex === setIndex),
        ),
        { exerciseOrder, setIndex, correctedAt: set.updatedAt },
      ]
      // MIRRORS PRODUCTION, and only because production now does this. Before
      // Correction 1 the real handler answered `correctedAt: null` here while
      // this stand-in filled it in — so the stand-in was more correct than the
      // thing it stood in for, and the UI test passed over a real defect.
      set.correctedAt = set.updatedAt
      return jsonResponse({ date, sessionId, corrected: true, set })
    }

    if (method === 'PUT') {
      const body = JSON.parse(String(init?.body ?? '{}')) as {
        action?: string
        result?: number
        load?: { value: number; unit: 'kg' | 'kg_each' } | null
        band?: { label: string; count: number } | null
      }

      stored.touchedAt = stored.touchedAt ?? clock
      if (body.action === 'skip') {
        set.status = 'skipped'
        set.result = null
        set.load = null
        set.band = null
        set.updatedAt = clock++
        return jsonResponse({ date, sessionId, set })
      }

      if (body.action !== 'complete' || typeof body.result !== 'number') {
        return jsonResponse({ error: 'invalid_set', field: 'result' }, 400)
      }
      // The frozen snapshot decides what may be recorded, mirroring
      // applySetUpdate. A payload describing the other modality is refused
      // outright rather than half-stored.
      if (set.inputType === 'resistance_band') {
        if (body.load) return jsonResponse({ error: 'modality_mismatch' }, 400)
        if (!body.band) return jsonResponse({ error: 'band_required' }, 400)
      } else if (body.band) {
        return jsonResponse({ error: 'modality_mismatch' }, 400)
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
      set.band = body.band ?? null
      set.updatedAt = clock++
      return jsonResponse({ date, sessionId, set })
    }

    return jsonResponse({ error: 'method_not_allowed' }, 405)
  }

  return {
    workouts,
    calls,
    /**
     * Configure an exercise's input type, as the Exercise Library would.
     *
     * Takes effect on the next Start only — a workout already underway keeps
     * the modality it was started with, which is the rule under test.
     */
    setInputType: (exerciseId: string, inputType: WorkoutInputType) => {
      inputTypes.set(exerciseId, inputType)
    },
    seed: (date, sessionId, stored) => {
      const kind = stored.occurrence.kind ?? kindForSessionId(sessionId)
      workouts.set(key(date, sessionId), {
        ...stored,
        occurrence: {
          ...stored.occurrence,
          kind,
          sourceSessionId:
            kind === 'extra' ? (stored.occurrence.sourceSessionId ?? null) : null,
        },
      })
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
    capRange: (rows: number | null) => {
      rangeCap = rows
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
