import { useMutation } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Navigate, useLocation } from 'react-router'
import { useAuth } from '../auth/AuthContext'
import { GoogleButton } from '../auth/GoogleButton'
import { Logo } from '../components/AppShell'
import { ApiError, api, errorMessage } from '../lib/api'
import type { User } from '../lib/types'
import './login.css'

const GOOGLE_CLIENT_ID = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) ?? ''
const IS_DEV = import.meta.env.DEV

const GoogleMark = () => (
  <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.9 2.4 30.4 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.5 17.7 9.5 24 9.5z" />
    <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.2 5.5-4.7 7.2l7.6 5.9c4.4-4.1 6.9-10.1 6.9-17.6z" />
    <path fill="#FBBC05" d="M10.5 28.7A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.8-4.7l-7.9-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.8l7.9-6.1z" />
    <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.6-5.9c-2.1 1.4-4.9 2.3-8.3 2.3-6.3 0-11.6-4-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z" />
  </svg>
)

const steps = ['Listen to the dictation and write it in your notebook', 'Transcribe it on screen against the clock', 'See every mistake, your weak words and your progress']

type Mode = 'signin' | 'signup'

function PasswordField({ id, label, value, onChange, autoComplete, hint, invalid }: { id: string; label: string; value: string; onChange: (v: string) => void; autoComplete: string; hint?: string; invalid?: boolean }) {
  const [shown, setShown] = useState(false)
  return (
    <div className="field">
      <label className="label" htmlFor={id}>{label}</label>
      <div className="pw-wrap">
        <input id={id} className="input" type={shown ? 'text' : 'password'} value={value} onChange={(e) => onChange(e.target.value)} autoComplete={autoComplete} aria-invalid={invalid || undefined} required maxLength={128} />
        <button type="button" className="pw-toggle" onClick={() => setShown((v) => !v)} aria-label={shown ? 'Hide password' : 'Show password'} aria-pressed={shown}>{shown ? 'Hide' : 'Show'}</button>
      </div>
      {hint && <span className="muted small">{hint}</span>}
    </div>
  )
}

export function LoginPage() {
  const { user, setUser } = useAuth()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from ?? '/'
  const [mode, setMode] = useState<Mode>('signin')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [googleError, setGoogleError] = useState<string | null>(null)

  const google = useMutation({
    mutationFn: (credential: string) => api<{ user: User }>('/auth/google', { method: 'POST', body: { credential } }),
    onSuccess: (r) => setUser(r.user),
  })
  const signin = useMutation({
    mutationFn: () => api<{ user: User }>('/auth/login', { method: 'POST', body: { email: email.trim(), password } }),
    onSuccess: (r) => setUser(r.user),
  })
  const signup = useMutation({
    mutationFn: () => api<{ user: User }>('/auth/signup', { method: 'POST', body: { name: name.trim(), email: email.trim(), password } }),
    onSuccess: (r) => setUser(r.user),
  })

  if (user) return <Navigate to={from} replace />

  const isSignup = mode === 'signup'
  const emailMutation = isSignup ? signup : signin
  const mismatch = isSignup && confirm !== '' && confirm !== password
  const tooShort = isSignup && password !== '' && password.length < 8
  const busy = emailMutation.isPending || google.isPending
  const canSubmit = !busy && email.trim() !== '' && password !== '' && (!isSignup || (name.trim() !== '' && confirm !== '' && !mismatch && !tooShort))

  const switchMode = (next: Mode) => {
    setMode(next)
    signin.reset()
    signup.reset()
    google.reset()
    setGoogleError(null)
    setPassword('')
    setConfirm('')
  }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    setGoogleError(null)
    emailMutation.mutate()
  }
  const error = google.error ?? emailMutation.error
  const notInvited = error instanceof ApiError && error.code === 'NOT_INVITED'

  return (
    <div className="auth">
      <aside className="auth-brand">
        <div className="auth-name"><Logo /><span>Steno Practice</span></div>

        <div className="auth-body">
          <span className="auth-eyebrow">SSC Stenographer · Dictation practice</span>
          <h1>Practise SSC dictation the way the exam marks it.</h1>
          <p>Listen, write, type, and get a mistake-by-mistake analysis scored with the same full-and-half-mistake rules.</p>

          <div className="auth-sample" aria-hidden="true">
            <div className="auth-sample-head"><span>Sample analysis</span><span className="badge badge-ok">Checked word by word</span></div>
            <p>
              Sir, I rise to draw the attention of the <mark className="m-full">Honourable</mark> Minister to the <mark className="m-half">risng</mark> prices<mark className="m-add">, and</mark> the Government should act now.
            </p>
            <div className="auth-sample-legend">
              <span className="badge badge-full">1 full mistake</span>
              <span className="badge badge-half">1 half mistake</span>
              <span className="badge badge-add">1 added word</span>
            </div>
          </div>
        </div>

        <ol className="auth-steps">
          {steps.map((s, i) => <li key={s}><b>{i + 1}</b>{s}</li>)}
        </ol>
      </aside>

      <main className="auth-main">
        <div className="auth-card">
          <div className="auth-mobile-brand"><Logo /><span>Steno Practice</span></div>
          <div>
            <h2>{isSignup ? 'Create your account' : 'Welcome back'}</h2>
            <p className="auth-lead">{isSignup ? 'It takes a minute. Then you can start practising.' : 'Sign in to start practising.'}</p>
          </div>

          <div className="auth-google">
            {GOOGLE_CLIENT_ID ? (
              <GoogleButton clientId={GOOGLE_CLIENT_ID} onCredential={(c) => google.mutate(c)} onError={setGoogleError} />
            ) : IS_DEV ? (
              <div className="auth-google-off"><GoogleMark /> Google sign-in is not set up yet</div>
            ) : (
              <div className="alert alert-warn">Google sign-in is not configured (missing VITE_GOOGLE_CLIENT_ID).</div>
            )}
          </div>

          <div className="auth-divider">or use your email</div>

          <form className="auth-form" onSubmit={submit} noValidate>
            {isSignup && (
              <div className="field">
                <label className="label" htmlFor="auth-name">Your name</label>
                <input id="auth-name" className="input" type="text" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={80} required />
              </div>
            )}
            <div className="field">
              <label className="label" htmlFor="auth-email">Email</label>
              <input id="auth-email" className="input" type="email" inputMode="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" spellCheck={false} required />
            </div>
            <PasswordField id="auth-password" label="Password" value={password} onChange={setPassword} autoComplete={isSignup ? 'new-password' : 'current-password'} hint={isSignup ? 'At least 8 characters. Longer is better.' : undefined} invalid={tooShort} />
            {tooShort && <div className="field-error small" role="alert">Use at least 8 characters.</div>}
            {isSignup && <PasswordField id="auth-confirm" label="Confirm password" value={confirm} onChange={setConfirm} autoComplete="new-password" invalid={mismatch} />}
            {mismatch && <div className="field-error small" role="alert">The two passwords do not match.</div>}

            <button className="btn btn-primary" disabled={!canSubmit}>
              {emailMutation.isPending ? (isSignup ? 'Creating account…' : 'Signing in…') : isSignup ? 'Create account' : 'Sign in'}
            </button>
          </form>

          {notInvited ? (
            <div className="alert alert-warn stack" style={{ gap: 6 }} role="alert">
              <b>Not invited yet</b>
              <span>{errorMessage(error)}</span>
            </div>
          ) : (
            (error || googleError) && <div className="alert alert-error" role="alert">{error ? errorMessage(error) : googleError}</div>
          )}
          {google.isPending && <div className="muted small" style={{ textAlign: 'center' }}>Signing you in…</div>}

          <p className="auth-switch">
            {isSignup ? 'Already have an account?' : 'New here?'}{' '}
            <button type="button" className="link-btn" onClick={() => switchMode(isSignup ? 'signin' : 'signup')}>{isSignup ? 'Sign in' : 'Create an account'}</button>
          </p>

          <div className="auth-foot">
            <div className="row">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
              <span>If you see “not invited”, ask the owner to add your email.</span>
            </div>
            <div>With Google we only see your name, email address and profile photo.</div>
          </div>
        </div>
      </main>
    </div>
  )
}
