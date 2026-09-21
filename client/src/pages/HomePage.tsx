import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { useAuth } from '../auth/AuthContext'
import { Empty, ErrorState, Spinner } from '../components/ui'
import { api } from '../lib/api'
import { formatPct } from '../lib/format'
import { displayFirstName, greetingFor, lastSevenDays, tipForDay } from '../lib/home'
import type { AttemptSummary, DictationSet, Paged, ResourceGroup } from '../lib/types'
import '../home.css'

const zone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata'

/** Re-renders once a minute (and when the tab comes back to the front), so the greeting never goes stale. */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const tick = () => setNow(new Date())
    const id = window.setInterval(tick, 60_000)
    const onVisible = () => { if (document.visibilityState === 'visible') tick() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { window.clearInterval(id); document.removeEventListener('visibilitychange', onVisible) }
  }, [])
  return now
}

/** A few flowing strokes, in the spirit of shorthand outlines. Purely decorative. */
function StenoStrokes({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 320 110" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M6 72C26 8 52 8 66 46S96 98 118 44 150 4 172 40s34 48 56-2 34-32 62-8" />
      <path d="M40 98c14-10 30-10 44 0" />
      <path d="M196 96c10-6 22-6 32 0" />
      <circle cx="304" cy="14" r="3.5" fill="currentColor" stroke="none" />
    </svg>
  )
}

const SheetIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5z" />
    <path d="M14 3v5h5M9 13h6M9 17h4" />
  </svg>
)

const BulbIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9 18h6M10 21.5h4" />
    <path d="M12 2.5a6.5 6.5 0 0 0-4 11.6c.7.6 1 1.3 1 2.1V17h6v-.8c0-.8.3-1.5 1-2.1A6.5 6.5 0 0 0 12 2.5z" />
  </svg>
)

const NUMBER_WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven']

function WeekStrip({ now, practised, ready }: { now: Date; practised: ReadonlySet<string>; ready: boolean }) {
  const days = useMemo(() => lastSevenDays(now, zone(), practised), [now, practised])
  const done = days.filter((d) => d.done).length
  const note = !ready ? ' ' : done === 0 ? 'A fresh week. One dictation makes a start.' : `${NUMBER_WORDS[done]} ${done === 1 ? 'day' : 'days'} practised.`
  return (
    <div className="week" role="group" aria-label="Your last seven days">
      <p className="eyebrow">This week</p>
      <ol className="week-days">
        {days.map((d) => (
          <li key={d.key} className={`${d.done ? 'is-done' : ''} ${d.today ? 'is-today' : ''}`} aria-label={`${d.name}${d.today ? ', today' : ''}${d.done ? ', practised' : ''}`}>
            <span className="week-mark" aria-hidden="true">
              {d.done && (
                <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M2.5 10.5C4 5 6 5 7.5 8.5S11 11 13.5 4.5" /></svg>
              )}
            </span>
            <span className="week-letter" aria-hidden="true">{d.letter}</span>
          </li>
        ))}
      </ol>
      <p className="week-note">{note}</p>
    </div>
  )
}

interface ResumeProps {
  loading: boolean
  draft: AttemptSummary | undefined
  last: AttemptSummary | undefined
  firstSet: DictationSet | undefined
}

function Resume({ loading, draft, last, firstSet }: ResumeProps) {
  const shell = (children: ReactNode, busy = false) => (
    <section className="resume rise" style={{ '--i': 1 } as CSSProperties} aria-label="Continue practising" aria-busy={busy || undefined}>
      <StenoStrokes className="resume-strokes" />
      {children}
    </section>
  )

  if (loading) return shell(<div className="resume-skeleton" />, true)

  const attempt = draft ?? last
  if (attempt) {
    const isDraft = Boolean(draft)
    const when = attempt.submittedAt
      ? new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' }).format(new Date(attempt.submittedAt))
      : null
    const result = !isDraft && attempt.errorPct !== null
      ? `${formatPct(attempt.errorPct)} errors`
      : null
    const title = attempt.dictationTitle ?? (attempt.exerciseNo !== null ? `Exercise ${attempt.exerciseNo}` : 'Your last dictation')
    // Titles are often just "Exercise 507"; do not print the same words twice.
    const exercise = attempt.exerciseNo !== null && !title.includes(String(attempt.exerciseNo)) ? `Exercise ${attempt.exerciseNo}` : null
    return shell(
      <>
        <div className="resume-body">
          <p className="eyebrow eyebrow-light">{isDraft ? 'Unfinished transcript' : 'Where you left off'}</p>
          <h2 className="resume-title">{title}</h2>
          <p className="resume-meta">{[exercise, isDraft ? 'saved as you typed' : when, result].filter(Boolean).join('  ·  ')}</p>
        </div>
        <div className="resume-actions">
          {isDraft ? (
            <Link className="pill-btn" to={`/attempts/${attempt.id}/write`}>Resume writing <span aria-hidden="true">→</span></Link>
          ) : (
            <>
              <Link className="pill-btn" to={`/d/${attempt.dictationId}`}>Practise again <span aria-hidden="true">→</span></Link>
              <Link className="text-link" to={`/attempts/${attempt.id}`}>See how it went</Link>
            </>
          )}
        </div>
      </>,
    )
  }

  if (firstSet) {
    return shell(
      <>
        <div className="resume-body">
          <p className="eyebrow eyebrow-light">Begin</p>
          <h2 className="resume-title">Start your first dictation.</h2>
          <p className="resume-meta">Listen, write it in your notebook, then type it out. Afterwards you will see exactly where the marks went.</p>
        </div>
        <div className="resume-actions">
          <Link className="pill-btn" to={`/practice/${firstSet.slug}`}>Open {firstSet.title} <span aria-hidden="true">→</span></Link>
        </div>
      </>,
    )
  }

  return shell(
    <div className="resume-body">
      <p className="eyebrow eyebrow-light">Begin</p>
      <h2 className="resume-title">Your first dictation is on its way.</h2>
      <p className="resume-meta">New books appear here as soon as they are published.</p>
    </div>,
  )
}

/** Which of the palette's five cover colours (--h-c1 to --h-c5) a book gets, stable per book. */
function coverFor(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return `var(--h-c${(h % 5) + 1})`
}

function Book({ s, i }: { s: DictationSet; i: number }) {
  const pct = s.dictationCount ? Math.round((s.attemptedCount / s.dictationCount) * 100) : 0
  const initial = s.title.match(/\p{L}/u)?.[0]?.toUpperCase() ?? 'S'
  return (
    <Link to={`/practice/${s.slug}`} className="book rise" style={{ '--i': i + 3 } as CSSProperties}>
      <div className="book-cover" style={{ '--cover': coverFor(s.slug) } as CSSProperties} aria-hidden="true">
        <StenoStrokes className="book-strokes" />
        <span className="book-initial">{initial}</span>
      </div>
      <div className="book-main">
        <div>
          {s.source && <p className="eyebrow">{s.source}</p>}
          <h3 className="book-title">{s.title}</h3>
        </div>
        <div className="book-progress">
          <div className="book-rule" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={`${s.attemptedCount} of ${s.dictationCount} attempted`}>
            <span style={{ width: `${pct}%` }} />
          </div>
          <div className="book-foot">
            <span>{s.attemptedCount} of {s.dictationCount} attempted</span>
            <span className="book-cta">{s.attemptedCount > 0 ? 'Continue' : 'Start'} <span className="arrow" aria-hidden="true">→</span></span>
          </div>
        </div>
      </div>
    </Link>
  )
}

export function HomePage() {
  const { user } = useAuth()
  const now = useNow()
  const tz = zone()

  const setsQ = useQuery({ queryKey: ['sets'], queryFn: () => api<{ items: DictationSet[] }>('/sets').then((r) => r.items) })
  const resQ = useQuery({ queryKey: ['resource-groups'], queryFn: () => api<{ groups: ResourceGroup[] }>('/resources').then((r) => r.groups) })
  // These change every time the student finishes something, so they are always re-read on arrival.
  const fresh = { staleTime: 0, refetchOnMount: 'always' as const }
  const draftQ = useQuery({ queryKey: ['attempts', 'home', 'draft'], queryFn: () => api<Paged<AttemptSummary>>('/attempts?status=draft&limit=1'), ...fresh })
  const lastQ = useQuery({ queryKey: ['attempts', 'home', 'last'], queryFn: () => api<Paged<AttemptSummary>>('/attempts?status=submitted&limit=1'), ...fresh })
  const weekQ = useQuery({
    queryKey: ['analytics', 'week', tz],
    queryFn: () => api<{ items: { date: string; attempts: number }[] }>(`/analytics/trend?days=8&tz=${encodeURIComponent(tz)}`).then((r) => r.items),
    ...fresh,
  })

  const practised = useMemo(() => new Set((weekQ.data ?? []).filter((p) => p.attempts > 0).map((p) => p.date)), [weekQ.data])
  const name = displayFirstName(user?.name)
  const dateLine = new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'long' }).format(now)
  const tip = tipForDay(now, tz)

  return (
    <div className="home">
      <header className="masthead rise">
        <div>
          <p className="masthead-date">{dateLine}</p>
          <h1 className="masthead-title">
            {greetingFor(now.getHours())}
            {name && <>, <span className="name">{name}</span></>}
            <span className="stop">.</span>
          </h1>
        </div>
        <WeekStrip now={now} practised={practised} ready={weekQ.isSuccess} />
      </header>

      <div className="feature">
        <Resume
          loading={draftQ.isPending || lastQ.isPending || setsQ.isPending}
          draft={draftQ.data?.items[0]}
          last={lastQ.data?.items[0]}
          firstSet={setsQ.data?.[0]}
        />
        <aside className="note rise" style={{ '--i': 2 } as CSSProperties} aria-label="Tip of the day">
          <div className="note-head">
            <span className="note-icon"><BulbIcon /></span>
            <p className="eyebrow">Tip of the day</p>
          </div>
          <p className="note-text">{tip}</p>
          <StenoStrokes className="note-strokes" />
        </aside>
      </div>

      <section className="shelf" aria-labelledby="h-books">
        <div className="shelf-head">
          <h2 id="h-books">Dictation books</h2>
          <p>Choose a book, listen, write it in your notebook, then transcribe it on screen.</p>
        </div>
        {setsQ.isPending ? <Spinner /> : setsQ.error ? <ErrorState error={setsQ.error} onRetry={() => void setsQ.refetch()} /> : setsQ.data.length === 0 ? (
          <Empty title="No dictations published yet"><p>Check back soon.</p></Empty>
        ) : (
          <div className="books">{setsQ.data.map((s, i) => <Book key={s.id} s={s} i={i} />)}</div>
        )}
      </section>

      {resQ.data && resQ.data.length > 0 && (
        <section className="shelf" aria-labelledby="h-res">
          <div className="shelf-head">
            <h2 id="h-res">Study material</h2>
            <p>Notes and papers to keep on your phone or print.</p>
          </div>
          <ul className="desk-list">
            {resQ.data.map((g) => {
              const n = g.count ?? 0
              return (
                <li key={g.group}>
                  <Link to={`/resources/${g.group}`} className="desk-row">
                    <span className="desk-icon"><SheetIcon /></span>
                    <span className="desk-text">
                      <span className="desk-title">{g.title}</span>
                      {g.blurb && <span className="desk-blurb">{g.blurb}</span>}
                    </span>
                    <span className="desk-count">{n === 0 ? 'Being added' : `${n} file${n === 1 ? '' : 's'}`}</span>
                    <span className="desk-arrow" aria-hidden="true">→</span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </section>
      )}
    </div>
  )
}
