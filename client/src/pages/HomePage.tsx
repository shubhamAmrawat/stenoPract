import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { useAuth } from '../auth/AuthContext'
import { Empty, ErrorState, Spinner } from '../components/ui'
import { api } from '../lib/api'
import { RESOURCE_GROUPS } from '../lib/resources'
import { thumbUrl } from '../lib/thumb'
import type { DictationSet, ResourceGroupKey } from '../lib/types'

function greeting(): string {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

const KeyboardIcon = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="2.5" y="6" width="19" height="12" rx="2.5" />
    <path d="M6.5 10h.01M10 10h.01M14 10h.01M17.5 10h.01M7 14h10" />
  </svg>
)
const BookIcon = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5v-15z" />
    <path d="M4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5" />
  </svg>
)
const FileIcon = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5z" />
    <path d="M14 3v5h5M9 13h6M9 17h6" />
  </svg>
)

function SetCard({ s }: { s: DictationSet }) {
  const pct = s.dictationCount ? Math.round((s.attemptedCount / s.dictationCount) * 100) : 0
  return (
    <Link to={`/practice/${s.slug}`} className="set-tile">
      <div className="set-tile-media">
        {s.coverVideoId ? (
          <img src={thumbUrl(s.coverVideoId)} alt="" loading="lazy" referrerPolicy="no-referrer" onError={(e) => { e.currentTarget.style.display = 'none' }} />
        ) : null}
        <span className="set-tile-count">{s.readyCount} exercises</span>
      </div>
      <div className="set-tile-body">
        <h3>{s.title}</h3>
        {s.source && <div className="muted small">{s.source}</div>}
        <div className="progress" aria-hidden="true"><span style={{ width: `${pct}%` }} /></div>
        <div className="spread">
          <span className="muted small">{s.attemptedCount} of {s.dictationCount} attempted</span>
          <span className="tile-cta">{s.attemptedCount > 0 ? 'Continue' : 'Start'} →</span>
        </div>
      </div>
    </Link>
  )
}

export function HomePage() {
  const { user } = useAuth()
  const setsQ = useQuery({ queryKey: ['sets'], queryFn: () => api<{ items: DictationSet[] }>('/sets').then((r) => r.items) })
  const resQ = useQuery({ queryKey: ['resource-groups'], queryFn: () => api<{ groups: { group: ResourceGroupKey; count: number }[] }>('/resources').then((r) => r.groups) })

  const firstName = user?.name.split(' ')[0] ?? ''
  const attempted = setsQ.data?.reduce((n, s) => n + s.attemptedCount, 0) ?? 0
  const counts = new Map((resQ.data ?? []).map((g) => [g.group, g.count]))

  return (
    <div className="stack-lg home">
      <section className="home-hero">
        <div>
          <p className="home-eyebrow">{greeting()}{firstName ? `, ${firstName}` : ''}</p>
          <h1>Listen. Write. Transcribe.</h1>
          <p className="home-sub">Practise SSC stenography dictations, type them against the clock, and see exactly which words cost you marks.</p>
        </div>
        <div className="home-stats" aria-label="Your progress">
          <div><b>{attempted}</b><span>exercises attempted</span></div>
          <div><b>{setsQ.data?.length ?? 0}</b><span>{setsQ.data?.length === 1 ? 'book' : 'books'} available</span></div>
        </div>
      </section>

      <section className="home-section" aria-labelledby="h-dict">
        <div className="home-section-head">
          <span className="home-num">01</span>
          <div>
            <h2 id="h-dict">Dictation practice</h2>
            <p className="muted small">Pick a book, listen to a dictation and write it in your notebook, then transcribe it on screen.</p>
          </div>
        </div>
        {setsQ.isPending ? <Spinner /> : setsQ.error ? <ErrorState error={setsQ.error} onRetry={() => void setsQ.refetch()} /> : setsQ.data.length === 0 ? (
          <Empty title="No dictations published yet"><p>Check back soon.</p></Empty>
        ) : (
          <div className="set-tiles">{setsQ.data.map((s) => <SetCard key={s.id} s={s} />)}</div>
        )}
      </section>

      <section className="home-section" aria-labelledby="h-type">
        <div className="home-section-head">
          <span className="home-num">02</span>
          <div>
            <h2 id="h-type">Typing speed test</h2>
            <p className="muted small">Check your everyday typing speed and accuracy.</p>
          </div>
        </div>
        <div className="soon-card" aria-disabled="true">
          <span className="tile-icon"><KeyboardIcon /></span>
          <div className="grow">
            <h3>Typing test</h3>
            <p className="muted small">A timed test that measures your words per minute and accuracy on ordinary text.</p>
          </div>
          <span className="badge badge-half">Coming soon</span>
        </div>
      </section>

      <section className="home-section" aria-labelledby="h-res">
        <div className="home-section-head">
          <span className="home-num">03</span>
          <div>
            <h2 id="h-res">Resources</h2>
            <p className="muted small">Study material to keep on your phone or print.</p>
          </div>
        </div>
        <div className="res-tiles">
          {(Object.keys(RESOURCE_GROUPS) as ResourceGroupKey[]).map((g, i) => {
            const meta = RESOURCE_GROUPS[g]
            const n = counts.get(g)
            return (
              <Link key={g} to={`/resources/${g}`} className="res-tile">
                <span className={`tile-icon ${i === 0 ? 'tile-indigo' : 'tile-coral'}`}>{i === 0 ? <BookIcon /> : <FileIcon />}</span>
                <div className="grow">
                  <span className="badge badge-muted">{meta.tag}</span>
                  <h3>{meta.title}</h3>
                  <p className="muted small">{meta.blurb}</p>
                </div>
                <div className="res-tile-foot">
                  <span className="muted small">{n === undefined ? '' : n === 0 ? 'Being added' : `${n} file${n === 1 ? '' : 's'}`}</span>
                  <span className="tile-cta">Open →</span>
                </div>
              </Link>
            )
          })}
        </div>
      </section>
    </div>
  )
}
