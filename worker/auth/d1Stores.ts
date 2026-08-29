/**
 * D1 implementations of the auth storage interfaces.
 *
 * Intentionally thin: all rules live in session.ts / oauthState.ts, so this
 * file is only mapping rows to records.
 */

import type { OAuthStateRecord, OAuthStateStore } from './oauthState'
import type { SessionRecord, SessionStore } from './session'

type SessionRow = {
  session_hash: string
  google_sub: string
  email: string
  name: string | null
  picture: string | null
  trusted: number
  created_at: number
  last_seen_at: number
  expires_at: number
  revoked_at: number | null
}

type StateRow = {
  state_hash: string
  nonce: string
  code_verifier: string
  return_to: string
  trusted: number
  created_at: number
  expires_at: number
}

function toSessionRecord(row: SessionRow): SessionRecord {
  return {
    sessionHash: row.session_hash,
    googleSub: row.google_sub,
    email: row.email,
    name: row.name,
    picture: row.picture,
    trusted: row.trusted === 1,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
  }
}

export function createD1SessionStore(db: D1Database): SessionStore {
  return {
    async insert(record) {
      await db
        .prepare(
          `INSERT INTO auth_sessions
             (session_hash, google_sub, email, name, picture, trusted,
              created_at, last_seen_at, expires_at, revoked_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
        )
        .bind(
          record.sessionHash,
          record.googleSub,
          record.email,
          record.name,
          record.picture,
          record.trusted ? 1 : 0,
          record.createdAt,
          record.lastSeenAt,
          record.expiresAt,
        )
        .run()
    },

    async findByHash(sessionHash) {
      const row = await db
        .prepare(`SELECT * FROM auth_sessions WHERE session_hash = ?`)
        .bind(sessionHash)
        .first<SessionRow>()
      return row ? toSessionRecord(row) : null
    },

    async refresh(sessionHash, lastSeenAt, expiresAt) {
      await db
        .prepare(
          `UPDATE auth_sessions
              SET last_seen_at = ?, expires_at = ?
            WHERE session_hash = ? AND revoked_at IS NULL`,
        )
        .bind(lastSeenAt, expiresAt, sessionHash)
        .run()
    },

    async revoke(sessionHash, revokedAt) {
      await db
        .prepare(
          `UPDATE auth_sessions
              SET revoked_at = ?
            WHERE session_hash = ? AND revoked_at IS NULL`,
        )
        .bind(revokedAt, sessionHash)
        .run()
    },
  }
}

export function createD1OAuthStateStore(db: D1Database): OAuthStateStore {
  return {
    async insert(record) {
      await db
        .prepare(
          `INSERT INTO oauth_states
             (state_hash, nonce, code_verifier, return_to, trusted, created_at, expires_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          record.stateHash,
          record.nonce,
          record.codeVerifier,
          record.returnTo,
          record.trusted ? 1 : 0,
          record.createdAt,
          record.expiresAt,
        )
        .run()
    },

    async consume(stateHash) {
      // DELETE ... RETURNING makes single-use atomic: a replayed callback
      // deletes nothing and gets nothing back.
      const row = await db
        .prepare(`DELETE FROM oauth_states WHERE state_hash = ? RETURNING *`)
        .bind(stateHash)
        .first<StateRow>()

      if (!row) return null
      return {
        stateHash: row.state_hash,
        nonce: row.nonce,
        codeVerifier: row.code_verifier,
        returnTo: row.return_to,
        trusted: row.trusted === 1,
        createdAt: row.created_at,
        expiresAt: row.expires_at,
      } satisfies OAuthStateRecord
    },

    async deleteExpired(now) {
      await db.prepare(`DELETE FROM oauth_states WHERE expires_at <= ?`).bind(now).run()
    },
  }
}
