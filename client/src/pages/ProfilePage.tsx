import { useMutation } from '@tanstack/react-query'
import { useRef, useState, type FormEvent } from 'react'
import { useAuth } from '../auth/AuthContext'
import { Avatar } from '../components/Avatar'
import { InfoTip } from '../components/InfoTip'
import { ErrorState, Spinner } from '../components/ui'
import { api, errorMessage } from '../lib/api'
import { useExamProfiles } from '../lib/hooks'
import { squarePhoto } from '../lib/image'
import { THEMES, type ThemeId } from '../lib/themes'
import type { Category, User } from '../lib/types'
import { useThemeChoice } from '../lib/useTheme'

const CameraIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
    <circle cx="12" cy="13" r="4" />
  </svg>
)

export function ProfilePage() {
  const { user } = useAuth()
  if (!user) return null
  return (
    <div className="stack-lg">
      <div className="page-header">
        <h1>Profile</h1>
        <p className="muted">Your details, your photo, and the exam you practise for.</p>
      </div>
      <IdentityCard user={user} />
      <div className="profile-grid">
        <DetailsCard user={user} />
        <ExamCard user={user} />
      </div>
      <ThemeCard />
    </div>
  )
}

/* ---------- photo, name and badges ---------- */

function IdentityCard({ user }: { user: User }) {
  const { setUser } = useAuth()
  const fileRef = useRef<HTMLInputElement>(null)
  const [problem, setProblem] = useState<string | null>(null)

  const upload = useMutation({
    mutationFn: async (file: File) => api<{ user: User }>('/me/avatar', { method: 'PUT', body: await squarePhoto(file) }),
    onSuccess: (r) => setUser(r.user),
  })

  const onPick = (file: File | undefined) => {
    if (fileRef.current) fileRef.current.value = '' // so choosing the same file again still fires
    if (!file) return
    setProblem(null)
    upload.mutate(file, { onError: (e) => setProblem(errorMessage(e)) })
  }

  const since = user.memberSince ? new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric' }).format(new Date(user.memberSince)) : null

  return (
    <section className="card profile-hero" aria-label="Your photo and name">
      <div className="profile-banner" aria-hidden="true" />
      <div className="profile-id">
        <div className="profile-photo">
          <Avatar name={user.name} picture={user.picture} size={112} />
          {upload.isPending && <span className="profile-photo-busy" role="status" aria-label="Updating photo"><span className="spinner" /></span>}
          {user.canUploadPhoto && (
            <button type="button" className="profile-cam" aria-label="Change photo" title="Change photo (JPG, PNG or WebP)" disabled={upload.isPending} onClick={() => fileRef.current?.click()}>
              <CameraIcon />
            </button>
          )}
        </div>
        <div className="profile-id-text">
          <h2>{user.name}</h2>
          <span className="muted profile-email">{user.email}</span>
          {user.bio && <p className="profile-bio">{user.bio}</p>}
          <div className="profile-chips">
            <span className="profile-tag">{user.signInMethod === 'google' ? 'Google account' : 'Email and password'}</span>
            {since && <span className="profile-tag">Member since {since}</span>}
          </div>
        </div>
      </div>
      <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => onPick(e.target.files?.[0])} />
      {problem && <div className="alert alert-error profile-alert" role="alert">{problem}</div>}
    </section>
  )
}

/* ---------- personal details ---------- */

const GENDERS: { value: NonNullable<User['gender']>; label: string }[] = [
  { value: 'female', label: 'Female' },
  { value: 'male', label: 'Male' },
  { value: 'other', label: 'Other' },
  { value: 'prefer-not-to-say', label: 'Prefer not to say' },
]
const BIO_MAX = 200

function DetailsCard({ user }: { user: User }) {
  const { setUser } = useAuth()
  const [name, setName] = useState(user.name)
  const [phone, setPhone] = useState(user.phone ?? '')
  const [gender, setGender] = useState<string>(user.gender ?? '')
  const [bio, setBio] = useState(user.bio ?? '')

  const save = useMutation({
    mutationFn: (body: { name: string; phone: string; gender: string; bio: string }) => api<{ user: User }>('/me/profile', { method: 'PATCH', body }),
    onSuccess: (r) => {
      setUser(r.user)
      setName(r.user.name)
      setPhone(r.user.phone ?? '')
      setGender(r.user.gender ?? '')
      setBio(r.user.bio ?? '')
    },
  })
  const clean = { name: name.trim(), phone: phone.trim(), gender, bio: bio.trim() }
  const changed = clean.name !== user.name || clean.phone !== (user.phone ?? '') || clean.gender !== (user.gender ?? '') || clean.bio !== (user.bio ?? '')
  const edit = <T,>(set: (v: T) => void) => (v: T) => {
    set(v)
    save.reset()
  }
  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (changed && clean.name) save.mutate(clean)
  }

  return (
    <section className="card stack" aria-labelledby="details-h">
      <div>
        <h2 id="details-h" className="card-title">Personal details</h2>
        <p className="muted small">This is how you appear in the app.</p>
      </div>
      <form className="stack grow-form" onSubmit={onSubmit} noValidate>
        <div className="field">
          <label className="label" htmlFor="pf-name">Name</label>
          <input id="pf-name" className="input" value={name} maxLength={80} autoComplete="name" onChange={(e) => edit(setName)(e.target.value)} />
        </div>
        <div className="field">
          <label className="label" htmlFor="pf-email">Email</label>
          <input id="pf-email" className="input" value={user.email} readOnly aria-describedby="pf-email-help" />
          <span id="pf-email-help" className="muted small">
            {user.signInMethod === 'google' ? 'You sign in with this Google account, so the email cannot be changed here.' : 'This is what you sign in with, so it cannot be changed here.'}
          </span>
        </div>
        <div className="field-row">
          <div className="field">
            <label className="label" htmlFor="pf-phone">Contact number <span className="muted">(optional)</span></label>
            <input id="pf-phone" className="input" type="tel" inputMode="tel" autoComplete="tel" placeholder="+91 98765 43210" value={phone} maxLength={20} onChange={(e) => edit(setPhone)(e.target.value)} />
          </div>
          <div className="field">
            <label className="label" htmlFor="pf-gender">Gender <span className="muted">(optional)</span></label>
            <select id="pf-gender" className="select" value={gender} onChange={(e) => edit(setGender)(e.target.value)}>
              <option value="">Not specified</option>
              {GENDERS.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
            </select>
          </div>
        </div>
        <div className="field">
          <label className="label" htmlFor="pf-bio">Bio <span className="muted">(optional)</span></label>
          <textarea id="pf-bio" className="textarea" rows={3} maxLength={BIO_MAX} placeholder="A line about you, for example the exam you are preparing for." value={bio} onChange={(e) => edit(setBio)(e.target.value)} />
          <span className="muted small bio-count" aria-live="polite">{bio.length}/{BIO_MAX}</span>
        </div>
        {save.error && <div className="alert alert-error" role="alert">{errorMessage(save.error)}</div>}
        <div className="row card-actions" style={{ gap: 12 }}>
          <button className="btn btn-primary" type="submit" disabled={!changed || !clean.name || save.isPending}>{save.isPending ? 'Saving…' : 'Save changes'}</button>
          {save.isSuccess && !changed && <span className="saved-note" role="status">Saved</span>}
        </div>
      </form>
    </section>
  )
}

/* ---------- exam settings (they used to have a page of their own) ---------- */

function ExamCard({ user }: { user: User }) {
  const { setUser } = useAuth()
  const profilesQ = useExamProfiles()
  const [code, setCode] = useState(user.settings.examProfile)
  const [category, setCategory] = useState<Category>(user.settings.category)

  const save = useMutation({
    mutationFn: () => api<{ user: User }>('/me/settings', { method: 'PATCH', body: { examProfile: code, category } }),
    onSuccess: (r) => setUser(r.user),
  })
  const changed = code !== user.settings.examProfile || category !== user.settings.category
  const chosen = profilesQ.data?.find((p) => p.code === code)

  return (
    <section className="card stack" aria-labelledby="exam-h">
      <div>
        <h2 id="exam-h" className="card-title">Exam settings</h2>
        <p className="muted small">Used as the starting choice each time you begin a dictation.</p>
      </div>

      {profilesQ.isPending ? <div className="center" style={{ padding: 24 }}><Spinner /></div> : profilesQ.error ? (
        <ErrorState error={profilesQ.error} onRetry={() => void profilesQ.refetch()} />
      ) : (
        <>
          <div className="field">
            <label className="label" htmlFor="pf-exam">Exam</label>
            <select id="pf-exam" className="select" value={code} onChange={(e) => { setCode(e.target.value); save.reset() }}>
              {profilesQ.data.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}
            </select>
          </div>
          <div className="field">
            <span className="label row" style={{ gap: 6 }}>
              Category
              <InfoTip label="What the category means">
                <b>It only changes the pass mark.</b> {chosen
                  ? <>For {chosen.name}, general (unreserved) candidates may make up to {chosen.limits.general}% mistakes and reserved-category candidates up to {chosen.limits.reserved}%.</>
                  : 'General (unreserved) candidates get a stricter mistake limit than reserved-category candidates.'} Pick the one that applies to you.
              </InfoTip>
            </span>
            <div className="segmented" role="group" aria-label="Category">
              <button type="button" aria-pressed={category === 'general'} onClick={() => { setCategory('general'); save.reset() }}>General</button>
              <button type="button" aria-pressed={category === 'reserved'} onClick={() => { setCategory('reserved'); save.reset() }}>Reserved</button>
            </div>
          </div>

          {chosen && (
            <>
              <dl className="exam-facts">
                <div><dt>Speed</dt><dd>{chosen.wpm}<small> wpm</small></dd></div>
                <div><dt>Time</dt><dd>{chosen.durationMin}<small> min</small></dd></div>
                <div><dt>Length</dt><dd>~{chosen.words}<small> words</small></dd></div>
                <div className="hot"><dt>Pass limit</dt><dd>{chosen.limits[category]}<small>% error</small></dd></div>
              </dl>
              {!chosen.verifiedAgainstNotice && <p className="muted small">This limit has not yet been checked against the latest SSC notice.</p>}
            </>
          )}

          {save.error && <div className="alert alert-error" role="alert">{errorMessage(save.error)}</div>}
          <div className="row card-actions" style={{ gap: 12 }}>
            <button type="button" className="btn btn-primary" disabled={!changed || save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'Saving…' : 'Save exam settings'}</button>
            {save.isSuccess && !changed && <span className="saved-note" role="status">Saved</span>}
          </div>
        </>
      )}
    </section>
  )
}

/* ---------- colour theme ---------- */

function ThemeCard() {
  const { theme, choose } = useThemeChoice()
  const [state, setState] = useState<'idle' | 'saved' | 'error'>('idle')
  const [message, setMessage] = useState('')

  const pick = (id: ThemeId) => {
    setState('idle')
    choose(id).then(
      () => setState('saved'),
      (err: unknown) => {
        setMessage(errorMessage(err))
        setState('error')
      },
    )
  }

  return (
    <section className="card stack" aria-labelledby="theme-h">
      <div className="spread">
        <div>
          <h2 id="theme-h" className="card-title">Theme</h2>
          <p className="muted small">Choose the colours you like to study in. It is saved to your account, so it follows you to every device.</p>
        </div>
        {state === 'saved' && <span className="saved-note" role="status">Saved</span>}
      </div>
      {state === 'error' && <p className="alert alert-error" role="alert">{message}</p>}
      <div className="theme-grid" role="radiogroup" aria-label="Colour theme">
        {THEMES.map((t) => (
          <label key={t.id} className={`theme-opt${t.id === theme ? ' is-selected' : ''}`} data-theme={t.id}>
            <input type="radio" name="theme" value={t.id} checked={t.id === theme} onChange={() => pick(t.id)} />
            <span className="theme-preview" aria-hidden="true">
              <span className="tp-bar"><i /><b /><b /></span>
              <span className="tp-card"><u /></span>
              <span className="tp-row"><em /><em /></span>
            </span>
            <span className="theme-meta">
              <span className="theme-name">{t.name}</span>
              <span className="muted small">{t.note}</span>
            </span>
            <svg className="theme-check" viewBox="0 0 20 20" width="20" height="20" aria-hidden="true"><circle cx="10" cy="10" r="10" fill="currentColor" /><path d="M5.5 10.3l3 3 6-6.6" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </label>
        ))}
      </div>
    </section>
  )
}
