// lib/br/zone.ts — PURE shrinking-zone logic (no Firebase, no React).
//
// The host writes ONE small record when the match starts:
//     rooms/{CODE}/game/zone = { seed, startAt }          (startAt = server time in ms)
// Every client derives the exact same zone from (seed, server-time) — nothing is written per tick,
// so there is no zone traffic and no drift between clients.
import { BR_GRID, ZONE_GRACE_MS, ZONE_INTERVAL_MS, ZONE_SHRINK_MS, ZONE_SIZES, ZONE_WARNING_MS } from "./constants"

export interface ZoneBox {
  /** inclusive cell bounds (floats while the border is moving) */
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export interface ZoneConfig {
  seed: number
  startAt: number
}

export interface ZoneState {
  /** the playable box right now */
  box: ZoneBox
  /** the box after the next shrink (null once the final zone is reached) */
  target: ZoneBox | null
  /** true during the 5 s before a shrink starts */
  warning: boolean
  /** true while the border is moving */
  shrinking: boolean
  /** ms until the next shrink starts (null after the last one) */
  msToNextShrink: number | null
  /** 1-based number of the next shrink (null after the last one) */
  nextStage: number | null
  /** index of the stage whose box is (or is becoming) the current one */
  stage: number
}

/** Small deterministic PRNG so every client builds the same boxes from the same seed. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const boxOf = (x: number, y: number, size: number): ZoneBox => ({ minX: x, minY: y, maxX: x + size - 1, maxY: y + size - 1 })

/**
 * Nested boxes: zone[i+1] always lies fully inside zone[i].
 * The next centre is chosen randomly, so every match ends in a different corner of the map.
 */
export function buildZoneBoxes(seed: number): ZoneBox[] {
  const rnd = mulberry32(seed)
  const boxes: ZoneBox[] = [boxOf(0, 0, BR_GRID)]
  for (let i = 1; i < ZONE_SIZES.length; i++) {
    const prev = boxes[i - 1]
    const size = ZONE_SIZES[i]
    const prevSize = prev.maxX - prev.minX + 1
    const slack = prevSize - size
    boxes.push(boxOf(prev.minX + Math.floor(rnd() * (slack + 1)), prev.minY + Math.floor(rnd() * (slack + 1)), size))
  }
  return boxes
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const ease = (t: number) => t * t * (3 - 2 * t) // smoothstep
const lerpBox = (a: ZoneBox, b: ZoneBox, t: number): ZoneBox => ({
  minX: lerp(a.minX, b.minX, t),
  minY: lerp(a.minY, b.minY, t),
  maxX: lerp(a.maxX, b.maxX, t),
  maxY: lerp(a.maxY, b.maxY, t),
})

/** Pure function: zone at `elapsedMs` since the match started. */
export function getZoneState(boxes: ZoneBox[], elapsedMs: number): ZoneState {
  const last = boxes.length - 1
  const e = Math.max(0, elapsedMs)
  // number of shrinks that have already STARTED (shrink s starts at s * 30 s)
  const started = Math.min(last, Math.floor(e / ZONE_INTERVAL_MS))

  let box = boxes[0]
  let shrinking = false
  if (started >= 1) {
    const p = Math.min(1, (e - started * ZONE_INTERVAL_MS) / ZONE_SHRINK_MS)
    box = lerpBox(boxes[started - 1], boxes[started], ease(p))
    shrinking = p < 1
  }

  const next = started + 1
  if (next > last) {
    return { box, target: null, warning: false, shrinking, msToNextShrink: null, nextStage: null, stage: started }
  }
  const msToNext = next * ZONE_INTERVAL_MS - e
  return {
    box,
    target: boxes[next],
    warning: msToNext <= ZONE_WARNING_MS,
    shrinking,
    msToNextShrink: msToNext,
    nextStage: next,
    stage: started,
  }
}

/** Is a grid cell inside the (possibly moving) safe box? Cell centres are compared, so no flicker at the edge. */
export function isInsideZone(box: ZoneBox, x: number, y: number): boolean {
  return x >= box.minX - 0.5 && x <= box.maxX + 0.5 && y >= box.minY - 0.5 && y <= box.maxY + 0.5
}

/**
 * Tracks how long MY head has been outside the zone.
 * Each client only judges its own snake (same victim-authoritative model as the rest of the battle),
 * so tiny clock differences at the border can never desync the match.
 */
export class ZoneDamageTracker {
  private outsideSince: number | null = null

  /** Call once per tick. Returns the state of the penalty for this tick. */
  update(inside: boolean, now: number): { outside: boolean; graceLeftMs: number; dead: boolean } {
    if (inside) {
      this.outsideSince = null
      return { outside: false, graceLeftMs: ZONE_GRACE_MS, dead: false }
    }
    if (this.outsideSince === null) this.outsideSince = now
    const left = ZONE_GRACE_MS - (now - this.outsideSince)
    return { outside: true, graceLeftMs: Math.max(0, left), dead: left <= 0 }
  }

  reset() {
    this.outsideSince = null
  }
}

/** A random cell inside a box (used by the host to place food). */
export function randomCellInBox(box: ZoneBox, rnd: () => number = Math.random): { x: number; y: number } {
  const x0 = Math.max(0, Math.ceil(box.minX))
  const x1 = Math.min(BR_GRID - 1, Math.floor(box.maxX))
  const y0 = Math.max(0, Math.ceil(box.minY))
  const y1 = Math.min(BR_GRID - 1, Math.floor(box.maxY))
  return { x: x0 + Math.floor(rnd() * (x1 - x0 + 1)), y: y0 + Math.floor(rnd() * (y1 - y0 + 1)) }
}

export function formatClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`
}
