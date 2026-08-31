import { derivePerformance, readSet, type CompletedSetRow, type EligibleSet, type VariantPerformance } from './performance'

/**
 * Reading ALL of an account's completed sets, and proving that it did.
 *
 * "All-Time PB" has to mean all time. The existing workout history read is
 * paged — `GET /api/workouts/history?limit=N` returns the newest N — and a
 * best taken from the newest fifty workouts is a recent best with the wrong
 * label on it. A PB from six months ago that no longer appears in that page
 * would silently disappear, and the number on screen would be wrong in the one
 * direction a user cannot detect.
 *
 * So this reads in bounded chunks until the store says there are no more, and
 * carries a hard ceiling. Reaching the ceiling is NOT quietly truncated: the
 * read reports itself incomplete and the caller refuses to publish a PB. An
 * honest "cannot establish this" is the only alternative to a wrong number.
 */

/** Rows fetched per chunk. Large enough to be one round trip in practice. */
export const HISTORY_CHUNK = 500

/**
 * Hard ceiling on eligible completed sets examined.
 *
 * Five years of six sessions a week at forty sets a session is about 62,000,
 * so this is far beyond a real account and exists only so a pathological row
 * count cannot run a Worker out of time. Crossing it fails closed.
 */
export const MAX_HISTORY_SETS = 100_000

export type ProgressHistoryStore = {
  /**
   * A chunk of this account's COMPLETED sets, oldest first, stable order.
   *
   * The store is responsible for account scoping, the occurrence ownership
   * join, and excluding pending and skipped sets.
   */
  listCompletedSets(
    googleSub: string,
    limit: number,
    offset: number,
  ): Promise<CompletedSetRow[]>
}

export type PerformanceRead =
  | { complete: true; variants: VariantPerformance[]; examined: number }
  /**
   * The truth could not be established. No variant is published, because a
   * partial history can only produce a PB that is too low, and a PB that is
   * too low is indistinguishable from a correct one on screen.
   */
  | { complete: false; reason: 'truncated' | 'unreadable'; variants: [] }

/**
 * Read every eligible completed set and derive performance from all of it.
 *
 * A row that cannot be read with certainty fails the WHOLE read rather than
 * being dropped: the dropped row might have been the best set, and silently
 * omitting it would report a PB that is simply wrong. The database constrains
 * these columns already, so this is a guard against corruption, not a path a
 * healthy account takes.
 */
export async function readPerformance(
  store: ProgressHistoryStore,
  googleSub: string,
): Promise<PerformanceRead> {
  const eligible: EligibleSet[] = []
  let offset = 0

  for (;;) {
    const chunk = await store.listCompletedSets(googleSub, HISTORY_CHUNK, offset)

    for (const row of chunk) {
      const set = readSet(row)
      if (set === null) return { complete: false, reason: 'unreadable', variants: [] }
      eligible.push(set)
    }

    // A short chunk is the end of the history: the store had nothing more to
    // give, which is what makes this read provably complete.
    if (chunk.length < HISTORY_CHUNK) break

    offset += chunk.length
    if (offset >= MAX_HISTORY_SETS) {
      return { complete: false, reason: 'truncated', variants: [] }
    }
  }

  return { complete: true, variants: derivePerformance(eligible), examined: eligible.length }
}
