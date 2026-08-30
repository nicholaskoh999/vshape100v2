/**
 * In-memory stand-in for the canonical exercise media API.
 *
 * Tests drive the real client, the real hooks and the real pages against this,
 * so hydration, saving, replacing, removal and failure handling are exercised
 * end to end without a network. No real media is ever fetched: jsdom does not
 * load images, and every URL used in tests is a fixture.
 */

export type MediaRow = {
  exerciseId: string
  kind: 'gif' | 'image'
  url: string
  alt: string
  updatedAt: number
}

export type MediaServer = {
  /** The "database": one row per exercise identity, exactly like D1. */
  rows: Map<string, MediaRow>
  /** Every request the client made, in order. */
  calls: { method: string; exerciseId: string | null; url: string }[]
  /** Fail the next `count` reads (collection or item). */
  failReads: (count?: number) => void
  /** Fail the next `count` writes. */
  failMutations: (count?: number) => void
  /** Hold every write until the returned function is called. */
  hold: () => () => void
  /** Hold every read until the returned function is called. */
  holdReads: () => () => void
  handle: (url: string, init?: RequestInit) => Promise<Response>
}

const BASE = '/api/exercise-media'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export function createMediaServer(initial: MediaRow[] = []): MediaServer {
  const rows = new Map<string, MediaRow>(initial.map((row) => [row.exerciseId, row]))
  const calls: MediaServer['calls'] = []

  let readFailures = 0
  let mutationFailures = 0
  let gate: Promise<void> | null = null
  let readGate: Promise<void> | null = null

  async function handle(url: string, init?: RequestInit): Promise<Response> {
    const method = init?.method ?? 'GET'
    const [path] = url.split('?')
    const isItem = path.length > BASE.length
    const exerciseId = isItem ? decodeURIComponent(path.slice(BASE.length + 1)) : null
    calls.push({ method, exerciseId, url })

    if (method === 'GET') {
      if (readGate) await readGate
      if (readFailures > 0) {
        readFailures -= 1
        return jsonResponse({ error: 'server_error' }, 500)
      }
      if (!exerciseId) return jsonResponse({ media: [...rows.values()] })
      return jsonResponse({ exerciseId, media: rows.get(exerciseId) ?? null })
    }

    if (gate) await gate

    if (mutationFailures > 0) {
      mutationFailures -= 1
      return jsonResponse({ error: 'server_error' }, 500)
    }

    if (!exerciseId) return jsonResponse({ error: 'invalid_exercise_id' }, 400)

    if (method === 'PUT') {
      const body = JSON.parse(String(init?.body ?? '{}')) as Partial<MediaRow>
      if (body.kind !== 'gif' && body.kind !== 'image') {
        return jsonResponse({ error: 'invalid_media', field: 'kind' }, 400)
      }
      if (typeof body.url !== 'string' || typeof body.alt !== 'string') {
        return jsonResponse({ error: 'invalid_media', field: 'body' }, 400)
      }
      // Upsert: one row per exercise identity, never a per-session duplicate.
      const row: MediaRow = {
        exerciseId,
        kind: body.kind,
        url: body.url,
        alt: body.alt,
        updatedAt: rows.size + 1,
      }
      rows.set(exerciseId, row)
      return jsonResponse({ exerciseId, media: row })
    }

    if (method === 'DELETE') {
      rows.delete(exerciseId)
      return jsonResponse({ exerciseId, media: null })
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
