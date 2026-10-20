import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { api } from '../api/endpoints'
import { ApiError } from '../api/types'
import type { AuthUser, Role } from '../api/types'

const TOKEN_KEY = 'arts_ai_token'
const USER_KEY = 'arts_ai_user'

type AuthState = {
  token: string | null
  user: AuthUser | null
  loading: boolean
  login: (username: string, password: string) => Promise<void>
  register: (body: Record<string, unknown>) => Promise<void>
  logout: () => void
  refreshMe: () => Promise<void>
  hasRole: (...roles: Role[]) => boolean
}

const AuthContext = createContext<AuthState | null>(null)

function clearStore() {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(USER_KEY)
  sessionStorage.clear()
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY))
  const [user, setUser] = useState<AuthUser | null>(() => {
    const raw = localStorage.getItem(USER_KEY)
    if (!raw) return null
    try {
      return JSON.parse(raw) as AuthUser
    } catch {
      return null
    }
  })
  const [loading, setLoading] = useState(!!token)

  const logout = useCallback(() => {
    clearStore()
    setToken(null)
    setUser(null)
  }, [])

  const refreshMe = useCallback(async () => {
    if (!token) {
      setLoading(false)
      return
    }
    try {
      const res = await api.me(token)
      const u = res.user as AuthUser
      setUser(u)
      localStorage.setItem(USER_KEY, JSON.stringify(u))
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) logout()
    } finally {
      setLoading(false)
    }
  }, [token, logout])

  useEffect(() => {
    void refreshMe()
  }, [refreshMe])

  const acceptSession = useCallback((res: { token: string; user: AuthUser }) => {
    localStorage.setItem(TOKEN_KEY, res.token)
    localStorage.setItem(USER_KEY, JSON.stringify(res.user))
    setToken(res.token)
    setUser(res.user)
  }, [])

  const login = useCallback(async (username: string, password: string) => {
    clearStore()
    acceptSession(await api.login(username, password))
  }, [acceptSession])

  const register = useCallback(async (body: Record<string, unknown>) => {
    clearStore()
    acceptSession(await api.register(body))
  }, [acceptSession])

  const hasRole = useCallback(
    (...roles: Role[]) => !!(user && roles.includes(user.role)),
    [user],
  )

  const value = useMemo(
    () => ({ token, user, loading, login, register, logout, refreshMe, hasRole }),
    [token, user, loading, login, register, logout, refreshMe, hasRole],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth outside AuthProvider')
  return ctx
}
