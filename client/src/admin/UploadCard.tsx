import { useRef, useState, type DragEvent } from 'react'
import { api, errorMessage } from '../lib/api'
import { filesFromDrop, pickPdfs } from '../lib/dropFiles'
import { formatBytes } from '../lib/format'
import type { ResourceItem } from '../lib/types'

type State = 'waiting' | 'uploading' | 'sent' | 'added' | 'failed'
interface Item { id: number; file: File; state: State; progress: number; error?: string }

interface UploadTicket { name: string; key: string; uploadUrl: string; contentType: string }

let nextId = 0
const BATCH = 50 // files per request (the server's limit)
const PARALLEL = 3 // uploads running at the same time

/** Sends one file straight to storage. XMLHttpRequest, because fetch cannot report upload progress. */
function putFile(ticket: UploadTicket, file: File, onProgress: (fraction: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', ticket.uploadUrl)
    xhr.setRequestHeader('Content-Type', ticket.contentType)
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total)
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Storage refused the file (${xhr.status}).`)))
    xhr.onerror = () => reject(new Error('Could not reach storage. The bucket may be missing its CORS setting (see the README).'))
    xhr.onabort = () => reject(new Error('The upload was cancelled.'))
    xhr.send(file)
  })
}

export function UploadCard({ group, onDone }: { group: string; onDone: () => void }) {
  const [items, setItems] = useState<Item[]>([])
  const [busy, setBusy] = useState(false)
  const [over, setOver] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const filesRef = useRef<HTMLInputElement>(null)
  const folderRef = useRef<HTMLInputElement>(null)

  const patch = (id: number, p: Partial<Item>) => setItems((all) => all.map((i) => (i.id === id ? { ...i, ...p } : i)))

  async function runBatch(batch: Item[]) {
    let tickets: UploadTicket[]
    try {
      tickets = (await api<{ uploads: UploadTicket[] }>('/admin/resources/uploads', { method: 'POST', body: { group, files: batch.map((i) => ({ name: i.file.name, size: i.file.size })) } })).uploads
    } catch (err) {
      for (const i of batch) patch(i.id, { state: 'failed', error: errorMessage(err) })
      return
    }

    const sent: { item: Item; key: string }[] = []
    let cursor = 0
    const worker = async () => {
      while (cursor < batch.length) {
        const n = cursor++
        const item = batch[n]!
        patch(item.id, { state: 'uploading', progress: 0 })
        try {
          await putFile(tickets[n]!, item.file, (f) => patch(item.id, { progress: f }))
          patch(item.id, { state: 'sent', progress: 1 })
          sent[n] = { item, key: tickets[n]!.key }
        } catch (err) {
          patch(item.id, { state: 'failed', error: errorMessage(err) })
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(PARALLEL, batch.length) }, worker))

    // Files were sent in parallel, but they are added to the group in the order they were listed.
    const arrived = sent.filter(Boolean)
    if (arrived.length === 0) return
    try {
      const done = await api<{ created: ResourceItem[]; failed: { key: string; reason: string }[] }>('/admin/resources/uploads/complete', {
        method: 'POST',
        body: { group, files: arrived.map((s) => ({ key: s.key, title: s.item.file.name.replace(/\.pdf$/i, '').trim() })) },
      })
      const failedKeys = new Map(done.failed.map((f) => [f.key, f.reason]))
      for (const s of arrived) {
        const reason = failedKeys.get(s.key)
        patch(s.item.id, reason ? { state: 'failed', error: reason } : { state: 'added' })
      }
    } catch (err) {
      for (const s of arrived) patch(s.item.id, { state: 'failed', error: errorMessage(err) })
    }
  }

  async function start(files: File[]) {
    if (busy) return
    const { pdfs, skipped } = pickPdfs(files)
    setNotice(skipped > 0 ? `${skipped} file${skipped === 1 ? '' : 's'} that ${skipped === 1 ? 'is' : 'are'} not PDF ${skipped === 1 ? 'was' : 'were'} skipped.` : null)
    if (pdfs.length === 0) {
      if (files.length > 0) setNotice('Only PDF files can be uploaded. Nothing was added.')
      return
    }
    const batch = pdfs.map<Item>((file) => ({ id: ++nextId, file, state: 'waiting', progress: 0 }))
    setItems(batch)
    setBusy(true)
    try {
      for (let i = 0; i < batch.length; i += BATCH) await runBatch(batch.slice(i, i + BATCH))
    } finally {
      setBusy(false)
      onDone()
    }
  }

  const onDrop = async (e: DragEvent) => {
    e.preventDefault()
    setOver(false)
    if (busy) return
    await start(await filesFromDrop(e.dataTransfer))
  }

  const added = items.filter((i) => i.state === 'added').length
  const failed = items.filter((i) => i.state === 'failed').length
  const finished = items.length > 0 && !busy

  return (
    <div className="card stack">
      <div className="spread">
        <h3>Upload from your computer</h3>
        <span className="badge badge-ok">PDF, up to 200 MB each</span>
      </div>
      <div
        className={`dropzone live${over ? ' over' : ''}${busy ? ' busy' : ''}`}
        onDragOver={(e) => { e.preventDefault(); if (!busy) setOver(true) }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => void onDrop(e)}
      >
        <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" /><path d="M12 11v5M9.5 13.5 12 11l2.5 2.5" /></svg>
        <div><b>{busy ? 'Uploading…' : 'Drag and drop a folder or PDFs here'}</b></div>
        <div className="row" style={{ justifyContent: 'center' }}>
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => filesRef.current?.click()}>Browse files</button>
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => folderRef.current?.click()}>Choose a folder</button>
        </div>
        <span className="small">Added to this group in name order, so “Volume 2” comes before “Volume 10”. Each file is named after its file name; rename it afterwards in the list below.</span>
      </div>
      <input ref={filesRef} type="file" accept="application/pdf,.pdf" multiple hidden onChange={(e) => { const f = [...(e.target.files ?? [])]; e.target.value = ''; void start(f) }} />
      <input ref={folderRef} type="file" hidden multiple {...({ webkitdirectory: '' } as object)} onChange={(e) => { const f = [...(e.target.files ?? [])]; e.target.value = ''; void start(f) }} />

      {notice && <div className="alert alert-warn">{notice}</div>}

      {items.length > 0 && (
        <>
          <ul className="upload-list" aria-live="polite">
            {items.map((i) => (
              <li key={i.id} className={`upload-row ${i.state}`}>
                <span className="upload-name" title={i.file.name}>{i.file.name}</span>
                <span className="muted small upload-size">{formatBytes(i.file.size)}</span>
                <span className="upload-status small">
                  {i.state === 'waiting' && 'Waiting'}
                  {i.state === 'uploading' && `${Math.round(i.progress * 100)}%`}
                  {i.state === 'sent' && 'Finishing…'}
                  {i.state === 'added' && '✓ Added'}
                  {i.state === 'failed' && <span className="upload-err">{i.error ?? 'Failed'}</span>}
                </span>
                {(i.state === 'uploading' || i.state === 'sent') && <span className="upload-bar" aria-hidden="true"><span style={{ width: `${Math.round(i.progress * 100)}%` }} /></span>}
              </li>
            ))}
          </ul>
          {finished && (
            <div className={failed > 0 ? 'alert alert-warn' : 'alert alert-info'}>
              Added {added} of {items.length} file{items.length === 1 ? '' : 's'}.{failed > 0 && ' The ones that failed are marked above; you can pick them again.'}
              <button type="button" className="btn btn-ghost btn-sm" style={{ marginLeft: 12 }} onClick={() => setItems([])}>Clear list</button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
