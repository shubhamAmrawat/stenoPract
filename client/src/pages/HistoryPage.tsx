import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router'
import { Empty, ErrorState, Spinner } from '../components/ui'
import { api, qs } from '../lib/api'
import { formatDate, formatDuration, formatPct } from '../lib/format'
import type { AttemptSummary, Paged } from '../lib/types'

export function HistoryPage() {
  const [page, setPage] = useState(1)
  const { data, isPending, error, refetch } = useQuery({
    queryKey: ['attempts', 'history', page],
    queryFn: () => api<Paged<AttemptSummary>>(`/attempts${qs({ page, limit: 15 })}`),
    placeholderData: keepPreviousData,
  })

  return (
    <div className="stack-lg">
      <div className="page-header">
        <h1>Your attempts</h1>
        <p className="muted">Every dictation you have submitted, newest first.</p>
      </div>

      {isPending ? (
        <Spinner />
      ) : error ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : data.items.length === 0 ? (
        <Empty title="No attempts yet">
          <p>Pick a dictation from a <Link to="/">book on the home page</Link> and give it a go.</p>
        </Empty>
      ) : (
        <div className="card table-wrap" style={{ padding: 8 }}>
          <table className="table">
            <thead>
              <tr>
                <th>Dictation</th>
                <th>Submitted</th>
                <th>Error</th>
                <th>Full / Half</th>
                <th>Time</th>
                <th>Result</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.items.map((a) => (
                <tr key={a.id}>
                  <td>
                    <b>{a.dictationTitle ?? 'Dictation'}</b>
                    <div className="muted small">{a.examProfile.replace('_', ' ')} · {a.category}</div>
                  </td>
                  <td>{formatDate(a.submittedAt)}</td>
                  <td><b>{formatPct(a.errorPct)}</b></td>
                  <td>{a.full ?? '—'} / {a.half ?? '—'}</td>
                  <td>{formatDuration(a.timeTakenSec)}</td>
                  <td>
                    {a.passed === null ? <span className="badge badge-muted">—</span> : a.passed ? <span className="badge badge-ok">Passed</span> : <span className="badge badge-full">Above limit</span>}
                  </td>
                  <td><Link to={`/attempts/${a.id}`}>Analysis →</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data && data.total > data.limit && (
        <div className="row" style={{ justifyContent: 'center' }}>
          <button className="btn btn-ghost btn-sm" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>← Newer</button>
          <span className="muted small">Page {page} of {Math.ceil(data.total / data.limit)}</span>
          <button className="btn btn-ghost btn-sm" disabled={page * data.limit >= data.total} onClick={() => setPage((p) => p + 1)}>Older →</button>
        </div>
      )}
    </div>
  )
}
