import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type ClipboardEvent, type FormEvent } from 'react'
import { useAuth } from '../auth/AuthContext'
import { ErrorState, Spinner } from '../components/ui'
import { api, errorMessage } from '../lib/api'
import { formatDate } from '../lib/format'

interface Member {
  email: string
  name: string | null
  picture: string | null
  role: 'admin' | 'user'
  status: 'invited' | 'active' | 'removed'
  locked: 'admin' | 'server' | null
  invitedAt: string | null
  lastLoginAt: string | null
}
interface AccessList { members: Member[]; inviteOnly: boolean }
interface InviteResult { invited: string[]; already: string[]; invalid: string[] }

const STATUS = {
  active: { label: 'Signed in before', cls: 'badge-ok' },
  invited: { label: 'Invited, not joined yet', cls: 'badge-info' },
  removed: { label: 'No access', cls: 'badge-full' },
} as const

const splitEmails = (text: string) => text.split(/[\s,;]+/).map((e) => e.trim()).filter(Boolean)
const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/

interface DraftRow { id: number; email: string }
let draftId = 0
const newRow = (email = ''): DraftRow => ({ id: ++draftId, email })

export function AccessPage() {
  const qc = useQueryClient()
  const { user } = useAuth()
  const q = useQuery({ queryKey: ['admin', 'access'], queryFn: () => api<AccessList>('/admin/access') })
  const refresh = () => void qc.invalidateQueries({ queryKey: ['admin', 'access'] })

  const [rows, setRows] = useState<DraftRow[]>(() => [newRow()])
  const [showErrors, setShowErrors] = useState(false)
  const filled = rows.filter((r) => r.email.trim())
  const setEmail = (id: number, value: string) => {
    const parts = splitEmails(value)
    // Pasting several emails at once (comma, space or new line separated) spreads them over rows.
    if (parts.length > 1) {
      setRows((rs) => {
        const at = rs.findIndex((r) => r.id === id)
        return [...rs.slice(0, at), ...parts.map((e) => newRow(e)), ...rs.slice(at + 1)]
      })
    } else {
      setRows((rs) => rs.map((r) => (r.id === id ? { ...r, email: parts[0] ?? '' } : r)))
    }
  }
  /** Pasting a list (new lines included) becomes one row per email. */
  const onPaste = (id: number, e: ClipboardEvent<HTMLInputElement>) => {
    const parts = splitEmails(e.clipboardData.getData('text'))
    if (parts.length < 2) return
    e.preventDefault()
    setRows((rs) => {
      const at = rs.findIndex((r) => r.id === id)
      const replace = rs[at]!.email.trim() === ''
      return [...rs.slice(0, replace ? at : at + 1), ...parts.map((x) => newRow(x)), ...rs.slice(at + 1)]
    })
  }
  const invite = useMutation({
    mutationFn: ({ list }: { list: string[]; fromForm: boolean }) => api<InviteResult>('/admin/access', { method: 'POST', body: { emails: list } }),
    onSuccess: (r, v) => {
      if (v.fromForm) {
        // Keep only the rows the server rejected, so they can be fixed.
        setRows(r.invalid.length ? r.invalid.map((e) => newRow(e)) : [newRow()])
        setShowErrors(false)
      }
      refresh()
    },
  })
  const remove = useMutation({
    mutationFn: (email: string) => api(`/admin/access/${encodeURIComponent(email)}`, { method: 'DELETE' }),
    onSuccess: refresh,
  })
  const [sure, setSure] = useState<string | null>(null)
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (filled.length === 0) return
    if (filled.some((r) => !EMAIL_RE.test(r.email.trim()))) { setShowErrors(true); return }
    invite.mutate({ list: filled.map((r) => r.email.trim()), fromForm: true })
  }

  return (
    <div className="stack-lg">
      <div>
        <h2>Access</h2>
        <p className="muted small">Only people on this list can sign in with Google. Everyone else sees a “not invited” message with their email. Admins and the ALLOWED_EMAILS list are set in the server settings.</p>
      </div>

      {q.data && !q.data.inviteOnly && (
        <div className="alert alert-warn">Sign-in is open right now because nobody has been invited yet (this only happens locally). Invite the first person to switch to invite-only.</div>
      )}

      <form className="card stack" onSubmit={submit} noValidate>
        <div>
          <h3>Invite people</h3>
          <p className="muted small">Add the Google account email of each person. No email is sent: tell them to open the site and sign in.</p>
        </div>
        <div className="stack">
          {rows.map((r, i) => {
            const bad = showErrors && r.email.trim() !== '' && !EMAIL_RE.test(r.email.trim())
            return (
              <div key={r.id} className="entry-row">
                <div className="field grow entry-link">
                  <label className="label" htmlFor={`invite-${r.id}`}>{i === 0 ? 'Email' : `Email ${i + 1}`}</label>
                  <input id={`invite-${r.id}`} className="input" type="text" inputMode="email" value={r.email} onChange={(e) => setEmail(r.id, e.target.value)} onPaste={(e) => onPaste(r.id, e)} placeholder="friend@gmail.com" autoComplete="off" spellCheck={false} />
                </div>
                {rows.length > 1 && (
                  <button type="button" className="icon-btn" aria-label={`Remove row ${i + 1}`} title="Remove" onClick={() => setRows((rs) => rs.filter((x) => x.id !== r.id))}>×</button>
                )}
                {bad && <div className="entry-error small">Enter a full email address, like name@gmail.com</div>}
              </div>
            )
          })}
        </div>
        <div className="spread">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRows((rs) => [...rs, newRow()])}>+ Add another</button>
          <button className="btn btn-primary" disabled={invite.isPending || filled.length === 0}>{invite.isPending ? 'Inviting…' : filled.length > 1 ? `Invite ${filled.length} people` : 'Invite'}</button>
        </div>
        {invite.error && <div className="alert alert-error">{errorMessage(invite.error)}</div>}
        {invite.data && (
          <div className={invite.data.invalid.length ? 'alert alert-warn' : 'alert alert-info'}>
            {invite.data.invited.length ? `Invited ${invite.data.invited.length}: ${invite.data.invited.join(', ')}.` : 'Nobody new was invited.'}
            {invite.data.already.length > 0 && <div>Already on the list: {invite.data.already.join(', ')}.</div>}
            {invite.data.invalid.length > 0 && <div>Not a valid email (left in the form): {invite.data.invalid.join(', ')}.</div>}
          </div>
        )}
      </form>

      <div className="card stack">
        <div className="spread">
          <h3>People</h3>
          {q.data && <span className="muted small">{q.data.members.length} total</span>}
        </div>
        {q.isPending ? <Spinner /> : q.error ? <ErrorState error={q.error} /> : q.data.members.length === 0 ? <p className="muted small">Nobody yet.</p> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Person</th><th>Status</th><th>Last sign-in</th><th /></tr></thead>
              <tbody>
                {q.data.members.map((m) => {
                  const st = STATUS[m.status]
                  const self = m.email === user?.email
                  return (
                    <tr key={m.email}>
                      <td>
                        <div className="row" style={{ flexWrap: 'nowrap', gap: 10 }}>
                          <div className="avatar" aria-hidden="true">{m.picture ? <img src={m.picture} alt="" referrerPolicy="no-referrer" /> : (m.name ?? m.email)[0]!.toUpperCase()}</div>
                          <div>
                            <div><b>{m.name ?? m.email}</b>{self && <span className="muted small"> (you)</span>}</div>
                            {m.name && <div className="muted small">{m.email}</div>}
                          </div>
                        </div>
                      </td>
                      <td>
                        <div className="row" style={{ gap: 6 }}>
                          <span className={`badge ${st.cls}`}>{st.label}</span>
                          {m.role === 'admin' && <span className="badge badge-half">Admin</span>}
                        </div>
                      </td>
                      <td className="muted small">{m.lastLoginAt ? formatDate(m.lastLoginAt) : '—'}</td>
                      <td>
                        {m.locked ? (
                          <span className="muted small">Set in server settings</span>
                        ) : self ? null : m.status === 'removed' ? (
                          <button className="btn btn-ghost btn-sm" disabled={invite.isPending} onClick={() => invite.mutate({ list: [m.email], fromForm: false })}>Re-invite</button>
                        ) : sure === m.email ? (
                          <div className="row" style={{ flexWrap: 'nowrap' }}>
                            <button className="btn btn-danger btn-sm" disabled={remove.isPending} onClick={() => { remove.mutate(m.email); setSure(null) }}>Confirm</button>
                            <button className="btn btn-ghost btn-sm" onClick={() => setSure(null)}>No</button>
                          </div>
                        ) : <button className="btn btn-ghost btn-sm" onClick={() => setSure(m.email)}>Remove access</button>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        {remove.error && <div className="alert alert-error">{errorMessage(remove.error)}</div>}
      </div>
    </div>
  )
}
