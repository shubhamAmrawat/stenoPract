import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router'
import { MistakeFilter } from '../components/MistakeFilter'
import { Empty, ErrorState, Spinner } from '../components/ui'
import { api, errorMessage, qs } from '../lib/api'
import { downloadCsv } from '../lib/download'
import { formatDate } from '../lib/format'
import { GROUP_ORDER, GROUPS, KINDS, type MistakeGroup } from '../lib/mistakes'
import type { MistakeKind } from '../lib/types'

interface Row {
  kind: MistakeKind
  group: MistakeGroup | null
  master: string | null
  attempt: string | null
  count: number
  lastAt: string
}
interface Response {
  groups: { group: MistakeGroup; count: number }[]
  total: number
  items: Row[]
  totalItems: number
  page: number
  limit: number
}

const PAGE = 25

export function MyMistakesPage() {
  const [group, setGroup] = useState<MistakeGroup | null>(null)
  const [page, setPage] = useState(1)
  const [busy, setBusy] = useState(false)
  const [downloadError, setDownloadError] = useState<string | null>(null)

  const q = useQuery({
    queryKey: ['analytics', 'my-mistakes', group, page],
    queryFn: () => api<Response>(`/analytics/my-mistakes${qs({ group, page, limit: PAGE })}`),
    placeholderData: keepPreviousData,
  })

  const choose = (g: MistakeGroup | null) => { setGroup(g); setPage(1) }

  // The CSV is every row for the chosen kind, not just the page on screen.
  const download = async () => {
    setBusy(true)
    setDownloadError(null)
    try {
      const rows: Row[] = []
      for (let p = 1; p <= 20; p++) {
        const r = await api<Response>(`/analytics/my-mistakes${qs({ group, page: p, limit: 500 })}`)
        rows.push(...r.items)
        if (rows.length >= r.totalItems || r.items.length === 0) break
      }
      downloadCsv(`my-mistakes-${group ?? 'all'}.csv`, [
        ['Type', 'Group', 'Dictation', 'You typed', 'Times', 'Last time'],
        ...rows.map((m) => [KINDS[m.kind]?.label ?? m.kind, m.group ? GROUPS[m.group].label : '', m.master ?? '', m.attempt ?? '', m.count, m.lastAt]),
      ])
    } catch (err) {
      setDownloadError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  if (q.isPending) return <Spinner full />
  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />
  const d = q.data

  if (d.total === 0) {
    return (
      <div className="stack-lg">
        <div className="page-header"><h1>My mistakes</h1></div>
        <Empty title="No mistakes recorded yet">
          <p>Submit a dictation and every mistake will be collected here, grouped by kind, so you can see what to work on.</p>
          <p style={{ marginTop: 12 }}><Link className="btn btn-primary" to="/">Go to practice</Link></p>
        </Empty>
      </div>
    )
  }

  const counts = Object.fromEntries(GROUP_ORDER.map((g) => [g, d.groups.find((x) => x.group === g)?.count ?? 0])) as Record<MistakeGroup, number>
  const pages = Math.max(1, Math.ceil(d.totalItems / PAGE))

  return (
    <div className="stack-lg">
      <div className="page-header">
        <h1>My mistakes</h1>
        <p className="muted">Every mistake from your submitted attempts, grouped by kind. The ones you repeat most come first. Attempts where you typed less than half of the dictation are left out.</p>
      </div>

      <section className="card stack">
        <MistakeFilter counts={counts} value={group} onChange={choose} />
        {group === 'spelling' && (
          <p className="muted small">This is your spelling notebook: the dictated spelling on the left, and what you typed on the right.</p>
        )}
        {group && <p className="muted small">{GROUPS[group].hint}</p>}

        {d.items.length === 0 ? (
          <p className="muted">Nothing in this group.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Dictation</th><th>You typed</th><th>Type</th><th>Times</th><th>Last time</th></tr></thead>
              <tbody>
                {d.items.map((m, i) => (
                  <tr key={`${m.kind}-${m.master}-${m.attempt}-${i}`}>
                    <td><b>{m.master ?? <span className="muted">—</span>}</b></td>
                    <td>{m.attempt ?? <span className="muted">(nothing)</span>}</td>
                    <td>
                      <span className={`badge ${KINDS[m.kind]?.weight === 1 ? 'badge-full' : 'badge-half'}`}>{KINDS[m.kind]?.label ?? m.kind}</span>
                    </td>
                    <td><b>{m.count}</b></td>
                    <td className="muted small">{formatDate(m.lastAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="spread">
          <div className="row">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void download()} disabled={busy || d.totalItems === 0}>
              {busy ? 'Preparing…' : group ? `Download ${GROUPS[group].short} (CSV)` : 'Download all (CSV)'}
            </button>
            {downloadError && <span className="small" style={{ color: 'var(--full-ink)' }} role="alert">{downloadError}</span>}
          </div>
          {d.totalItems > PAGE && (
            <div className="row">
              <button className="btn btn-ghost btn-sm" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>← Previous</button>
              <span className="muted small">Page {page} of {pages}</span>
              <button className="btn btn-ghost btn-sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next →</button>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
