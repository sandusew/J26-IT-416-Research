import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { ChevronLeft, ChevronRight, Send } from 'lucide-react'
import { useAuth } from '../auth/AuthContext'
import { api } from '../api/endpoints'
import { errorMessage } from '../api/client'
import { ApiError } from '../api/types'
import type { AssignmentView, QuizQuestion } from '../api/types'
import {
  PageHeader,
  LoadingState,
  EmptyState,
  ErrorState,
  SuccessBanner,
  Badge,
} from '../components/ui'
import curriculum from '../data/curriculum.en.json'

type CurriculumFile = {
  subjects: Array<{
    subjectId: string
    subjectName: string
    topics: Array<{ topicId: string; topicTitle: string }>
  }>
}

const data = curriculum as CurriculumFile

export default function QuizPage() {
  const { token, user } = useAuth()
  const studentId = user?.studentId

  const [subjectId, setSubjectId] = useState(data.subjects[0]?.subjectId || '')
  const [topicId, setTopicId] = useState('')
  const [nQuestions, setNQuestions] = useState(5)
  const [assigning, setAssigning] = useState(false)
  const [assignment, setAssignment] = useState<AssignmentView | null>(null)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [index, setIndex] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [score, setScore] = useState<{ score?: number; maxMarks?: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [successNote, setSuccessNote] = useState<string | null>(null)

  const topics = useMemo(
    () => data.subjects.find((s) => s.subjectId === subjectId)?.topics || [],
    [subjectId],
  )

  useEffect(() => {
    if (topics.length && !topics.some((t) => t.topicId === topicId)) {
      setTopicId(topics[0]?.topicId || '')
    }
  }, [topics, topicId])

  async function assign(e: FormEvent) {
    e.preventDefault()
    if (!token || !studentId || !subjectId || !topicId) return
    setAssigning(true)
    setError(null)
    setAssignment(null)
    setAnswers({})
    setIndex(0)
    setSubmitted(false)
    setScore(null)
    setSuccessNote(null)
    try {
      const res = await api.assignQuiz(token, studentId, {
        subjectId,
        topicId,
        nQuestions: Math.min(Math.max(nQuestions, 1), 12),
      })
      setAssignment({
        assignmentId: res.assignmentId,
        status: res.status || 'assigned',
        questions: res.questions,
        nQuestions: res.nQuestions,
        subjectId: res.subjectId,
        topicId: res.topicId,
      })
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setError(
          `${errorMessage(err)}${err.body.requested != null ? ` (requested ${err.body.requested}, available ${err.body.available})` : ''}`,
        )
      } else {
        setError(errorMessage(err))
      }
    } finally {
      setAssigning(false)
    }
  }

  const questions: QuizQuestion[] = assignment?.questions || []
  const current = questions[index]

  function setAnswer(qid: string, value: string) {
    if (submitted) return
    setAnswers((prev) => ({ ...prev, [qid]: value }))
  }

  async function submitQuiz() {
    if (!token || !studentId || !assignment || submitted) return
    setSubmitting(true)
    setError(null)
    const responses = questions.map((q) => ({
      questionId: q.questionId,
      response: answers[q.questionId] ?? '',
    }))
    try {
      const body = await api.submitAssignment(token, studentId, assignment.assignmentId, responses)
      setSubmitted(true)
      if (typeof body.score === 'number') {
        setScore({ score: body.score as number, maxMarks: body.maxMarks as number | undefined })
      }
      setSuccessNote(
        'Submitted. Digital twin and progress update on the server — refresh Progress or Twin to see changes.',
      )
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        const msg = errorMessage(err)
        setError(msg)
        const body = err.body as { error?: string; score?: number }
        if (body.error === 'already_submitted' && body.score != null) {
          setSubmitted(true)
          setScore({ score: Number(body.score), maxMarks: undefined })
        }
      } else {
        setError(errorMessage(err))
      }
    } finally {
      setSubmitting(false)
    }
  }

  if (!studentId) {
    return <EmptyState title="Student account required" detail="Practice quizzes assign to your student id." />
  }

  return (
    <div>
      <PageHeader
        title="Practice quiz"
        subtitle="Canonical published-practice bank. Answer keys are never shown before submit."
      />
      <form onSubmit={assign} className="card mb-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label className="label" htmlFor="quiz-subject">
            Subject
          </label>
          <select
            id="quiz-subject"
            className="input"
            value={subjectId}
            onChange={(e) => setSubjectId(e.target.value)}
            disabled={!!assignment && !submitted}
          >
            {data.subjects.map((s) => (
              <option key={s.subjectId} value={s.subjectId}>
                {s.subjectName}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="quiz-topic">
            Topic
          </label>
          <select
            id="quiz-topic"
            className="input"
            value={topicId}
            onChange={(e) => setTopicId(e.target.value)}
            disabled={!!assignment && !submitted}
          >
            {topics.map((t) => (
              <option key={t.topicId} value={t.topicId}>
                {t.topicTitle}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="quiz-n">
            Questions (max 12)
          </label>
          <input
            id="quiz-n"
            type="number"
            min={1}
            max={12}
            className="input"
            value={nQuestions}
            onChange={(e) => setNQuestions(Number(e.target.value))}
            disabled={!!assignment && !submitted}
          />
        </div>
        <div className="flex items-end">
          <button type="submit" className="btn-primary w-full" disabled={assigning || (!!assignment && !submitted)}>
            {assigning ? 'Assigning…' : assignment && !submitted ? 'Assigned' : 'Assign quiz'}
          </button>
        </div>
      </form>

      {error ? <ErrorState message={error} /> : null}
      {successNote ? <SuccessBanner message={successNote} /> : null}
      {score?.score != null ? (
        <div className="card mb-4 border-teal-200 bg-teal-50 text-teal-950">
          Score: <strong>{score.score}</strong>
          {score.maxMarks != null ? ` / ${score.maxMarks}` : ''}
        </div>
      ) : null}

      {!assignment ? (
        <EmptyState title="No active assignment" detail="Choose a topic and assign a quiz to begin." />
      ) : (
        <div className="card">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-navy-800/70">
              Question {index + 1} of {questions.length}
            </p>
            <Badge className="bg-sand-100 text-navy-800">{assignment.assignmentId}</Badge>
          </div>
          {current ? (
            <>
              <p className="font-medium text-navy-950">{current.prompt}</p>
              {current.questionType ? (
                <p className="mt-1 text-xs uppercase text-navy-800/50">{current.questionType}</p>
              ) : null}
              <div className="mt-4 space-y-2">
                {current.options && current.options.length > 0 ? (
                  current.options.map((opt) => (
                    <label
                      key={opt}
                      className="flex cursor-pointer items-center gap-2 rounded-lg border border-navy-800/10 px-3 py-2 hover:bg-sand-50"
                    >
                      <input
                        type="radio"
                        name={current.questionId}
                        value={opt}
                        checked={answers[current.questionId] === opt}
                        onChange={() => setAnswer(current.questionId, opt)}
                        disabled={submitted}
                      />
                      <span className="text-sm">{opt}</span>
                    </label>
                  ))
                ) : (
                  <>
                    {['True', 'False'].map((opt) => (
                      <label
                        key={opt}
                        className="flex cursor-pointer items-center gap-2 rounded-lg border border-navy-800/10 px-3 py-2"
                      >
                        <input
                          type="radio"
                          name={current.questionId}
                          value={opt}
                          checked={answers[current.questionId] === opt}
                          onChange={() => setAnswer(current.questionId, opt)}
                          disabled={submitted}
                        />
                        <span className="text-sm">{opt}</span>
                      </label>
                    ))}
                    <input
                      className="input mt-2"
                      placeholder="Or type your answer"
                      value={answers[current.questionId] || ''}
                      onChange={(e) => setAnswer(current.questionId, e.target.value)}
                      disabled={submitted}
                    />
                  </>
                )}
              </div>
            </>
          ) : (
            <LoadingState label="Loading questions…" />
          )}
          <div className="mt-6 flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-secondary"
              disabled={index <= 0}
              onClick={() => setIndex((i) => Math.max(0, i - 1))}
            >
              <ChevronLeft className="h-4 w-4" aria-hidden />
              Previous
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={index >= questions.length - 1}
              onClick={() => setIndex((i) => Math.min(questions.length - 1, i + 1))}
            >
              Next
              <ChevronRight className="h-4 w-4" aria-hidden />
            </button>
            <button
              type="button"
              className="btn-primary ml-auto"
              disabled={submitted || submitting || questions.some((q) => !answers[q.questionId]?.trim())}
              onClick={() => void submitQuiz()}
            >
              <Send className="h-4 w-4" aria-hidden />
              {submitting ? 'Submitting…' : submitted ? 'Submitted' : 'Submit once'}
            </button>
          </div>
          {submitted ? (
            <p className="mt-3 text-xs text-navy-800/60">
              Submission locked. Start a new assignment to try another topic.
            </p>
          ) : null}
        </div>
      )}
    </div>
  )
}
