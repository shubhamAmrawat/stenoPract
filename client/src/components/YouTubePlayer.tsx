import { useEffect, useRef, useState } from 'react'

interface YTPlayer {
  setPlaybackRate(rate: number): void
  getAvailablePlaybackRates(): number[]
  destroy(): void
}
interface YTNamespace {
  Player: new (
    el: HTMLElement,
    opts: {
      videoId: string
      playerVars?: Record<string, string | number>
      events?: {
        onReady?: () => void
        onPlaybackRateChange?: (e: { data: number }) => void
        onError?: (e: { data: number }) => void
      }
    },
  ) => YTPlayer
}
declare global {
  interface Window {
    YT?: YTNamespace
    onYouTubeIframeAPIReady?: () => void
  }
}

let apiPromise: Promise<YTNamespace> | null = null
function loadYouTubeApi(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT)
  apiPromise ??= new Promise((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => {
      previous?.()
      resolve(window.YT!)
    }
    const s = document.createElement('script')
    s.src = 'https://www.youtube.com/iframe_api'
    s.async = true
    s.onerror = () => {
      apiPromise = null
      reject(new Error('Could not load the YouTube player'))
    }
    document.head.appendChild(s)
  })
  return apiPromise
}

/** Why the embedded player cannot play: the owner blocks embedding (YouTube errors 101/150), the video is gone (100), or something else. */
export type PlayerProblem = 'embed' | 'gone' | 'error'

function problemFor(code: number): PlayerProblem {
  if (code === 101 || code === 150) return 'embed'
  if (code === 100) return 'gone'
  return 'error'
}

const PROBLEM_TEXT: Record<PlayerProblem, { title: string; body: string; button: string }> = {
  embed: {
    title: 'This video can’t play inside the app',
    body: 'Its owner only allows it to be watched on YouTube. Open it there, write the dictation in your notebook, then come back here and press “Transcribe now”. Typing and analysis work as usual.',
    button: 'Watch on YouTube',
  },
  gone: {
    title: 'This video isn’t available',
    body: 'It may have been removed or made private. Use “Report a problem with this video” so it can be replaced.',
    button: 'Try on YouTube',
  },
  error: {
    title: 'The video couldn’t be loaded',
    body: 'Check your connection and refresh the page, or open it on YouTube.',
    button: 'Open on YouTube',
  },
}

interface Props {
  videoId: string
  rate: number
  onRates?: (rates: number[]) => void
  onRateChange?: (rate: number) => void
  /** Called when the video cannot be played here, so the page can hide controls that only work on the embedded player. */
  onProblem?: (problem: PlayerProblem) => void
}

/**
 * YouTube's own embedded player (native controls stay visible, as YouTube's policies require).
 * We only add our own speed buttons next to it via the IFrame API's setPlaybackRate.
 */
export function YouTubePlayer({ videoId, rate, onRates, onRateChange, onProblem }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const playerRef = useRef<YTPlayer | null>(null)
  const rateRef = useRef(rate)
  const cbs = useRef({ onRates, onRateChange, onProblem })
  useEffect(() => {
    rateRef.current = rate
    cbs.current = { onRates, onRateChange, onProblem }
  })
  const [problem, setProblem] = useState<PlayerProblem | null>(null)

  useEffect(() => {
    let cancelled = false
    const holder = hostRef.current
    if (!holder) return
    const mount = document.createElement('div')
    holder.appendChild(mount)

    loadYouTubeApi()
      .then((YT) => {
        if (cancelled) return
        playerRef.current = new YT.Player(mount, {
          videoId,
          playerVars: { rel: 0, playsinline: 1, modestbranding: 1, origin: window.location.origin },
          events: {
            onReady: () => {
              const p = playerRef.current
              if (!p) return
              cbs.current.onRates?.(p.getAvailablePlaybackRates())
              p.setPlaybackRate(rateRef.current)
            },
            onPlaybackRateChange: (e) => cbs.current.onRateChange?.(e.data),
            onError: (e) => {
              const p = problemFor(e.data)
              setProblem(p)
              cbs.current.onProblem?.(p)
            },
          },
        })
      })
      .catch(() => {
        if (cancelled) return
        setProblem('error')
        cbs.current.onProblem?.('error')
      })

    return () => {
      cancelled = true
      playerRef.current?.destroy()
      playerRef.current = null
      holder.replaceChildren()
    }
  }, [videoId])

  useEffect(() => {
    playerRef.current?.setPlaybackRate(rate)
  }, [rate])

  const text = problem ? PROBLEM_TEXT[problem] : null
  return (
    <div className={problem ? 'player-frame has-problem' : 'player-frame'}>
      {/* Kept mounted so cleanup still works; hidden so YouTube's own error message never shows through ours. */}
      <div ref={hostRef} style={problem ? { visibility: 'hidden' } : undefined} />
      {text && (
        <div className="player-fallback" role="status">
          <div className="player-fallback-icon" aria-hidden="true">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 3h7v7" />
              <path d="M21 3l-9 9" />
              <path d="M19 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5" />
            </svg>
          </div>
          <h3>{text.title}</h3>
          <p>{text.body}</p>
          <a className="btn btn-accent" href={`https://www.youtube.com/watch?v=${videoId}`} target="_blank" rel="noreferrer noopener">{text.button} ↗</a>
          {problem === 'embed' && <p className="player-fallback-tip">Tip: in YouTube, open ⚙ Settings → Playback speed to slow it down.</p>}
        </div>
      )}
    </div>
  )
}
