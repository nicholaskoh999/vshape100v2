import { isLocalDate } from './localDate'

/**
 * Account settings contract, shared by the Worker and the React app.
 *
 * One definition, so the Settings form and the API can never disagree about
 * what may be stored — the same split every other surface in this codebase
 * uses (shared/workoutLog.ts, shared/exerciseMedia.ts).
 *
 * IDENTITY IS NOT PART OF THIS SHAPE. The account is the `google_sub` on the
 * authenticated session, resolved server-side. There is no `googleSub` field in
 * any accepted payload here, so sending one changes nothing.
 */

/**
 * Day 1 of Foundation for an account that has never chosen one.
 *
 * This is a FALLBACK, not the runtime authority. Every existing account has
 * been counted from this date since Round 01, and an account that has expressed
 * no preference must keep reading exactly as it always has — nothing is
 * migrated, and no one is silently renumbered.
 */
export const DEFAULT_FOUNDATION_START = '2026-08-31'

/** How many days Foundation spans. Day 100 is derived, never a fixed date. */
export const FOUNDATION_TOTAL_DAYS = 100

/**
 * The settings an account owns.
 *
 * `foundationStartDate` is null when the user has not chosen one. Null is a
 * real answer — "no preference" — and is deliberately distinct from the default
 * it resolves to, so the UI can tell an explicit 2026-08-31 from an unset one.
 */
export type AccountSettings = {
  foundationStartDate: string | null
}

/** The settings of an account that has never saved any. */
export const EMPTY_ACCOUNT_SETTINGS: AccountSettings = {
  foundationStartDate: null,
}

/* ------------------------------------------------------------------ */
/* Reading a stored or transported value — fail closed                 */
/* ------------------------------------------------------------------ */

/**
 * What a stored or transported `foundationStartDate` turned out to be.
 *
 * Round 18 Correction 1 exists because these three were previously TWO: an
 * unreadable value was funnelled through `null` and became indistinguishable
 * from "no preference", so a corrupt row silently resolved to the legacy
 * 2026-08-31 and was then presented as an authoritative Day number. That is
 * fail-OPEN: the one case where we know least produced the most confident
 * answer, and it could be wrong by weeks with nothing on screen to suggest it.
 *
 *   unset      — no row, or a stored NULL. A real answer: the account has
 *                expressed no preference and keeps the legacy numbering.
 *   date       — a real Gregorian date. Use it.
 *   unreadable — present, but not something we can trust: an impossible date
 *                like 2026-02-30, a wrong type, or a shape a future schema
 *                might introduce. Refuse; never substitute a default.
 */
export type FoundationStartValue =
  | { kind: 'unset' }
  | { kind: 'date'; date: string }
  | { kind: 'unreadable' }

/**
 * Classify a raw value from D1 or from an API response.
 *
 * `undefined` counts as unset so that a body which simply omits the field reads
 * as "no preference" rather than as corruption; an explicitly present value that
 * is not a usable date is always unreadable, including the empty string.
 */
export function readFoundationStart(raw: unknown): FoundationStartValue {
  if (raw === null || raw === undefined) return { kind: 'unset' }
  if (typeof raw === 'string' && isLocalDate(raw)) return { kind: 'date', date: raw }
  return { kind: 'unreadable' }
}

/**
 * The start date actually in force, or an honest refusal.
 *
 * The single place the fallback is applied, so no consumer can invent its own
 * default and drift from the others — and the single place that can refuse, so
 * no consumer can turn corruption into a day number.
 *
 * This replaced `effectiveFoundationStart`, which returned a bare string and
 * therefore had no way to say "I do not know".
 */
export type FoundationStartResolution =
  | { status: 'ready'; startDate: string; persisted: string | null }
  | { status: 'unreadable' }

export function resolveFoundationStart(raw: unknown): FoundationStartResolution {
  const value = readFoundationStart(raw)
  if (value.kind === 'unreadable') return { status: 'unreadable' }
  if (value.kind === 'unset') {
    return { status: 'ready', startDate: DEFAULT_FOUNDATION_START, persisted: null }
  }
  return { status: 'ready', startDate: value.date, persisted: value.date }
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

/** Which part of a settings payload was rejected. Never echoes the value. */
export type SettingsField = 'body' | 'foundation_start_date'

export type ParsedSettingsUpdate =
  | { ok: true; value: AccountSettings }
  | { ok: false; field: SettingsField }

/**
 * Validate a Foundation start date.
 *
 * ANY real Gregorian date is accepted — past, today or future. A future start
 * is a legitimate choice: the app reports Foundation as upcoming rather than
 * inventing a Day 0 or a negative day.
 *
 * `isLocalDate` rejects impossible dates such as 2026-02-30 rather than letting
 * them roll over into March, which is the failure a shape-only check misses and
 * the one that would produce a silently wrong day number.
 */
export function parseFoundationStartDate(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  return isLocalDate(raw) ? raw : null
}

/**
 * Validate a settings update body.
 *
 * An explicit null clears the preference and returns the account to the legacy
 * default, which is a real thing to want and is not the same as an error.
 */
export function parseSettingsUpdate(body: unknown): ParsedSettingsUpdate {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, field: 'body' }
  }
  const raw = body as Record<string, unknown>

  const value = raw.foundationStartDate
  if (value === null) return { ok: true, value: { foundationStartDate: null } }
  if (value === undefined) return { ok: false, field: 'foundation_start_date' }

  const parsed = parseFoundationStartDate(value)
  if (parsed === null) return { ok: false, field: 'foundation_start_date' }
  return { ok: true, value: { foundationStartDate: parsed } }
}
