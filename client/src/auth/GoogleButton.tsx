import { useEffect, useRef } from 'react'

interface GoogleId {
  initialize: (cfg: Record<string, unknown> & { client_id: string; callback: (r: { credential: string }) => void }) => void
  renderButton: (el: HTMLElement, opts: Record<string, unknown>) => void
  /** One Tap: a small popup listing the Google accounts already signed in to this browser. */
  prompt: () => void
  cancel: () => void
  disableAutoSelect: () => void
}
declare global {
  interface Window {
    google?: { accounts: { id: GoogleId } }
  }
}

const SRC = 'https://accounts.google.com/gsi/client'

function loadScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts) return resolve()
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SRC}"]`)
    const s = existing ?? document.createElement('script')
    s.addEventListener('load', () => resolve(), { once: true })
    s.addEventListener('error', () => reject(new Error('Could not load Google sign-in')), { once: true })
    if (!existing) {
      s.src = SRC
      s.async = true
      document.head.appendChild(s)
    }
  })
}

/** Google's official "Sign in with Google" button (Google Identity Services). */
export function GoogleButton({ clientId, onCredential, onError }: { clientId: string; onCredential: (credential: string) => void; onError: (msg: string) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const cb = useRef(onCredential)
  useEffect(() => {
    cb.current = onCredential
  })

  useEffect(() => {
    let cancelled = false
    loadScript()
      .then(() => {
        if (cancelled || !ref.current || !window.google) return
        const id = window.google.accounts.id
        id.initialize({
          client_id: clientId,
          callback: (r) => cb.current(r.credential),
          context: 'signin',
          // A stray click elsewhere on the page must not dismiss One Tap (a dismissal starts a cooldown).
          cancel_on_tap_outside: false,
          // Better One Tap on Safari and Firefox.
          itp_support: true,
          // Browser-native account chooser for the button where supported (Chrome M125+); older browsers fall back to the popup.
          use_fedcm_for_button: true,
        })
        // The button shows "Continue as <name>" when this browser already has a Google session, and is the fallback when One Tap is unavailable.
        id.renderButton(ref.current, { theme: 'outline', size: 'large', shape: 'pill', text: 'continue_with', width: Math.max(200, Math.min(400, Math.floor(ref.current.offsetWidth))) })
        id.prompt()
      })
      .catch((e: Error) => onError(e.message))
    return () => {
      cancelled = true
      window.google?.accounts.id.cancel()
    }
  }, [clientId, onError])

  return <div ref={ref} style={{ minHeight: 44, width: '100%', display: 'flex', justifyContent: 'center' }} />
}
