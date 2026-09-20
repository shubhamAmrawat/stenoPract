import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { Empty, ErrorState, Modal, Spinner } from '../components/ui'
import { api, errorMessage } from '../lib/api'
import { dictationStatus, type AdminDictation, type AdminSet, type ImportResponse } from './types'

const CONSOLE_SNIPPET = String.raw`(() => { const m = new Map(); document.querySelectorAll('a[href*="watch?v="]').forEach((a) => { const id = (a.href.match(/[?&]v=([\w-]{11})/) || [])[1]; const t = (a.title || a.getAttribute('aria-label') || a.textContent || '').replace(/\s+/g, ' ').trim(); if (id && /exercise|transcri|dictation|wpm/i.test(t) && !m.has(id)) m.set(id, t + '\t' + a.href); }); copy([...m.values()].join('\n')); console.log(m.size + ' videos copied' + (m.size ? '' : ' - are you on the YouTube playlist tab? Scroll down first, then run again')); })()`

function useAdminInvalidate() {
  const qc = useQueryClient()
  return () => void qc.invalidateQueries({ queryKey: ['admin'] })
}

export function ContentPage() {
  const setsQ = useQuery({ queryKey: ['admin', 'sets'], queryFn: () => api<{ items: AdminSet[] }>('/admin/sets').then((r) => r.items) })
  const [selected, setSelected] = useState<string | null>(null)
  const [modal, setModal] = useState<null | 'set' | 'edit' | 'links' | 'playlist' | 'json'>(null)

  if (setsQ.isPending) return <Spinner full />
  if (setsQ.error) return <ErrorState error={setsQ.error} onRetry={() => void setsQ.refetch()} />

  const sets = setsQ.data
  const current = sets.find((s) => s.id === selected) ?? sets[0]

  return (
    <div className="stack-lg">
      <div className="spread">
        <div className="row">
          {sets.map((s) => (
            <button key={s.id} className="chip" aria-pressed={s.id === current?.id} onClick={() => setSelected(s.id)}>
              {s.title}
            </button>
          ))}
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => setModal('set')}>+ New set</button>
      </div>

      {!current ? (
        <Empty title="No sets yet">
          <p>A set is one book or volume, for example “Kailash Chandra Vol 24”.</p>
          <p className="small">Easiest start: run <code>npm run content:load</code> in the server folder, which creates the set and all transcripts for you.</p>
        </Empty>
      ) : (
        <SetPanel set={current} onOpen={setModal} />
      )}

      {modal === 'set' && <NewSetModal onClose={() => setModal(null)} onCreated={(id) => { setSelected(id); setModal(null) }} />}
      {modal === 'edit' && current && <EditSetModal set={current} onClose={() => setModal(null)} />}
      {modal === 'links' && current && <LinksModal set={current} onClose={() => setModal(null)} />}
      {modal === 'playlist' && current && <PlaylistModal set={current} onClose={() => setModal(null)} />}
      {modal === 'json' && current && <JsonModal set={current} onClose={() => setModal(null)} />}
    </div>
  )
}

function SetPanel({ set, onOpen }: { set: AdminSet; onOpen: (m: 'edit' | 'links' | 'playlist' | 'json') => void }) {
  const invalidate = useAdminInvalidate()
  const dictQ = useQuery({
    queryKey: ['admin', 'dictations', set.id],
    queryFn: () => api<{ items: AdminDictation[] }>(`/admin/dictations?setId=${set.id}`).then((r) => r.items),
  })
  const togglePublished = useMutation({
    mutationFn: ({ id, published }: { id: string; published: boolean }) => api(`/admin/dictations/${id}`, { method: 'PATCH', body: { published } }),
    onSuccess: invalidate,
  })
  const setPublished = useMutation({
    mutationFn: (published: boolean) => api(`/admin/sets/${set.id}`, { method: 'PATCH', body: { published } }),
    onSuccess: invalidate,
  })

  const items = dictQ.data ?? []
  const ready = items.filter((d) => d.activeTextVersion != null && d.videos.length > 0)
  const unpublishedReady = ready.filter((d) => !d.published)

  return (
    <div className="card stack">
      <div className="spread">
        <div>
          <h2>{set.title}</h2>
          <p className="muted small">
            {items.length} exercises · {items.filter((d) => d.published).length} published ·{' '}
            {set.published ? 'set visible to students' : 'set hidden from students'}
          </p>
        </div>
        <div className="row">
          <button className="btn btn-ghost btn-sm" onClick={() => setPublished.mutate(!set.published)} disabled={setPublished.isPending}>
            {set.published ? 'Hide set' : 'Show set to students'}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => onOpen('edit')}>Edit title</button>
          <button className="btn btn-primary btn-sm" onClick={() => onOpen('links')}>Paste video links</button>
          <button className="btn btn-ghost btn-sm" onClick={() => onOpen('json')}>Import JSON</button>
          <button className="btn btn-ghost btn-sm" onClick={() => onOpen('playlist')}>Import playlist</button>
        </div>
      </div>

      {!set.published && <div className="alert alert-warn">This set is hidden, so students will not see it yet. Use “Show set to students”.</div>}
      {unpublishedReady.length > 0 && (
        <div className="alert alert-info spread">
          <span>{unpublishedReady.length} exercises have a transcript and video but are not published.</span>
          <button
            className="btn btn-primary btn-sm"
            disabled={togglePublished.isPending}
            onClick={async () => {
              for (const d of unpublishedReady) await togglePublished.mutateAsync({ id: d.id, published: true })
            }}
          >
            Publish all
          </button>
        </div>
      )}
      {togglePublished.error && <div className="alert alert-error">{errorMessage(togglePublished.error)}</div>}
      {items.some((d) => d.activeTextVersion == null) && (
        <div className="alert alert-warn">
          {(() => { const n = items.filter((d) => d.activeTextVersion == null).length; return n === 1 ? '1 exercise is' : `${n} exercises are` })()} waiting for a transcript. Students cannot see an exercise until its transcript is verified: use “Import JSON”, or open the exercise and paste the text.
        </div>
      )}

      {dictQ.isPending ? (
        <Spinner />
      ) : dictQ.error ? (
        <ErrorState error={dictQ.error} onRetry={() => void dictQ.refetch()} />
      ) : items.length === 0 ? (
        <Empty title="No exercises in this set yet">Use “Import playlist” or “Paste video links” to add the videos, then “Import JSON” (or open an exercise) to add transcripts.</Empty>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>Exercise</th><th>Videos</th><th>Transcript</th><th>Status</th><th>Reports</th><th /></tr>
            </thead>
            <tbody>
              {items.map((d) => {
                const st = dictationStatus(d)
                return (
                  <tr key={d.id}>
                    <td><Link to={`/admin/d/${d.id}`}><b>{d.title}</b></Link></td>
                    <td>{d.videos.length ? d.videos.map((v) => <span key={v.youtubeVideoId} className="badge badge-info" style={{ marginRight: 4 }}>{v.baseWpm} wpm</span>) : <span className="muted">none</span>}</td>
                    <td>{d.activeTextVersion != null ? `v${d.activeTextVersion} · ${d.masterWordCount} words` : <span className="muted">none</span>}</td>
                    <td><span className={`badge badge-${st.tone}`}>{st.label}</span></td>
                    <td>{d.openReports ? <span className="badge badge-full">{d.openReports} open</span> : <span className="muted">0</span>}</td>
                    <td style={{ textAlign: 'right' }}>
                      <Link className="btn btn-ghost btn-sm" to={`/admin/d/${d.id}`}>Edit</Link>{' '}
                      <button
                        className="btn btn-ghost btn-sm"
                        disabled={togglePublished.isPending || (!d.published && (d.activeTextVersion == null || d.videos.length === 0))}
                        onClick={() => togglePublished.mutate({ id: d.id, published: !d.published })}
                      >
                        {d.published ? 'Unpublish' : 'Publish'}
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function EditSetModal({ set, onClose }: { set: AdminSet; onClose: () => void }) {
  const qc = useQueryClient()
  const [title, setTitle] = useState(set.title)
  const [source, setSource] = useState(set.source ?? '')
  const save = useMutation({
    mutationFn: () => api(`/admin/sets/${set.id}`, { method: 'PATCH', body: { title: title.trim(), source: source.trim() } }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['admin'] }); void qc.invalidateQueries({ queryKey: ['sets'] }); onClose() },
  })
  const submit = (e: FormEvent) => { e.preventDefault(); save.mutate() }
  return (
    <Modal title="Edit set" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <div className="field">
          <label className="label" htmlFor="edit-title">Title shown to students</label>
          <input id="edit-title" className="input" required maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="field">
          <label className="label" htmlFor="edit-source">Small line under the title (optional)</label>
          <input id="edit-source" className="input" maxLength={120} value={source} onChange={(e) => setSource(e.target.value)} placeholder="Kailash Chandra, Vol. 24" />
        </div>
        {save.error && <div className="alert alert-error">{errorMessage(save.error)}</div>}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={save.isPending || !title.trim()}>{save.isPending ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </Modal>
  )
}

function NewSetModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const invalidate = useAdminInvalidate()
  const [title, setTitle] = useState('')
  const [slug, setSlug] = useState('')
  const [playlist, setPlaylist] = useState('')
  // The short name becomes part of the web address, so whatever is typed ("KC Volume 23") is tidied into "kc-volume-23".
  const finalSlug = slugify(slug) || slugify(title)
  const create = useMutation({
    mutationFn: () =>
      api<{ set: AdminSet }>('/admin/sets', {
        method: 'POST',
        body: { title: title.trim(), slug: finalSlug || `set-${Date.now().toString(36)}`, youtubePlaylistId: playlist.match(/list=([\w-]+)/)?.[1] ?? (playlist.trim() || undefined), published: true },
      }),
    onSuccess: (r) => { invalidate(); onCreated(r.set.id) },
  })
  const submit = (e: FormEvent) => { e.preventDefault(); create.mutate() }
  return (
    <Modal title="New set" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <div className="field">
          <label className="label" htmlFor="set-title">Title</label>
          <input id="set-title" className="input" required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Kailash Chandra Vol 24" />
        </div>
        <div className="field">
          <label className="label" htmlFor="set-slug">Short name for the web address (optional)</label>
          <input id="set-slug" className="input" value={slug} onChange={(e) => setSlug(e.target.value)} placeholder={slugify(title) || 'kailash-chandra-vol-24'} aria-describedby="set-slug-hint" />
          <p id="set-slug-hint" className="muted small">Students will see it as /practice/{finalSlug || '…'}. Any name works; it is tidied into letters, numbers and dashes.</p>
        </div>
        <div className="field">
          <label className="label" htmlFor="set-pl">YouTube playlist link (optional)</label>
          <input id="set-pl" className="input" value={playlist} onChange={(e) => setPlaylist(e.target.value)} placeholder="https://www.youtube.com/playlist?list=…" />
        </div>
        {create.error && <div className="alert alert-error">{errorMessage(create.error)}</div>}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={create.isPending || !title.trim()}>{create.isPending ? 'Creating…' : 'Create set'}</button>
        </div>
      </form>
    </Modal>
  )
}

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)

function ImportResults({ data }: { data: ImportResponse }) {
  return (
    <div className="stack">
      <div className="alert alert-info">Done: {data.results.length} exercises updated, {data.results.filter((r) => r.published).length} published.</div>
      {data.results.some((r) => r.warnings.length) && (
        <div className="alert alert-warn">
          {data.results.filter((r) => r.warnings.length).map((r) => (
            <div key={r.exerciseNo}>Exercise {r.exerciseNo}: {r.warnings.join('; ')}</div>
          ))}
        </div>
      )}
      {!!data.skipped?.length && (
        <div className="alert alert-error">
          <b>{data.skipped.length} lines skipped:</b>
          {data.skipped.slice(0, 8).map((s, i) => <div key={i} className="small">“{s.line.slice(0, 90)}” — {s.reason}</div>)}
        </div>
      )}
    </div>
  )
}

function LinksModal({ set, onClose }: { set: AdminSet; onClose: () => void }) {
  const invalidate = useAdminInvalidate()
  const [text, setText] = useState('')
  const [copied, setCopied] = useState(false)
  const found = (text.match(/[?&]v=[\w-]{11}|youtu\.be\/[\w-]{11}/g) ?? []).length
  const run = useMutation({
    mutationFn: () => api<ImportResponse>(`/admin/sets/${set.id}/import-video-links`, { method: 'POST', body: { text } }),
    onSuccess: invalidate,
  })
  return (
    <Modal title="Paste video links" onClose={onClose}>
      <div className="stack">
        <ol className="small muted" style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 4 }}>
          <li>Open a <b>new browser tab</b> with your YouTube playlist (not this app) and scroll to the bottom so every video loads.</li>
          <li>Press F12, open <b>Console</b>, paste the line below and press Enter (if Chrome asks, type <code>allow pasting</code> first).</li>
          <li>It should print “N videos copied”. Come back here and paste into the box (Ctrl+V).</li>
        </ol>
        <div className="row" style={{ flexWrap: 'nowrap' }}>
          <code className="small" style={{ flex: 1, overflowX: 'auto', whiteSpace: 'nowrap', padding: 8, background: '#eef1fb', borderRadius: 8 }}>{CONSOLE_SNIPPET}</code>
          <button className="btn btn-ghost btn-sm" onClick={() => { void navigator.clipboard.writeText(CONSOLE_SNIPPET).then(() => setCopied(true)) }}>{copied ? 'Copied' : 'Copy'}</button>
        </div>
        <p className="small muted">Then paste here. One video per line. Lines like <code>100 WPM | Exercise 507 …  https://…</code> or <code>507 100 https://youtu.be/…</code> both work.</p>
        <textarea className="textarea" rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste here…" aria-label="Pasted video lines" />
        {text.trim() && <p className={found ? 'small' : 'small muted'} style={{ margin: 0 }}>{found ? `${found} video link${found === 1 ? '' : 's'} found` : 'No YouTube links found in this text yet'}</p>}
        {run.error && <div className="alert alert-error">{errorMessage(run.error)}</div>}
        {run.data && <ImportResults data={run.data} />}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost" onClick={onClose}>{run.data ? 'Close' : 'Cancel'}</button>
          <button className="btn btn-primary" disabled={run.isPending || !text.trim()} onClick={() => run.mutate()}>{run.isPending ? 'Importing…' : 'Import and publish ready ones'}</button>
        </div>
      </div>
    </Modal>
  )
}

interface PlaylistResult {
  found: number
  created: number
  updated: number
  usedDefault: number
  exercises: number[]
  skipped: { title: string; reason: string }[]
}

function exerciseRange(nums: number[]) {
  if (nums.length === 0) return ''
  return nums.length === 1 ? `${nums[0]}` : `${nums[0]}\u2013${nums[nums.length - 1]}`
}

function PlaylistModal({ set, onClose }: { set: AdminSet; onClose: () => void }) {
  const invalidate = useAdminInvalidate()
  const [playlist, setPlaylist] = useState(set.youtubePlaylistId ?? '')
  const [wpm, setWpm] = useState('')
  const wpmNum = wpm.trim() === '' ? undefined : Number(wpm)
  const wpmBad = wpmNum !== undefined && (!Number.isInteger(wpmNum) || wpmNum < 40 || wpmNum > 200)
  const run = useMutation({
    mutationFn: () =>
      api<PlaylistResult>(`/admin/sets/${set.id}/import-playlist`, {
        method: 'POST',
        body: { playlist: playlist.trim() || undefined, defaultWpm: wpmNum },
      }),
    onSuccess: invalidate,
  })
  const r = run.data
  const imported = r ? r.created + r.updated : 0
  const needSpeed = r?.skipped.some((s) => s.reason.includes('no speed')) ?? false
  return (
    <Modal title="Import from a YouTube playlist" onClose={onClose}>
      <div className="stack">
        <p className="small muted">
          Each video becomes an exercise, matched by the number in its title (“Exercise 507”, “Transcription No. 485”). Safe to run again: nothing is duplicated.
          Needs <code>YOUTUBE_API_KEY</code> on the server; without one, use “Paste video links”.
        </p>
        <div>
          <label className="label" htmlFor="pl-link">Playlist link or id</label>
          <input id="pl-link" className="input" value={playlist} onChange={(e) => setPlaylist(e.target.value)} placeholder="https://www.youtube.com/playlist?list=…" />
        </div>
        <div>
          <label className="label" htmlFor="pl-wpm">Speed for videos whose title has no speed (optional)</label>
          <input
            id="pl-wpm"
            className="input"
            inputMode="numeric"
            style={{ maxWidth: 140 }}
            value={wpm}
            onChange={(e) => setWpm(e.target.value.replace(/\D/g, '').slice(0, 3))}
            placeholder="e.g. 100"
            aria-invalid={wpmBad}
            aria-describedby="pl-wpm-hint"
          />
          <p id="pl-wpm-hint" className={wpmBad ? 'small' : 'small muted'} style={{ margin: '4px 0 0', color: wpmBad ? 'var(--full-ink)' : undefined }}>
            {wpmBad ? 'Enter a speed between 40 and 200 words per minute.' : 'Titles like “100 WPM” are read automatically. This is only used when a title does not say.'}
          </p>
        </div>
        {run.error && <div className="alert alert-error">{errorMessage(run.error)}</div>}
        {r && (
          <div className="stack">
            {imported > 0 ? (
              <div className="alert alert-info">
                <b>{imported} exercise{imported === 1 ? '' : 's'} ready in the table</b> ({exerciseRange(r.exercises)}): {r.created} new, {r.updated} updated
                {r.usedDefault > 0 ? `, ${r.usedDefault} using the speed you typed` : ''}.
                <div className="small" style={{ marginTop: 4 }}>
                  Next: each exercise needs a verified transcript before students can see it. Use “Import JSON” for many at once, or open an exercise and paste its text.
                </div>
              </div>
            ) : (
              r.skipped.length === 0 && <div className="alert alert-warn">No videos were found in that playlist. Check the link, and that the playlist is public or unlisted.</div>
            )}
            {r.skipped.length > 0 && (
              <div className="alert alert-error">
                <b>{r.skipped.length} of {r.found} video{r.found === 1 ? '' : 's'} skipped</b>
                {needSpeed && <span> — type the speed in the box above and press “Import again”.</span>}
                <div className="small" style={{ marginTop: 6, maxHeight: 180, overflowY: 'auto', display: 'grid', gap: 4 }}>
                  {r.skipped.map((s, i) => (
                    <div key={i}>“{s.title.slice(0, 80)}” — {s.reason}</div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost" onClick={onClose}>{imported > 0 ? 'Done' : 'Close'}</button>
          <button className="btn btn-primary" disabled={run.isPending || wpmBad} onClick={() => run.mutate()}>
            {run.isPending ? 'Importing…' : r ? 'Import again' : 'Import'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

function JsonModal({ set, onClose }: { set: AdminSet; onClose: () => void }) {
  const invalidate = useAdminInvalidate()
  const [text, setText] = useState('')
  const [publish, setPublish] = useState(true)
  const [parseError, setParseError] = useState<string | null>(null)
  const run = useMutation({
    mutationFn: (items: unknown[]) => api<ImportResponse>(`/admin/sets/${set.id}/bulk-import`, { method: 'POST', body: { items, publish, verify: true } }),
    onSuccess: invalidate,
  })
  const submit = () => {
    setParseError(null)
    try {
      const data: unknown = JSON.parse(text)
      const items = Array.isArray(data) ? data : (data as { items?: unknown[] }).items
      if (!Array.isArray(items) || items.length === 0) throw new Error('Expected {"items": [ … ]} or a list of exercises')
      run.mutate(items)
    } catch (err) {
      setParseError(errorMessage(err))
    }
  }
  return (
    <Modal title="Import exercises from JSON" onClose={onClose}>
      <div className="stack">
        <p className="small muted">
          Each item: <code>{'{ "exerciseNo": 507, "masterText": "…", "checkpoints": [100, 200], "videos": [{ "youtubeVideoId": "…", "baseWpm": 100 }] }'}</code>. Transcripts are verified straight away.
        </p>
        <input type="file" accept="application/json,.json" aria-label="Choose JSON file" onChange={(e) => { const f = e.target.files?.[0]; if (f) void f.text().then(setText) }} />
        <textarea className="textarea" rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder="…or paste JSON here" aria-label="Pasted JSON text" />
        <label className="row small"><input type="checkbox" checked={publish} onChange={(e) => setPublish(e.target.checked)} /> Publish exercises that have a transcript and a video</label>
        {parseError && <div className="alert alert-error">{parseError}</div>}
        {run.error && <div className="alert alert-error">{errorMessage(run.error)}</div>}
        {run.data && <ImportResults data={run.data} />}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
          <button className="btn btn-primary" disabled={run.isPending || !text.trim()} onClick={submit}>{run.isPending ? 'Importing…' : 'Import'}</button>
        </div>
      </div>
    </Modal>
  )
}
