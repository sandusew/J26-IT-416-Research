import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import { api } from '../api/endpoints'
import { errorMessage } from '../api/client'
import type { TwinResponse } from '../api/types'
import { Link, useSearchParams } from 'react-router-dom'
import { PageHeader, LoadingState, EmptyState, ErrorState } from '../components/ui'
import { formatColombo } from '../lib/format'
import curriculum from '../data/curriculum.en.json'

type TopicPerf = Record<string, { meanScore?: number | null; nAttempts?: number }>

type CurriculumFile = {
  subjects: Array<{ topics: Array<{ topicId: string; topicTitle: string }> }>
}

const curriculumData = curriculum as CurriculumFile

function topicTitle(id: string): string {
  for (const s of curriculumData.subjects) {
    const t = s.topics.find((x) => x.topicId === id)
    if (t) return t.topicTitle
  }
  return 'Practice topic'
}

function accountOriginLabel(category?: string): string {
  if (category === 'synthetic_learner') return 'Demo or synthetic learner account'
  if (category === 'test_fixture_learner') return 'Fixture test account'
  if (!category) return 'Account origin not recorded'
  return 'Account origin recorded separately from content origin'
}

function formatMarks(value: unknown): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
  return value.toFixed(2)
}

function extractPayload(twin: TwinResponse | null): Record<string, unknown> | null {
  if (!twin?.profile) return null
  const p = twin.profile as Record<string, unknown>
  if (p.payload && typeof p.payload === 'object') return p.payload as Record<string, unknown>
  return p
}

export default function TwinPage() {
  const { token, user } = useAuth()
  const studentId = user?.studentId
  const [searchParams] = useSearchParams()
  const profileView = searchParams.get('view') === 'profile'

  const [twin, setTwin] = useState<TwinResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!token || !studentId) {
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    api
      .twin(token, studentId)
      .then((t) => {
        if (!cancelled) setTwin(t)
      })
      .catch((e) => {
        if (!cancelled) setError(errorMessage(e))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [token, studentId])

  const payload = useMemo(() => extractPayload(twin), [twin])
  const observed = payload?.observed_topic_performance as TopicPerf | undefined
  const profile = twin?.profile as { updatedAt?: string; createdAt?: string; dataCategory?: string } | null
  const updatedAt = profile?.updatedAt || profile?.createdAt
  const dataCategory =
    (payload?.data_category as string | undefined) || profile?.dataCategory

  if (!studentId) {
    return (
      <EmptyState
        title="Student account required"
        detail="Digital twin profiles are tied to a student id."
      />
    )
  }

  const rows = observed ? Object.entries(observed) : []

  return (
    <div>
      <PageHeader
        title={profileView ? 'Student Profile' : 'Cognitive & Behavioural Insights'}
        subtitle={
          profileView
            ? `Welcome back, ${user?.displayName || user?.username || 'student'}`
            : 'Advanced analysis of your recorded learning patterns. Scores are practice results, not an exam prediction.'
        }
      />
      {loading ? <LoadingState label="Loading twin…" /> : null}
      {error ? <ErrorState message={error} /> : null}
      {!loading && !error && !payload ? (
        <EmptyState
          title="No practice summary yet"
          detail="Submit a practice quiz. Your recorded scores will appear here after the server saves them."
        />
      ) : null}
      {payload ? (
        <div className="space-y-4">
          {payload.observation_period && typeof payload.observation_period === 'object' ? (
            <section className="card text-sm">
              <p className="font-semibold">{String((payload.observation_period as { statusLabel?: string }).statusLabel || '')}</p>
              <p className="mt-1 text-navy-800/70">{String((payload.observation_period as { note?: string }).note || '')}</p>
            </section>
          ) : null}
          {payload.initial_assessment && typeof payload.initial_assessment === 'object' ? (
            <section className="card text-sm">
              <h2 className="font-bold">Initial assessment</h2>
              <p className="mt-1">
                Score {String((payload.initial_assessment as { score?: number }).score ?? '—')} / {String((payload.initial_assessment as { maxMarks?: number }).maxMarks ?? '—')}
              </p>
              <p className="mt-1 text-navy-800/70">{String((payload.initial_assessment as { note?: string }).note || '')}</p>
            </section>
          ) : null}
          {profileView ? (
            <section className="card flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="text-2xl font-bold text-navy-950">{user?.displayName || user?.username}</p>
                <p className="text-sm text-navy-800/70">A/L Arts student · {studentId}</p>
                <p className="mt-1 text-xs text-navy-800/55">{accountOriginLabel(dataCategory)}</p>
              </div>
              <Link to="/subjects" className="btn-primary">
                View subjects
              </Link>
            </section>
          ) : null}
          <div className="card space-y-1 text-sm text-navy-800">
            <p>{accountOriginLabel(dataCategory)}</p>
            <p>
              <span className="text-navy-800/60">Last update:</span> {formatColombo(updatedAt)}
            </p>
            <p className="text-xs text-navy-800/60">
              Average marks are the mean score per recorded question (usually 0–1 mark). Missing scores stay blank. Content origin of questions is shown on the resource and quiz, not here.
            </p>
          </div>

          {rows.length > 0 ? (
            <section className="card">
              <h2 className="font-display text-lg text-navy-950">Recorded practice attempts</h2>
              <ul className="mt-3 divide-y divide-navy-800/10">
                {rows.map(([topicId, stats]) => (
                  <li key={topicId} className="py-3 text-sm">
                    <p className="font-medium text-navy-950">{topicTitle(topicId)}</p>
                    <dl className="mt-2 grid grid-cols-2 gap-2">
                      <div>
                        <dt className="text-navy-800/55">Average marks</dt>
                        <dd>{formatMarks(stats?.meanScore)}</dd>
                      </div>
                      <div>
                        <dt className="text-navy-800/55">Question attempts</dt>
                        <dd>{typeof stats?.nAttempts === 'number' ? stats.nAttempts : '—'}</dd>
                      </div>
                    </dl>
                  </li>
                ))}
              </ul>
            </section>
          ) : (
            <EmptyState title="No recorded practice attempts yet" />
          )}

          <details className="card text-sm text-navy-800/75">
            <summary className="cursor-pointer font-medium text-navy-900">About this summary</summary>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
              <li>Scores come from server-graded practice quizzes for this account.</li>
              <li>Fixture practice, when present, is kept separate and is not mixed into this list.</li>
              <li>Model Explorer public-data demos are not written into this profile.</li>
              <li>A demo account label does not mean the questions are official exam papers.</li>
            </ul>
          </details>
        </div>
      ) : null}
    </div>
  )
}
