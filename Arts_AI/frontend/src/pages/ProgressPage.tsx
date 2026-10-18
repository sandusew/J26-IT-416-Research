import { useEffect, useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useAuth } from '../auth/AuthContext'
import { api } from '../api/endpoints'
import { errorMessage } from '../api/client'
import type { ProgressResponse, RecommendationsResponse } from '../api/types'
import { PageHeader, LoadingState, EmptyState, ErrorState, Badge } from '../components/ui'
import curriculum from '../data/curriculum.en.json'

type CurriculumFile = {
  subjects: Array<{
    subjectId: string
    subjectName: string
    topics: Array<{ topicId: string; topicTitle: string }>
  }>
}

const curriculumData = curriculum as CurriculumFile

function topicLabel(id: string): string {
  for (const s of curriculumData.subjects) {
    const t = s.topics.find((x) => x.topicId === id)
    if (t) return t.topicTitle.length > 28 ? `${t.topicTitle.slice(0, 26)}…` : t.topicTitle
  }
  return id.length > 20 ? `${id.slice(0, 18)}…` : id
}

export default function ProgressPage() {
  const { token, user } = useAuth()
  const studentId = user?.studentId

  const [progress, setProgress] = useState<ProgressResponse | null>(null)
  const [recs, setRecs] = useState<RecommendationsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [subjectFilter, setSubjectFilter] = useState('')
  const [reloadTick, setReloadTick] = useState(0)

  useEffect(() => {
    if (!token || !studentId) {
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    Promise.all([
      api.progress(token, studentId),
      api.recommendations(token, studentId, {
        policyMode: 'prerequisite_aware',
        catalogueMode: 'canonical',
        contentPolicy: 'published_practice',
        limit: 12,
        ...(subjectFilter ? { subjectId: subjectFilter } : {}),
      }),
    ])
      .then(([p, r]) => {
        if (!cancelled) {
          setProgress(p)
          setRecs(r)
        }
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
  }, [token, studentId, subjectFilter, reloadTick])

  const snapshotChart = useMemo(() => {
    const snaps = progress?.progressSnapshots || []
    return snaps
      .map((s) => {
        const topicId = String(s.topicId || '_general')
        const mean = typeof s.meanScore === 'number' ? s.meanScore : Number(s.meanScore)
        return {
          topicId,
          label: topicLabel(topicId),
          meanScore: Number.isFinite(mean) ? mean : 0,
          nAttempts: typeof s.nAttempts === 'number' ? s.nAttempts : 0,
        }
      })
      .filter((row) => row.topicId !== '_general' || row.nAttempts > 0)
  }, [progress])

  const recChart = useMemo(() => {
    return (recs?.recommendations || []).slice(0, 10).map((r, i) => ({
      name: r.title ? (r.title.length > 22 ? `${r.title.slice(0, 20)}…` : r.title) : r.resourceId || `#${i + 1}`,
      score: typeof r.score === 'number' ? r.score : 0,
    }))
  }, [recs])

  if (!studentId) {
    return <EmptyState title="Student account required" detail="Progress is tied to your student id." />
  }

  return (
    <div>
      <PageHeader title="Progress & recommendations" subtitle="Charts use live API data only." />
      <div className="card mb-4 max-w-sm">
        <label className="label" htmlFor="rec-subject">
          Recommendation subject filter
        </label>
        <select
          id="rec-subject"
          className="input"
          value={subjectFilter}
          onChange={(e) => setSubjectFilter(e.target.value)}
        >
          <option value="">All subjects</option>
          {curriculumData.subjects.map((s) => (
            <option key={s.subjectId} value={s.subjectId}>
              {s.subjectName}
            </option>
          ))}
        </select>
      </div>
      {loading ? <LoadingState label="Loading progress…" /> : null}
      {error ? <ErrorState message={error} onRetry={() => setReloadTick((n) => n + 1)} /> : null}
      {!loading && !error ? (
        <>
          <div className="card mb-4 flex flex-wrap gap-2 text-sm">
            {recs?.policyMode ? (
              <Badge className="bg-sand-100 text-navy-800">policyMode: {recs.policyMode}</Badge>
            ) : null}
            {recs?.trainedScorerUsed != null ? (
              <Badge className={recs.trainedScorerUsed ? 'bg-teal-100 text-teal-900' : 'bg-sand-100 text-navy-800'}>
                trainedScorerUsed: {String(recs.trainedScorerUsed)}
              </Badge>
            ) : null}
            {recs?.fallbackReason ? (
              <Badge className="bg-amber-100 text-amber-950">fallback: {recs.fallbackReason}</Badge>
            ) : null}
            {recs?.modelVersion ? (
              <span className="text-xs text-navy-800/55">model {recs.modelVersion}</span>
            ) : null}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="card">
              <h2 className="font-display text-lg text-navy-950">Topic snapshots</h2>
              {snapshotChart.length === 0 ? (
                <EmptyState title="No progress snapshots" detail="Submit a quiz to record attempts." />
              ) : (
                <div className="mt-4 h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={snapshotChart} margin={{ left: 8, right: 8, bottom: 48 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1a406020" />
                      <XAxis dataKey="label" angle={-35} textAnchor="end" interval={0} height={60} tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Bar dataKey="meanScore" fill="#0f766e" name="Mean score" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
              {progress?.note ? <p className="mt-2 text-xs text-navy-800/60">{progress.note}</p> : null}
            </section>

            <section className="card">
              <h2 className="font-display text-lg text-navy-950">Recommendation scores</h2>
              {recChart.length === 0 ? (
                <EmptyState
                  title="No recommendations to chart"
                  detail={
                    recs?.fallbackReason
                      ? `Policy fallback: ${recs.fallbackReason}`
                      : subjectFilter
                        ? 'No eligible published-practice resources for this subject/prerequisites.'
                        : 'Complete a quiz or clear filters; eligibility respects prerequisites.'
                  }
                />
              ) : (
                <div className="mt-4 h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={recChart} layout="vertical" margin={{ left: 8, right: 16 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1a406020" />
                      <XAxis type="number" tick={{ fontSize: 11 }} />
                      <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 10 }} />
                      <Tooltip />
                      <Bar dataKey="score" fill="#0d9488" name="Score" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
              {recs?.note ? <p className="mt-2 text-xs text-navy-800/60">{recs.note}</p> : null}
            </section>
          </div>

          <section className="card mt-4 text-sm text-navy-800/75">
            <p>Quiz attempts (total): {progress?.nQuizAttempts ?? 0}</p>
            <p>Recorded practice attempts: {progress?.nAuthenticQuizAttempts ?? 0}</p>
            <p>Eligible resources (last rec fetch): {recs?.nEligible ?? '—'}</p>
          </section>
        </>
      ) : null}
    </div>
  )
}
