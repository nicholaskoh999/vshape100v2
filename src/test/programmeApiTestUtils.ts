import { foundationProgramme } from '@shared/programme/foundation'
import {
  FOUNDATION_SESSION_META,
  formatPrescription,
  PROGRAMME_SESSION_IDS,
  type Programme,
  type ProgrammeSlot,
} from '@shared/programme/programme'

/**
 * In-memory stand-in for the programme API.
 *
 * The DEFAULT is the Foundation seed at revision 0 — an account that has never
 * edited its programme, which is what every suite written before Round 22 was
 * implicitly about. That default matters: it means those suites keep asserting
 * the same training week they always did, without each one having to say so.
 *
 * A suite that wants a different programme calls `setProgramme`. A suite about
 * conflicts calls `failNextSaveWithConflict`, which is how the editor's 409
 * path is exercised without inventing a second client.
 */

export type ProgrammeServer = {
  handle: (url: string, init?: RequestInit) => Promise<Response>
  /** Replace the programme the server answers with. */
  setProgramme: (programme: Programme) => void
  /** The programme as it currently stands, for assertions. */
  current: () => Programme
  /** Make the next save answer 409 with the current programme. */
  failNextSaveWithConflict: () => void
  /** Fail every request with this status until cleared. */
  failWith: (status: number | null) => void
  calls: { method: string; url: string; body: unknown }[]
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/** The wire shape, derived the same way the Worker derives it. */
function toPublic(programme: Programme) {
  return {
    revision: programme.revision,
    exercises: programme.exercises.map((exercise) => ({ ...exercise })),
    sessions: PROGRAMME_SESSION_IDS.map((sessionId) => {
      const meta = FOUNDATION_SESSION_META[sessionId]
      return {
        id: meta.id,
        day: meta.day,
        focus: meta.focus,
        intensity: meta.intensity,
        slots: programme.sessions[sessionId].map((slot) => ({
          ...slot,
          prescription: formatPrescription(slot),
        })),
      }
    }),
  }
}

export function createProgrammeServer(): ProgrammeServer {
  let programme: Programme = foundationProgramme()
  let conflictNextSave = false
  let failure: number | null = null
  const calls: ProgrammeServer['calls'] = []

  return {
    calls,
    setProgramme(next) {
      programme = next
    },
    current: () => programme,
    failNextSaveWithConflict() {
      conflictNextSave = true
    },
    failWith(status) {
      failure = status
    },
    async handle(url, init) {
      const method = init?.method ?? 'GET'
      const body = init?.body ? JSON.parse(String(init.body)) : null
      calls.push({ method, url, body })

      if (failure !== null) return jsonResponse({ error: 'server_error' }, failure)

      if (method === 'GET') return jsonResponse({ programme: toPublic(programme) })

      if (conflictNextSave) {
        conflictNextSave = false
        return jsonResponse(
          { error: 'programme_conflict', programme: toPublic(programme) },
          409,
        )
      }

      const raw = body as Record<string, unknown>

      // The same optimistic-concurrency rule the Worker enforces.
      if (raw.expectedRevision !== programme.revision) {
        return jsonResponse(
          { error: 'programme_conflict', programme: toPublic(programme) },
          409,
        )
      }

      if (url.endsWith('/exercises')) {
        const exerciseId = `custom-${String(programme.exercises.length + 1).padStart(16, '0')}`
        programme = {
          revision: programme.revision + 1,
          exercises: [
            ...programme.exercises,
            {
              exerciseId,
              name: String(raw.name),
              archived: false,
              custom: true,
            },
          ],
          sessions: programme.sessions,
        }
        return jsonResponse({ exerciseId, programme: toPublic(programme) }, 201)
      }

      programme = {
        revision: programme.revision + 1,
        exercises: raw.exercises as Programme['exercises'],
        // Positions are rewritten from array order, exactly as the server does.
        sessions: Object.fromEntries(
          PROGRAMME_SESSION_IDS.map((sessionId) => {
            const slots = (raw.sessions as Record<string, ProgrammeSlot[]>)[sessionId] ?? []
            return [sessionId, slots.map((slot, index) => ({ ...slot, position: index + 1 }))]
          }),
        ) as Programme['sessions'],
      }
      return jsonResponse({ programme: toPublic(programme) })
    },
  }
}
