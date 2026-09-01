/**
 * In-memory stand-in for the account settings API.
 *
 * Tests drive the real client, the real provider and the real Settings form
 * against this, so load, save, validation, failure and persistence are
 * exercised end to end without a network.
 *
 * It mirrors the server's invariants rather than approximating them: identity
 * comes from the "session" the harness holds rather than from any payload, an
 * impossible calendar date is rejected exactly as the shared validator rejects
 * it, and the value returned after a write is the STORED one.
 *
 * The default is deliberately "nothing saved". That is what every existing
 * account looks like, so the whole pre-Round-18 suite keeps its original
 * meaning and, in passing, proves the legacy fallback still applies.
 */

import { parseFoundationStartDate, type AccountSettings } from '@shared/settings'

export type SettingsServer = {
  /** The "database": one settings row per account. */
  stored: { foundationStartDate: string | null }
  /** Every request the client made, in order. */
  calls: { method: string; url: string }[]
  /** Seed a saved value, as if the account had chosen one before. */
  seed: (foundationStartDate: string | null) => void
  /** Fail the next `count` reads. */
  failReads: (count?: number) => void
  /**
   * Answer the next `count` reads with a 200 carrying this raw value verbatim.
   *
   * Bypasses the harness's own validation on purpose: it reproduces a server
   * that is healthy but returning something this client cannot read — a corrupt
   * column, or a field shape from a newer schema. The client must refuse it
   * rather than coerce it into "no preference".
   */
  corruptRead: (value: unknown, count?: number) => void
  /**
   * Answer the next `count` reads with this ENTIRE body verbatim, 200 OK.
   *
   * Unlike `corruptRead`, nothing is wrapped: the body is sent exactly as given,
   * so a test can reproduce an envelope with the required field missing — `{}`,
   * a bare `null`, an array, a primitive, or an object carrying some other
   * shape. That is the case Correction 2 exists for.
   */
  corruptBody: (body: unknown, count?: number) => void
  /** Fail the next `count` writes. */
  failWrites: (count?: number) => void
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

export function createSettingsServer(): SettingsServer {
  const stored: { foundationStartDate: string | null } = { foundationStartDate: null }
  const calls: SettingsServer['calls'] = []

  let readFailures = 0
  let writeFailures = 0
  let corruptReads = 0
  let corruptValue: unknown = undefined
  let corruptBodies = 0
  let corruptBodyValue: unknown = undefined
  let gate: Promise<void> | null = null

  async function handle(url: string, init?: RequestInit): Promise<Response> {
    const method = init?.method ?? 'GET'
    calls.push({ method, url })

    if (method === 'GET') {
      if (readFailures > 0) {
        readFailures -= 1
        return jsonResponse({ error: 'server_error' }, 500)
      }
      if (corruptBodies > 0) {
        corruptBodies -= 1
        return jsonResponse(corruptBodyValue)
      }
      if (corruptReads > 0) {
        corruptReads -= 1
        return jsonResponse({ foundationStartDate: corruptValue })
      }
      return jsonResponse({ foundationStartDate: stored.foundationStartDate })
    }

    if (method !== 'PUT') return jsonResponse({ error: 'method_not_allowed' }, 405)

    if (gate) await gate
    if (writeFailures > 0) {
      writeFailures -= 1
      return jsonResponse({ error: 'server_error' }, 500)
    }

    let body: unknown
    try {
      body = JSON.parse(String(init?.body ?? '{}'))
    } catch {
      return jsonResponse({ error: 'invalid_json' }, 400)
    }

    const raw = (body ?? {}) as Record<string, unknown>
    const value = raw.foundationStartDate

    if (value === null) {
      stored.foundationStartDate = null
      return jsonResponse({ foundationStartDate: null })
    }

    // The same real-calendar check the server applies. A shape-valid but
    // impossible date is refused here too, so a test cannot "prove" the client
    // accepted something production would have rejected.
    const parsed = parseFoundationStartDate(value)
    if (parsed === null) {
      return jsonResponse({ error: 'invalid_settings', field: 'foundation_start_date' }, 400)
    }

    stored.foundationStartDate = parsed
    // The STORED value, never the submitted one.
    return jsonResponse({ foundationStartDate: stored.foundationStartDate } satisfies AccountSettings)
  }

  return {
    stored,
    calls,
    seed: (foundationStartDate) => {
      stored.foundationStartDate = foundationStartDate
    },
    failReads: (count = 1) => {
      readFailures = count
    },
    corruptRead: (value, count = 1) => {
      corruptValue = value
      corruptReads = count
    },
    corruptBody: (body, count = 1) => {
      corruptBodyValue = body
      corruptBodies = count
    },
    failWrites: (count = 1) => {
      writeFailures = count
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
