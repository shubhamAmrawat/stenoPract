import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router'
import { Empty, ErrorState, Spinner } from '../components/ui'
import { api, ApiError } from '../lib/api'
import { formatBytes } from '../lib/format'
import { downloadUrl, saveFile } from '../lib/resources'
import type { ResourceGroup, ResourceItem } from '../lib/types'

export function ResourcesPage() {
  const { group = '' } = useParams()
  const q = useQuery({
    queryKey: ['resources', group],
    queryFn: () => api<{ group: ResourceGroup; items: ResourceItem[] }>(`/resources/${encodeURIComponent(group)}`),
    retry: (count, err) => !(err instanceof ApiError && err.status === 404) && count < 2,
  })

  if (q.isPending) return <Spinner full />
  if (q.error instanceof ApiError && q.error.status === 404) {
    return (
      <Empty title="We could not find that page">
        <p><Link to="/">Back to the home page</Link></p>
      </Empty>
    )
  }
  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />
  const { group: meta, items } = q.data

  return (
    <div className="stack-lg">
      <div className="set-head">
        <Link to="/" className="small">← Home</Link>
        <h1>{meta.title}</h1>
        {meta.blurb && <p className="muted">{meta.blurb}</p>}
      </div>

      {items.length === 0 ? (
        <Empty title="Nothing here yet"><p>Files are being added. Please check back soon.</p></Empty>
      ) : (
        <div className="file-grid">
          {items.map((r) => (
            <article key={r.id} className="file-card">
              <span className="file-badge" aria-hidden="true">PDF</span>
              <h3>{r.title}</h3>
              {r.size !== null && <span className="muted small">{formatBytes(r.size)}</span>}
              <div className="row" style={{ gap: 8 }}>
                <a className="btn btn-primary btn-sm" href={r.url} target="_blank" rel="noopener noreferrer">View</a>
                {r.uploaded ? (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => void saveFile(r.url, r.title)}>Download</button>
                ) : (
                  <a className="btn btn-ghost btn-sm" href={downloadUrl(r.url)} download target="_blank" rel="noopener noreferrer">Download</a>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  )
}
