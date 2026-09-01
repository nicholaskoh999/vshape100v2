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

/**
 * The start date actually in force.
 *
 * The single place the fallback is applied, so no consumer can invent its own
 * default and drift from the others.
 */
export function effectiveFoundationStart(settings: AccountSettings | null): string {
  const chosen = settings?.foundationStartDate
  return chosen && isLocalDate(chosen) ? chosen : DEFAULT_FOUNDATION_START
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
