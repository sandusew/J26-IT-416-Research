import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { api } from '../api/endpoints'
import { errorMessage } from '../api/client'
import type { CanonicalResource } from '../api/types'
import { PageHeader, LoadingState, EmptyState, ErrorState, Badge } from '../components/ui'
import { contentOriginBadge, reviewBadge, subjectLabel } from '../lib/format'
import curriculum from '../data/curriculum.en.json'

type CurriculumFile = {
  subjects: Array<{
    subjectId: string
    subjectName: string
    topics: Array<{ topicId: string; topicTitle: string }>
  }>
}

const data = curriculum as CurriculumFile

export default function SubjectDetailPage() {
  const { subjectId = '' } = useParams()
  const { token } = useAuth()
  const subject = data.subjects.find((s) => s.subjectId === subjectId)

  const [resources, setResources] = useState<CanonicalResource[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!token || !subjectId) return
    let cancelled = false
    setLoading(true)
    setError(null)
    api
      .resources(token, { subjectId, contentPolicy: 'published_practice' })
      .then((res) => {
        if (!cancelled) setResources(res.resources || [])
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
  }, [token, subjectId])

  if (!subject) {
    return (
      <EmptyState
        title="Subject not found"
        detail="Choose a subject from the catalogue list."
      />
    )
  }

  const resourcesByTopic = new Map<string, CanonicalResource[]>()
  for (const r of resources) {
    const tids = r.topicIds?.length ? r.topicIds : ['_general']
    for (const tid of tids) {
      if (!resourcesByTopic.has(tid)) resourcesByTopic.set(tid, [])
      resourcesByTopic.get(tid)!.push(r)
    }
  }

  return (
    <div>
      <PageHeader
        title={subject.subjectName}
        subtitle={subjectLabel(subjectId)}
        actions={
          <Link to="/subjects" className="btn-secondary text-sm">
            All subjects
          </Link>
        }
      />
      {loading ? <LoadingState label="Loading resources…" /> : null}
      {error ? <ErrorState message={error} onRetry={() => setError(null)} /> : null}
      {!loading && !error ? (
        <div className="space-y-6">
          {subject.topics.map((t) => {
            const topicResources = resourcesByTopic.get(t.topicId) || []
            return (
              <section key={t.topicId} className="card">
                <h2 className="font-display text-lg text-navy-950">{t.topicTitle}</h2>
                <p className="text-xs text-navy-800/55">{t.topicId}</p>
                {topicResources.length === 0 ? (
                  <p className="mt-3 text-sm text-navy-800/60">No published resources for this topic yet.</p>
                ) : (
                  <ul className="mt-3 divide-y divide-navy-800/10">
                    {topicResources.map((r) => {
                      const origin = contentOriginBadge(r.contentOrigin)
                      const review = reviewBadge(r.humanReviewStatus || r.reviewStatus)
                      return (
                        <li key={`${r.resourceId}-${r.version}`} className="flex flex-wrap items-center justify-between gap-2 py-3">
                          <div>
                            <Link
                              to={`/resources/${encodeURIComponent(r.resourceId)}`}
                              className="font-medium text-teal-800 hover:underline"
                            >
                              {r.title || r.resourceId}
                            </Link>
                            <div className="mt-1 flex flex-wrap gap-1">
                              <Badge className={origin.className}>{origin.label}</Badge>
                              <Badge className={review.className}>{review.label}</Badge>
                            </div>
                          </div>
                          <Link
                            to={`/resources/${encodeURIComponent(r.resourceId)}`}
                            className="btn-secondary text-xs"
                          >
                            Read
                          </Link>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </section>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
