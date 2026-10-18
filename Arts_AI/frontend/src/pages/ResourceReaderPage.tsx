import { useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ExternalLink } from 'lucide-react'
import { useAuth } from '../auth/AuthContext'
import { api } from '../api/endpoints'
import { errorMessage } from '../api/client'
import type { CanonicalResource } from '../api/types'
import { PageHeader, LoadingState, EmptyState, ErrorState, Badge } from '../components/ui'
import { contentOriginBadge, reviewBadge, isHttpUrl, subjectLabel } from '../lib/format'

export default function ResourceReaderPage() {
  const { resourceId: paramId } = useParams()
  const [searchParams] = useSearchParams()
  const queryId = searchParams.get('id') || searchParams.get('resourceId')
  const resourceId = paramId || queryId || ''

  const { token } = useAuth()
  const [resource, setResource] = useState<CanonicalResource | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!token || !resourceId) {
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    api
      .resources(token, { contentPolicy: 'published_practice' })
      .then((res) => {
        if (cancelled) return
        const match = (res.resources || []).find((r) => r.resourceId === resourceId)
        setResource(match || null)
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
  }, [token, resourceId])

  const origin = useMemo(() => contentOriginBadge(resource?.contentOrigin), [resource])
  const review = useMemo(
    () => reviewBadge(resource?.humanReviewStatus || resource?.reviewStatus),
    [resource],
  )

  if (!resourceId) {
    return <EmptyState title="No resource selected" detail="Open a resource from a subject page." />
  }

  return (
    <div>
      {loading ? <LoadingState label="Loading resource…" /> : null}
      {error ? <ErrorState message={error} /> : null}
      {!loading && !error && !resource ? (
        <EmptyState title="Resource not found" detail={`No published resource with id ${resourceId}.`} />
      ) : null}
      {resource ? (
        <>
          <PageHeader
            title={resource.title || resource.resourceId}
            subtitle={`${subjectLabel(resource.subjectId)} · v${resource.version}`}
            actions={
              resource.subjectId ? (
                <Link to={`/subjects/${resource.subjectId}`} className="btn-secondary text-sm">
                  Subject
                </Link>
              ) : null
            }
          />
          <div className="mb-4 flex flex-wrap gap-2">
            <Badge className={origin.className}>{origin.label}</Badge>
            <Badge className={review.className}>{review.label}</Badge>
            {resource.resourceType ? <Badge className="bg-sand-100 text-navy-800">{resource.resourceType}</Badge> : null}
          </div>
          {isHttpUrl(resource.sourceDocumentIdOrUrl) ? (
            <p className="mb-4">
              <a
                href={resource.sourceDocumentIdOrUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sm text-teal-700 hover:underline"
              >
                Source document
                <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              </a>
            </p>
          ) : null}
          <article className="card prose prose-sm max-w-none whitespace-pre-wrap text-navy-900">
            {resource.bodyText || (
              <p className="text-navy-800/60">This resource has no body text in the catalogue.</p>
            )}
          </article>
        </>
      ) : null}
    </div>
  )
}
