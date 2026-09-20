import { useMutation, useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useAuth } from '../auth/AuthContext'
import { InfoTip } from '../components/InfoTip'
import { ReportModal } from '../components/ReportModal'
import { ErrorState, Spinner } from '../components/ui'
import { YouTubePlayer } from '../components/YouTubePlayer'
import { api, errorMessage, qs } from '../lib/api'
import { formatDate, formatPct } from '../lib/format'
import { useExamProfiles } from '../lib/hooks'
import type { Attempt, AttemptSummary, Category, Dictation, DictationSet, Paged, TranscriptResponse } from '../lib/types'

const DEFAULT_RATES = [0.5, 0.75, 1, 1.25, 1.5]

interface Progress {
  attempts: { id: string; submittedAt: string; errorPct: number | null; passed: boolean | null }[]
  bestErrorPct: number | null
  avgErrorPct: number | null
}

export function DictationPage() {
  const { id = '' } = useParams()
  const { user } = useAuth()
  const navigate = useNavigate()

  const dictQ = useQuery({ queryKey: ['dictation', id], queryFn: () => api<{ dictation: Dictation }>(`/dictations/${id}`).then((r) => r.dictation) })
  const profilesQ = useExamProfiles()
  const draftQ = useQuery({ queryKey: ['attempts', 'draft', id], queryFn: () => api<Paged<AttemptSummary>>(`/attempts${qs({ dictationId: id, status: 'draft' })}`) })
  const progressQ = useQuery({ queryKey: ['progress', id], queryFn: () => api<Progress>(`/analytics/dictations/${id}`) })

  const [videoIdx, setVideoIdx] = useState(0)
  const [rate, setRate] = useState(1)
  const [rates, setRates] = useState<number[]>(DEFAULT_RATES)
  const [profile, setProfile] = useState(user?.settings.examProfile ?? 'SSC_C')
  const [category, setCategory] = useState<Category>(user?.settings.category ?? 'general')
  const [reporting, setReporting] = useState(false)
  const [showTranscript, setShowTranscript] = useState(false)
  const setsQ = useQuery({ queryKey: ['sets'], queryFn: () => api<{ items: DictationSet[] }>('/sets').then((r) => r.items) })
  const transcriptQ = useQuery({
    queryKey: ['transcript', id],
    enabled: showTranscript,
    staleTime: 5 * 60_000,
    queryFn: () => api<TranscriptResponse>(`/dictations/${id}/transcript`),
  })

  const start = useMutation({
    mutationFn: (listenedWpm: number | undefined) =>
      api<{ attempt: Attempt }>(`/dictations/${id}/attempts`, { method: 'POST', body: { examProfile: profile, category, listenedWpm } }),
    onSuccess: (r) => navigate(`/attempts/${r.attempt.id}/write`),
  })

  const video = dictQ.data?.videos[videoIdx]
  const selectableRates = useMemo(() => rates.filter((r) => r >= 0.5 && r <= 1.5), [rates])
  const effectiveWpm = video ? Math.round(video.baseWpm * rate) : null
  const chosenProfile = profilesQ.data?.find((p) => p.code === profile)

  if (dictQ.isPending) return <Spinner full />
  if (dictQ.error) return <ErrorState error={dictQ.error} onRetry={() => void dictQ.refetch()} />
  const d = dictQ.data
  const hasDraft = (draftQ.data?.items.length ?? 0) > 0

  return (
    <div className="stack-lg">
      <div className="page-header">
        {(() => {
          const set = setsQ.data?.find((x) => x.id === d.setId)
          return <Link to={set ? `/practice/${set.slug}` : '/'} className="small">← {set ? set.title : 'Home'}</Link>
        })()}
        <h1>{d.title}</h1>
        <p className="muted">Step 1 of 2 · Listen and write in your notebook. When you are ready, transcribe it on screen.</p>
      </div>

      <div className="listen-grid">
        <div className="stack">
          {!d.ready || !video ? (
            <div className="alert alert-warn">This dictation is not ready yet.</div>
          ) : (
            <>
              {d.videos.length > 1 && (
                <div className="row">
                  <span className="label">Dictation speed</span>
                  <div className="segmented" role="group" aria-label="Video speed">
                    {d.videos.map((v, i) => (
                      <button key={v.youtubeVideoId} aria-pressed={i === videoIdx} onClick={() => { setVideoIdx(i); setRate(1) }}>{v.baseWpm} wpm</button>
                    ))}
                  </div>
                </div>
              )}

              <YouTubePlayer key={video.youtubeVideoId} videoId={video.youtubeVideoId} rate={rate} onRates={setRates} onRateChange={setRate} />

              <div className="speed-bar">
                <span className="label">Playback speed</span>
                <InfoTip label="About playback speed">
                  <b>For practice only.</b> Playback speed just changes how fast the video plays, so you can slow a passage down or speed it up. The “≈ wpm” figure is an estimate (dictation speed × playback speed). It does not change how your typing is timed or checked.
                </InfoTip>
                <div className="segmented" role="group" aria-label="Playback speed">
                  {selectableRates.map((r) => (
                    <button key={r} aria-pressed={r === rate} onClick={() => setRate(r)}>{r}×</button>
                  ))}
                </div>
                <span className="wpm-pill">≈ {effectiveWpm} wpm</span>
              </div>
              <div className="tip">Tip: slow the video down while you are learning a passage, then work back up to the exam speed ({d.videos[0]?.baseWpm ?? 100} wpm).</div>

              <section className="card card-flat transcript" aria-label="Transcript">
                <div className="spread">
                  <div>
                    <h3>Transcript</h3>
                    <p className="muted small">Try writing it yourself first, then use this to check your notes.</p>
                  </div>
                  <button className="btn btn-ghost btn-sm" aria-expanded={showTranscript} onClick={() => setShowTranscript((v) => !v)}>
                    {showTranscript ? 'Hide transcript' : 'Show transcript'}
                  </button>
                </div>
                {showTranscript && (
                  transcriptQ.isPending ? <Spinner /> : transcriptQ.error ? <ErrorState error={transcriptQ.error} onRetry={() => void transcriptQ.refetch()} /> : (
                    <div className="transcript-body">
                      <div className="muted small">{transcriptQ.data.wordCount} words</div>
                      {transcriptQ.data.paragraphs.map((p, i) => <p key={i}>{p}</p>)}
                    </div>
                  )
                )}
              </section>
            </>
          )}
        </div>

        <aside className="stack">
          <div className="card stack">
            <h2>Ready to type?</h2>
            <div className="field">
              <label className="label" htmlFor="profile">Exam</label>
              <select id="profile" className="select" value={profile} onChange={(e) => setProfile(e.target.value)} disabled={hasDraft}>
                {(profilesQ.data ?? []).map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}
              </select>
            </div>
            <div className="field">
              <span className="label">Category</span>
              <div className="segmented" role="group" aria-label="Category">
                <button aria-pressed={category === 'general'} onClick={() => setCategory('general')} disabled={hasDraft}>General</button>
                <button aria-pressed={category === 'reserved'} onClick={() => setCategory('reserved')} disabled={hasDraft}>Reserved</button>
              </div>
            </div>
            {chosenProfile && !hasDraft && (
              <div className="muted small">
                {chosenProfile.durationMin} minutes to transcribe · pass at {chosenProfile.limits[category]}% error or less
                {!chosenProfile.verifiedAgainstNotice && ' (limit not yet verified against the latest SSC notice)'}
              </div>
            )}
            {hasDraft && <div className="alert alert-info">You have an unfinished attempt. Resuming keeps your timer and text.</div>}
            {start.error && <div className="alert alert-error">{errorMessage(start.error)}</div>}
            <button className="btn btn-accent btn-lg" disabled={!d.ready || start.isPending} onClick={() => start.mutate(effectiveWpm ?? undefined)}>
              {start.isPending ? 'Starting…' : hasDraft ? 'Resume typing' : 'Transcribe now →'}
            </button>
            <p className="muted small">The timer starts as soon as you press the button.</p>
          </div>

          <div className="card stack card-flat">
            <div className="spread">
              <h3>Your attempts</h3>
              {progressQ.data && progressQ.data.attempts.length > 0 && <span className="badge badge-ok">Best {formatPct(progressQ.data.bestErrorPct)}</span>}
            </div>
            {progressQ.isPending ? <Spinner /> : progressQ.data && progressQ.data.attempts.length > 0 ? (
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }} className="stack">
                {[...progressQ.data.attempts].reverse().slice(0, 5).map((a) => (
                  <li key={a.id} className="spread small">
                    <span className="muted">{formatDate(a.submittedAt)}</span>
                    <span><b>{formatPct(a.errorPct)}</b> · <Link to={`/attempts/${a.id}`}>view</Link></span>
                  </li>
                ))}
              </ul>
            ) : <p className="muted small">No attempts yet.</p>}
          </div>

          <button className="btn btn-ghost btn-sm" onClick={() => setReporting(true)}>Report a problem with this video</button>
        </aside>
      </div>

      {reporting && <ReportModal dictationId={d.id} kind="video_issue" onClose={() => setReporting(false)} />}
    </div>
  )
}
