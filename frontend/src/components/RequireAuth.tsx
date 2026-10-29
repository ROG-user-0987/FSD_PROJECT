// Route guard: waits for the session check, sends anonymous users to /login, and
// redirects roles without the capability to their home page.
import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router'
import { useAuth } from '@/hooks/useAuth'
import { can, homePathFor, type Capability } from '@/utils/permissions'
import { FullPageLoader } from './states'

export function RequireAuth({
  capability,
  children,
}: {
  capability?: Capability
  children: ReactNode
}) {
  const { status, user } = useAuth()
  const location = useLocation()

  if (status === 'loading') return <FullPageLoader />
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  if (capability && !can(user.role, capability)) {
    return <Navigate to={homePathFor(user.role)} replace />
  }
  return children
}

// "/" -> the signed-in user's home page.
export function HomeRedirect() {
  const { user } = useAuth()
  return <Navigate to={user ? homePathFor(user.role) : '/login'} replace />
}
