import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { ErrorState, Spinner } from '../components/ui'
import { api, errorMessage } from '../lib/api'
import { formatBytes } from '../lib/format'
import type { ResourceGroup, ResourceItem } from '../lib/types'
import { UploadCard } from './UploadCard'

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


/** Everything that shows groups or files, on both the admin and the student side, has to look again after a change. */
function useRefreshResources() {
  const qc = useQueryClient()
  return () => void Promise.all([
    qc.invalidateQueries({ queryKey: ['admin', 'resources'] }),
    qc.invalidateQueries({ queryKey: ['admin', 'resource-groups'] }),
    qc.invalidateQueries({ queryKey: ['resources'] }),
    qc.invalidateQueries({ queryKey: ['resource-groups'] }),
  ])
}

export function ResourcesAdminPage() {
  const groupsQ = useQuery({ queryKey: ['admin', 'resource-groups'], queryFn: () => api<{ items: ResourceGroup[] }>('/admin/resource-groups').then((r) => r.items) })
  const [selected, setSelected] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const groups = groupsQ.data ?? []
  const current = groups.find((g) => g.group === selected) ?? groups[0]

  return (
    <div className="stack-lg">
      <div>
        <h2>Resources</h2>
        <p className="muted small">The files students see under Resources on the home page. Make a group for each kind of material (a magazine series, the syllabus, announcements), then upload PDFs from your computer, import a Google Drive folder, or paste links.</p>
      </div>

      {groupsQ.isPending ? <Spinner /> : groupsQ.error ? <ErrorState error={groupsQ.error} onRetry={() => void groupsQ.refetch()} /> : (
        <>
          <div className="row">
            {groups.map((g) => (
              <button key={g.group} className="chip" aria-pressed={!creating && g.group === current?.group} onClick={() => { setCreating(false); setSelected(g.group) }}>
                {g.title}<span className="chip-count">{g.count ?? 0}</span>{!g.published && <span className="chip-count"> · hidden</span>}
              </button>
            ))}
            <button className="chip chip-new" aria-pressed={creating} onClick={() => setCreating(true)}>+ New group</button>
          </div>

          {(creating || groups.length === 0) && <NewGroupForm first={groups.length === 0} onCancel={groups.length > 0 ? () => setCreating(false) : undefined} onCreated={(g) => { setCreating(false); setSelected(g.group) }} />}
          {!creating && current && <GroupPanel key={current.group} group={current.group} meta={current} onGone={() => setSelected(null)} />}
        </>
      )}
    </div>
  )
}

function NewGroupForm({ first, onCancel, onCreated }: { first: boolean; onCancel?: () => void; onCreated: (g: ResourceGroup) => void }) {
  const refresh = useRefreshResources()
  const [title, setTitle] = useState('')
  const [blurb, setBlurb] = useState('')
  const create = useMutation({
    mutationFn: () => api<{ item: ResourceGroup }>('/admin/resource-groups', { method: 'POST', body: { title: title.trim(), blurb: blurb.trim() } }).then((r) => r.item),
    onSuccess: (g) => { refresh(); onCreated(g) },
  })
  return (
    <form className="card stack" onSubmit={(e) => { e.preventDefault(); if (title.trim()) create.mutate() }}>
      <div>
        <h3>{first ? 'Create your first group' : 'New group'}</h3>
        <p className="muted small">A group is a shelf on the student Resources area, for example “Syllabus” or “Announcements”. Students see it once it has a name; you can hide it any time.</p>
      </div>
      <div className="field">
        <label className="label" htmlFor="grp-title">Name</label>
        <input id="grp-title" className="input" value={title} maxLength={80} placeholder="Syllabus" autoFocus onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="field">
        <label className="label" htmlFor="grp-blurb">Short description <span className="muted">(optional)</span></label>
        <input id="grp-blurb" className="input" value={blurb} maxLength={200} placeholder="The official SSC Stenographer syllabus and exam pattern." onChange={(e) => setBlurb(e.target.value)} />
      </div>
      {create.error && <div className="alert alert-error">{errorMessage(create.error)}</div>}
      <div className="row">
        <button className="btn btn-primary" disabled={!title.trim() || create.isPending}>{create.isPending ? 'Creating…' : 'Create group'}</button>
        {onCancel && <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>}
      </div>
    </form>
  )
}

/** Rename, describe, hide or delete the group. A group that still has files cannot be deleted. */
function GroupSettings({ meta, onGone }: { meta: ResourceGroup; onGone: () => void }) {
  const refresh = useRefreshResources()
  const [title, setTitle] = useState(meta.title)
  const [blurb, setBlurb] = useState(meta.blurb)
  const [sure, setSure] = useState(false)
  const save = useMutation({
    mutationFn: (body: Partial<Pick<ResourceGroup, 'title' | 'blurb' | 'published'>>) => api(`/admin/resource-groups/${meta.id}`, { method: 'PATCH', body }),
    onSuccess: refresh,
  })
  const del = useMutation({ mutationFn: () => api(`/admin/resource-groups/${meta.id}`, { method: 'DELETE' }), onSuccess: () => { refresh(); onGone() } })
  const dirty = title.trim() !== meta.title || blurb.trim() !== meta.blurb
  const hasFiles = (meta.count ?? 0) > 0
  return (
    <div className="card stack">
      <div>
        <h3>Group settings</h3>
        <p className="muted small">Students open this group at /resources/{meta.group}. Its address stays the same if you rename it.</p>
      </div>
      <div className="entry-row">
        <div className="field entry-title">
          <label className="label" htmlFor="gs-title">Name</label>
          <input id="gs-title" className="input" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="field grow entry-link">
          <label className="label" htmlFor="gs-blurb">Short description</label>
          <input id="gs-blurb" className="input" value={blurb} maxLength={200} onChange={(e) => setBlurb(e.target.value)} />
        </div>
        <button className="btn btn-primary" disabled={!dirty || !title.trim() || save.isPending} onClick={() => save.mutate({ title: title.trim(), blurb: blurb.trim() })}>{save.isPending ? 'Saving…' : 'Save'}</button>
      </div>
      <div className="spread">
        <label className="row small"><input type="checkbox" checked={meta.published} disabled={save.isPending} onChange={(e) => save.mutate({ published: e.target.checked })} /> Visible to students</label>
        <div className="row">
          {hasFiles && <span className="muted small">Delete its {meta.count} file{meta.count === 1 ? '' : 's'} first to remove the group.</span>}
          {sure ? (
            <>
              <button className="btn btn-danger btn-sm" disabled={del.isPending} onClick={() => del.mutate()}>Confirm delete</button>
              <button className="btn btn-ghost btn-sm" onClick={() => setSure(false)}>No</button>
            </>
          ) : <button className="btn btn-ghost btn-sm" disabled={hasFiles} onClick={() => setSure(true)}>Delete group</button>}
        </div>
      </div>
      {(save.error || del.error) && <div className="alert alert-error">{errorMessage(save.error ?? del.error)}</div>}
    </div>
  )
}

function GroupPanel({ group, meta, onGone }: { group: string; meta: ResourceGroup; onGone: () => void }) {
  const q = useQuery({ queryKey: ['admin', 'resources', group], queryFn: () => api<{ items: ResourceItem[] }>(`/admin/resources?group=${group}`).then((r) => r.items) })
  const refresh = useRefreshResources()

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

      <UploadCard group={group} onDone={refresh} />

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
          <h3>Files in {meta.title}</h3>
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

      <GroupSettings key={`${meta.id}-${meta.title}-${meta.blurb}`} meta={meta} onGone={onGone} />
    </div>
  )
}

function ResourceRow({ r, busy, onSave, onDelete }: { r: ResourceItem; busy: boolean; onSave: (b: Partial<ResourceItem>) => void; onDelete: () => void }) {
  const [title, setTitle] = useState(r.title)
  const [url, setUrl] = useState(r.url)
  const [sure, setSure] = useState(false)
  const dirty = title.trim() !== r.title || (!r.uploaded && url.trim() !== r.url)
  return (
    <tr>
      <td><input className="input" style={{ minWidth: 150 }} value={title} onChange={(e) => setTitle(e.target.value)} aria-label={`Title of ${r.title}`} /></td>
      <td>
        {r.uploaded ? (
          <span className="small">Uploaded PDF{r.size !== null ? ` · ${formatBytes(r.size)}` : ''} · <a href={r.url} target="_blank" rel="noopener noreferrer">Open</a></span>
        ) : (
          <input className="input" style={{ minWidth: 220 }} value={url} onChange={(e) => setUrl(e.target.value)} aria-label={`Link of ${r.title}`} />
        )}
      </td>
      <td><label className="row small"><input type="checkbox" checked={r.published} disabled={busy} onChange={(e) => onSave({ published: e.target.checked })} /> Visible</label></td>
      <td>
        <div className="row" style={{ flexWrap: 'nowrap' }}>
          {dirty ? (
            <>
              <button className="btn btn-primary btn-sm" disabled={busy || !title.trim() || (!r.uploaded && !url.trim())} onClick={() => onSave(r.uploaded ? { title: title.trim() } : { title: title.trim(), url: url.trim() })}>Save changes</button>
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
