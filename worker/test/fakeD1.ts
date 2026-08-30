/**
 * Minimal in-memory stand-in for D1, covering exactly the statements the
 * Worker issues against `auth_sessions`, `today_completions`,
 * `exercise_media`, `workout_occurrences` and `workout_sets`.
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

type MediaRow = {
  google_sub: string
  exercise_id: string
  media_type: string
  media_url: string
  media_alt: string
  updated_at: number
}

/** `google_sub` + `occurrence_key` — the table's primary key. */
function completionId(googleSub: string, occurrenceKey: string): string {
  return `${googleSub}\u0000${occurrenceKey}`
}

type OccurrenceRow = {
  google_sub: string
  workout_date: string
  session_id: string
  snapshot_id: string
  session_day_snapshot: string
  session_focus_snapshot: string
  session_intensity_snapshot: string
  started_at: number
  updated_at: number
}

type WorkoutSetRow = {
  google_sub: string
  workout_date: string
  session_id: string
  snapshot_id: string
  exercise_order: number
  set_index: number
  exercise_id_snapshot: string
  exercise_name_snapshot: string
  prescription_snapshot: string
  equipment_snapshot: string | null
  result_kind_snapshot: string
  load_mode_snapshot: string
  per_side_snapshot: number
  status: string
  actual_load_value: number | null
  actual_load_unit: string | null
  actual_result: number | null
  updated_at: number
}

/** `google_sub` + `exercise_id` — the exercise_media primary key. */
function mediaId(googleSub: string, exerciseId: string): string {
  return `${googleSub}\u0000${exerciseId}`
}

/** The workout_occurrences primary key. */
function occurrenceId(googleSub: string, date: string, sessionId: string): string {
  return [googleSub, date, sessionId].join('\u0000')
}

/** The workout_sets primary key. */
function workoutSetId(
  googleSub: string,
  date: string,
  sessionId: string,
  exerciseOrder: number,
  setIndex: number,
): string {
  return [googleSub, date, sessionId, exerciseOrder, setIndex].join('\u0000')
}

export function createFakeD1() {
  const sessions = new Map<string, SessionRow>()
  const completions = new Map<string, CompletionRow>()
  const media = new Map<string, MediaRow>()
  const occurrences = new Map<string, OccurrenceRow>()
  const workoutSets = new Map<string, WorkoutSetRow>()
  /** Set to make every `today_completions` statement throw, as D1 would. */
  let completionsFailure: Error | null = null
  /** Set to make every `exercise_media` statement throw, as D1 would. */
  let mediaFailure: Error | null = null
  /** Set to make every workout statement throw, as D1 would. */
  let workoutFailure: Error | null = null

  /** Sets that belong to an occurrence — the ownership join, in the stand-in. */
  function ownedSets(row: OccurrenceRow) {
    return [...workoutSets.values()].filter(
      (set) =>
        set.google_sub === row.google_sub &&
        set.workout_date === row.workout_date &&
        set.session_id === row.session_id &&
        set.snapshot_id === row.snapshot_id,
    )
  }

  function execute(sql: string, args: unknown[]) {
    // Checked before the generic workout_sets branch: both history statements
    // name that table too, and would otherwise be misrouted.
    if (sql.includes('LEFT JOIN workout_sets')) {
      if (workoutFailure) throw workoutFailure

      const [google_sub, limit] = args as [string, number]
      return [...occurrences.values()]
        .filter((row) => row.google_sub === google_sub)
        // ORDER BY workout_date DESC, started_at DESC, session_id ASC — a
        // total order, so the newest-first page is stable.
        .sort((a, b) => {
          if (a.workout_date !== b.workout_date) {
            return b.workout_date.localeCompare(a.workout_date)
          }
          if (a.started_at !== b.started_at) return b.started_at - a.started_at
          return a.session_id.localeCompare(b.session_id)
        })
        .slice(0, limit)
        .map((row) => {
          const sets = ownedSets(row)
          return {
            workout_date: row.workout_date,
            session_id: row.session_id,
            session_day_snapshot: row.session_day_snapshot,
            session_focus_snapshot: row.session_focus_snapshot,
            session_intensity_snapshot: row.session_intensity_snapshot,
            started_at: row.started_at,
            updated_at: row.updated_at,
            total_sets: sets.length,
            completed_sets: sets.filter((set) => set.status === 'completed').length,
            skipped_sets: sets.filter((set) => set.status === 'skipped').length,
          }
        })
    }

    if (sql.includes('AS recorded_workouts')) {
      if (workoutFailure) throw workoutFailure

      const [google_sub] = args as [string]
      const mine = [...occurrences.values()].filter((row) => row.google_sub === google_sub)
      const sets = mine.flatMap(ownedSets)
      return {
        recorded_workouts: mine.length,
        recorded_sets: sets.length,
        completed_sets: sets.filter((set) => set.status === 'completed').length,
        skipped_sets: sets.filter((set) => set.status === 'skipped').length,
      }
    }

    if (sql.includes('workout_sets')) {
      if (workoutFailure) throw workoutFailure

      // Checked before the SELECT branch: the guarded insert is itself an
      // INSERT ... SELECT, so matching on 'SELECT' first would misroute it.
      if (sql.includes('INSERT INTO workout_sets')) {
        const [
          google_sub,
          workout_date,
          session_id,
          snapshot_id,
          exercise_order,
          set_index,
          exercise_id_snapshot,
          exercise_name_snapshot,
          prescription_snapshot,
          equipment_snapshot,
          result_kind_snapshot,
          load_mode_snapshot,
          per_side_snapshot,
          status,
          actual_load_value,
          actual_load_unit,
          actual_result,
          updated_at,
          // The WHERE EXISTS guard's own bindings.
          guard_sub,
          guard_date,
          guard_session,
          guard_snapshot,
        ] = args as [
          string, string, string, string, number, number,
          string, string, string, string | null, string, string, number,
          string, number | null, string | null, number | null, number,
          string, string, string, string,
        ]

        // WHERE EXISTS (the occurrence carrying THIS snapshot's token).
        // A losing Start's token is not in the table, so the statement
        // inserts nothing — at any position, including ones the winner
        // never occupied.
        const owner = occurrences.get(occurrenceId(guard_sub, guard_date, guard_session))
        if (!owner || owner.snapshot_id !== guard_snapshot) return null

        // The composite foreign key, enforced structurally.
        if (owner.snapshot_id !== snapshot_id) return null

        const id = workoutSetId(google_sub, workout_date, session_id, exercise_order, set_index)
        // ON CONFLICT DO NOTHING: the first snapshot wins, so a later Start
        // cannot rewrite it.
        if (!workoutSets.has(id)) {
          workoutSets.set(id, {
            google_sub,
            workout_date,
            session_id,
            snapshot_id,
            exercise_order,
            set_index,
            exercise_id_snapshot,
            exercise_name_snapshot,
            prescription_snapshot,
            equipment_snapshot,
            result_kind_snapshot,
            load_mode_snapshot,
            per_side_snapshot,
            status,
            actual_load_value,
            actual_load_unit,
            actual_result,
            updated_at,
          })
        }
        return null
      }

      if (sql.includes('UPDATE workout_sets')) {
        const [
          status,
          actual_load_value,
          actual_load_unit,
          actual_result,
          updated_at,
          google_sub,
          workout_date,
          session_id,
          exercise_order,
          set_index,
        ] = args as [
          string,
          number | null,
          string | null,
          number | null,
          number,
          string,
          string,
          string,
          number,
          number,
        ]
        const id = workoutSetId(google_sub, workout_date, session_id, exercise_order, set_index)
        const row = workoutSets.get(id)
        // Only the live logging columns are assignable — the snapshot columns
        // and the ownership token are not part of this statement at all.
        if (row) {
          workoutSets.set(id, {
            ...row,
            status,
            actual_load_value,
            actual_load_unit,
            actual_result,
            updated_at,
          })
        }
        return null
      }

      if (sql.includes('AND exercise_order = ?')) {
        const [google_sub, workout_date, session_id, exercise_order, set_index] = args as [
          string,
          string,
          string,
          number,
          number,
        ]
        return (
          workoutSets.get(
            workoutSetId(google_sub, workout_date, session_id, exercise_order, set_index),
          ) ?? null
        )
      }

      if (sql.includes('SELECT')) {
        const [google_sub, workout_date, session_id] = args as [string, string, string]
        // JOIN workout_occurrences ON ... AND o.snapshot_id = s.snapshot_id
        const owner = occurrences.get(occurrenceId(google_sub, workout_date, session_id))
        if (!owner) return []
        return [...workoutSets.values()]
          .filter(
            (row) =>
              row.google_sub === google_sub &&
              row.workout_date === workout_date &&
              row.session_id === session_id &&
              row.snapshot_id === owner.snapshot_id,
          )
          .sort((a, b) =>
            a.exercise_order === b.exercise_order
              ? a.set_index - b.set_index
              : a.exercise_order - b.exercise_order,
          )
      }

      throw new Error(`fakeD1 received an unexpected statement: ${sql}`)
    }

    if (sql.includes('workout_occurrences')) {
      if (workoutFailure) throw workoutFailure

      if (sql.includes('SELECT')) {
        const [google_sub, workout_date, session_id] = args as [string, string, string]
        return occurrences.get(occurrenceId(google_sub, workout_date, session_id)) ?? null
      }

      if (sql.includes('INSERT INTO workout_occurrences')) {
        const [
          google_sub,
          workout_date,
          session_id,
          snapshot_id,
          session_day_snapshot,
          session_focus_snapshot,
          session_intensity_snapshot,
          started_at,
          updated_at,
        ] = args as [
          string, string, string, string, string, string, string, number, number,
        ]
        const id = occurrenceId(google_sub, workout_date, session_id)
        // ON CONFLICT DO NOTHING: one occurrence per account + date + session.
        // This is what decides the winner of a concurrent first Start —
        // exactly one attempt's token reaches the table.
        if (!occurrences.has(id)) {
          occurrences.set(id, {
            google_sub,
            workout_date,
            session_id,
            snapshot_id,
            session_day_snapshot,
            session_focus_snapshot,
            session_intensity_snapshot,
            started_at,
            updated_at,
          })
        }
        return null
      }

      if (sql.includes('UPDATE workout_occurrences')) {
        const [updated_at, google_sub, workout_date, session_id] = args as [
          number,
          string,
          string,
          string,
        ]
        const id = occurrenceId(google_sub, workout_date, session_id)
        const row = occurrences.get(id)
        if (row) occurrences.set(id, { ...row, updated_at })
        return null
      }

      throw new Error(`fakeD1 received an unexpected statement: ${sql}`)
    }

    if (sql.includes('exercise_media')) {
      if (mediaFailure) throw mediaFailure

      if (sql.includes('SELECT') && sql.includes('AND exercise_id = ?')) {
        const [google_sub, exercise_id] = args as [string, string]
        return media.get(mediaId(google_sub, exercise_id)) ?? null
      }

      if (sql.includes('SELECT')) {
        const [google_sub] = args as [string]
        return [...media.values()]
          .filter((row) => row.google_sub === google_sub)
          .sort((a, b) =>
            a.updated_at === b.updated_at
              ? a.exercise_id.localeCompare(b.exercise_id)
              : b.updated_at - a.updated_at,
          )
      }

      if (sql.includes('INSERT INTO exercise_media')) {
        const [google_sub, exercise_id, media_type, media_url, media_alt, updated_at] =
          args as [string, string, string, string, string, number]
        // ON CONFLICT DO UPDATE: the one row for this account + exercise is
        // replaced, never duplicated.
        media.set(mediaId(google_sub, exercise_id), {
          google_sub,
          exercise_id,
          media_type,
          media_url,
          media_alt,
          updated_at,
        })
        return null
      }

      if (sql.includes('DELETE FROM exercise_media')) {
        const [google_sub, exercise_id] = args as [string, string]
        media.delete(mediaId(google_sub, exercise_id))
        return null
      }

      throw new Error(`fakeD1 received an unexpected statement: ${sql}`)
    }

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

  /** Set to hold every batch until released, so a race can be forced. */
  let batchGate: Promise<void> | null = null
  /** D1 has a single writer: batches commit one at a time, never interleaved. */
  let writeChain: Promise<void> = Promise.resolve()

  /**
   * D1 runs a batch as one transaction against a single writer.
   *
   * Both properties matter for the Start claim: the statements of one batch
   * are never interleaved with another's, and each batch sees the committed
   * result of the batches before it. Without that, a guarded insert could
   * read a stale occurrence.
   */
  async function batch(statements: { run: () => Promise<unknown> }[]) {
    if (batchGate) await batchGate

    const previous = writeChain
    let finished!: () => void
    writeChain = new Promise<void>((resolve) => {
      finished = resolve
    })
    await previous

    try {
      const results = []
      for (const statement of statements) results.push(await statement.run())
      return results
    } finally {
      finished()
    }
  }

  return {
    db: { prepare, batch } as unknown as D1Database,
    sessions,
    completions,
    media,
    occurrences,
    workoutSets,
    breakCompletions(error = new Error('D1 unavailable')) {
      completionsFailure = error
    },
    breakMedia(error = new Error('D1 unavailable')) {
      mediaFailure = error
    },
    breakWorkouts(error = new Error('D1 unavailable')) {
      workoutFailure = error
    },
    /**
     * Hold every batch until the returned function is called.
     *
     * Lets a test drive two first Starts past their "is it started?" read and
     * into persistence before either commits — the window the ownership token
     * exists to close. Held batches resume in the order they arrived.
     */
    holdBatches() {
      let release!: () => void
      batchGate = new Promise<void>((resolve) => {
        release = resolve
      })
      return () => {
        batchGate = null
        release()
      }
    },
  }
}
