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
import curriculum from '../data/curriculum.en.json'

type CurriculumFile = {
  subjects: Array<{ subjectId: string; subjectName: string; topics: Array<{ topicId: string }> }>
}
const curriculumData = curriculum as CurriculumFile

function asPercent(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return null
  if (n <= 1) return Math.round(n * 100)
  return Math.round(Math.min(100, n))
}

function greeting(name?: string) {
  const hour = new Date().getHours()
  const hello = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  return name ? `${hello}, ${name}` : hello
}

const BAR_COLORS = ['bg-emerald-500', 'bg-indigo-500', 'bg-orange-500', 'bg-rose-500']

function subjectForTopic(topicId?: string) {
  if (!topicId) return ''
  if (topicId.startsWith('hist_')) return 'sub_history'
  if (topicId.startsWith('geo_')) return 'sub_geography'
  if (topicId.startsWith('pol_')) return 'sub_political'
  if (topicId.startsWith('eco_')) return 'sub_economics'
  return ''
}

function recHref(item: RecommendationItem) {
  if (item.resourceId) return `/resources/${encodeURIComponent(String(item.resourceId))}`
  const subjectId = subjectForTopic(item.topicId)
  if (item.topicId && subjectId) {
    return `/quiz?subjectId=${encodeURIComponent(subjectId)}&topicId=${encodeURIComponent(String(item.topicId))}`
  }
  return '/quiz'
}

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
  const hero = recs[0]
  const observed =
    (twin?.profile as { payload?: { observed_topic_performance?: Record<string, { meanScore?: number }> } } | null)
      ?.payload?.observed_topic_performance ||
    (twin?.profile as { observed_topic_performance?: Record<string, { meanScore?: number }> } | null)
      ?.observed_topic_performance
  const subjectBars = curriculumData.subjects.map((subject) => {
    const scores = subject.topics
      .map((topic) => asPercent(observed?.[topic.topicId]?.meanScore))
      .filter((n): n is number => n != null)
    const value = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null
    return { name: subject.subjectName, value }
  })

  return (
    <div>
      <PageHeader
        title={greeting(user?.displayName || user?.username)}
        subtitle="Your learning experience has been personalized based on your latest progress."
      />
      {loading ? <LoadingState label="Loading dashboard…" /> : null}
      {error ? <ErrorState message={error} /> : null}
      {!loading && studentId ? (
        <div className="space-y-4">
          <section className="rounded-3xl bg-gradient-to-r from-[#5b4bff] to-[#7a5cff] p-6 text-white shadow-sm">
            <p className="text-xs font-semibold tracking-[0.14em] text-white/80">NEXT BEST LEARNING ACTIVITY</p>
            <h2 className="mt-3 break-words text-2xl font-bold">{hero?.title || hero?.topicId || 'Start a practice quiz'}</h2>
            <p className="mt-1 text-sm text-white/80">
              {hero?.reason ? String(hero.reason) : 'Personalized from your latest practice and published catalogue.'}
            </p>
            <Link to={hero ? recHref(hero) : '/quiz'} className="mt-4 inline-flex items-center rounded-full bg-white px-4 py-2 text-sm font-semibold text-[#4c3ad6]">
              {hero?.resourceId ? 'Open resource' : 'Start practice'}
            </Link>
            <div className="mt-5 rounded-2xl bg-white/15 p-4 text-sm">
              <p className="font-semibold">WHY AM I SEEING THIS?</p>
              <p className="mt-1 text-white/90">
                  {hero
                  ? 'This suggestion uses the prerequisite rule on published practice resources. It is not a trained ranker score.'
                  : 'Complete a practice quiz so Edupath Academy can recommend the next activity.'}
              </p>
            </div>
          </section>

          <div className="grid gap-4 xl:grid-cols-[1fr_18rem]">
            <section id="recommendations" className="card">
              <div className="mb-4 flex items-center justify-between gap-3">
                <h2 className="text-lg font-bold text-navy-950">Personalized Recommendations</h2>
                <Link to="/progress" className="text-xs font-medium text-[#4c3ad6]">
                  View progress
                </Link>
              </div>
              {recs.length === 0 ? (
                <EmptyState title="No recommendations" detail="Complete a quiz first." />
              ) : (
                <ul className="grid gap-3 sm:grid-cols-2">
                  {recs.slice(0, 4).map((r, i) => (
                    <li key={r.resourceId || i} className="rounded-2xl bg-[#f6f7fb] p-4">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-[11px] font-semibold tracking-wide text-navy-800/50">
                          {(r.topicId || 'PRACTICE').toString().toUpperCase()}
                        </p>
                        <span className="text-xs font-semibold text-[#4c3ad6]">Rule-based</span>
                      </div>
                      <p className="mt-2 font-semibold text-navy-950">{r.title || r.resourceId || r.topicId}</p>
                      <Link to={recHref(r)} className="btn-secondary mt-4 w-full text-xs">
                        {r.resourceId ? 'Open resource' : 'Start practice'}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="card">
              <h2 className="text-lg font-bold text-navy-950">Strengths & Weaknesses</h2>
              <ul className="mt-4 space-y-3">
                {subjectBars.map((bar, i) => (
                  <li key={bar.name}>
                    <div className="mb-1 flex justify-between text-sm">
                      <span>{bar.name}</span>
                      <span className="font-semibold">{bar.value == null ? '—' : `${bar.value}%`}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-sand-100">
                      <div className={`h-full ${BAR_COLORS[i % BAR_COLORS.length]}`} style={{ width: `${bar.value ?? 0}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
              <p className="mt-4 rounded-2xl bg-[#f3f1ff] p-3 text-xs text-navy-800/80">
                Scores are recorded practice averages, not an exam prediction.
                {twin?.profile ? ' Your digital twin is on file.' : ' Complete a quiz to build your twin.'}
              </p>
            </section>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="card">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-navy-950">Next Adaptive Assessment</h2>
                <Badge className="bg-violet-100 text-violet-900">PRACTICE</Badge>
              </div>
              <p className="mt-4 font-semibold text-navy-950">{hero?.title || 'Choose a topic and start a quiz'}</p>
              <p className="mt-1 text-sm text-navy-800/70">
                Completed practice quizzes: {progress?.nCompletedPracticeQuizzes ?? 0} · Practice questions: {progress?.nPracticeQuestionAttempts ?? 0}
              </p>
              <Link to="/quiz" className="btn-primary mt-4">
                Start Assessment Now
              </Link>
            </section>
            <section className="card">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-navy-950">Today&apos;s Personalized Plan</h2>
                <span className="text-xs text-navy-800/50">{recs.length} suggested</span>
              </div>
              {recs.length === 0 ? (
                <EmptyState title="No plan yet" />
              ) : (
                <ul className="mt-4 space-y-3">
                  {recs.slice(0, 4).map((r, i) => (
                    <li key={`${r.resourceId || i}-plan`} className="flex gap-3 text-sm">
                      <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${i === 0 ? 'bg-[#4c3ad6]' : 'bg-emerald-500'}`} />
                      <span>
                        <span className="font-semibold text-navy-950">{r.title || r.topicId}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </div>
      ) : null}

      {!loading && !studentId ? (
        <EmptyState
          title="Student metrics hidden"
          detail="Sign in as a student to see progress, twin, and recommendations on the dashboard."
        />
      ) : null}

      {!loading ? (
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <section className="card md:col-span-2">
            <h2 className="font-display text-lg font-bold text-navy-950">Catalogue coverage</h2>
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
