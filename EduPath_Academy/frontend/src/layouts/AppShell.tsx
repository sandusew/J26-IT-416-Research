import clsx from 'clsx'
import {
  Bell,
  BookOpen,
  Brain,
  Calendar,
  ChartLine,
  ClipboardList,
  FlaskConical,
  Globe,
  LayoutDashboard,
  Library,
  LogOut,
  Menu,
  MessageSquare,
  Route,
  ShieldAlert,
  Sparkles,
  Users,
  X,
} from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, NavLink, Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { api } from '../api/endpoints'
import { BrandLogo } from '../components/BrandLogo'

type Role = 'student' | 'teacher' | 'admin'
type NavItem = {
  to: string
  label: string
  icon: ReactNode
  roles?: Role[]
  activeWhen?: (path: string, search: string) => boolean
}

const NAV: Array<{ label?: string; items: NavItem[] }> = [
  {
    items: [
      { to: '/dashboard', label: 'Dashboard', icon: <LayoutDashboard className="h-4 w-4" /> },
      { to: '/subjects', label: 'My Course', icon: <BookOpen className="h-4 w-4" /> },
      {
        to: '/quiz',
        label: 'Learning Path',
        icon: <Route className="h-4 w-4" />,
        roles: ['student', 'admin'],
      },
      {
        to: '/progress',
        label: 'Progress',
        icon: <ChartLine className="h-4 w-4" />,
        roles: ['student', 'admin'],
        activeWhen: () => false,
      },
    ],
  },
  {
    label: 'AI LEARNING',
    items: [
      { to: '/chat', label: 'AI Companion', icon: <MessageSquare className="h-4 w-4" /> },
      {
        to: '/dashboard#recommendations',
        label: 'Recommendation',
        icon: <ClipboardList className="h-4 w-4" />,
        roles: ['student', 'admin'],
        activeWhen: (path) => path === '/dashboard',
      },
      {
        to: '/twin?view=profile',
        label: 'Learning DNA',
        icon: <Globe className="h-4 w-4" />,
        roles: ['student', 'admin'],
        activeWhen: (path, search) => path === '/twin' && search.includes('view=profile'),
      },
    ],
  },
  {
    label: 'INSIGHTS',
    items: [
      {
        to: '/twin',
        label: 'Cognitive Twin',
        icon: <Brain className="h-4 w-4" />,
        roles: ['student', 'admin'],
        activeWhen: (path, search) => path === '/twin' && !search.includes('view=profile'),
      },
      {
        to: '/risk',
        label: 'Academic Risk',
        icon: <ShieldAlert className="h-4 w-4" />,
        roles: ['student', 'admin'],
      },
      {
        to: '/progress',
        label: 'Learning Progress',
        icon: <Sparkles className="h-4 w-4" />,
        roles: ['student', 'admin'],
      },
      { to: '/subjects', label: 'Performance', icon: <ChartLine className="h-4 w-4" />, activeWhen: () => false },
      { to: '/consultations', label: 'Consultation', icon: <Calendar className="h-4 w-4" /> },
      { to: '/peers', label: 'Peer groups', icon: <Users className="h-4 w-4" />, roles: ['student', 'admin'] },
      { to: '/notifications', label: 'Notifications', icon: <Bell className="h-4 w-4" /> },
      { to: '/catalogue', label: 'Catalogue', icon: <Library className="h-4 w-4" />, roles: ['teacher', 'admin'] },
      { to: '/models', label: 'Model Explorer', icon: <FlaskConical className="h-4 w-4" />, roles: ['teacher', 'admin'] },
    ],
  },
]

function isItemActive(item: NavItem, path: string, search: string, hash: string, navActive: boolean) {
  if (item.label === 'Recommendation') return path === '/dashboard'
  if (item.label === 'Dashboard') return false
  if (item.activeWhen) return item.activeWhen(path, search)
  if (item.to.startsWith('/dashboard')) return path === '/dashboard' && hash === '#recommendations'
  return navActive
}

function itemClass(active: boolean) {
  return clsx(
    'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition',
    active ? 'bg-[#ff7a1a] text-white shadow-sm' : 'text-white/85 hover:bg-white/10 hover:text-white',
  )
}

export function AppShell() {
  const { token, user, logout, hasRole } = useAuth()
  const location = useLocation()
  const [open, setOpen] = useState(false)
  const [unread, setUnread] = useState(0)
  const menuRef = useRef<HTMLDivElement>(null)

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

  const needsOnboarding =
    user?.role === 'student' &&
    (user.onboardingStatus === 'not_started' || user.onboardingStatus === 'in_progress') &&
    location.pathname !== '/onboarding'

  const sidebar = (
    <div className="flex h-full min-h-0 flex-col bg-gradient-to-b from-[#6d5efc] via-[#4c3ad6] to-[#24145f] text-white">
      <div className="px-4 pb-2 pt-5">
        <BrandLogo blend className="h-16" />
      </div>
      <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-4" aria-label="Main">
        {NAV.map((group) => {
          const items = group.items.filter((item) => !item.roles || item.roles.some((role) => hasRole(role)))
          if (items.length === 0) return null
          return (
            <div key={group.label || 'main'}>
              {group.label ? (
                <p className="mb-2 px-3 text-[11px] font-semibold tracking-[0.16em] text-white/55">{group.label}</p>
              ) : null}
              <div className="flex flex-col gap-1">
                {items.map((item) => (
                  <NavLink
                    key={item.label}
                    to={item.to}
                    onClick={() => setOpen(false)}
                    className={({ isActive }) =>
                      itemClass(isItemActive(item, location.pathname, location.search, location.hash, isActive))
                    }
                  >
                    {item.icon}
                    <span className="min-w-0 flex-1">{item.label}</span>
                    {item.to === '/notifications' && unread > 0 ? (
                      <span className="rounded-full bg-white px-1.5 text-[10px] font-semibold text-[#4c3ad6]">{unread}</span>
                    ) : null}
                  </NavLink>
                ))}
              </div>
            </div>
          )
        })}
      </nav>
      <div className="border-t border-white/10 p-4">
        <Link to="/profile" onClick={() => setOpen(false)} className="block">
          <p className="truncate text-sm font-medium">{user?.displayName || user?.username}</p>
          <p className="text-xs capitalize text-white/60">{user?.role}</p>
        </Link>
        <button
          type="button"
          className="mt-3 flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-[#ffb199] hover:bg-white/10"
          onClick={logout}
        >
          <LogOut className="h-4 w-4" />
          Logout
        </button>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-[#eef1f8] lg:grid lg:grid-cols-[17.5rem_1fr] lg:gap-4 lg:p-4">
      <aside className="sticky top-4 hidden h-[calc(100vh-2rem)] overflow-hidden rounded-[28px] shadow-xl lg:block">{sidebar}</aside>

      <div className="flex min-h-screen min-w-0 flex-col lg:min-h-[calc(100vh-2rem)]">
        <header className="relative z-40 flex items-center justify-between bg-[#4c3ad6] px-4 py-3 text-white lg:hidden">
          <button
            type="button"
            className="rounded-xl bg-white/15 p-2"
            aria-expanded={open}
            aria-controls="mobile-menu"
            aria-label={open ? 'Close menu' : 'Open menu'}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
          <BrandLogo blend className="h-10" />
          <button type="button" className="rounded-xl bg-white/15 p-2" onClick={logout} aria-label="Log out">
            <LogOut className="h-4 w-4" />
          </button>
        </header>
        {open ? (
          <>
            <button
              type="button"
              className="fixed inset-0 z-30 bg-[#1a1440]/50 lg:hidden"
              aria-label="Close menu"
              onClick={() => setOpen(false)}
            />
            <div
              id="mobile-menu"
              ref={menuRef}
              role="dialog"
              aria-modal="true"
              aria-label="Main menu"
              className="relative z-40 max-h-[80vh] overflow-y-auto lg:hidden"
            >
              {sidebar}
            </div>
          </>
        ) : null}
        <div className="flex items-center justify-end gap-3 px-4 pt-4 md:px-8">
          <NavLink
            to="/notifications"
            className="relative rounded-full border border-navy-800/10 bg-white p-2 text-navy-800 shadow-sm"
            aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
          >
            <Bell className="h-4 w-4" />
            {unread > 0 ? (
              <span className="absolute -right-1 -top-1 rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
                {unread}
              </span>
            ) : null}
          </NavLink>
          <Link to="/profile" className="text-right">
            <p className="text-sm font-semibold text-navy-950">{user?.displayName || user?.username}</p>
            <p className="text-xs capitalize text-navy-800/60">{user?.role}</p>
          </Link>
        </div>
        <main className="mx-auto w-full min-w-0 max-w-6xl flex-1 overflow-x-auto px-4 py-4 md:px-8">
          {needsOnboarding ? <Navigate to="/onboarding" replace /> : <Outlet />}
        </main>
      </div>
    </div>
  )
}
