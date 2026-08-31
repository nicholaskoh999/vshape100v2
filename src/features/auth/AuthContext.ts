import { createContext, use } from 'react'

import type { PublicUser, SessionEndReason } from './api'

export type AuthStatus = 'bootstrapping' | 'authenticated' | 'unauthenticated'

export type AuthValue = {
  status: AuthStatus
  user: PublicUser | null
  /** Set when a previously valid session ended, so login can explain it. */
  endReason: SessionEndReason
  /**
   * Set when signing out could NOT confirm that this device's reminders were
   * retired.
   *
   * Surfaced rather than swallowed: the signed-out account may still be able
   * to push this browser, and only the person can finish undoing that.
   */
  signOutNotice: string | null
  /** Re-read the authoritative session from the server. */
  refresh: () => Promise<void>
  /** Revoke this device's session and drop local auth state. */
  logout: () => Promise<void>
  isLoggingOut: boolean
}

export const AuthContext = createContext<AuthValue | null>(null)

export function useAuth(): AuthValue {
  const value = use(AuthContext)
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>')
  return value
}
