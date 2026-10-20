import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { api } from '../api/endpoints'
import { errorMessage } from '../api/client'
import type { TwinResponse } from '../api/types'
import { PageHeader, LoadingState, EmptyState, ErrorState } from '../components/ui'
import curriculum from '../data/curriculum.en.json'

type CurriculumFile = {
  subjects: Array<{ subjectId: string; subjectName: string; topics: Array<{ topicId: string; topicTitle: string }> }>
}
const curriculumData = curriculum as CurriculumFile

function asPercent(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return null
  if (n <= 1) return Math.round(n * 100)
  return Math.round(Math.min(100, n))
}

function band(score: number | null): 'Low' | 'Medium' | 'High' | 'Unknown' {
  if (score == null) return 'Unknown'
  if (score < 40) return 'High'
  if (score < 70) return 'Medium'
  return 'Low'
}

const BAND_STYLE = {
  Low: 'bg-emerald-100 text-emerald-800',
  Medium: 'bg-orange-100 text-orange-800',
  High: 'bg-rose-100 text-rose-800',
  Unknown: 'bg-sand-100 text-navy-800',
}

export default function RiskPage() {
  const { token, user } = useAuth()
  const studentId = user?.studentId
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
    api
      .twin(token, studentId)
      .then((value) => {
        if (!cancelled) setTwin(value)
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
  }, [token, studentId])

  const factors = useMemo(() => {
    const profile = twin?.profile as
      | {
          payload?: { observed_topic_performance?: Record<string, { meanScore?: number; nAttempts?: number }> }
          observed_topic_performance?: Record<string, { meanScore?: number; nAttempts?: number }>
        }
      | null
      | undefined
    const observed = profile?.payload?.observed_topic_performance || profile?.observed_topic_performance || {}
    return curriculumData.subjects.map((subject) => {
      const scores = subject.topics
        .map((topic) => asPercent(observed[topic.topicId]?.meanScore))
        .filter((n): n is number => n != null)
      const score = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null
      return { subjectId: subject.subjectId, name: subject.subjectName, score, level: band(score), topics: scores.length }
    })
  }, [twin])

  const ranked = factors.filter((factor) => factor.score != null)
  const weakest = [...ranked].sort((a, b) => (a.score ?? 100) - (b.score ?? 100))[0]
  const overall = ranked.length
    ? band(Math.round(ranked.reduce((sum, factor) => sum + (factor.score ?? 0), 0) / ranked.length))
    : 'Unknown'

  if (!studentId) {
    return <EmptyState title="Student account required" detail="Academic risk uses your recorded practice." />
  }

  return (
    <div>
      <PageHeader
        title="Academic Risk Analysis"
        subtitle="Practice-based indicator. A subject is high when its recorded average is under 40%, medium under 70%, otherwise low. No score means unknown, not low risk."
      />
      {loading ? <LoadingState label="Loading risk…" /> : null}
      {error ? <ErrorState message={error} /> : null}
      {!loading && !error && ranked.length === 0 ? (
        <EmptyState title="No risk score yet" detail="Submit a practice quiz. Risk is calculated from those scores." />
      ) : null}
      {!loading && !error && ranked.length > 0 ? (
        <div className="space-y-4">
          <section className="rounded-3xl border border-orange-200 bg-orange-50 p-5">
            <p className="text-xs font-semibold tracking-[0.14em] text-orange-700">PRACTICE-BASED INDICATOR</p>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-2xl font-bold text-orange-800">{overall} Academic Risk</h2>
              <div className="flex gap-2 text-xs">
                {(['Low', 'Medium', 'High'] as const).map((level) => (
                  <span
                    key={level}
                    className={`rounded-full px-3 py-1 ${overall === level ? BAND_STYLE[level] : 'bg-white text-navy-800/50'}`}
                  >
                    {level}
                  </span>
                ))}
              </div>
            </div>
            <p className="mt-2 text-sm text-orange-800">
              {weakest
                ? `Focus on ${weakest.name} to improve. This uses recorded practice averages, not an official prediction.`
                : 'Complete more practice to see a focus subject.'}
            </p>
          </section>
          <div className="grid gap-4 lg:grid-cols-2">
            <section className="card space-y-3">
              <h2 className="font-bold text-navy-950">Risk Factors</h2>
              {factors.map((factor) => (
                <div key={factor.subjectId} className="rounded-2xl bg-[#f6f7fb] p-3">
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <p className="font-medium">{factor.name} practice</p>
                    <span className={`rounded-full px-2 py-0.5 text-xs ${BAND_STYLE[factor.level]}`}>{factor.level}</span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white">
                    <div
                      className={`h-full ${factor.level === 'High' ? 'bg-rose-500' : factor.level === 'Medium' ? 'bg-orange-500' : 'bg-emerald-500'}`}
                      style={{ width: `${factor.score ?? 0}%` }}
                    />
                  </div>
                  <p className="mt-1 text-right text-xs text-navy-800/60">{factor.score == null ? 'No attempts' : `${factor.score}%`}</p>
                </div>
              ))}
            </section>
            <section className="card space-y-3">
              <h2 className="font-bold text-navy-950">Recommended Actions</h2>
              {ranked.slice(0, 4).map((factor) => (
                <div key={factor.subjectId} className="rounded-2xl bg-[#f6f7fb] p-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium">Practice {factor.name}</p>
                    <span className={`rounded-full px-2 py-0.5 text-xs ${BAND_STYLE[factor.level]}`}>{factor.level}</span>
                  </div>
                  <p className="mt-1 text-navy-800/70">Recorded average {factor.score}% across {factor.topics} topics with scores.</p>
                  <Link to={`/subjects/${factor.subjectId}`} className="mt-2 inline-block text-xs font-semibold text-[#4c3ad6]">
                    Open subject
                  </Link>
                </div>
              ))}
              <Link to="/quiz" className="btn-primary">
                Start practice
              </Link>
            </section>
          </div>
        </div>
      ) : null}
    </div>
  )
}
