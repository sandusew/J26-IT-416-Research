import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { api } from '../api/endpoints'
import { errorMessage } from '../api/client'
import type { AssignmentView, QuizQuestion } from '../api/types'
import { ErrorState, LoadingState, PageHeader } from '../components/ui'

export default function OnboardingPage() {
  const { token, user, refreshMe } = useAuth()
  const navigate = useNavigate()
  const studentId = user?.studentId
  const [assignment, setAssignment] = useState<AssignmentView | null>(null)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [doneScore, setDoneScore] = useState<string | null>(null)

  useEffect(() => {
    if (!token || !studentId) {
      setLoading(false)
      return
    }
    if (!doneScore && (user?.onboardingStatus === 'not_required' || user?.onboardingStatus === 'completed')) {
      navigate('/dashboard', { replace: true })
      return
    }
    let cancelled = false
    setLoading(true)
    api.startOnboarding(token, studentId)
      .then((res) => {
        if (cancelled) return
        if (res.status === 'completed') {
          navigate('/dashboard', { replace: true })
          return
        }
        setAssignment(res.assignment)
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
  }, [token, studentId, user?.onboardingStatus, navigate, doneScore])

  async function submit() {
    if (!token || !studentId || !assignment) return
    setSubmitting(true)
    setError(null)
    try {
      const responses = (assignment.questions || []).map((q) => ({
        questionId: q.questionId,
        response: answers[q.questionId] || '',
      }))
      const body = await api.submitAssignment(token, studentId, assignment.assignmentId, responses)
      const score = typeof body.score === 'number' ? body.score : null
      const max = typeof body.maxMarks === 'number' ? body.maxMarks : assignment.maxMarks
      setDoneScore(score == null ? 'Submitted' : `${score}${max != null ? ` / ${max}` : ''}`)
      await refreshMe()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  const questions: QuizQuestion[] = assignment?.questions || []

  return (
    <div>
      <PageHeader
        title="Initial assessment"
        subtitle="Six AI-authored practice questions. They are not official papers and do not measure syllabus mastery."
      />
      {loading ? <LoadingState label="Preparing assessment…" /> : null}
      {error ? <ErrorState message={error} /> : null}
      {doneScore ? (
        <section className="card">
          <h2 className="text-lg font-bold">Initial learning profile — limited evidence</h2>
          <p className="mt-2 text-sm">Score: {doneScore}</p>
          <p className="mt-2 text-sm text-navy-800/70">This short result is stored separately from subject mastery. Your practice over the next 21 days will add observed evidence.</p>
          <button type="button" className="btn-primary mt-4" onClick={() => navigate('/dashboard')}>Go to dashboard</button>
        </section>
      ) : null}
      {!loading && assignment && !doneScore ? (
        <form
          className="card space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          {questions.map((question, index) => (
            <fieldset key={question.questionId} className="space-y-2">
              <legend className="font-medium">{index + 1}. {question.prompt}</legend>
              {(question.options || []).map((option) => (
                <label key={option} className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name={question.questionId}
                    value={option}
                    checked={answers[question.questionId] === option}
                    onChange={() => setAnswers((current) => ({ ...current, [question.questionId]: option }))}
                    required
                  />
                  {option}
                </label>
              ))}
            </fieldset>
          ))}
          <button type="submit" className="btn-primary" disabled={submitting}>
            {submitting ? 'Submitting…' : 'Submit assessment'}
          </button>
        </form>
      ) : null}
    </div>
  )
}
