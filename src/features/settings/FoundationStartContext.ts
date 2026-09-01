import { createContext, useContext } from 'react'

import type { AccountSettings } from './settingsApi'

/**
 * The ONE Foundation start date contract the whole app reads.
 *
 * Round 18 removed the source constant every page used to import. Today,
 * Progress, Achievements and Settings now share this single value, so there is
 * no page-local authority left to drift out of step with the others.
 *
 * The three load states are kept distinct on purpose, because a day number
 * stated from the wrong start is worse than no day number at all:
 *
 *   loading → we do not know the account's start date yet, so no Foundation
 *             day may be rendered. Callers show a loading state.
 *   ready   → `startDate` is authoritative: either the account's choice or the
 *             documented legacy default it has always been counted from.
 *   error   → the read failed. Say so; do not quietly fall back to the default
 *             and present a day number that may be wrong by weeks.
 */
export type FoundationStartStatus = 'loading' | 'ready' | 'error'

export type FoundationStartState = {
  status: FoundationStartStatus
  /**
   * The start date in force. Only meaningful while `status` is 'ready'.
   * Resolved through the shared fallback, never by a caller.
   */
  startDate: string
  /**
   * What the account actually chose, or null when it never has. Distinct from
   * `startDate` so Settings can tell an explicit 2026-08-31 from an unset one.
   */
  persisted: string | null
  /** A save is in flight. */
  saving: boolean
  /** Last recoverable save failure. Previous confirmed truth stays visible. */
  saveError: string | null
  /** True immediately after a confirmed save, for the success state. */
  saved: boolean
  reload: () => void
  /** Returns true when the server confirmed the write. */
  save: (date: string | null) => Promise<boolean>
}

export const FoundationStartContext = createContext<FoundationStartState | null>(null)

/**
 * Read the shared contract.
 *
 * Throws when used outside the provider rather than inventing a default: a
 * component rendering Foundation days without the provider is a wiring bug, and
 * silently answering it with the legacy date would hide that.
 */
export function useFoundationStart(): FoundationStartState {
  const value = useContext(FoundationStartContext)
  if (!value) {
    throw new Error('useFoundationStart must be used inside FoundationStartProvider')
  }
  return value
}

export type { AccountSettings }
