import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import { ErrorState, Spinner } from '../components/ui'
import { api, errorMessage } from '../lib/api'
import { useExamProfiles } from '../lib/hooks'
import type { Category, User } from '../lib/types'

export function SettingsPage() {
  const { user, setUser } = useAuth()
  const profilesQ = useExamProfiles()
  const [profile, setProfile] = useState(user?.settings.examProfile ?? 'SSC_C')
  const [category, setCategory] = useState<Category>(user?.settings.category ?? 'general')

  const save = useMutation({
    mutationFn: () => api<{ user: User }>('/me/settings', { method: 'PATCH', body: { examProfile: profile, category } }),
    onSuccess: (r) => setUser(r.user),
  })

  if (profilesQ.isPending) return <Spinner full />
  if (profilesQ.error) return <ErrorState error={profilesQ.error} onRetry={() => void profilesQ.refetch()} />
  const chosen = profilesQ.data.find((p) => p.code === profile)

  return (
    <div className="stack-lg" style={{ maxWidth: 640 }}>
      <div className="page-header">
        <h1>Exam settings</h1>
        <p className="muted">These are used as the defaults each time you start a dictation.</p>
      </div>
      <div className="card stack">
        <div className="field">
          <label className="label" htmlFor="exam">Exam</label>
          <select id="exam" className="select" value={profile} onChange={(e) => setProfile(e.target.value)}>
            {profilesQ.data.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}
          </select>
        </div>
        <div className="field">
          <span className="label">Category</span>
          <div className="segmented" role="group" aria-label="Category">
            <button aria-pressed={category === 'general'} onClick={() => setCategory('general')}>General</button>
            <button aria-pressed={category === 'reserved'} onClick={() => setCategory('reserved')}>Reserved</button>
          </div>
        </div>
        {chosen && (
          <div className="alert alert-info">
            {chosen.name}: {chosen.wpm} wpm · {chosen.durationMin} min to transcribe · ~{chosen.words} words · pass limit {chosen.limits[category]}% error.
            {!chosen.verifiedAgainstNotice && ' This limit has not yet been checked against the latest SSC notice.'}
          </div>
        )}
        {save.error && <div className="alert alert-error">{errorMessage(save.error)}</div>}
        {save.isSuccess && <div className="alert alert-info">Saved.</div>}
        <div><button className="btn btn-primary" onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save'}</button></div>
      </div>
    </div>
  )
}
