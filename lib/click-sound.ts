// lib/click-sound.ts — the "Click sound" option (sound on every button press). Saved on this device, on by default.
export const CLICK_SOUND_KEY = "snake-click-sound"
export const CLICK_SOUND_DEFAULT = true

export function loadClickSound(): boolean {
  try {
    const v = window.localStorage.getItem(CLICK_SOUND_KEY)
    return v === null ? CLICK_SOUND_DEFAULT : v === "1"
  } catch {
    return CLICK_SOUND_DEFAULT
  }
}

export function saveClickSound(on: boolean): void {
  try {
    window.localStorage.setItem(CLICK_SOUND_KEY, on ? "1" : "0")
  } catch {
    // storage unavailable — the choice just won't persist
  }
}

// Own volume of the click sound (0..1), separate from the game volume bar. Saved on this device.
export const CLICK_VOLUME_KEY = "snake-click-volume"
export const CLICK_VOLUME_DEFAULT = 0.8

export function loadClickVolume(): number {
  try {
    const v = parseFloat(window.localStorage.getItem(CLICK_VOLUME_KEY) ?? "")
    return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : CLICK_VOLUME_DEFAULT
  } catch {
    return CLICK_VOLUME_DEFAULT
  }
}

export function saveClickVolume(v: number): void {
  try {
    window.localStorage.setItem(CLICK_VOLUME_KEY, String(v))
  } catch {
    // storage unavailable — the volume just won't persist
  }
}
