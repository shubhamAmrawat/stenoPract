import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import { formatPct } from '../lib/format'

interface Standing {
  ready: boolean
  students: number
  minStudents: number
  betterThanPct?: number
  rank?: number
  yourAccuracyPct?: number
  topperAccuracyPct?: number
  topperName?: string | null
  topperIsYou?: boolean
  averageAccuracyPct?: number
}

/** "Where you stand": this attempt against the other students on the same dictation (first names only). Renders nothing until enough students have tried it. */
export function StandingCard({ attemptId }: { attemptId: string }) {
  const q = useQuery({
    queryKey: ['standing', attemptId],
    queryFn: () => api<Standing>(`/attempts/${attemptId}/standing`),
    staleTime: 60_000,
    retry: false,
  })
  // A comparison is a nice extra: if it cannot load, the rest of the result page stands on its own.
  if (q.isPending || q.error) return null
  const s = q.data

  // Nothing to compare yet: show nothing at all rather than an empty card.
  if (!s.ready) return null

  const rows: { key: string; label: string; value: number; cls: string }[] = [
    { key: 'you', label: 'You', value: s.yourAccuracyPct ?? 0, cls: 'is-you' },
    { key: 'top', label: s.topperIsYou ? 'Topper (you!)' : `Topper · ${s.topperName ?? 'A student'}`, value: s.topperAccuracyPct ?? 0, cls: 'is-top' },
    { key: 'avg', label: 'Average', value: s.averageAccuracyPct ?? 0, cls: 'is-avg' },
  ]

  return (
    <section className="card standing stack">
      <div className="spread">
        <h2>Where you stand</h2>
        <span className="muted small">Accuracy · best attempt of each of {s.students} students</span>
      </div>
      <p className="standing-line">
        {s.topperIsYou ? 'You are at the top on this exercise. ' : ''}
        {s.betterThanPct === 0
          ? <>Every other student has done better on this exercise so far</>
          : <>You did better than <b>{s.betterThanPct}%</b> of the other students</>}
        {s.rank ? <> (rank <b>{s.rank}</b> of {s.students})</> : null}.
      </p>
      <div className="stack" style={{ gap: 8 }}>
        {rows.map((r) => (
          <div key={r.key} className="bar-row standing-row" title={`${r.label}: ${formatPct(r.value)} accuracy`}>
            <span>{r.label}</span>
            <div className="bar-track"><span className={r.cls} style={{ width: `${Math.min(100, Math.max(0, r.value))}%` }} /></div>
            <b>{formatPct(r.value)}</b>
          </div>
        ))}
      </div>
    </section>
  )
}
