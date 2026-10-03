// lib/smooth-move.ts — the "Smooth movement" option (Battle Royale style).
//
// ON  : snakes glide between grid cells at 60 fps (the movement style of the 120x120 Battle Royale).
// OFF : snakes jump one whole cell per tick (the original classic look).
// Game logic (speed, collisions, ticks) is identical in both styles — only how the snake is DRAWN changes.
import type { Cell, SnakeInterpolator } from "./br/interpolation"

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

// ---------------------------------------------------------------------------------------------
// Glide helpers shared by every mode / map
// ---------------------------------------------------------------------------------------------

/**
 * Feed a new tick to an interpolator. If the head did not move exactly one cell (edge teleport, portal hop,
 * reverse mode, a new level or a fresh game) the WHOLE snake snaps instead of gliding across the board.
 */
export function pushGlide(interp: SnakeInterpolator, seg: Cell[], now: number): void {
  const h = interp.head
  const n = seg[0]
  if (h && n && Math.abs(h.x - n.x) + Math.abs(h.y - n.y) > 1) interp.clear()
  interp.push(seg, now)
}

/** Heading of a snake from its two first (smoothed) segments. Falls back to `last` when it cannot be read (wrap / portal). */
export function eyeDirection(head: Cell, next: Cell, last: Cell): Cell {
  const dx = head.x - next.x
  const dy = head.y - next.y
  if (Math.abs(dx) + Math.abs(dy) > 2.2 || Math.abs(dx) + Math.abs(dy) < 0.2) return last
  return Math.abs(dx) >= Math.abs(dy) ? { x: Math.sign(dx), y: 0 } : { x: 0, y: Math.sign(dy) }
}

/**
 * Two eyes on the head, looking where the snake is going — the SAME look as the Battle Royale snake
 * (plain white dots; see drawSnake in lib/br/render.ts). Sizes are BR's pixel values at a cell of 18px,
 * scaled to the cell size of the board being drawn. (hx, hy) are in CELL units (may be fractional).
 */
const BR_EYE_CELL = 18
export function drawSnakeEyes(ctx: CanvasRenderingContext2D, hx: number, hy: number, dir: Cell, cell: number): void {
  const k = cell / BR_EYE_CELL
  const cx = hx * cell + cell / 2 + dir.x * 3 * k
  const cy = hy * cell + cell / 2 + dir.y * 3 * k
  const px = dir.y !== 0 ? 3.5 * k : 0
  const py = dir.x !== 0 ? 3.5 * k : 0
  ctx.save()
  ctx.shadowBlur = 0
  ctx.globalAlpha = 1
  ctx.fillStyle = "#fff"
  for (const sgn of [-1, 1]) {
    ctx.beginPath()
    ctx.arc(cx + px * sgn, cy + py * sgn, 1.8 * k, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}
