// lib/sfx.ts — tiny Web Audio engine for the SHORT, frequent game sounds (snake step, food bite, D-pad tick).
//
// Why not `new Audio()` / cloneNode() per play?  On phones that allocates a media element for every step, adds start
// latency and can stutter.  Here each sound is decoded ONCE into an AudioBuffer; playing it is just a lightweight
// BufferSource -> Gain node, so it starts instantly and overlaps cleanly.  One shared AudioContext for the whole app.
let ctx: AudioContext | null = null
const buffers = new Map<string, AudioBuffer>()
const loading = new Map<string, Promise<void>>()

export function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null
  if (!ctx) {
    const AC: typeof AudioContext | undefined = window.AudioContext || (window as any).webkitAudioContext
    if (!AC) return null
    try { ctx = new AC() } catch { return null }
  }
  if (ctx.state === "suspended") ctx.resume().catch(() => {})
  return ctx
}

/** Fetch + decode /sounds/<name>.wav once (safe to call many times). */
export function preloadSfx(names: string[]) {
  const c = getAudioContext()
  if (!c) return
  for (const name of names) {
    if (buffers.has(name) || loading.has(name)) continue
    loading.set(
      name,
      fetch(`/sounds/${name}.wav`)
        .then((r) => r.arrayBuffer())
        .then((data) => new Promise<AudioBuffer>((res, rej) => c.decodeAudioData(data, res, rej)))
        .then((buf) => { buffers.set(name, buf) })
        .catch(() => { loading.delete(name) }), // allow a retry on the next preload
    )
  }
}

/** Play a preloaded sound. gain 0..1, rate = playback speed (1 = original pitch). Silent no-op until it has loaded. */
export function playSfx(name: string, { gain = 1, rate = 1 }: { gain?: number; rate?: number } = {}) {
  const c = getAudioContext()
  const buf = buffers.get(name)
  if (!c || !buf || gain <= 0) return
  try {
    const src = c.createBufferSource()
    src.buffer = buf
    src.playbackRate.value = rate
    const g = c.createGain()
    g.gain.value = Math.min(1, gain)
    src.connect(g)
    g.connect(c.destination)
    src.start()
  } catch {}
}

/**
 * Synthesized countdown cue (no asset needed). n = 3, 2, 1 -> rising notes G4 / C5 / E5 (a major-chord climb),
 * each = soft sine body + octave shimmer + a tiny filtered click on the attack, so it feels like a premium UI "tock".
 */
const COUNTDOWN_HZ: Record<number, number> = { 3: 392.0, 2: 523.25, 1: 659.25 }
export function playCountdownTick(n: number, gain = 1) {
  const c = getAudioContext()
  const f = COUNTDOWN_HZ[n]
  if (!c || !f || gain <= 0) return
  try {
    const t0 = c.currentTime + 0.005
    const master = c.createGain()
    master.gain.setValueAtTime(0.0001, t0)
    master.gain.exponentialRampToValueAtTime(Math.min(1, gain) * 0.5, t0 + 0.012)
    master.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.55)
    const lp = c.createBiquadFilter()
    lp.type = "lowpass"
    lp.frequency.setValueAtTime(5200, t0)
    lp.frequency.exponentialRampToValueAtTime(1400, t0 + 0.4)
    master.connect(lp)
    lp.connect(c.destination)
    const tone = (hz: number, type: OscillatorType, level: number, dur: number) => {
      const o = c.createOscillator()
      const g = c.createGain()
      o.type = type
      o.frequency.setValueAtTime(hz * 1.012, t0) // tiny pitch "settle" for a soft attack
      o.frequency.exponentialRampToValueAtTime(hz, t0 + 0.05)
      g.gain.setValueAtTime(level, t0)
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
      o.connect(g)
      g.connect(master)
      o.start(t0)
      o.stop(t0 + dur + 0.02)
    }
    tone(f, "sine", 1, 0.55)
    tone(f * 2, "triangle", 0.28, 0.3)
    tone(f / 2, "sine", 0.35, 0.4)
    // attack click
    const len = Math.floor(c.sampleRate * 0.02)
    const buf = c.createBuffer(1, len, c.sampleRate)
    const d = buf.getChannelData(0)
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3)
    const src = c.createBufferSource()
    const hp = c.createBiquadFilter()
    const cg = c.createGain()
    hp.type = "highpass"
    hp.frequency.value = 2500
    cg.gain.value = 0.18 * Math.min(1, gain)
    src.buffer = buf
    src.connect(hp)
    hp.connect(cg)
    cg.connect(c.destination)
    src.start(t0)
  } catch {}
}
