import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { ErrorState, Spinner } from '../components/ui'
import { api, errorMessage } from '../lib/api'
import type { Abbreviation, AdminProfile, AlternateForm } from './types'

export function ConfigPage() {
  return (
    <div className="stack-lg">
      <Profiles />
      <AlternateForms />
      <Abbreviations />
    </div>
  )
}

function Profiles() {
  const q = useQuery({ queryKey: ['admin', 'profiles'], queryFn: () => api<{ items: AdminProfile[] }>('/admin/exam-profiles').then((r) => r.items) })
  return (
    <section className="stack">
      <div>
        <h2>Exam settings</h2>
        <p className="muted small">Speed, time, length and the comma rule. Attempts are shown as raw statistics, so there is no pass limit. The seeded numbers are from a secondary source: check them against the latest SSC notice, then tick “Checked against notice”.</p>
      </div>
      {q.isPending ? <Spinner /> : q.error ? <ErrorState error={q.error} /> : q.data.map((p) => <ProfileRow key={`${p.code}-${p.rulesVersion}`} profile={p} />)}
    </section>
  )
}

function ProfileRow({ profile }: { profile: AdminProfile }) {
  const qc = useQueryClient()
  const [p, setP] = useState(profile)
  const save = useMutation({
    mutationFn: () => api(`/admin/exam-profiles/${profile.code}`, {
      method: 'PUT',
      body: { name: p.name, wpm: p.wpm, durationMin: p.durationMin, words: p.words, rules: p.rules, active: p.active, verifiedAgainstNotice: p.verifiedAgainstNotice },
    }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin', 'profiles'] }).then(() => qc.invalidateQueries({ queryKey: ['exam-profiles'] })),
  })
  const num = (v: string) => (v === '' ? 0 : Number(v))
  return (
    <div className="card stack">
      <div className="spread">
        <div className="row"><b>{profile.code}</b>{!profile.verifiedAgainstNotice && <span className="badge badge-half">not checked against notice</span>}</div>
        <span className="muted small">grading rules v{profile.rulesVersion}</span>
      </div>
      <div className="row">
        <Field label="Name" w={200}><input className="input" value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} /></Field>
        <Field label="Speed (wpm)" w={100}><input className="input" type="number" value={p.wpm} onChange={(e) => setP({ ...p, wpm: num(e.target.value) })} /></Field>
        <Field label="Time (min)" w={100}><input className="input" type="number" value={p.durationMin} onChange={(e) => setP({ ...p, durationMin: num(e.target.value) })} /></Field>
        <Field label="Words" w={100}><input className="input" type="number" value={p.words} onChange={(e) => setP({ ...p, words: num(e.target.value) })} /></Field>
        <Field label="Commas" w={150}>
          <select className="select" value={p.rules.commas} onChange={(e) => setP({ ...p, rules: { commas: e.target.value as 'ignore' | 'half' } })}>
            <option value="ignore">Ignored</option>
            <option value="half">Half mistake</option>
          </select>
        </Field>
      </div>
      <div className="spread">
        <div className="row">
          <label className="row small"><input type="checkbox" checked={p.verifiedAgainstNotice} onChange={(e) => setP({ ...p, verifiedAgainstNotice: e.target.checked })} /> Checked against notice</label>
          <label className="row small"><input type="checkbox" checked={p.active} onChange={(e) => setP({ ...p, active: e.target.checked })} /> Available to students</label>
        </div>
        <button className="btn btn-primary btn-sm" disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'Saving…' : save.isSuccess ? 'Saved' : 'Save'}</button>
      </div>
      {save.error && <div className="alert alert-error">{errorMessage(save.error)}</div>}
    </div>
  )
}

function Field({ label, w, children }: { label: string; w: number; children: React.ReactNode }) {
  return (
    <label className="field" style={{ width: w }}>
      <span className="label">{label}</span>
      {children}
    </label>
  )
}

const splitList = (s: string) => s.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean)

function AlternateForms() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['admin', 'alt'], queryFn: () => api<{ items: AlternateForm[] }>('/admin/alternate-forms').then((r) => r.items) })
  const [canonical, setCanonical] = useState('')
  const [variants, setVariants] = useState('')
  const refresh = () => void qc.invalidateQueries({ queryKey: ['admin', 'alt'] })
  const add = useMutation({
    mutationFn: () => api('/admin/alternate-forms', { method: 'PUT', body: { canonical: canonical.trim().toLowerCase(), variants: splitList(variants) } }),
    onSuccess: () => { setCanonical(''); setVariants(''); refresh() },
  })
  const del = useMutation({ mutationFn: (c: string) => api(`/admin/alternate-forms/${encodeURIComponent(c)}`, { method: 'DELETE' }), onSuccess: refresh })
  const submit = (e: FormEvent) => { e.preventDefault(); add.mutate() }
  return (
    <section className="stack">
      <div>
        <h2>Words accepted for each other</h2>
        <p className="muted small">For example “honourable” = “hon’ble” = “hon.”. Typing any of them counts as correct.</p>
      </div>
      <div className="card stack">
        {q.isPending ? <Spinner /> : q.error ? <ErrorState error={q.error} /> : q.data.length === 0 ? <p className="muted small">None yet.</p> : q.data.map((a) => (
          <div key={a.canonical} className="spread">
            <div><b>{a.canonical}</b> <span className="muted">=</span> {a.variants.filter((v) => v !== a.canonical).join(', ')}</div>
            <button className="btn btn-danger btn-sm" disabled={del.isPending} onClick={() => del.mutate(a.canonical)}>Delete</button>
          </div>
        ))}
        <form className="row" onSubmit={submit}>
          <input className="input" style={{ width: 180 }} placeholder="Main word" aria-label="Main word" value={canonical} onChange={(e) => setCanonical(e.target.value)} />
          <input className="input grow" placeholder="Other accepted forms, separated by commas" aria-label="Other forms" value={variants} onChange={(e) => setVariants(e.target.value)} />
          <button className="btn btn-primary btn-sm" disabled={add.isPending || !canonical.trim() || splitList(variants).length === 0}>Add</button>
        </form>
        {add.error && <div className="alert alert-error">{errorMessage(add.error)}</div>}
      </div>
    </section>
  )
}

function Abbreviations() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['admin', 'abbr'], queryFn: () => api<{ items: Abbreviation[] }>('/admin/abbreviations').then((r) => r.items) })
  const [abbr, setAbbr] = useState('')
  const [exp, setExp] = useState('')
  const refresh = () => void qc.invalidateQueries({ queryKey: ['admin', 'abbr'] })
  const add = useMutation({
    mutationFn: () => api('/admin/abbreviations', { method: 'PUT', body: { abbr: abbr.trim().toLowerCase(), expansions: splitList(exp), dotted: false } }),
    onSuccess: () => { setAbbr(''); setExp(''); refresh() },
  })
  const del = useMutation({ mutationFn: (a: string) => api(`/admin/abbreviations/${encodeURIComponent(a)}`, { method: 'DELETE' }), onSuccess: refresh })
  const submit = (e: FormEvent) => { e.preventDefault(); add.mutate() }
  return (
    <section className="stack">
      <div>
        <h2>Abbreviations</h2>
        <p className="muted small">If the dictation says “government” and the student types “govt”, it is counted as an abbreviation mistake (a full mistake) rather than a spelling error.</p>
      </div>
      <div className="card stack">
        {q.isPending ? <Spinner /> : q.error ? <ErrorState error={q.error} /> : q.data.length === 0 ? <p className="muted small">None yet.</p> : q.data.map((a) => (
          <div key={a.abbr} className="spread">
            <div><b>{a.abbr}</b> <span className="muted">→</span> {a.expansions.join(', ')}</div>
            <button className="btn btn-danger btn-sm" disabled={del.isPending} onClick={() => del.mutate(a.abbr)}>Delete</button>
          </div>
        ))}
        <form className="row" onSubmit={submit}>
          <input className="input" style={{ width: 140 }} placeholder="govt" aria-label="Abbreviation" value={abbr} onChange={(e) => setAbbr(e.target.value)} />
          <input className="input grow" placeholder="Full words, separated by commas" aria-label="Expansions" value={exp} onChange={(e) => setExp(e.target.value)} />
          <button className="btn btn-primary btn-sm" disabled={add.isPending || !abbr.trim() || splitList(exp).length === 0}>Add</button>
        </form>
        {add.error && <div className="alert alert-error">{errorMessage(add.error)}</div>}
      </div>
    </section>
  )
}
