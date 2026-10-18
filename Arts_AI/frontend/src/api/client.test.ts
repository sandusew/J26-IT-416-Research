import { describe, expect, it } from 'vitest'
import { ApiError } from './types'
import { errorMessage } from './client'

describe('errorMessage', () => {
  it('joins error reason and note', () => {
    const err = new ApiError(409, {
      error: 'canonical_question_bank_unavailable',
      reason: 'insufficient_eligible_questions',
      note: 'No synthetic substitution',
      available: 2,
    })
    const msg = errorMessage(err)
    expect(msg).toContain('canonical_question_bank_unavailable')
    expect(msg).toContain('insufficient_eligible_questions')
    expect(msg).toContain('available=2')
  })

  it('handles unknown errors', () => {
    expect(errorMessage('boom')).toBe('boom')
  })
})
