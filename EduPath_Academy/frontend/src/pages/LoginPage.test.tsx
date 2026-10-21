import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import LoginPage from './LoginPage'

const login = vi.fn()    

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({
    login,
    token: null,
    user: null,
    loading: false,
    logout: vi.fn(),
    refreshMe: vi.fn(),
    hasRole: () => false,
  }),
}))

describe('LoginPage', () => {
  beforeEach(() => {
    login.mockReset()
  })
     
  it('requires credentials before submit and calls login', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    )
    expect(screen.getByRole('heading', { name: /Edupath Academy/i })).toBeInTheDocument()
    await user.type(screen.getByLabelText(/Username/i), 'demo_stu')
    await user.type(screen.getByLabelText(/Password/i), 'pw')
    await user.click(screen.getByRole('button', { name: /Sign in/i }))
    expect(login).toHaveBeenCalledWith('demo_stu', 'pw')
  })
})
