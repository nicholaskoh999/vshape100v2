import { COMPANY_HOLIDAYS } from '../../shared/companyHolidays'

/**
 * Minimal in-memory stand-in for D1, covering exactly the statements the
 * Worker issues against `auth_sessions`, `today_completions`,
 * `exercise_media`, `exercise_input_types`, `workout_occurrences`, `workout_sets`,
 * `workout_set_corrections`,
 * `workout_calibration`, `account_settings` and `holiday_overrides`.
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

type HolidayRow = {
  id: string
  google_sub: string
  start_date: string
  end_date: string
  name: string
  /** 0 / 1, exactly as SQLite stores it. */
  training_on: number
  created_at: number
  updated_at: number
}

type PushSubscriptionRowShape = {
  id: string
  google_sub: string
  endpoint: string
  endpoint_hash: string
  p256dh: string
  auth: string
  timezone: string
  created_at: number
  updated_at: number
}

type DeliveryRowShape = {
  subscription_id: string
  google_sub: string
  trigger_minute: number
  claimed_at: number
  attempts: number
  status: string
}

/** One approved company date. Global: seeded by migration, never per account. */
type CompanyHolidayRow = { holiday_date: string; name: string }

/** One account's Training choice for a company date. */
type CompanyPreferenceRow = {
  google_sub: string
  holiday_date: string
  training_on: number
  updated_at: number
}

type OccurrenceRow = {
  google_sub: string
  workout_date: string
  session_id: string
  snapshot_id: string
  /** 0010: 'scheduled' | 'extra'. Defaults like the column's DEFAULT does. */
  kind: string
  source_session_id: string | null
  session_day_snapshot: string
  session_focus_snapshot: string
  session_intensity_snapshot: string
  started_at: number
  updated_at: number
  /**
   * Round 21. Optional because a seed that omits it is exactly an occurrence
   * written before Round 21 — the column exists but holds NULL — which is the
   * case the cancel guard must handle without being told.
   */
  touched_at?: number | null
}

/** Round 21. One immutable correction audit event. */
type CorrectionRow = {
  correction_id: string
  google_sub: string
  workout_date: string
  session_id: string
  exercise_order: number
  set_index: number
  corrected_at: number
  before_input_type: string | null
  before_load_mode: string
  before_load_value: number | null
  before_load_unit: string | null
  before_band_label: string | null
  before_band_count: number | null
  before_result: number | null
  after_input_type: string
  after_load_mode: string
  after_load_value: number | null
  after_load_unit: string | null
  after_band_label: string | null
  after_band_count: number | null
  after_result: number
}

type TrainingFlexRowShape = {
  google_sub: string
  local_date: string
  kind: string | null
  created_at: number
  updated_at: number
}

type AccountSettingsRow = {
  google_sub: string
  foundation_start_date: string | null
  created_at: number
  updated_at: number
}

type BodyWeightRow = {
  google_sub: string
  local_date: string
  weight_tenths_kg: number
  created_at: number
  updated_at: number
}

/** `google_sub` + `local_date` — the body_weight_entries primary key. */
function bodyWeightId(googleSub: string, localDate: string): string {
  return `${googleSub}|${localDate}`
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
  // Round 20's columns. Optional because a seed that omits them is exactly a
  // row written before Round 20 — the column exists but holds NULL — which is
  // the legacy case the production reader must handle without being told.
  input_type_snapshot?: string | null
  actual_band_label?: string | null
  actual_band_count?: number | null
}

/** One row of `exercise_input_types`. */
type InputTypeRowShape = {
  google_sub: string
  exercise_id: string
  input_type: string
  created_at: number
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

type CalibrationRow = {
  google_sub: string
  workout_date: string
  session_id: string
  exercise_order: number
  lane_fingerprint: string
  feedback: string
  observed_load_value: number
  observed_load_unit: string
  chosen_load_value: number | null
  chosen_load_unit: string | null
  created_at: number
  updated_at: number
}

/** The workout_calibration primary key: one judgement per occurrence slot. */
function calibrationId(
  googleSub: string,
  date: string,
  sessionId: string,
  exerciseOrder: number,
): string {
  return [googleSub, date, sessionId, exerciseOrder].join('\u0000')
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
  /** Round 20 input types, keyed the same way media is: account + exercise. */
  const inputTypes = new Map<string, InputTypeRowShape>()
  let inputTypesFailure: Error | null = null
  const holidays = new Map<string, HolidayRow>()
  // Seeded, because migration 0006 seeds it globally. A request path must
  // never write here, and no branch below does.
  const companyHolidays = new Map<string, CompanyHolidayRow>(
    COMPANY_HOLIDAYS.map((row) => [row.date, { holiday_date: row.date, name: row.name }]),
  )
  const companyPreferences = new Map<string, CompanyPreferenceRow>()
  // Keyed by endpoint_hash, mirroring the unique index: one browser endpoint
  // exists exactly once, whichever account holds it.
  const pushSubscriptions = new Map<string, PushSubscriptionRowShape>()
  const notificationDeliveries = new Map<string, DeliveryRowShape>()
  const accountSettings = new Map<string, AccountSettingsRow>()
  let settingsFailure: Error | null = null
  /** Round 19.2 training flex, keyed `google_sub\u0000local_date`. */
  const trainingFlex = new Map<string, TrainingFlexRowShape>()
  let trainingFlexFailure: Error | null = null
  const occurrences = new Map<string, OccurrenceRow>()
  const workoutSets = new Map<string, WorkoutSetRow>()
  /** Round 21 correction audit, keyed by correction_id. INSERT-ONLY. */
  const workoutSetCorrections = new Map<string, CorrectionRow>()
  const calibrations = new Map<string, CalibrationRow>()
  const bodyWeights = new Map<string, BodyWeightRow>()
  /** Set to make every Progress statement throw, as D1 would. */
  let progressFailure: Error | null = null
  /** Set to make every `today_completions` statement throw, as D1 would. */
  let completionsFailure: Error | null = null
  /** Set to make every `exercise_media` statement throw, as D1 would. */
  let mediaFailure: Error | null = null
  /** Set to make every workout statement throw, as D1 would. */
  let workoutFailure: Error | null = null
  /** Set to make every `holiday_overrides` statement throw, as D1 would. */
  let holidayFailure: Error | null = null
  /** Set to hold every Holiday write, so a race can be forced. */
  let holidayGate: Promise<void> | null = null
  /** Set to hold every training_flex write, so a race can be forced. */
  let trainingFlexGate: Promise<void> | null = null
  /** Round 21. Hold every ordinary set write, to force the cancel race. */
  let setWriteGate: Promise<void> | null = null
  /** Round 21. Hold every cancel write, to force the race the other way. */
  let cancelGate: Promise<void> | null = null
  /**
   * Round 21 Correction 3. Park ordinary set writes ONE AT A TIME.
   *
   * `setWriteGate` holds every set write on a single shared promise and frees
   * them all together, which is right for the cancel race but cannot express
   * the race that matters here: two requests that BOTH pre-read the same
   * version, then commit one after the other. That needs each parked write to
   * be released individually, in a chosen order.
   */
  let setWriteQueue: (() => void)[] | null = null
  /** Waiters for "n set writes are now parked", so no test has to poll. */
  let setWriteQueueWaiters: { count: number; resolve: () => void }[] = []

  /** Park the calling statement and hand back the promise it waits on. */
  function parkSetWrite(): Promise<void> {
    return new Promise<void>((resolve) => {
      setWriteQueue?.push(resolve)
      const parked = setWriteQueue?.length ?? 0
      setWriteQueueWaiters = setWriteQueueWaiters.filter((waiter) => {
        if (waiter.count > parked) return true
        waiter.resolve()
        return false
      })
    })
  }

  /**
   * The scheduled-provenance filter the progression reads carry, in the
   * stand-in.
   *
   * Applied only when the statement actually carries it, so a read that is
   * deliberately provenance-agnostic (the workout API, history) still sees
   * Extra and contradictory occurrences, while every progression read does not.
   *
   * It mirrors the WHOLE invariant, not just `kind`. Matching on `kind` alone
   * here would quietly re-open the very gap correction 2 closes: a row with
   * `kind = 'scheduled'` and a source session would be filtered by the real
   * SQL but admitted by this stand-in, and the regression proving it stays out
   * would pass against production code that let it in.
   */
  function scheduledOnly(sql: string, rows: OccurrenceRow[]) {
    if (!sql.includes("kind = 'scheduled'")) return rows
    const requiresNullSource = sql.includes('source_session_id IS NULL')
    return rows.filter(
      (row) =>
        row.kind === 'scheduled' &&
        // `IS NULL` in SQL is exactly null — an empty string does not satisfy
        // it, and neither does it here.
        (!requiresNullSource || row.source_session_id === null),
    )
  }

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

  /** `google_sub` + `id` — the holiday_overrides primary key. */
  function holidayId(googleSub: string, id: string): string {
    return `${googleSub}\u0000${id}`
  }

  function execute(sql: string, args: unknown[]) {
    // Dispatch on the statement's TARGET, not on any table it merely mentions.
    // Round 19 Correction 2 made each side's write name the other side's table
    // inside a guard subquery, so a plain `includes` would route the occurrence
    // claim into this branch and silently drop it.
    if (sql.includes('training_flex') && !sql.includes('INTO workout_occurrences')) {
      if (trainingFlexFailure) throw trainingFlexFailure

      if (sql.includes('INSERT INTO training_flex')) {
        const [google_sub, local_date, kind, created_at, updated_at] = args as [
          string, string, string, number, number,
        ]
        // Round 19 Correction 2 — the workout guard, modelled ONLY when the real
        // statement actually carries it. Same rule as the occurrence insert:
        // remove the `WHERE NOT EXISTS (... workout_occurrences ...)` from the
        // production SQL and this stops applying, so the forced-race test fails
        // rather than passing on the stand-in's goodwill.
        if (sql.includes('workout_occurrences')) {
          // The guard's own bindings follow the five inserted values.
          const guardSub = args[5] as string
          const guardDate = args[6] as string
          const guardSession = args[7] as string
          const started = [...occurrences.values()].some(
            (row) =>
              row.google_sub === guardSub &&
              row.workout_date === guardDate &&
              row.session_id === guardSession &&
              row.kind === 'scheduled',
          )
          if (started) return 0
        }

        const key = `${google_sub}\u0000${local_date}`
        const existing = trainingFlex.get(key)
        // ON CONFLICT DO UPDATE: one row per account per day, and `created_at`
        // is kept so a change of mind does not rewrite when the day was first
        // decided.
        trainingFlex.set(key, {
          google_sub,
          local_date,
          kind,
          created_at: existing?.created_at ?? created_at,
          updated_at,
        })
        return 1
      }

      if (sql.includes('DELETE FROM training_flex')) {
        const [google_sub, local_date] = args as [string, string]
        trainingFlex.delete(`${google_sub}\u0000${local_date}`)
        return null
      }

      if (sql.includes('SELECT')) {
        const [google_sub, from, to] = args as [string, string, string]
        return [...trainingFlex.values()]
          .filter(
            (row) =>
              row.google_sub === google_sub &&
              row.local_date >= from &&
              row.local_date <= to,
          )
          .sort((a, b) => (a.local_date < b.local_date ? -1 : 1))
      }

      throw new Error(`fakeD1 received an unexpected statement: ${sql}`)
    }

    if (sql.includes('account_settings')) {
      if (settingsFailure) throw settingsFailure

      if (sql.includes('INSERT INTO account_settings')) {
        const [google_sub, foundation_start_date, created_at, updated_at] = args as [
          string, string | null, number, number,
        ]
        const existing = accountSettings.get(google_sub)
        // ON CONFLICT DO UPDATE: one row per account, and `created_at` is kept
        // so a correction does not rewrite when the account first chose.
        accountSettings.set(google_sub, {
          google_sub,
          foundation_start_date,
          created_at: existing?.created_at ?? created_at,
          updated_at,
        })
        return null
      }

      if (sql.includes('SELECT')) {
        const [google_sub] = args as [string]
        return accountSettings.get(google_sub) ?? null
      }

      throw new Error(`fakeD1 received an unexpected statement: ${sql}`)
    }

    if (sql.includes('notification_deliveries')) {
      if (sql.includes('INSERT INTO notification_deliveries')) {
        const [subscription_id, google_sub, trigger_minute, claimed_at, maxAttempts] =
          args as [string, string, number, number, number]
        const key = subscription_id + ' ' + trigger_minute
        const existing = notificationDeliveries.get(key)

        if (!existing) {
          notificationDeliveries.set(key, {
            subscription_id,
            google_sub,
            trigger_minute,
            claimed_at,
            attempts: 1,
            status: 'claimed',
          })
          return 1
        }

        // ON CONFLICT ... DO UPDATE ... WHERE status = 'retryable' AND
        // attempts < ?. Any other state fails the WHERE, so the statement
        // changes zero rows and the caller knows it must not send.
        if (existing.status !== 'retryable' || existing.attempts >= maxAttempts) return 0

        notificationDeliveries.set(key, {
          ...existing,
          claimed_at,
          attempts: existing.attempts + 1,
          status: 'claimed',
        })
        return 1
      }

      if (sql.includes('UPDATE notification_deliveries')) {
        const [status, subscription_id, trigger_minute] = args as [string, string, number]
        const key = subscription_id + ' ' + trigger_minute
        const row = notificationDeliveries.get(key)
        if (!row) return 0
        notificationDeliveries.set(key, { ...row, status })
        return 1
      }

      if (sql.includes('DELETE FROM notification_deliveries')) {
        const [beforeMinute] = args as [number]
        let removed = 0
        for (const [key, row] of [...notificationDeliveries]) {
          if (row.trigger_minute < beforeMinute) {
            notificationDeliveries.delete(key)
            removed += 1
          }
        }
        return removed
      }

      throw new Error(`fakeD1 received an unexpected statement: ${sql}`)
    }

    if (sql.includes('push_subscriptions')) {
      if (sql.includes('INSERT INTO push_subscriptions')) {
        const [
          id, google_sub, endpoint, endpoint_hash, p256dh, auth, timezone,
          created_at, updated_at,
        ] = args as [string, string, string, string, string, string, string, number, number]

        // ON CONFLICT (endpoint_hash): re-enabling the same browser under a
        // different account REPLACES the owner rather than adding a row.
        const existing = pushSubscriptions.get(endpoint_hash)
        pushSubscriptions.set(endpoint_hash, {
          id,
          google_sub,
          endpoint,
          endpoint_hash,
          p256dh,
          auth,
          timezone,
          created_at: existing ? existing.created_at : created_at,
          updated_at,
        })
        return 1
      }

      if (sql.includes('DELETE FROM push_subscriptions')) {
        if (sql.includes('google_sub = ? AND endpoint_hash = ?')) {
          const [google_sub, endpoint_hash] = args as [string, string]
          const row = pushSubscriptions.get(endpoint_hash)
          // Account-scoped: another account's device is simply not matched.
          if (!row || row.google_sub !== google_sub) return 0
          pushSubscriptions.delete(endpoint_hash)
          return 1
        }
        const [id] = args as [string]
        for (const [key, row] of [...pushSubscriptions]) {
          if (row.id === id) {
            pushSubscriptions.delete(key)
            return 1
          }
        }
        return 0
      }

      if (sql.includes('WHERE endpoint_hash = ?')) {
        const [endpoint_hash] = args as [string]
        return pushSubscriptions.get(endpoint_hash) ?? null
      }

      if (sql.includes('SELECT')) {
        const [limit] = args as [number]
        return [...pushSubscriptions.values()]
          .sort((a, b) => a.created_at - b.created_at)
          .slice(0, limit)
      }

      throw new Error(`fakeD1 received an unexpected statement: ${sql}`)
    }

    if (sql.includes('company_holiday_preferences')) {
      if (holidayFailure) throw holidayFailure

      if (sql.includes('INSERT INTO company_holiday_preferences')) {
        const [google_sub, holiday_date, training_on, updated_at] = args as [
          string, string, number, number,
        ]
        // Upsert: the account may change its mind any number of times.
        companyPreferences.set(`${google_sub}\u0000${holiday_date}`, {
          google_sub,
          holiday_date,
          training_on,
          updated_at,
        })
        return 1
      }

      if (sql.includes('SELECT')) {
        const [google_sub, from, to] = args as [string, string, string]
        return [...companyPreferences.values()].filter(
          (row) =>
            row.google_sub === google_sub &&
            row.holiday_date >= from &&
            row.holiday_date <= to,
        )
      }

      throw new Error(`fakeD1 received an unexpected statement: ${sql}`)
    }

    if (sql.includes('company_holidays')) {
      if (holidayFailure) throw holidayFailure

      // Read-only by construction: there is no write branch here, so a GET
      // cannot seed the company calendar on demand.
      if (sql.includes('holiday_date = ?')) {
        const [date] = args as [string]
        return companyHolidays.get(date) ?? null
      }

      if (sql.includes('SELECT')) {
        const [from, to] = args as [string, string]
        return [...companyHolidays.values()]
          .filter((row) => row.holiday_date >= from && row.holiday_date <= to)
          .sort((a, b) => a.holiday_date.localeCompare(b.holiday_date))
      }

      throw new Error(`fakeD1 received an unexpected statement: ${sql}`)
    }

    if (sql.includes('holiday_overrides')) {
      if (holidayFailure) throw holidayFailure

      /** Inclusive intersection, the same test the real statements use. */
      const overlapping = (
        google_sub: string,
        start: string,
        end: string,
        excludeId?: string,
      ) =>
        [...holidays.values()].some(
          (row) =>
            row.google_sub === google_sub &&
            row.id !== excludeId &&
            row.start_date <= end &&
            row.end_date >= start,
        )

      // Writes are matched BEFORE the reads: both conditional statements
      // contain a SELECT (and the UPDATE contains `AND id = ?`), so matching
      // on those first would misroute them.
      if (sql.includes('INSERT INTO holiday_overrides')) {
        const [
          id,
          google_sub,
          start_date,
          end_date,
          name,
          training_on,
          created_at,
          updated_at,
          guard_sub,
          guard_end,
          guard_start,
        ] = args as [
          string, string, string, string, string, number, number, number,
          string, string, string,
        ]

        // WHERE NOT EXISTS (anything of this account intersecting the range).
        // Evaluated inside the statement, so a losing concurrent create writes
        // nothing rather than racing past a stale check.
        if (overlapping(guard_sub, guard_start, guard_end)) return 0

        holidays.set(holidayId(google_sub, id), {
          id,
          google_sub,
          start_date,
          end_date,
          name,
          training_on,
          created_at,
          updated_at,
        })
        return 1
      }

      // Training-only update: dates and name are absent from the statement,
      // so toggling training cannot move or rename the Holiday.
      if (sql.includes('UPDATE holiday_overrides') && sql.includes('SET training_on')) {
        const [training_on, updated_at, google_sub, id] = args as [
          number, number, string, string,
        ]
        const key = holidayId(google_sub, id)
        const row = holidays.get(key)
        if (!row) return 0
        holidays.set(key, { ...row, training_on, updated_at })
        return 1
      }

      if (sql.includes('UPDATE holiday_overrides')) {
        const [
          start_date,
          end_date,
          name,
          training_on,
          updated_at,
          google_sub,
          id,
          guard_sub,
          guard_id,
          guard_end,
          guard_start,
        ] = args as [
          string, string, string, number, number, string, string,
          string, string, string, string,
        ]

        const key = holidayId(google_sub, id)
        const row = holidays.get(key)
        // Ownership is part of the statement: an id that is not this
        // account's simply matches nothing.
        if (!row) return 0
        // The record being edited is excluded, so re-shaping it over its own
        // days is never a conflict with itself.
        if (overlapping(guard_sub, guard_start, guard_end, guard_id)) return 0

        holidays.set(key, { ...row, start_date, end_date, name, training_on, updated_at })
        return 1
      }

      if (sql.includes('DELETE FROM holiday_overrides')) {
        const [google_sub, id] = args as [string, string]
        return holidays.delete(holidayId(google_sub, id)) ? 1 : 0
      }

      if (sql.includes('AND id = ?')) {
        const [google_sub, id] = args as [string, string]
        return holidays.get(holidayId(google_sub, id)) ?? null
      }

      if (sql.includes('SELECT')) {
        const [google_sub, to, from] = args as [string, string, string]
        return [...holidays.values()]
          .filter(
            (row) =>
              row.google_sub === google_sub &&
              row.start_date <= to &&
              row.end_date >= from,
          )
          .sort((a, b) => {
            if (a.start_date !== b.start_date) {
              return a.start_date.localeCompare(b.start_date)
            }
            if (a.end_date !== b.end_date) return a.end_date.localeCompare(b.end_date)
            return a.id.localeCompare(b.id)
          })
      }

      throw new Error(`fakeD1 received an unexpected statement: ${sql}`)
    }

    if (sql.includes('body_weight_entries')) {
      if (progressFailure) throw progressFailure

      if (sql.includes('INSERT INTO body_weight_entries')) {
        const [google_sub, local_date, weight_tenths_kg, created_at, updated_at] = args as [
          string,
          string,
          number,
          number,
          number,
        ]
        const id = bodyWeightId(google_sub, local_date)
        const existing = bodyWeights.get(id)
        // ON CONFLICT (google_sub, local_date) DO UPDATE — the same date is
        // one entry, so this replaces the weight and keeps created_at.
        bodyWeights.set(id, {
          google_sub,
          local_date,
          weight_tenths_kg,
          created_at: existing?.created_at ?? created_at,
          updated_at,
        })
        return { changes: 1 }
      }

      if (sql.includes('DELETE FROM body_weight_entries')) {
        const [google_sub, local_date] = args as [string, string]
        const existed = bodyWeights.delete(bodyWeightId(google_sub, local_date))
        return { changes: existed ? 1 : 0 }
      }

      if (sql.includes('SELECT')) {
        const [google_sub] = args as [string]
        const mine = [...bodyWeights.values()].filter((row) => row.google_sub === google_sub)

        // The lifetime summary reads the ends of the history, never a window.
        if (sql.includes('COUNT(*) AS total')) {
          return { total: mine.length }
        }

        const ascending = [...mine].sort((a, b) => a.local_date.localeCompare(b.local_date))
        if (sql.includes('ORDER BY local_date DESC')) {
          return [...ascending].reverse().slice(0, 2)
        }
        if (sql.includes('LIMIT 1')) {
          // Read through `.first()`, so this hands back one row or null —
          // never a one-element array.
          return ascending[0] ?? null
        }

        // The ranged read binds (google_sub, from, to); listAll binds only the
        // account. Dates are zero-padded text, so comparison is exact.
        const ranged = sql.includes('local_date >= ?')
        const from = ranged ? (args[1] as string) : null
        const to = ranged ? (args[2] as string) : null

        return ascending.filter((row) =>
          from === null || to === null
            ? true
            : row.local_date >= from && row.local_date <= to,
        )
      }

      throw new Error(`fakeD1 received an unexpected statement: ${sql}`)
    }

    // The Progress completed-set read. Matched before the general workout
    // branches, because it names both workout tables and would otherwise be
    // misrouted. `LIMIT ? OFFSET ?` is unique to it: every other statement in
    // the Worker either takes no page or pages by limit alone.
    if (sql.includes('LIMIT ? OFFSET ?') && sql.includes('s.exercise_id_snapshot')) {
      if (progressFailure) throw progressFailure
      if (workoutFailure) throw workoutFailure

      const [google_sub, limit, offset] = args as [string, number, number]

      // ownedSets() IS the snapshot-token join: a set only counts under the
      // occurrence whose token it carries, so a losing Start's rows cannot
      // appear here any more than they can in D1. The occurrence's start time
      // travels with each set, exactly as the real JOIN carries o.started_at.
      return [...occurrences.values()]
        .filter((row) => row.google_sub === google_sub)
        .flatMap((occurrence) =>
          ownedSets(occurrence).map((set) => ({
            ...set,
            started_at: occurrence.started_at,
          })),
        )
        .filter((set) => set.status === 'completed' && set.actual_result !== null)
        .sort((a, b) => {
          if (a.workout_date !== b.workout_date) {
            return a.workout_date.localeCompare(b.workout_date)
          }
          if (a.session_id !== b.session_id) return a.session_id.localeCompare(b.session_id)
          if (a.exercise_order !== b.exercise_order) return a.exercise_order - b.exercise_order
          return a.set_index - b.set_index
        })
        .slice(offset, offset + limit)
        .map((set) => ({
          exercise_id_snapshot: set.exercise_id_snapshot,
          exercise_name_snapshot: set.exercise_name_snapshot,
          result_kind_snapshot: set.result_kind_snapshot,
          load_mode_snapshot: set.load_mode_snapshot,
          per_side_snapshot: set.per_side_snapshot,
          actual_load_value: set.actual_load_value,
          actual_load_unit: set.actual_load_unit,
          actual_result: set.actual_result,
          workout_date: set.workout_date,
          session_id: set.session_id,
          started_at: set.started_at,
        }))
    }

    // ---- Round 16 progression reads -------------------------------
    //
    // Matched BEFORE the general workout branches: each names a workout table
    // and would otherwise be misrouted onto a statement with different
    // bindings. Every one of them carries `google_sub`, exactly as the real
    // statement does, so account scoping is exercised rather than assumed.

    if (sql.includes('workout_calibration')) {
      if (workoutFailure) throw workoutFailure

      if (sql.includes('INSERT INTO workout_calibration')) {
        const [
          google_sub,
          workout_date,
          session_id,
          exercise_order,
          lane_fingerprint,
          feedback,
          observed_load_value,
          observed_load_unit,
          chosen_load_value,
          chosen_load_unit,
          created_at,
          updated_at,
        ] = args as [
          string, string, string, number, string, string, number, string,
          number | null, string | null, number, number,
        ]

        const id = calibrationId(google_sub, workout_date, session_id, exercise_order)
        const existing = calibrations.get(id)
        // ON CONFLICT DO UPDATE: one judgement per occurrence slot, replaced
        // rather than duplicated, and created_at is not rewritten.
        calibrations.set(id, {
          google_sub,
          workout_date,
          session_id,
          exercise_order,
          lane_fingerprint,
          feedback,
          observed_load_value,
          observed_load_unit,
          chosen_load_value,
          chosen_load_unit,
          created_at: existing?.created_at ?? created_at,
          updated_at,
        })
        return null
      }

      if (sql.includes('DELETE FROM workout_calibration')) {
        const [google_sub, workout_date, session_id, exercise_order] = args as [
          string, string, string, number,
        ]
        calibrations.delete(calibrationId(google_sub, workout_date, session_id, exercise_order))
        return null
      }

      if (sql.includes('SELECT')) {
        const [google_sub, workout_date, session_id] = args as [string, string, string]
        return [...calibrations.values()]
          .filter(
            (row) =>
              row.google_sub === google_sub &&
              row.workout_date === workout_date &&
              row.session_id === session_id,
          )
          .sort((a, b) => a.exercise_order - b.exercise_order)
      }

      throw new Error(`fakeD1 received an unexpected statement: ${sql}`)
    }

    // The earlier-occurrence date window: this session's occurrences strictly
    // before the workout being guided, newest first.
    if (sql.includes('FROM workout_occurrences') && sql.includes('workout_date < ?')) {
      if (workoutFailure) throw workoutFailure

      const [google_sub, session_id, before, limit] = args as [string, string, string, number]
      return scheduledOnly(sql, [...occurrences.values()])
        .filter(
          (row) =>
            row.google_sub === google_sub &&
            row.session_id === session_id &&
            row.workout_date < before,
        )
        .sort((a, b) => b.workout_date.localeCompare(a.workout_date))
        .slice(0, limit)
        .map((row) => ({ workout_date: row.workout_date }))
    }

    // The lane history read: every owned set of this session inside a
    // half-open local-date range.
    // Round 21 — the correction audit. Placed before the workout_sets branch
    // because these statements MENTION workout_sets in their guard; dispatch is
    // on the statement's TARGET, not on any table it happens to name.
    if (sql.includes('workout_set_corrections')) {
      if (workoutFailure) throw workoutFailure

      if (sql.includes('INSERT INTO workout_set_corrections')) {
        const [
          correction_id, google_sub, workout_date, session_id,
          exercise_order, set_index, corrected_at,
          before_input_type, before_load_mode, before_load_value,
          before_load_unit, before_band_label, before_band_count, before_result,
          after_input_type, after_load_mode, after_load_value,
          after_load_unit, after_band_label, after_band_count, after_result,
          // The guard's own bindings: the set, still completed, still at the
          // version the editor read.
          g_sub, g_date, g_session, g_order, g_index, g_updated,
        ] = args as [
          string, string, string, string, number, number, number,
          string | null, string, number | null, string | null,
          string | null, number | null, number | null,
          string, string, number | null, string | null,
          string | null, number | null, number,
          string, string, string, number, number, number,
        ]

        // WHERE EXISTS (the set in its expected PRE-state). Modelled ONLY when
        // the real statement actually carries the guard: strip it from the
        // production SQL and this stops applying it, so the coupling tests fail.
        if (sql.includes('WHERE EXISTS')) {
          const target = workoutSets.get(
            workoutSetId(g_sub, g_date, g_session, g_order, g_index),
          )
          const eligible =
            target !== undefined &&
            target.status === 'completed' &&
            target.updated_at === g_updated
          if (!eligible) return 0
        }

        // INSERT-ONLY, and the primary key means an event cannot be recorded
        // twice.
        if (workoutSetCorrections.has(correction_id)) return 0
        workoutSetCorrections.set(correction_id, {
          correction_id, google_sub, workout_date, session_id,
          exercise_order, set_index, corrected_at,
          before_input_type, before_load_mode, before_load_value,
          before_load_unit, before_band_label, before_band_count, before_result,
          after_input_type, after_load_mode, after_load_value,
          after_load_unit, after_band_label, after_band_count, after_result,
        })
        return 1
      }

      if (sql.includes('DELETE FROM workout_set_corrections')) {
        const [google_sub, cutoff] = args as [string, string]
        let removed = 0
        for (const [id, row] of [...workoutSetCorrections]) {
          if (row.google_sub === google_sub && row.workout_date < cutoff) {
            workoutSetCorrections.delete(id)
            removed += 1
          }
        }
        return removed
      }

      if (sql.includes('SELECT')) {
        const [google_sub, workout_date, session_id] = args as [string, string, string]
        const owned = [...workoutSetCorrections.values()]
          .filter(
            (row) =>
              row.google_sub === google_sub &&
              row.workout_date === workout_date &&
              row.session_id === session_id,
          )
          .sort((a, b) => a.corrected_at - b.corrected_at)

        // GROUP BY exercise_order, set_index with MAX(corrected_at) — when the
        // real statement asks for it. A set corrected twice reports the latest.
        if (sql.includes('GROUP BY')) {
          const latest = new Map<string, { exercise_order: number; set_index: number; corrected_at: number }>()
          for (const row of owned) {
            latest.set(`${row.exercise_order}|${row.set_index}`, {
              exercise_order: row.exercise_order,
              set_index: row.set_index,
              corrected_at: row.corrected_at,
            })
          }
          return [...latest.values()]
        }

        return owned
      }

      throw new Error(`fakeD1 received an unexpected statement: ${sql}`)
    }

    if (sql.includes('workout_sets') && sql.includes('s.workout_date >= ?')) {
      if (workoutFailure) throw workoutFailure

      const [google_sub, session_id, from, before, limit] = args as [
        string, string, string, string, number,
      ]
      return scheduledOnly(sql, [...occurrences.values()])
        .filter(
          (row) =>
            row.google_sub === google_sub &&
            row.session_id === session_id &&
            row.workout_date >= from &&
            row.workout_date < before,
        )
        // ownedSets() IS the snapshot-token join, so a losing Start's rows can
        // never become progression evidence.
        .flatMap((occurrence) => ownedSets(occurrence))
        .sort((a, b) => {
          if (a.workout_date !== b.workout_date) {
            return a.workout_date.localeCompare(b.workout_date)
          }
          if (a.exercise_order !== b.exercise_order) return a.exercise_order - b.exercise_order
          return a.set_index - b.set_index
        })
        .slice(0, limit)
    }

    if (sql.includes('LEFT JOIN workout_sets')) {
      if (workoutFailure) throw workoutFailure

      // Two shapes share this branch: the newest-N page binds
      // (google_sub, limit), and the range read binds (google_sub, from, to,
      // limit). An inclusive local-date span is plain text comparison.
      const ranged = sql.includes('o.workout_date >=')
      const [google_sub] = args as [string]
      const from = ranged ? (args[1] as string) : null
      const to = ranged ? (args[2] as string) : null
      const limit = (ranged ? args[3] : args[1]) as number

      return [...occurrences.values()]
        .filter((row) => row.google_sub === google_sub)
        .filter((row) =>
          from === null || to === null
            ? true
            : row.workout_date >= from && row.workout_date <= to,
        )
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
            kind: row.kind,
            source_session_id: row.source_session_id,
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

    // Dispatch is on the statement's TARGET, not on any table it happens to
    // name. Round 21's cancel DELETE targets workout_occurrences and mentions
    // workout_sets only inside its eligibility guard, so it must not be
    // swallowed here — the same hazard the Round 19 flex guard hit.
    if (sql.includes('workout_sets') && !sql.includes('DELETE FROM workout_occurrences')) {
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
          input_type_snapshot,
          actual_band_label,
          actual_band_count,
          // The WHERE EXISTS guard's own bindings.
          guard_sub,
          guard_date,
          guard_session,
          guard_snapshot,
        ] = args as [
          string, string, string, string, number, number,
          string, string, string, string | null, string, string, number,
          string, number | null, string | null, number | null, number,
          string | null, string | null, number | null,
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
            input_type_snapshot,
            actual_band_label,
            actual_band_count,
          })
        }
        return null
      }

      // Round 21 — the historical correction. A DIFFERENT statement from the
      // ordinary set update: it is the only one that may rewrite the frozen
      // modality, and it carries its own precondition.
      if (sql.includes('UPDATE workout_sets') && sql.includes('input_type_snapshot')) {
        const [
          input_type_snapshot, load_mode_snapshot,
          actual_load_value, actual_load_unit,
          actual_band_label, actual_band_count,
          actual_result, updated_at,
          google_sub, workout_date, session_id, exercise_order, set_index,
          expected_updated_at,
        ] = args as [
          string, string, number | null, string | null,
          string | null, number | null, number, number,
          string, string, string, number, number, number,
        ]
        const id = workoutSetId(google_sub, workout_date, session_id, exercise_order, set_index)
        const row = workoutSets.get(id)
        if (!row) return 0

        // The precondition, modelled ONLY where the real statement declares it.
        // Remove `status = 'completed'` or `updated_at = ?` from the production
        // SQL and this stops enforcing it, so the concurrency tests fail.
        if (sql.includes("status = 'completed'") && row.status !== 'completed') return 0
        if (sql.includes('updated_at = ?') && row.updated_at !== expected_updated_at) return 0

        // Only the factual performance columns move. Everything identifying the
        // set - date, session, exercise, order, index, prescription, result
        // kind, per-side, STATUS - is not in this statement at all.
        workoutSets.set(id, {
          ...row,
          input_type_snapshot,
          load_mode_snapshot,
          actual_load_value,
          actual_load_unit,
          actual_band_label,
          actual_band_count,
          actual_result,
          updated_at,
        })
        return 1
      }

      // Round 21 — cancelling an accidental Start removes the sets, gated on
      // the occurrence having actually gone.
      if (sql.includes('DELETE FROM workout_sets')) {
        const [google_sub, workout_date, session_id, g_sub, g_date, g_session] =
          args as [string, string, string, string, string, string]
        if (sql.includes('NOT EXISTS')) {
          // The guard is real: the children go only BECAUSE the parent went.
          if (occurrences.has(occurrenceId(g_sub, g_date, g_session))) return 0
        }
        let removed = 0
        for (const [id, row] of [...workoutSets]) {
          if (
            row.google_sub === google_sub &&
            row.workout_date === workout_date &&
            row.session_id === session_id
          ) {
            workoutSets.delete(id)
            removed += 1
          }
        }
        return removed
      }

      if (sql.includes('UPDATE workout_sets')) {
        const [
          status,
          actual_load_value,
          actual_load_unit,
          actual_band_label,
          actual_band_count,
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
          string | null,
          number | null,
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
        if (!row) {
          // Round 21: the row is gone, so the UPDATE matched nothing. Reporting
          // zero changes is what stops a set write that lost to Cancel Start
          // from returning a ghost success.
          return 0
        }
        // COMPARE-AND-SWAP, read off the REAL statement.
        //
        // The condition is applied only because the production SQL carries
        // `AND updated_at = ?`, and the value compared is the one production
        // actually bound {DASH} the trailing argument. If that clause were
        // dropped from the store, this branch would stop guarding too, and the
        // race regressions would fail. The stand-in must never be more correct
        // than the code it stands in for.
        if (sql.includes('AND updated_at = ?')) {
          const expected = args[args.length - 1] as number
          if (row.updated_at !== expected) return 0
        }
        workoutSets.set(id, {
          ...row,
          status,
          actual_load_value,
          actual_load_unit,
          actual_band_label,
          actual_band_count,
          actual_result,
          updated_at,
        })
        return 1
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
        const found = occurrences.get(occurrenceId(google_sub, workout_date, session_id))
        // Progression's join also carries `AND o.kind = 'scheduled'`.
        const owner = found ? scheduledOnly(sql, [found])[0] : undefined
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

      // INSERT is matched BEFORE SELECT here, because Round 19 Correction 2 made
      // the occurrence claim an `INSERT ... SELECT ... WHERE NOT EXISTS`. It
      // contains the word SELECT and is emphatically not a read.
      if (sql.includes('INSERT INTO workout_occurrences')) {
        const [
          google_sub,
          workout_date,
          session_id,
          snapshot_id,
          kind,
          source_session_id,
          session_day_snapshot,
          session_focus_snapshot,
          session_intensity_snapshot,
          started_at,
          updated_at,
          touched_at,
        ] = args as [
          string, string, string, string, string, string | null,
          string, string, string, number, number, number | null,
        ]
        const id = occurrenceId(google_sub, workout_date, session_id)

        // Round 19 Correction 2 — the flex guard, modelled ONLY when the real
        // statement actually carries it.
        //
        // The condition is read off the SQL the production store sent. Remove
        // the `WHERE NOT EXISTS (... training_flex ...)` from that statement and
        // this branch stops applying it, so the forced-race test fails. The
        // stand-in cannot "know the answer the test wants" — it only mirrors the
        // contract the statement itself declares.
        if (sql.includes('training_flex') && kind === 'scheduled') {
          const flexed = [...trainingFlex.values()].some(
            (row) => row.google_sub === google_sub && row.local_date === workout_date,
          )
          // The guard refuses: zero rows inserted. Every set insert is separately
          // gated on the occurrence carrying this token, so they write nothing
          // either — no extra modelling is needed here.
          if (flexed) return 0
        }

        // ON CONFLICT DO NOTHING: one occurrence per account + date + session.
        // This is what decides the winner of a concurrent first Start —
        // exactly one attempt's token reaches the table.
        if (!occurrences.has(id)) {
          occurrences.set(id, {
            google_sub,
            workout_date,
            session_id,
            snapshot_id,
            kind,
            source_session_id,
            session_day_snapshot,
            session_focus_snapshot,
            session_intensity_snapshot,
            started_at,
            updated_at,
            touched_at,
          })
          return 1
        }
        return 0
      }

      // Round 21 — Cancel Start. The eligibility decision travels INSIDE the
      // delete, and every condition below is modelled ONLY when the real
      // statement declares it. Strip a condition from the production SQL and
      // this stand-in stops enforcing it, so the guard's tests fail rather than
      // passing on the stand-in's own opinion.
      if (sql.includes('DELETE FROM workout_occurrences')) {
        const [google_sub, workout_date, session_id] = args as [string, string, string]
        const id = occurrenceId(google_sub, workout_date, session_id)
        const occurrence = occurrences.get(id)
        if (!occurrence) return 0

        if (sql.includes('touched_at IS NULL')) {
          if (occurrence.touched_at !== null && occurrence.touched_at !== undefined) return 0
        }

        if (sql.includes('NOT EXISTS')) {
          const owned = [...workoutSets.values()].filter(
            (row) =>
              row.google_sub === google_sub &&
              row.workout_date === workout_date &&
              row.session_id === session_id,
          )
          const disqualified = owned.some((row) => {
            if (sql.includes("s.status <> 'pending'") && row.status !== 'pending') return true
            if (sql.includes('s.actual_load_value IS NOT NULL') && row.actual_load_value !== null) return true
            if (sql.includes('s.actual_load_unit  IS NOT NULL') && row.actual_load_unit !== null) return true
            if (sql.includes('s.actual_band_label IS NOT NULL') && (row.actual_band_label ?? null) !== null) return true
            if (sql.includes('s.actual_band_count IS NOT NULL') && (row.actual_band_count ?? null) !== null) return true
            if (sql.includes('s.actual_result     IS NOT NULL') && row.actual_result !== null) return true
            if (
              sql.includes('s.updated_at <> workout_occurrences.started_at') &&
              row.updated_at !== occurrence.started_at
            ) {
              return true
            }
            return false
          })
          if (disqualified) return 0
        }

        occurrences.delete(id)
        return 1
      }

      if (sql.includes('SELECT')) {
        const [google_sub, workout_date, session_id] = args as [string, string, string]
        const row = occurrences.get(occurrenceId(google_sub, workout_date, session_id))
        if (!row) return null
        // The progression read carries `AND kind = 'scheduled'`; the workout
        // API's read does not. Honouring the difference is what lets a test
        // prove an Extra is invisible to progression but readable as a workout.
        return scheduledOnly(sql, [row])[0] ?? null
      }

      if (sql.includes('UPDATE workout_occurrences')) {
        const [updated_at, touched_at, google_sub, workout_date, session_id] = args as [
          number,
          number,
          string,
          string,
          string,
        ]
        const id = occurrenceId(google_sub, workout_date, session_id)
        const row = occurrences.get(id)
        if (row) {
          // COALESCE(touched_at, ?) — modelled only where the real statement
          // declares it. The marker records the FIRST touch and is never moved
          // or cleared, which is what stops a resolve-then-undo workout from
          // looking untouched.
          const marked = sql.includes('touched_at = COALESCE(touched_at, ?)')
            ? { touched_at: row.touched_at ?? touched_at }
            : {}
          occurrences.set(id, { ...row, updated_at, ...marked })
        }
        return null
      }

      throw new Error(`fakeD1 received an unexpected statement: ${sql}`)
    }

    if (sql.includes('exercise_input_types')) {
      if (inputTypesFailure) throw inputTypesFailure

      if (sql.includes('SELECT') && sql.includes('AND exercise_id = ?')) {
        const [google_sub, exercise_id] = args as [string, string]
        return inputTypes.get(mediaId(google_sub, exercise_id)) ?? null
      }

      if (sql.includes('SELECT')) {
        const [google_sub] = args as [string]
        return [...inputTypes.values()]
          .filter((row) => row.google_sub === google_sub)
          .sort((a, b) => a.exercise_id.localeCompare(b.exercise_id))
      }

      if (sql.includes('INSERT INTO exercise_input_types')) {
        const [google_sub, exercise_id, input_type, created_at, updated_at] = args as [
          string, string, string, number, number,
        ]
        const id = mediaId(google_sub, exercise_id)
        const existing = inputTypes.get(id)
        // ON CONFLICT DO UPDATE: input_type and updated_at are assignable,
        // created_at is not — the row remembers when it was first configured.
        inputTypes.set(id, {
          google_sub,
          exercise_id,
          input_type,
          created_at: existing ? existing.created_at : created_at,
          updated_at,
        })
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

    /*
     * ROUND 22. The programme tables.
     *
     * These suites exercise accounts that have NEVER edited their programme,
     * which is the fallback case: no revision row, so `resolveProgramme`
     * returns the shared Foundation seed and a Start freezes that. Answering
     * the reads as empty is therefore the truthful model of these accounts,
     * not a stub that hides anything — and it is what makes these tests assert
     * the REAL server-authoritative Start rather than a client-supplied plan.
     *
     * The programme WRITE path is deliberately not modelled here. It is proved
     * against real SQLite in src/test/programmeStore.test.ts, where the
     * compare-and-swap and batch atomicity can actually be observed.
     */
    if (sql.includes('FROM programme_revisions')) return null
    if (sql.includes('FROM programme_exercises')) return []
    if (sql.includes('FROM programme_slots')) return []

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
      /**
       * The statement's own SQL, so `batch` can tell which batch it is looking
       * at. Read off the REAL text the production store sent — never a label a
       * caller attaches — which is the same rule every guard in this file
       * follows.
       */
      sql,
      bind(...args: unknown[]) {
        const bound = {
          sql,
          /** Set by `batch` while this statement runs as part of one. */
          inBatch: false,
          async first<T>() {
            return execute(sql, args) as T | null
          },
          async all<T>() {
            return { results: (execute(sql, args) ?? []) as T[], success: true }
          },
          async run() {
            // D1 has a single writer, so statements commit one at a time. The
            // gate lets a test park two of them mid-flight and release them in
            // order, which is the window a check-then-write would lose.
            // Round 19 Correction 2: the flex write is a single statement, so
            // it parks here rather than at the batch gate. Parking it lets a
            // test drive BOTH sides past their pre-reads before either commits.
            const gate =
              // Never gate a statement that is running as part of a batch: the
              // batch already holds the single-writer lock, and taking it again
              // here would deadlock rather than model anything real. A batch is
              // parked as a whole, at the batch boundary.
              bound.inBatch
                ? null
                : holidayGate && sql.includes('holiday_overrides')
                ? holidayGate
                  : trainingFlexGate && sql.includes('INSERT INTO training_flex')
                    ? trainingFlexGate
                    : // Round 21. A set write is a single statement, so it
                      // parks here. Parking it lets a test drive it past its
                      // pre-read and hold it there while a cancellation
                      // commits.
                      setWriteGate && sql.includes('UPDATE workout_sets')
                      ? setWriteGate
                      : // Round 21 Correction 3. The same window, but parked
                        // per statement so two writes that both pre-read the
                        // same version can be committed in a chosen order.
                        setWriteQueue && sql.includes('UPDATE workout_sets')
                        ? parkSetWrite()
                        : null
            if (gate) {
              await gate
              const previous = writeChain
              let finished!: () => void
              writeChain = new Promise<void>((resolve) => {
                finished = resolve
              })
              await previous
              try {
                const gated = execute(sql, args)
                return {
                  success: true,
                  meta: { changes: typeof gated === 'number' ? gated : 0 },
                }
              } finally {
                finished()
              }
            }

            const result = execute(sql, args)
            // D1 reports affected rows; the Holiday delete uses it to tell
            // "removed" from "was never yours to remove".
            return {
              success: true,
              meta: { changes: typeof result === 'number' ? result : 0 },
            }
          },
        }
        return bound
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
  async function batch(
    statements: { run: () => Promise<unknown>; sql?: string; inBatch?: boolean }[],
  ) {
    if (batchGate) await batchGate
    // Round 21 Correction 1. Cancellation is ONE batch — parent and children
    // together — so it is parked as a whole. Identified by the statement text
    // the production store actually sent: split the parent delete back out of
    // the batch and this stops parking it, so the atomicity test fails rather
    // than passing on the stand-in's goodwill.
    // Round 21 Correction 1. The gate parks the batch that removes the CHILD
    // rows, which is the point that discriminates between the two shapes:
    //
    //   shipped (one batch)  the parent delete is in this same batch, so
    //                        parking it parks the whole unit BEFORE anything
    //                        commits — no intermediate state exists
    //   split (two boundaries) the parent has already committed by the time
    //                        this runs, so parking here holds the workout in
    //                        exactly the state the gap is made of: occurrence
    //                        gone, set rows still writable
    //
    // Keyed off the statement text the production store actually sent, so
    // restoring the split shape re-opens the window and the test fails.
    if (cancelGate && statements.some((s) => s.sql?.includes('DELETE FROM workout_sets'))) {
      await cancelGate
    }

    const previous = writeChain
    let finished!: () => void
    writeChain = new Promise<void>((resolve) => {
      finished = resolve
    })
    await previous

    // Set ONLY once the write lock is actually held, and cleared the moment the
    // statements are done. Setting it earlier would leave it true across the
    // await above, and a concurrent single statement would see it and skip its
    // own gate - which is not a lock this batch holds yet.
    // Mark THESE statements as belonging to a batch, rather than setting a
    // global flag: D1 holds one writer for the whole batch, so a gate inside it
    // would wait for a lock the batch itself holds — but an unrelated statement
    // running at the same moment must still be gated normally.
    for (const statement of statements) statement.inBatch = true
    try {
      const results = []
      for (const statement of statements) results.push(await statement.run())
      return results
    } finally {
      for (const statement of statements) statement.inBatch = false
      finished()
    }
  }

  return {
    db: { prepare, batch } as unknown as D1Database,
    sessions,
    completions,
    media,
    accountSettings,
    trainingFlex,
    occurrences,
    workoutSets,
    workoutSetCorrections,
    calibrations,
    holidays,
    companyHolidays,
    companyPreferences,
    pushSubscriptions,
    notificationDeliveries,
    bodyWeights,
    breakCompletions(error = new Error('D1 unavailable')) {
      completionsFailure = error
    },
    inputTypes,
    breakMedia(error = new Error('D1 unavailable')) {
      mediaFailure = error
    },
    /** Make every `exercise_input_types` statement throw, as D1 would. */
    breakInputTypes(error = new Error('D1 unavailable')) {
      inputTypesFailure = error
    },
    breakSettings(error = new Error('D1 unavailable')) {
      settingsFailure = error
    },
    /** Make every training_flex statement throw, as D1 would. */
    breakTrainingFlex(error = new Error('D1 unavailable')) {
      trainingFlexFailure = error
    },
    breakWorkouts(error = new Error('D1 unavailable')) {
      workoutFailure = error
    },
    breakHolidays(error = new Error('D1 unavailable')) {
      holidayFailure = error
    },
    breakProgress(error = new Error('D1 unavailable')) {
      progressFailure = error
    },
    /**
     * Hold every Holiday write until the returned function is called.
     *
     * Lets a test drive two mutations past their decision point and into
     * persistence before either commits — the window the conditional writes
     * exist to close. Released writes run one at a time, in arrival order.
     */
    /**
     * Hold every training-flex write until the returned function is called.
     *
     * The counterpart to `holdBatches` for the other side of the Round 19
     * exclusion, so a test can force either write order deterministically.
     */
    /**
     * Hold every ordinary set write until the returned function is called.
     *
     * Round 21: lets a test drive a set completion past its pre-read and park
     * it, then commit a cancellation, then release the set write — the exact
     * window a check-then-write would lose.
     */
    holdSetWrites() {
      let release!: () => void
      setWriteGate = new Promise<void>((resolve) => {
        release = resolve
      })
      return () => {
        setWriteGate = null
        release()
      }
    },
    /**
     * Park ordinary set writes individually and release them in order.
     *
     * Round 21 Correction 3. Lets a test drive two requests past their
     * pre-reads — so both genuinely hold the same version — and then
     * commit them one at a time. Nothing here depends on Promise timing: a
     * write is released only when the test says so.
     */
    queueSetWrites() {
      setWriteQueue = []
      setWriteQueueWaiters = []
      return {
        /** Resolves once `count` set writes are parked. */
        async waitForParked(count: number) {
          if ((setWriteQueue?.length ?? 0) >= count) return
          await new Promise<void>((resolve) => {
            setWriteQueueWaiters.push({ count, resolve })
          })
        },
        /** Commit the earliest still-parked write. */
        releaseNext() {
          const next = setWriteQueue?.shift()
          if (!next) throw new Error('no set write is parked')
          next()
        },
        parked: () => setWriteQueue?.length ?? 0,
        /** Stop queueing; anything still parked is released. */
        stop() {
          const remaining = setWriteQueue ?? []
          setWriteQueue = null
          setWriteQueueWaiters = []
          for (const release of remaining) release()
        },
      }
    },
    /** The same, for the cancel write, so the race can be forced either way. */
    holdCancelWrites() {
      let release!: () => void
      cancelGate = new Promise<void>((resolve) => {
        release = resolve
      })
      return () => {
        cancelGate = null
        release()
      }
    },
    holdTrainingFlexWrites() {
      let release!: () => void
      trainingFlexGate = new Promise<void>((resolve) => {
        release = resolve
      })
      return () => {
        release()
        trainingFlexGate = null
      }
    },
    holdHolidayWrites() {
      let release!: () => void
      holidayGate = new Promise<void>((resolve) => {
        release = resolve
      })
      return () => {
        holidayGate = null
        release()
      }
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
