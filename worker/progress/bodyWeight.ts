import {
  addLocalDays,
  isLocalDate,
} from '../../shared/localDate'
import {
  RANGE_DAYS,
  summariseEdges,
  type BodyWeightPoint,
  type BodyWeightRange,
  type BodyWeightSummary,
} from '../../shared/bodyWeight'

/**
 * Body-weight rules, independent of storage and of HTTP.
 *
 * The account key is always supplied by the caller from the authenticated
 * session. Nothing here reads an identity from a payload, and no function takes
 * one that a browser could have chosen.
 */

/** One stored measurement, as the store returns it. */
export type BodyWeightRecord = {
  googleSub: string
  localDate: string
  weightTenths: number
  createdAt: number
  updatedAt: number
}

export type BodyWeightStore = {
  /** Every measurement for this account, oldest first. */
  listAll(googleSub: string): Promise<BodyWeightRecord[]>
  /**
   * The ends of the whole history: newest two, oldest one, and the total.
   *
   * This is what a LIFETIME summary needs, and all it needs. Reading every row
   * to find three of them would be work for nothing, and shipping every row to
   * the browser so React could find them would be worse.
   */
  lifetimeEdges(googleSub: string): Promise<{
    newest: BodyWeightRecord[]
    oldest: BodyWeightRecord | null
    count: number
  }>
  /** Measurements within an inclusive local-date range, oldest first. */
  listRange(googleSub: string, from: string, to: string): Promise<BodyWeightRecord[]>
  /**
   * Store a measurement for one local date, replacing any that date already
   * holds. A repeated save for the same date is an update, never a second row.
   */
  save(record: {
    googleSub: string
    localDate: string
    weightTenths: number
    now: number
  }): Promise<void>
  /** Remove this account's measurement for a date. */
  remove(googleSub: string, localDate: string): Promise<void>
}

/**
 * The inclusive date window a range covers, ending Today.
 *
 * `30d` is the last 30 local calendar days INCLUDING today, so the window
 * starts 29 days back — counting 30 days back would quietly cover 31 days.
 *
 * Returns null for `all` (there is no lower bound) and for a today that is not
 * a real calendar date.
 */
export function rangeWindow(
  range: BodyWeightRange,
  today: string,
): { from: string; to: string } | null {
  if (range === 'all') return null
  if (!isLocalDate(today)) return null
  const from = addLocalDays(today, -(RANGE_DAYS[range] - 1))
  return from === null ? null : { from, to: today }
}

const toPoint = (record: BodyWeightRecord): BodyWeightPoint => ({
  date: record.localDate,
  tenths: record.weightTenths,
})

/**
 * Read the measurements a range covers, plus the LIFETIME summary.
 *
 * These are two different questions and they are answered separately on
 * purpose. The window decides what is DRAWN; it does not decide what "since
 * first" means. Deriving the summary from the window would silently redefine
 * the words — inside 30D, "since first" would quietly become "since the first
 * measurement in the last month", and the number would move every time
 * somebody changed the window.
 *
 * A bounded range is read as a range, not as "the newest N": a window needs
 * every measurement inside it, and a page could omit the oldest one.
 */
export async function readBodyWeight(
  store: BodyWeightStore,
  googleSub: string,
  range: BodyWeightRange,
  today: string,
): Promise<{ points: BodyWeightPoint[]; summary: BodyWeightSummary }> {
  const window = rangeWindow(range, today)

  const records =
    window === null
      ? await store.listAll(googleSub)
      : await store.listRange(googleSub, window.from, window.to)

  // Only real measurements become points. A date with no measurement is
  // absent — never zero, never carried forward from the day before, never
  // interpolated between two neighbours.
  const points: BodyWeightPoint[] = records.map(toPoint)

  const edges = await store.lifetimeEdges(googleSub)
  // `newest` is newest-first, so [0] is the latest and [1] the one before it.
  const summary = summariseEdges({
    latest: edges.newest[0] ? toPoint(edges.newest[0]) : null,
    previous: edges.newest[1] ? toPoint(edges.newest[1]) : null,
    first: edges.oldest ? toPoint(edges.oldest) : null,
    count: edges.count,
  })

  return { points, summary }
}
