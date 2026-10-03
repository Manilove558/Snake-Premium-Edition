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
