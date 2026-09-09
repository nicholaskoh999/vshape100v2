/**
 * Admin Lite / System Health contract, shared by the Worker and the React app.
 *
 * One definition of the wire shape, the same split every other surface in this
 * codebase uses (shared/settings.ts, shared/workoutLog.ts), so the page and the
 * API can never disagree about what an answer means.
 *
 * TWO RULES RUN THROUGH THIS WHOLE FILE.
 *
 * 1. UNKNOWN IS A FIRST-CLASS ANSWER. A health signal this build cannot prove
 *    is `'unknown'`, and a count it could not read is `null`. Neither is ever
 *    quietly rendered as "fine" or as `0`. A zero means the account really has
 *    zero rows; `null` means nobody knows.
 *
 * 2. IDENTITY IS NOT PART OF ANY SHAPE HERE. The account is the `google_sub` on
 *    the authenticated session, resolved server-side and never transported. No
 *    payload below carries an account key, so sending one changes nothing.
 */

/* ------------------------------------------------------------------ */
/* Health                                                              */
/* ------------------------------------------------------------------ */

/**
 * The four words the page is allowed to say about a subsystem.
 *
 * `unknown` is deliberately not an error tone: "this build cannot prove it" is
 * a different statement from "this is broken", and collapsing the two would
 * either cry wolf or — far worse — let an unproven thing look healthy.
 */
export type HealthStatus = 'healthy' | 'warning' | 'error' | 'unknown'

const HEALTH_STATUSES: readonly HealthStatus[] = ['healthy', 'warning', 'error', 'unknown']

/**
 * Why the cron / notification scheduler reads the way it does.
 *
 *   observed_sweep      a delivery claim was written recently, which is direct
 *                       evidence the scheduled handler ran. → healthy
 *   vapid_unconfigured  no VAPID keys, so the sweep can deliver nothing at all.
 *                       Provable from configuration. → warning
 *   no_observed_sweep   the ledger is readable and empty. This proves NOTHING:
 *                       claims are only written when something is actually due.
 *                       → unknown
 *   stale_observation   the newest claim is old. Also proves nothing, for the
 *                       same reason. → unknown
 *   unreadable          the ledger could not be read. → unknown
 *
 * There is no heartbeat in this app, so a healthy-looking cron can only ever be
 * inferred from work it actually did.
 */
export type CronReason =
  | 'observed_sweep'
  | 'vapid_unconfigured'
  | 'no_observed_sweep'
  | 'stale_observation'
  | 'unreadable'

const CRON_REASONS: readonly CronReason[] = [
  'observed_sweep',
  'vapid_unconfigured',
  'no_observed_sweep',
  'stale_observation',
  'unreadable',
]

export type AdminSystem = {
  /** The API answered this request. Nothing else can be inferred from that. */
  api: HealthStatus
  /** A trivial read against D1 succeeded, or it did not. */
  d1: HealthStatus
  cron: HealthStatus
  cronReason: CronReason
  /** Epoch ms of the newest observed delivery claim, or null. */
  cronLastSweepAt: number | null
  /** The running build's source SHA, when the deployment supplies one. */
  buildSha: string | null
  /** The newest applied D1 migration, when the ledger can be read. */
  migrationLevel: string | null
}

/* ------------------------------------------------------------------ */
/* Account                                                             */
/* ------------------------------------------------------------------ */

/**
 * The stored Foundation start date, with "unset" and "unreadable" kept apart.
 *
 * The same three-way split Round 18 Correction 1 introduced for settings, for
 * the same reason: an unreadable column presented as the default would be a
 * wrong Day 1 wearing the appearance of a right one.
 */
export type AdminFoundation =
  | { status: 'set'; date: string }
  | { status: 'unset' }
  | { status: 'unreadable' }

/**
 * The account's programme, as the revision ledger sees it.
 *
 *   seed     no revision row: the account has never edited, and reads the
 *            shared Foundation programme. A real answer, not a gap.
 *   edited   a stored revision.
 *   unknown  the ledger could not be read.
 */
export type AdminProgramme =
  | { status: 'seed' }
  | { status: 'edited'; revision: number; updatedAt: number }
  | { status: 'unknown' }

/**
 * NO EMAIL, AND NO ACCOUNT KEY, LIVE IN THIS SHAPE.
 *
 * The page already knows who is signed in: `/api/auth/session` is the app's one
 * authority on identity, and every screen reads it through the auth context.
 * Repeating the email here would mean a second server read of the same fact,
 * from a second query, with its own way of being stale or disagreeing — for a
 * value the page can simply be told once.
 */
export type AdminAccount = {
  foundation: AdminFoundation
  programme: AdminProgramme
  /** Push subscriptions on this account. null when unreadable. */
  pushDevices: number | null
  /** Live, unrevoked sessions on this account. null when unreadable. */
  activeSessions: number | null
}

/* ------------------------------------------------------------------ */
/* Activity                                                            */
/* ------------------------------------------------------------------ */

/**
 * Read-only counts, all scoped to the calling admin's own account.
 *
 * `null` means the count could not be read. It is NOT zero, and the page must
 * not render it as one.
 */
export type AdminActivity = {
  workoutOccurrences: number | null
  workoutSets: number | null
  bodyWeightEntries: number | null
  todayCompletions: number | null
  workoutCorrections: number | null
  trainingFlex: number | null
}

/** The activity keys, in the order the page shows them. */
export const ADMIN_ACTIVITY_KEYS = [
  'workoutOccurrences',
  'workoutSets',
  'bodyWeightEntries',
  'todayCompletions',
  'workoutCorrections',
  'trainingFlex',
] as const satisfies readonly (keyof AdminActivity)[]

/* ------------------------------------------------------------------ */
/* Maintenance                                                         */
/* ------------------------------------------------------------------ */

/**
 * Maintenance mode, reported honestly as DESIGNED BUT NOT WIRED.
 *
 * `state` is what the app would be in; `enforced` says whether anything in the
 * app actually acts on it; `controllable` says whether this build can change
 * it. In this spike the last two are false, because there is nowhere durable to
 * put a global flag without adding a migration — and adding one was explicitly
 * out of scope. See design/admin-lite/00_ADMIN_LITE_SPIKE.md.
 *
 * Reporting `state: 'off'` is not a guess: nothing in this build can turn it on.
 */
export type AdminMaintenance = {
  state: 'off' | 'on'
  enforced: boolean
  controllable: boolean
  /** A machine token for why control is unavailable. */
  reason: string
}

/* ------------------------------------------------------------------ */
/* Danger zone                                                         */
/* ------------------------------------------------------------------ */

/**
 * The Fresh Activity Reset, described and DELIBERATELY NOT OFFERED.
 *
 * There is no endpoint behind this. The reset is executed exclusively by the
 * accepted Round 25 operator under an explicit authorisation, and this API
 * carries no route, verb or parameter that could run it. `available` is a
 * constant `false` in the source, not a flag some future request could flip.
 */
export type AdminDangerZone = {
  freshActivityReset: {
    available: boolean
    /** Who does own it. */
    managedBy: string
  }
}

/* ------------------------------------------------------------------ */
/* The whole answer                                                    */
/* ------------------------------------------------------------------ */

export type AdminOverview = {
  system: AdminSystem
  account: AdminAccount
  activity: AdminActivity
  maintenance: AdminMaintenance
  dangerZone: AdminDangerZone
}

/* ------------------------------------------------------------------ */
/* Reading the envelope — fail closed                                  */
/* ------------------------------------------------------------------ */

export type AdminOverviewEnvelope =
  | { ok: true; overview: AdminOverview }
  | { ok: false; reason: 'malformed' }

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * A count, or `null` when it is not a number this page may show.
 *
 * Anything that is not a non-negative integer becomes Unknown rather than being
 * coerced — a negative, a float or a string count is a value nobody should be
 * reading as a row total.
 */
export function readCount(raw: unknown): number | null {
  if (typeof raw !== 'number') return null
  if (!Number.isInteger(raw) || raw < 0) return null
  return raw
}

/** Epoch milliseconds, or null. Same rule, without the non-negative integer bound. */
function readTimestamp(raw: unknown): number | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null
  return raw
}

/**
 * A health word, or `unknown`.
 *
 * An unrecognised status resolves DOWNWARDS, to unknown. That is the fail-closed
 * direction for a health signal: a word this client cannot interpret must never
 * be rendered as reassurance.
 */
export function readHealthStatus(raw: unknown): HealthStatus {
  return typeof raw === 'string' && (HEALTH_STATUSES as readonly string[]).includes(raw)
    ? (raw as HealthStatus)
    : 'unknown'
}

function readCronReason(raw: unknown): CronReason {
  return typeof raw === 'string' && (CRON_REASONS as readonly string[]).includes(raw)
    ? (raw as CronReason)
    : 'unreadable'
}

function readString(raw: unknown): string | null {
  return typeof raw === 'string' && raw.length > 0 ? raw : null
}

export function readFoundation(raw: unknown): AdminFoundation | null {
  if (!isObject(raw)) return null
  if (raw.status === 'set') {
    const date = readString(raw.date)
    return date === null ? { status: 'unreadable' } : { status: 'set', date }
  }
  if (raw.status === 'unset') return { status: 'unset' }
  if (raw.status === 'unreadable') return { status: 'unreadable' }
  return null
}

function readProgramme(raw: unknown): AdminProgramme | null {
  if (!isObject(raw)) return null
  if (raw.status === 'seed') return { status: 'seed' }
  if (raw.status === 'unknown') return { status: 'unknown' }
  if (raw.status === 'edited') {
    const revision = readCount(raw.revision)
    const updatedAt = readTimestamp(raw.updatedAt)
    // A revision we cannot read is not an edited programme we can describe.
    if (revision === null || updatedAt === null) return { status: 'unknown' }
    return { status: 'edited', revision, updatedAt }
  }
  return null
}

/**
 * Validate an overview response, then classify its fields.
 *
 * The ENVELOPE is checked before any value is read — the same order
 * shared/settings.ts uses — so "this is not the shape I speak" and "this value
 * is not usable" stay separate questions. A missing section is malformed; an
 * unusable value inside a present section degrades to Unknown.
 */
export function parseAdminOverview(body: unknown): AdminOverviewEnvelope {
  if (!isObject(body)) return { ok: false, reason: 'malformed' }

  const { system, account, activity, maintenance, dangerZone } = body
  if (
    !isObject(system) ||
    !isObject(account) ||
    !isObject(activity) ||
    !isObject(maintenance) ||
    !isObject(dangerZone)
  ) {
    return { ok: false, reason: 'malformed' }
  }

  const foundation = readFoundation(account.foundation)
  const programme = readProgramme(account.programme)
  if (foundation === null || programme === null) return { ok: false, reason: 'malformed' }

  const reset = dangerZone.freshActivityReset
  if (!isObject(reset)) return { ok: false, reason: 'malformed' }

  return {
    ok: true,
    overview: {
      system: {
        api: readHealthStatus(system.api),
        d1: readHealthStatus(system.d1),
        cron: readHealthStatus(system.cron),
        cronReason: readCronReason(system.cronReason),
        cronLastSweepAt: readTimestamp(system.cronLastSweepAt),
        buildSha: readString(system.buildSha),
        migrationLevel: readString(system.migrationLevel),
      },
      account: {
        foundation,
        programme,
        pushDevices: readCount(account.pushDevices),
        activeSessions: readCount(account.activeSessions),
      },
      activity: {
        workoutOccurrences: readCount(activity.workoutOccurrences),
        workoutSets: readCount(activity.workoutSets),
        bodyWeightEntries: readCount(activity.bodyWeightEntries),
        todayCompletions: readCount(activity.todayCompletions),
        workoutCorrections: readCount(activity.workoutCorrections),
        trainingFlex: readCount(activity.trainingFlex),
      },
      maintenance: {
        state: maintenance.state === 'on' ? 'on' : 'off',
        enforced: maintenance.enforced === true,
        controllable: maintenance.controllable === true,
        reason: readString(maintenance.reason) ?? 'unspecified',
      },
      dangerZone: {
        freshActivityReset: {
          // Availability must be stated explicitly as `true`. Anything else —
          // absent, a string, a number — reads as NOT available.
          available: reset.available === true,
          managedBy: readString(reset.managedBy) ?? 'unspecified',
        },
      },
    },
  }
}

/* ------------------------------------------------------------------ */
/* Reading the Foundation write's answer — fail closed                 */
/* ------------------------------------------------------------------ */

export type AdminFoundationEnvelope =
  | { ok: true; foundation: AdminFoundation }
  | { ok: false; reason: 'malformed' }

/**
 * Validate the answer to a Foundation start date write.
 *
 * The server re-reads the stored row and returns THAT, never an echo of what
 * was sent, so the page adopts persisted truth. A response this client cannot
 * read is refused rather than being optimistically treated as a success — a
 * write whose outcome is unknown must not be rendered as "saved".
 */
export function parseAdminFoundation(body: unknown): AdminFoundationEnvelope {
  if (!isObject(body)) return { ok: false, reason: 'malformed' }
  if (!Object.hasOwn(body, 'foundation')) return { ok: false, reason: 'malformed' }
  const foundation = readFoundation(body.foundation)
  if (foundation === null) return { ok: false, reason: 'malformed' }
  return { ok: true, foundation }
}
