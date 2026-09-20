import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router'
import { Empty, ErrorState, Spinner } from '../components/ui'
import { api, errorMessage } from '../lib/api'
import { formatDate } from '../lib/format'
import type { AdminReport } from './types'

type Status = 'open' | 'resolved' | 'rejected'

export function ReportsPage() {
  const [status, setStatus] = useState<Status>('open')
  const q = useQuery({
    queryKey: ['admin', 'reports', status],
    queryFn: () => api<{ total: number; items: AdminReport[] }>(`/admin/reports?status=${status}`),
  })

  return (
    <div className="stack">
      <div className="segmented" role="group" aria-label="Report status">
        {(['open', 'resolved', 'rejected'] as Status[]).map((s) => (
          <button key={s} aria-pressed={status === s} onClick={() => setStatus(s)}>{s[0]!.toUpperCase() + s.slice(1)}</button>
        ))}
      </div>
      {q.isPending ? <Spinner full /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : q.data.items.length === 0 ? (
        <Empty title={status === 'open' ? 'Inbox zero' : 'Nothing here'}>{status === 'open' ? 'Students have not reported anything.' : undefined}</Empty>
      ) : (
        q.data.items.map((r) => <ReportCard key={r.id} report={r} />)
      )}
    </div>
  )
}

function ReportCard({ report }: { report: AdminReport }) {
  const qc = useQueryClient()
  const [note, setNote] = useState(report.resolutionNote ?? '')
  const set = useMutation({
    mutationFn: (status: Status) => api(`/admin/reports/${report.id}`, { method: 'PATCH', body: { status, resolutionNote: note.trim() || undefined } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin'] }),
  })
  return (
    <div className="card stack">
      <div className="spread">
        <div className="row">
          <span className={`badge ${report.type === 'video_issue' ? 'badge-add' : 'badge-half'}`}>{report.type === 'video_issue' ? 'Video' : 'Transcript'}</span>
          {report.word && <span className="badge badge-info">word: {report.word}{report.wordIndex != null ? ` (#${report.wordIndex + 1})` : ''}</span>}
          {report.textVersion != null && <span className="badge badge-muted">v{report.textVersion}</span>}
        </div>
        <span className="muted small">{formatDate(report.createdAt)} · {report.user?.name ?? report.user?.email ?? 'unknown'}</span>
      </div>
      <p>{report.message}</p>
      {report.dictation && <Link to={`/admin/d/${report.dictation.id}`} className="small">Open {report.dictation.title ?? `Exercise ${report.dictation.exerciseNo}`} →</Link>}
      <div className="row">
        <input className="input grow" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" aria-label="Resolution note" />
        {report.status !== 'resolved' && <button className="btn btn-primary btn-sm" disabled={set.isPending} onClick={() => set.mutate('resolved')}>Resolve</button>}
        {report.status !== 'rejected' && <button className="btn btn-ghost btn-sm" disabled={set.isPending} onClick={() => set.mutate('rejected')}>Reject</button>}
        {report.status !== 'open' && <button className="btn btn-ghost btn-sm" disabled={set.isPending} onClick={() => set.mutate('open')}>Reopen</button>}
      </div>
      {set.error && <div className="alert alert-error">{errorMessage(set.error)}</div>}
    </div>
  )
}
