import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import { api, qs } from '../lib/api'
import { formatPct } from '../lib/format'
import type { Dictation, DictationSet, Paged } from '../lib/types'
import { ErrorState, Spinner } from './ui'
import './exercise-rail.css'

/** Every exercise of one book, fetched page by page (the API returns at most 100 at a time). */
async function fetchAll(setId: string): Promise<Dictation[]> {
  const all: Dictation[] = []
  for (let page = 1; page <= 20; page++) {
    const r = await api<Paged<Dictation>>(`/dictations${qs({ setId, limit: 100, page })}`)
    all.push(...r.items)
    if (all.length >= r.total || r.items.length === 0) break
  }
  return all
}

const ListIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M8 6h13M8 12h13M8 18h13" />
    <path d="M3 6h.01M3 12h.01M3 18h.01" />
  </svg>
)

/** The button that opens and closes the list. Lives in the page header. */
export function RailToggle({ open, onClick }: { open: boolean; onClick: () => void }) {
  return (
    <button type="button" className="btn btn-ghost btn-sm rail-toggle" aria-expanded={open} aria-controls="exercise-rail" onClick={onClick}>
      <ListIcon /> Exercises
    </button>
  )
}

/** What is left of the list on wide screens once it is hidden: a slim strip with one arrow that brings it back. */
export function RailHandle({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="rail-handle" aria-expanded={false} aria-label="Show exercise list" title="Show exercise list" onClick={onClick}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M15 18l-6-6 6-6" />
      </svg>
      <span>Exercises</span>
    </button>
  )
}

interface Props {
  currentId: string
  setId: string
  /** 'docked' sits beside the page on wide screens; 'drawer' slides over the page on smaller ones. */
  mode: 'docked' | 'drawer'
  onClose: () => void
}

export function ExerciseRail({ currentId, setId, mode, onClose }: Props) {
  const listQ = useQuery({ queryKey: ['rail', setId], queryFn: () => fetchAll(setId), staleTime: 60_000 })
  const setsQ = useQuery({ queryKey: ['sets'], queryFn: () => api<{ items: DictationSet[] }>('/sets').then((r) => r.items) })
  const setTitle = setsQ.data?.find((s) => s.id === setId)?.title ?? 'Exercises'

  const [search, setSearch] = useState('')
  const [unseenOnly, setUnseenOnly] = useState(false)
  const rootRef = useRef<HTMLElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (listQ.data ?? []).filter((d) => (!unseenOnly || !d.state.seen) && (q === '' || String(d.exerciseNo).includes(q) || d.title.toLowerCase().includes(q)))
  }, [listQ.data, search, unseenOnly])

  // Keep the exercise you are on in view (scrolls the list only, never the page).
  useEffect(() => {
    const list = listRef.current
    const el = list?.querySelector<HTMLElement>('[aria-current="page"]')
    if (list && el) list.scrollTop = el.offsetTop - list.clientHeight / 2 + el.clientHeight / 2
  }, [listQ.data, currentId, unseenOnly])

  // As a drawer it behaves like a dialog: page behind is locked, Esc closes, focus goes in and comes back out.
  useEffect(() => {
    if (mode !== 'drawer') return
    const opener = document.activeElement as HTMLElement | null
    closeRef.current?.focus()
    const html = document.documentElement
    const previousOverflow = html.style.overflow
    html.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      } else if (e.key === 'Tab' && rootRef.current) {
        const focusable = [...rootRef.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input')]
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        if (!first || !last) return
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      html.style.overflow = previousOverflow
      if (opener?.isConnected) opener.focus()
    }
  }, [mode, onClose])

  const drawer = mode === 'drawer'

  return (
    <>
      {drawer && <div className="rail-backdrop" onMouseDown={onClose} aria-hidden="true" />}
      <aside
        id="exercise-rail"
        ref={rootRef}
        className={`ex-rail ex-rail-${mode}`}
        aria-label={`Exercises in ${setTitle}`}
        {...(drawer ? { role: 'dialog', 'aria-modal': true } : {})}
      >
        <div className="ex-rail-head">
          <div className="ex-rail-title">
            <b title={setTitle}>{setTitle}</b>
            <span className="muted small">{listQ.data ? `${listQ.data.length} exercises` : ' '}</span>
          </div>
          <button ref={closeRef} type="button" className="icon-btn" aria-label="Hide exercise list" title="Hide list" onClick={onClose}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              {drawer ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M9 18l6-6-6-6" />}
            </svg>
          </button>
        </div>

        <div className="ex-rail-tools">
          <input className="input" type="search" inputMode="search" placeholder="Find exercise, e.g. 524" aria-label="Find an exercise" value={search} onChange={(e) => setSearch(e.target.value)} />
          <div className="segmented" role="group" aria-label="Filter exercises">
            <button aria-pressed={!unseenOnly} onClick={() => setUnseenOnly(false)}>All</button>
            <button aria-pressed={unseenOnly} onClick={() => setUnseenOnly(true)}>Not seen</button>
          </div>
        </div>

        {listQ.isPending ? <div className="ex-rail-msg"><Spinner /></div> : listQ.error ? (
          <div className="ex-rail-msg"><ErrorState error={listQ.error} onRetry={() => void listQ.refetch()} /></div>
        ) : shown.length === 0 ? (
          <p className="muted small ex-rail-msg">No exercise matches.</p>
        ) : (
          <ul ref={listRef} className="ex-list">
            {shown.map((d) => {
              const current = d.id === currentId
              const speeds = [...new Set(d.videos.map((v) => v.baseWpm))].sort((a, b) => a - b).join(' / ')
              const s = d.state
              const meta = [speeds && `${speeds} wpm`, d.masterWordCount > 0 && `${d.masterWordCount} words`].filter(Boolean).join(' · ')
              const body = (
                <>
                  <span className="ex-no">{d.exerciseNo}</span>
                  <span className="ex-meta">{meta || 'No details'}</span>
                  <span className="ex-status">
                    {!d.ready ? <span className="muted">Soon</span> : s.attemptsCount > 0 ? <span className="ex-pill" title={`Best error ${formatPct(s.bestErrorPct)} · ${s.attemptsCount} attempt${s.attemptsCount === 1 ? '' : 's'}`}>{formatPct(s.bestErrorPct)}</span> : s.seen ? <span className="muted">Seen</span> : null}
                  </span>
                </>
              )
              return (
                <li key={d.id}>
                  {d.ready ? (
                    <Link className="ex-item" to={`/d/${d.id}`} aria-current={current ? 'page' : undefined} onClick={drawer ? onClose : undefined}>{body}</Link>
                  ) : (
                    <span className="ex-item disabled" aria-disabled="true">{body}</span>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </aside>
    </>
  )
}
