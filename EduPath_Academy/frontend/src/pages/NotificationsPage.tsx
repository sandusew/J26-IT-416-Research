import { useCallback, useEffect, useState } from 'react'
import { Bell } from 'lucide-react'
import { useAuth } from '../auth/AuthContext'
import { api } from '../api/endpoints'
import { errorMessage } from '../api/client'
import type { NotificationItem } from '../api/types'
import { PageHeader, LoadingState, EmptyState, ErrorState, Badge } from '../components/ui'
import { formatColombo } from '../lib/format'

export default function NotificationsPage() {
  const { token } = useAuth()
  const [items, setItems] = useState<NotificationItem[]>([])
  const [acting, setActing] = useState<string | null>(null)

  function labelFor(type?: string): string {
    const map: Record<string, string> = {
      canonical_quiz_submitted: 'Practice quiz submitted',
      canonical_quiz_assigned: 'Practice quiz assigned',
      consultation_approved: 'Consultation approved',
      consultation_cancelled: 'Consultation cancelled',
      consultation_declined: 'Consultation declined',
      consultation_requested: 'Consultation requested',
      peer_group_created: 'Peer group created',
      peer_group_joined: 'Joined a peer group',
      peer_join_requested: 'Peer group join request',
      peer_join_approved: 'Peer group request approved',
      peer_group_member_joined: 'Someone joined your peer group',
      digital_twin_updated: 'Practice summary updated',
    }
    return map[type || ''] || 'Account update'
  }
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    if (!token) return
    let cancelled = false
    setLoading(true)
    setError(null)
    api
      .notifications(token)
      .then((res) => {
        if (!cancelled) setItems(res.notifications || [])
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

  async function markRead(id?: string) {
    if (!token || !id || acting) return
    setActing(id)
    try {
      await api.markNotificationRead(token, id)
      setItems((list) => list.map((n) => (n.notificationId === id ? { ...n, read: true } : n)))
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setActing(null)
    }
  }

  return (
    <div>
      <PageHeader title="Notifications" subtitle="Updates from quizzes, twin, consultations, and catalogue." />
      {loading ? <LoadingState label="Loading notifications…" /> : null}
      {error ? <ErrorState message={error} onRetry={load} /> : null}
      {!loading && !error && items.length === 0 ? (
        <EmptyState title="No notifications yet" detail="Activity on your account will appear here." />
      ) : null}
      {!loading && !error && items.length > 0 ? (
        <ul className="space-y-3">
          {items.map((n, i) => (
            <li key={n.notificationId || `n-${i}`} className="card">
              <div className="flex items-start gap-3">
                <Bell className="mt-0.5 h-5 w-5 shrink-0 text-teal-700" aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-navy-950">{labelFor(n.type)}</p>
                    {n.read === false ? (
                      <Badge className="bg-teal-100 text-teal-900">Unread</Badge>
                    ) : null}
                    <span className="text-xs text-navy-800/55">{formatColombo(n.createdAt)}</span>
                  </div>
                  {n.read === false && n.notificationId ? (
                    <button
                      type="button"
                      className="btn-secondary mt-2 text-xs"
                      disabled={acting === n.notificationId}
                      onClick={() => markRead(n.notificationId)}
                    >
                      Mark read
                    </button>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
