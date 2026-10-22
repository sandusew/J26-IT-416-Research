import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Users } from 'lucide-react'
import { useAuth } from '../auth/AuthContext'
import { api, CURRICULUM } from '../api/endpoints'
import { errorMessage } from '../api/client'
import { PageHeader, SuccessBanner, ErrorState, LoadingState, EmptyState } from '../components/ui'
import curriculum from '../data/curriculum.en.json'
import { subjectLabel } from '../lib/format'

type CurriculumFile = {
  subjects: Array<{
    subjectId: string
    subjectName: string
    topics: Array<{ topicId: string; topicTitle: string }>
  }>
}

type GroupRow = {
  groupId: string
  name: string
  subjectId: string
  topicId?: string
  maxMembers?: number
  myRole?: string
  requireApproval?: boolean
}

type JoinRow = { requestId: string; studentId: string; status: string }

const data = curriculum as CurriculumFile

export default function PeersPage() {
  const { token } = useAuth()
  const [name, setName] = useState('')
  const [subjectId, setSubjectId] = useState(data.subjects[0]?.subjectId || '')
  const [topicId, setTopicId] = useState('')
  const [maxMembers, setMaxMembers] = useState(8)
  const [requireApproval, setRequireApproval] = useState(true)
  const [joinId, setJoinId] = useState('')
  const [pending, setPending] = useState<Record<string, JoinRow[]>>({})
  const [approving, setApproving] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [joining, setJoining] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [groups, setGroups] = useState<GroupRow[]>([])
  const [loading, setLoading] = useState(true)

  const topics = data.subjects.find((s) => s.subjectId === subjectId)?.topics || []

  const load = useCallback(() => {
    if (!token) return
    let cancelled = false
    setLoading(true)
    api
      .peerGroupsMine(token)
      .then(async (r) => {
        if (cancelled) return
        const rows = r.groups || []
        setGroups(rows)
        const owned = rows.filter((g) => g.myRole === 'owner')
        const entries = await Promise.all(
          owned.map(async (g) => {
            try {
              const pendingRes = await api.peerJoinRequests(token, g.groupId)
              return [g.groupId, pendingRes.joinRequests || []] as const
            } catch {
              return [g.groupId, []] as const
            }
          }),
        )
        if (!cancelled) setPending(Object.fromEntries(entries))
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

  useEffect(() => {
    const cleanup = load()
    return () => cleanup?.()
  }, [load])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!token || submitting) return
    setSubmitting(true)
    setError(null)
    setSuccess(null)
    try {
      const body: {
        name: string
        subjectId: string
        topicId?: string
        maxMembers?: number
        requireApproval?: boolean
      } = { name: name.trim(), subjectId, maxMembers, requireApproval }
      if (topicId) body.topicId = topicId
      const res = (await api.peerGroupsCreate(token, body)) as { group?: { groupId?: string } }
      setSuccess(`Group created. Id: ${res.group?.groupId || 'saved'}`)
      setName('')
      load()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  async function onApprove(groupId: string, requestId: string) {
    if (!token || approving) return
    setApproving(requestId)
    setError(null)
    setSuccess(null)
    try {
      await api.peerApproveJoin(token, groupId, requestId)
      setSuccess('Join request approved.')
      load()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setApproving(null)
    }
  }

  async function onJoin(e: FormEvent) {
    e.preventDefault()
    if (!token || !joinId.trim() || joining) return
    setJoining(true)
    setError(null)
    setSuccess(null)
    try {
      await api.peerJoinRequest(token, joinId.trim())
      setSuccess('Join request sent or membership recorded.')
      setJoinId('')
      load()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setJoining(false)
    }
  }

  return (
    <div>
      <PageHeader title="Peer groups" subtitle={`Study groups for curriculum ${CURRICULUM}.`} />
      {error ? <ErrorState message={error} /> : null}
      {success ? <SuccessBanner message={success} /> : null}

      <section className="card mb-4">
        <h2 className="font-display text-lg text-navy-950">Your groups</h2>
        {loading ? <LoadingState label="Loading groups…" /> : null}
        {!loading && groups.length === 0 ? (
          <EmptyState title="No groups yet" detail="Create one or join with a group id." />
        ) : null}
        {!loading && groups.length > 0 ? (
          <ul className="mt-3 divide-y divide-navy-800/10 text-sm">
            {groups.map((g) => (
              <li key={g.groupId} className="py-3">
                <p className="font-medium text-navy-950">{g.name}</p>
                <p className="text-navy-800/70">
                  {subjectLabel(g.subjectId)} · {g.myRole || 'member'} · up to {g.maxMembers ?? '—'} members
                </p>
                <p className="text-xs text-navy-800/55">Group id: {g.groupId}</p>
                {g.requireApproval ? (
                  <p className="text-xs text-navy-800/55">New members need approval.</p>
                ) : null}
                {(pending[g.groupId] || []).length > 0 ? (
                  <ul className="mt-2 space-y-2">
                    {(pending[g.groupId] || []).map((req) => (
                      <li key={req.requestId} className="flex flex-wrap items-center gap-2 text-xs">
                        <span>Request from {req.studentId}</span>
                        <button
                          type="button"
                          className="btn-secondary"
                          disabled={approving === req.requestId}
                          onClick={() => onApprove(g.groupId, req.requestId)}
                        >
                          {approving === req.requestId ? 'Approving…' : 'Approve'}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <form onSubmit={onJoin} className="card mb-4 max-w-lg space-y-3">
        <h2 className="font-display text-lg text-navy-950">
          <Users className="mr-1 inline h-4 w-4" aria-hidden />
          Join with group id
        </h2>
        <label className="label" htmlFor="pg-join">
          Group id
        </label>
        <input
          id="pg-join"
          className="input"
          value={joinId}
          onChange={(e) => setJoinId(e.target.value)}
          required
        />
        <button type="submit" className="btn-secondary" disabled={joining}>
          {joining ? 'Joining…' : 'Request to join'}
        </button>
      </form>

      <form onSubmit={onSubmit} className="card max-w-lg space-y-4">
        <h2 className="font-display text-lg text-navy-950">Create a group</h2>
        <div>
          <label className="label" htmlFor="pg-name">
            Group name
          </label>
          <input id="pg-name" className="input" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div>
          <label className="label" htmlFor="pg-subject">
            Subject
          </label>
          <select
            id="pg-subject"
            className="input"
            value={subjectId}
            onChange={(e) => {
              setSubjectId(e.target.value)
              setTopicId('')
            }}
          >
            {data.subjects.map((s) => (
              <option key={s.subjectId} value={s.subjectId}>
                {s.subjectName}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="pg-topic">
            Topic (optional)
          </label>
          <select id="pg-topic" className="input" value={topicId} onChange={(e) => setTopicId(e.target.value)}>
            <option value="">Any topic in subject</option>
            {topics.map((t) => (
              <option key={t.topicId} value={t.topicId}>
                {t.topicTitle}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="pg-max">
            Max members
          </label>
          <input
            id="pg-max"
            type="number"
            min={2}
            max={30}
            className="input"
            value={maxMembers}
            onChange={(e) => setMaxMembers(Number(e.target.value))}
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-navy-800" htmlFor="pg-approve">
          <input
            id="pg-approve"
            type="checkbox"
            checked={requireApproval}
            onChange={(e) => setRequireApproval(e.target.checked)}
          />
          Require owner approval before someone joins
        </label>
        <button type="submit" className="btn-primary" disabled={submitting}>
          {submitting ? 'Creating…' : 'Create group'}
        </button>
      </form>
    </div>
  )
}


