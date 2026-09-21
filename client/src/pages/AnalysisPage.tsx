import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type CSSProperties } from 'react'
import { Link, Navigate, useParams } from 'react-router'
import { useAuth } from '../auth/AuthContext'
import { DiffLegend, DiffView } from '../components/DiffView'
import { MistakeFilter } from '../components/MistakeFilter'
import { ReportModal } from '../components/ReportModal'
import { SideBySide } from '../components/SideBySide'
import { StandingCard } from '../components/StandingCard'
import { ErrorState, Spinner } from '../components/ui'
import { api, errorMessage } from '../lib/api'
import { downloadCsv, fileSlug } from '../lib/download'
import { formatDate, formatDuration, formatPct } from '../lib/format'
import { countByGroup, GROUP_OF_KIND, GROUPS, KIND_ORDER, KINDS, type MistakeGroup } from '../lib/mistakes'
import type { Attempt, Dictation, DiffOp } from '../lib/types'

type Tab = 'marked' | 'mistakes' | 'compare'

interface ReevaluateResponse {
  attempt: Attempt
  changed: boolean
  before: number | null
  after: number
}

export function AnalysisPage() {
  const { id = '' } = useParams()
  const { user } = useAuth()
  const qc = useQueryClient()
  const [tab, setTab] = useState<Tab>('marked')
  const [group, setGroup] = useState<MistakeGroup | null>(null)
  const [report, setReport] = useState<{ word?: string; wordIndex?: number } | null>(null)
  const [reevalNote, setReevalNote] = useState<string | null>(null)

  const q = useQuery({ queryKey: ['attempt', id], queryFn: () => api<{ attempt: Attempt }>(`/attempts/${id}`).then((r) => r.attempt) })
  const dictationId = q.data?.dictationId
  const dictQ = useQuery({
    queryKey: ['dictation', dictationId],
    enabled: !!dictationId,
    queryFn: () => api<{ dictation: Dictation }>(`/dictations/${dictationId}`).then((r) => r.dictation),
  })

  const reevaluate = useMutation({
    mutationFn: () => api<ReevaluateResponse>(`/attempts/${id}/reevaluate`, { method: 'POST' }),
    onSuccess: (r) => {
      qc.setQueryData(['attempt', id], r.attempt)
      setGroup(null)
      setReevalNote(
        r.changed
          ? `Checked again against the latest dictation text: error changed from ${formatPct(r.before)} to ${formatPct(r.after)}.`
          : 'Already up to date: this analysis matches the current dictation text.',
      )
      if (r.changed) {
        void qc.invalidateQueries({ queryKey: ['standing'] })
        void qc.invalidateQueries({ queryKey: ['analytics'] })
        void qc.invalidateQueries({ queryKey: ['attempts'] })
        void qc.invalidateQueries({ queryKey: ['progress'] })
      }
    },
  })

  if (q.isPending) return <Spinner full />
  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />
  const a = q.data
  if (a.status === 'draft') return <Navigate to={`/attempts/${id}/write`} replace />
  const r = a.result
  if (!r) return <ErrorState error={new Error('This attempt has no result yet.')} />

  const title = dictQ.data?.title ?? 'Your result'
  const accuracy = r.accuracyPct ?? Math.max(0, 100 - r.errorPct)
  // A perfect attempt has no mistakes, so guard against a missing breakdown.
  const breakdown = r.breakdown ?? {}
  const maxCount = Math.max(1, ...Object.values(breakdown).map((n) => n ?? 0))
  const counts = countByGroup(breakdown)
  const allMistakes = a.mistakes ?? []
  const shownMistakes = group ? allMistakes.filter((m) => GROUP_OF_KIND[m.kind] === group) : allMistakes

  const pickWord = (index: number, op: DiffOp) => {
    const m = a.mistakes?.find((x) => x.pos === index)
    setReport({ word: op.m ?? op.a, wordIndex: m?.masterIndex })
  }

  const csv = (rows: typeof allMistakes, label: string) => {
    downloadCsv(`mistakes-${fileSlug(title)}-${label}.csv`, [
      ['#', 'Type', 'Group', 'Counts as', 'Dictation', 'You typed'],
      ...rows.map((m, i) => [i + 1, KINDS[m.kind].label, GROUPS[GROUP_OF_KIND[m.kind]].label, m.weight === 1 ? 'Full' : 'Half', m.master ?? '', m.attempt ?? '']),
    ])
  }

  const printResult = () => {
    // Browsers name the saved PDF after the page title.
    const before = document.title
    document.title = `Result - ${title} - ${fileSlug(formatDate(a.submittedAt))}`
    try { window.print() } finally { document.title = before }
  }

  return (
    <div className="stack-lg result-page">
      <div className="print-only print-head">
        <b>StenoSeekho</b> · Dictation result{user ? ` · ${user.name}` : ''}
      </div>

      <div className="page-header">
        <Link to="/history" className="small no-print">← All attempts</Link>
        <h1>{title}</h1>
        <p className="muted">
          {a.examProfile.replace('_', ' ')} · submitted {formatDate(a.submittedAt)}
          {a.autoSubmitted && ' (auto-submitted when time ran out)'}
        </p>
      </div>

      <section className="card">
        <div className="result-hero">
          <div className="rings">
            <Ring value={accuracy} color="var(--primary)" label="accuracy" text={formatPct(accuracy)} />
            <Ring value={Math.min(100, r.errorPct)} color="#e11d48" label="error rate" text={formatPct(r.errorPct)} />
          </div>
          <div className="stack">
            <div className="stat-tiles">
              <Tile tone="#e11d48" value={r.full} label="Full mistakes" />
              <Tile tone="#d97706" value={r.half} label="Half mistakes" />
              <Tile tone="#2563eb" value={r.masterWords} label="Words dictated" />
              <Tile tone="#0d9488" value={r.attemptWords} label="Words you typed" />
              <Tile tone="#7c3aed" value={formatDuration(a.timeTakenSec)} label={`Time taken${a.overtimeSec ? ` (+${a.overtimeSec}s over)` : ''}`} />
            </div>
            <div className="muted small">Error rate = (full mistakes + half mistakes ÷ 2) ÷ words dictated × 100. Accuracy = 100 − error rate.</div>
          </div>
        </div>
      </section>

      <StandingCard attemptId={a.id} />

      <div className="row no-print result-actions">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setReevalNote(null); reevaluate.mutate() }} disabled={reevaluate.isPending}
          title="Check your typed text again against the current dictation text and rules">
          {reevaluate.isPending ? 'Checking…' : 'Re-evaluate'}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={printResult} title="Opens the print window: choose “Save as PDF”">Download result (PDF)</button>
        <button type="button" className="btn btn-ghost btn-sm" disabled={shownMistakes.length === 0}
          onClick={() => csv(shownMistakes, group ?? 'all')}>
          {group ? `Download ${GROUPS[group].short} (CSV)` : 'Download mistakes (CSV)'}
        </button>
      </div>
      {reevaluate.error && <div className="alert alert-error no-print" role="alert">{errorMessage(reevaluate.error)}</div>}
      {reevalNote && <div className="alert alert-info no-print" role="status">{reevalNote}</div>}

      <section className="card stack no-print">
        <div className="tabs" role="tablist">
          {([['marked', 'Marked-up text'], ['mistakes', 'Mistakes'], ['compare', 'Side by side']] as const).map(([k, label]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{label}</button>
          ))}
        </div>

        {tab !== 'compare' && <MistakeFilter counts={counts} value={group} onChange={setGroup} />}

        {tab === 'marked' && (
          <div className="stack">
            <DiffLegend />
            <DiffView ops={r.diff} onPick={pickWord} only={group} />
            <p className="muted small">Tap a highlighted word for details. If you think the dictation text itself is wrong there, use the report button that opens.</p>
          </div>
        )}

        {tab === 'mistakes' && (
          <div className="stack-lg">
            <div className="stack">
              {KIND_ORDER.filter((k) => (breakdown[k] ?? 0) > 0).map((k) => {
                const n = breakdown[k] ?? 0
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

            {shownMistakes.length > 0 && <MistakeTable rows={shownMistakes} />}
          </div>
        )}

        {tab === 'compare' && <SideBySide ops={r.diff} typedText={a.typedText} masterText={a.masterText ?? ''} onReport={pickWord} />}
      </section>

      {/* Only shown when printing / saving as PDF: the marked-up text and the full list, whichever tab is open on screen. */}
      <section className="print-only stack">
        <h2>Marked-up text</h2>
        <DiffLegend />
        <DiffView ops={r.diff} />
        {allMistakes.length > 0 && (
          <>
            <h2>Mistakes ({allMistakes.length})</h2>
            <MistakeTable rows={allMistakes} />
          </>
        )}
      </section>

      <div className="row no-print">
        <Link className="btn btn-accent" to={`/d/${a.dictationId}`}>Practise this dictation again</Link>
        <Link className="btn btn-ghost" to="/mistakes">My mistakes</Link>
        <Link className="btn btn-ghost" to="/">Back to home</Link>
        <button className="btn btn-ghost" onClick={() => setReport({})}>Report a transcript problem</button>
      </div>

      {report && <ReportModal dictationId={a.dictationId} attemptId={a.id} word={report.word} wordIndex={report.wordIndex} onClose={() => setReport(null)} />}
    </div>
  )
}

function Ring({ value, color, label, text }: { value: number; color: string; label: string; text: string }) {
  const deg = Math.max(0, Math.min(100, value)) * 3.6
  return (
    <div className="ring ring-sm" style={{ background: `conic-gradient(${color} ${deg}deg, var(--tint) 0)` }} role="img" aria-label={`${label} ${text}`}>
      <div>
        <div className="big" style={{ color }}>{text}</div>
        <div className="muted small">{label}</div>
      </div>
    </div>
  )
}

function Tile({ tone, value, label }: { tone: string; value: string | number; label: string }) {
  return (
    <div className="stat-tile" style={{ '--tone': tone } as CSSProperties}>
      <b>{value}</b>
      <span className="muted small">{label}</span>
    </div>
  )
}

function MistakeTable({ rows }: { rows: NonNullable<Attempt['mistakes']> }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead><tr><th>#</th><th>Type</th><th>Dictation</th><th>You typed</th><th>Counts as</th></tr></thead>
        <tbody>
          {rows.map((m, i) => (
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
  )
}
