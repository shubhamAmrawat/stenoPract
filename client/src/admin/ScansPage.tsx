import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react'
import { Link, useParams } from 'react-router'
import { ErrorState, Spinner } from '../components/ui'
import { api, apiUrl, errorMessage, qs } from '../lib/api'
import { imageToJpeg, isPdf, isPicture, openPdf, renderPdfPage } from '../lib/pageImages'
import type { AdminSet, ScanDetail, ScanRow } from './types'

/** Rough price of the reading, so the admin sees what a volume costs. Per million tokens for the default model; only an estimate. */
const PRICE_IN = 2
const PRICE_OUT = 10
const estimateCost = (rows: ScanRow[]) =>
  rows.reduce((sum, r) => sum + ((r.usage?.inputTokens ?? 0) * PRICE_IN + (r.usage?.outputTokens ?? 0) * PRICE_OUT) / 1_000_000, 0)

interface UploadJob {
  id: number
  name: string
  total: number | null
  sent: number
  state: 'preparing' | 'sending' | 'done' | 'failed'
  error?: string
}

const isActive = (r: ScanRow) => r.status === 'queued' || r.status === 'running'
const isReady = (r: ScanRow) => r.status === 'done' && r.outcome === 'draft' && r.review === 'pending' && r.green

function statusOf(r: ScanRow): { label: string; tone: string } {
  if (r.status === 'queued') return { label: 'Waiting', tone: 'muted' }
  if (r.status === 'running') return { label: 'Reading…', tone: 'info' }
  if (r.status === 'waiting') return { label: 'Joining pages…', tone: 'info' }
  if (r.status === 'failed') return { label: 'Failed', tone: 'full' }
  if (r.review === 'approved') return { label: 'Approved', tone: 'ok' }
  if (r.outcome === 'identical') return { label: 'Matches live', tone: 'ok' }
  return r.green ? { label: 'Ready to approve', tone: 'ok' } : { label: 'Needs a look', tone: 'half' }
}

/** "p.3" for one page, "p.3–4" for an exercise printed over two. */
const pagesLabel = (r: ScanRow) => {
  const first = Math.min(...r.pageNos)
  const last = Math.max(...r.pageNos)
  return first === last ? `p.${first}` : `p.${first}–${last}`
}

function checkLine(r: ScanRow): string {
  if (r.status === 'waiting') return r.part === 'continuation' ? 'Second half read. Waiting for the first half…' : 'First half read. Waiting for the next page…'
  if (r.status === 'failed') return r.error ?? 'Could not read this page'
  if (!r.checks) return ''
  const c = r.checks
  const bits = [`${c.wordCount.words} words${c.wordCount.printed ? ` (book: ${c.wordCount.printed})` : ''}`]
  if (c.markers.expected !== null) bits.push(`${c.markers.found}/${c.markers.expected} markers`)
  if (r.uncertainCount > 0) bits.push(`${r.uncertainCount} to check`)
  if (c.spelling.unknown.length) bits.push(`${c.spelling.unknown.length} unfamiliar word${c.spelling.unknown.length === 1 ? '' : 's'}`)
  if (r.differenceCount !== null) bits.push(r.differenceCount === 0 ? 'same as live' : `${r.differenceCount} differ from live`)
  return bits.join(' · ')
}

export function ScansPage() {
  const { setId = '' } = useParams()
  const qc = useQueryClient()
  const setsQ = useQuery({ queryKey: ['admin', 'sets'], queryFn: () => api<{ items: AdminSet[] }>('/admin/sets').then((r) => r.items) })
  const statusQ = useQuery({ queryKey: ['admin', 'scans', 'status'], queryFn: () => api<{ configured: boolean; model: string; passes: number }>('/admin/scans/status') })
  const scansQ = useQuery({
    queryKey: ['admin', 'scans', setId],
    queryFn: () => api<{ items: ScanRow[] }>(`/admin/sets/${setId}/scans`).then((r) => r.items),
    // A page waiting for its other half only changes when another page finishes, so it needs a slow check at most.
    refetchInterval: (q) => (q.state.data?.some(isActive) ? 3000 : q.state.data?.some((r) => r.status === 'waiting') ? 10_000 : false),
  })
  const [jobs, setJobs] = useState<UploadJob[]>([])
  const [dragging, setDragging] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const [bulk, setBulk] = useState<{ done: number; total: number; error?: string } | null>(null)
  const nextJob = useRef(1)
  const queueRef = useRef<Promise<void>>(Promise.resolve())

  const set = setsQ.data?.find((s) => s.id === setId)
  const refresh = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ['admin'] })
  }, [qc])

  const patchJob = (id: number, patch: Partial<UploadJob>) => setJobs((all) => all.map((j) => (j.id === id ? { ...j, ...patch } : j)))

  const sendFile = useCallback(
    async (file: File, id: number) => {
      // Pages of one file share an id and the page count, so the server can join an exercise that runs over two pages.
      const upload = crypto.randomUUID()
      const send = async (blob: Blob, page: number, pages: number) => {
        await api(`/admin/sets/${setId}/scans${qs({ name: file.name, page, pages, upload })}`, { method: 'POST', body: blob })
        void qc.invalidateQueries({ queryKey: ['admin', 'scans', setId] })
      }
      try {
        if (isPdf(file)) {
          const doc = await openPdf(file)
          patchJob(id, { total: doc.numPages, state: 'sending' })
          for (let p = 1; p <= doc.numPages; p++) {
            await send(await renderPdfPage(doc, p), p, doc.numPages)
            patchJob(id, { sent: p })
          }
          void doc.loadingTask.destroy()
        } else {
          patchJob(id, { total: 1, state: 'sending' })
          await send(await imageToJpeg(file), 1, 1)
          patchJob(id, { sent: 1 })
        }
        patchJob(id, { state: 'done' })
      } catch (err) {
        patchJob(id, { state: 'failed', error: errorMessage(err) })
      }
    },
    [qc, setId],
  )

  const addFiles = (files: FileList | File[]) => {
    const usable = [...files].filter((f) => isPdf(f) || isPicture(f))
    if (usable.length === 0) return
    const fresh: UploadJob[] = usable.map((f) => ({ id: nextJob.current++, name: f.name, total: null, sent: 0, state: 'preparing' }))
    setJobs((all) => [...all, ...fresh])
    // One file at a time: rendering a big PDF is heavy, and pages should reach the server in order.
    usable.forEach((f, i) => {
      queueRef.current = queueRef.current.then(() => sendFile(f, fresh[i]!.id))
    })
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    addFiles(e.dataTransfer.files)
  }

  const rows = scansQ.data ?? []
  const ready = rows.filter(isReady)
  const active = rows.filter(isActive).length
  const cost = estimateCost(rows)

  const approveAll = async () => {
    setBulk({ done: 0, total: ready.length })
    let done = 0
    for (const r of ready) {
      try {
        await api(`/admin/scans/${r.id}/approve`, { method: 'POST', body: { publish: true } })
      } catch (err) {
        setBulk({ done, total: ready.length, error: `Exercise ${r.exerciseNo}: ${errorMessage(err)}` })
        refresh()
        return
      }
      setBulk({ done: ++done, total: ready.length })
    }
    refresh()
    setBulk({ done, total: ready.length })
  }

  const retry = useMutation({ mutationFn: (id: string) => api(`/admin/scans/${id}/retry`, { method: 'POST' }), onSuccess: refresh })
  const discard = useMutation({ mutationFn: (id: string) => api(`/admin/scans/${id}`, { method: 'DELETE' }), onSuccess: refresh })

  if (setsQ.isPending || scansQ.isPending) return <Spinner full />
  if (setsQ.error) return <ErrorState error={setsQ.error} onRetry={() => void setsQ.refetch()} />
  if (scansQ.error) return <ErrorState error={scansQ.error} onRetry={() => void scansQ.refetch()} />
  if (!set) return <ErrorState error={new Error('Set not found')} />

  return (
    <div className="stack-lg">
      <div className="spread">
        <div>
          <Link to="/admin" className="small">← Back to content</Link>
          <h2 style={{ marginTop: 4 }}>Add transcripts from scans</h2>
          <p className="muted small">{set.title}. Drop the scanned PDF (or page pictures); each page is read and filed under the number in its “TRANSCRIPTION NO.” heading.</p>
        </div>
      </div>

      {statusQ.data && !statusQ.data.configured && (
        <div className="alert alert-warn">
          Reading scans needs your Claude API key on the server. Add <code>ANTHROPIC_API_KEY=…</code> to <code>server/.env</code> (and to the Render environment), restart the server, then come back.
        </div>
      )}

      <label
        className={`scan-drop${dragging ? ' scan-drop-on' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <input type="file" multiple accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = '' }} aria-label="Choose PDF or page pictures" />
        <b>Drop a PDF here, or click to choose</b>
        <span className="muted small">A whole volume works. An exercise can be one page or two; keep its pages together in the PDF.</span>
      </label>

      {jobs.length > 0 && (
        <div className="stack">
          {jobs.map((j) => (
            <div key={j.id} className={`alert ${j.state === 'failed' ? 'alert-error' : j.state === 'done' ? 'alert-info' : 'alert-info'}`}>
              <b>{j.name}</b>{' '}
              {j.state === 'preparing' && '— opening…'}
              {j.state === 'sending' && `— sending page ${Math.min(j.sent + 1, j.total ?? 1)} of ${j.total ?? '?'}…`}
              {j.state === 'done' && `— ${j.sent} page${j.sent === 1 ? '' : 's'} sent`}
              {j.state === 'failed' && `— stopped after ${j.sent} page${j.sent === 1 ? '' : 's'}: ${j.error}`}
            </div>
          ))}
        </div>
      )}

      {rows.length > 0 && (
        <div className="card stack">
          <div className="spread">
            <p className="muted small" style={{ margin: 0 }}>
              {rows.length} page{rows.length === 1 ? '' : 's'}
              {active > 0 ? ` · ${active} being read` : ''} · {ready.length} ready to approve
              {cost > 0 ? ` · about $${cost.toFixed(2)} so far` : ''}
            </p>
            <button className="btn btn-primary btn-sm" disabled={ready.length === 0 || (bulk !== null && !bulk.error && bulk.done < bulk.total)} onClick={() => void approveAll()}>
              Approve all ready ({ready.length})
            </button>
          </div>
          {bulk && (
            <div className={`alert ${bulk.error ? 'alert-error' : 'alert-info'}`}>
              {bulk.error ?? (bulk.done < bulk.total ? `Approving… ${bulk.done} of ${bulk.total}` : `Approved ${bulk.done}. Exercises with a video are now live for students.`)}
            </div>
          )}
          {(retry.error || discard.error) && <div className="alert alert-error">{errorMessage(retry.error ?? discard.error)}</div>}
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Page</th><th>Exercise</th><th>Status</th><th>Checks</th><th /></tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const st = statusOf(r)
                  return (
                    <tr key={r.id}>
                      <td className="small">{r.fileName || 'Picture'}{r.fileName.toLowerCase().endsWith('.pdf') ? ` · ${pagesLabel(r)}` : ''}</td>
                      <td>{r.exerciseNo !== null ? <b>{r.exerciseNo}</b> : <span className="muted">—</span>}</td>
                      <td><span className={`badge badge-${st.tone}`} style={{ whiteSpace: 'nowrap' }}>{st.label}</span></td>
                      <td className="small muted">{checkLine(r)}</td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {(r.status === 'done' || r.status === 'failed') && (
                          <button className="btn btn-ghost btn-sm" onClick={() => setOpenId(r.id)}>{r.review === 'approved' ? 'View' : r.status === 'failed' ? 'Look' : 'Review'}</button>
                        )}{' '}
                        {r.status === 'failed' && <button className="btn btn-ghost btn-sm" disabled={retry.isPending} onClick={() => retry.mutate(r.id)}>Try again</button>}{' '}
                        {r.review !== 'approved' && !isActive(r) && (
                          <button className="btn btn-ghost btn-sm" disabled={discard.isPending} onClick={() => { if (window.confirm('Throw this page away? Its unapproved draft is removed too.')) discard.mutate(r.id) }}>Discard</button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {openId && <ScanReview scanId={openId} onClose={() => setOpenId(null)} onChanged={refresh} />}
    </div>
  )
}

const KIND_LABEL: Record<string, string> = {
  illegible: 'Hard to read',
  printing_error: 'Looks like a printing error',
  punctuation: 'Punctuation',
  reads_differ: 'Two readings differ',
  other: 'Check',
}

function ScanReview({ scanId, onClose, onChanged }: { scanId: string; onClose: () => void; onChanged: () => void }) {
  const detailQ = useQuery({ queryKey: ['admin', 'scan', scanId], queryFn: () => api<ScanDetail>(`/admin/scans/${scanId}`) })
  const [text, setText] = useState<string | null>(null)
  const [publish, setPublish] = useState(true)
  const [zoom, setZoom] = useState(false)
  const areaRef = useRef<HTMLTextAreaElement>(null)

  const d = detailQ.data
  const current = text ?? d?.draft?.masterText ?? ''
  const dirty = d?.draft ? current !== d.draft.masterText : false

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const approve = useMutation({
    mutationFn: async () => {
      if (d?.draft && dirty) await api(`/admin/texts/${d.draft.id}`, { method: 'PATCH', body: { masterText: current } })
      return api<{ published: boolean; hasVideo: boolean }>(`/admin/scans/${scanId}/approve`, { method: 'POST', body: { publish } })
    },
    onSuccess: () => {
      onChanged()
      onClose()
    },
  })
  const save = useMutation({
    mutationFn: () => api(`/admin/texts/${d!.draft!.id}`, { method: 'PATCH', body: { masterText: current } }),
    onSuccess: () => {
      setText(null)
      void detailQ.refetch()
      onChanged()
    },
  })

  const find = (needle: string) => {
    const area = areaRef.current
    if (!area) return
    let i = current.indexOf(needle)
    if (i < 0) i = current.toLowerCase().indexOf(needle.toLowerCase())
    if (i < 0) return
    area.focus()
    area.setSelectionRange(i, i + needle.length)
    // Bring the line into view: scroll roughly to its share of the text.
    area.scrollTop = Math.max(0, (i / Math.max(1, current.length)) * area.scrollHeight - area.clientHeight / 2)
  }

  const approved = d?.scan.review === 'approved'

  return (
    <div className="scan-review" role="dialog" aria-modal="true" aria-label="Review page">
      <div className="scan-review-bar">
        <div>
          <b>{d ? (d.scan.exerciseNo !== null ? `Exercise ${d.scan.exerciseNo}` : 'Page') : 'Loading…'}</b>
          {d && <span className="muted small"> · {d.scan.fileName}{d.scan.fileName.toLowerCase().endsWith('.pdf') ? ` ${pagesLabel(d.scan)}` : ''}</span>}
        </div>
        <button className="btn btn-ghost btn-sm" onClick={onClose}>Close</button>
      </div>

      {detailQ.isPending ? (
        <Spinner />
      ) : detailQ.error ? (
        <ErrorState error={detailQ.error} onRetry={() => void detailQ.refetch()} />
      ) : (
        <div className="scan-review-body">
          <div className="scan-page">
            <div className="row" style={{ marginBottom: 8 }}>
              <button className="chip" aria-pressed={zoom} onClick={() => setZoom((z) => !z)}>{zoom ? 'Fit to width' : 'Zoom in'}</button>
            </div>
            {d!.hasImage ? (
              <div className={`scan-img${zoom ? ' scan-img-zoom' : ''}`}>
                {d!.parts.filter((p) => p.hasImage).map((p, _i, all) => (
                  <div key={p.id}>
                    {all.length > 1 && <div className="small muted scan-img-label">Page {p.pageNo}</div>}
                    <img src={apiUrl(`/admin/scans/${p.id}/image`)} alt={all.length > 1 ? `Scanned page ${p.pageNo}` : 'The scanned page'} />
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted small">The page picture is not kept after a page is approved.</p>
            )}
          </div>

          <div className="scan-side stack">
            {d!.scan.status === 'failed' && <div className="alert alert-error">{d!.scan.error}</div>}

            {d!.scan.checks && (
              <div className="scan-checks">
                <Check ok={d!.scan.checks.exerciseFound && d!.scan.checks.complete} text={d!.scan.checks.complete ? 'Heading and footer found' : 'Heading or footer missing: this may be half a page'} />
                <Check ok={d!.scan.checks.wordCount.ok} text={`${d!.scan.checks.wordCount.words} words${d!.scan.checks.wordCount.printed ? ` (the book says ${d!.scan.checks.wordCount.printed})` : ''}`} />
                <Check ok={d!.scan.checks.markers.ok} text={`${d!.scan.checks.markers.found} of ${d!.scan.checks.markers.expected ?? '?'} hundred-word markers found in place`} />
                <Check ok={d!.scan.checks.reads.agree} text={d!.scan.checks.reads.passes > 1 ? 'Two independent readings agree' : 'Read once (no second reading)'} />
                <Check ok={d!.scan.checks.spelling.ok} text={d!.scan.checks.spelling.unknown.length === 0 ? 'Every word is in the dictionary' : d!.scan.checks.spelling.ok ? `Names or variant spellings, worth a glance: ${d!.scan.checks.spelling.unknown.join(', ')}` : `Many unfamiliar words, the page may be misread: ${d!.scan.checks.spelling.unknown.join(', ')}`} onClick={d!.scan.checks.spelling.unknown[0] ? () => find(d!.scan.checks!.spelling.unknown[0]!) : undefined} />
              </div>
            )}

            {d!.compare && (
              <div className={`alert ${d!.compare.differenceCount === 0 ? 'alert-info' : 'alert-warn'}`}>
                {d!.compare.differenceCount === 0
                  ? `Identical to the live transcript (v${d!.compare.liveVersion}).`
                  : `Differs from the live transcript (v${d!.compare.liveVersion}) in ${d!.compare.differenceCount} place${d!.compare.differenceCount === 1 ? '' : 's'}:`}
                {d!.compare.differences.slice(0, 12).map((x, i) => (
                  <div key={i} className="small">live “{x.live || '—'}” → scan “{x.scan || '—'}”</div>
                ))}
              </div>
            )}

            {!!d!.reading?.uncertain.length && (
              <div className="stack">
                <b className="small">Please check ({d!.reading!.uncertain.length})</b>
                <div className="scan-flags">
                  {d!.reading!.uncertain.map((u, i) => (
                    <button key={i} className="scan-flag" onClick={() => find(u.text)} title="Show in the text">
                      <span className="badge badge-half">{KIND_LABEL[u.kind] ?? 'Check'}</span> <b>{u.text}</b>
                      <span className="small muted"> {u.note}{u.suggestion ? ` Maybe: “${u.suggestion}”.` : ''}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {d!.draft && !approved ? (
              <>
                <label className="label" htmlFor="scan-text">Transcript ({current.split(/\s+/).filter(Boolean).length} words). Fix anything that differs from the page.</label>
                <textarea id="scan-text" ref={areaRef} className="textarea scan-text" value={current} onChange={(e) => setText(e.target.value)} spellCheck={false} />
                {(approve.error || save.error) && <div className="alert alert-error">{errorMessage(approve.error ?? save.error)}</div>}
                <label className="row small">
                  <input type="checkbox" checked={publish} onChange={(e) => setPublish(e.target.checked)} /> Also show it to students when the exercise has a video{d!.dictation && d!.dictation.videoCount === 0 ? ' (this one has none yet)' : ''}
                </label>
                <div className="row" style={{ justifyContent: 'flex-end' }}>
                  {dirty && <button className="btn btn-ghost" disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'Saving…' : 'Save changes'}</button>}
                  <button className="btn btn-primary" disabled={approve.isPending} onClick={() => approve.mutate()}>{approve.isPending ? 'Approving…' : 'Approve and make live'}</button>
                </div>
              </>
            ) : approved ? (
              <div className="alert alert-info">Approved{d!.dictation ? `: ${d!.dictation.title} now uses this transcript${d!.dictation.published ? ' and is live for students' : ''}.` : '.'}</div>
            ) : (
              d!.scan.status === 'done' && <div className="alert alert-info">Nothing to approve: this page matches the transcript that is already live.</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function Check({ ok, text, onClick }: { ok: boolean; text: string; onClick?: () => void }) {
  const inner = (
    <>
      <span className={`scan-tick ${ok ? 'scan-tick-ok' : 'scan-tick-warn'}`} aria-hidden="true">{ok ? '✓' : '!'}</span>
      <span>{text}</span>
    </>
  )
  return onClick && !ok ? (
    <button className="scan-check scan-check-btn" onClick={onClick}>{inner}</button>
  ) : (
    <div className="scan-check">{inner}</div>
  )
}
