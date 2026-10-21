import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { errorMessage } from '../api/client'
import { BrandLogo } from '../components/BrandLogo'
import { ErrorState } from '../components/ui'
import curriculum from '../data/curriculum.en.json'

type CurriculumFile = { subjects: Array<{ subjectId: string; subjectName: string }> }
const subjects = (curriculum as CurriculumFile).subjects  

export default function RegisterPage() {
  const { register, token, user } = useAuth()
  const navigate = useNavigate()
  const [studentId, setStudentId] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [school, setSchool] = useState('')
  const [email, setEmail] = useState('')
  const [grade, setGrade] = useState('')
  const [subjectIds, setSubjectIds] = useState<string[]>([])
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (token && user) {
    const needs = user.onboardingStatus === 'not_started' || user.onboardingStatus === 'in_progress'
    return <Navigate to={needs ? '/onboarding' : '/dashboard'} replace />
  }

  function toggleSubject(id: string) {
    setSubjectIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]))
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await register({
        studentId,
        displayName,
        school,
        email,
        grade: grade || undefined,
        subjectIds,
        password,
        confirmPassword,
      })
      navigate('/onboarding', { replace: true })
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-[#6d5efc] via-[#4c3ad6] to-[#24145f] px-4 py-8">
      <div className="card w-full max-w-lg">
        <div className="mb-4 flex justify-center rounded-2xl bg-black px-3 py-2">
          <BrandLogo className="h-14 w-[200px]" />
        </div>
        <h1 className="text-center text-2xl font-bold text-navy-950">Create student account</h1>
        <p className="mt-2 text-center text-sm text-navy-800/70">
          You sign in with your student ID. Registration checks that the student ID and email are not already used. It does not verify a school roster.
        </p>
        <form onSubmit={onSubmit} className="mt-5 space-y-3">
          <div>
            <label className="label" htmlFor="reg-id">Student ID</label>
            <input id="reg-id" className="input" value={studentId} onChange={(e) => setStudentId(e.target.value)} required autoComplete="username" />
          </div>
          <div>
            <label className="label" htmlFor="reg-name">Full name</label>
            <input id="reg-name" className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
          </div>
          <div>
            <label className="label" htmlFor="reg-school">School</label>
            <input id="reg-school" className="input" value={school} onChange={(e) => setSchool(e.target.value)} required />
          </div>
          <div>
            <label className="label" htmlFor="reg-email">Email</label>
            <input id="reg-email" type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
          </div>
          <div>
            <label className="label" htmlFor="reg-grade">Grade</label>
            <select id="reg-grade" className="input" value={grade} onChange={(e) => setGrade(e.target.value)}>
              <option value="">Not specified</option>
              <option value="12">12</option>
              <option value="13">13</option>
            </select>
          </div>
          <fieldset>
            <legend className="label">Subjects</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {subjects.map((subject) => (
                <label key={subject.subjectId} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={subjectIds.includes(subject.subjectId)}
                    onChange={() => toggleSubject(subject.subjectId)}
                  />
                  {subject.subjectName}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="reg-password">Password</label>
              <input id="reg-password" type="password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} autoComplete="new-password" />
            </div>
            <div>
              <label className="label" htmlFor="reg-confirm">Confirm password</label>
              <input id="reg-confirm" type="password" className="input" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required minLength={8} autoComplete="new-password" />
            </div>
          </div>
          {error ? <ErrorState message={error} /> : null}
          <button type="submit" className="btn-primary w-full" disabled={submitting}>
            {submitting ? 'Creating account…' : 'Create student account'}
          </button>
        </form>
        <p className="mt-4 text-center text-sm">
          <Link to="/login" className="text-[#4c3ad6] hover:underline">Back to sign in</Link>
        </p>
      </div>
    </div>
  )
}
