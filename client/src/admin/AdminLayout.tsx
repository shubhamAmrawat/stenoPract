import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router'
import { useAuth } from '../auth/AuthContext'
import { Logo } from '../components/AppShell'
import { SignOutDialog } from '../components/SignOutDialog'
import { api } from '../lib/api'
import './admin.css'

const icon = (d: ReactNode) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {d}
  </svg>
)

const ICONS = {
  content: icon(<><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>),
  reports: icon(<><path d="M5 21V4" /><path d="M5 4h11l-2 4 2 4H5" /></>),
  resources: icon(<><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5z" /><path d="M14 3v5h5" /></>),
  access: icon(<><circle cx="9" cy="8" r="3.2" /><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" /><path d="M16 5.2a3.2 3.2 0 0 1 0 5.6M18 14.4c1.8.8 3 2.6 3 5.6" /></>),
  config: icon(<><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" /><circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="18" cy="18" r="2" /></>),
}

function pageTitle(path: string): string {
  if (path.startsWith('/admin/reports')) return 'Reports'
  if (path.startsWith('/admin/resources')) return 'Resources'
  if (path.startsWith('/admin/access')) return 'Access'
  if (path.startsWith('/admin/config')) return 'Rules and exams'
  if (path.startsWith('/admin/d/')) return 'Exercise editor'
  return 'Content'
}

/** Admin workspace: same theme, header and brand as the student app, plus a sidebar for the admin sections. */
export function AdminLayout() {
  const { user } = useAuth()
  const [confirmOut, setConfirmOut] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const firstName = user?.name?.trim().split(/\s+/)[0] || 'there'
  const { pathname } = useLocation()

  useEffect(() => {
    const close = (e: MouseEvent) => menuRef.current && !menuRef.current.contains(e.target as Node) && setMenuOpen(false)
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false)
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc) }
  }, [])

  useEffect(() => {
    const previous = document.title
    document.title = `Admin · ${pageTitle(pathname)} · Steno Practice`
    return () => { document.title = previous }
  }, [pathname])

  const openReports = useQuery({
    queryKey: ['admin', 'reports-count'],
    queryFn: () => api<{ total: number }>('/admin/reports?status=open&limit=1').then((r) => r.total),
    refetchInterval: 60_000,
  })

  return (
    <div className="admin-app">
      <header className="admin-top">
        <div className="admin-top-inner">
          <Link to="/admin" className="admin-brand">
            <Logo />
            <span>Steno Practice</span>
            <span className="admin-tag">Admin</span>
          </Link>
          <div className="admin-top-right">
            <span className="admin-hello" title={user?.email}>Hey <b>{firstName}</b></span>
            <div className="menu" ref={menuRef}>
              <button className="avatar" style={{ border: 0, cursor: 'pointer' }} onClick={() => setMenuOpen((o) => !o)} aria-label="Account menu" aria-expanded={menuOpen} aria-haspopup="menu">
                {user?.picture ? <img src={user.picture} alt="" referrerPolicy="no-referrer" /> : firstName.charAt(0).toUpperCase()}
              </button>
              {menuOpen && (
                <div className="menu-panel" role="menu">
                  <div style={{ padding: '8px 12px' }}>
                    <div style={{ fontWeight: 700 }}>{user?.name}</div>
                    <div className="muted small">{user?.email}</div>
                  </div>
                  <button className="menu-item" role="menuitem" onClick={() => { setMenuOpen(false); setConfirmOut(true) }}>Sign out</button>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      <div className="admin-body">
        <aside className="admin-side" aria-label="Admin sections">
          <div className="admin-side-title">Manage</div>
          <NavLink to="/admin" end>{ICONS.content}<span>Content</span></NavLink>
          <NavLink to="/admin/reports">
            {ICONS.reports}<span>Reports</span>
            {!!openReports.data && <span className="admin-count">{openReports.data}</span>}
          </NavLink>
          <NavLink to="/admin/resources">{ICONS.resources}<span>Resources</span></NavLink>
          <NavLink to="/admin/access">{ICONS.access}<span>Access</span></NavLink>
          <NavLink to="/admin/config">{ICONS.config}<span>Rules and exams</span></NavLink>
        </aside>

        <main className="admin-main">
          <div className="admin-crumb"><span>Admin</span><span>/</span><b>{pageTitle(pathname)}</b></div>
          <Outlet />
        </main>
      </div>
      {confirmOut && <SignOutDialog onClose={() => setConfirmOut(false)} />}
    </div>
  )
}
