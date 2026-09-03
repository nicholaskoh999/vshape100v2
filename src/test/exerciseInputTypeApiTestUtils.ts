/**
 * In-memory stand-in for the exercise input type API.
 *
 * Tests drive the real client, the real hook and the real card against this,
 * so loading, saving, the unanswered state and failure handling are exercised
 * end to end without a network.
 *
 * It mirrors the server's rules rather than approximating them: one row per
 * exercise identity, an upsert that replaces rather than accumulates, and an
 * unrecognised input type refused instead of coerced.
 */

import { isWorkoutInputType } from '@shared/workoutInput'

/**
 * One stored row, holding the RAW persisted value.
 *
 * `inputType` is a plain string, not a `WorkoutInputType`, so a test can seed
 * the value a corrupt or future write would leave behind. Whether that value is
 * readable is decided below by the production predicate — the double supplies
 * storage, never the verdict.
 */
export type InputTypeRow = {
  exerciseId: string
  inputType: string
  updatedAt: number
}

export type InputTypeServer = {
  /** The "database": one row per exercise identity, exactly like D1. */
  rows: Map<string, InputTypeRow>
  /** Every request the client made, in order. */
  calls: { method: string; exerciseId: string | null; url: string }[]
  /** Fail the next `count` reads (collection or item). */
  failReads: (count?: number) => void
  /** Fail the next `count` writes. */
  failMutations: (count?: number) => void
  /**
   * Hold every read open until the returned function is called.
   *
   * The library read is what tells a started workout whether its frozen
   * modality is still the account's; holding it is how a test occupies the
   * window in which nothing has been verified yet.
   */
  holdReads: () => () => void
  handle: (url: string, init?: RequestInit) => Promise<Response>
}

const BASE = '/api/exercise-input-types'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export function createInputTypeServer(initial: InputTypeRow[] = []): InputTypeServer {
  const rows = new Map<string, InputTypeRow>(initial.map((row) => [row.exerciseId, row]))
  const calls: InputTypeServer['calls'] = []

  let readFailures = 0
  let mutationFailures = 0
  let readGate: Promise<void> | null = null
  let clock = 1

  async function handle(url: string, init?: RequestInit): Promise<Response> {
    const method = init?.method ?? 'GET'
    const [path] = url.split('?')
    const isItem = path.length > BASE.length
    const exerciseId = isItem ? decodeURIComponent(path.slice(BASE.length + 1)) : null
    calls.push({ method, exerciseId, url })

    if (method === 'GET') {
      // Awaited before the failure check so a held read can be released into
      // either answer, exactly as a slow server would.
      if (readGate) await readGate
      if (readFailures > 0) {
        readFailures -= 1
        return jsonResponse({ error: 'server_error' }, 500)
      }
      if (exerciseId === null) {
        // Readable and unreadable rows are reported separately, exactly as the
        // real collection handler does — a dropped row would be
        // indistinguishable from one that was never written.
        const stored = [...rows.values()]
        return jsonResponse({
          inputTypes: stored.filter((row) => isWorkoutInputType(row.inputType)),
          unreadable: stored
            .filter((row) => !isWorkoutInputType(row.inputType))
            .map((row) => row.exerciseId),
        })
      }

      // THREE STATES, ALL 200, mirroring the real item handler. An exercise
      // nobody has configured is an honest `absent`, not a 404; a row whose
      // stored value this build cannot read is `unreadable`, which the client
      // may offer to REPLACE. Neither is an error — a genuine storage failure
      // is, and answers 500 above.
      const row = rows.get(exerciseId)
      if (!row) return jsonResponse({ exerciseId, state: 'absent', inputType: null })
      // The production predicate decides, not this file.
      if (!isWorkoutInputType(row.inputType)) {
        return jsonResponse({ exerciseId, state: 'unreadable', inputType: null })
      }
      return jsonResponse({ exerciseId, state: 'readable', inputType: row })
    }

    if (method === 'PUT' && exerciseId !== null) {
      if (mutationFailures > 0) {
        mutationFailures -= 1
        return jsonResponse({ error: 'server_error' }, 500)
      }
      const body = JSON.parse(String(init?.body ?? '{}')) as { inputType?: unknown }
      // Refused, never coerced: an unknown modality is exactly what must not
      // become "kilograms" by default.
      if (!isWorkoutInputType(body.inputType)) {
        return jsonResponse({ error: 'invalid_input_type', field: 'inputType' }, 400)
      }
      const row: InputTypeRow = {
        exerciseId,
        inputType: body.inputType,
        updatedAt: clock++,
      }
      rows.set(exerciseId, row)
      return jsonResponse({ exerciseId, inputType: row })
    }

    return jsonResponse({ error: 'method_not_allowed' }, 405)
  }

  return {
    rows,
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
