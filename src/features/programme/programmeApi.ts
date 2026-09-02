import {
  FALLBACK_REVISION,
  PROGRAMME_SESSION_IDS,
  isProgrammeSessionId,
  type Programme,
  type ProgrammeExercise,
  type ProgrammeSessionId,
  type ProgrammeSessions,
  type ProgrammeSlot,
  type SessionIntensity,
} from '@shared/programme/programme'

/**
 * The programme API client.
 *
 * Reading is unremarkable. Writing is not: every save states the revision the
 * author read, and a 409 is a first-class outcome carrying the CURRENT
 * programme, so the editor can say "this changed elsewhere" and offer to reload
 * rather than silently overwriting somebody's work.
 */

const REQUEST_INIT: RequestInit = { credentials: 'same-origin' }

/** One weekday, as the server describes it. */
export type ProgrammeSessionView = {
  id: ProgrammeSessionId
  day: string
  focus: string
  intensity: SessionIntensity
  slots: (ProgrammeSlot & { prescription: string })[]
}

export type ProgrammeView = {
  revision: number
  exercises: ProgrammeExercise[]
  sessions: ProgrammeSessionView[]
}

/** A refusal that carries the truth the author must reconcile against. */
export class ProgrammeConflictError extends Error {
  readonly programme: ProgrammeView
  constructor(programme: ProgrammeView) {
    super('programme_conflict')
    this.name = 'ProgrammeConflictError'
    this.programme = programme
  }
}

function readSlot(raw: unknown): (ProgrammeSlot & { prescription: string }) | null {
  if (typeof raw !== 'object' || raw === null) return null
  const row = raw as Record<string, unknown>
  if (typeof row.exerciseId !== 'string') return null
  if (typeof row.prescription !== 'string') return null
  if (row.resultKind !== 'reps' && row.resultKind !== 'seconds') return null
  if (typeof row.setCount !== 'number') return null
  if (typeof row.targetMin !== 'number' || typeof row.targetMax !== 'number') return null
  return {
    exerciseId: row.exerciseId,
    position: typeof row.position === 'number' ? row.position : 0,
    setCount: row.setCount,
    resultKind: row.resultKind,
    targetMin: row.targetMin,
    targetMax: row.targetMax,
    perSide: row.perSide === true,
    equipment: typeof row.equipment === 'string' ? row.equipment : null,
    prescription: row.prescription,
  }
}

/**
 * Read a programme body.
 *
 * Returns null rather than a partial programme when anything essential is
 * unreadable. A half-read programme would render as a shorter training week,
 * which looks exactly like a real one.
 */
export function readProgramme(body: unknown): ProgrammeView | null {
  if (typeof body !== 'object' || body === null) return null
  const raw = (body as Record<string, unknown>).programme
  if (typeof raw !== 'object' || raw === null) return null
  const row = raw as Record<string, unknown>

  if (typeof row.revision !== 'number') return null
  if (!Array.isArray(row.exercises) || !Array.isArray(row.sessions)) return null

  const exercises: ProgrammeExercise[] = []
  for (const entry of row.exercises) {
    if (typeof entry !== 'object' || entry === null) return null
    const e = entry as Record<string, unknown>
    if (typeof e.exerciseId !== 'string' || typeof e.name !== 'string') return null
    exercises.push({
      exerciseId: e.exerciseId,
      name: e.name,
      archived: e.archived === true,
      custom: e.custom === true,
    })
  }

  const sessions: ProgrammeSessionView[] = []
  for (const entry of row.sessions) {
    if (typeof entry !== 'object' || entry === null) return null
    const s = entry as Record<string, unknown>
    if (!isProgrammeSessionId(s.id)) return null
    if (typeof s.day !== 'string' || typeof s.focus !== 'string') return null
    if (s.intensity !== 'HARD' && s.intensity !== 'LIGHT' && s.intensity !== 'PUMP') {
      return null
    }
    if (!Array.isArray(s.slots)) return null
    const slots = s.slots.map(readSlot)
    if (slots.some((slot) => slot === null)) return null
    sessions.push({
      id: s.id,
      day: s.day,
      focus: s.focus,
      intensity: s.intensity,
      slots: slots as (ProgrammeSlot & { prescription: string })[],
    })
  }

  // Every weekday must be present. A missing one is a broken read, not an
  // empty training day.
  for (const sessionId of PROGRAMME_SESSION_IDS) {
    if (!sessions.some((session) => session.id === sessionId)) return null
  }

  return { revision: row.revision, exercises, sessions }
}

async function parseResponse(response: Response): Promise<ProgrammeView> {
  const body = (await response.json()) as unknown
  if (response.status === 409) {
    const current = readProgramme(body)
    if (!current) throw new Error('programme conflict, and the current programme was unreadable')
    throw new ProgrammeConflictError(current)
  }
  if (!response.ok) throw new Error(`programme request failed: ${response.status}`)
  const programme = readProgramme(body)
  if (!programme) throw new Error('programme response was unreadable')
  return programme
}

export async function fetchProgramme(signal?: AbortSignal): Promise<ProgrammeView> {
  return parseResponse(await fetch('/api/programme', { ...REQUEST_INIT, signal }))
}

/** The desired programme, stated whole. */
export type ProgrammeSave = {
  expectedRevision: number
  exercises: ProgrammeExercise[]
  sessions: ProgrammeSessions
}

export async function saveProgramme(save: ProgrammeSave): Promise<ProgrammeView> {
  return parseResponse(
    await fetch('/api/programme', {
      ...REQUEST_INIT,
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(save),
    }),
  )
}

export async function createCustomExercise(input: {
  name: string
  inputType: string
  expectedRevision: number
}): Promise<{ exerciseId: string; programme: ProgrammeView }> {
  const response = await fetch('/api/programme/exercises', {
    ...REQUEST_INIT,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  const body = (await response.json()) as unknown
  if (response.status === 409) {
    const current = readProgramme(body)
    if (!current) throw new Error('programme conflict, and the current programme was unreadable')
    throw new ProgrammeConflictError(current)
  }
  if (!response.ok) throw new Error(`create exercise failed: ${response.status}`)
  const programme = readProgramme(body)
  const exerciseId = (body as Record<string, unknown>).exerciseId
  if (!programme || typeof exerciseId !== 'string') {
    throw new Error('create exercise response was unreadable')
  }
  return { exerciseId, programme }
}

/* ------------------------------------------------------------------ */
/* Shapes the editor works in                                          */
/* ------------------------------------------------------------------ */

/** The view flattened back into the shape a save states. */
export function toSaveSessions(view: ProgrammeView): ProgrammeSessions {
  const sessions = {} as ProgrammeSessions
  for (const sessionId of PROGRAMME_SESSION_IDS) {
    const session = view.sessions.find((s) => s.id === sessionId)
    sessions[sessionId] = (session?.slots ?? []).map((slot) => ({
      exerciseId: slot.exerciseId,
      position: slot.position,
      setCount: slot.setCount,
      resultKind: slot.resultKind,
      targetMin: slot.targetMin,
      targetMax: slot.targetMax,
      perSide: slot.perSide,
      equipment: slot.equipment,
    }))
  }
  return sessions
}

/** The view as the plain `Programme` shared code expects. */
export function toProgramme(view: ProgrammeView): Programme {
  return {
    revision: view.revision,
    exercises: view.exercises,
    sessions: toSaveSessions(view),
  }
}

/** Is this programme still the unedited fallback? */
export function isFallback(view: ProgrammeView): boolean {
  return view.revision === FALLBACK_REVISION
}

/** The weekdays one exercise currently appears on. */
export function usedIn(view: ProgrammeView, exerciseId: string): ProgrammeSessionView[] {
  return view.sessions.filter((session) =>
    session.slots.some((slot) => slot.exerciseId === exerciseId),
  )
}

/* ------------------------------------------------------------------ */
/* View adapter                                                        */
/* ------------------------------------------------------------------ */

/**
 * One programme weekday in the shape the existing session UI already renders.
 *
 * A presentation adapter, and deliberately nothing more. `TrainingSession` is
 * how the accordion, the plan builder and the exercise pages have always
 * described a day, and rewriting all of them would have risked changing
 * behaviour this round is not about. What matters is where the DATA comes
 * from — the account's programme — and that is now the only source.
 *
 * The static `trainingSessions` array is no longer read by any of them.
 */
export type TrainingSessionView = {
  id: ProgrammeSessionId
  day: string
  focus: string
  intensity: SessionIntensity
  exercises: {
    id: string
    name: string
    sets: string
    equipment?: string
  }[]
}

export function toTrainingSession(
  view: ProgrammeView,
  sessionId: string,
): TrainingSessionView | undefined {
  const session = view.sessions.find((entry) => entry.id === sessionId)
  if (!session) return undefined
  const names = new Map(view.exercises.map((e) => [e.exerciseId, e.name]))
  return {
    id: session.id,
    day: session.day,
    focus: session.focus,
    intensity: session.intensity,
    exercises: session.slots.map((slot) => ({
      id: slot.exerciseId,
      name: names.get(slot.exerciseId) ?? slot.exerciseId,
      sets: slot.prescription,
      ...(slot.equipment ? { equipment: slot.equipment } : {}),
    })),
  }
}

/** Every weekday, in the shape the session UI renders. */
export function toTrainingSessions(view: ProgrammeView): TrainingSessionView[] {
  return view.sessions
    .map((session) => toTrainingSession(view, session.id))
    .filter((session): session is TrainingSessionView => session !== undefined)
}
