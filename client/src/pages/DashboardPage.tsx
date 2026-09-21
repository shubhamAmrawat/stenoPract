import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { Empty, ErrorState, Spinner } from '../components/ui'
import { api } from '../lib/api'
import { formatPct } from '../lib/format'
import { KIND_ORDER, KINDS } from '../lib/mistakes'
import type { MistakeKind } from '../lib/types'

interface Summary {
  attempts: number
  dictationsAttempted: number
  avgErrorPct: number | null
  bestErrorPct: number | null
  last7Days: { attempts: number; avgErrorPct: number | null }
  streakDays: number
}
interface TrendPoint { date: string; attempts: number; avgErrorPct: number; bestErrorPct: number }
interface MistakeRow { kind: MistakeKind; count: number; weight: 1 | 0.5 }
interface WeakWord { word: string; misses: number; weightedMisses: number }

function TrendChart({ points }: { points: TrendPoint[] }) {
  const W = 640, H = 220, padL = 40, padR = 16, padT = 16, padB = 28
  const max = Math.max(5, Math.ceil(Math.max(...points.map((p) => p.avgErrorPct)) / 5) * 5)
  const x = (i: number) => padL + (points.length === 1 ? (W - padL - padR) / 2 : (i / (points.length - 1)) * (W - padL - padR))
  const y = (v: number) => padT + (1 - v / max) * (H - padT - padB)
  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.avgErrorPct).toFixed(1)}`).join(' ')
  const area = `${line} L${x(points.length - 1).toFixed(1)},${y(0)} L${x(0).toFixed(1)},${y(0)} Z`
  const ticks = [0, max / 4, max / 2, (max * 3) / 4, max]
  const label = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Average error percentage per day" style={{ display: 'block' }}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} style={{ stroke: 'var(--border)' }} />
          <text x={padL - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="#55628a">{Number.isInteger(t) ? t : t.toFixed(1)}%</text>
        </g>
      ))}
      <path d={area} style={{ fill: 'color-mix(in srgb, var(--primary) 10%, transparent)' }} />
      <path d={line} fill="none" style={{ stroke: 'var(--primary)' }} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      {points.map((p, i) => (
        <circle key={p.date} cx={x(i)} cy={y(p.avgErrorPct)} r="4.5" fill="#fff" style={{ stroke: 'var(--primary)' }} strokeWidth="2.5">
          <title>{`${label(p.date)}: ${p.avgErrorPct}% average error (${p.attempts} attempt${p.attempts === 1 ? '' : 's'})`}</title>
        </circle>
      ))}
      <text x={x(0)} y={H - 6} fontSize="11" fill="#55628a" textAnchor="start">{label(points[0]!.date)}</text>
      {points.length > 1 && <text x={x(points.length - 1)} y={H - 6} fontSize="11" fill="#55628a" textAnchor="end">{label(points[points.length - 1]!.date)}</text>}
    </svg>
  )
}

export function DashboardPage() {
  const summaryQ = useQuery({ queryKey: ['analytics', 'summary'], queryFn: () => api<Summary>('/analytics/summary') })
  const trendQ = useQuery({ queryKey: ['analytics', 'trend'], queryFn: () => api<{ items: TrendPoint[] }>('/analytics/trend?days=30').then((r) => r.items) })
  const mistakesQ = useQuery({ queryKey: ['analytics', 'mistakes'], queryFn: () => api<{ items: MistakeRow[]; total: number }>('/analytics/mistakes?days=90') })
  const weakQ = useQuery({ queryKey: ['analytics', 'weak'], queryFn: () => api<{ items: WeakWord[] }>('/analytics/weak-words?limit=15').then((r) => r.items) })

  if (summaryQ.isPending) return <Spinner full />
  if (summaryQ.error) return <ErrorState error={summaryQ.error} onRetry={() => void summaryQ.refetch()} />
  const s = summaryQ.data

  if (s.attempts === 0) {
    return (
      <div className="stack-lg">
        <div className="page-header"><h1>Dashboard</h1></div>
        <Empty title="Your progress will show up here">
          <p>Complete your first dictation to see scores, trends and your weak words.</p>
          <p style={{ marginTop: 12 }}><Link className="btn btn-primary" to="/">Go to practice</Link></p>
        </Empty>
      </div>
    )
  }

  const mistakes = (mistakesQ.data?.items ?? []).slice().sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind))
  const maxMistake = Math.max(1, ...mistakes.map((m) => m.count))
  const tiles: [string, string, string?][] = [
    ['Attempts', String(s.attempts), `${s.dictationsAttempted} different dictations`],
    ['Average error', formatPct(s.avgErrorPct), 'across all attempts'],
    ['Best error', formatPct(s.bestErrorPct)],
    ['Streak', `${s.streakDays} day${s.streakDays === 1 ? '' : 's'}`, 'practising in a row'],
    ['Last 7 days', String(s.last7Days.attempts), s.last7Days.avgErrorPct === null ? undefined : `${formatPct(s.last7Days.avgErrorPct)} avg error`],
  ]

  return (
    <div className="stack-lg">
      <div className="page-header">
        <h1>Dashboard</h1>
        <p className="muted">How your accuracy is trending, and what to work on next.</p>
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
        {tiles.map(([label, value, sub]) => (
          <div key={label} className="card" style={{ padding: 16 }}>
            <div className="muted small">{label}</div>
            <div style={{ fontFamily: 'var(--font-head)', fontWeight: 800, fontSize: '1.7rem' }}>{value}</div>
            {sub && <div className="muted small">{sub}</div>}
          </div>
        ))}
      </div>

      <section className="card stack">
        <h2>Error % over the last 30 days</h2>
        <p className="muted small">Lower is better. Each point is the average of that day&apos;s attempts.</p>
        {trendQ.isPending ? <Spinner /> : trendQ.data && trendQ.data.length > 0 ? <TrendChart points={trendQ.data} /> : <p className="muted">No attempts in the last 30 days.</p>}
      </section>

      <div className="listen-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
        <section className="card stack">
          <div className="spread">
            <h2>What you get wrong (90 days)</h2>
            <Link to="/mistakes" className="small">See every mistake →</Link>
          </div>
          {mistakesQ.isPending ? <Spinner /> : mistakes.length === 0 ? <p className="muted">No mistakes recorded. Nice.</p> : mistakes.map((m) => {
            const full = m.weight === 1
            return (
              <div key={m.kind} className="bar-row" title={KINDS[m.kind].hint}>
                <span>{KINDS[m.kind].label}</span>
                <div className="bar-track"><span style={{ width: `${(m.count / maxMistake) * 100}%`, background: full ? '#f43f5e' : '#f59e0b' }} /></div>
                <b>{m.count}</b>
              </div>
            )
          })}
        </section>

        <section className="card stack">
          <h2>Your weak words</h2>
          <p className="muted small">Words you miss most often, weighted by how costly the mistake was.</p>
          {weakQ.isPending ? <Spinner /> : (weakQ.data ?? []).length === 0 ? <p className="muted">Nothing yet.</p> : (
            <div className="row" style={{ gap: 8 }}>
              {(weakQ.data ?? []).map((w) => (
                <span key={w.word} className={`badge ${w.weightedMisses >= 3 ? 'badge-full' : 'badge-half'}`} style={{ fontSize: '0.9rem', padding: '4px 12px' }} title={`${w.misses} time${w.misses === 1 ? '' : 's'}`}>
                  {w.word} · {w.misses}
                </span>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
