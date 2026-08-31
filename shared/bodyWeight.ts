import { isLocalDate } from './localDate'
import { isIanaTimeZone, localDateIn } from './timeZone'

/**
 * Body weight contract and validation.
 *
 * Shared by the Worker (which decides what may be stored) and the React app
 * (which must not offer to save something the server will reject), following
 * shared/workoutLog.ts and shared/notifications/subscription.ts.
 *
 * ## Tenths of a kilogram, not a float
 *
 * The displayed precision is one decimal place, so a tenth of a kilogram is
 * the natural unit and 78.4 kg is carried as the integer 784. Storing 78.4 as
 * a REAL would read back as 78.40000000000001, and subtracting two such values
 * produces differences like -0.09999999999999432 — a change of "-0.1 kg" that
 * cannot be rendered without rounding away a real error. Integers make every
 * difference exact.
 *
 * ## Kilograms only
 *
 * There is no unit field, and no pounds. A stored number whose unit is implied
 * by whichever screen wrote it is how a 80 kg person becomes 80 lb; the unit is
 * fixed by the contract instead.
 *
 * ## More than one decimal place is a refusal, not a rounding
 *
 * 78.45 is not silently turned into 78.5 or 78.4. Quietly changing a number
 * somebody typed is worse than telling them it cannot be stored, because the
 * value they then read back is not the value they entered and they have no way
 * to know.
 */

/** Weight is carried in tenths of a kilogram. */
export const WEIGHT_SCALE = 10

/**
 * Technical safety bounds, in tenths of a kg — 0.1 kg to 1000.0 kg.
 *
 * Deliberately far outside any real human weight. This exists so a malformed
 * or hostile payload cannot store a nonsense number; it is NOT a judgement
 * about a healthy weight, and nothing in the app comments on the value.
 */
export const MIN_WEIGHT_TENTHS = 1
export const MAX_WEIGHT_TENTHS = 10_000

export type BodyWeightField = 'body' | 'date' | 'weight' | 'timezone' | 'future'

export type ParsedBodyWeight =
  | { ok: true; value: { localDate: string; weightTenths: number } }
  | { ok: false; field: BodyWeightField }

/**
 * A weight in kg to integer tenths, or null when it is not storable.
 *
 * Rejects — rather than repairs — NaN, Infinity, non-numbers, zero, negatives,
 * anything outside the safety bounds, and anything with more precision than one
 * decimal place.
 */
export function toWeightTenths(value: unknown): number | null {
  if (typeof value !== 'number') return null
  // NaN and ±Infinity both fail this; a number that is not finite is not a
  // measurement.
  if (!Number.isFinite(value)) return null
  if (value <= 0) return null

  // Round to the nearest tenth FIRST, then prove the rounding changed nothing.
  // Comparing `value * 10` to an integer directly would reject a perfectly
  // valid 78.4, because 78.4 * 10 is 783.9999999999999 in binary floating
  // point. Rounding and then checking the round-trip is exact for every value
  // a person can type at one decimal place, and still refuses 78.45.
  const tenths = Math.round(value * WEIGHT_SCALE)
  if (!Number.isSafeInteger(tenths)) return null
  if (Math.abs(tenths / WEIGHT_SCALE - value) > Number.EPSILON * Math.abs(value) * 8) {
    return null
  }

  if (tenths < MIN_WEIGHT_TENTHS || tenths > MAX_WEIGHT_TENTHS) return null
  return tenths
}

/** Tenths back to kilograms, e.g. 784 → 78.4. Exact at one decimal place. */
export function fromWeightTenths(tenths: number): number {
  return Math.round(tenths) / WEIGHT_SCALE
}

/** `784` → `"78.4"`. Always one decimal place, so 78.0 does not read as 78. */
export function formatWeight(tenths: number): string {
  const whole = Math.trunc(Math.abs(tenths) / WEIGHT_SCALE)
  const decimal = Math.abs(tenths) % WEIGHT_SCALE
  return `${tenths < 0 ? '-' : ''}${whole}.${decimal}`
}

/**
 * A signed difference in tenths, e.g. `+0.4` / `-1.2` / `0.0`.
 *
 * The sign is explicit because the direction is the whole point of the number,
 * and neither direction is presented as good or bad.
 */
export function formatWeightChange(tenths: number): string {
  if (tenths === 0) return '0.0'
  return `${tenths > 0 ? '+' : ''}${formatWeight(tenths)}`
}

/**
 * Which local date is "today" for this request.
 *
 * The browser sends its own IANA zone and the server derives the date in THAT
 * zone. Comparing against the server's UTC date instead would reject a genuine
 * local Today for several hours either side of midnight — 08:00 in Kuala
 * Lumpur is still yesterday in UTC.
 *
 * Returns null for a zone the platform does not recognise, so the caller
 * refuses the write rather than falling back to UTC.
 */
export function todayIn(timeZone: unknown, now: Date): string | null {
  if (!isIanaTimeZone(timeZone)) return null
  return localDateIn(now, timeZone)
}

/**
 * Validate the body of a weight write.
 *
 * The account is NOT part of this: it comes from the authenticated session
 * server-side and is never accepted from a payload.
 */
export function parseBodyWeightInput(body: unknown, now: Date): ParsedBodyWeight {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, field: 'body' }
  }
  const raw = body as Record<string, unknown>

  // The zone is validated before the date, because without a usable zone there
  // is no way to know whether the date is in the future.
  const today = todayIn(raw.timezone, now)
  if (today === null) return { ok: false, field: 'timezone' }

  if (!isLocalDate(raw.localDate)) return { ok: false, field: 'date' }
  // Past dates are a legitimate backfill. Future ones are not a measurement
  // that has happened, so they are refused as their own distinct failure.
  if (raw.localDate > today) return { ok: false, field: 'future' }

  const weightTenths = toWeightTenths(raw.weightKg)
  if (weightTenths === null) return { ok: false, field: 'weight' }

  return { ok: true, value: { localDate: raw.localDate, weightTenths } }
}

/* ------------------------------------------------------------------ */
/* Reporting                                                           */
/* ------------------------------------------------------------------ */

/** One stored measurement. */
export type BodyWeightPoint = {
  /** Local calendar date, `YYYY-MM-DD`. */
  date: string
  /** Weight in tenths of a kg. */
  tenths: number
}

/** Selectable reporting windows. `all` is every stored measurement. */
export type BodyWeightRange = '30d' | '90d' | 'all'

export const BODY_WEIGHT_RANGES: readonly BodyWeightRange[] = ['30d', '90d', 'all']

/** Days covered by a bounded window, counting Today as day 1. */
export const RANGE_DAYS: Record<Exclude<BodyWeightRange, 'all'>, number> = {
  '30d': 30,
  '90d': 90,
}

export function isBodyWeightRange(value: unknown): value is BodyWeightRange {
  return typeof value === 'string' && (BODY_WEIGHT_RANGES as readonly string[]).includes(value)
}

/**
 * What can honestly be said about the measurements.
 *
 * ## This is a LIFETIME summary, never a windowed one
 *
 * 30D / 90D / All choose which measurements are DRAWN. They do not change what
 * "since first" means. If someone started at 85.0 kg in January and is 79.0 kg
 * today, "since first" is -6.0 kg whichever window the chart is showing —
 * recomputing it inside 30D would answer a different question ("since the
 * first measurement in the last month") using the same words, and the number
 * would move every time the window changed.
 *
 * So the summary is derived from every stored measurement, independently of
 * the chart, and the server computes it directly rather than shipping the
 * whole history to the browser so React can find the ends of it.
 *
 * Every comparison that needs two measurements is null when there is only one,
 * because "no change" and "nothing to compare with" are different facts and
 * showing 0.0 for the second would be an invented claim.
 */
export type BodyWeightSummary = {
  latest: BodyWeightPoint | null
  previous: BodyWeightPoint | null
  first: BodyWeightPoint | null
  /** Latest minus previous, in tenths. Null with fewer than two measurements. */
  changeFromPrevious: number | null
  /** Latest minus first, in tenths. Null with fewer than two measurements. */
  changeFromFirst: number | null
  /** How many measurements exist in total — not how many the window shows. */
  count: number
}

/** The measurements a lifetime summary is built from. */
export type BodyWeightEdges = {
  latest: BodyWeightPoint | null
  previous: BodyWeightPoint | null
  first: BodyWeightPoint | null
  count: number
}

/**
 * Build the summary from the ends of the whole history.
 *
 * The caller supplies the newest two and the oldest measurement, which is all a
 * summary needs — reading every row to find three of them would be work for
 * nothing.
 */
export function summariseEdges(edges: BodyWeightEdges): BodyWeightSummary {
  const { latest, previous, first, count } = edges

  return {
    latest,
    previous,
    first,
    // Both require a second measurement. One is a fact; a change is not.
    changeFromPrevious:
      latest && previous && count >= 2 ? latest.tenths - previous.tenths : null,
    changeFromFirst: latest && first && count >= 2 ? latest.tenths - first.tenths : null,
    count,
  }
}

/**
 * Summarise a list of measurements directly. Input need not be sorted.
 *
 * Used where the whole history is already in hand. Nothing is interpolated and
 * nothing is filled: the points are the measurements that exist, and a gap
 * between two dates stays a gap.
 */
export function summariseBodyWeight(points: readonly BodyWeightPoint[]): BodyWeightSummary {
  const sorted = [...points].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  const count = sorted.length

  return summariseEdges({
    latest: sorted[count - 1] ?? null,
    previous: count >= 2 ? (sorted[count - 2] ?? null) : null,
    first: sorted[0] ?? null,
    count,
  })
}
