// lib/br/interpolation.ts — turns 6-7 Hz grid ticks into smooth 60 fps movement (pure).
//
// A snake moves exactly one cell per tick, so segment i of the NEW tick sits where segment i-1 was
// in the OLD tick (or one step ahead of segment i). Sliding each segment from its old to its new
// cell over one tick length gives continuous motion with no extrapolation and no rubber-banding.
import { BR_TICK_MS } from "./constants"

export interface Cell {
  x: number
  y: number
}

export class SnakeInterpolator {
  private prev: Cell[] = []
  private curr: Cell[] = []
  private at = 0

  /** Feed a new authoritative snapshot (remote update or my own tick). */
  push(seg: Cell[], now: number) {
    if (this.curr.length === 0) {
      this.prev = seg
    } else {
      this.prev = this.curr
    }
    this.curr = seg
    this.at = now
  }

  clear() {
    this.prev = []
    this.curr = []
  }

  get head(): Cell | null {
    return this.curr[0] ?? null
  }

  /** Smoothed segments at time `now`. */
  sample(now: number, tickMs = BR_TICK_MS): Cell[] {
    const t = Math.min(1, Math.max(0, (now - this.at) / tickMs))
    const out: Cell[] = []
    for (let i = 0; i < this.curr.length; i++) {
      const c = this.curr[i]
      // newly grown tail segment: start from the previous tail
      const p = this.prev[i] ?? this.prev[this.prev.length - 1] ?? c
      const jump = Math.abs(c.x - p.x) + Math.abs(c.y - p.y)
      out.push(jump > 2 ? c : { x: p.x + (c.x - p.x) * t, y: p.y + (c.y - p.y) * t })
    }
    return out
  }
}
