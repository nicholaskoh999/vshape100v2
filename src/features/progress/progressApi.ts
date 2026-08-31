import type { BodyWeightRange } from '@shared/bodyWeight'
import { isLocalDate } from '@shared/localDate'
import type { WorkoutLoadMode, WorkoutResultKind } from '@shared/workoutLog'

/**
 * Progress client — body weight and derived performance.
 *
 * D1 is the source of truth; nothing is mirrored into browser storage. The
 * ranking that produces a Personal Best happens on the server, over all of
 * history, and this module never re-derives one from whatever it happens to
 * have received: a client-side "best of what I was sent" is exactly the bug
 * the server-side complete read exists to prevent.
 *
 * Every parser here refuses a malformed row rather than coercing it. A number
 * that arrives as a string, or a weight with no date, is dropped — never
 * turned into a zero that would then be drawn on a chart as a real point.
 */

export class ProgressApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ProgressApiError'
    this.status = status
  }
}

const REQUEST_INIT: RequestInit = {
  credentials: 'same-origin',
  headers: { Accept: 'application/json' },
}

async function readJson(response: Response, what: string): Promise<Record<string, unknown>> {
  if (!response.ok) {
    throw new ProgressApiError(`${what} request failed (${response.status})`, response.status)
  }
  return (await response.json()) as Record<string, unknown>
}

/* ------------------------------------------------------------------ */
/* Body weight                                                         */
/* ------------------------------------------------------------------ */

export type WeightPoint = {
  date: string
  weightKg: number
  /** Exact tenths, so the client can subtract without float error. */
  tenths: number
}

export type WeightSummary = {
  latest: WeightPoint | null
  previous: WeightPoint | null
  first: WeightPoint | null
  /** Null when there are fewer than two measurements — not zero. */
  changeFromPreviousTenths: number | null
  changeFromFirstTenths: number | null
  count: number
}

export type WeightHistory = {
  range: BodyWeightRange
  points: WeightPoint[]
  summary: WeightSummary
}

/** Returns null for anything that is not a complete measurement. */
function toWeightPoint(raw: unknown): WeightPoint | null {
  if (typeof raw !== 'object' || raw === null) return null
  const row = raw as Record<string, unknown>
  // A real calendar date, not merely a string. The chart positions points by
  // the calendar, and an unparseable date would silently land at day zero and
  // drag the whole axis with it.
  if (!isLocalDate(row.date)) return null
  if (typeof row.tenths !== 'number' || !Number.isFinite(row.tenths)) return null
  if (typeof row.weightKg !== 'number' || !Number.isFinite(row.weightKg)) return null
  return { date: row.date, weightKg: row.weightKg, tenths: row.tenths }
}

/** A change is a number or it is unknown. It is never silently zero. */
function toChange(raw: unknown): number | null {
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null
}

function toWeightSummary(raw: unknown): WeightSummary {
  const row = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  return {
    latest: toWeightPoint(row.latest),
    previous: toWeightPoint(row.previous),
    first: toWeightPoint(row.first),
    changeFromPreviousTenths: toChange(row.changeFromPreviousTenths),
    changeFromFirstTenths: toChange(row.changeFromFirstTenths),
    count: typeof row.count === 'number' ? row.count : 0,
  }
}

/** The device's own IANA zone, or null when the browser cannot report one. */
export function deviceTimeZone(): string | null {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
    return typeof zone === 'string' && zone.length > 0 ? zone : null
  } catch {
    return null
  }
}

export async function fetchWeightHistory(
  range: BodyWeightRange,
  signal?: AbortSignal,
): Promise<WeightHistory> {
  const params = new URLSearchParams({ range })
  // A bounded window ends on the user's own Today, so the server needs the
  // zone to know which date that is. `all` has no window and needs none.
  const zone = deviceTimeZone()
  if (range !== 'all' && zone) params.set('timezone', zone)

  const body = await readJson(
    await fetch(`/api/progress/weight?${params}`, { ...REQUEST_INIT, signal }),
    'Body weight',
  )

  return {
    range,
    points: Array.isArray(body.points)
      ? body.points.map(toWeightPoint).filter((point): point is WeightPoint => point !== null)
      : [],
    summary: toWeightSummary(body.summary),
  }
}

/** Save or correct the measurement for one local date. */
export async function saveWeight(localDate: string, weightKg: number): Promise<void> {
  const timezone = deviceTimeZone()
  if (!timezone) {
    // Without a zone the server cannot tell a valid Today from a future date,
    // so it will refuse. Saying so here is clearer than a 400.
    throw new ProgressApiError('This browser could not report its timezone.', 0)
  }

  const response = await fetch('/api/progress/weight', {
    ...REQUEST_INIT,
    method: 'PUT',
    headers: { ...REQUEST_INIT.headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ localDate, weightKg, timezone }),
  })
  await readJson(response, 'Body weight')
}

export async function deleteWeight(localDate: string): Promise<void> {
  const response = await fetch(`/api/progress/weight/${encodeURIComponent(localDate)}`, {
    ...REQUEST_INIT,
    method: 'DELETE',
  })
  await readJson(response, 'Body weight')
}

/* ------------------------------------------------------------------ */
/* Performance                                                         */
/* ------------------------------------------------------------------ */

export type PerformancePoint = {
  date: string
  sessionId: string
  loadValue: number | null
  result: number
}

export type PerformanceVariant = {
  key: string
  exerciseId: string
  exerciseName: string
  resultKind: WorkoutResultKind
  loadMode: WorkoutLoadMode
  perSide: boolean
  personalBest: PerformancePoint | null
  points: PerformancePoint[]
  lastPerformed: string
}

export type Performance = {
  /**
   * Did the server establish the whole history?
   *
   * False means no Personal Best may be shown at all. A partial history can
   * only produce a best that is too low, and one that is too low looks exactly
   * like a correct one on screen.
   *
   * Absent from the body is read as false, never as true.
   */
  complete: boolean
  variants: PerformanceVariant[]
}

const RESULT_KINDS: readonly string[] = ['reps', 'seconds']
const LOAD_MODES: readonly string[] = ['none', 'kg', 'kg_each']

function toPerformancePoint(raw: unknown): PerformancePoint | null {
  if (typeof raw !== 'object' || raw === null) return null
  const row = raw as Record<string, unknown>
  if (!isLocalDate(row.date) || typeof row.sessionId !== 'string') return null
  if (typeof row.result !== 'number' || !Number.isFinite(row.result)) return null
  const loadValue =
    typeof row.loadValue === 'number' && Number.isFinite(row.loadValue) ? row.loadValue : null
  return { date: row.date, sessionId: row.sessionId, loadValue, result: row.result }
}

/**
 * Returns null for a variant whose measurement system cannot be read.
 *
 * An unknown load mode is not defaulted to `kg`: rendering "50 kg" for a
 * measurement that meant something else is worse than not rendering it.
 */
function toVariant(raw: unknown): PerformanceVariant | null {
  if (typeof raw !== 'object' || raw === null) return null
  const row = raw as Record<string, unknown>
  if (typeof row.key !== 'string' || typeof row.exerciseId !== 'string') return null
  if (typeof row.resultKind !== 'string' || !RESULT_KINDS.includes(row.resultKind)) return null
  if (typeof row.loadMode !== 'string' || !LOAD_MODES.includes(row.loadMode)) return null

  const loadedReps = row.resultKind === 'reps' && row.loadMode !== 'none'

  const points = Array.isArray(row.points)
    ? row.points
        .map(toPerformancePoint)
        .filter((point): point is PerformancePoint => point !== null)
        // A loaded-reps variant is ranked and plotted by LOAD. A point with no
        // recorded load has nothing to place on that axis, and plotting its rep
        // count instead would put kilograms and repetitions on one line. The
        // server already excludes these; this refuses to draw one if it ever
        // arrived.
        .filter((point) => !loadedReps || point.loadValue !== null)
    : []
  if (points.length === 0) return null

  const personalBest = toPerformancePoint(row.personalBest)

  return {
    key: row.key,
    exerciseId: row.exerciseId,
    exerciseName: typeof row.exerciseName === 'string' ? row.exerciseName : row.exerciseId,
    resultKind: row.resultKind as WorkoutResultKind,
    loadMode: row.loadMode as WorkoutLoadMode,
    perSide: row.perSide === true,
    // Same rule for the best: a loaded best without a load is not a best.
    personalBest: personalBest && (!loadedReps || personalBest.loadValue !== null)
      ? personalBest
      : null,
    points,
    lastPerformed:
      typeof row.lastPerformed === 'string'
        ? row.lastPerformed
        : points[points.length - 1].date,
  }
}

export async function fetchPerformance(signal?: AbortSignal): Promise<Performance> {
  const body = await readJson(
    await fetch('/api/progress/performance', { ...REQUEST_INIT, signal }),
    'Performance',
  )

  // Trusted only when the server actually says the read was complete.
  if (body.complete !== true) return { complete: false, variants: [] }

  return {
    complete: true,
    variants: Array.isArray(body.variants)
      ? body.variants
          .map(toVariant)
          .filter((variant): variant is PerformanceVariant => variant !== null)
      : [],
  }
}
