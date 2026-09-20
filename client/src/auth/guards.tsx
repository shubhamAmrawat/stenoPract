import { Navigate, Outlet, useLocation } from 'react-router'
import { Spinner } from '../components/ui'
import { useApplyTheme } from '../lib/useTheme'
import { useAuth } from './AuthContext'
import { isStudentView } from './studentView'

export function RequireAuth() {
  const { user, loading } = useAuth()
  const location = useLocation()
  if (loading) return <Spinner full />
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />
  return <Outlet />
}

export function RequireAdmin() {
  const { user } = useAuth()
  if (user?.role !== 'admin') return <Navigate to="/" replace />
  return <Outlet />
}

/** Student pages. Admins are sent to the admin console unless they chose "Student view". */
export function StudentArea() {
  const { user } = useAuth()
  useApplyTheme(user?.theme)
  if (user?.role === 'admin' && !isStudentView()) return <Navigate to="/admin" replace />
  return <Outlet />
}
