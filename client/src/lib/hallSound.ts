export interface HallSound {
  /** Browsers keep audio paused until the page has had a tap or key press; call this from one. */
  resume: () => void
  stop: () => void
}

/**
 * A soft, low murmur (filtered noise that swells and fades slowly) to practise with the background of an exam hall.
 * Made with the Web Audio API, so there is no audio file to load. Returns null when audio is not available.
 */
export function startHallSound(): HallSound | null {
  const Ctx: typeof AudioContext | undefined = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctx) return null
  let ctx: AudioContext
  try {
    ctx = new Ctx()
  } catch {
    return null
  }

  try {
    // Six seconds of brown noise, faded at both ends so the loop has no click.
    const len = Math.floor(ctx.sampleRate * 6)
    const buf = ctx.createBuffer(1, len, ctx.sampleRate)
    const data = buf.getChannelData(0)
    let last = 0
    for (let i = 0; i < len; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02
      data[i] = last * 3.5
    }
    const fade = Math.floor(ctx.sampleRate * 0.3)
    for (let i = 0; i < fade; i++) {
      const g = i / fade
      data[i]! *= g
      data[len - 1 - i]! *= g
    }

    const src = ctx.createBufferSource()
    src.buffer = buf
    src.loop = true
    const low = ctx.createBiquadFilter()
    low.type = 'lowpass'
    low.frequency.value = 650
    const gain = ctx.createGain()
    gain.gain.value = 0
    gain.gain.linearRampToValueAtTime(0.16, ctx.currentTime + 3)
    // A slow swell, like a room where people shuffle and murmur now and then.
    const lfo = ctx.createOscillator()
    lfo.frequency.value = 0.11
    const depth = ctx.createGain()
    depth.gain.value = 0.05
    lfo.connect(depth).connect(gain.gain)
    src.connect(low).connect(gain).connect(ctx.destination)
    src.start()
    lfo.start()

    return {
      resume: () => { if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined) },
      stop: () => {
        try { src.stop(); lfo.stop() } catch { /* already stopped */ }
        void ctx.close().catch(() => undefined)
      },
    }
  } catch {
    void ctx.close().catch(() => undefined)
    return null
  }
}
