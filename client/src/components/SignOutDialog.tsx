import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router'
import { useAuth } from '../auth/AuthContext'
import { setStudentView } from '../auth/studentView'

/**
 * Second step of signing out: asks first, and only signs out when the person confirms.
 * Shared by the student menu and the admin header, so both look the same (student theme).
 * Rendered into document.body because the header uses backdrop-filter, which would trap a fixed-position child.
 */
export function SignOutDialog({ onClose }: { onClose: () => void }) {
  const { logout } = useAuth()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)

  // Focus the safe choice first, and hand focus back to whatever opened the dialog when it closes.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    cancelRef.current?.focus()
    return () => { if (opener?.isConnected) opener.focus() }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) {
        e.preventDefault()
        onClose()
      } else if (e.key === 'Tab') {
        // Keep focus inside the dialog: it only has these two buttons.
        const first = cancelRef.current
        const last = confirmRef.current
        if (!first || !last) return
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  const confirm = async () => {
    setBusy(true)
    setStudentView(false)
    await logout()
    navigate('/login')
  }

  return createPortal(
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="modal confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="signout-title" aria-describedby="signout-text">
        <div className="confirm-icon" aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <path d="M16 17l5-5-5-5" />
            <path d="M21 12H9" />
          </svg>
        </div>
        <div>
          <h2 id="signout-title">Sign out?</h2>
          <p id="signout-text" className="muted" style={{ marginTop: 6 }}>Are you sure you want to sign out? You will need to sign in again to keep practising.</p>
        </div>
        <div className="confirm-actions">
          <button ref={cancelRef} className="btn btn-ghost" onClick={onClose} disabled={busy}>Stay signed in</button>
          <button ref={confirmRef} className="btn btn-primary" onClick={() => void confirm()} disabled={busy}>{busy ? 'Signing out…' : 'Yes, sign out'}</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
