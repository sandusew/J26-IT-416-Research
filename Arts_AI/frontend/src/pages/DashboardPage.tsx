import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { api } from '../api/endpoints'
import { errorMessage } from '../api/client'
import type {
  CatalogueMeta,
  Consultation,
  NotificationItem,
  ProgressResponse,
  RecommendationItem,
  TwinResponse,
} from '../api/types'
import { PageHeader, LoadingState, EmptyState, ErrorState, Badge } from '../components/ui'
import { formatColombo, subjectLabel } from '../lib/format'

export default function DashboardPage() {
  const { token, user } = useAuth()
  const studentId = user?.studentId || null
  const teacherId = user?.teacherId || null

  const [meta, setMeta] = useState<CatalogueMeta | null>(null)
  const [progress, setProgress] = useState<ProgressResponse | null>(null)
  const [twin, setTwin] = useState<TwinResponse | null>(null)
  const [recs, setRecs] = useState<RecommendationItem[]>([])
  const [consultations, setConsultations] = useState<Consultation[]>([])
  const [notifications, setNotifications] = useState<NotificationItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!token) return
    let cancelled = false
    setLoading(true)
    setError(null)

    const tasks: Promise<void>[] = [
      api.catalogueMeta(token).then((m) => {
        if (!cancelled) setMeta(m)
      }),
      api.notifications(token).then((n) => {
        if (!cancelled) setNotifications(n.notifications || [])
      }),
    ]

    if (studentId) {
      tasks.push(
        api.progress(token, studentId).then((p) => {
          if (!cancelled) setProgress(p)
        }),
        api.twin(token, studentId).then((t) => {
          if (!cancelled) setTwin(t)
        }),
        api
          .recommendations(token, studentId, {
            policyMode: 'prerequisite_aware',
            catalogueMode: 'canonical',
            contentPolicy: 'published_practice',
            limit: 5,
          })
          .then((r) => {
            if (!cancelled) setRecs(r.recommendations || [])
          }),
        api.consultationsStudent(token, studentId).then((c) => {
          if (!cancelled) setConsultations(c.consultations || [])
        }),
      )
    } else if (teacherId) {
      tasks.push(
        api.consultationsTeacher(token, teacherId).then((c) => {
          if (!cancelled) setConsultations(c.consultations || [])
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
  }, [token, studentId, teacherId])

  const cov = meta?.coverage

  return (
    <div>
      <PageHeader
        title={`Welcome${user?.displayName ? `, ${user.displayName}` : ''}`}
        subtitle="Live snapshot from the Arts AI API — coverage counts come from catalogue meta, not hardcoded totals."
      />
      {loading ? <LoadingState label="Loading dashboard…" /> : null}
      {error ? <ErrorState message={error} /> : null}
      {!loading ? (
        <div className="grid gap-4 md:grid-cols-2">
          <section className="card md:col-span-2">
            <h2 className="font-display text-lg text-navy-950">Catalogue coverage</h2>
            {meta ? (
              <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <dt className="text-navy-800/60">Published practice questions</dt>
                  <dd className="text-xl font-semibold text-navy-950">
                    {cov?.publishedPracticeQuestions ?? '—'}
                  </dd>
                </div>
                <div>
                  <dt className="text-navy-800/60">Published practice resources</dt>
                  <dd className="text-xl font-semibold text-navy-950">
                    {cov?.publishedPracticeResources ?? '—'}
                  </dd>
                </div>
                <div>
                  <dt className="text-navy-800/60">Teacher-reviewed questions</dt>
                  <dd className="text-xl font-semibold text-navy-950">
                    {cov?.authenticApprovedQuestions ?? cov?.teacherReviewedQuestions ?? '—'}
                  </dd>
                </div>
                <div>
                  <dt className="text-navy-800/60">Teacher-reviewed resources</dt>
                  <dd className="text-xl font-semibold text-navy-950">
                    {cov?.authenticApprovedResources ?? cov?.teacherReviewedResources ?? '—'}
                  </dd>
                </div>
              </dl>
            ) : (
              <EmptyState title="No catalogue meta" />
            )}
            {cov?.note ? <p className="mt-2 text-xs text-navy-800/60">{cov.note}</p> : null}
            {meta?.note ? <p className="mt-1 text-xs text-navy-800/60">{meta.note}</p> : null}
          </section>

          {studentId ? (
            <>
              <section className="card">
                <h2 className="font-display text-lg text-navy-950">Progress</h2>
                {progress ? (
                  <ul className="mt-2 space-y-1 text-sm text-navy-800/80">
                    <li>Quiz attempts: {progress.nQuizAttempts ?? 0}</li>
                    <li>Recorded practice attempts: {progress.nAuthenticQuizAttempts ?? 0}</li>
                    <li>Snapshots: {progress.progressSnapshots?.length ?? 0}</li>
                  </ul>
                ) : (
                  <EmptyState title="No progress data" />
                )}
                <Link to="/progress" className="btn-secondary mt-3 text-xs">
                  View progress
                </Link>
              </section>

              <section className="card">
                <h2 className="font-display text-lg text-navy-950">Digital twin</h2>
                {twin?.profile ? (
                  <p className="mt-2 text-sm text-navy-800/75">
                    Profile on file
                    {(twin.profile as { profileVersion?: number }).profileVersion != null
                      ? ` (v${(twin.profile as { profileVersion?: number }).profileVersion})`
                      : ''}
                    . Recorded practice summary — not validated mastery.
                  </p>
                ) : (
                  <EmptyState title="No twin profile yet" detail="Complete a practice quiz to build observed performance." />
                )}
                <Link to="/twin" className="btn-secondary mt-3 text-xs">
                  Open twin
                </Link>
              </section>

              <section className="card md:col-span-2">
                <h2 className="font-display text-lg text-navy-950">Recommendations</h2>
                {recs.length === 0 ? (
                  <EmptyState title="No recommendations" detail="Try another subject or complete a quiz first." />
                ) : (
                  <ul className="mt-2 divide-y divide-navy-800/10">
                    {recs.map((r, i) => (
                      <li key={r.resourceId || i} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                        <span>{r.title || r.resourceId || r.topicId}</span>
                        {r.score != null ? (
                          <Badge className="bg-teal-50 text-teal-900">score {Number(r.score).toFixed(2)}</Badge>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          ) : (
            <section className="card md:col-span-2">
              <EmptyState
                title="Student metrics hidden"
                detail="Sign in as a student to see progress, twin, and recommendations on the dashboard."
              />
            </section>
          )}

          <section className="card">
            <h2 className="font-display text-lg text-navy-950">Consultations</h2>
            {consultations.length === 0 ? (
              <EmptyState title="No consultations" />
            ) : (
              <ul className="mt-2 space-y-2 text-sm">
                {consultations.slice(0, 4).map((c) => (
                  <li key={c.consultationId} className="flex flex-wrap gap-2">
                    <Badge className="bg-sand-100 text-navy-800">{c.state}</Badge>
                    <span>{formatColombo(c.requestedSlotStart)}</span>
                    {c.subjectId ? <span className="text-navy-800/60">{subjectLabel(c.subjectId)}</span> : null}
                  </li>
                ))}
              </ul>
            )}
            <Link to="/consultations" className="btn-secondary mt-3 text-xs">
              Manage consultations
            </Link>
          </section>

          <section className="card">
            <h2 className="font-display text-lg text-navy-950">Notifications</h2>
            {notifications.length === 0 ? (
              <EmptyState title="Inbox empty" />
            ) : (
              <ul className="mt-2 space-y-1 text-sm text-navy-800/80">
                {notifications.slice(0, 5).map((n, i) => (
                  <li key={n.notificationId || i}>
                    {(
                      {
                        canonical_quiz_submitted: 'Practice quiz submitted',
                        canonical_quiz_assigned: 'Practice quiz assigned',
                        consultation_approved: 'Consultation approved',
                        consultation_cancelled: 'Consultation cancelled',
                        consultation_declined: 'Consultation declined',
                        peer_group_created: 'Peer group created',
                        peer_group_joined: 'Joined a peer group',
                        peer_join_requested: 'Peer group join request',
                        peer_join_approved: 'Peer group request approved',
                        digital_twin_updated: 'Practice summary updated',
                      } as Record<string, string>
                    )[n.type || ''] || 'Account update'}{' '}
                    · {formatColombo(n.createdAt)}
                  </li>
                ))}
              </ul>
            )}
            <Link to="/notifications" className="btn-secondary mt-3 text-xs">
              All notifications
            </Link>
          </section>
        </div>
      ) : null}
    </div>
  )
}
