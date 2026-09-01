/**
 * In-memory stand-in for the Today Training Flex API.
 *
 * Tests drive the real client, the real hook and the real Today card against
 * this, so load, save, clear, validation, failure and persistence are exercised
 * end to end without a network.
 *
 * It mirrors the server's invariants rather than approximating them: identity
 * comes from the "session" the harness holds rather than from any payload, an
 * unknown kind is rejected exactly as the shared validator rejects it, and the
 * value returned after a write is the STORED one.
 *
 * The default is deliberately "nothing chosen". That is what every day looks
 * like before the user decides anything, so the whole pre-Round-19 suite keeps
 * its original meaning and, in passing, proves an unflexed day is unchanged.
 */

import { isLocalDate } from '@shared/localDate'
import { isTrainingFlexKind, type TrainingFlexKind } from '@shared/trainingFlex'

export type TrainingFlexServer = {
  /** The "database": one choice per local date. */
  stored: Map<string, TrainingFlexKind>
  /** Every request the client made, in order. */
  calls: { method: string; url: string; body: unknown }[]
  /** Seed a saved choice, as if the account had chosen one before. */
  seed: (date: string, kind: TrainingFlexKind) => void
  /** Fail the next `count` reads. */
  failReads: (count?: number) => void
  /** Fail the next `count` writes. */
  failWrites: (count?: number) => void
  /** Answer the next `count` reads with this raw body verbatim, 200 OK. */
  corruptRead: (body: unknown, count?: number) => void
  /** Hold every write until the returned function is called. */
  hold: () => () => void
  handle: (url: string, init?: RequestInit) => Promise<Response>
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export function createTrainingFlexServer(): TrainingFlexServer {
  const stored = new Map<string, TrainingFlexKind>()
  const calls: TrainingFlexServer['calls'] = []

  let readFailures = 0
  let writeFailures = 0
  let corruptReads = 0
  let corruptBody: unknown = undefined
  let gate: Promise<void> | null = null

  async function handle(url: string, init?: RequestInit): Promise<Response> {
    const method = init?.method ?? 'GET'
    let parsedBody: unknown = undefined
    if (init?.body) {
      try {
        parsedBody = JSON.parse(String(init.body))
      } catch {
        parsedBody = undefined
      }
    }
    calls.push({ method, url, body: parsedBody })

    if (method === 'GET') {
      if (readFailures > 0) {
        readFailures -= 1
        return jsonResponse({ error: 'server_error' }, 500)
      }
      if (corruptReads > 0) {
        corruptReads -= 1
        return jsonResponse(corruptBody)
      }
      const query = new URLSearchParams(url.split('?')[1] ?? '')
      const from = query.get('from')
      const to = query.get('to')
      if (!isLocalDate(from) || !isLocalDate(to)) {
        return jsonResponse({ error: 'invalid_range', field: 'range' }, 400)
      }
      const choices = [...stored.entries()]
        .filter(([date]) => date >= from && date <= to)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([date, kind]) => ({ date, kind }))
      return jsonResponse({ choices })
    }

    if (method !== 'PUT') return jsonResponse({ error: 'method_not_allowed' }, 405)

    if (gate) await gate
    if (writeFailures > 0) {
      writeFailures -= 1
      return jsonResponse({ error: 'server_error' }, 500)
    }

    const raw = (parsedBody ?? {}) as Record<string, unknown>
    if (!isLocalDate(raw.date)) {
      return jsonResponse({ error: 'invalid_flex', field: 'date' }, 400)
    }
    const date = raw.date as string

    if (!Object.hasOwn(raw, 'kind')) {
      return jsonResponse({ error: 'invalid_flex', field: 'kind' }, 400)
    }
    if (raw.kind === null) {
      stored.delete(date)
      return jsonResponse({ choice: null })
    }
    // The same allowlist the server applies, so a test cannot "prove" the
    // client accepted an activity production would have rejected.
    if (!isTrainingFlexKind(raw.kind)) {
      return jsonResponse({ error: 'invalid_flex', field: 'kind' }, 400)
    }

    stored.set(date, raw.kind)
    // The STORED value, never the submitted one.
    return jsonResponse({ choice: { date, kind: stored.get(date) } })
  }

  return {
    stored,
    calls,
    seed: (date, kind) => {
      stored.set(date, kind)
    },
    failReads: (count = 1) => {
      readFailures = count
    },
    failWrites: (count = 1) => {
      writeFailures = count
    },
    corruptRead: (body, count = 1) => {
      corruptBody = body
      corruptReads = count
    },
    hold: () => {
      let release: () => void = () => {}
      gate = new Promise<void>((resolve) => {
        release = resolve
      })
      return () => {
        release()
        gate = null
      }
    },
    handle,
  }
}
