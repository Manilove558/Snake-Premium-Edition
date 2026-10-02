// lib/br/camera.ts — smooth camera for the big map (pure; works with ctx.translate in render.ts).
import { BR_CELL, BR_GRID, BR_VIEW_CELLS } from "./constants"

export class Camera {
  /** camera centre in WORLD cell coordinates (float) */
  x = BR_GRID / 2
  y = BR_GRID / 2
  private ready = false

  /** Jump instantly (spawn, spectator target change). */
  snapTo(tx: number, ty: number) {
    this.x = this.clampAxis(tx)
    this.y = this.clampAxis(ty)
    this.ready = true
  }

  /** Frame-rate independent exponential follow. `dtMs` = time since last frame. */
  follow(tx: number, ty: number, dtMs: number, speed = 9) {
    if (!this.ready) return this.snapTo(tx, ty)
    const k = 1 - Math.exp(-speed * (dtMs / 1000))
    this.x += (this.clampAxis(tx) - this.x) * k
    this.y += (this.clampAxis(ty) - this.y) * k
  }

  /** Keep the window inside the world, so the arena edge is always visible instead of void. */
  private clampAxis(v: number) {
    const half = BR_VIEW_CELLS / 2
    return Math.min(BR_GRID - half, Math.max(half, v + 0.5)) - 0.5
  }

  /** Top-left of the window in world cells. */
  get originX() {
    return this.x + 0.5 - BR_VIEW_CELLS / 2
  }
  get originY() {
    return this.y + 0.5 - BR_VIEW_CELLS / 2
  }
  /** Translate to apply with ctx.translate() (pixels). */
  get offsetPx() {
    return { x: -this.originX * BR_CELL, y: -this.originY * BR_CELL }
  }
}
