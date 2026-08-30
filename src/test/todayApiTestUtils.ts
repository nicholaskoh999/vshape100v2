/**
 * In-memory stand-in for the Today completions API.
 *
 * Tests drive the real client, the real hook and the real Today engine
 * against this, so hydration, persistence, idempotency and failure handling
 * are all exercised end to end without a network.
 */

export type TodayServer = {
  /** Occurrence keys the "database" currently holds. */
  rows: Set<string>
  /** Every request the client made, in order. */
  calls: { method: string; key: string | null; url: string }[]
  /** Fail the next `count` hydration reads. */
  failHydration: (count?: number) => void
  /** Fail the next `count` writes. */
  failMutations: (count?: number) => void
  /** Hold every write until the returned function is called. */
  hold: () => () => void
  /** Hold every read until the returned function is called. */
  holdReads: () => () => void
  handle: (url: string, init?: RequestInit) => Promise<Response>
}

const BASE = '/api/today/completions'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export function createTodayServer(initial: string[] = []): TodayServer {
  const rows = new Set(initial)
  const calls: TodayServer['calls'] = []

  let hydrationFailures = 0
  let mutationFailures = 0
  let gate: Promise<void> | null = null
  let readGate: Promise<void> | null = null

  async function handle(url: string, init?: RequestInit): Promise<Response> {
    const method = init?.method ?? 'GET'
    const [path, query] = url.split('?')
    const isItem = path.length > BASE.length
    const key = isItem ? decodeURIComponent(path.slice(BASE.length + 1)) : null
    calls.push({ method, key, url })

    if (method === 'GET') {
      if (readGate) await readGate
      if (hydrationFailures > 0) {
        hydrationFailures -= 1
        return jsonResponse({ error: 'server_error' }, 500)
      }
      const params = new URLSearchParams(query ?? '')
      const from = params.get('from') ?? ''
      const to = params.get('to') ?? ''
      const completions = [...rows]
        .filter((row) => {
          const day = row.slice(0, 10)
          return day >= from && day <= to
        })
        .sort()
        .map((row) => ({ key: row, anchorDay: row.slice(0, 10), completedAt: 1 }))
      return jsonResponse({ completions })
    }

    if (gate) await gate

    if (mutationFailures > 0) {
      mutationFailures -= 1
      return jsonResponse({ error: 'server_error' }, 500)
    }

    if (!key) return jsonResponse({ error: 'invalid_occurrence_key' }, 400)

    if (method === 'PUT') {
      // Idempotent: a repeat is a no-op, exactly like ON CONFLICT DO NOTHING.
      rows.add(key)
      return jsonResponse({ key, completed: true })
    }

    if (method === 'DELETE') {
      rows.delete(key)
      return jsonResponse({ key, completed: false })
    }

    return jsonResponse({ error: 'method_not_allowed' }, 405)
  }

  return {
    rows,
    calls,
    failHydration: (count = 1) => {
      hydrationFailures = count
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
    handle,
  }
}
