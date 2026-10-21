import { useEffect, useState, type FormEvent } from 'react'
import { useAuth } from '../auth/AuthContext'
import { api } from '../api/endpoints'
import { errorMessage } from '../api/client'
import type { TwinResponse } from '../api/types'
import { ErrorState, PageHeader, SuccessBanner } from '../components/ui'
import { formatColombo } from '../lib/format'
import curriculum from '../data/curriculum.en.json'

type CurriculumFile = { subjects: Array<{ subjectId: string; subjectName: string }> }
const subjects = (curriculum as CurriculumFile).subjects

export default function ProfilePage() {
  const { token, user, refreshMe } = useAuth()
  const [displayName, setDisplayName] = useState(user?.displayName || '')
  const [school, setSchool] = useState(user?.school || '')
  const [email, setEmail] = useState(user?.email || '')
  const [grade, setGrade] = useState(user?.grade || '')
  const [subjectIds, setSubjectIds] = useState<string[]>(user?.subjectIds || [])
  const [twin, setTwin] = useState<TwinResponse | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  useEffect(() => {
    setDisplayName(user?.displayName || '')
    setSchool(user?.school || '')
    setEmail(user?.email || '')
    setGrade(user?.grade || '')
    setSubjectIds(user?.subjectIds || [])
  }, [user])

  useEffect(() => {
    if (!token || !user?.studentId) return
    let cancelled = false
    api.twin(token, user.studentId).then((value) => {
      if (!cancelled) setTwin(value)
    }).catch(() => {
      if (!cancelled) setTwin(null)
    })
    return () => {
      cancelled = true
    }
  }, [token, user?.studentId])

  const payload = (twin?.profile as { payload?: Record<string, unknown> } | null)?.payload
    || (twin?.profile as Record<string, unknown> | null)
  const initial = payload?.initial_assessment as Record<string, unknown> | undefined
  const period = payload?.observation_period as Record<string, unknown> | undefined
  const observed = payload?.observed_topic_performance as Record<string, { nAttempts?: number }> | undefined
  const evidence = observed ? Object.values(observed).reduce((sum, row) => sum + (row.nAttempts || 0), 0) : 0

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!token) return
    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      await api.updateProfile(token, { displayName, school, email, grade, subjectIds })
      await refreshMe()
      setSuccess('Profile saved.')
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Student profile" subtitle="Account details are separate from your learning summary." />
      <form onSubmit={onSubmit} className="card space-y-3">
        <h2 className="font-bold text-navy-950">Account</h2>
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <div><dt className="text-navy-800/60">Student ID</dt><dd>{user?.studentId || '—'}</dd></div>
          <div><dt className="text-navy-800/60">Login</dt><dd>{user?.username}</dd></div>
          <div><dt className="text-navy-800/60">Role</dt><dd className="capitalize">{user?.role}</dd></div>
          <div><dt className="text-navy-800/60">Joined</dt><dd>{formatColombo(user?.createdAt || undefined)}</dd></div>
        </dl>
        <div>
          <label className="label" htmlFor="profile-name">Full name</label>
          <input id="profile-name" className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
        </div>
        <div>
          <label className="label" htmlFor="profile-school">School</label>
          <input id="profile-school" className="input" value={school} onChange={(e) => setSchool(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="profile-email">Email</label>
          <input id="profile-email" type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="profile-grade">Grade</label>
          <select id="profile-grade" className="input" value={grade || ''} onChange={(e) => setGrade(e.target.value)}>
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
                  onChange={() =>
                    setSubjectIds((current) =>
                      current.includes(subject.subjectId)
                        ? current.filter((id) => id !== subject.subjectId)
                        : [...current, subject.subjectId],
                    )
                  }
                />
                {subject.subjectName}
              </label>
            ))}
          </div>
        </fieldset>
        {error ? <ErrorState message={error} /> : null}
        {success ? <SuccessBanner message={success} /> : null}
        <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save profile'}</button>
      </form>

      <section className="card">
        <h2 className="font-bold text-navy-950">Initial assessment</h2>
        {initial ? (
          <p className="mt-2 text-sm text-navy-800/80">
            Score {String(initial.score)} / {String(initial.maxMarks)}. {String(initial.note || '')}
          </p>
        ) : (
          <p className="mt-2 text-sm text-navy-800/70">No initial assessment is stored for this account.</p>
        )}
      </section>

      <section className="card">
        <h2 className="font-bold text-navy-950">Observed learning summary</h2>
        {period?.statusLabel ? <p className="mt-2 text-sm font-medium">{String(period.statusLabel)}</p> : null}
        {period?.startedAt ? (
          <p className="mt-1 text-sm text-navy-800/70">
            {formatColombo(String(period.startedAt))} → {formatColombo(String(period.endsAt))}
          </p>
        ) : null}
        <p className="mt-2 text-sm text-navy-800/80">
          Stored question attempts in the learning summary: {evidence}. The initial assessment is listed above and is not subject mastery.
        </p>
      </section>
    </div>
  )
}  
