import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router'
import { FolderMenu } from '../components/FolderMenu'
import { Empty, ErrorState, Spinner, StarIcon } from '../components/ui'
import { api, qs } from '../lib/api'
import { formatPct } from '../lib/format'
import { useFolders, useSetDictationState } from '../lib/hooks'
import type { Dictation, DictationSet, Paged } from '../lib/types'

type Filter = 'all' | 'unseen' | 'favourite'

function DictationCard({ d }: { d: Dictation }) {
  const setState = useSetDictationState(d.id)
  const speeds = [...new Set(d.videos.map((v) => v.baseWpm))].sort((a, b) => a - b)
  const s = d.state

  return (
    <article className={`card dict-card ${d.ready ? '' : 'disabled'}`}>
      <div className="spread" style={{ alignItems: 'flex-start' }}>
        <div>
          <div className="muted small">Exercise</div>
          <div className="dict-no">{d.exerciseNo}</div>
        </div>
        <div className="row" style={{ gap: 6 }}>
          <button className={`icon-btn ${s.favourite ? 'on' : ''}`} aria-pressed={s.favourite} aria-label={s.favourite ? 'Remove from favourites' : 'Add to favourites'} title="Favourite" onClick={() => setState.mutate({ favourite: !s.favourite })}>
            <StarIcon filled={s.favourite} />
          </button>
          <FolderMenu dictationId={d.id} folderIds={s.folderIds} />
        </div>
      </div>

      <div className="row" style={{ gap: 6 }}>
        {speeds.map((w) => <span key={w} className="badge badge-info">{w} wpm</span>)}
        {d.masterWordCount > 0 && <span className="badge badge-muted">{d.masterWordCount} words</span>}
        {s.seen && <span className="badge badge-ok">Seen</span>}
      </div>

      <div className="muted small">
        {s.attemptsCount > 0 ? <>Best error <b style={{ color: 'var(--ink)' }}>{formatPct(s.bestErrorPct)}</b> · {s.attemptsCount} attempt{s.attemptsCount === 1 ? '' : 's'}</> : 'Not attempted yet'}
      </div>

      {d.ready ? (
        <Link className="btn btn-primary" to={`/d/${d.id}`}>{s.attemptsCount > 0 ? 'Practise again' : 'Start'}</Link>
      ) : (
        <button className="btn btn-ghost" disabled>Coming soon</button>
      )}
    </article>
  )
}

export function SetPage() {
  const { slug = '' } = useParams()
  const setsQ = useQuery({ queryKey: ['sets'], queryFn: () => api<{ items: DictationSet[] }>('/sets').then((r) => r.items) })
  const { data: folders } = useFolders()

  const [filter, setFilter] = useState<Filter>('all')
  const [folderId, setFolderId] = useState('')
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')

  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 300)
    return () => clearTimeout(t)
  }, [search])

  const activeSet = setsQ.data?.find((x) => x.slug === slug)
  const activeSetId = activeSet?.id ?? null
  const params = useMemo(
    () => ({ setId: activeSetId ?? undefined, q, folderId, seen: filter === 'unseen' ? 'false' : undefined, favourite: filter === 'favourite' ? 'true' : undefined }),
    [activeSetId, q, folderId, filter],
  )

  const dictQ = useInfiniteQuery({
    queryKey: ['dictations', params],
    enabled: activeSetId !== null,
    initialPageParam: 1,
    queryFn: ({ pageParam }) => api<Paged<Dictation>>(`/dictations${qs({ ...params, page: pageParam, limit: 24 })}`),
    getNextPageParam: (last) => (last.page * last.limit < last.total ? last.page + 1 : undefined),
  })

  if (setsQ.isPending) return <Spinner full />
  if (setsQ.error) return <ErrorState error={setsQ.error} onRetry={() => void setsQ.refetch()} />

  const items = dictQ.data?.pages.flatMap((p) => p.items) ?? []

  if (!activeSet) {
    return (
      <Empty title="We could not find that book">
        <p><Link to="/">Back to the home page</Link></p>
      </Empty>
    )
  }
  const pct = activeSet.dictationCount ? Math.round((activeSet.attemptedCount / activeSet.dictationCount) * 100) : 0

  return (
    <div className="stack-lg">
      <div className="set-head">
        <Link to="/" className="small">← Home</Link>
        <h1>{activeSet.title}</h1>
        {activeSet.source && <p className="muted">{activeSet.source}</p>}
        <div className="set-progress">
          <div className="progress" aria-hidden="true"><span style={{ width: `${pct}%` }} /></div>
          <span className="muted small">{activeSet.attemptedCount} of {activeSet.dictationCount} attempted · {activeSet.readyCount} ready</span>
        </div>
      </div>

      <>
          <div className="filters">
            {(['all', 'unseen', 'favourite'] as const).map((f) => (
              <button key={f} className="chip" aria-pressed={filter === f} onClick={() => setFilter(f)}>
                {f === 'all' ? 'All' : f === 'unseen' ? 'Not seen yet' : '★ Favourites'}
              </button>
            ))}
            <select className="select" style={{ width: 'auto' }} value={folderId} onChange={(e) => setFolderId(e.target.value)} aria-label="Filter by folder">
              <option value="">All folders</option>
              {(folders ?? []).map((f) => <option key={f.id} value={f.id}>{f.name} ({f.count})</option>)}
            </select>
            <input className="input search" type="search" placeholder="Search exercise…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search dictations" />
          </div>

          {dictQ.isPending ? (
            <Spinner />
          ) : dictQ.error ? (
            <ErrorState error={dictQ.error} onRetry={() => void dictQ.refetch()} />
          ) : items.length === 0 ? (
            <Empty title="Nothing matches">
              <p>Try a different filter or clear the search.</p>
            </Empty>
          ) : (
            <>
              <div className="dict-grid">{items.map((d) => <DictationCard key={d.id} d={d} />)}</div>
              {dictQ.hasNextPage && (
                <div className="center" style={{ padding: 0 }}>
                  <button className="btn btn-ghost" onClick={() => void dictQ.fetchNextPage()} disabled={dictQ.isFetchingNextPage}>
                    {dictQ.isFetchingNextPage ? 'Loading…' : 'Load more'}
                  </button>
                </div>
              )}
            </>
          )}
      </>
    </div>
  )
}
