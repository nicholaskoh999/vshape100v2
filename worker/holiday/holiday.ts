/**
 * Holiday Mode rules.
 *
 * Holiday is EXEMPT, not missed. A record here suspends the normal routine's
 * pressure on the dates it covers and does nothing else: it writes no
 * completion, judges no training, and never touches Foundation.
 *
 * Validation lives in shared/holiday.ts, which the React calendar uses too, so
 * the editor's Save and the API can never disagree about what is valid. This
 * module owns the storage boundary and the operations; it never talks to D1
 * and never touches HTTP, matching today/completions.ts, exerciseMedia/media.ts
 * and workouts/workouts.ts.
 */

import type { HolidayInput, HolidayRecord } from '../../shared/holiday'
import { findHolidayConflict } from '../../shared/holiday'

export * from '../../shared/holiday'

/** A stored record plus the account it belongs to. */
export type HolidayRow = HolidayRecord & { googleSub: string }

/**
 * Storage boundary. Keeping this an interface lets the rules be tested
 * directly and keeps the D1 implementation thin, matching the other stores.
 */
export interface HolidayStore {
  /**
   * Every Holiday of this account intersecting the inclusive span, oldest
   * first. Bounded by the caller.
   */
  listIntersecting(googleSub: string, from: string, to: string): Promise<HolidayRow[]>

  /**
   * Every Holiday that could clash with a candidate range. Scoped to the
   * candidate's own span, so the overlap check never walks all history.
   */
  listOverlapping(googleSub: string, start: string, end: string): Promise<HolidayRow[]>

  find(googleSub: string, id: string): Promise<HolidayRow | null>

  /**
   * Insert ONLY if the range overlaps nothing this account already has.
   *
   * The non-overlap test must happen inside the write itself. A preceding
   * SELECT cannot enforce it: two concurrent requests can both read "no
   * conflict" and then both insert. Returns whether the row was written.
   */
  insertIfFree(row: HolidayRow): Promise<boolean>

  /**
   * Update the dates of an owned record ONLY if the new range overlaps no
   * OTHER record of this account. Same reasoning as above; the record being
   * edited is excluded so re-shaping it is never a conflict with itself.
   *
   * Returns whether the row was written — false means either "not owned" or
   * "would overlap", which the caller distinguishes afterwards.
   */
  updateIfFree(
    googleSub: string,
    id: string,
    input: HolidayInput,
    updatedAt: number,
  ): Promise<boolean>

  /** Delete when present and owned. Returns whether a row was removed. */
  remove(googleSub: string, id: string): Promise<boolean>
}

/** A fresh record id. Server-generated: the client never supplies one. */
export function newHolidayId(): string {
  return crypto.randomUUID()
}

export type HolidaySaved = { ok: true; record: HolidayRecord }
/**
 * Ranges never merge, so an overlap is reported rather than absorbed.
 *
 * `conflict` is the range that blocked the write, looked up after the fact for
 * the message. It can be null if that record was itself removed in between —
 * the refusal is still correct, only its description is unavailable.
 */
export type HolidayConflict = {
  ok: false
  reason: 'conflict'
  conflict: HolidayRecord | null
}

/** Create can only succeed or clash — there is no record to miss. */
export type CreateOutcome = HolidaySaved | HolidayConflict
/** Update can additionally miss: an unknown or unowned id is not found. */
export type UpdateOutcome = HolidaySaved | HolidayConflict | { ok: false; reason: 'not_found' }

function toRecord(row: HolidayRow): HolidayRecord {
  return {
    id: row.id,
    startDate: row.startDate,
    endDate: row.endDate,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

/* ------------------------------------------------------------------ */
/* Operations                                                          */
/* ------------------------------------------------------------------ */

/** Every Holiday of this account intersecting the span, oldest first. */
export async function listHolidays(
  store: HolidayStore,
  googleSub: string,
  from: string,
  to: string,
): Promise<HolidayRecord[]> {
  const rows = await store.listIntersecting(googleSub, from, to)
  return rows.map(toRecord)
}

/**
 * Create a Holiday.
 *
 * Refuses to overlap an existing range rather than merging into it. Merging
 * would silently change a range the user did not edit, and would make a later
 * "delete this Holiday" ambiguous.
 *
 * There is deliberately NO overlap check before the write. The store's insert
 * carries the condition itself, so two concurrent creates cannot both pass a
 * check and then both write. The lookup below runs only on the failure path,
 * purely to name the range that blocked it.
 */
export async function createHoliday(
  store: HolidayStore,
  googleSub: string,
  input: HolidayInput,
  now: number = Date.now(),
  id: string = newHolidayId(),
): Promise<CreateOutcome> {
  const row: HolidayRow = {
    googleSub,
    id,
    startDate: input.startDate,
    endDate: input.endDate,
    createdAt: now,
    updatedAt: now,
  }

  if (await store.insertIfFree(row)) return { ok: true, record: toRecord(row) }

  return { ok: false, reason: 'conflict', conflict: await describeConflict(store, googleSub, input) }
}

/** The stored range that blocked a write, for the message. Never authoritative. */
async function describeConflict(
  store: HolidayStore,
  googleSub: string,
  input: HolidayInput,
  excludeId?: string,
): Promise<HolidayRecord | null> {
  const neighbours = await store.listOverlapping(googleSub, input.startDate, input.endDate)
  return findHolidayConflict(input, neighbours.map(toRecord), excludeId)
}

/**
 * Move, shorten or extend an existing Holiday.
 *
 * The record being edited is excluded from the overlap check, so saving a
 * range that still covers its own dates is never a conflict with itself.
 */
export async function updateHoliday(
  store: HolidayStore,
  googleSub: string,
  id: string,
  input: HolidayInput,
  now: number = Date.now(),
): Promise<UpdateOutcome> {
  // The write carries both conditions — ownership AND non-overlap — so no
  // check here could be raced past.
  const written = await store.updateIfFree(googleSub, id, input, now)

  // Ownership is part of the statement, so another account's id is simply not
  // written and reads back as absent.
  const existing = await store.find(googleSub, id)

  if (written) {
    return {
      ok: true,
      record: {
        id,
        startDate: input.startDate,
        endDate: input.endDate,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      },
    }
  }

  if (!existing) return { ok: false, reason: 'not_found' }
  return {
    ok: false,
    reason: 'conflict',
    conflict: await describeConflict(store, googleSub, input, id),
  }
}

/**
 * Delete a Holiday.
 *
 * The dates it covered simply stop having an override, so they fall back to
 * the normal Home-derived route. Nothing else is touched.
 */
export async function deleteHoliday(
  store: HolidayStore,
  googleSub: string,
  id: string,
): Promise<{ ok: boolean }> {
  return { ok: await store.remove(googleSub, id) }
}
