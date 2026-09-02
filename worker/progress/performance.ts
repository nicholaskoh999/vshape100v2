import {
  normalizeBandLabel,
  parseBandCount,
  parseBandLabel,
  type WorkoutInputType,
} from '../../shared/workoutInput'
import {
  LOAD_MODES,
  readInputTypeSnapshot,
  RESULT_KINDS,
  type WorkoutLoadMode,
  type WorkoutResultKind,
} from '../../shared/workoutLog'

/**
 * Personal Bests and exercise performance, DERIVED from recorded history.
 *
 * Nothing here is stored. A PB is not a thing the user maintains; it is the
 * best set they actually completed, and it can be recomputed exactly from
 * workout_sets. A persisted "current PB" would be a second copy of that fact
 * which goes stale the moment a set is corrected.
 *
 * Everything in this file is a pure function over rows the store has already
 * filtered. That is deliberate: it means the ranking rules are tested directly
 * against fixtures rather than through a simulated SQL engine, so a test cannot
 * accidentally re-implement the logic it is checking.
 *
 * ## What may be compared with what
 *
 * Only sets sharing an identical COMPARABLE VARIANT compete:
 *
 *   canonical exercise id + result kind + load mode + per-side
 *     + input type + the exact band setup
 *
 * kg is not kg_each, per-side is not both-sides, reps are not seconds. These
 * are different measurement systems, and a "best" that spans two of them is
 * not a fact about anything. `kg_each` in particular stays PER DUMBBELL: 10 kg
 * each is never rewritten as 20 kg total.
 *
 * Round 20 adds the two that matter most for honesty:
 *
 *   - KILOGRAMS AND BANDS NEVER MEET. An exercise whose history is part legacy
 *     kilograms and part band work produces two variants, not one confused
 *     series. There is no conversion, so there is no comparison.
 *
 *   - BAND COLOURS ARE NEVER RANKED. The band label and count are part of the
 *     variant identity, so Black x3 and Red x3 are simply different variants.
 *     Nothing in this file claims one band is stronger than another — that is
 *     manufacturer-specific, and the app has no basis for the claim. Within one
 *     band setup, progress is measured the only way it honestly can be: reps,
 *     or seconds.
 *
 * ## What is deliberately absent
 *
 * No estimated 1RM. No tonnage or volume score. No progression suggestion.
 * Round 15 reports what happened; deciding what to do next is Round 16.
 */

/* ------------------------------------------------------------------ */
/* Input                                                               */
/* ------------------------------------------------------------------ */

/**
 * One completed set, as the store hands it over.
 *
 * The store is responsible for account scoping, the occurrence ownership join
 * and the completed-only filter. This file is responsible for whether a row is
 * READABLE and how readable rows rank.
 */
export type CompletedSetRow = {
  exerciseId: string
  exerciseName: string
  resultKind: string
  loadMode: string
  perSide: number
  loadValue: number | null
  loadUnit: string | null
  result: number
  workoutDate: string
  sessionId: string
  /** The occurrence's start time, for same-date recency. */
  startedAt: number
  /** Frozen at Start. Null on any row written before Round 20. */
  inputTypeSnapshot: string | null
  bandLabel: string | null
  bandCount: number | null
}

/**
 * A readable set that can take part in a comparison.
 *
 * For a LOADED reps variant `loadValue` is guaranteed non-null: a completed set
 * with no recorded load is real workout history but carries no load fact, and a
 * load fact is exactly what that variant ranks by. Such a set never reaches
 * this type — see `readSet`.
 */
export type EligibleSet = {
  exerciseId: string
  exerciseName: string
  resultKind: WorkoutResultKind
  loadMode: WorkoutLoadMode
  perSide: boolean
  /** How this set was loaded, as it was frozen when the workout started. */
  inputType: WorkoutInputType
  /** The exact band setup. Non-null exactly when `inputType` is resistance_band. */
  band: { label: string; count: number } | null
  /** Recorded load. Null only where the variant does not rank by load. */
  loadValue: number | null
  result: number
  workoutDate: string
  /** Local workout date plus session identify the occurrence. */
  sessionId: string
  /** When the occurrence was started. Breaks ties within one local date. */
  startedAt: number
}

/**
 * What a stored row turned out to be.
 *
 *   eligible        it can be compared within its variant
 *   non-comparable  real history, but it carries no fact this variant ranks by
 *   unreadable      a persisted enum was not one of the values it may be
 *
 * The middle case matters. A completed loaded set with no recorded load is
 * something a person genuinely did — they logged the reps and not the weight —
 * so it must not fail the account's whole read. But it cannot establish a
 * loaded best either, because there is no load to be best.
 */
export type ReadSetResult =
  | { status: 'eligible'; set: EligibleSet }
  | { status: 'non-comparable' }
  | { status: 'unreadable' }

/* ------------------------------------------------------------------ */
/* Reading a row                                                       */
/* ------------------------------------------------------------------ */

function isResultKind(value: string): value is WorkoutResultKind {
  return (RESULT_KINDS as readonly string[]).includes(value)
}

function isLoadMode(value: string): value is WorkoutLoadMode {
  return (LOAD_MODES as readonly string[]).includes(value)
}

/**
 * Read one stored row, or null when it cannot be read with certainty.
 *
 * Null is never "treat it as the default". An unknown result kind or load mode
 * has no comparable variant, and guessing one would file a set into a group it
 * may not belong to — which is precisely how a PB gets manufactured out of a
 * measurement that meant something else.
 */
export function readSet(row: CompletedSetRow): ReadSetResult {
  const unreadable = { status: 'unreadable' } as const

  if (!row.exerciseId || !isResultKind(row.resultKind) || !isLoadMode(row.loadMode)) {
    return unreadable
  }
  if (row.perSide !== 0 && row.perSide !== 1) return unreadable
  // A completed set carries a positive result; the schema enforces it, and a
  // row that somehow does not is not a performance.
  if (!Number.isFinite(row.result) || row.result <= 0) return unreadable

  // THE MODALITY, AND WHAT IT MAKES POSSIBLE.
  //
  // A row with no snapshot predates Round 20 and answers from its own frozen
  // load mode. A snapshot this build cannot name is unreadable — never assumed
  // to be kilograms, because filing band work into a kilogram series is exactly
  // the fiction this round removes.
  const inputType = readInputTypeSnapshot(row.inputTypeSnapshot, row.loadMode)
  if (inputType === null) return unreadable

  const bandLabel = parseBandLabel(row.bandLabel)
  const bandCount = parseBandCount(row.bandCount)
  // Half a band record is not a band record. A row that says "Black" but not
  // how many, or three of something unnamed, cannot be grouped with anything.
  if ((bandLabel === null) !== (bandCount === null)) return unreadable

  let band: { label: string; count: number } | null = null

  if (inputType === 'resistance_band') {
    // Bands and kilograms are mutually exclusive by construction. A row
    // carrying both contradicts itself and neither half can be trusted.
    if (row.loadValue !== null || row.loadUnit !== null) return unreadable
    if (row.loadMode !== 'none') return unreadable
    // A band set that cannot say WHICH band has no variant to belong to. It is
    // real history and stays in the log; it simply cannot be ranked.
    if (bandLabel === null || bandCount === null) return { status: 'non-comparable' }
    band = { label: bandLabel, count: bandCount }
  } else if (bandLabel !== null || bandCount !== null) {
    // A kilogram or bodyweight row carrying a band disagrees with its own
    // frozen modality.
    return unreadable
  }

  let loadValue: number | null = null

  if (row.loadMode === 'none') {
    // Load is not applicable, so a load value here means the row and its own
    // load mode disagree and neither can be trusted.
    if (row.loadValue !== null || row.loadUnit !== null) return unreadable
  } else if (row.loadValue === null) {
    if (row.loadUnit !== null) return unreadable
    // A loaded REPS variant ranks by load, and this set has none. It is real
    // history — the reps were logged and the weight was not — but it cannot
    // establish a best, cannot be a chart point, and must never fall back to
    // being ranked on reps: that would put kilograms and repetitions on one
    // axis and let a light long set outrank a heavy one.
    if (row.resultKind === 'reps') return { status: 'non-comparable' }
    // A timed variant ranks by seconds, so a missing load costs it nothing.
  } else {
    // A load whose unit disagrees with the variant's load mode cannot be
    // compared: 10 recorded as kg_each is twice the metal of 10 recorded as kg.
    if (row.loadUnit !== row.loadMode) return unreadable
    if (!Number.isFinite(row.loadValue) || row.loadValue < 0) return unreadable
    loadValue = row.loadValue
  }

  return {
    status: 'eligible',
    set: {
      exerciseId: row.exerciseId,
      exerciseName: row.exerciseName,
      resultKind: row.resultKind,
      loadMode: row.loadMode,
      perSide: row.perSide === 1,
      inputType,
      band,
      loadValue,
      result: row.result,
      workoutDate: row.workoutDate,
      sessionId: row.sessionId,
      startedAt: row.startedAt,
    },
  }
}

/* ------------------------------------------------------------------ */
/* Comparable variants                                                 */
/* ------------------------------------------------------------------ */

/**
 * The grouping identity, as a stable string.
 *
 * The canonical exercise id is the identity, NOT the display name: a name may
 * be edited between rounds, and history must keep grouping the same work
 * together when it is.
 *
 * The input type and the band setup are part of the identity, which is what
 * makes the two Round 20 guarantees structural rather than a rule someone has
 * to remember to apply:
 *
 *   - a band set and a kilogram set of the same exercise land in different
 *     buckets, so no comparison between them can even be expressed
 *   - Black x3 and Red x3 land in different buckets, so no code path ever has
 *     to decide which band is "stronger"
 *
 * The label is compared case-insensitively and trimmed, so "black" and "Black"
 * are one setup. That is the ONLY relation defined between labels; there is no
 * ordering, because there is no true one.
 */
export function variantKey(set: {
  exerciseId: string
  resultKind: WorkoutResultKind
  loadMode: WorkoutLoadMode
  perSide: boolean
  inputType: WorkoutInputType
  band: { label: string; count: number } | null
}): string {
  return [
    set.exerciseId,
    set.resultKind,
    set.loadMode,
    set.perSide ? 'side' : 'both',
    set.inputType,
    set.band ? `${normalizeBandLabel(set.band.label)}x${set.band.count}` : '-',
  ].join('|')
}

/* ------------------------------------------------------------------ */
/* Ranking                                                             */
/* ------------------------------------------------------------------ */

/** A performance, reduced to what may be compared within one variant. */
export type Performance = { loadValue: number | null; result: number }

/**
 * Is `a` a better performance than `b`, within one comparable variant?
 *
 * For LOADED reps the order is lexicographic: heaviest recorded load first,
 * and reps only as the tie-break. 50 kg × 6 therefore beats 45 kg × 15 — a
 * genuinely heavier completed set is not outranked by a lighter, longer one,
 * and no estimated 1RM is used to trade the two off.
 *
 * For unloaded reps, and for anything timed, there is a single axis: the
 * highest reps, or the longest hold. A load recorded against a timed variant
 * is not allowed to influence the ranking, because trading seconds against
 * kilograms would be inventing a strength score.
 *
 * A set with no recorded load never reaches here for a loaded variant: it is
 * filtered out as non-comparable long before ranking, because falling back to
 * reps would put kilograms and repetitions on one axis.
 */
export function isBetter(
  a: Performance,
  b: Performance,
  kind: { resultKind: WorkoutResultKind; loadMode: WorkoutLoadMode },
): boolean {
  const loaded = kind.resultKind === 'reps' && kind.loadMode !== 'none'

  if (loaded) {
    const aLoad = a.loadValue
    const bLoad = b.loadValue
    // Defensive, not a fallback: a null here would mean a non-comparable set
    // slipped through, and it must not win by accident.
    if (aLoad === null) return false
    if (bLoad === null) return true
    if (aLoad !== bLoad) return aLoad > bLoad
    return a.result > b.result
  }

  return a.result > b.result
}

/**
 * Chronological order of two occurrences within one account.
 *
 * Two sessions on one local date are genuinely separate occurrences, and which
 * came first is a fact the workout itself records — `started_at`. Falling back
 * to the session slug would order Monday before Wednesday alphabetically no
 * matter which was actually performed first.
 */
function earlier(a: Occurrence, b: Occurrence): boolean {
  if (a.workoutDate !== b.workoutDate) return a.workoutDate < b.workoutDate
  if (a.startedAt !== b.startedAt) return a.startedAt < b.startedAt
  // Same date and same instant: a stable tiebreak, so ordering is total.
  return a.sessionId < b.sessionId
}

type Occurrence = { workoutDate: string; sessionId: string; startedAt: number }

/* ------------------------------------------------------------------ */
/* Derived shapes                                                      */
/* ------------------------------------------------------------------ */

/** One factual point: the best set of one comparable variant in one workout. */
export type PerformancePoint = {
  date: string
  sessionId: string
  loadValue: number | null
  result: number
  /**
   * When that workout was started. Kept because it is the only fact that can
   * order two sessions on one local date, and stripped before the response —
   * the browser needs the order, not the clock.
   */
  startedAt: number
}

export type VariantPerformance = {
  key: string
  exerciseId: string
  exerciseName: string
  resultKind: WorkoutResultKind
  loadMode: WorkoutLoadMode
  perSide: boolean
  /** How this variant was loaded. Part of its identity, so it is uniform. */
  inputType: WorkoutInputType
  /** The exact band setup, when this variant is band work. */
  band: { label: string; count: number } | null
  /** The best completed set in all recorded history, or null when none ranks. */
  personalBest: PerformancePoint | null
  /** One point per workout occurrence, oldest first. */
  points: PerformancePoint[]
  /** The most recent occurrence this variant was performed in. */
  lastPerformed: string
  /** When that most recent occurrence started. Orders same-date variants. */
  lastPerformedAt: number
}

/* ------------------------------------------------------------------ */
/* Derivation                                                          */
/* ------------------------------------------------------------------ */

/** The occurrence a set belongs to: local workout date plus session. */
const occurrenceKey = (set: { workoutDate: string; sessionId: string }) =>
  `${set.workoutDate}|${set.sessionId}`

/**
 * Derive every comparable variant from a COMPLETE set of eligible sets.
 *
 * The completeness is the caller's guarantee, and it matters: a PB derived
 * from the newest N workouts is not an all-time PB, it is a recent best
 * wearing the wrong label.
 *
 * Variants come back most recently performed first, which is the order the
 * selector offers them in — the exercise trained today is the one most likely
 * to be looked at.
 */
export function derivePerformance(sets: readonly EligibleSet[]): VariantPerformance[] {
  const groups = new Map<string, EligibleSet[]>()
  for (const set of sets) {
    const key = variantKey(set)
    const bucket = groups.get(key)
    if (bucket) bucket.push(set)
    else groups.set(key, [set])
  }

  // The display name for a canonical exercise is taken from its most recent
  // snapshot across every variant, so a renamed exercise reads by its current
  // name without any historical row being rewritten.
  const names = new Map<string, { name: string } & Occurrence>()
  for (const set of sets) {
    const held = names.get(set.exerciseId)
    const here: Occurrence = {
      workoutDate: set.workoutDate,
      sessionId: set.sessionId,
      startedAt: set.startedAt,
    }
    if (!held || earlier(held, here)) names.set(set.exerciseId, { name: set.exerciseName, ...here })
  }

  const variants: VariantPerformance[] = []

  for (const [key, members] of groups) {
    const sample = members[0]
    const kind = { resultKind: sample.resultKind, loadMode: sample.loadMode }

    // One point per occurrence. An exercise repeated at two positions in the
    // same session contributes ONE point, derived from all of its eligible
    // completed sets in that workout — it was one workout, not two.
    const perOccurrence = new Map<string, PerformancePoint>()
    for (const set of members) {
      const id = occurrenceKey(set)
      const held = perOccurrence.get(id)
      const candidate: PerformancePoint = {
        date: set.workoutDate,
        sessionId: set.sessionId,
        loadValue: set.loadValue,
        result: set.result,
        startedAt: set.startedAt,
      }
      if (!held || isBetter(candidate, held, kind)) perOccurrence.set(id, candidate)
    }

    const points = [...perOccurrence.values()].sort((a, b) =>
      earlier(
        { workoutDate: a.date, sessionId: a.sessionId, startedAt: a.startedAt },
        { workoutDate: b.date, sessionId: b.sessionId, startedAt: b.startedAt },
      )
        ? -1
        : 1,
    )
    if (points.length === 0) continue

    // The all-time best across every occurrence. Repeating an identical
    // performance later is not a new, stronger PB, so a tie keeps the FIRST
    // date it was achieved — `isBetter` is strict, and points are already in
    // chronological order.
    let personalBest: PerformancePoint | null = null
    for (const point of points) {
      if (!personalBest || isBetter(point, personalBest, kind)) personalBest = point
    }

    variants.push({
      key,
      exerciseId: sample.exerciseId,
      exerciseName: names.get(sample.exerciseId)?.name ?? sample.exerciseName,
      resultKind: sample.resultKind,
      loadMode: sample.loadMode,
      perSide: sample.perSide,
      // Taken from a member rather than recomputed: both are part of the
      // variant key, so every member of this bucket agrees on them.
      inputType: sample.inputType,
      band: sample.band,
      personalBest,
      points,
      lastPerformed: points[points.length - 1].date,
      lastPerformedAt: points[points.length - 1].startedAt,
    })
  }

  // Most recently performed first. Two variants last performed on the same
  // local date are ordered by when those workouts actually STARTED, because a
  // morning and an evening session are genuinely one after the other and the
  // exercise name has nothing to do with which came last.
  return variants.sort((a, b) => {
    if (a.lastPerformed !== b.lastPerformed) return a.lastPerformed < b.lastPerformed ? 1 : -1
    if (a.lastPerformedAt !== b.lastPerformedAt) {
      return a.lastPerformedAt < b.lastPerformedAt ? 1 : -1
    }
    // Same date and same instant: a stable tiebreak, so the order is total.
    if (a.exerciseName !== b.exerciseName) return a.exerciseName < b.exerciseName ? -1 : 1
    return a.key < b.key ? -1 : 1
  })
}
