import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { setStudentView } from '../auth/studentView'
import { ErrorState, Spinner } from '../components/ui'
import { api, errorMessage } from '../lib/api'
import { countWords, formatDate } from '../lib/format'
import { dictationStatus, parseVideoId, type AdminDictation, type AdminText, type SuspectWord } from './types'

const WPM_CHOICES = [60, 80, 100, 120]

export function DictationEditorPage() {
  const { id = '' } = useParams()
  const qc = useQueryClient()
  const refresh = () => void qc.invalidateQueries({ queryKey: ['admin'] })

  const dictQ = useQuery({ queryKey: ['admin', 'dictation', id], queryFn: () => api<{ dictation: AdminDictation }>(`/admin/dictations/${id}`).then((r) => r.dictation) })
  const textsQ = useQuery({
    queryKey: ['admin', 'texts', id],
    queryFn: () => api<{ activeTextVersion: number | null; items: AdminText[] }>(`/admin/dictations/${id}/texts`),
  })

  if (dictQ.isPending || textsQ.isPending) return <Spinner full />
  if (dictQ.error) return <ErrorState error={dictQ.error} onRetry={() => void dictQ.refetch()} />
  if (textsQ.error) return <ErrorState error={textsQ.error} onRetry={() => void textsQ.refetch()} />

  const dictation = dictQ.data
  const st = dictationStatus(dictation)

  return (
    <div className="stack-lg">
      <div className="spread">
        <div>
          <Link to="/admin" className="small">← All exercises</Link>
          <h2 style={{ marginTop: 4 }}>{dictation.title}</h2>
        </div>
        <div className="row">
          <span className={`badge badge-${st.tone}`}>{st.label}</span>
          <Link className="btn btn-ghost btn-sm" to={`/d/${dictation.id}`} onClick={() => setStudentView(true)}>View as student</Link>
          <PublishButton dictation={dictation} onDone={refresh} />
        </div>
      </div>

      <div className="listen-grid">
        <TranscriptCard dictation={dictation} texts={textsQ.data.items} onChanged={refresh} />
        <div className="stack">
          <VideosCard dictation={dictation} onChanged={refresh} />
          <SuspectCard dictation={dictation} />
          <RegradeCard dictation={dictation} />
          <DeleteCard dictation={dictation} />
        </div>
      </div>
    </div>
  )
}

function PublishButton({ dictation, onDone }: { dictation: AdminDictation; onDone: () => void }) {
  const m = useMutation({
    mutationFn: () => api(`/admin/dictations/${dictation.id}`, { method: 'PATCH', body: { published: !dictation.published } }),
    onSuccess: onDone,
  })
  const blocked = !dictation.published && (dictation.activeTextVersion == null || dictation.videos.length === 0)
  return (
    <>
      <button className="btn btn-primary btn-sm" disabled={m.isPending || blocked} onClick={() => m.mutate()} title={blocked ? 'Needs a verified transcript and a video' : undefined}>
        {dictation.published ? 'Unpublish' : 'Publish'}
      </button>
      {m.error && <span className="badge badge-full">{errorMessage(m.error)}</span>}
    </>
  )
}

function TranscriptCard({ dictation, texts, onChanged }: { dictation: AdminDictation; texts: AdminText[]; onChanged: () => void }) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = texts.find((t) => t.id === selectedId) ?? texts.find((t) => t.version === dictation.activeTextVersion) ?? texts[0] ?? null

  const textQ = useQuery({
    queryKey: ['admin', 'text', selected?.id],
    enabled: !!selected,
    queryFn: () => api<{ text: AdminText }>(`/admin/texts/${selected!.id}`).then((r) => r.text),
  })

  return (
    <div className="card stack">
      <div className="spread">
        <h3>Transcript (answer key)</h3>
        <div className="row">
          {texts.map((t) => (
            <button key={t.id} className="chip" aria-pressed={t.id === selected?.id} onClick={() => setSelectedId(t.id)}>
              v{t.version} {t.reviewStatus === 'verified' ? (t.version === dictation.activeTextVersion ? '· live' : '· verified') : '· draft'}
            </button>
          ))}
        </div>
      </div>
      {selected && textQ.isPending ? (
        <Spinner />
      ) : selected && textQ.error ? (
        <ErrorState error={textQ.error} onRetry={() => void textQ.refetch()} />
      ) : (
        // key = remount with fresh form state whenever another version is opened or saved
        <TranscriptEditor key={textQ.data?.id ?? 'new'} dictation={dictation} text={textQ.data ?? null} onSaved={(id) => { setSelectedId(id); onChanged() }} />
      )}
    </div>
  )
}

function TranscriptEditor({ dictation, text, onSaved }: { dictation: AdminDictation; text: AdminText | null; onSaved: (textId: string) => void }) {
  const qc = useQueryClient()
  const [body, setBody] = useState(text?.masterText ?? '')
  const [checkpoints, setCheckpoints] = useState(text?.checkpoints.join(', ') ?? '')
  const [dirty, setDirty] = useState(false)

  const words = useMemo(() => countWords(body), [body])
  const cps = useMemo(() => checkpoints.split(/[,\s]+/).map((x) => Number(x)).filter((n) => Number.isInteger(n) && n > 0), [checkpoints])
  const isVerified = text?.reviewStatus === 'verified'
  const isActive = text?.version === dictation.activeTextVersion

  const after = (id: string) => {
    void qc.invalidateQueries({ queryKey: ['admin', 'text'] })
    onSaved(id)
  }
  const createVersion = useMutation({
    mutationFn: () => api<{ text: AdminText }>(`/admin/dictations/${dictation.id}/texts`, { method: 'POST', body: { masterText: body, checkpoints: cps, source: 'manual' } }),
    onSuccess: (r) => after(r.text.id),
  })
  const saveDraft = useMutation({
    mutationFn: () => api(`/admin/texts/${text!.id}`, { method: 'PATCH', body: { masterText: body, checkpoints: cps } }),
    onSuccess: () => { setDirty(false); after(text!.id) },
  })
  const verify = useMutation({
    mutationFn: () => api(`/admin/texts/${text!.id}/verify`, { method: 'POST' }),
    onSuccess: () => after(text!.id),
  })
  const busy = createVersion.isPending || saveDraft.isPending || verify.isPending
  const err = createVersion.error ?? saveDraft.error ?? verify.error

  return (
    <>
      {text && (
        <p className="small muted">
          Version {text.version} · {text.source} · {text.attemptCount} graded attempts · created {formatDate(text.createdAt)}
        </p>
      )}
      {isVerified && <div className="alert alert-info">Verified versions are frozen because past attempts were graded against them. Edit the text below and use “Save as new version”.</div>}
      {!text && <div className="alert alert-warn">No transcript yet. Type or paste the exact dictation text below (no “/” marks, no “(100)” markers).</div>}

      <textarea
        className="textarea"
        rows={18}
        style={{ fontFamily: 'var(--font-body)', lineHeight: 1.6 }}
        value={body}
        onChange={(e) => { setBody(e.target.value); setDirty(true) }}
        aria-label="Transcript text"
        spellCheck
      />
      <div className="row">
        <span className="badge badge-info">{words} words</span>
        {dictation.masterWordCount > 0 && isActive && words !== dictation.masterWordCount && <span className="badge badge-half">live version has {dictation.masterWordCount}</span>}
        <div className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <label className="label" htmlFor="cps">100-word marks</label>
          <input id="cps" className="input" style={{ width: 200 }} value={checkpoints} onChange={(e) => { setCheckpoints(e.target.value); setDirty(true) }} placeholder="100, 200, 300" />
        </div>
      </div>

      {err && <div className="alert alert-error">{errorMessage(err)}</div>}

      <div className="row" style={{ justifyContent: 'flex-end' }}>
        {!text && <button className="btn btn-primary" disabled={busy || words === 0} onClick={() => createVersion.mutate()}>Create transcript</button>}
        {text && (
          <>
            <button className="btn btn-ghost" disabled={busy || !dirty || words === 0} onClick={() => createVersion.mutate()}>Save as new version</button>
            {!isVerified && <button className="btn btn-ghost" disabled={busy || !dirty} onClick={() => saveDraft.mutate()}>Save draft</button>}
            {!isVerified && <button className="btn btn-accent" disabled={busy || dirty} onClick={() => verify.mutate()} title={dirty ? 'Save the draft first' : undefined}>Verify and make live</button>}
          </>
        )}
      </div>
      {text && !isVerified && <p className="small muted">A draft is not shown to students until you press “Verify and make live”.</p>}
    </>
  )
}

function VideosCard({ dictation, onChanged }: { dictation: AdminDictation; onChanged: () => void }) {
  const [link, setLink] = useState('')
  const [wpm, setWpm] = useState(100)
  const [error, setError] = useState<string | null>(null)
  const save = useMutation({
    mutationFn: (videos: { youtubeVideoId: string; baseWpm: number; title?: string }[]) => api(`/admin/dictations/${dictation.id}`, { method: 'PATCH', body: { videos } }),
    onSuccess: () => { setLink(''); onChanged() },
  })
  const current = dictation.videos.map((v) => ({ youtubeVideoId: v.youtubeVideoId, baseWpm: v.baseWpm, ...(v.title ? { title: v.title } : {}) }))

  const add = () => {
    setError(null)
    const videoId = parseVideoId(link)
    if (!videoId) return setError('That does not look like a YouTube link')
    const next = current.filter((v) => v.baseWpm !== wpm && v.youtubeVideoId !== videoId)
    save.mutate([...next, { youtubeVideoId: videoId, baseWpm: wpm }].sort((a, b) => a.baseWpm - b.baseWpm))
  }

  return (
    <div className="card stack">
      <h3>Videos</h3>
      {dictation.videos.length === 0 && <p className="muted small">No video yet.</p>}
      {dictation.videos.map((v) => (
        <div key={v.youtubeVideoId} className="spread">
          <div>
            <span className="badge badge-info">{v.baseWpm} wpm</span>{' '}
            <a href={`https://www.youtube.com/watch?v=${v.youtubeVideoId}`} target="_blank" rel="noreferrer" className="small">{v.youtubeVideoId}</a>
            {v.title && <div className="muted small" style={{ marginTop: 4 }}>{v.title}</div>}
          </div>
          <button className="btn btn-danger btn-sm" disabled={save.isPending} onClick={() => save.mutate(current.filter((x) => x.youtubeVideoId !== v.youtubeVideoId))}>Remove</button>
        </div>
      ))}
      <div className="field">
        <label className="label" htmlFor="vid-link">Add a video</label>
        <input id="vid-link" className="input" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://www.youtube.com/watch?v=…" />
      </div>
      <div className="row">
        <select className="select" style={{ width: 130 }} value={wpm} onChange={(e) => setWpm(Number(e.target.value))} aria-label="Speed of this video">
          {WPM_CHOICES.map((w) => <option key={w} value={w}>{w} wpm</option>)}
        </select>
        <button className="btn btn-primary btn-sm" disabled={save.isPending || !link.trim()} onClick={add}>Add</button>
      </div>
      {(error || save.error) && <div className="alert alert-error">{error ?? errorMessage(save.error)}</div>}
    </div>
  )
}

function SuspectCard({ dictation }: { dictation: AdminDictation }) {
  const q = useQuery({
    queryKey: ['admin', 'suspects', dictation.id, dictation.activeTextVersion],
    queryFn: () => api<{ version: number | null; attempts: number; items: SuspectWord[] }>(`/admin/dictations/${dictation.id}/suspect-words`),
  })
  return (
    <div className="card stack">
      <h3>Words many students miss</h3>
      <p className="small muted">If lots of students get the same word wrong, the transcript itself may be wrong there. Shows once 3 or more attempts exist.</p>
      {q.isPending ? <Spinner /> : q.error ? <div className="alert alert-error">{errorMessage(q.error)}</div> : q.data.items.length === 0 ? (
        <p className="small">Nothing suspicious ({q.data.attempts} attempts so far).</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>#</th><th>Word</th><th>Missed by</th></tr></thead>
            <tbody>
              {q.data.items.map((w) => (
                <tr key={w.wordIndex}><td>{w.wordIndex + 1}</td><td><b>{w.word}</b></td><td>{Math.round(w.ratio * 100)}% ({w.misses})</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function RegradeCard({ dictation }: { dictation: AdminDictation }) {
  const run = useMutation({
    mutationFn: async () => {
      let processed = 0
      for (let i = 0; i < 100; i++) {
        const r = await api<{ processed: number; remaining: number }>(`/admin/dictations/${dictation.id}/reevaluate`, { method: 'POST', body: { limit: 50 } })
        processed += r.processed
        if (r.remaining === 0 || r.processed === 0) break
      }
      return processed
    },
  })
  return (
    <div className="card stack">
      <h3>Re-grade old attempts</h3>
      <p className="small muted">After you fix a transcript and make a new version live, re-grade attempts that were marked against an older version.</p>
      <button className="btn btn-ghost btn-sm" disabled={run.isPending || dictation.activeTextVersion == null} onClick={() => run.mutate()}>{run.isPending ? 'Working…' : 'Re-grade now'}</button>
      {run.data !== undefined && <div className="alert alert-info">{run.data} attempts re-graded.</div>}
      {run.error && <div className="alert alert-error">{errorMessage(run.error)}</div>}
    </div>
  )
}

function DeleteCard({ dictation }: { dictation: AdminDictation }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [sure, setSure] = useState(false)
  const del = useMutation({
    mutationFn: () => api(`/admin/dictations/${dictation.id}`, { method: 'DELETE' }),
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ['admin'] }); navigate('/admin') },
  })
  return (
    <div className="card stack">
      <h3>Delete exercise</h3>
      <p className="muted small">Removes this exercise and its transcripts. Only possible while no student has attempted it; otherwise unpublish it instead.</p>
      {del.error && <div className="alert alert-error">{errorMessage(del.error)}</div>}
      {sure ? (
        <div className="row">
          <button className="btn btn-danger btn-sm" disabled={del.isPending} onClick={() => del.mutate()}>{del.isPending ? 'Deleting…' : 'Yes, delete it'}</button>
          <button className="btn btn-ghost btn-sm" onClick={() => setSure(false)}>Cancel</button>
        </div>
      ) : (
        <button className="btn btn-ghost btn-sm" onClick={() => setSure(true)}>Delete this exercise…</button>
      )}
    </div>
  )
}
