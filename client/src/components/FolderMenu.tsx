import { useEffect, useRef, useState, type FormEvent } from 'react'
import { errorMessage } from '../lib/api'
import { useCreateFolder, useFolders, useSetDictationFolders } from '../lib/hooks'

/** Small popover: tick the folders a dictation belongs to, or create a new folder. */
export function FolderMenu({ dictationId, folderIds }: { dictationId: string; folderIds: string[] }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const { data: folders } = useFolders()
  const assign = useSetDictationFolders(dictationId)
  const create = useCreateFolder()

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const toggle = (id: string) => {
    const next = folderIds.includes(id) ? folderIds.filter((f) => f !== id) : [...folderIds, id]
    assign.mutate(next)
  }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const n = name.trim()
    if (!n) return
    create.mutate(n, {
      onSuccess: (r) => {
        setName('')
        assign.mutate([...folderIds, r.folder.id])
      },
    })
  }

  return (
    <div className="menu" ref={ref}>
      <button className={`icon-btn ${folderIds.length ? 'on' : ''}`} onClick={() => setOpen((o) => !o)} aria-label="Add to folder" aria-expanded={open} title="Folders">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
        </svg>
      </button>
      {open && (
        <div className="menu-panel" style={{ left: 0, right: 'auto', minWidth: 240 }}>
          <div className="label" style={{ padding: '6px 12px' }}>Folders</div>
          {(folders ?? []).length === 0 && <div className="muted small" style={{ padding: '4px 12px 8px' }}>No folders yet. Create one below.</div>}
          {(folders ?? []).map((f) => (
            <label key={f.id} className="menu-item" style={{ display: 'flex', gap: 10, alignItems: 'center', cursor: 'pointer' }}>
              <input type="checkbox" checked={folderIds.includes(f.id)} onChange={() => toggle(f.id)} />
              <span className="grow">{f.name}</span>
              <span className="muted small">{f.count}</span>
            </label>
          ))}
          <form onSubmit={submit} className="row" style={{ padding: '8px 8px 4px', flexWrap: 'nowrap' }}>
            <input className="input" style={{ minHeight: 36, padding: '6px 10px' }} placeholder="New folder…" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
            <button className="btn btn-primary btn-sm" disabled={!name.trim() || create.isPending}>Add</button>
          </form>
          {(create.error || assign.error) && <div className="alert alert-error small" style={{ margin: 8 }}>{errorMessage(create.error ?? assign.error)}</div>}
        </div>
      )}
    </div>
  )
}
