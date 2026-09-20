import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'

/** A small "i" button that opens a short explanation. Click, tap or press Enter; Escape or clicking elsewhere closes it. */
export function InfoTip({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const [shift, setShift] = useState(0)
  const id = useId()

  // Keep the bubble inside the screen: on a phone the button can sit far enough right that the bubble would run off the edge.
  useLayoutEffect(() => {
    if (!open) return
    const el = popRef.current
    if (!el) return
    setShift(0)
    const margin = 12
    const { left, right } = el.getBoundingClientRect()
    const vw = document.documentElement.clientWidth
    if (right > vw - margin) setShift(vw - margin - right)
    else if (left < margin) setShift(margin - left)
  }, [open])

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
        <div id={id} ref={popRef} role="note" className="infotip-pop" style={{ transform: `translateX(${shift}px)`, ...({ '--arrow-shift': `${-shift}px` } as CSSProperties) }}>
          {children}
        </div>
      )}
    </span>
  )
}
