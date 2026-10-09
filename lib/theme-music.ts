// lib/theme-music.ts — background "Theme song" (music) of the game. Saved on this device.
//
// To add another song later: drop the mp3 (+ optional cover) into /public/music and add ONE entry to THEME_TRACKS.
// The Settings screen and the player pick it up automatically.
export type ThemeTrack = {
  id: string
  title: string
  artist: string
  src: string
  cover: string
  /** pixel-art covers are drawn crisp, others smooth */
  pixel?: boolean
}

export const THEME_TRACKS: ThemeTrack[] = [
  {
    id: "8bit-era",
    title: "The Return of the 8-Bit Era",
    artist: "DJARTMUSIC",
    src: "/music/the-return-of-the-8-bit-era.mp3",
    cover: "/music/the-return-of-the-8-bit-era.png",
    pixel: true,
  },
  {
    id: "mountain",
    title: "Game Music",
    artist: "The Mountain",
    src: "/music/mountain-game-music.mp3",
    cover: "/music/mountain-game-music.png",
  },
]

export const THEME_TRACK_DEFAULT = THEME_TRACKS[0].id

export function findTrack(id: string): ThemeTrack | null {
  return THEME_TRACKS.find((t) => t.id === id) ?? null
}

export const THEME_TRACK_KEY = "snake-theme-track"
export function loadThemeTrack(): string {
  try {
    const v = window.localStorage.getItem(THEME_TRACK_KEY)
    if (v === null) return THEME_TRACK_DEFAULT
    return findTrack(v) ? v : THEME_TRACK_DEFAULT
  } catch {
    return THEME_TRACK_DEFAULT
  }
}
export function saveThemeTrack(id: string): void {
  try { window.localStorage.setItem(THEME_TRACK_KEY, id) } catch {}
}

// Music volume (0..1) — its own bar in Settings, separate from the game-sounds volume.
export const THEME_VOLUME_KEY = "snake-theme-volume"
export const THEME_VOLUME_DEFAULT = 0.5
export function loadThemeVolume(): number {
  try {
    const v = parseFloat(window.localStorage.getItem(THEME_VOLUME_KEY) ?? "")
    return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : THEME_VOLUME_DEFAULT
  } catch {
    return THEME_VOLUME_DEFAULT
  }
}
export function saveThemeVolume(v: number): void {
  try { window.localStorage.setItem(THEME_VOLUME_KEY, String(v)) } catch {}
}

// Theme song on / off (the switch in the Settings row). On by default.
export const THEME_ON_KEY = "snake-theme-on"
export function loadThemeOn(): boolean {
  try {
    const v = window.localStorage.getItem(THEME_ON_KEY)
    return v === null ? true : v === "1"
  } catch {
    return true
  }
}
export function saveThemeOn(on: boolean): void {
  try { window.localStorage.setItem(THEME_ON_KEY, on ? "1" : "0") } catch {}
}
