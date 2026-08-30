/**
 * In-memory implementations of the auth storage interfaces.
 *
 * These let the auth rules be tested directly — including the guarantee that
 * a raw session token never reaches storage.
 */

import type {
  ExerciseMediaRecord,
  ExerciseMediaStore,
} from '../exerciseMedia/media'
import type { OAuthStateRecord, OAuthStateStore } from '../auth/oauthState'
import type { SessionRecord, SessionStore } from '../auth/session'
import type { CompletionRecord, CompletionStore } from '../today/completions'

export function createMemorySessionStore() {
  const rows = new Map<string, SessionRecord>()

  const store: SessionStore = {
    async insert(record) {
      rows.set(record.sessionHash, { ...record })
    },
    async findByHash(sessionHash) {
      const row = rows.get(sessionHash)
      return row ? { ...row } : null
    },
    async refresh(sessionHash, lastSeenAt, expiresAt) {
      const row = rows.get(sessionHash)
      if (!row || row.revokedAt !== null) return
      rows.set(sessionHash, { ...row, lastSeenAt, expiresAt })
    },
    async revoke(sessionHash, revokedAt) {
      const row = rows.get(sessionHash)
      if (!row || row.revokedAt !== null) return
      rows.set(sessionHash, { ...row, revokedAt })
    },
  }

  return { store, rows }
}

export function createMemoryStateStore() {
  const rows = new Map<string, OAuthStateRecord>()

  const store: OAuthStateStore = {
    async insert(record) {
      rows.set(record.stateHash, { ...record })
    },
    async consume(stateHash) {
      const row = rows.get(stateHash)
      if (!row) return null
      // Single-use, exactly like DELETE ... RETURNING in D1.
      rows.delete(stateHash)
      return { ...row }
    },
    async deleteExpired(now) {
      for (const [key, row] of rows) {
        if (row.expiresAt <= now) rows.delete(key)
      }
    },
  }

  return { store, rows }
}

export function createMemoryCompletionStore() {
  const rows = new Map<string, CompletionRecord>()
  const id = (googleSub: string, occurrenceKey: string) =>
    `${googleSub}\u0000${occurrenceKey}`

  const store: CompletionStore = {
    async listRange(googleSub, from, to) {
      return [...rows.values()]
        .filter(
          (row) =>
            row.googleSub === googleSub &&
            row.anchorDay >= from &&
            row.anchorDay <= to,
        )
        .sort((a, b) => a.occurrenceKey.localeCompare(b.occurrenceKey))
        .map((row) => ({ ...row }))
    },
    async insertIfAbsent(record) {
      const key = id(record.googleSub, record.occurrenceKey)
      if (!rows.has(key)) rows.set(key, { ...record })
    },
    async remove(googleSub, occurrenceKey) {
      rows.delete(id(googleSub, occurrenceKey))
    },
  }

  return { store, rows }
}

/**
 * Canonical exercise media, keyed exactly as the table is: one row per
 * (account, exercise identity). No session ever enters the key.
 */
export function createMemoryExerciseMediaStore() {
  const rows = new Map<string, ExerciseMediaRecord>()

  const key = (googleSub: string, exerciseId: string) =>
    `${googleSub}\u0000${exerciseId}`

  const store: ExerciseMediaStore = {
    async list(googleSub) {
      return [...rows.values()]
        .filter((row) => row.googleSub === googleSub)
        .sort((a, b) =>
          a.updatedAt === b.updatedAt
            ? a.exerciseId.localeCompare(b.exerciseId)
            : b.updatedAt - a.updatedAt,
        )
        .map((row) => ({ ...row }))
    },
    async find(googleSub, exerciseId) {
      const row = rows.get(key(googleSub, exerciseId))
      return row ? { ...row } : null
    },
    async upsert(record) {
      // Replace, never append: the canonical invariant.
      rows.set(key(record.googleSub, record.exerciseId), { ...record })
    },
    async remove(googleSub, exerciseId) {
      rows.delete(key(googleSub, exerciseId))
    },
  }

  return { store, rows }
}
