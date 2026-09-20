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
  method: 'google' | 'password' | null
  invitedAt: string | null
  joinedAt: string | null
  lastLoginAt: string | null
}
interface AccessList { members: Member[]; inviteOnly: boolean; signupOpen: boolean }
interface InviteResult { invited: string[]; already: string[]; invalid: string[] }

const STATUS = {
  active: { label: 'Active', cls: 'badge-ok' },
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
  const signout = useMutation({
    mutationFn: (email: string) => api(`/admin/access/${encodeURIComponent(email)}/signout`, { method: 'POST' }).then(() => email),
    onSuccess: (email) => setNotice(`${email} was signed out on every device. They can sign in again.`),
  })
  const setSignup = useMutation({
    mutationFn: (signupOpen: boolean) => api<{ signupOpen: boolean }>('/admin/access/settings', { method: 'PUT', body: { signupOpen } }),
    onSuccess: refresh,
  })
  const [notice, setNotice] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [sure, setSure] = useState<string | null>(null)
  const [signoutSure, setSignoutSure] = useState<string | null>(null)
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
        <p className="muted small">Decide who can join, and manage the people who have. Admins and the ALLOWED_EMAILS list are set in the server settings.</p>
      </div>

      <div className="card stack">
        <div>
          <h3>Who can create an account</h3>
          <p className="muted small">People can always sign in with Google or with an email and password. This switch decides whether they need an invite first.</p>
        </div>
        {q.data ? (
          <div className="seg" role="radiogroup" aria-label="Who can create an account">
            <button type="button" role="radio" aria-checked={q.data.signupOpen} className={`seg-btn${q.data.signupOpen ? ' on' : ''}`} disabled={setSignup.isPending} onClick={() => !q.data.signupOpen && setSignup.mutate(true)}>
              <b>Anyone</b>
              <span>Open sign-up. Anyone can create an account.</span>
            </button>
            <button type="button" role="radio" aria-checked={!q.data.signupOpen} className={`seg-btn${!q.data.signupOpen ? ' on' : ''}`} disabled={setSignup.isPending} onClick={() => q.data.signupOpen && setSignup.mutate(false)}>
              <b>Invited people only</b>
              <span>Only emails you invite below can join.</span>
            </button>
          </div>
        ) : q.isPending ? <Spinner /> : null}
        {setSignup.error && <div className="alert alert-error">{errorMessage(setSignup.error)}</div>}
      </div>

      <form className="card stack" onSubmit={submit} noValidate>
        <div>
          <h3>Invite people</h3>
          <p className="muted small">{q.data?.signupOpen === false ? 'Add the email each person will use. ' : 'Optional while sign-up is open. '}No email is sent: tell them to open the site and sign in or create an account.</p>
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
        {q.data && q.data.members.length > 6 && (
          <input className="input" type="search" placeholder="Search by name or email" aria-label="Search people" value={search} onChange={(e) => setSearch(e.target.value)} />
        )}
        {notice && <div className="alert alert-info">{notice}</div>}
        {q.isPending ? <Spinner /> : q.error ? <ErrorState error={q.error} /> : q.data.members.length === 0 ? <p className="muted small">Nobody yet.</p> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Person</th><th>Status</th><th>Joined</th><th>Last sign-in</th><th /></tr></thead>
              <tbody>
                {q.data.members.filter((m) => !search.trim() || `${m.name ?? ''} ${m.email}`.toLowerCase().includes(search.trim().toLowerCase())).map((m) => {
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
                          {m.method && <span className="badge badge-info">{m.method === 'google' ? 'Google' : 'Password'}</span>}
                        </div>
                      </td>
                      <td className="muted small">{m.joinedAt ? formatDate(m.joinedAt) : '—'}</td>
                      <td className="muted small">{m.lastLoginAt ? formatDate(m.lastLoginAt) : '—'}</td>
                      <td>
                        {m.locked ? (
                          <span className="muted small">Set in server settings</span>
                        ) : self ? null : m.status === 'removed' ? (
                          <button className="btn btn-ghost btn-sm" disabled={invite.isPending} onClick={() => invite.mutate({ list: [m.email], fromForm: false })}>Restore access</button>
                        ) : sure === m.email ? (
                          <div className="row" style={{ flexWrap: 'nowrap' }}>
                            <button className="btn btn-danger btn-sm" disabled={remove.isPending} onClick={() => { remove.mutate(m.email); setSure(null) }}>Confirm</button>
                            <button className="btn btn-ghost btn-sm" onClick={() => setSure(null)}>No</button>
                          </div>
                        ) : signoutSure === m.email ? (
                          <div className="row" style={{ flexWrap: 'nowrap' }}>
                            <button className="btn btn-danger btn-sm" disabled={signout.isPending} onClick={() => { signout.mutate(m.email); setSignoutSure(null) }}>Sign out everywhere</button>
                            <button className="btn btn-ghost btn-sm" onClick={() => setSignoutSure(null)}>No</button>
                          </div>
                        ) : (
                          <div className="row" style={{ flexWrap: 'nowrap', gap: 4 }}>
                            {m.status === 'active' && <button className="btn btn-ghost btn-sm" onClick={() => { setNotice(null); setSignoutSure(m.email) }}>Sign out</button>}
                            <button className="btn btn-ghost btn-sm" onClick={() => { setSignoutSure(null); setSure(m.email) }}>Remove access</button>
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        {(remove.error || signout.error) && <div className="alert alert-error">{errorMessage(remove.error ?? signout.error)}</div>}
      </div>
    </div>
  )
}
