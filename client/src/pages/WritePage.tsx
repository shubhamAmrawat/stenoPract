import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { Modal, Spinner, ErrorState } from '../components/ui'
import { api, errorMessage } from '../lib/api'
import { countWords, formatClock } from '../lib/format'
import { startHallSound } from '../lib/hallSound'
import { EXAM_MODE_KEY, HALL_SOUND_KEY, useStoredFlag } from '../lib/useStoredFlag'
import type { Attempt } from '../lib/types'

const AUTOSAVE_MS = 1500

function Editor({ attempt }: { attempt: Attempt }) {
  const navigate = useNavigate()
  const qc = useQueryClient()

  const [text, setText] = useState(attempt.typedText)
  const [savedText, setSavedText] = useState(attempt.typedText)
  const [saveError, setSaveError] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [retaking, setRetaking] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const [timeUp, setTimeUp] = useState(false)
  // Exam mode is chosen on the dictation page and remembered in this browser.
  const [exam] = useStoredFlag(EXAM_MODE_KEY, false)
  const [sound, setSound] = useStoredFlag(HALL_SOUND_KEY, true)
  const [pasteNote, setPasteNote] = useState(false)

  const textRef = useRef(text)
  useEffect(() => {
    textRef.current = text
  }, [text])
  const submittingRef = useRef(false)
  const areaRef = useRef<HTMLTextAreaElement>(null)

  // Server and browser clocks can differ, so measure the gap once and use the SERVER's deadline.
  const offset = useRef(Date.parse(attempt.serverNow) - Date.now()).current
  const deadline = Date.parse(attempt.deadlineAt)
  const remaining = Math.max(0, (deadline - (now + offset)) / 1000)

  useEffect(() => {
    areaRef.current?.focus()
    const t = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(t)
  }, [])

  // Exam-hall murmur. Browsers keep audio paused until the page gets a tap or key press, so the first one wakes it.
  useEffect(() => {
    if (!exam || !sound) return
    const hall = startHallSound()
    if (!hall) return
    const wake = () => hall.resume()
    hall.resume()
    window.addEventListener('keydown', wake)
    window.addEventListener('pointerdown', wake)
    return () => {
      window.removeEventListener('keydown', wake)
      window.removeEventListener('pointerdown', wake)
      hall.stop()
    }
  }, [exam, sound])

  useEffect(() => {
    if (!pasteNote) return
    const t = setTimeout(() => setPasteNote(false), 2500)
    return () => clearTimeout(t)
  }, [pasteNote])

  const blockPaste = (e: { preventDefault: () => void }) => {
    e.preventDefault()
    setPasteNote(true)
  }

  const finish = useMutation({
    mutationFn: (auto: boolean) =>
      api<{ attempt: Attempt }>(`/attempts/${attempt.id}/submit`, { method: 'POST', body: { typedText: textRef.current, auto } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['attempt', attempt.id] })
      void qc.invalidateQueries({ queryKey: ['attempts'] })
      void qc.invalidateQueries({ queryKey: ['dictations'] })
      void qc.invalidateQueries({ queryKey: ['dictation', attempt.dictationId] })
      void qc.invalidateQueries({ queryKey: ['rail'] })
      void qc.invalidateQueries({ queryKey: ['sets'] })
      void qc.invalidateQueries({ queryKey: ['progress'] })
      void qc.invalidateQueries({ queryKey: ['analytics'] })
      navigate(`/attempts/${attempt.id}`, { replace: true })
    },
    onError: () => {
      submittingRef.current = false
    },
  })

  const submit = (auto: boolean) => {
    if (submittingRef.current) return
    submittingRef.current = true
    setConfirming(false)
    setRetaking(false)
    finish.mutate(auto)
  }

  // Time is up: submit whatever has been typed.
  useEffect(() => {
    if (remaining <= 0 && !submittingRef.current) {
      setTimeUp(true)
      submit(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remaining <= 0])

  // Autosave (debounced) so a refresh or crash never loses the text.
  useEffect(() => {
    if (text === savedText || submittingRef.current) return
    const t = setTimeout(() => {
      const snapshot = text
      api(`/attempts/${attempt.id}/draft`, { method: 'PATCH', body: { typedText: snapshot } })
        .then(() => {
          setSavedText(snapshot)
          setSaveError(false)
        })
        .catch(() => setSaveError(true))
    }, AUTOSAVE_MS)
    return () => clearTimeout(t)
  }, [text, savedText, attempt.id])

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (textRef.current !== savedText) e.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [savedText])

  const discard = useMutation({
    mutationFn: () => api(`/attempts/${attempt.id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      void qc.invalidateQueries({ queryKey: ['attempts'] })
      void qc.invalidateQueries({ queryKey: ['rail'] })
      // Refetch (even though the dictation page is not mounted) before leaving, so it opens with "Retake again" and no stale "Resume typing".
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['attempts', 'draft', attempt.dictationId], refetchType: 'all' }),
        qc.invalidateQueries({ queryKey: ['dictation', attempt.dictationId], refetchType: 'all' }),
      ])
      navigate(`/d/${attempt.dictationId}`, { replace: true })
    },
  })

  const timerClass = remaining <= 60 ? 'danger' : remaining <= 300 ? 'warn' : ''
  const status = saveError ? 'Not saved: check your connection' : pasteNote ? 'Pasting is turned off in exam mode' : text === savedText ? 'All changes saved' : 'Saving…'

  return (
    <>
      <div className="write-bar">
        <div className="container write-bar-inner">
          <span className={`timer ${timerClass}`} role="timer" aria-label="Time left">{formatClock(remaining)}</span>
          <div className="grow">
            <div style={{ fontWeight: 700 }}>{countWords(text)} words</div>
            <div className={`small ${saveError ? '' : 'muted'}`} style={saveError ? { color: 'var(--full-ink)' } : undefined} aria-live="polite">{status}</div>
          </div>
          {exam && (
            <>
              <span className="badge badge-info exam-badge" title="Exam mode is on. Turn it off on the dictation page.">Exam mode</span>
              <button
                type="button"
                className="icon-btn"
                aria-pressed={sound}
                aria-label={sound ? 'Mute exam-hall sound' : 'Play exam-hall sound'}
                title={sound ? 'Mute exam-hall sound' : 'Play exam-hall sound'}
                onClick={() => setSound(!sound)}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M11 5L6 9H2v6h4l5 4z" />
                  {sound ? <path d="M15.5 8.5a5 5 0 0 1 0 7" /> : <path d="M17 9l5 6M22 9l-5 6" />}
                </svg>
              </button>
            </>
          )}
          <button className="btn btn-ghost btn-sm" onClick={() => setRetaking(true)} disabled={finish.isPending}>Retake</button>
          <button className="btn btn-primary" onClick={() => setConfirming(true)} disabled={finish.isPending}>{finish.isPending ? 'Submitting…' : 'Submit'}</button>
        </div>
      </div>

      <div className="container" style={{ padding: '20px 20px 40px' }}>
        {timeUp && <div className="alert alert-warn" style={{ marginBottom: 12 }}>Time is up. Submitting your answer…</div>}
        {finish.error && (
          <div className="alert alert-error" style={{ marginBottom: 12 }}>
            {errorMessage(finish.error)}{' '}
            <button className="btn btn-sm btn-ghost" onClick={() => submit(false)}>Try again</button>
          </div>
        )}
        <textarea
          ref={areaRef}
          className={`editor ${exam ? 'editor-exam' : ''}`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Type the dictation here…"
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          autoComplete="off"
          data-gramm="false"
          aria-label="Your transcription"
          readOnly={finish.isPending}
          onPaste={exam ? blockPaste : undefined}
          onDrop={exam ? blockPaste : undefined}
        />
      </div>

      {retaking && (
        <ConfirmDialog
          title="Retake this dictation?"
          tone="danger"
          icon={
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12a9 9 0 1 0 3-6.7" />
              <path d="M3 4v5h5" />
            </svg>
          }
          cancelLabel="Keep typing"
          confirmLabel="Yes, retake"
          busyLabel="Discarding…"
          busy={discard.isPending}
          error={discard.error ? errorMessage(discard.error) : null}
          onCancel={() => { setRetaking(false); discard.reset() }}
          onConfirm={() => discard.mutate()}
        >
          <p>
            This discards your current attempt{countWords(text) > 0 ? <> and the <b>{countWords(text)}</b> words you have typed</> : null}. Nothing is added to your history.
          </p>
          <p>You will go back to the dictation page and can start again whenever you are ready.</p>
        </ConfirmDialog>
      )}

      {confirming && (
        <Modal title="Submit your answer?" onClose={() => setConfirming(false)}>
          <p>You have typed <b>{countWords(text)}</b> words and have <b>{formatClock(remaining)}</b> left. You cannot edit after submitting.</p>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn btn-ghost" onClick={() => setConfirming(false)}>Keep typing</button>
            <button className="btn btn-primary" onClick={() => submit(false)}>Submit now</button>
          </div>
        </Modal>
      )}
    </>
  )
}

export function WritePage() {
  const { id = '' } = useParams()
  const q = useQuery({
    queryKey: ['attempt', id],
    queryFn: () => api<{ attempt: Attempt }>(`/attempts/${id}`).then((r) => r.attempt),
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: 'always',
  })

  if (q.isPending) return <Spinner full />
  if (q.error) {
    return (
      <div className="container page">
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        <div className="center"><Link to="/">Back to home</Link></div>
      </div>
    )
  }
  if (q.data.status === 'submitted') return <Navigate to={`/attempts/${id}`} replace />
  return <Editor attempt={q.data} />
}
