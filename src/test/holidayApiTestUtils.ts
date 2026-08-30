/**
 * In-memory stand-in for the Holiday Mode API.
 *
 * Tests drive the real client, the real hooks and the real pages against this,
 * so create / edit / delete, overlap conflicts, hydration and failure handling
 * are exercised end to end without a network.
 *
 * It mirrors the server's invariants rather than approximating them: records
 * are account-scoped by construction, ranges never merge, and an overlapping
 * save is a 409 that changes nothing.
 */

import { rangesOverlap } from '@shared/localDate'
import type { HolidayRecord } from '@shared/holiday'

export type HolidayServer = {
  /** The "database": one entry per record id, exactly like D1. */
  rows: Map<string, HolidayRecord>
  /** Every request the client made, in order. */
  calls: { method: string; url: string }[]
  /** Seed a record as if it had already been saved. */
  seed: (record: HolidayRecord) => void
  /** Fail the next `count` reads. */
  failReads: (count?: number) => void
  /** Fail the next `count` writes. */
  failMutations: (count?: number) => void
  /** Hold every read until the returned function is called. */
  holdReads: () => () => void
  /** Hold every write until the returned function is called. */
  hold: () => () => void
  handle: (url: string, init?: RequestInit) => Promise<Response>
}

const BASE = '/api/holidays'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export function createHolidayServer(initial: HolidayRecord[] = []): HolidayServer {
  const rows = new Map<string, HolidayRecord>(initial.map((row) => [row.id, row]))
  const calls: HolidayServer['calls'] = []

  let readFailures = 0
  let mutationFailures = 0
  let gate: Promise<void> | null = null
  let readGate: Promise<void> | null = null
  let nextId = 1

  /** The record a candidate range would clash with, ignoring `excludeId`. */
  function conflictFor(
    startDate: string,
    endDate: string,
    excludeId?: string,
  ): HolidayRecord | null {
    for (const row of rows.values()) {
      if (row.id === excludeId) continue
      if (rangesOverlap(startDate, endDate, row.startDate, row.endDate)) return row
    }
    return null
  }

  async function handle(url: string, init?: RequestInit): Promise<Response> {
    const method = init?.method ?? 'GET'
    const [path, search] = url.split('?')
    calls.push({ method, url })

    const id = path.length > BASE.length ? decodeURIComponent(path.slice(BASE.length + 1)) : null

    if (method === 'GET') {
      if (readGate) await readGate
      if (readFailures > 0) {
        readFailures -= 1
        return jsonResponse({ error: 'server_error' }, 500)
      }

      const params = new URLSearchParams(search ?? '')
      const from = params.get('from') ?? ''
      const to = params.get('to') ?? ''
      const holidays = [...rows.values()]
        // Inclusive-range intersection, exactly as the server does it.
        .filter((row) => row.startDate <= to && row.endDate >= from)
        .sort((a, b) =>
          a.startDate === b.startDate
            ? a.endDate.localeCompare(b.endDate)
            : a.startDate.localeCompare(b.startDate),
        )
      return jsonResponse({ from, to, holidays })
    }

    if (gate) await gate
    if (mutationFailures > 0) {
      mutationFailures -= 1
      return jsonResponse({ error: 'server_error' }, 500)
    }

    const body = JSON.parse(String(init?.body ?? '{}')) as {
      startDate?: string
      endDate?: string
    }

    if (method === 'POST') {
      if (typeof body.startDate !== 'string' || typeof body.endDate !== 'string') {
        return jsonResponse({ error: 'invalid_holiday', field: 'startDate' }, 400)
      }
      if (body.startDate > body.endDate) {
        return jsonResponse({ error: 'invalid_holiday', field: 'order' }, 400)
      }
      const conflict = conflictFor(body.startDate, body.endDate)
      // Ranges never merge: an overlap is reported and nothing is written.
      if (conflict) return jsonResponse({ error: 'holiday_conflict', conflict }, 409)

      const record: HolidayRecord = {
        id: `holiday-${nextId++}`,
        startDate: body.startDate,
        endDate: body.endDate,
        createdAt: nextId,
        updatedAt: nextId,
      }
      rows.set(record.id, record)
      return jsonResponse({ holiday: record }, 201)
    }

    if (!id) return jsonResponse({ error: 'not_found' }, 404)
    const existing = rows.get(id)

    if (method === 'PUT') {
      if (!existing) return jsonResponse({ error: 'holiday_not_found' }, 404)
      if (typeof body.startDate !== 'string' || typeof body.endDate !== 'string') {
        return jsonResponse({ error: 'invalid_holiday', field: 'startDate' }, 400)
      }
      // The record being edited never conflicts with itself.
      const conflict = conflictFor(body.startDate, body.endDate, id)
      if (conflict) return jsonResponse({ error: 'holiday_conflict', conflict }, 409)

      const record: HolidayRecord = {
        ...existing,
        startDate: body.startDate,
        endDate: body.endDate,
        updatedAt: nextId++,
      }
      rows.set(id, record)
      return jsonResponse({ holiday: record })
    }

    if (method === 'DELETE') {
      if (!existing) return jsonResponse({ error: 'holiday_not_found' }, 404)
      rows.delete(id)
      return jsonResponse({ id, deleted: true })
    }

    return jsonResponse({ error: 'method_not_allowed' }, 405)
  }

  return {
    rows,
    calls,
    seed: (record) => {
      rows.set(record.id, record)
    },
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

/** A record with sensible defaults, for seeding. */
export function holiday(
  id: string,
  startDate: string,
  endDate = startDate,
): HolidayRecord {
  return { id, startDate, endDate, createdAt: 1, updatedAt: 1 }
}
