import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router'
import { Empty, ErrorState, Spinner } from '../components/ui'
import { api } from '../lib/api'
import { downloadUrl, RESOURCE_GROUPS } from '../lib/resources'
import type { ResourceGroupKey, ResourceItem } from '../lib/types'

export function ResourcesPage() {
  const { group = '' } = useParams()
  const meta = RESOURCE_GROUPS[group as ResourceGroupKey]
  const q = useQuery({
    queryKey: ['resources', group],
    enabled: !!meta,
    queryFn: () => api<{ items: ResourceItem[] }>(`/resources/${group}`).then((r) => r.items),
  })

  if (!meta) {
    return (
      <Empty title="We could not find that page">
        <p><Link to="/">Back to the home page</Link></p>
      </Empty>
    )
  }

  return (
    <div className="stack-lg">
      <div className="set-head">
        <Link to="/" className="small">← Home</Link>
        <h1>{meta.title}</h1>
        <p className="muted">{meta.blurb}</p>
      </div>

      {q.isPending ? <Spinner /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : q.data.length === 0 ? (
        <Empty title="Nothing here yet"><p>Files are being added. Please check back soon.</p></Empty>
      ) : (
        <div className="file-grid">
          {q.data.map((r) => (
            <article key={r.id} className="file-card">
              <span className="file-badge" aria-hidden="true">PDF</span>
              <h3>{r.title}</h3>
              <div className="row" style={{ gap: 8 }}>
                <a className="btn btn-primary btn-sm" href={r.url} target="_blank" rel="noopener noreferrer">View</a>
                <a className="btn btn-ghost btn-sm" href={downloadUrl(r.url)} download target="_blank" rel="noopener noreferrer">Download</a>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  )
}
