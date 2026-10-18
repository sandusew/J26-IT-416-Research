import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { LoadingState } from '../components/ui'
import type { Role } from '../api/types'
import { useAuth } from './AuthContext'

export function ProtectedRoute({ roles }: { roles?: Role[] }) {
  const { token, user, loading } = useAuth()
  const location = useLocation()

  if (loading) return <LoadingState label="Checking session…" />
  if (!token || !user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }
  if (roles && !roles.includes(user.role)) {
    return <Navigate to="/unauthorized" replace />
  }
  return <Outlet />
}
