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

import { isWorkoutInputType, type WorkoutInputType } from '@shared/workoutInput'

export type InputTypeRow = {
  exerciseId: string
  inputType: WorkoutInputType
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
  let clock = 1

  async function handle(url: string, init?: RequestInit): Promise<Response> {
    const method = init?.method ?? 'GET'
    const [path] = url.split('?')
    const isItem = path.length > BASE.length
    const exerciseId = isItem ? decodeURIComponent(path.slice(BASE.length + 1)) : null
    calls.push({ method, exerciseId, url })

    if (method === 'GET') {
      if (readFailures > 0) {
        readFailures -= 1
        return jsonResponse({ error: 'server_error' }, 500)
      }
      if (exerciseId === null) {
        return jsonResponse({ inputTypes: [...rows.values()] })
      }
      // An exercise nobody has configured is an honest null, not a 404.
      return jsonResponse({ exerciseId, inputType: rows.get(exerciseId) ?? null })
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
    handle,
  }
}
