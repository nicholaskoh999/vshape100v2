/**
 * Holiday rules — company and custom.
 *
 * ## What a Holiday means now
 *
 * A Holiday suspends the WORK day. Whether it suspends the TRAINING day is a
 * separate, explicit choice:
 *
 *   Training Off (the default) — fully exempt. Nothing is due, nothing is
 *                                missed, and no streak moves either way.
 *   Training On                — only that weekday's planned gym session comes
 *                                back. Work does not.
 *
 * Off is the default precisely because it is the safe one: a day nobody has
 * decided about must never be able to read as a missed session.
 *
 * ## Two sources, one model
 *
 * Company holidays are approved global dates, seeded once for everyone. Their
 * date and name are canonical — not the user's to move, rename or delete — and
 * only the Training preference belongs to the account. Custom holidays are
 * created by the user and owned entirely by them.
 *
 * Both read back as the same `HolidayRecord`, so the Calendar, Today and
 * Achievements consume ONE model and cannot disagree about a date.
 *
 * This module owns the rules and the storage boundary. It never talks to D1
 * and never touches HTTP, matching the other domain modules.
 */

import type { HolidayInput, HolidayRecord } from '../../shared/holiday'
import { findHolidayConflict, rangeCanTrain } from '../../shared/holiday'
import {
  companyHolidayDateOf,
  companyHolidayId,
  isCompanyHolidayId,
} from '../../shared/companyHolidays'

export * from '../../shared/holiday'
export * from '../../shared/companyHolidays'

/** A stored custom record plus the account it belongs to. */
export type HolidayRow = {
  id: string
  googleSub: string
  startDate: string
  endDate: string
  name: string
  trainingOn: boolean
  createdAt: number
  updatedAt: number
}

/** One approved company date. Global: no account is involved. */
export type CompanyHolidayRow = { date: string; name: string }

/**
 * Storage boundary.
 *
 * Company reads carry no `googleSub` because the calendar is global; only the
 * PREFERENCE is account-scoped, and every preference call takes the account.
 */
export interface HolidayStore {
  /** Custom Holidays of this account intersecting the inclusive span. */
  listIntersecting(googleSub: string, from: string, to: string): Promise<HolidayRow[]>

  /** Custom Holidays that could clash with a candidate range. */
  listOverlapping(googleSub: string, start: string, end: string): Promise<HolidayRow[]>

  find(googleSub: string, id: string): Promise<HolidayRow | null>

  /**
   * Insert ONLY if the range overlaps no custom Holiday of this account.
   *
   * The test must happen inside the write itself: a preceding SELECT cannot
   * enforce it, because two concurrent requests can both read "no conflict"
   * and then both insert.
   */
  insertIfFree(row: HolidayRow): Promise<boolean>

  /** Update the dates/name/preference of an owned record, same guard. */
  updateIfFree(
    googleSub: string,
    id: string,
    input: HolidayInput,
    updatedAt: number,
  ): Promise<boolean>

  /** Set only the training preference of an owned custom record. */
  setCustomTraining(
    googleSub: string,
    id: string,
    trainingOn: boolean,
    updatedAt: number,
  ): Promise<boolean>

  remove(googleSub: string, id: string): Promise<boolean>

  /* -- company: global, immutable -- */

  listCompanyIntersecting(from: string, to: string): Promise<CompanyHolidayRow[]>
  findCompany(date: string): Promise<CompanyHolidayRow | null>

  /* -- company preference: account-scoped -- */

  listCompanyPreferences(
    googleSub: string,
    from: string,
    to: string,
  ): Promise<{ date: string; trainingOn: boolean }[]>

  setCompanyPreference(
    googleSub: string,
    date: string,
    trainingOn: boolean,
    updatedAt: number,
  ): Promise<void>
}

/** A fresh record id. Server-generated: the client never supplies one. */
export function newHolidayId(): string {
  return crypto.randomUUID()
}

export type HolidaySaved = { ok: true; record: HolidayRecord }

/**
 * Ranges never merge, so an overlap is reported rather than absorbed.
 *
 * `conflict` is the range that blocked the write, for the message. It can be
 * null if that record was removed in between — the refusal still stands.
 */
export type HolidayConflict = {
  ok: false
  reason: 'conflict'
  conflict: HolidayRecord | null
}

export type CreateOutcome = HolidaySaved | HolidayConflict
export type UpdateOutcome = HolidaySaved | HolidayConflict | { ok: false; reason: 'not_found' }

/** Refused because the record is canonical company data. */
export type ImmutableOutcome = { ok: false; reason: 'immutable' }

export type TrainingOutcome =
  | HolidaySaved
  | { ok: false; reason: 'not_found' }
  /** The range has no Monday–Friday day, so there is no session to restore. */
  | { ok: false; reason: 'not_trainable' }

/* ------------------------------------------------------------------ */
/* Shaping                                                             */
/* ------------------------------------------------------------------ */

function customToRecord(row: HolidayRow): HolidayRecord {
  return {
    id: row.id,
    startDate: row.startDate,
    endDate: row.endDate,
    name: row.name,
    source: 'custom',
    trainingOn: row.trainingOn,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

/**
 * A company date as a record.
 *
 * Company holidays are single dates, so start and end are the same day. The id
 * is derived from the date rather than generated, so a stored preference
 * cannot be orphaned by a re-seed.
 */
export function companyToRecord(
  row: CompanyHolidayRow,
  trainingOn: boolean,
): HolidayRecord {
  return {
    id: companyHolidayId(row.date),
    startDate: row.date,
    endDate: row.date,
    name: row.name,
    source: 'company',
    trainingOn,
    createdAt: 0,
    updatedAt: 0,
  }
}

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

/**
 * Every Holiday of this account intersecting the span — company and custom —
 * oldest first, then company before custom for a stable order.
 *
 * Company dates cannot overlap custom ones, because a custom Holiday that
 * would intersect an approved date is refused at write time.
 */
export async function listHolidays(
  store: HolidayStore,
  googleSub: string,
  from: string,
  to: string,
): Promise<HolidayRecord[]> {
  const [custom, company, preferences] = await Promise.all([
    store.listIntersecting(googleSub, from, to),
    store.listCompanyIntersecting(from, to),
    store.listCompanyPreferences(googleSub, from, to),
  ])

  // Absence of a preference row means Training Off — the safe default costs no
  // storage, so a fresh account is already correct without being written to.
  const preferred = new Map(preferences.map((row) => [row.date, row.trainingOn]))

  const records = [
    ...company.map((row) => companyToRecord(row, preferred.get(row.date) ?? false)),
    ...custom.map(customToRecord),
  ]

  records.sort((a, b) => {
    if (a.startDate !== b.startDate) return a.startDate < b.startDate ? -1 : 1
    if (a.source !== b.source) return a.source === 'company' ? -1 : 1
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })

  return records
}

/* ------------------------------------------------------------------ */
/* Company conflict                                                    */
/* ------------------------------------------------------------------ */

/**
 * The approved company date a candidate range would collide with, or null.
 *
 * Read before the write rather than inside it, which is safe ONLY because the
 * company calendar is immutable at runtime: it is seeded by a migration and no
 * request path writes to it, so there is no window for it to change underneath
 * a check. Custom-vs-custom is a different matter and stays inside the write.
 */
async function companyClash(
  store: HolidayStore,
  input: HolidayInput,
): Promise<HolidayRecord | null> {
  const dates = await store.listCompanyIntersecting(input.startDate, input.endDate)
  const first = dates[0]
  return first ? companyToRecord(first, false) : null
}

/* ------------------------------------------------------------------ */
/* Custom writes                                                       */
/* ------------------------------------------------------------------ */

/**
 * Create a custom Holiday.
 *
 * Refused when it would overlap an approved company date — the company
 * calendar owns its dates, so the Calendar can never end up with two Holiday
 * truths on one day — and refused when it would overlap another custom range.
 */
export async function createHoliday(
  store: HolidayStore,
  googleSub: string,
  input: HolidayInput,
  now: number = Date.now(),
  id: string = newHolidayId(),
): Promise<CreateOutcome> {
  const company = await companyClash(store, input)
  if (company) return { ok: false, reason: 'conflict', conflict: company }

  const row: HolidayRow = {
    googleSub,
    id,
    startDate: input.startDate,
    endDate: input.endDate,
    name: input.name,
    trainingOn: input.trainingOn,
    createdAt: now,
    updatedAt: now,
  }

  if (await store.insertIfFree(row)) return { ok: true, record: customToRecord(row) }

  return {
    ok: false,
    reason: 'conflict',
    conflict: await describeConflict(store, googleSub, input),
  }
}

/** The stored range that blocked a write, for the message. Never authoritative. */
async function describeConflict(
  store: HolidayStore,
  googleSub: string,
  input: HolidayInput,
  excludeId?: string,
): Promise<HolidayRecord | null> {
  const neighbours = await store.listOverlapping(googleSub, input.startDate, input.endDate)
  return findHolidayConflict(input, neighbours.map(customToRecord), excludeId)
}

/**
 * Move, shorten, extend or rename an existing custom Holiday.
 *
 * The record being edited is excluded from the custom overlap check, so
 * re-saving its own days is never a conflict with itself.
 */
export async function updateHoliday(
  store: HolidayStore,
  googleSub: string,
  id: string,
  input: HolidayInput,
  now: number = Date.now(),
): Promise<UpdateOutcome | ImmutableOutcome> {
  // A company date is not the user's to move or rename.
  if (isCompanyHolidayId(id)) return { ok: false, reason: 'immutable' }

  const company = await companyClash(store, input)
  if (company) return { ok: false, reason: 'conflict', conflict: company }

  const written = await store.updateIfFree(googleSub, id, input, now)
  const existing = await store.find(googleSub, id)

  if (written) {
    return {
      ok: true,
      record: {
        id,
        startDate: input.startDate,
        endDate: input.endDate,
        name: input.name,
        source: 'custom',
        trainingOn: input.trainingOn,
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
 * Delete a custom Holiday.
 *
 * A company date cannot be deleted: it is the company's calendar, not the
 * account's.
 */
export async function deleteHoliday(
  store: HolidayStore,
  googleSub: string,
  id: string,
): Promise<{ ok: boolean; reason?: 'immutable' }> {
  if (isCompanyHolidayId(id)) return { ok: false, reason: 'immutable' }
  return { ok: await store.remove(googleSub, id) }
}

/* ------------------------------------------------------------------ */
/* Training preference — the one mutation both sources share           */
/* ------------------------------------------------------------------ */

/**
 * Turn training on or off for a Holiday, whichever source it came from.
 *
 * One operation for both, so there is a single place where the rule lives:
 * a range with no Monday–Friday day is refused, because there would be no
 * planned session to restore and the preference could never apply.
 */
export async function setTrainingPreference(
  store: HolidayStore,
  googleSub: string,
  id: string,
  trainingOn: boolean,
  now: number = Date.now(),
): Promise<TrainingOutcome> {
  const companyDate = companyHolidayDateOf(id)

  if (companyDate !== null) {
    const row = await store.findCompany(companyDate)
    if (!row) return { ok: false, reason: 'not_found' }
    if (trainingOn && !rangeCanTrain(row.date, row.date)) {
      return { ok: false, reason: 'not_trainable' }
    }

    await store.setCompanyPreference(googleSub, row.date, trainingOn, now)
    return { ok: true, record: companyToRecord(row, trainingOn) }
  }

  const existing = await store.find(googleSub, id)
  // Ownership is part of the lookup, so another account's id is simply absent.
  if (!existing) return { ok: false, reason: 'not_found' }

  if (trainingOn && !rangeCanTrain(existing.startDate, existing.endDate)) {
    return { ok: false, reason: 'not_trainable' }
  }

  const written = await store.setCustomTraining(googleSub, id, trainingOn, now)
  if (!written) return { ok: false, reason: 'not_found' }

  return {
    ok: true,
    record: customToRecord({ ...existing, trainingOn, updatedAt: now }),
  }
}
