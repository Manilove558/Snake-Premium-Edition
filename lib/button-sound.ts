// lib/button-sound.ts — synthesized "tick" played when a D-pad direction button is pressed.
// (Web Audio oscillator: soft 600 -> 800 Hz sine blip, 30 ms.)  Used instead of /sounds/click.mp3 on those buttons.
let ctx: AudioContext | null = null
const cfg = { enabled: true, volume: 1 }

/** snake-game keeps this in sync with the Settings "Click sound" switch and the volume bar (NOT the mute icon). */
export function setButtonSoundConfig(enabled: boolean, volume: number) {
  cfg.enabled = enabled
  cfg.volume = volume
}

export function playButtonClickSound() {
  if (typeof window === "undefined" || !cfg.enabled || cfg.volume <= 0) return
  try {
    const AC: typeof AudioContext | undefined = window.AudioContext || (window as any).webkitAudioContext
    if (!AC) return
    // ONE shared context (browsers cap how many can exist), created on the first press
    if (!ctx) ctx = new AC()
    if (ctx.state === "suspended") ctx.resume().catch(() => {})

    const osc = ctx.createOscillator()
    const gain = ctx.createGain()

    osc.type = "sine" // soft, clean tone
    osc.frequency.setValueAtTime(600, ctx.currentTime)
    osc.frequency.exponentialRampToValueAtTime(800, ctx.currentTime + 0.03) // fast pitch rise

    gain.gain.setValueAtTime(0.1 * Math.min(1, cfg.volume), ctx.currentTime) // low volume, follows the volume bar
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.03) // very short (30 ms)

    osc.connect(gain)
    gain.connect(ctx.destination)

    osc.start()
    osc.stop(ctx.currentTime + 0.03)
  } catch {}
}
