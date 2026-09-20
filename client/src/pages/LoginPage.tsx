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
const SHOW_DEV_LOGIN = import.meta.env.DEV

const GoogleMark = () => (
  <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.9 2.4 30.4 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.5 17.7 9.5 24 9.5z" />
    <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.2 5.5-4.7 7.2l7.6 5.9c4.4-4.1 6.9-10.1 6.9-17.6z" />
    <path fill="#FBBC05" d="M10.5 28.7A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.8-4.7l-7.9-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.8l7.9-6.1z" />
    <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.6-5.9c-2.1 1.4-4.9 2.3-8.3 2.3-6.3 0-11.6-4-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z" />
  </svg>
)

const steps = ['Listen to the dictation and write it in your notebook', 'Transcribe it on screen against the clock', 'See every mistake, your weak words and your progress']

export function LoginPage() {
  const { user, setUser } = useAuth()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from ?? '/'
  const [email, setEmail] = useState('')
  const [googleError, setGoogleError] = useState<string | null>(null)

  const google = useMutation({
    mutationFn: (credential: string) => api<{ user: User }>('/auth/google', { method: 'POST', body: { credential } }),
    onSuccess: (r) => setUser(r.user),
  })
  const dev = useMutation({
    mutationFn: (e: string) => api<{ user: User }>('/auth/dev-login', { method: 'POST', body: { email: e } }),
    onSuccess: (r) => setUser(r.user),
  })

  if (user) return <Navigate to={from} replace />

  const submitDev = (e: FormEvent) => {
    e.preventDefault()
    dev.mutate(email.trim())
  }
  const error = google.error ?? dev.error
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
            <h2>Welcome back</h2>
            <p className="auth-lead">Sign in with your Google account to start practising.</p>
          </div>

          <div className="auth-google">
            {GOOGLE_CLIENT_ID ? (
              <GoogleButton clientId={GOOGLE_CLIENT_ID} onCredential={(c) => google.mutate(c)} onError={setGoogleError} />
            ) : SHOW_DEV_LOGIN ? (
              <div className="auth-google-off"><GoogleMark /> Google sign-in is not set up yet</div>
            ) : (
              <div className="alert alert-warn">Google sign-in is not configured (missing VITE_GOOGLE_CLIENT_ID).</div>
            )}
          </div>

          {notInvited ? (
            <div className="alert alert-warn stack" style={{ gap: 6 }} role="alert">
              <b>Not invited yet</b>
              <span>{errorMessage(error)}</span>
              <span className="small">To use a different account, choose it in the Google button above.</span>
            </div>
          ) : (
            (error || googleError) && <div className="alert alert-error" role="alert">{error ? errorMessage(error) : googleError}</div>
          )}
          {google.isPending && <div className="muted small" style={{ textAlign: 'center' }}>Signing you in…</div>}

          {SHOW_DEV_LOGIN && (
            <>
              {/* <div className="auth-divider">local development</div> */}
              <form className="auth-dev" onSubmit={submitDev}>
                <div className="field">
                  <label className="label" htmlFor="dev-email">Email</label>
                  <input id="dev-email" className="input" type="email" required placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
                </div>
                <button className="btn btn-primary" disabled={dev.isPending || !email}>{dev.isPending ? 'Signing in…' : 'Sign in'}</button>
              </form>
            </>
          )}

          <div className="auth-foot">
            <div className="row">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
              <span>Invite-only. If Google says you have not been invited, ask the owner to add your email.</span>
            </div>
            <div>We only see your name, email address and profile photo.</div>
          </div>
        </div>
      </main>
    </div>
  )
}
