import { useEffect, useState, type FormEvent } from 'react'
import { useAuth } from '../auth/AuthContext'
import { api } from '../api/endpoints'
import { errorMessage } from '../api/client'
import type { CanonicalResource } from '../api/types'
import {
  PageHeader,
  LoadingState,
  EmptyState,
  ErrorState,
  SuccessBanner,
  Badge,
} from '../components/ui'
import { contentOriginBadge, reviewBadge, subjectLabel } from '../lib/format'

type QuestionRow = Record<string, unknown> & {
  questionId?: string
  version?: string
  prompt?: string
  subjectId?: string
  topicId?: string
  reviewStatus?: string
  humanReviewStatus?: string
  contentOrigin?: string
  learnerAvailability?: string
}

export default function CataloguePage() {
  const { token, hasRole } = useAuth()
  const [questions, setQuestions] = useState<QuestionRow[]>([])
  const [resources, setResources] = useState<CanonicalResource[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [reviewQid, setReviewQid] = useState<string | null>(null)
  const [decision, setDecision] = useState('approved_for_learner')
  const [evidence, setEvidence] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!token) return
    let cancelled = false
    setLoading(true)
    Promise.all([
      api.questions(token, { includeKeys: false }),
      api.resources(token, {}),
    ])
      .then(([q, r]) => {
        if (!cancelled) {
          setQuestions((q.questions || []) as QuestionRow[])
          setResources(r.resources || [])
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
  }, [token])

  async function submitReview(e: FormEvent) {
    e.preventDefault()
    if (!token || !reviewQid) return
    const row = questions.find((q) => q.questionId === reviewQid)
    if (!row?.questionId || !row.version) return
    if (decision === 'approved_for_learner' && !evidence.trim()) {
      setError('Review evidence is required to approve for learners.')
      return
    }
    setSubmitting(true)
    setError(null)
    setSuccess(null)
    try {
      await api.reviewQuestion(token, row.questionId, String(row.version), {
        decision,
        reviewEvidence: evidence.trim() || undefined,
      })
      setSuccess('Review recorded on this exact content version.')
      const q = await api.questions(token, { includeKeys: false })
      setQuestions((q.questions || []) as QuestionRow[])
      setReviewQid(null)
      setEvidence('')
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  if (!hasRole('teacher', 'admin')) {
    return <EmptyState title="Teachers only" detail="Catalogue review is for teacher and admin roles." />
  }

  return (
    <div>
      <PageHeader
        title="Catalogue"
        subtitle="Teacher approval is distinct from publish-practice: approving requires evidence and sets teacher-reviewed status; publish-practice only makes AI practice visible without forging approval."
      />
      <div className="card mb-4 border-amber-200 bg-amber-50 text-sm text-amber-950">
        <strong>Publish-practice</strong> (server-side) exposes AI-authored practice to learners without claiming
        teacher review. <strong>POST …/review</strong> with <code>approved_for_learner</code> records human approval
        and requires <code>reviewEvidence</code> — this UI uses that review endpoint only.
      </div>
      {loading ? <LoadingState label="Loading catalogue…" /> : null}
      {error ? <ErrorState message={error} /> : null}
      {success ? <SuccessBanner message={success} /> : null}

      {!loading ? (
        <>
          <section className="card mb-6">
            <h2 className="font-display text-lg text-navy-950">Questions ({questions.length})</h2>
            {questions.length === 0 ? (
              <EmptyState title="No questions" />
            ) : (
              <ul className="mt-3 max-h-96 divide-y divide-navy-800/10 overflow-y-auto">
                {questions.slice(0, 80).map((q) => {
                  const origin = contentOriginBadge(q.contentOrigin as string | undefined)
                  const review = reviewBadge(
                    (q.humanReviewStatus as string) || (q.reviewStatus as string),
                  )
                  return (
                    <li key={`${q.questionId}-${q.version}`} className="py-3 text-sm">
                      <button
                        type="button"
                        className="text-left font-medium text-teal-800 hover:underline"
                        onClick={() => setReviewQid(q.questionId as string)}
                      >
                        {String(q.prompt || q.questionId).slice(0, 120)}
                        {(q.prompt as string)?.length > 120 ? '…' : ''}
                      </button>
                      <p className="text-xs text-navy-800/55">
                        {q.questionId} v{q.version}
                        {q.subjectId ? ` · ${subjectLabel(String(q.subjectId))}` : ''}
                      </p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        <Badge className={origin.className}>{origin.label}</Badge>
                        <Badge className={review.className}>{review.label}</Badge>
                        {q.learnerAvailability ? (
                          <Badge className="bg-sand-100 text-navy-700">{String(q.learnerAvailability)}</Badge>
                        ) : null}
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>

          {reviewQid ? (
            <form onSubmit={submitReview} className="card mb-6 max-w-lg space-y-3">
              <h3 className="font-medium text-navy-950">Review question {reviewQid}</h3>
              <div>
                <label className="label" htmlFor="cat-decision">
                  Decision
                </label>
                <select
                  id="cat-decision"
                  className="input"
                  value={decision}
                  onChange={(e) => setDecision(e.target.value)}
                >
                  <option value="approved_for_learner">approved_for_learner</option>
                  <option value="rejected">rejected</option>
                  <option value="pending_review">pending_review</option>
                  <option value="retired">retired</option>
                </select>
              </div>
              <div>
                <label className="label" htmlFor="cat-evidence">
                  Review evidence {decision === 'approved_for_learner' ? '(required to approve)' : ''}
                </label>
                <textarea
                  id="cat-evidence"
                  className="input min-h-[80px]"
                  value={evidence}
                  onChange={(e) => setEvidence(e.target.value)}
                  placeholder="Cite syllabus alignment, source check, or classroom trial…"
                />
              </div>
              <div className="flex gap-2">
                <button type="submit" className="btn-primary" disabled={submitting}>
                  {submitting ? 'Saving…' : 'Submit review'}
                </button>
                <button type="button" className="btn-secondary" onClick={() => setReviewQid(null)}>
                  Cancel
                </button>
              </div>
            </form>
          ) : null}

          <section className="card">
            <h2 className="font-display text-lg text-navy-950">Resources ({resources.length})</h2>
            {resources.length === 0 ? (
              <EmptyState title="No resources" />
            ) : (
              <ul className="mt-3 divide-y divide-navy-800/10">
                {resources.slice(0, 40).map((r) => {
                  const origin = contentOriginBadge(r.contentOrigin)
                  const review = reviewBadge(r.humanReviewStatus || r.reviewStatus)
                  return (
                    <li key={`${r.resourceId}-${r.version}`} className="py-2 text-sm">
                      <p className="font-medium">{r.title || r.resourceId}</p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        <Badge className={origin.className}>{origin.label}</Badge>
                        <Badge className={review.className}>{review.label}</Badge>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        </>
      ) : null}
    </div>
  )
}
