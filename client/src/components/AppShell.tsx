import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useNavigate } from 'react-router'
import { useAuth } from '../auth/AuthContext'
import { setStudentView } from '../auth/studentView'
import '../student.css'

export function Logo() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <svg width="22" height="22" viewBox="0 0 32 32">
        <path d="M6 21c3-9 5-9 8-3s5 4 8-7" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="25" cy="11" r="2.6" fill="#FF7A59" />
      </svg>
    </span>
  )
}

export function AppShell() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const close = (e: MouseEvent) => menuRef.current && !menuRef.current.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  if (!user) return null
  const backToAdmin = () => { setStudentView(false); navigate('/admin') }
  return (
    <>
      {user.role === 'admin' && (
        <div className="preview-bar">
          <span><b>ADMIN PREVIEW</b> · you are looking at the student side</span>
          <button onClick={backToAdmin}>← Back to admin console</button>
        </div>
      )}
      <header className="topbar">
        <div className="container topbar-inner">
          <Link to="/" className="brand">
            <Logo />
            <span>Steno Practice</span>
          </Link>
          <nav className="nav" aria-label="Main">
            <NavLink to="/" end>Home</NavLink>
            <NavLink to="/dashboard">Dashboard</NavLink>
            <NavLink to="/history">History</NavLink>
          </nav>
          <div className="menu" ref={menuRef}>
            <button className="avatar" style={{ border: 0, cursor: 'pointer' }} onClick={() => setOpen((o) => !o)} aria-label="Account menu" aria-expanded={open}>
              {user.picture ? <img src={user.picture} alt="" referrerPolicy="no-referrer" /> : user.name.charAt(0).toUpperCase()}
            </button>
            {open && (
              <div className="menu-panel">
                <div style={{ padding: '8px 12px' }}>
                  <div style={{ fontWeight: 700 }}>{user.name}</div>
                  <div className="muted small">{user.email}</div>
                </div>
                <button className="menu-item" onClick={() => { setOpen(false); navigate('/settings') }}>Exam settings</button>
                <button className="menu-item" onClick={() => { setStudentView(false); void logout().then(() => navigate('/login')) }}>Sign out</button>
              </div>
            )}
          </div>
        </div>
      </header>
      <main className="page">
        <div className="container">
          <Outlet />
        </div>
      </main>
    </>
  )
}
