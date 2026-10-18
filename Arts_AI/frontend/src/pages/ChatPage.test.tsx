import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import ChatPage from './ChatPage'

const chatAsk = vi.fn()

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({
    token: 'token',
    user: { studentId: 'demo_s0001', role: 'student', username: 'demo_stu' },
    loading: false,
    logout: vi.fn(),
    hasRole: (role: string) => role === 'student',
  }),
}))

vi.mock('../api/endpoints', () => ({
  api: {
    chatAsk: (...args: unknown[]) => chatAsk(...args),
  },
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('ChatPage failure and retry', () => {
  beforeEach(() => {
    chatAsk.mockReset()
  })

  it('does not keep a failed turn and does not duplicate a successful retry', async () => {
    const user = userEvent.setup()
    chatAsk.mockRejectedValueOnce(new Error('timeout'))
    chatAsk.mockResolvedValueOnce({
      answer: 'Anuradhapura was an early capital.',
      answer_type: 'extractive_template',
      corpus_mode: 'domain',
      citations: [{ title: 'History notes', url: 'https://example.edu/history' }],
    })
    render(
      <MemoryRouter>
        <ChatPage />
      </MemoryRouter>,
    )
    const box = screen.getByLabelText(/Your question/i)
    await user.type(box, 'Where was the early capital?')
    await user.click(screen.getByRole('button', { name: 'Ask' }))
    expect(await screen.findByText(/timeout/i)).toBeInTheDocument()
    expect(screen.queryByText('assistant')).not.toBeInTheDocument()
    expect(screen.queryByText('user')).not.toBeInTheDocument()
    expect(box).toHaveValue('Where was the early capital?')
    await user.click(screen.getByRole('button', { name: 'Ask' }))
    expect(await screen.findByText('Anuradhapura was an early capital.')).toBeInTheDocument()
    expect(screen.getAllByText('Where was the early capital?')).toHaveLength(1)
    expect(screen.getAllByText('assistant')).toHaveLength(1)
    expect(chatAsk).toHaveBeenCalledTimes(2)
  })

  it('ignores a response that arrives after leaving the page', async () => {
    const user = userEvent.setup()
    const pending = deferred<{ answer: string; corpus_mode: string }>()
    chatAsk.mockReturnValueOnce(pending.promise)
    const view = render(
      <MemoryRouter>
        <ChatPage />
      </MemoryRouter>,
    )
    await user.type(screen.getByLabelText(/Your question/i), 'Pending question')
    await user.click(screen.getByRole('button', { name: 'Ask' }))
    view.unmount()
    pending.resolve({ answer: 'Late answer', corpus_mode: 'domain' })
    await pending.promise
    expect(screen.queryByText('Late answer')).not.toBeInTheDocument()
  })
})
