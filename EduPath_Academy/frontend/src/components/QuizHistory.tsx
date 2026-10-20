import { useEffect, useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import { api } from '../api/endpoints'
import { errorMessage } from '../api/client'
import type { QuizHistoryRow } from '../api/types'
import { ErrorState, LoadingState } from '../components/ui'
import { formatColombo, subjectLabel } from '../lib/format'
import curriculum from '../data/curriculum.en.json'

type CurriculumFile = { subjects: Array<{ subjectId: string; subjectName: string }> }
const subjects = (curriculum as CurriculumFile).subjects

export function QuizHistory({
  subjectId,
  onContinue,
  onView,
}: {
  subjectId?: string
  onContinue?: (assignmentId: string) => void
  onView?: (assignmentId: string) => void
}) {
  const { token, user } = useAuth()
  const [rows, setRows] = useState<QuizHistoryRow[]>([])
  const [status, setStatus] = useState('')
  const [filterSubject, setFilterSubject] = useState(subjectId || '')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setFilterSubject(subjectId || '')
  }, [subjectId])

  useEffect(() => {
    if (!token || !user?.studentId) {
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    setRows([])
    api.quizHistory(token, user.studentId, {
      subjectId: filterSubject || undefined,
      status: status || undefined,
      limit: 20,
    })
      .then((res) => {
        if (!cancelled) setRows(res.assignments || [])
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [token, user?.studentId, filterSubject, status])

  return (
    <section className="card">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-lg font-bold text-navy-950">Quiz history</h2>
        <div className="flex flex-wrap gap-2">
          <label className="text-xs">
            Subject
            <select className="input mt-1" value={filterSubject} onChange={(e) => setFilterSubject(e.target.value)} aria-label="History subject">
              <option value="">All</option>
              {subjects.map((subject) => (
                <option key={subject.subjectId} value={subject.subjectId}>{subject.subjectName}</option>
              ))}
            </select>
          </label>
          <label className="text-xs">
            Status
            <select className="input mt-1" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="History status">
              <option value="">All</option>
              <option value="assigned">In progress</option>
              <option value="submitted">Submitted</option>
            </select>
          </label>
        </div>
      </div>
      {loading ? <LoadingState label="Loading history…" /> : null}
      {error ? <ErrorState message={error} /> : null}
      {!loading && !error && rows.length === 0 ? <p className="mt-3 text-sm text-navy-800/70">No quizzes for this filter.</p> : null}
      <ul className="mt-3 space-y-3">
        {rows.map((row) => (
          <li key={row.assignmentId} className="rounded-2xl bg-[#f6f7fb] p-3 text-sm">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="font-semibold">{row.title}</p>
                <p className="text-navy-800/70">{subjectLabel(row.subjectId || '')} · {row.topicId}</p>
                <p className="text-xs text-navy-800/60">
                  Assigned {formatColombo(row.assignedAt)}
                  {row.submittedAt ? ` · Submitted ${formatColombo(row.submittedAt)}` : ''}
                </p>
              </div>
              <span className="rounded-full bg-white px-2 py-1 text-xs capitalize">{row.status}</span>
            </div>
            {row.status === 'submitted' ? (
              <p className="mt-2">
                {row.score ?? '—'} / {row.maxMarks ?? '—'}
                {row.percent != null ? ` (${row.percent}%)` : ''}
              </p>
            ) : (
              <p className="mt-2 text-navy-800/70">Not submitted. Score stays hidden.</p>
            )}
            <div className="mt-2 flex gap-2">
              {row.canContinue && onContinue ? (
                <button type="button" className="btn-primary text-xs" onClick={() => onContinue(row.assignmentId)}>Continue</button>
              ) : null}
              {row.status === 'submitted' && onView ? (
                <button type="button" className="btn-secondary text-xs" onClick={() => onView(row.assignmentId)}>View result</button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
