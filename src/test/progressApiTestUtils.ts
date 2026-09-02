import { summariseBodyWeight, type BodyWeightRange } from '@shared/bodyWeight'
import { addLocalDays, localDateOf } from '@shared/localDate'

/**
 * In-memory stand-in for the Progress API.
 *
 * It implements the same OBSERVABLE contract the Worker does — one entry per
 * account per local date, real measurements only, comparisons that stay null
 * until there are two of them — so the client tests exercise the real hooks,
 * parsers and components against a server that behaves like the real one.
 *
 * It is deliberately not a copy of the Worker's ranking: performance variants
 * are supplied by the test as fixtures, because what the client must be shown
 * to do is RENDER what the server derived, never re-derive it.
 */

export type ProgressServer = {
  handle: (url: string, init?: RequestInit) => Promise<Response>
  /** Seed a stored measurement without going through the API. */
  seedWeight: (date: string, tenths: number) => void
  /**
   * Replace the performance payload the server will answer with.
   *
   * A FUNCTION is evaluated per request, not once. That is what lets a test
   * derive the answer from whatever the workout store holds at the moment it
   * is read — so Personal Best changes because a correction was persisted, and
   * only then, rather than because the test swapped a fixture by hand.
   */
  setPerformance: (payload: unknown | (() => unknown)) => void
  /** Fail the next N requests, to exercise the error states. */
  failWith: (status: number | null) => void
  calls: { method: string; url: string; body: unknown }[]
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export function createProgressServer(): ProgressServer {
  const weights = new Map<string, number>()
  const calls: ProgressServer['calls'] = []
  let performance: unknown | (() => unknown) = {
    complete: true,
    examined: 0,
    variants: [],
  }
  let failure: number | null = null

  function point(date: string) {
    const tenths = weights.get(date) as number
    return { date, weightKg: tenths / 10, tenths }
  }

  function read(range: BodyWeightRange) {
    const today = localDateOf(new Date())
    const from =
      range === 'all' ? null : addLocalDays(today, -(range === '30d' ? 29 : 89))

    const dates = [...weights.keys()]
      .filter((date) => (from === null ? true : date >= from && date <= today))
      .sort()

    const points = dates.map(point)

    // The summary is LIFETIME, exactly as the Worker computes it: the window
    // decides which points are drawn and nothing else. Summarising `points`
    // here would let a UI test pass against a contract the server does not
    // have.
    const everyDate = [...weights.keys()].sort()
    const summary = summariseBodyWeight(
      everyDate.map((date) => ({ date, tenths: weights.get(date) as number })),
    )

    return {
      range,
      points,
      summary: {
        latest: summary.latest ? point(summary.latest.date) : null,
        previous: summary.previous ? point(summary.previous.date) : null,
        first: summary.first ? point(summary.first.date) : null,
        changeFromPreviousTenths: summary.changeFromPrevious,
        changeFromFirstTenths: summary.changeFromFirst,
        count: summary.count,
      },
    }
  }

  return {
    calls,
    seedWeight(date, tenths) {
      weights.set(date, tenths)
    },
    setPerformance(payload) {
      performance = payload
    },
    failWith(status) {
      failure = status
    },
    async handle(url, init) {
      const method = init?.method ?? 'GET'
      const body = init?.body ? JSON.parse(String(init.body)) : null
      calls.push({ method, url, body })

      if (failure !== null) return jsonResponse({ error: 'server_error' }, failure)

      if (url.startsWith('/api/progress/performance')) {
        return jsonResponse(
          typeof performance === 'function'
            ? (performance as () => unknown)()
            : performance,
        )
      }

      if (method === 'PUT') {
        const raw = body as { localDate: string; weightKg: number }
        // One account, one date, one entry — a repeat replaces.
        weights.set(raw.localDate, Math.round(raw.weightKg * 10))
        return jsonResponse({ entry: point(raw.localDate) })
      }

      if (method === 'DELETE') {
        const date = decodeURIComponent(url.split('/').pop() as string)
        weights.delete(date)
        return jsonResponse({ date })
      }

      const range = (new URL(url, 'https://x').searchParams.get('range') ??
        'all') as BodyWeightRange
      return jsonResponse(read(range))
    },
  }
}
