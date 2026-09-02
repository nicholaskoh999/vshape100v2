import { createContext, useContext } from 'react'

import type { ProgrammeView } from './programmeApi'

/**
 * The shared programme's context and hook.
 *
 * Separate from the provider component only because fast refresh needs a
 * component file to export components and nothing else. The reasoning about
 * why this is shared at all lives with the provider.
 */

export type ProgrammeStatus = 'loading' | 'ready' | 'error'

export type ProgrammeState = {
  status: ProgrammeStatus
  programme: ProgrammeView | null
  /** Re-read from the server. */
  reload: () => void
  /**
   * Adopt a programme the server has just confirmed.
   *
   * Used after a successful save, so every consumer sees the new truth without
   * a second round trip. Only ever called with a server response — never with
   * a locally-guessed programme.
   */
  adopt: (programme: ProgrammeView) => void
}

export const ProgrammeContext = createContext<ProgrammeState | null>(null)

/**
 * The shared programme.
 *
 * Throws outside the provider rather than falling back to the static seed: a
 * consumer that quietly rendered the default programme would be the exact bug
 * Round 22 removes.
 */
export function useProgramme(): ProgrammeState {
  const value = useContext(ProgrammeContext)
  if (!value) {
    throw new Error('useProgramme must be used inside a ProgrammeProvider')
  }
  return value
}
