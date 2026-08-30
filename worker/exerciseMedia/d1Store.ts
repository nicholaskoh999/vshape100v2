/**
 * D1 implementation of the canonical exercise media store.
 *
 * Intentionally thin — all rules live in media.ts. Every statement is prepared
 * with bound values; no part of any statement is built from user input.
 */

import {
  isMediaKind,
  type ExerciseMediaRecord,
  type ExerciseMediaStore,
} from './media'

type MediaRow = {
  google_sub: string
  exercise_id: string
  media_type: string
  media_url: string
  media_alt: string
  updated_at: number
}

/**
 * Map a stored row back to a record.
 *
 * `media_type` is re-checked rather than cast: the column has a CHECK
 * constraint, but the reader should not assume the shape of data it did not
 * write in this process.
 */
function toRecord(row: MediaRow): ExerciseMediaRecord {
  return {
    googleSub: row.google_sub,
    exerciseId: row.exercise_id,
    kind: isMediaKind(row.media_type) ? row.media_type : 'image',
    url: row.media_url,
    alt: row.media_alt,
    updatedAt: row.updated_at,
  }
}

const COLUMNS = `google_sub, exercise_id, media_type, media_url, media_alt, updated_at`

export function createD1ExerciseMediaStore(db: D1Database): ExerciseMediaStore {
  return {
    async list(googleSub) {
      const result = await db
        .prepare(
          `SELECT ${COLUMNS}
             FROM exercise_media
            WHERE google_sub = ?
            ORDER BY updated_at DESC, exercise_id`,
        )
        .bind(googleSub)
        .all<MediaRow>()

      return (result.results ?? []).map(toRecord)
    },

    async find(googleSub, exerciseId) {
      const row = await db
        .prepare(
          `SELECT ${COLUMNS}
             FROM exercise_media
            WHERE google_sub = ? AND exercise_id = ?`,
        )
        .bind(googleSub, exerciseId)
        .first<MediaRow>()

      return row ? toRecord(row) : null
    },

    async upsert(record) {
      // ON CONFLICT DO UPDATE is the canonical invariant in SQL: a second save
      // for the same account + exercise replaces the one row it already has.
      await db
        .prepare(
          `INSERT INTO exercise_media (${COLUMNS})
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT (google_sub, exercise_id) DO UPDATE SET
             media_type = excluded.media_type,
             media_url  = excluded.media_url,
             media_alt  = excluded.media_alt,
             updated_at = excluded.updated_at`,
        )
        .bind(
          record.googleSub,
          record.exerciseId,
          record.kind,
          record.url,
          record.alt,
          record.updatedAt,
        )
        .run()
    },

    async remove(googleSub, exerciseId) {
      await db
        .prepare(
          `DELETE FROM exercise_media
            WHERE google_sub = ? AND exercise_id = ?`,
        )
        .bind(googleSub, exerciseId)
        .run()
    },
  }
}
