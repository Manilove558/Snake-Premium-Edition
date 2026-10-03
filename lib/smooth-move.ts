// lib/smooth-move.ts — the "Smooth movement" option (Battle Royale style).
//
// ON  : snakes glide between grid cells at 60 fps (the movement style of the 120x120 Battle Royale).
// OFF : snakes jump one whole cell per tick (the original classic look).
// Game logic (speed, collisions, ticks) is identical in both styles — only how the snake is DRAWN changes.
export const SMOOTH_MOVE_KEY = "snake-smooth-move"
export const SMOOTH_MOVE_DEFAULT = true

export function loadSmoothMove(): boolean {
  try {
    const v = window.localStorage.getItem(SMOOTH_MOVE_KEY)
    return v === null ? SMOOTH_MOVE_DEFAULT : v === "1"
  } catch {
    return SMOOTH_MOVE_DEFAULT
  }
}

export function saveSmoothMove(on: boolean): void {
  try {
    window.localStorage.setItem(SMOOTH_MOVE_KEY, on ? "1" : "0")
  } catch {
    // storage unavailable — the choice just won't persist
  }
}

/** tickMs passed to SnakeInterpolator.sample(): the real tick length when smooth, 1 ms (= snap to the new cell) when off. */
export const sampleTickMs = (smooth: boolean, tickMs: number): number => (smooth ? tickMs : 1)
