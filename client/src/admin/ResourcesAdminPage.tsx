import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { ErrorState, Spinner } from '../components/ui'
import { api, errorMessage } from '../lib/api'
import { RESOURCE_GROUPS } from '../lib/resources'
import type { ResourceGroupKey, ResourceItem } from '../lib/types'

interface DriveImportResult {
  created: ResourceItem[]
  alreadyAdded: number
  skippedNonPdf: number
  subfolders: number
  totalPdfs: number
}

interface DraftRow { id: number; title: string; url: string }

let draftId = 0
const newRow = (): DraftRow => ({ id: ++draftId, title: '', url: '' })

const GROUPS = Object.keys(RESOURCE_GROUPS) as ResourceGroupKey[]

export function ResourcesAdminPage() {
  const [group, setGroup] = useState<ResourceGroupKey>('kc-magazines')
  return (
    <div className="stack-lg">
      <div>
        <h2>Resources</h2>
        <p className="muted small">The files students see under Resources on the home page. We only store links, so put the PDFs on Google Drive first (share as “Anyone with the link”). Then import a whole folder at once, or paste single links.</p>
      </div>
      <div className="row">
        {GROUPS.map((g) => <button key={g} className="chip" aria-pressed={g === group} onClick={() => setGroup(g)}>{RESOURCE_GROUPS[g].title}</button>)}
      </div>
      <GroupPanel key={group} group={group} />
    </div>
  )
}

function GroupPanel({ group }: { group: ResourceGroupKey }) {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['admin', 'resources', group], queryFn: () => api<{ items: ResourceItem[] }>(`/admin/resources?group=${group}`).then((r) => r.items) })
  const refresh = () => void qc.invalidateQueries({ queryKey: ['admin', 'resources'] }).then(() => qc.invalidateQueries({ queryKey: ['resources'] })).then(() => qc.invalidateQueries({ queryKey: ['resource-groups'] }))

  const [rows, setRows] = useState<DraftRow[]>(() => [newRow()])
  const [showErrors, setShowErrors] = useState(false)
  const setRow = (id: number, patchRow: Partial<DraftRow>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patchRow } : r)))
  const filled = rows.filter((r) => r.title.trim() || r.url.trim())
  const rowProblem = (r: DraftRow) => (!r.title.trim() ? 'Add a title' : !/^https?:\/\/\S+$/i.test(r.url.trim()) ? 'Link must start with https://' : '')
  const addMany = useMutation({
    mutationFn: (batch: DraftRow[]) => api<{ created: ResourceItem[]; skipped: { line: string; reason: string }[] }>('/admin/resources/bulk', {
      method: 'POST',
      body: { group, text: batch.map((r) => `${r.title.replace(/\s+/g, ' ').trim()} | ${r.url.trim()}`).join('\n') },
    }),
    onSuccess: (res, batch) => {
      const rejected = new Set(res.skipped.map((x) => x.line))
      const left = batch.filter((r) => rejected.has(`${r.title.replace(/\s+/g, ' ').trim()} | ${r.url.trim()}`))
      setRows(left.length ? left : [newRow()])
      setShowErrors(false)
      refresh()
    },
  })
  const submitRows = (e: FormEvent) => {
    e.preventDefault()
    if (filled.length === 0) return
    if (filled.some((r) => rowProblem(r))) { setShowErrors(true); return }
    addMany.mutate(filled)
  }
  const [folder, setFolder] = useState('')
  const importFolder = useMutation({
    mutationFn: () => api<DriveImportResult>('/admin/resources/import-drive-folder', { method: 'POST', body: { group, folder: folder.trim() } }),
    onSuccess: (r) => { if (r.created.length > 0 || r.alreadyAdded > 0) setFolder(''); refresh() },
  })
  const patch = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<ResourceItem> }) => api(`/admin/resources/${id}`, { method: 'PATCH', body }),
    onSuccess: refresh,
  })
  const del = useMutation({ mutationFn: (id: string) => api(`/admin/resources/${id}`, { method: 'DELETE' }), onSuccess: refresh })

  return (
    <div className="stack-lg">
      <div className="card stack">
        <div className="spread">
          <h3>Import from a Google Drive folder</h3>
          <span className="badge badge-info">Fastest</span>
        </div>
        <p className="muted small">Share the folder as “Anyone with the link”, paste its link, and every PDF inside is added as a file (named after the file, in natural order). Run it again after adding new files: ones already listed are skipped.</p>
        <div className="row" style={{ flexWrap: 'nowrap' }}>
          <input className="input" value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="https://drive.google.com/drive/folders/…" aria-label="Drive folder link" />
          <button className="btn btn-primary" style={{ whiteSpace: 'nowrap' }} disabled={importFolder.isPending || !folder.trim()} onClick={() => importFolder.mutate()}>{importFolder.isPending ? 'Reading folder…' : 'Import files'}</button>
        </div>
        {importFolder.error && <div className="alert alert-error">{errorMessage(importFolder.error)}</div>}
        {importFolder.data && (
          <div className={importFolder.data.totalPdfs === 0 ? 'alert alert-warn' : 'alert alert-info'}>
            {importFolder.data.totalPdfs === 0 ? 'No PDF files were found in that folder.' : `Added ${importFolder.data.created.length} of ${importFolder.data.totalPdfs} PDFs${importFolder.data.alreadyAdded ? ` (${importFolder.data.alreadyAdded} were already listed)` : ''}.`}
            {importFolder.data.skippedNonPdf > 0 && <div>{importFolder.data.skippedNonPdf} file{importFolder.data.skippedNonPdf === 1 ? '' : 's'} that are not PDFs were skipped.</div>}
            {importFolder.data.subfolders > 0 && <div>{importFolder.data.subfolders} subfolder{importFolder.data.subfolders === 1 ? '' : 's'} were not opened: import each one separately.</div>}
          </div>
        )}
      </div>

      <div className="card stack" aria-disabled="true">
        <div className="spread">
          <h3>Upload from your computer</h3>
          <span className="badge badge-half">Coming soon</span>
        </div>
        <div className="dropzone" aria-hidden="true">
          <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" /><path d="M12 11v5M9.5 13.5 12 11l2.5 2.5" /></svg>
          <div><b>Drag and drop a folder or PDFs here</b></div>
          <button className="btn btn-ghost btn-sm" disabled tabIndex={-1}>Browse files</button>
        </div>
        <p className="muted small">Until file storage is set up, add files with a Drive folder or links.</p>
      </div>

      <form className="card stack" onSubmit={submitRows} noValidate>
        <div>
          <h3>Add files by link</h3>
          <p className="muted small">Add one or more. Use “Add another” for more rows.</p>
        </div>
        <div className="stack">
          {rows.map((r, i) => {
            const problem = showErrors && (r.title.trim() || r.url.trim()) ? rowProblem(r) : ''
            return (
              <div key={r.id} className="entry-row">
                <div className="field entry-title">
                  <label className="label" htmlFor={`row-title-${r.id}`}>{i === 0 ? 'Title' : `Title ${i + 1}`}</label>
                  <input id={`row-title-${r.id}`} className="input" value={r.title} onChange={(e) => setRow(r.id, { title: e.target.value })} placeholder="Volume 24" />
                </div>
                <div className="field grow entry-link">
                  <label className="label" htmlFor={`row-url-${r.id}`}>{i === 0 ? 'Link' : `Link ${i + 1}`}</label>
                  <input id={`row-url-${r.id}`} className="input" value={r.url} onChange={(e) => setRow(r.id, { url: e.target.value })} placeholder="https://drive.google.com/file/d/…/view" />
                </div>
                {rows.length > 1 && (
                  <button type="button" className="icon-btn" aria-label={`Remove row ${i + 1}`} title="Remove" onClick={() => setRows((rs) => rs.filter((x) => x.id !== r.id))}>×</button>
                )}
                {problem && <div className="entry-error small">{problem}</div>}
              </div>
            )
          })}
        </div>
        <div className="spread">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRows((rs) => [...rs, newRow()])}>+ Add another</button>
          <button className="btn btn-primary" disabled={addMany.isPending || filled.length === 0}>{addMany.isPending ? 'Adding…' : filled.length > 1 ? `Add ${filled.length} files` : 'Add file'}</button>
        </div>
        {addMany.error && <div className="alert alert-error">{errorMessage(addMany.error)}</div>}
        {addMany.data && (
          <div className={addMany.data.skipped.length ? 'alert alert-warn' : 'alert alert-info'}>
            Added {addMany.data.created.length}.
            {addMany.data.skipped.map((s) => <div key={s.line}>Not added “{s.line}”: {s.reason}</div>)}
          </div>
        )}
      </form>

      <div className="card stack">
        <div className="spread">
          <h3>Files in this group</h3>
          {q.data && <span className="muted small">{q.data.length} file{q.data.length === 1 ? '' : 's'}</span>}
        </div>
        {q.isPending ? <Spinner /> : q.error ? <ErrorState error={q.error} /> : q.data.length === 0 ? <p className="muted small">Nothing added yet.</p> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Title</th><th>Link</th><th>Shown</th><th /></tr></thead>
              <tbody>
                {q.data.map((r) => (
                  <ResourceRow key={`${r.id}-${r.title}-${r.url}`} r={r} busy={patch.isPending || del.isPending}
                    onSave={(body) => patch.mutate({ id: r.id, body })} onDelete={() => del.mutate(r.id)} />
                ))}
              </tbody>
            </table>
          </div>
        )}
        {(patch.error || del.error) && <div className="alert alert-error">{errorMessage(patch.error ?? del.error)}</div>}
      </div>
    </div>
  )
}

function ResourceRow({ r, busy, onSave, onDelete }: { r: ResourceItem; busy: boolean; onSave: (b: Partial<ResourceItem>) => void; onDelete: () => void }) {
  const [title, setTitle] = useState(r.title)
  const [url, setUrl] = useState(r.url)
  const [sure, setSure] = useState(false)
  const dirty = title.trim() !== r.title || url.trim() !== r.url
  return (
    <tr>
      <td><input className="input" style={{ minWidth: 150 }} value={title} onChange={(e) => setTitle(e.target.value)} aria-label={`Title of ${r.title}`} /></td>
      <td><input className="input" style={{ minWidth: 220 }} value={url} onChange={(e) => setUrl(e.target.value)} aria-label={`Link of ${r.title}`} /></td>
      <td><label className="row small"><input type="checkbox" checked={r.published} disabled={busy} onChange={(e) => onSave({ published: e.target.checked })} /> Visible</label></td>
      <td>
        <div className="row" style={{ flexWrap: 'nowrap' }}>
          {dirty ? (
            <>
              <button className="btn btn-primary btn-sm" disabled={busy || !title.trim() || !url.trim()} onClick={() => onSave({ title: title.trim(), url: url.trim() })}>Save changes</button>
              <button className="btn btn-ghost btn-sm" onClick={() => { setTitle(r.title); setUrl(r.url) }}>Undo</button>
            </>
          ) : <span className="saved-tag small">✓ Saved</span>}
          {sure ? (
            <>
              <button className="btn btn-danger btn-sm" disabled={busy} onClick={onDelete}>Confirm</button>
              <button className="btn btn-ghost btn-sm" onClick={() => setSure(false)}>No</button>
            </>
          ) : <button className="btn btn-ghost btn-sm" onClick={() => setSure(true)}>Delete</button>}
        </div>
      </td>
    </tr>
  )
}
