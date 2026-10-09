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
      fetch(name.includes(".") ? `/sounds/${name}` : `/sounds/${name}.wav`)
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

// ---------------------------------------------------------------------------------------------------------------
// Battle event cues (synthesized, no assets). Used for events that happen to OTHER players — what a spectator sees
// on screen — and for the Battle Royale zone, which has no "owner".  All follow the caller's gain (master volume).
// ---------------------------------------------------------------------------------------------------------------
function noiseBuffer(c: AudioContext, seconds: number): AudioBuffer {
  const len = Math.max(1, Math.floor(c.sampleRate * seconds))
  const buf = c.createBuffer(1, len, c.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
  return buf
}

/** A snake was eliminated: short falling "thud" + a puff of filtered noise. */
export function playElimination(gain = 1) {
  const c = getAudioContext()
  if (!c || gain <= 0) return
  try {
    const t0 = c.currentTime + 0.005
    const g = c.createGain()
    g.gain.setValueAtTime(0.0001, t0)
    g.gain.exponentialRampToValueAtTime(Math.min(1, gain) * 0.55, t0 + 0.01)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.32)
    g.connect(c.destination)
    const o = c.createOscillator()
    o.type = "triangle"
    o.frequency.setValueAtTime(260, t0)
    o.frequency.exponentialRampToValueAtTime(60, t0 + 0.3)
    o.connect(g)
    o.start(t0)
    o.stop(t0 + 0.34)
    const n = c.createBufferSource()
    n.buffer = noiseBuffer(c, 0.18)
    const lp = c.createBiquadFilter()
    lp.type = "lowpass"
    lp.frequency.value = 1400
    const ng = c.createGain()
    ng.gain.setValueAtTime(Math.min(1, gain) * 0.25, t0)
    ng.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.18)
    n.connect(lp)
    lp.connect(ng)
    ng.connect(c.destination)
    n.start(t0)
  } catch {}
}

/** Zone shrink is about to start: two urgent alternating beeps. */
export function playZoneWarning(gain = 1) {
  const c = getAudioContext()
  if (!c || gain <= 0) return
  try {
    const t0 = c.currentTime + 0.005
    ;[880, 660, 880, 660].forEach((hz, i) => {
      const t = t0 + i * 0.14
      const o = c.createOscillator()
      const g = c.createGain()
      o.type = "square"
      o.frequency.value = hz
      g.gain.setValueAtTime(0.0001, t)
      g.gain.exponentialRampToValueAtTime(Math.min(1, gain) * 0.16, t + 0.01)
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.11)
      o.connect(g)
      g.connect(c.destination)
      o.start(t)
      o.stop(t + 0.13)
    })
  } catch {}
}

/** The safe zone starts closing: a low, sweeping rumble. */
export function playZoneShrink(gain = 1) {
  const c = getAudioContext()
  if (!c || gain <= 0) return
  try {
    const t0 = c.currentTime + 0.005
    const dur = 1.6
    const n = c.createBufferSource()
    n.buffer = noiseBuffer(c, dur)
    const lp = c.createBiquadFilter()
    lp.type = "lowpass"
    lp.frequency.setValueAtTime(900, t0)
    lp.frequency.exponentialRampToValueAtTime(90, t0 + dur)
    const g = c.createGain()
    g.gain.setValueAtTime(0.0001, t0)
    g.gain.exponentialRampToValueAtTime(Math.min(1, gain) * 0.5, t0 + 0.15)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    n.connect(lp)
    lp.connect(g)
    g.connect(c.destination)
    n.start(t0)
    const o = c.createOscillator()
    const og = c.createGain()
    o.type = "sine"
    o.frequency.setValueAtTime(110, t0)
    o.frequency.exponentialRampToValueAtTime(45, t0 + dur)
    og.gain.setValueAtTime(0.0001, t0)
    og.gain.exponentialRampToValueAtTime(Math.min(1, gain) * 0.35, t0 + 0.2)
    og.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    o.connect(og)
    og.connect(c.destination)
    o.start(t0)
    o.stop(t0 + dur + 0.02)
  } catch {}
}

/**
 * Start a gapless looping sound (e.g. the snake's slither while it moves). Returns a handle, or null if the sound
 * hasn't finished loading yet (just try again on the next call). stop() fades it out over ~0.12 s.
 */
export type LoopHandle = { setGain: (g: number) => void; stop: () => void }
export function startLoop(name: string, gain = 1): LoopHandle | null {
  const c = getAudioContext()
  const buf = buffers.get(name)
  if (!c || !buf) return null
  try {
    const src = c.createBufferSource()
    src.buffer = buf
    src.loop = true
    const g = c.createGain()
    const t0 = c.currentTime
    g.gain.setValueAtTime(0.0001, t0)
    g.gain.linearRampToValueAtTime(Math.min(1, Math.max(0.0001, gain)), t0 + 0.06)
    src.connect(g)
    g.connect(c.destination)
    src.start()
    let stopped = false
    return {
      setGain: (v: number) => { if (!stopped) g.gain.setTargetAtTime(Math.min(1, Math.max(0.0001, v)), c.currentTime, 0.05) },
      stop: () => {
        if (stopped) return
        stopped = true
        try {
          const t = c.currentTime
          g.gain.cancelScheduledValues(t)
          g.gain.setValueAtTime(Math.max(g.gain.value, 0.0001), t)
          g.gain.linearRampToValueAtTime(0.0001, t + 0.12)
          src.stop(t + 0.14)
        } catch {}
      },
    }
  } catch {
    return null
  }
}
