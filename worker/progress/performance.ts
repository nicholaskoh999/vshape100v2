import {
  LOAD_MODES,
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
 *
 * kg is not kg_each, per-side is not both-sides, reps are not seconds. These
 * are different measurement systems, and a "best" that spans two of them is
 * not a fact about anything. `kg_each` in particular stays PER DUMBBELL: 10 kg
 * each is never rewritten as 20 kg total.
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
}

/** A readable set: every persisted enum was one of the values it may be. */
export type EligibleSet = {
  exerciseId: string
  exerciseName: string
  resultKind: WorkoutResultKind
  loadMode: WorkoutLoadMode
  perSide: boolean
  /** Recorded load, in the unit the variant names. Null when none was recorded. */
  loadValue: number | null
  result: number
  workoutDate: string
  sessionId: string
}

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
export function readSet(row: CompletedSetRow): EligibleSet | null {
  if (!row.exerciseId || !isResultKind(row.resultKind) || !isLoadMode(row.loadMode)) {
    return null
  }
  if (row.perSide !== 0 && row.perSide !== 1) return null
  // A completed set carries a positive result; the schema enforces it, and a
  // row that somehow does not is not a performance.
  if (!Number.isFinite(row.result) || row.result <= 0) return null

  let loadValue: number | null = null

  if (row.loadMode === 'none') {
    // Load is not applicable, so a load value here means the row and its own
    // load mode disagree and neither can be trusted.
    if (row.loadValue !== null || row.loadUnit !== null) return null
  } else if (row.loadValue === null) {
    // A loaded set may legitimately carry no recorded load: the person logged
    // the reps and not the weight. That is a real state, not a corrupt one, so
    // it is readable — it simply has no load fact and cannot be ranked by load.
    if (row.loadUnit !== null) return null
  } else {
    // A load whose unit disagrees with the variant's load mode cannot be
    // compared: 10 recorded as kg_each is twice the metal of 10 recorded as kg.
    if (row.loadUnit !== row.loadMode) return null
    if (!Number.isFinite(row.loadValue) || row.loadValue < 0) return null
    loadValue = row.loadValue
  }

  return {
    exerciseId: row.exerciseId,
    exerciseName: row.exerciseName,
    resultKind: row.resultKind,
    loadMode: row.loadMode,
    perSide: row.perSide === 1,
    loadValue,
    result: row.result,
    workoutDate: row.workoutDate,
    sessionId: row.sessionId,
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
 */
export function variantKey(set: {
  exerciseId: string
  resultKind: WorkoutResultKind
  loadMode: WorkoutLoadMode
  perSide: boolean
}): string {
  return [set.exerciseId, set.resultKind, set.loadMode, set.perSide ? 'side' : 'both'].join('|')
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
 * A set with no recorded load never outranks one that has a load: it carries
 * no load fact, so it cannot be shown to be heavier.
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
    if (aLoad === null && bLoad === null) return a.result > b.result
    if (aLoad === null) return false
    if (bLoad === null) return true
    if (aLoad !== bLoad) return aLoad > bLoad
    return a.result > b.result
  }

  return a.result > b.result
}

/** Chronological order of two occurrences within one account. */
function earlier(
  a: { workoutDate: string; sessionId: string },
  b: { workoutDate: string; sessionId: string },
): boolean {
  if (a.workoutDate !== b.workoutDate) return a.workoutDate < b.workoutDate
  return a.sessionId < b.sessionId
}

/* ------------------------------------------------------------------ */
/* Derived shapes                                                      */
/* ------------------------------------------------------------------ */

/** One factual point: the best set of one comparable variant in one workout. */
export type PerformancePoint = {
  date: string
  sessionId: string
  loadValue: number | null
  result: number
}

export type VariantPerformance = {
  key: string
  exerciseId: string
  exerciseName: string
  resultKind: WorkoutResultKind
  loadMode: WorkoutLoadMode
  perSide: boolean
  /** The best completed set in all recorded history, or null when none ranks. */
  personalBest: PerformancePoint | null
  /** One point per workout occurrence, oldest first. */
  points: PerformancePoint[]
  /** The most recent occurrence this variant was performed in. */
  lastPerformed: string
}

/* ------------------------------------------------------------------ */
/* Derivation                                                          */
/* ------------------------------------------------------------------ */

/** The occurrence a set belongs to: local workout date plus session. */
const occurrenceKey = (set: { workoutDate: string; sessionId: string }) =>
  `${set.workoutDate}${set.sessionId}`

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
  const names = new Map<string, { name: string; date: string; sessionId: string }>()
  for (const set of sets) {
    const held = names.get(set.exerciseId)
    const here = { workoutDate: set.workoutDate, sessionId: set.sessionId }
    if (!held || earlier({ workoutDate: held.date, sessionId: held.sessionId }, here)) {
      names.set(set.exerciseId, {
        name: set.exerciseName,
        date: set.workoutDate,
        sessionId: set.sessionId,
      })
    }
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
      }
      if (!held || isBetter(candidate, held, kind)) perOccurrence.set(id, candidate)
    }

    const points = [...perOccurrence.values()].sort((a, b) =>
      earlier(
        { workoutDate: a.date, sessionId: a.sessionId },
        { workoutDate: b.date, sessionId: b.sessionId },
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
      personalBest,
      points,
      lastPerformed: points[points.length - 1].date,
    })
  }

  // Most recently performed first; a shared date is broken by name so the
  // order is stable rather than dependent on Map insertion.
  return variants.sort((a, b) => {
    if (a.lastPerformed !== b.lastPerformed) return a.lastPerformed < b.lastPerformed ? 1 : -1
    if (a.exerciseName !== b.exerciseName) return a.exerciseName < b.exerciseName ? -1 : 1
    return a.key < b.key ? -1 : 1
  })
}
