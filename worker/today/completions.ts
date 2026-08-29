/**
 * Today completion rules.
 *
 * The server stores which occurrences an account has ticked and nothing else.
 * NOW / NEXT / LATER / LATE / DONE EARLIER, ordering and spillover semantics
 * stay in the client engine — this module never computes a Today status.
 */

/** `<YYYY-MM-DD>:<item id>` — the occurrence identity accepted in Round 03. */
export type OccurrenceKey = string

export type CompletionRecord = {
  googleSub: string
  occurrenceKey: OccurrenceKey
  /** Date half of the occurrence key, derived from the key itself. */
  anchorDay: string
  completedAt: number
}

/**
 * Storage boundary. Keeping this an interface lets the rules be tested
 * directly and keeps the D1 implementation thin, matching the auth stores.
 */
export interface CompletionStore {
  listRange(googleSub: string, from: string, to: string): Promise<CompletionRecord[]>
  /** Insert only when absent, so a repeated complete keeps the first time. */
  insertIfAbsent(record: CompletionRecord): Promise<void>
  /** Delete when present; deleting an absent row is not an error. */
  remove(googleSub: string, occurrenceKey: OccurrenceKey): Promise<void>
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

/** Longest occurrence key accepted. Real keys are ~25 characters. */
export const MAX_OCCURRENCE_KEY_LENGTH = 80
/** Widest day range a single read may ask for. */
export const MAX_RANGE_DAYS = 31

const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/
/**
 * `<YYYY-MM-DD>:<item id>`. Item ids are lowercase slug segments — this is
 * data-integrity validation of the key's *shape*, not a second copy of the
 * routine catalog, which stays the client's single source of truth.
 */
const OCCURRENCE_PATTERN = /^(\d{4}-\d{2}-\d{2}):([a-z0-9]+(?:-[a-z0-9]+)*)$/

const MS_PER_DAY = 24 * 60 * 60 * 1000

/** True only for a real calendar date, so 2026-02-30 is rejected. */
export function isCalendarDay(value: string): boolean {
  const match = DAY_PATTERN.exec(value)
  if (!match) return false
  const [, year, month, day] = match.map(Number) as [number, number, number, number]
  const date = new Date(Date.UTC(year, month - 1, day))
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  )
}

export type ParsedOccurrence = { occurrenceKey: OccurrenceKey; anchorDay: string }

/**
 * Parse an occurrence key, or return null.
 *
 * The anchor day is taken from the key, never from a separate client field,
 * so the stored row can never disagree with the key it is filed under.
 */
export function parseOccurrenceKey(
  raw: string | null | undefined,
): ParsedOccurrence | null {
  if (typeof raw !== 'string') return null
  if (raw.length === 0 || raw.length > MAX_OCCURRENCE_KEY_LENGTH) return null

  const match = OCCURRENCE_PATTERN.exec(raw)
  if (!match) return null

  const anchorDay = match[1]
  if (!isCalendarDay(anchorDay)) return null

  return { occurrenceKey: raw, anchorDay }
}

export type ParsedRange = { from: string; to: string }

/** Validate an inclusive `from`/`to` day range for the read path. */
export function parseDayRange(
  from: string | null | undefined,
  to: string | null | undefined,
): ParsedRange | null {
  if (typeof from !== 'string' || typeof to !== 'string') return null
  if (!isCalendarDay(from) || !isCalendarDay(to)) return null
  if (from > to) return null

  const span = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / MS_PER_DAY
  if (span + 1 > MAX_RANGE_DAYS) return null

  return { from, to }
}

/* ------------------------------------------------------------------ */
/* Operations                                                          */
/* ------------------------------------------------------------------ */

/**
 * Mark an occurrence complete for one account. Idempotent: completing an
 * already-completed occurrence changes nothing, and in particular does not
 * move `completed_at`.
 */
export async function completeOccurrence(
  store: CompletionStore,
  googleSub: string,
  occurrence: ParsedOccurrence,
  now: number = Date.now(),
): Promise<CompletionRecord> {
  const record: CompletionRecord = {
    googleSub,
    occurrenceKey: occurrence.occurrenceKey,
    anchorDay: occurrence.anchorDay,
    completedAt: now,
  }
  await store.insertIfAbsent(record)
  return record
}

/** Undo a completion. Idempotent: undoing what is not there is not an error. */
export async function undoOccurrence(
  store: CompletionStore,
  googleSub: string,
  occurrence: ParsedOccurrence,
): Promise<void> {
  await store.remove(googleSub, occurrence.occurrenceKey)
}

/** Every completion this account has in the day range, oldest day first. */
export async function listCompletions(
  store: CompletionStore,
  googleSub: string,
  range: ParsedRange,
): Promise<CompletionRecord[]> {
  return store.listRange(googleSub, range.from, range.to)
}
