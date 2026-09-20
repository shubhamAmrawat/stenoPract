import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, Navigate, useParams } from 'react-router'
import { DiffLegend, DiffView } from '../components/DiffView'
import { ReportModal } from '../components/ReportModal'
import { ErrorState, Spinner } from '../components/ui'
import { api } from '../lib/api'
import { formatDate, formatDuration, formatPct } from '../lib/format'
import { KIND_ORDER, KINDS } from '../lib/mistakes'
import type { Attempt, Dictation, DiffOp } from '../lib/types'

type Tab = 'marked' | 'mistakes' | 'compare'

export function AnalysisPage() {
  const { id = '' } = useParams()
  const [tab, setTab] = useState<Tab>('marked')
  const [report, setReport] = useState<{ word?: string; wordIndex?: number } | null>(null)

  const q = useQuery({ queryKey: ['attempt', id], queryFn: () => api<{ attempt: Attempt }>(`/attempts/${id}`).then((r) => r.attempt) })
  const dictationId = q.data?.dictationId
  const dictQ = useQuery({
    queryKey: ['dictation', dictationId],
    enabled: !!dictationId,
    queryFn: () => api<{ dictation: Dictation }>(`/dictations/${dictationId}`).then((r) => r.dictation),
  })

  if (q.isPending) return <Spinner full />
  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />
  const a = q.data
  if (a.status === 'draft') return <Navigate to={`/attempts/${id}/write`} replace />
  const r = a.result
  if (!r) return <ErrorState error={new Error('This attempt has no result yet.')} />

  const accuracy = r.accuracyPct ?? Math.max(0, 100 - r.errorPct)
  const verdictColor = r.passed === false ? 'var(--full-ink)' : 'var(--ok-ink)'
  const ringColor = r.passed === false ? '#e11d48' : '#10b981'
  const maxCount = Math.max(1, ...Object.values(r.breakdown).map((n) => n ?? 0))

  const pickWord = (index: number, op: DiffOp) => {
    const m = a.mistakes?.find((x) => x.pos === index)
    setReport({ word: op.m ?? op.a, wordIndex: m?.masterIndex })
  }

  return (
    <div className="stack-lg">
      <div className="page-header">
        <Link to="/history" className="small">← All attempts</Link>
        <h1>{dictQ.data?.title ?? 'Your result'}</h1>
        <p className="muted">
          {a.examProfile.replace('_', ' ')} · {a.category} · submitted {formatDate(a.submittedAt)}
          {a.autoSubmitted && ' (auto-submitted when time ran out)'}
        </p>
      </div>

      <section className="card">
        <div className="result-hero">
          <div className="ring" style={{ background: `conic-gradient(${ringColor} ${accuracy * 3.6}deg, var(--tint) 0)` }} role="img" aria-label={`Accuracy ${formatPct(accuracy)}`}>
            <div>
              <div className="big" style={{ color: verdictColor }}>{formatPct(r.errorPct)}</div>
              <div className="muted small">error</div>
            </div>
          </div>
          <div className="stack">
            <div className="row">
              {r.passed === null ? null : r.passed ? (
                <span className="banner pass">✓ Within the limit</span>
              ) : (
                <span className="banner fail">Above the limit</span>
              )}
              {r.limitPct !== null && <span className="muted">Allowed: {formatPct(r.limitPct)} error ({a.category})</span>}
            </div>
            <div className="stat-grid">
              <div className="stat"><b>{r.full}</b><span className="muted small">Full mistakes</span></div>
              <div className="stat"><b>{r.half}</b><span className="muted small">Half mistakes</span></div>
              <div className="stat"><b>{r.masterWords}</b><span className="muted small">Words dictated</span></div>
              <div className="stat"><b>{r.attemptWords}</b><span className="muted small">Words you typed</span></div>
              <div className="stat"><b>{formatDuration(a.timeTakenSec)}</b><span className="muted small">Time taken{a.overtimeSec ? ` (+${a.overtimeSec}s over)` : ''}</span></div>
            </div>
            <div className="muted small">Error % = (full mistakes + half mistakes ÷ 2) ÷ words dictated × 100</div>
          </div>
        </div>
      </section>

      <section className="card stack">
        <div className="tabs" role="tablist">
          {([['marked', 'Marked-up text'], ['mistakes', 'Mistakes'], ['compare', 'Side by side']] as const).map(([k, label]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{label}</button>
          ))}
        </div>

        {tab === 'marked' && (
          <div className="stack">
            <DiffLegend />
            <DiffView ops={r.diff} onPick={pickWord} />
            <p className="muted small">Tap a highlighted word for details. If you think the dictation text itself is wrong there, use the report button that opens.</p>
          </div>
        )}

        {tab === 'mistakes' && (
          <div className="stack-lg">
            <div className="stack">
              {KIND_ORDER.filter((k) => (r.breakdown[k] ?? 0) > 0).map((k) => {
                const n = r.breakdown[k] ?? 0
                const full = KINDS[k].weight === 1
                return (
                  <div key={k} className="bar-row" title={KINDS[k].hint}>
                    <span>{KINDS[k].label} <span className={`badge ${full ? 'badge-full' : 'badge-half'}`}>{full ? 'full' : 'half'}</span></span>
                    <div className="bar-track"><span style={{ width: `${(n / maxCount) * 100}%`, background: full ? '#f43f5e' : '#f59e0b' }} /></div>
                    <b>{n}</b>
                  </div>
                )
              })}
              {r.full + r.half === 0 && <div className="alert alert-info">No mistakes. Perfect transcription!</div>}
            </div>

            {(a.mistakes?.length ?? 0) > 0 && (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>#</th><th>Type</th><th>Dictation</th><th>You typed</th><th>Counts as</th></tr></thead>
                  <tbody>
                    {a.mistakes!.map((m, i) => (
                      <tr key={i}>
                        <td className="muted">{i + 1}</td>
                        <td>{KINDS[m.kind].label}</td>
                        <td>{m.master ?? <span className="muted">—</span>}</td>
                        <td>{m.attempt ?? <span className="muted">(nothing)</span>}</td>
                        <td><span className={`badge ${m.weight === 1 ? 'badge-full' : 'badge-half'}`}>{m.weight === 1 ? 'Full' : 'Half'}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {tab === 'compare' && (
          <div className="listen-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
            <div className="stack">
              <h3>What you typed</h3>
              <p style={{ whiteSpace: 'pre-wrap', lineHeight: 1.8 }}>{a.typedText || <span className="muted">(nothing typed)</span>}</p>
            </div>
            <div className="stack">
              <h3>The dictation</h3>
              <p style={{ whiteSpace: 'pre-wrap', lineHeight: 1.8 }}>{a.masterText}</p>
            </div>
          </div>
        )}
      </section>

      <div className="row">
        <Link className="btn btn-accent" to={`/d/${a.dictationId}`}>Practise this dictation again</Link>
        <Link className="btn btn-ghost" to="/">Back to home</Link>
        <button className="btn btn-ghost" onClick={() => setReport({})}>Report a transcript problem</button>
      </div>

      {report && <ReportModal dictationId={a.dictationId} attemptId={a.id} word={report.word} wordIndex={report.wordIndex} onClose={() => setReport(null)} />}
    </div>
  )
}
