import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import {
  fetchSession,
  postLogout,
  type PublicUser,
  type SessionEndReason,
  type SessionState,
} from './api'
import { AuthContext, type AuthStatus, type AuthValue } from './AuthContext'

/**
 * Holds the app's view of the server session.
 *
 * Starts in `bootstrapping` so the guard can hold back protected content
 * until the server has answered — no flash of the app for a signed-out user.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('bootstrapping')
  const [user, setUser] = useState<PublicUser | null>(null)
  const [endReason, setEndReason] = useState<SessionEndReason>(null)
  const [isLoggingOut, setIsLoggingOut] = useState(false)

  // Guards against a stale response overwriting newer state — StrictMode's
  // double-invoked effect, or a refresh that lands after a logout.
  const requestId = useRef(0)

  const applySession = useCallback((session: SessionState) => {
    if (session.authenticated) {
      setUser(session.user)
      setEndReason(null)
      setStatus('authenticated')
    } else {
      setUser(null)
      setEndReason(session.reason)
      setStatus('unauthenticated')
    }
  }, [])

  /** A failed lookup is not proof of a session, so stay locked out. */
  const applyLockedOut = useCallback(() => {
    setUser(null)
    setStatus('unauthenticated')
  }, [])

  const refresh = useCallback(async () => {
    const id = (requestId.current += 1)
    try {
      const session = await fetchSession()
      if (id === requestId.current) applySession(session)
    } catch {
      if (id === requestId.current) applyLockedOut()
    }
  }, [applySession, applyLockedOut])

  const logout = useCallback(async () => {
    setIsLoggingOut(true)
    try {
      await postLogout()
    } finally {
      // Invalidate any in-flight refresh so it cannot resurrect the session.
      requestId.current += 1
      setUser(null)
      setEndReason(null)
      setStatus('unauthenticated')
      setIsLoggingOut(false)
    }
  }, [])

  // Bootstrap: ask the server once on mount. State is set from the promise
  // callbacks rather than synchronously in the effect body.
  useEffect(() => {
    const controller = new AbortController()
    const id = (requestId.current += 1)

    fetchSession(controller.signal)
      .then((session) => {
        if (id === requestId.current) applySession(session)
      })
      .catch(() => {
        if (controller.signal.aborted) return
        if (id === requestId.current) applyLockedOut()
      })

    return () => controller.abort()
  }, [applySession, applyLockedOut])

  const value = useMemo<AuthValue>(
    () => ({ status, user, endReason, refresh, logout, isLoggingOut }),
    [status, user, endReason, refresh, logout, isLoggingOut],
  )

  return <AuthContext value={value}>{children}</AuthContext>
}
