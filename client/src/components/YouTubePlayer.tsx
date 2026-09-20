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

interface Props {
  videoId: string
  rate: number
  onRates?: (rates: number[]) => void
  onRateChange?: (rate: number) => void
}

/**
 * YouTube's own embedded player (native controls stay visible, as YouTube's policies require).
 * We only add our own speed buttons next to it via the IFrame API's setPlaybackRate.
 */
export function YouTubePlayer({ videoId, rate, onRates, onRateChange }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const playerRef = useRef<YTPlayer | null>(null)
  const rateRef = useRef(rate)
  const cbs = useRef({ onRates, onRateChange })
  useEffect(() => {
    rateRef.current = rate
    cbs.current = { onRates, onRateChange }
  })
  const [error, setError] = useState<string | null>(null)

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
            onError: () => setError('This video cannot be played here.'),
          },
        })
      })
      .catch((e: Error) => setError(e.message))

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

  return (
    <div className="player-frame">
      <div ref={hostRef} />
      {error && (
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#fff', textAlign: 'center', padding: 20 }}>
          <div className="stack" style={{ alignItems: 'center' }}>
            <p>{error}</p>
            <a className="btn btn-accent" href={`https://www.youtube.com/watch?v=${videoId}`} target="_blank" rel="noreferrer">Open on YouTube</a>
          </div>
        </div>
      )}
    </div>
  )
}
