/**
 * Minimal in-memory stand-in for D1, covering exactly the statements the
 * Worker issues against `auth_sessions` and `today_completions`.
 *
 * Route-level tests use this so the real handler, the real D1 mapping layer
 * and the real rules all run together.
 */

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

type CompletionRow = {
  google_sub: string
  occurrence_key: string
  anchor_day: string
  completed_at: number
}

/** `google_sub` + `occurrence_key` — the table's primary key. */
function completionId(googleSub: string, occurrenceKey: string): string {
  return `${googleSub}\u0000${occurrenceKey}`
}

export function createFakeD1() {
  const sessions = new Map<string, SessionRow>()
  const completions = new Map<string, CompletionRow>()
  /** Set to make every `today_completions` statement throw, as D1 would. */
  let completionsFailure: Error | null = null

  function execute(sql: string, args: unknown[]) {
    if (sql.includes('today_completions')) {
      if (completionsFailure) throw completionsFailure

      if (sql.includes('SELECT')) {
        const [google_sub, from, to] = args as [string, string, string]
        return [...completions.values()]
          .filter(
            (row) =>
              row.google_sub === google_sub &&
              row.anchor_day >= from &&
              row.anchor_day <= to,
          )
          .sort((a, b) =>
            a.anchor_day === b.anchor_day
              ? a.occurrence_key.localeCompare(b.occurrence_key)
              : a.anchor_day.localeCompare(b.anchor_day),
          )
      }

      if (sql.includes('INSERT INTO today_completions')) {
        const [google_sub, occurrence_key, anchor_day, completed_at] = args as [
          string,
          string,
          string,
          number,
        ]
        const id = completionId(google_sub, occurrence_key)
        // ON CONFLICT DO NOTHING: the first write wins, completed_at included.
        if (!completions.has(id)) {
          completions.set(id, { google_sub, occurrence_key, anchor_day, completed_at })
        }
        return null
      }

      if (sql.includes('DELETE FROM today_completions')) {
        const [google_sub, occurrence_key] = args as [string, string]
        completions.delete(completionId(google_sub, occurrence_key))
        return null
      }

      throw new Error(`fakeD1 received an unexpected statement: ${sql}`)
    }

    if (sql.includes('INSERT INTO auth_sessions')) {
      const [
        session_hash,
        google_sub,
        email,
        name,
        picture,
        trusted,
        created_at,
        last_seen_at,
        expires_at,
      ] = args as [string, string, string, string | null, string | null, number, number, number, number]

      sessions.set(session_hash, {
        session_hash,
        google_sub,
        email,
        name,
        picture,
        trusted,
        created_at,
        last_seen_at,
        expires_at,
        revoked_at: null,
      })
      return null
    }

    if (sql.includes('SELECT * FROM auth_sessions')) {
      return sessions.get(args[0] as string) ?? null
    }

    if (sql.includes('SET last_seen_at')) {
      const [last_seen_at, expires_at, session_hash] = args as [number, number, string]
      const row = sessions.get(session_hash)
      if (row && row.revoked_at === null) {
        sessions.set(session_hash, { ...row, last_seen_at, expires_at })
      }
      return null
    }

    if (sql.includes('SET revoked_at')) {
      const [revoked_at, session_hash] = args as [number, string]
      const row = sessions.get(session_hash)
      if (row && row.revoked_at === null) {
        sessions.set(session_hash, { ...row, revoked_at })
      }
      return null
    }

    throw new Error(`fakeD1 received an unexpected statement: ${sql}`)
  }

  function prepare(sql: string) {
    const statement = {
      bind(...args: unknown[]) {
        return {
          async first<T>() {
            return execute(sql, args) as T | null
          },
          async all<T>() {
            return { results: (execute(sql, args) ?? []) as T[], success: true }
          },
          async run() {
            execute(sql, args)
            return { success: true }
          },
        }
      },
    }
    return statement
  }

  return {
    db: { prepare } as unknown as D1Database,
    sessions,
    completions,
    breakCompletions(error = new Error('D1 unavailable')) {
      completionsFailure = error
    },
  }
}
