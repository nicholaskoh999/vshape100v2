/**
 * In-memory stand-in for the Holiday API.
 *
 * Tests drive the real client, the real hooks and the real pages against this,
 * so create / edit / delete, training preferences, overlap conflicts and
 * failure handling are exercised end to end without a network.
 *
 * It mirrors the server's invariants rather than approximating them:
 *
 *   - the approved company calendar is present by default, because the real
 *     server always returns it; a test that assumed an empty year would be
 *     testing a fiction
 *   - a company date's dates and name are immutable, and only its Training
 *     preference belongs to the account
 *   - a custom range that intersects a company date is refused
 *   - custom ranges never merge; an overlap is a 409 that changes nothing
 */

import { COMPANY_HOLIDAYS, companyHolidayId, isCompanyHolidayId } from '@shared/companyHolidays'
import { rangeCanTrain, type HolidayRecord } from '@shared/holiday'
import { rangesOverlap } from '@shared/localDate'

export type HolidayServer = {
  /** The custom "database": one entry per record id, exactly like D1. */
  rows: Map<string, HolidayRecord>
  /** Per-account Training choices for company dates, keyed by date. */
  companyPreferences: Map<string, boolean>
  /** Every request the client made, in order. */
  calls: { method: string; url: string }[]
  /** Seed a custom record as if it had already been saved. */
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

export type HolidayServerOptions = {
  /**
   * Include the approved company calendar. Defaults to true, matching
   * production. Set false only for a test that is genuinely about a year with
   * no company dates in it.
   */
  company?: boolean
}

export function createHolidayServer(
  initial: HolidayRecord[] = [],
  options: HolidayServerOptions = {},
): HolidayServer {
  const withCompany = options.company !== false
  const rows = new Map<string, HolidayRecord>(initial.map((row) => [row.id, row]))
  const companyPreferences = new Map<string, boolean>()
  const calls: HolidayServer['calls'] = []

  let readFailures = 0
  let mutationFailures = 0
  let gate: Promise<void> | null = null
  let readGate: Promise<void> | null = null
  let nextId = 1

  /** The approved dates, as records, with this account's preferences applied. */
  function companyRecords(): HolidayRecord[] {
    if (!withCompany) return []
    return COMPANY_HOLIDAYS.map((row) => ({
      id: companyHolidayId(row.date),
      startDate: row.date,
      endDate: row.date,
      name: row.name,
      source: 'company' as const,
      trainingOn: companyPreferences.get(row.date) ?? false,
      createdAt: 0,
      updatedAt: 0,
    }))
  }

  /** The approved date a candidate range would collide with, or null. */
  function companyClash(startDate: string, endDate: string): HolidayRecord | null {
    return (
      companyRecords().find((row) =>
        rangesOverlap(startDate, endDate, row.startDate, row.endDate),
      ) ?? null
    )
  }

  /** The custom record a candidate range would clash with, ignoring `excludeId`. */
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

    const segments =
      path.length > BASE.length ? path.slice(BASE.length + 1).split('/') : []
    const id = segments[0] ? decodeURIComponent(segments[0]) : null
    const isTraining = segments.length === 2 && segments[1] === 'training'

    if (method === 'GET') {
      if (readGate) await readGate
      if (readFailures > 0) {
        readFailures -= 1
        return jsonResponse({ error: 'server_error' }, 500)
      }

      const params = new URLSearchParams(search ?? '')
      const from = params.get('from') ?? ''
      const to = params.get('to') ?? ''
      const holidays = [...companyRecords(), ...rows.values()]
        // Inclusive-range intersection, exactly as the server does it.
        .filter((row) => row.startDate <= to && row.endDate >= from)
        .sort((a, b) => {
          if (a.startDate !== b.startDate) return a.startDate.localeCompare(b.startDate)
          if (a.source !== b.source) return a.source === 'company' ? -1 : 1
          return a.id.localeCompare(b.id)
        })
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
      name?: string
      trainingOn?: boolean
    }

    if (method === 'POST') {
      if (typeof body.startDate !== 'string' || typeof body.endDate !== 'string') {
        return jsonResponse({ error: 'invalid_holiday', field: 'startDate' }, 400)
      }
      if (body.startDate > body.endDate) {
        return jsonResponse({ error: 'invalid_holiday', field: 'order' }, 400)
      }
      if (body.trainingOn === true && !rangeCanTrain(body.startDate, body.endDate)) {
        return jsonResponse({ error: 'invalid_holiday', field: 'training' }, 400)
      }
      // The company calendar owns its dates: a custom Holiday may not sit on
      // one, so the Calendar can never hold two Holiday truths for a day.
      const company = companyClash(body.startDate, body.endDate)
      if (company) return jsonResponse({ error: 'holiday_conflict', conflict: company }, 409)

      const conflict = conflictFor(body.startDate, body.endDate)
      // Ranges never merge: an overlap is reported and nothing is written.
      if (conflict) return jsonResponse({ error: 'holiday_conflict', conflict }, 409)

      const record: HolidayRecord = {
        id: `holiday-${nextId++}`,
        startDate: body.startDate,
        endDate: body.endDate,
        name: typeof body.name === 'string' ? body.name.trim() : '',
        source: 'custom',
        trainingOn: body.trainingOn === true,
        createdAt: nextId,
        updatedAt: nextId,
      }
      rows.set(record.id, record)
      return jsonResponse({ holiday: record }, 201)
    }

    if (!id) return jsonResponse({ error: 'not_found' }, 404)

    if (isTraining) {
      if (method !== 'PUT') return jsonResponse({ error: 'method_not_allowed' }, 405)
      if (typeof body.trainingOn !== 'boolean') {
        return jsonResponse({ error: 'invalid_training' }, 400)
      }

      if (isCompanyHolidayId(id)) {
        const record = companyRecords().find((row) => row.id === id)
        if (!record) return jsonResponse({ error: 'holiday_not_found' }, 404)
        if (body.trainingOn && !rangeCanTrain(record.startDate, record.endDate)) {
          return jsonResponse({ error: 'holiday_not_trainable' }, 400)
        }
        companyPreferences.set(record.startDate, body.trainingOn)
        return jsonResponse({ holiday: { ...record, trainingOn: body.trainingOn } })
      }

      const owned = rows.get(id)
      if (!owned) return jsonResponse({ error: 'holiday_not_found' }, 404)
      if (body.trainingOn && !rangeCanTrain(owned.startDate, owned.endDate)) {
        return jsonResponse({ error: 'holiday_not_trainable' }, 400)
      }
      const updated = { ...owned, trainingOn: body.trainingOn, updatedAt: nextId++ }
      rows.set(id, updated)
      return jsonResponse({ holiday: updated })
    }

    // A company date's dates and name are the company's, not the account's.
    if (isCompanyHolidayId(id)) {
      return jsonResponse({ error: 'holiday_immutable' }, 403)
    }

    const existing = rows.get(id)

    if (method === 'PUT') {
      if (!existing) return jsonResponse({ error: 'holiday_not_found' }, 404)
      if (typeof body.startDate !== 'string' || typeof body.endDate !== 'string') {
        return jsonResponse({ error: 'invalid_holiday', field: 'startDate' }, 400)
      }
      if (body.trainingOn === true && !rangeCanTrain(body.startDate, body.endDate)) {
        return jsonResponse({ error: 'invalid_holiday', field: 'training' }, 400)
      }
      const company = companyClash(body.startDate, body.endDate)
      if (company) return jsonResponse({ error: 'holiday_conflict', conflict: company }, 409)

      // The record being edited never conflicts with itself.
      const conflict = conflictFor(body.startDate, body.endDate, id)
      if (conflict) return jsonResponse({ error: 'holiday_conflict', conflict }, 409)

      const record: HolidayRecord = {
        ...existing,
        startDate: body.startDate,
        endDate: body.endDate,
        name: typeof body.name === 'string' ? body.name.trim() : existing.name,
        trainingOn: body.trainingOn === true,
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
    companyPreferences,
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

/** A custom record with sensible defaults, for seeding. */
export function holiday(
  id: string,
  startDate: string,
  endDate = startDate,
  overrides: Partial<Pick<HolidayRecord, 'name' | 'trainingOn' | 'source'>> = {},
): HolidayRecord {
  return {
    id,
    startDate,
    endDate,
    name: overrides.name ?? '',
    source: overrides.source ?? 'custom',
    trainingOn: overrides.trainingOn ?? false,
    createdAt: 1,
    updatedAt: 1,
  }
}
