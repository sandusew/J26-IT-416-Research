import { useEffect, useRef, useState, type FormEvent } from 'react'
import { MessageSquare, Send } from 'lucide-react'
import { useAuth } from '../auth/AuthContext'
import { api } from '../api/endpoints'
import { errorMessage } from '../api/client'
import type { ChatResponse } from '../api/types'
import { PageHeader, ErrorState, EmptyState, Badge } from '../components/ui'
import curriculum from '../data/curriculum.en.json'
import { isHttpUrl, subjectLabel } from '../lib/format'

type CurriculumFile = {
  subjects: Array<{ subjectId: string; subjectName: string }>
}

const data = curriculum as CurriculumFile

type Turn = {
  role: 'user' | 'assistant'
  content: string
  meta?: ChatResponse
}

export default function ChatPage() {
  const { token, user } = useAuth()
  const studentId = user?.studentId

  const [subjectId, setSubjectId] = useState('')
  const [question, setQuestion] = useState('')
  const [history, setHistory] = useState<Turn[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const alive = useRef(true)
  const requestSeq = useRef(0)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  async function onAsk(e: FormEvent) {
    e.preventDefault()
    if (!token || !studentId || loading) return
    const q = question.trim()
    if (!q) return
    if (q.length > 2000) {
      setError('Question is too long (maximum 2000 characters).')
      return
    }
    const myRequest = ++requestSeq.current
    setQuestion('')
    setError(null)
    setLoading(true)
    const userTurn: Turn = { role: 'user', content: q }
    const prior = history
    setHistory((h) => [...h, userTurn])
    try {
      const conversation_history = prior
        .filter((t) => t.role === 'user' || t.role === 'assistant')
        .slice(-4)
        .map((t) => ({ role: t.role, content: t.content, corpus_mode: 'domain' }))
      const res = await api.chatAsk(token, studentId, {
        question: q,
        corpus_mode: 'domain',
        subject_id: subjectId || undefined,
        language: 'en',
        conversation_history,
        includeDigitalTwin: true,
        use_generation: false,
      })
      if (!alive.current || myRequest !== requestSeq.current) return
      if (res.corpus_mode && res.corpus_mode !== 'domain') {
        setError('Chat did not stay on the domain corpus.')
        setHistory(prior)
        setQuestion(q)
        return
      }
      setHistory((h) => [...h, { role: 'assistant', content: res.answer || 'No answer returned.', meta: res }])
    } catch (err) {
      if (!alive.current || myRequest !== requestSeq.current) return
      setError(errorMessage(err))
      setHistory(prior)
      setQuestion(q)
    } finally {
      if (alive.current && myRequest === requestSeq.current) setLoading(false)
    }
  }

  if (!studentId) {
    return (
      <>
        <PageHeader title="Arts chat" subtitle="Domain corpus Q&A requires a student account." />
        <EmptyState title="Student account required" detail="Chat is tied to your student id." />
      </>
    )
  }

  return (
    <div>
      <PageHeader
        title="Arts chat"
        subtitle="Default corpus: domain (English). No fixture corpus toggle for students."
      />
      <form onSubmit={onAsk} className="card mb-4 space-y-3">
        <div>
          <label className="label" htmlFor="chat-subject">
            Subject filter (optional)
          </label>
          <select
            id="chat-subject"
            className="input max-w-md"
            value={subjectId}
            onChange={(e) => setSubjectId(e.target.value)}
          >
            <option value="">All subjects</option>
            {data.subjects.map((s) => (
              <option key={s.subjectId} value={s.subjectId}>
                {s.subjectName}
              </option>
            ))}
          </select>
          {subjectId ? (
            <p className="mt-1 text-xs text-navy-800/55">{subjectLabel(subjectId)}</p>
          ) : null}
        </div>
        <div>
          <label className="label" htmlFor="chat-q">
            Your question
          </label>
          <textarea
            id="chat-q"
            className="input min-h-[88px]"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask about Sri Lankan history, geography, civics, or economics…"
            required
          />
        </div>
        {error ? <ErrorState message={error} /> : null}
        <button type="submit" className="btn-primary" disabled={loading}>
          <Send className="h-4 w-4" aria-hidden />
          {loading ? 'Asking…' : 'Ask'}
        </button>
      </form>

      <div className="space-y-4">
        {history.length === 0 ? (
          <p className="text-sm text-navy-800/60">Conversation history appears here after your first question.</p>
        ) : (
          history.map((turn, i) => (
            <div
              key={`${i}-${turn.role}`}
              className={`card ${turn.role === 'user' ? 'border-teal-200/50 bg-teal-50/40' : ''}`}
            >
              <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-navy-800/55">
                <MessageSquare className="h-3.5 w-3.5" aria-hidden />
                {turn.role}
              </div>
              <p className="whitespace-pre-wrap text-sm text-navy-900">{turn.content}</p>
              {turn.meta ? (
                <div className="mt-3 space-y-2 border-t border-navy-800/10 pt-3">
                  <div className="flex flex-wrap gap-2">
                    {turn.meta.answer_type ? (
                      <Badge className="bg-sand-100 text-navy-800">answer_type: {turn.meta.answer_type}</Badge>
                    ) : null}
                    {turn.meta.insufficient_evidence ? (
                      <Badge className="bg-amber-100 text-amber-950">insufficient_evidence</Badge>
                    ) : null}
                    {turn.meta.unsupported_language ? (
                      <Badge className="bg-amber-100 text-amber-950">unsupported_language</Badge>
                    ) : null}
                    {turn.meta.corpus_mode ? (
                      <Badge className="bg-teal-50 text-teal-900">corpus: {turn.meta.corpus_mode}</Badge>
                    ) : null}
                  </div>
                  {turn.meta.citations && turn.meta.citations.length > 0 ? (
                    <div>
                      <p className="text-xs font-medium text-navy-800">Citations</p>
                      <ul className="mt-1 space-y-2 text-xs text-navy-800/80">
                        {turn.meta.citations.map((c, j) => (
                          <li key={j} className="rounded-md bg-sand-50 p-2">
                            <p className="font-medium">{c.title || c.document_id || 'Source'}</p>
                            {c.snippet ? <p className="mt-1">{c.snippet}</p> : null}
                            {isHttpUrl(c.url) ? (
                              <a href={c.url} className="text-teal-700 hover:underline" target="_blank" rel="noreferrer">
                                Link
                              </a>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {turn.meta.note ? <p className="text-xs text-navy-800/60">{turn.meta.note}</p> : null}
                </div>
              ) : null}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
