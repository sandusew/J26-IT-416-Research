import clsx from 'clsx'
import {
  BookOpen,
  Brain,
  FlaskConical,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquare,
  Bell,
  Users,
  Calendar,
  ChartLine,
  X,
  Library,
} from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { api } from '../api/endpoints'

type NavItem = { to: string; label: string; icon: ReactNode; roles?: Array<'student' | 'teacher' | 'admin'> }

const NAV: NavItem[] = [
  { to: '/dashboard', label: 'Dashboard', icon: <LayoutDashboard className="h-4 w-4" />, roles: ['student', 'teacher', 'admin'] },
  { to: '/subjects', label: 'Subjects', icon: <BookOpen className="h-4 w-4" />, roles: ['student', 'teacher', 'admin'] },
  { to: '/quiz', label: 'Practice quiz', icon: <FlaskConical className="h-4 w-4" />, roles: ['student', 'admin'] },
  { to: '/twin', label: 'Digital Twin', icon: <Brain className="h-4 w-4" />, roles: ['student', 'admin'] },
  { to: '/progress', label: 'Progress', icon: <ChartLine className="h-4 w-4" />, roles: ['student', 'admin'] },
  { to: '/chat', label: 'Arts chat', icon: <MessageSquare className="h-4 w-4" />, roles: ['student', 'teacher', 'admin'] },
  { to: '/consultations', label: 'Consultations', icon: <Calendar className="h-4 w-4" />, roles: ['student', 'teacher', 'admin'] },
  { to: '/peers', label: 'Peer groups', icon: <Users className="h-4 w-4" />, roles: ['student', 'admin'] },
  { to: '/notifications', label: 'Notifications', icon: <Bell className="h-4 w-4" />, roles: ['student', 'teacher', 'admin'] },
  { to: '/catalogue', label: 'Catalogue', icon: <Library className="h-4 w-4" />, roles: ['teacher', 'admin'] },
  { to: '/models', label: 'Model Explorer', icon: <FlaskConical className="h-4 w-4" />, roles: ['teacher', 'admin'] },
]

export function AppShell() {
  const { token, user, logout, hasRole } = useAuth()
  const location = useLocation()
  const [open, setOpen] = useState(false)
  const [unread, setUnread] = useState(0)
  const menuRef = useRef<HTMLDivElement>(null)
  const items = NAV.filter((n) => !n.roles || n.roles.some((r) => hasRole(r)))

  useEffect(() => {
    if (!token) return
    let cancelled = false
    api
      .notifications(token)
      .then((res) => {
        if (!cancelled) setUnread((res.notifications || []).filter((n) => n.read === false).length)
      })
      .catch(() => {
        if (!cancelled) setUnread(0)
      })
    return () => {
      cancelled = true
    }
  }, [token, location.pathname])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    menuRef.current?.querySelector<HTMLElement>('a,button')?.focus()
    return () => {
      window.removeEventListener('keydown', onKey)
      previous?.focus()
    }
  }, [open])

  const nav = (
    <nav className="flex flex-col gap-1 p-3" aria-label="Main">
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          onClick={() => setOpen(false)}
          className={({ isActive }) =>
            clsx(
              'flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition',
              isActive
                ? 'bg-teal-700 text-white'
                : 'text-navy-100/90 hover:bg-navy-800 hover:text-white',
            )
          }
        >
          {item.icon}
          <span className="min-w-0 flex-1">{item.label}</span>
          {item.to === '/notifications' && unread > 0 ? (
            <span className="rounded-full bg-teal-500 px-1.5 text-[10px] font-semibold text-white">{unread}</span>
          ) : null}
        </NavLink>
      ))}
    </nav>
  )

  return (
    <div className="min-h-screen bg-sand-50 lg:grid lg:grid-cols-[16rem_1fr]">
      <aside className="hidden bg-navy-950 text-white lg:flex lg:flex-col">
        <div className="border-b border-white/10 px-4 py-5">
          <p className="font-display text-xl tracking-tight">Arts AI</p>
          <p className="mt-1 text-xs text-white/60">English A/L Arts learning</p>
        </div>
        {nav}
        <div className="mt-auto border-t border-white/10 p-4 text-xs text-white/70">
          <p className="font-medium text-white">{user?.displayName || user?.username}</p>
          <p className="capitalize">{user?.role}</p>
          <button type="button" className="btn-secondary mt-3 w-full text-navy-900" onClick={logout}>
            <LogOut className="h-4 w-4" />
            Log out
          </button>
        </div>
      </aside>

      <div className="flex min-h-screen min-w-0 flex-col">
        <header className="relative z-40 flex items-center justify-between border-b border-navy-800/10 bg-white px-4 py-3 lg:hidden">
          <button
            type="button"
            className="btn-secondary"
            aria-expanded={open}
            aria-controls="mobile-menu"
            aria-label={open ? 'Close menu' : 'Open menu'}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
          <p className="font-display text-lg text-navy-950">Arts AI</p>
          <button type="button" className="btn-secondary" onClick={logout} aria-label="Log out">
            <LogOut className="h-4 w-4" />
          </button>
        </header>
        {open ? (
          <>
            <button
              type="button"
              className="fixed inset-0 z-30 bg-navy-950/40 lg:hidden"
              aria-label="Close menu"
              onClick={() => setOpen(false)}
            />
            <div
              id="mobile-menu"
              ref={menuRef}
              role="dialog"
              aria-modal="true"
              aria-label="Main menu"
              className="relative z-40 max-h-[70vh] overflow-y-auto border-b border-navy-800/10 bg-navy-950 lg:hidden"
            >
              {nav}
            </div>
          </>
        ) : null}
        <main className="mx-auto w-full min-w-0 max-w-6xl flex-1 overflow-x-auto px-4 py-6 md:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
