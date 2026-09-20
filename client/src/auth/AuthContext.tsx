import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react'
import { api, ApiError } from '../lib/api'
import type { User } from '../lib/types'

interface AuthValue {
  user: User | null
  loading: boolean
  /** Call after a successful sign-in response. */
  setUser: (u: User) => void
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthValue | null>(null)

async function fetchMe(): Promise<User | null> {
  try {
    return (await api<{ user: User }>('/auth/me')).user
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return null
    throw err
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const { data, isPending } = useQuery({ queryKey: ['me'], queryFn: fetchMe, staleTime: Infinity, retry: false })

  const setUser = useCallback((u: User) => qc.setQueryData(['me'], u), [qc])
  const logout = useCallback(async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined)
    // Tell Google this was a deliberate sign-out so it never signs the user straight back in.
    window.google?.accounts.id.disableAutoSelect()
    // Mark the user as signed out first so the route guards send them to /login straight away. (qc.clear() here would detach
    // the 'me' query from its observer and leave the old user on screen.) Then forget everything cached for that user.
    qc.setQueryData(['me'], null)
    qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' })
  }, [qc])

  const value = useMemo<AuthValue>(() => ({ user: data ?? null, loading: isPending, setUser, logout }), [data, isPending, setUser, logout])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
