import { Navigate, Outlet, useLocation } from 'react-router'

import { loginUrlFor } from '@shared/redirect'
import { useAuth } from './AuthContext'
import { AuthSplash } from './AuthSplash'

/**
 * Route guard for every protected area of the app.
 *
 * While the session is resolving it renders a brand splash rather than the
 * shell, so protected content never appears for an unauthenticated visitor.
 */
export function RequireAuth() {
  const { status } = useAuth()
  const location = useLocation()

  if (status === 'bootstrapping') return <AuthSplash />

  if (status === 'unauthenticated') {
    return (
      <Navigate to={loginUrlFor(location.pathname, location.search, location.hash)} replace />
    )
  }

  return <Outlet />
}
