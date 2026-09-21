import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

interface Props {
  title: string
  children: ReactNode
  cancelLabel: string
  confirmLabel: string
  /** Shown on the confirm button while `busy`. */
  busyLabel?: string
  busy?: boolean
  /** `danger` tints the icon and the confirm button red (for actions that throw work away). */
  tone?: 'primary' | 'danger'
  /** Icon shown in the tile above the title. */
  icon?: ReactNode
  error?: string | null
  onCancel: () => void
  onConfirm: () => void
}

/**
 * A small "are you sure?" dialog in the student theme (same look as the sign-out dialog).
 * Rendered into document.body because the page headers use backdrop-filter, which would trap a fixed-position child.
 */
export function ConfirmDialog({ title, children, cancelLabel, confirmLabel, busyLabel, busy = false, tone = 'primary', icon, error, onCancel, onConfirm }: Props) {
  const uid = useId()
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
        onCancel()
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
  }, [busy, onCancel])

  return createPortal(
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && !busy && onCancel()}>
      <div className="modal confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby={`${uid}-title`} aria-describedby={`${uid}-text`}>
        {icon && <div className={`confirm-icon ${tone === 'danger' ? 'danger' : ''}`} aria-hidden="true">{icon}</div>}
        <div>
          <h2 id={`${uid}-title`}>{title}</h2>
          <div id={`${uid}-text`} className="muted confirm-text">{children}</div>
        </div>
        {error && <div className="alert alert-error" role="alert">{error}</div>}
        <div className="confirm-actions">
          <button ref={cancelRef} className="btn btn-ghost" onClick={onCancel} disabled={busy}>{cancelLabel}</button>
          <button ref={confirmRef} className={`btn ${tone === 'danger' ? 'btn-danger' : 'btn-primary'}`} onClick={onConfirm} disabled={busy}>{busy && busyLabel ? busyLabel : confirmLabel}</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
