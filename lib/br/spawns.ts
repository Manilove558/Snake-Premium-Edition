// lib/br/spawns.ts — balanced start positions on the big map (pure).
import { BR_GRID, BR_SPAWN_RING_RADIUS } from "./constants"

export interface BrSpawn {
  x: number
  y: number
  dx: number
  dy: number
}

/**
 * N players (4..8) are placed evenly on a ring around the centre, every snake facing the centre.
 * Equal angles = equal distance to the middle and to the nearest neighbour for everybody.
 * The ring is rotated by `seed` so the layout differs a little each match.
 */
export function computeSpawns(count: number, seed = 0): BrSpawn[] {
  const n = Math.max(1, count)
  const c = (BR_GRID - 1) / 2
  const offset = ((seed % 360) * Math.PI) / 180
  const out: BrSpawn[] = []
  for (let i = 0; i < n; i++) {
    const a = offset + (i / n) * Math.PI * 2
    const x = Math.round(c + Math.cos(a) * BR_SPAWN_RING_RADIUS)
    const y = Math.round(c + Math.sin(a) * BR_SPAWN_RING_RADIUS)
    // 4-way heading toward the centre along the dominant axis
    const vx = c - x
    const vy = c - y
    const horizontal = Math.abs(vx) >= Math.abs(vy)
    out.push({ x, y, dx: horizontal ? Math.sign(vx) || 1 : 0, dy: horizontal ? 0 : Math.sign(vy) || 1 })
  }
  return out
}
