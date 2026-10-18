import { describe, expect, it } from 'vitest'
import { contentOriginBadge, isHttpUrl, reviewBadge, subjectLabel } from './format'

describe('format helpers', () => {
  it('labels known subjects', () => {
    expect(subjectLabel('sub_history')).toBe('History')
    expect(subjectLabel('sub_economics')).toBe('Economics')
  })

  it('marks AI practice distinctly from teacher review', () => {
    expect(contentOriginBadge('ai_authored_source_grounded').label).toMatch(/AI-authored/i)
    expect(reviewBadge('unreviewed').label).toMatch(/Not teacher-reviewed/i)
    expect(reviewBadge('teacher_approved').label).toMatch(/Teacher-reviewed/i)
  })

  it('validates http(s) URLs only', () => {
    expect(isHttpUrl('https://example.com/x')).toBe(true)
    expect(isHttpUrl('javascript:alert(1)')).toBe(false)
    expect(isHttpUrl(null)).toBe(false)
  })
})
