// Holds the signed-in user. On app load it calls /auth/refresh: the httpOnly cookie
// restores the session without the access token ever touching localStorage.
// The socket connects whenever a session starts or its token changes.
import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  login as apiLogin,
  logout as apiLogout,
  onSessionChange,
  refreshSession,
} from '@/services/api'
import { connectSocket, disconnectSocket } from '@/services/socket'
import type { User } from '@/types/api'
import { AuthContext, type AuthStatus } from './auth-context'

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const [state, setState] = useState<{ status: AuthStatus; user: User | null }>({
    status: 'loading',
    user: null,
  })

  useEffect(() => {
    const unsubscribe = onSessionChange((session) => {
      if (session) {
        setState({ status: 'authenticated', user: session.user })
        connectSocket(session.accessToken)
      } else {
        setState({ status: 'anonymous', user: null })
        disconnectSocket()
        queryClient.clear() // no data from the previous user survives a logout
      }
    })
    // Restore the session (single-flight, so StrictMode's double effect is harmless).
    void refreshSession()
    return () => {
      unsubscribe()
    }
  }, [queryClient])

  const login = useCallback(async (email: string, password: string) => {
    const session = await apiLogin(email, password)
    return session.user
  }, [])

  const logout = useCallback(() => apiLogout(), [])

  const value = useMemo(() => ({ ...state, login, logout }), [state, login, logout])
  return <AuthContext value={value}>{children}</AuthContext>
}
