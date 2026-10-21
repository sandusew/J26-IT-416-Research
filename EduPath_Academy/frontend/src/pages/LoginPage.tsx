import { useEffect, useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { LogIn } from 'lucide-react'
import { useAuth } from '../auth/AuthContext'
import { errorMessage } from '../api/client'
import { BrandLogo } from '../components/BrandLogo'
import { ErrorState, LoadingState } from '../components/ui'

export default function LoginPage() {
  const { login, token, user, loading } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from || '/dashboard'

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)   
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setError(null)
  }, [username, password])

  if (loading) return <LoadingState label="Checking session…" />
  if (token && user) return <Navigate to={from} replace />

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      await login(username.trim(), password)
      navigate(from, { replace: true })
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-[#6d5efc] via-[#4c3ad6] to-[#24145f] px-4">
      <div className="card w-full max-w-md">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-4 w-fit rounded-2xl bg-black px-3 py-2">
            <BrandLogo className="h-16" />
          </div>
          <h1 className="font-display text-2xl font-bold text-navy-950">Edupath Academy</h1>
          <p className="mt-1 text-sm text-navy-800/70">Sign in to continue</p>
        </div>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="label" htmlFor="username">
              Username
            </label>
            <input
              id="username"
              className="input"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="label" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              type="password"
              className="input"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          {error ? <ErrorState message={error} /> : null}
          <button type="submit" className="btn-primary w-full" disabled={submitting}>
            <LogIn className="h-4 w-4" aria-hidden />
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <p className="mt-4 text-center text-sm">
          <Link to="/register" className="font-medium text-[#4c3ad6] hover:underline">
            Create student account
          </Link>
        </p>
        <p className="mt-4 text-center text-xs text-navy-800/60">
          Demo: <code className="text-navy-900">demo_stu</code> /{' '}
          <code className="text-navy-900">demo_tea</code> — password{' '}
          <code className="text-navy-900">pw</code>
        </p>
        <p className="mt-2 text-center text-xs">
          <Link to="/" className="text-teal-700 hover:underline">
            Back
          </Link>
        </p>
      </div>
    </div>
  )
}
