import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

const COUNTDOWN_SECONDS = 5
const RING_R = 66
const RING_C = 2 * Math.PI * RING_R

const icon = (children: ReactNode) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
)

interface Props {
  /** True when the student has been here before (retake), so the wording fits. */
  isRetake: boolean
  durationMin?: number
  /** True while the attempt is being created, after the countdown has finished. */
  busy: boolean
  error?: string | null
  /** Called once, when the countdown reaches zero. The parent creates the attempt (which is what starts the real timer). */
  onStart: () => void
  onCancel: () => void
}

/**
 * Shown between "Transcribe now" / "Retake again" and the typing screen.
 * Step 1 explains the typing screen; step 2 is a 5 second countdown. The attempt (and so its timer) is only created when the countdown ends.
 */
export function StartInfoModal({ isRetake, durationMin, busy, error, onStart, onCancel }: Props) {
  const uid = useId()
  const [step, setStep] = useState<'info' | 'countdown'>('info')
  const [count, setCount] = useState(COUNTDOWN_SECONDS)
  const dialogRef = useRef<HTMLDivElement>(null)
  const firedRef = useRef(false)

  // Parents re-render often; keep the latest callback in a ref so the countdown tick never restarts.
  const onStartRef = useRef(onStart)
  useEffect(() => { onStartRef.current = onStart })

  const timerText = durationMin ? `${durationMin}-minute timer` : 'timer'

  // Hand focus back to whatever opened the dialog when it closes.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    return () => { if (opener?.isConnected) opener.focus() }
  }, [])

  // Focus the main button of the step that is on screen (Okay, start / Cancel).
  useEffect(() => {
    dialogRef.current?.querySelector<HTMLButtonElement>('button[data-autofocus]')?.focus()
  }, [step])

  // Countdown: one number per second, then hand over to the parent at zero.
  useEffect(() => {
    if (step !== 'countdown') return
    if (count === 0) {
      if (!firedRef.current) {
        firedRef.current = true
        onStartRef.current()
      }
      return
    }
    const t = setTimeout(() => setCount((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [step, count])

  // The attempt could not be created: go back to the info step so the student can try again.
  useEffect(() => {
    if (!error) return
    firedRef.current = false
    setCount(COUNTDOWN_SECONDS)
    setStep('info')
  }, [error])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (busy || (step === 'countdown' && count === 0)) return
        e.preventDefault()
        onCancel()
      } else if (e.key === 'Tab') {
        const items = Array.from(dialogRef.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])') ?? [])
        if (items.length === 0) return
        const first = items[0]
        const last = items[items.length - 1]
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, step, count, onCancel])

  const begin = () => {
    firedRef.current = false
    setCount(COUNTDOWN_SECONDS)
    setStep('countdown')
  }

  const title = isRetake ? 'Ready to retake?' : 'Before you start'
  const points: { icon: ReactNode; title: string; text: string }[] = [
    {
      icon: icon(<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>),
      title: 'Timer',
      text: `Counts down${durationMin ? ` from ${durationMin} minutes` : ''}, turning amber under 5 minutes and red under 1. Your answer is submitted automatically at 00:00.`,
    },
    {
      icon: icon(<><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /><path d="M9 13h6" /><path d="M9 17h4" /></>),
      title: 'Word count and saving',
      text: 'Your word count updates as you type, and your text is saved automatically.',
    },
    {
      icon: icon(<><circle cx="12" cy="12" r="9" /><path d="M10 8l6 4-6 4z" /></>),
      title: 'Interrupted? Resume typing',
      text: 'If you press Back by mistake, close the tab or lose your connection, come back to this exercise and press Resume typing to continue with your saved text. The timer keeps running while you are away.',
    },
    {
      icon: icon(<><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5" /></>),
      title: 'Retake',
      text: 'Discards this attempt and everything you typed, and takes you back to this page. Nothing is added to your history.',
    },
    {
      icon: icon(<><path d="M22 2L11 13" /><path d="M22 2l-7 20-4-9-9-4z" /></>),
      title: 'Submit',
      text: 'Asks you to confirm, then checks your answer and shows your result. You cannot edit after submitting.',
    },
  ]

  return createPortal(
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && step === 'info' && onCancel()}>
      <div ref={dialogRef} className="modal start-modal" role="dialog" aria-modal="true" aria-labelledby={`${uid}-title`}>
        {step === 'info' ? (
          <>
            <div className="spread">
              <h2 id={`${uid}-title`}>{title}</h2>
              <button className="icon-btn" onClick={onCancel} aria-label="Close">✕</button>
            </div>

            <div className="start-scroll">
              <p className="muted" style={{ margin: 0 }}>Here is how the typing screen works:</p>
              <ul className="start-list">
                {points.map((p) => (
                  <li key={p.title} className="start-item">
                    <span className="start-icon" aria-hidden="true">{p.icon}</span>
                    <div>
                      <h3>{p.title}</h3>
                      <p>{p.text}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            <div className="start-foot">
              <div className="tip">After you press <b>Okay, start</b>, a 5-second countdown begins. Your {timerText} starts when it reaches zero.</div>
              {error && <div className="alert alert-error" role="alert">{error}</div>}
              <div className="confirm-actions">
                <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
                <button data-autofocus className="btn btn-primary" onClick={begin}>Okay, start</button>
              </div>
            </div>
          </>
        ) : (
          <div className="countdown">
            <h2 id={`${uid}-title`}>{count === 0 ? 'Starting…' : 'Get ready…'}</h2>
            <div className="countdown-ring">
              <svg className="countdown-svg" viewBox="0 0 148 148" aria-hidden="true">
                <circle className="countdown-track" cx="74" cy="74" r={RING_R} />
                <circle
                  key={count}
                  className="countdown-arc"
                  cx="74"
                  cy="74"
                  r={RING_R}
                  style={{
                    strokeDasharray: RING_C,
                    '--from': RING_C * (1 - count / COUNTDOWN_SECONDS),
                    '--to': RING_C * (1 - Math.max(count - 1, 0) / COUNTDOWN_SECONDS),
                  } as CSSProperties}
                />
              </svg>
              <span key={count} className="countdown-num" role="status" aria-live="polite">{count === 0 ? 'Go' : count}</span>
            </div>
            <p className="muted" style={{ margin: 0 }}>Your {timerText} starts at zero. Have your notes ready.</p>
            <button data-autofocus className="btn btn-ghost" onClick={onCancel} disabled={busy || count === 0}>Cancel</button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
