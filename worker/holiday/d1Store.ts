/**
 * D1 implementation of the Holiday store.
 *
 * Intentionally thin — all rules live in holiday.ts. Every statement is
 * prepared with bound values; no part of any statement is built from user
 * input.
 *
 * Dates are zero-padded `YYYY-MM-DD` text, so ordinary SQL comparison is exact
 * calendar ordering and an inclusive-range intersection is just
 * `start_date <= :to AND end_date >= :from`.
 *
 * `google_sub` appears in the WHERE clause of every ACCOUNT-scoped statement,
 * so a record can only ever be read or written under its own account.
 *
 * The company calendar is deliberately the exception: `company_holidays` is
 * global and carries no account column at all. It is seeded by the migration
 * and never written from a request path, so no GET can secretly create rows.
 *
 * ## Non-overlap is enforced by the write, not before it
 *
 * A SELECT followed by an INSERT is a check-then-write race: two concurrent
 * requests for one account can both read "no conflict" and then both write.
 * The two statements below carry the non-overlap test as a `NOT EXISTS`
 * condition inside the write itself. SQLite evaluates a statement atomically
 * and D1 has a single writer, so the second request sees the first's committed
 * row and its own write simply affects zero rows.
 *
 * Adjacent ranges are untouched by this: the condition uses the same inclusive
 * intersection as everywhere else, so `…-05` and `-06…` do not overlap.
 */

import type { CompanyHolidayRow, HolidayInput, HolidayRow, HolidayStore } from './holiday'

type Row = {
  id: string
  google_sub: string
  start_date: string
  end_date: string
  name: string
  training_on: number
  created_at: number
  updated_at: number
}

function toRow(row: Row): HolidayRow {
  return {
    id: row.id,
    googleSub: row.google_sub,
    startDate: row.start_date,
    endDate: row.end_date,
    name: row.name ?? '',
    // Stored as 0/1; normalised here so nothing downstream sees a number.
    trainingOn: row.training_on === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

const COLUMNS = `id, google_sub, start_date, end_date, name, training_on, created_at, updated_at`

/** Deterministic: earliest range first, then end date, then id. */
const ORDER = `ORDER BY start_date ASC, end_date ASC, id ASC`

export function createD1HolidayStore(db: D1Database): HolidayStore {
  /** Inclusive-range intersection, shared by the list and the overlap check. */
  async function intersecting(googleSub: string, from: string, to: string) {
    const result = await db
      .prepare(
        `SELECT ${COLUMNS}
           FROM holiday_overrides
          WHERE google_sub = ? AND start_date <= ? AND end_date >= ?
          ${ORDER}`,
      )
      .bind(googleSub, to, from)
      .all<Row>()

    return (result.results ?? []).map(toRow)
  }

  return {
    listIntersecting(googleSub, from, to) {
      return intersecting(googleSub, from, to)
    },

    listOverlapping(googleSub, start, end) {
      // The same query: anything intersecting the candidate span is exactly
      // what could conflict with it.
      return intersecting(googleSub, start, end)
    },

    async find(googleSub, id) {
      const row = await db
        .prepare(
          `SELECT ${COLUMNS}
             FROM holiday_overrides
            WHERE google_sub = ? AND id = ?`,
        )
        .bind(googleSub, id)
        .first<Row>()

      return row ? toRow(row) : null
    },

    async insertIfFree(record) {
      // Conditional insert: the row is written only while nothing of this
      // account intersects the range. A losing concurrent create affects zero
      // rows rather than erroring.
      const result = await db
        .prepare(
          `INSERT INTO holiday_overrides (${COLUMNS})
           SELECT ?, ?, ?, ?, ?, ?, ?, ?
            WHERE NOT EXISTS (
                  SELECT 1 FROM holiday_overrides
                   WHERE google_sub = ? AND start_date <= ? AND end_date >= ?
            )`,
        )
        .bind(
          record.id,
          record.googleSub,
          record.startDate,
          record.endDate,
          record.name,
          record.trainingOn ? 1 : 0,
          record.createdAt,
          record.updatedAt,
          // The guard's own bindings.
          record.googleSub,
          record.endDate,
          record.startDate,
        )
        .run()

      return (result.meta?.changes ?? 0) > 0
    },

    async updateIfFree(googleSub, id, input: HolidayInput, updatedAt) {
      // Only the dates, name and preference are assignable. `id`,
      // `google_sub` and `created_at` are not in this statement, so an edit
      // cannot re-home or re-date a record's identity.
      //
      // The guard excludes the record being edited (`id <> ?`), so re-shaping
      // a Holiday over its own days is never a conflict with itself.
      const result = await db
        .prepare(
          `UPDATE holiday_overrides
              SET start_date = ?, end_date = ?, name = ?, training_on = ?, updated_at = ?
            WHERE google_sub = ? AND id = ?
              AND NOT EXISTS (
                  SELECT 1 FROM holiday_overrides other
                   WHERE other.google_sub = ? AND other.id <> ?
                     AND other.start_date <= ? AND other.end_date >= ?
              )`,
        )
        .bind(
          input.startDate,
          input.endDate,
          input.name,
          input.trainingOn ? 1 : 0,
          updatedAt,
          googleSub,
          id,
          // The guard's own bindings.
          googleSub,
          id,
          input.endDate,
          input.startDate,
        )
        .run()

      return (result.meta?.changes ?? 0) > 0
    },

    async setCustomTraining(googleSub, id, trainingOn, updatedAt) {
      // Dates and name are absent from this statement, so toggling training
      // can never move or rename the Holiday as a side effect.
      const result = await db
        .prepare(
          `UPDATE holiday_overrides
              SET training_on = ?, updated_at = ?
            WHERE google_sub = ? AND id = ?`,
        )
        .bind(trainingOn ? 1 : 0, updatedAt, googleSub, id)
        .run()

      return (result.meta?.changes ?? 0) > 0
    },

    async remove(googleSub, id) {
      const result = await db
        .prepare(
          `DELETE FROM holiday_overrides
            WHERE google_sub = ? AND id = ?`,
        )
        .bind(googleSub, id)
        .run()

      // `changes` distinguishes "deleted" from "was never yours to delete",
      // which is what lets the route answer 404 honestly.
      return (result.meta?.changes ?? 0) > 0
    },

    /* -- company: global and read-only from every request path -- */

    async listCompanyIntersecting(from, to) {
      const result = await db
        .prepare(
          `SELECT holiday_date, name
             FROM company_holidays
            WHERE holiday_date >= ? AND holiday_date <= ?
            ORDER BY holiday_date ASC`,
        )
        .bind(from, to)
        .all<{ holiday_date: string; name: string }>()

      return (result.results ?? []).map(
        (row): CompanyHolidayRow => ({ date: row.holiday_date, name: row.name }),
      )
    },

    async findCompany(date) {
      const row = await db
        .prepare(`SELECT holiday_date, name FROM company_holidays WHERE holiday_date = ?`)
        .bind(date)
        .first<{ holiday_date: string; name: string }>()

      return row ? { date: row.holiday_date, name: row.name } : null
    },

    /* -- company preference: account-scoped -- */

    async listCompanyPreferences(googleSub, from, to) {
      const result = await db
        .prepare(
          `SELECT holiday_date, training_on
             FROM company_holiday_preferences
            WHERE google_sub = ? AND holiday_date >= ? AND holiday_date <= ?`,
        )
        .bind(googleSub, from, to)
        .all<{ holiday_date: string; training_on: number }>()

      return (result.results ?? []).map((row) => ({
        date: row.holiday_date,
        trainingOn: row.training_on === 1,
      }))
    },

    async setCompanyPreference(googleSub, date, trainingOn, updatedAt) {
      // Upsert: the account may change its mind any number of times, and the
      // absence of a row is a valid state meaning Off.
      await db
        .prepare(
          `INSERT INTO company_holiday_preferences
             (google_sub, holiday_date, training_on, updated_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT (google_sub, holiday_date)
           DO UPDATE SET training_on = excluded.training_on,
                         updated_at = excluded.updated_at`,
        )
        .bind(googleSub, date, trainingOn ? 1 : 0, updatedAt)
        .run()
    },
  }
}
