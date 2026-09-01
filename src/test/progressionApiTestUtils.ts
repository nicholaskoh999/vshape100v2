/**
 * In-memory stand-in for the training progression API.
 *
 * It does NOT re-implement the derivation. It reads the same in-memory workouts
 * the workout stand-in stores and hands them to the REAL shared engine, so a UI
 * test exercises the real client, the real hook, the real page and the real
 * progression rules — only the HTTP hop is replaced.
 *
 * The calibration guards mirror the server's: a judgement is accepted only for
 * a lane that is genuinely calibrating, only once a first working set has been
 * completed with a recorded load, and only in that lane's own unit. The
 * observed load is read from stored workout truth here exactly as it is on the
 * server; a request never supplies one.
 */

import {
  deriveSessionProgression,
  type LaneRecommendation,
  type ProgressionSetRow,
  type SessionProgression,
  type StoredCalibration,
} from '@shared/progression/engine'
import { isCalibrationFeedback } from '@shared/progression/lane'
import type { WorkoutLoadUnit } from '@shared/workoutLog'
import type { ServerSet, WorkoutServer } from './workoutApiTestUtils'

export type ProgressionServer = {
  /** Every stored calibration, keyed `<date>#<session>#<exerciseOrder>`. */
  calibrations: Map<string, StoredCalibration & { date: string; sessionId: string }>
  /** Every request the client made, in order. */
  calls: { method: string; url: string }[]
  /** Fail the next `count` reads. */
  failReads: (count?: number) => void
  /** Fail the next `count` writes. */
  failMutations: (count?: number) => void
  /** Hold every read until the returned function is called. */
  holdReads: () => () => void
  handle: (url: string, init?: RequestInit) => Promise<Response>
}

const BASE = '/api/progression'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function toRow(date: string, set: ServerSet): ProgressionSetRow {
  return {
    workoutDate: date,
    exerciseOrder: set.exerciseOrder,
    setIndex: set.setIndex,
    exerciseId: set.exerciseId,
    exerciseName: set.exerciseName,
    prescription: set.prescription,
    resultKind: set.resultKind,
    loadMode: set.loadMode,
    perSide: set.perSide,
    status: set.status,
    loadValue: set.load?.value ?? null,
    loadUnit: set.load?.unit ?? null,
    result: set.result,
  }
}

export function createProgressionServer(workouts: WorkoutServer): ProgressionServer {
  const calibrations = new Map<
    string,
    StoredCalibration & { date: string; sessionId: string }
  >()
  const calls: ProgressionServer['calls'] = []
  let readFailures = 0
  let mutationFailures = 0
  let readGate: Promise<void> | null = null

  function calibrationKey(date: string, sessionId: string, exerciseOrder: number) {
    return `${date}#${sessionId}#${exerciseOrder}`
  }

  /** Derive guidance the same way the Worker does: history is EARLIER only. */
  function derive(date: string, sessionId: string): SessionProgression | null {
    const stored = workouts.workouts.get(`${date}#${sessionId}`)
    if (!stored) return null

    const history: ProgressionSetRow[] = []
    for (const entry of workouts.workouts.values()) {
      if (entry.occurrence.sessionId !== sessionId) continue
      if (entry.occurrence.date >= date) continue
      for (const set of entry.sets) history.push(toRow(entry.occurrence.date, set))
    }

    return deriveSessionProgression({
      sessionId,
      intensity: stored.occurrence.intensity,
      current: stored.sets.map((set) => toRow(date, set)),
      history,
      calibration: [...calibrations.values()].filter(
        (row) => row.date === date && row.sessionId === sessionId,
      ),
      historyComplete: true,
    })
  }

  function body(date: string, sessionId: string) {
    const progression = derive(date, sessionId)
    if (!progression) {
      return { date, sessionId, started: false, intensity: null, ruleset: null, lanes: [] }
    }
    return {
      date,
      sessionId,
      started: true,
      intensity: progression.intensity,
      ruleset: progression.ruleset,
      lanes: progression.lanes,
    }
  }

  async function handle(url: string, init?: RequestInit): Promise<Response> {
    const method = init?.method ?? 'GET'
    const [path] = url.split('?')
    calls.push({ method, url })

    const segments = path.slice(BASE.length + 1).split('/')
    const [date, sessionId] = segments

    if (segments.length === 2 && method === 'GET') {
      if (readGate) await readGate
      if (readFailures > 0) {
        readFailures -= 1
        return jsonResponse({ error: 'server_error' }, 500)
      }
      return jsonResponse(body(date, sessionId))
    }

    if (segments.length !== 4 || segments[2] !== 'calibration') {
      return jsonResponse({ error: 'not_found' }, 404)
    }

    if (mutationFailures > 0) {
      mutationFailures -= 1
      return jsonResponse({ error: 'server_error' }, 500)
    }

    const exerciseOrder = Number(segments[3])
    const key = calibrationKey(date, sessionId, exerciseOrder)

    if (method === 'DELETE') {
      calibrations.delete(key)
      return jsonResponse(body(date, sessionId))
    }

    if (method !== 'PUT') return jsonResponse({ error: 'method_not_allowed' }, 405)

    const payload = JSON.parse(String(init?.body ?? '{}')) as {
      feedback?: unknown
      chosenLoad?: { value: number; unit: WorkoutLoadUnit } | null
    }
    if (!isCalibrationFeedback(payload.feedback)) {
      return jsonResponse({ error: 'invalid_calibration', field: 'feedback' }, 400)
    }

    const progression = derive(date, sessionId)
    if (!progression) return jsonResponse({ error: 'workout_not_started' }, 404)

    const lane: LaneRecommendation | undefined = progression.lanes.find(
      (row) => row.exerciseOrder === exerciseOrder,
    )
    if (!lane || !lane.lane || !lane.fingerprint) {
      return jsonResponse({ error: 'slot_not_found' }, 404)
    }
    if (lane.state !== 'calibrate' || !lane.calibration) {
      return jsonResponse({ error: 'not_calibrating' }, 409)
    }
    const observed = lane.calibration.observedLoad
    if (!observed) return jsonResponse({ error: 'no_completed_set' }, 409)
    if (payload.chosenLoad && payload.chosenLoad.unit !== lane.lane.loadMode) {
      return jsonResponse({ error: 'load_unit_mismatch' }, 409)
    }

    calibrations.set(key, {
      date,
      sessionId,
      exerciseOrder,
      fingerprint: lane.fingerprint,
      feedback: payload.feedback,
      observedLoad: observed,
      chosenLoad: payload.chosenLoad ?? null,
    })

    return jsonResponse(body(date, sessionId))
  }

  return {
    calibrations,
    calls,
    failReads: (count = 1) => {
      readFailures = count
    },
    failMutations: (count = 1) => {
      mutationFailures = count
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
