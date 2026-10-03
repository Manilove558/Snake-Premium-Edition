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
