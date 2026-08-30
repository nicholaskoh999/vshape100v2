/**
 * D1 implementation of the Holiday override store.
 *
 * Intentionally thin — all rules live in holiday.ts. Every statement is
 * prepared with bound values; no part of any statement is built from user
 * input.
 *
 * Dates are zero-padded `YYYY-MM-DD` text, so ordinary SQL comparison is exact
 * calendar ordering and an inclusive-range intersection is just
 * `start_date <= :to AND end_date >= :from`.
 *
 * `google_sub` is part of the primary key and appears in the WHERE clause of
 * every statement, so a record can only ever be read or written under its own
 * account — another account's id cannot be fetched, edited, deleted or probed.
 */

import type { HolidayInput, HolidayRow, HolidayStore } from './holiday'

type Row = {
  id: string
  google_sub: string
  start_date: string
  end_date: string
  created_at: number
  updated_at: number
}

function toRow(row: Row): HolidayRow {
  return {
    id: row.id,
    googleSub: row.google_sub,
    startDate: row.start_date,
    endDate: row.end_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

const COLUMNS = `id, google_sub, start_date, end_date, created_at, updated_at`

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

    async insert(record) {
      await db
        .prepare(
          `INSERT INTO holiday_overrides (${COLUMNS})
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          record.id,
          record.googleSub,
          record.startDate,
          record.endDate,
          record.createdAt,
          record.updatedAt,
        )
        .run()
    },

    async update(googleSub, id, input: HolidayInput, updatedAt) {
      // Only the dates are assignable. `id`, `google_sub` and `created_at` are
      // not in this statement, so an edit cannot re-home or re-date a record's
      // identity.
      await db
        .prepare(
          `UPDATE holiday_overrides
              SET start_date = ?, end_date = ?, updated_at = ?
            WHERE google_sub = ? AND id = ?`,
        )
        .bind(input.startDate, input.endDate, updatedAt, googleSub, id)
        .run()
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
  }
}
