const COLOMBO = 'Asia/Colombo'

export function formatColombo(iso: string | Date | undefined | null): string {
  if (!iso) return '—'
  const d = typeof iso === 'string' ? new Date(iso) : iso
  if (Number.isNaN(d.getTime())) return '—'
  return new Intl.DateTimeFormat('en-LK', {
    timeZone: COLOMBO,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(d)
}

export function subjectLabel(subjectId: string): string {
  const map: Record<string, string> = {
    sub_history: 'History',
    sub_geography: 'Geography',
    sub_political: 'Political Science',
    sub_economics: 'Economics',
    sub_sinhala_lit: 'Sinhala Literature',
  }
  return map[subjectId] || subjectId
}

export function contentOriginBadge(origin?: string | null): { label: string; className: string } {
  if (origin === 'ai_authored_source_grounded') {
    return {
      label: 'AI-authored practice',
      className: 'bg-amber-100 text-amber-900',
    }
  }
  if (origin === 'authentic' || origin === 'teacher_authored') {
    return { label: 'Authentic / reviewed path', className: 'bg-teal-50 text-teal-800' }
  }
  return { label: origin || 'Unknown origin', className: 'bg-sand-100 text-navy-800' }
}

export function reviewBadge(status?: string | null): { label: string; className: string } {
  if (status === 'teacher_approved' || status === 'approved_for_learner') {
    return { label: 'Teacher-reviewed', className: 'bg-teal-100 text-teal-900' }
  }
  return { label: 'Not teacher-reviewed', className: 'bg-sand-100 text-navy-700' }
}

export function isHttpUrl(s?: string | null): boolean {
  if (!s) return false
  try {
    const u = new URL(s)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}
