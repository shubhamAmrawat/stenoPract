import { useEffect, useId, useRef, useState, type ReactNode } from 'react'

/** A small "i" button that opens a short explanation. Click, tap or press Enter; Escape or clicking elsewhere closes it. */
export function InfoTip({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)
  const id = useId()

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent | TouchEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('touchstart', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('touchstart', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <span className="infotip" ref={ref}>
      <button type="button" className="infotip-btn" aria-label={label} aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
        i
      </button>
      {open && (
        <div id={id} role="note" className="infotip-pop">
          {children}
        </div>
      )}
    </span>
  )
}
