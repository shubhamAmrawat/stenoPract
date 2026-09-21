import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useAuth } from '../auth/AuthContext'
import { ExerciseRail, RailHandle, RailToggle } from '../components/ExerciseRail'
import { InfoTip } from '../components/InfoTip'
import { ReportModal } from '../components/ReportModal'
import { StartInfoModal } from '../components/StartInfoModal'
import { ErrorState, Spinner } from '../components/ui'
import { YouTubePlayer, type PlayerProblem } from '../components/YouTubePlayer'
import { api, errorMessage, qs } from '../lib/api'
import { formatDate, formatPct } from '../lib/format'
import { useExamProfiles } from '../lib/hooks'
import { useMediaQuery } from '../lib/useMediaQuery'
import { EXAM_MODE_KEY, useStoredFlag } from '../lib/useStoredFlag'
import type { Attempt, AttemptSummary, Dictation, DictationSet, Paged, TranscriptResponse } from '../lib/types'

const DEFAULT_RATES = [0.5, 0.75, 1, 1.25, 1.5]

interface Progress {
  attempts: { id: string; submittedAt: string; errorPct: number | null }[]
  bestErrorPct: number | null
  avgErrorPct: number | null
}

const dictationQuery = (id: string) => ({ queryKey: ['dictation', id], queryFn: () => api<{ dictation: Dictation }>(`/dictations/${id}`).then((r) => r.dictation) })

export function DictationPage() {
  const { id = '' } = useParams()
  const wide = useMediaQuery('(min-width: 1280px)')
  const [dockedOpen, setDockedOpen] = useStoredFlag('steno.exerciseRail', true)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const setId = useQuery(dictationQuery(id)).data?.setId
  const closeDrawer = useCallback(() => setDrawerOpen(false), [])
  const hideDocked = useCallback(() => setDockedOpen(false), [setDockedOpen])

  return (
    <div className={`dict-shell ${wide ? 'is-wide' : ''} ${wide && !dockedOpen ? 'rail-collapsed' : ''}`}>
      {/* key: moving to another exercise starts the page fresh (video, speed, tab, category). The list stays put, so its search and filter survive. */}
      <DictationView key={id} id={id} showToggle={!wide} railOpen={drawerOpen} onToggleRail={() => setDrawerOpen((v) => !v)} />
      {wide && setId && (dockedOpen
        ? <ExerciseRail currentId={id} setId={setId} mode="docked" onClose={hideDocked} />
        : <RailHandle onClick={() => setDockedOpen(true)} />)}
      {!wide && drawerOpen && setId && <ExerciseRail currentId={id} setId={setId} mode="drawer" onClose={closeDrawer} />}
    </div>
  )
}

function DictationView({ id, showToggle, railOpen, onToggleRail }: { id: string; showToggle: boolean; railOpen: boolean; onToggleRail: () => void }) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const qc = useQueryClient()

  const dictQ = useQuery(dictationQuery(id))
  const profilesQ = useExamProfiles()
  const draftQ = useQuery({ queryKey: ['attempts', 'draft', id], queryFn: () => api<Paged<AttemptSummary>>(`/attempts${qs({ dictationId: id, status: 'draft' })}`) })
  const progressQ = useQuery({ queryKey: ['progress', id], queryFn: () => api<Progress>(`/analytics/dictations/${id}`) })

  const [videoIdx, setVideoIdx] = useState(0)
  const [rate, setRate] = useState(1)
  const [problem, setProblem] = useState<PlayerProblem | null>(null)
  const [rates, setRates] = useState<number[]>(DEFAULT_RATES)
  const [profile, setProfile] = useState(user?.settings.examProfile ?? 'SSC_C')
  const [reporting, setReporting] = useState(false)
  const [showStart, setShowStart] = useState(false)
  const [examMode, setExamMode] = useStoredFlag(EXAM_MODE_KEY, false)
  const [tab, setTab] = useState<'start' | 'transcript'>('start')
  const setsQ = useQuery({ queryKey: ['sets'], queryFn: () => api<{ items: DictationSet[] }>('/sets').then((r) => r.items) })
  const transcriptQ = useQuery({
    queryKey: ['transcript', id],
    enabled: tab === 'transcript',
    staleTime: 5 * 60_000,
    queryFn: () => api<TranscriptResponse>(`/dictations/${id}/transcript`),
  })

  const start = useMutation({
    mutationFn: (listenedWpm: number | undefined) =>
      api<{ attempt: Attempt }>(`/dictations/${id}/attempts`, { method: 'POST', body: { examProfile: profile, listenedWpm } }),
    onSuccess: (r) => {
      // The draft now exists and the exercise counts as seen: refresh both so coming back shows "Resume typing".
      void qc.invalidateQueries({ queryKey: ['attempts'] })
      void qc.invalidateQueries({ queryKey: ['dictation', id] })
      void qc.invalidateQueries({ queryKey: ['rail'] })
      navigate(`/attempts/${r.attempt.id}/write`)
    },
  })

  const video = dictQ.data?.videos[videoIdx]
  const selectableRates = useMemo(() => rates.filter((r) => r >= 0.5 && r <= 1.5), [rates])
  const effectiveWpm = video ? Math.round(video.baseWpm * rate) : null
  const chosenProfile = profilesQ.data?.find((p) => p.code === profile)
  const beginAttempt = () => start.mutate(problem ? undefined : (effectiveWpm ?? undefined))

  if (dictQ.isPending) return <Spinner full />
  if (dictQ.error) return <ErrorState error={dictQ.error} onRetry={() => void dictQ.refetch()} />
  const d = dictQ.data
  const hasDraft = (draftQ.data?.items.length ?? 0) > 0
  // Been here before (started and retook, or submitted): the button offers a retake instead of a first start.
  const hasStarted = d.state.seen || d.state.attemptsCount > 0

  return (
    <div className="dict-view stack-lg">
      <div className="page-header">
        <div className="dict-topline">
          {(() => {
            const set = setsQ.data?.find((x) => x.id === d.setId)
            return <Link to={set ? `/practice/${set.slug}` : '/'} className="small">← {set ? set.title : 'Home'}</Link>
          })()}
          {showToggle && <RailToggle open={railOpen} onClick={onToggleRail} />}
        </div>
        <h1>{d.title}</h1>
        <p className="muted">Step 1 of 2 · Listen and write in your notebook. When you are ready, transcribe it on screen.</p>
      </div>

      <div className="dict-body stack-lg">
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
                      <button key={v.youtubeVideoId} aria-pressed={i === videoIdx} onClick={() => { setVideoIdx(i); setRate(1); setProblem(null) }}>{v.baseWpm} wpm</button>
                    ))}
                  </div>
                </div>
              )}

              <YouTubePlayer key={video.youtubeVideoId} videoId={video.youtubeVideoId} rate={rate} onRates={setRates} onRateChange={setRate} onProblem={setProblem} />

              {!problem && (
                <>
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
                </>
              )}
            </>
          )}
        </div>

        <aside className="card side-card">
          <div className="side-tabs" role="tablist" aria-label="Before you start">
            <button role="tab" id="tab-start" aria-selected={tab === 'start'} aria-controls="pane-start" onClick={() => setTab('start')}>Ready to type</button>
            <button role="tab" id="tab-transcript" aria-selected={tab === 'transcript'} aria-controls="pane-transcript" onClick={() => setTab('transcript')}>Transcript</button>
          </div>

          <div className="side-body">
            {/* Both panes stay mounted: the hidden one keeps the card the same height, so switching tabs never moves the page. */}
            <div id="pane-start" role="tabpanel" aria-labelledby="tab-start" className="side-pane stack" style={tab === 'start' ? undefined : { visibility: 'hidden' }} aria-hidden={tab !== 'start'}>
              <div className="field">
                <label className="label" htmlFor="profile">Exam</label>
                <select id="profile" className="select" value={profile} onChange={(e) => setProfile(e.target.value)} disabled={hasDraft}>
                  {(profilesQ.data ?? []).map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}
                </select>
              </div>
              {chosenProfile && !hasDraft && (
                <div className="muted small hide">
                  {chosenProfile.durationMin} minutes to transcribe · about {chosenProfile.words} words at {chosenProfile.wpm} wpm
                  {!chosenProfile.verifiedAgainstNotice && ' (not yet checked against the latest SSC notice)'}
                </div>
              )}
              <div className="row" style={{ gap: 8 }}>
                <label className="cmp-switch">
                  <input type="checkbox" checked={examMode} onChange={(e) => setExamMode(e.target.checked)} />
                  <span>Exam mode</span>
                </label>
                <InfoTip label="About exam mode">
                  <b>Practise the way the real test feels.</b> You read a short list of instructions first, a soft exam-hall murmur plays while you type (you can mute it), the typing box hides its scrollbar and pasting is turned off. Your result is checked exactly the same way.
                </InfoTip>
              </div>
              {hasDraft && <div className="alert alert-info">You have an unfinished attempt. Resuming keeps your timer and text.</div>}
              {start.error && <div className="alert alert-error">{errorMessage(start.error)}</div>}
            </div>

            {tab === 'transcript' && (
              <div id="pane-transcript" role="tabpanel" aria-labelledby="tab-transcript" className="side-pane side-scroll">
                <p className="muted small">Try writing it yourself first, then use this to check your notes.</p>
                {transcriptQ.isPending ? <Spinner /> : transcriptQ.error ? <ErrorState error={transcriptQ.error} onRetry={() => void transcriptQ.refetch()} /> : (
                  <div className="transcript-text">
                    <div className="muted small">{transcriptQ.data.wordCount} words</div>
                    {transcriptQ.data.paragraphs.map((p, i) => <p key={i}>{p}</p>)}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="side-foot">
            {/* Resume goes straight to the typing screen (its timer is already running). A fresh start or a retake shows the info modal first. */}
            <button
              className="btn btn-accent btn-lg"
              disabled={!d.ready || start.isPending || draftQ.isPending}
              onClick={() => {
                if (hasDraft) return beginAttempt()
                start.reset()
                setShowStart(true)
              }}
            >
              {start.isPending ? 'Starting…' : hasDraft ? 'Resume typing' : hasStarted ? 'Retake again →' : 'Transcribe now →'}
            </button>
            <p className="muted small">{hasDraft ? 'Your timer is already running.' : 'Your timer starts after a 5-second countdown.'}</p>
          </div>
        </aside>
      </div>

      <section className="card card-flat attempts" aria-label="Your attempts">
        <div className="attempts-head">
          <h3>Your attempts</h3>
          {progressQ.data && progressQ.data.attempts.length > 0 && <span className="badge badge-ok">Best {formatPct(progressQ.data.bestErrorPct)}</span>}
          {progressQ.data && progressQ.data.attempts.length === 0 && <span className="muted small">None yet. Your results will appear here.</span>}
          <button className="btn btn-ghost btn-sm attempts-report" onClick={() => setReporting(true)}>Report a problem with this video</button>
        </div>
        {progressQ.isPending ? <Spinner /> : progressQ.data && progressQ.data.attempts.length > 0 && (
          <ul className="attempt-grid">
            {[...progressQ.data.attempts].reverse().slice(0, 5).map((a) => (
              <li key={a.id}>
                <Link to={`/attempts/${a.id}`} className="attempt-tile" aria-label={`Attempt on ${formatDate(a.submittedAt)}, ${formatPct(a.errorPct)} error`}>
                  <span className="muted small">{formatDate(a.submittedAt)}</span>
                  <span className="attempt-pct">{formatPct(a.errorPct)}</span>
                  <span className="attempt-foot">
                    <span className="attempt-view">View →</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      </div>

      {showStart && (
        <StartInfoModal
          isRetake={hasStarted}
          examMode={examMode}
          durationMin={chosenProfile?.durationMin}
          busy={start.isPending}
          error={start.error ? errorMessage(start.error) : null}
          onStart={beginAttempt}
          onCancel={() => setShowStart(false)}
        />
      )}

      {reporting && <ReportModal dictationId={d.id} kind="video_issue" onClose={() => setReporting(false)} />}
    </div>
  )
}
