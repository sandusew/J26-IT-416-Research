import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Calendar, ExternalLink } from 'lucide-react'
import { useAuth } from '../auth/AuthContext'
import { api } from '../api/endpoints'
import { errorMessage } from '../api/client'
import type { Consultation } from '../api/types'
import { PageHeader, LoadingState, EmptyState, ErrorState, Badge, SuccessBanner } from '../components/ui'
import { formatColombo, isHttpUrl, subjectLabel } from '../lib/format'
import curriculum from '../data/curriculum.en.json'

type CurriculumFile = { subjects: Array<{ subjectId: string; subjectName: string }> }
const subjects = (curriculum as CurriculumFile).subjects

type Teacher = { teacherId: string; username: string; displayName: string }

export default function ConsultationsPage() {
  const { token, user, hasRole } = useAuth()
  const isStudent = hasRole('student')
  const isTeacher = hasRole('teacher')
  const studentId = user?.studentId
  const teacherId = user?.teacherId

  const [list, setList] = useState<Consultation[]>([])
  const [teachers, setTeachers] = useState<Teacher[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [acting, setActing] = useState<string | null>(null)
  const [requesting, setRequesting] = useState(false)

  const [teacherPick, setTeacherPick] = useState('')
  const [subjectId, setSubjectId] = useState('')
  const [slotStart, setSlotStart] = useState('')
  const [slotEnd, setSlotEnd] = useState('')

  const load = useCallback(() => {
    if (!token) return
    let cancelled = false
    setLoading(true)
    setError(null)
    const tasks: Promise<void>[] = []
    if (isStudent && studentId) {
      tasks.push(
        api.consultationsStudent(token, studentId).then((r) => {
          if (!cancelled) setList(r.consultations || [])
        }),
        api.teachers(token).then((r) => {
          if (!cancelled) {
            setTeachers(r.teachers || [])
            if (r.teachers?.[0]) setTeacherPick((p) => p || r.teachers[0].teacherId)
          }
        }),
      )
    } else if (isTeacher && teacherId) {
      tasks.push(
        api.consultationsTeacher(token, teacherId).then((r) => {
          if (!cancelled) setList(r.consultations || [])
        }),
      )
    }
    Promise.all(tasks)
      .catch((e) => {
        if (!cancelled) setError(errorMessage(e))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [token, isStudent, isTeacher, studentId, teacherId])

  useEffect(() => {
    const cleanup = load()
    return () => cleanup?.()
  }, [load])

  async function requestSlot(e: FormEvent) {
    e.preventDefault()
    if (!token || !teacherPick || !slotStart || !slotEnd || requesting) return
    const start = new Date(slotStart)
    const end = new Date(slotEnd)
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || !(start < end)) {
      setError('Choose a valid slot. The end must be after the start.')
      return
    }
    setRequesting(true)
    setError(null)
    setSuccess(null)
    try {
      await api.requestConsultation(token, {
        teacherId: teacherPick,
        subjectId: subjectId || undefined,
        requestedSlotStart: start.toISOString(),
        requestedSlotEnd: end.toISOString(),
      })
      setSuccess('Consultation requested.')
      setSlotStart('')
      setSlotEnd('')
      load()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setRequesting(false)
    }
  }

  async function transition(consultationId: string, state: string) {
    if (!token) return
    setActing(consultationId)
    setError(null)
    try {
      await api.patchConsultation(token, consultationId, state)
      setSuccess(`Updated to ${state}.`)
      load()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setActing(null)
    }
  }

  return (
    <div>
      <PageHeader
        title="Consultations"
        subtitle="Book teacher slots (students) or manage your inbox (teachers). Times shown in Colombo."
      />
      {loading ? <LoadingState label="Loading consultations…" /> : null}
      {error ? <ErrorState message={error} onRetry={load} /> : null}
      {success ? <SuccessBanner message={success} /> : null}

      {isStudent && studentId ? (
        <form onSubmit={requestSlot} className="card mb-6 max-w-xl space-y-3">
          <h2 className="font-display text-lg text-navy-950">Request a slot</h2>
          <div>
            <label className="label" htmlFor="con-teacher">
              Teacher
            </label>
            <select
              id="con-teacher"
              className="input"
              value={teacherPick}
              onChange={(e) => setTeacherPick(e.target.value)}
              required
            >
              {teachers.map((t) => (
                <option key={t.teacherId} value={t.teacherId}>
                  {t.displayName || t.username}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="con-subject">
              Subject (optional)
            </label>
            <select id="con-subject" className="input" value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
              <option value="">—</option>
              {subjects.map((s) => (
                <option key={s.subjectId} value={s.subjectId}>
                  {s.subjectName}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="con-start">
                Start (local)
              </label>
              <input
                id="con-start"
                type="datetime-local"
                className="input"
                value={slotStart}
                onChange={(e) => setSlotStart(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="label" htmlFor="con-end">
                End (local)
              </label>
              <input
                id="con-end"
                type="datetime-local"
                className="input"
                value={slotEnd}
                onChange={(e) => setSlotEnd(e.target.value)}
                required
              />
            </div>
          </div>
          <button type="submit" className="btn-primary" disabled={requesting}>
            <Calendar className="h-4 w-4" aria-hidden />
            {requesting ? 'Requesting…' : 'Request'}
          </button>
        </form>
      ) : null}

      {list.length === 0 && !loading ? (
        <EmptyState title="No consultations" detail={isTeacher ? 'Your inbox is empty.' : 'Request a slot above.'} />
      ) : (
        <ul className="space-y-3">
          {list.map((c) => (
            <li key={c.consultationId} className="card">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap gap-2">
                    <Badge className="bg-sand-100 text-navy-800">{c.state}</Badge>
                    {c.subjectId ? (
                      <Badge className="bg-teal-50 text-teal-900">{subjectLabel(c.subjectId)}</Badge>
                    ) : null}
                  </div>
                  <p className="mt-2 text-sm text-navy-900">
                    {formatColombo(c.requestedSlotStart)} → {formatColombo(c.requestedSlotEnd)}
                  </p>
                  <p className="text-xs text-navy-800/55">ID {c.consultationId}</p>
                  {c.meetingIntegrationStatus ? (
                    <p className="text-xs text-navy-800/55">Meeting: {c.meetingIntegrationStatus}</p>
                  ) : null}
                </div>
                <div className="flex flex-col items-end gap-2">
                  {isHttpUrl(c.meetingUrl) ? (
                    <a
                      href={c.meetingUrl!}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn-primary text-sm"
                    >
                      Join
                      <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                    </a>
                  ) : c.state === 'approved' ? (
                    <span className="text-xs text-amber-900">Meeting link unavailable</span>
                  ) : null}
                  {isTeacher && c.state === 'requested' ? (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className="btn-primary text-xs"
                        disabled={acting === c.consultationId}
                        onClick={() => void transition(c.consultationId, 'approved')}
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        className="btn-secondary text-xs"
                        disabled={acting === c.consultationId}
                        onClick={() => void transition(c.consultationId, 'declined')}
                      >
                        Decline
                      </button>
                    </div>
                  ) : null}
                  {(isStudent || isTeacher) &&
                  (c.state === 'requested' || c.state === 'approved') ? (
                    <button
                      type="button"
                      className="btn-danger text-xs"
                      disabled={acting === c.consultationId}
                      onClick={() => void transition(c.consultationId, 'cancelled')}
                    >
                      Cancel
                    </button>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
