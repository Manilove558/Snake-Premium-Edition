// lib/bot-ai.ts — the AI brain for multiplayer bots.
//
// PURE module: no Firebase, no React. Given a snapshot of the world it returns
// the direction the bot should move next. The host client runs this (see
// hooks/use-bot-host.ts) and broadcasts the resulting snake like any player,
// so every client sees the same bot with zero extra sync protocol.

export type BotDifficulty = "easy" | "medium" | "hard"

export interface BotDifficultyConfig {
  label: string
  /** AI picks a new direction every N ticks (1 = every tick) */
  reactionTicks: number
  /** food search radius, in cells */
  searchRadius: number
  /** chance of ignoring the best move and wandering randomly */
  mistakeChance: number
  /** how many cells ahead the collision raycast probes */
  lookahead: number
  /** 0..1 — how much the bot hunts / cuts off enemy snakes */
  aggression: number
}

export const BOT_DIFFICULTY_CONFIG: Record<BotDifficulty, BotDifficultyConfig> = {
  easy: { label: "Easy", reactionTicks: 3, searchRadius: 8, mistakeChance: 0.25, lookahead: 3, aggression: 0.1 },
  medium: { label: "Medium", reactionTicks: 2, searchRadius: 14, mistakeChance: 0.1, lookahead: 5, aggression: 0.35 },
  hard: { label: "Hard", reactionTicks: 1, searchRadius: 40, mistakeChance: 0.02, lookahead: 8, aggression: 0.6 },
}

export const BOT_DIFFICULTIES: BotDifficulty[] = ["easy", "medium", "hard"]

export function isBotDifficulty(v: unknown): v is BotDifficulty {
  return v === "easy" || v === "medium" || v === "hard"
}

export interface AiCell {
  x: number
  y: number
}

export interface AiSnake {
  id: string
  seg: AiCell[]
  dir: AiCell
}

export interface AiZoneBox {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export interface AiZone {
  box: AiZoneBox
  /** the box after the next shrink (null once the final zone is reached) */
  target: AiZoneBox | null
  /** true while the 5 s warning banner is showing */
  warning: boolean
}

export interface BotWorld {
  /** square grid size (20 = classic arena, 120 = Battle Royale) */
  grid: number
  foods: AiCell[]
  /** every alive snake, INCLUDING the bot itself */
  snakes: AiSnake[]
  /** "x,y" wall cells (classic battle maps); empty set for Battle Royale */
  blocked: Set<string>
  /** shrinking safe zone (Battle Royale only); null = no zone */
  zone: AiZone | null
  /** classic "teleport" setting — borders wrap instead of killing */
  teleport: boolean
  /** classic "avoid snake collision" setting — bodies are harmless, ignore them */
  passThrough: boolean
}

export interface BotSelf {
  id: string
  head: AiCell
  dir: AiCell
  length: number
  growing: boolean
}

const DIRS: AiCell[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
]

const NEAR8: AiCell[] = [
  { x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 },
  { x: 1, y: 1 }, { x: 1, y: -1 }, { x: -1, y: 1 }, { x: -1, y: -1 },
]

const key = (x: number, y: number) => `${x},${y}`
const manhattan = (a: AiCell, b: AiCell) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y)
const wrap = (v: number, grid: number) => ((v % grid) + grid) % grid

/** Manhattan distance of a cell from the safe box (0 when inside). */
function zoneOutsideDist(box: AiZoneBox, x: number, y: number): number {
  const dx = x < box.minX ? box.minX - x : x > box.maxX ? x - box.maxX : 0
  const dy = y < box.minY ? box.minY - y : y > box.maxY ? y - box.maxY : 0
  return dx + dy
}

/** Nearest food within the search radius (null when nothing is close enough). */
function nearestFood(head: AiCell, foods: AiCell[], radius: number): AiCell | null {
  let best: AiCell | null = null
  let bd = radius + 1
  for (const f of foods) {
    const d = manhattan(head, f)
    if (d < bd) {
      bd = d
      best = f
    }
  }
  return best
}

/**
 * Decide the bot's next direction. Scores every legal (non-reversing) direction:
 *   danger  = walls / borders / snake bodies / shrinking zone / getting boxed in
 *   reward  = moving toward food, cutting off a weaker enemy (aggression)
 * Lowest score wins; `mistakeChance` keeps easy bots dumb and fun to beat.
 */
export function decideBotDirection(self: BotSelf, world: BotWorld, difficulty: BotDifficulty): AiCell {
  const cfg = BOT_DIFFICULTY_CONFIG[difficulty]
  const FOOD_WEIGHT = difficulty === "hard" ? 14 : difficulty === "medium" ? 9 : 5

  // Occupied cells. Each snake's tail tip is skipped — it vacates next tick
  // (unless that snake is growing; we only know this for the bot itself).
  const body = new Set<string>()
  if (!world.passThrough) {
    for (const s of world.snakes) {
      const n = s.seg.length
      const tailSkip = s.id === self.id ? (self.growing ? 0 : 1) : 1
      for (let i = 0; i < n - tailSkip; i++) body.add(key(s.seg[i].x, s.seg[i].y))
    }
  }

  // Flood-fill from a cell: how much free room is there? (trap avoidance)
  const freeRoom = (sx: number, sy: number): number => {
    const seen = new Set<string>([key(sx, sy)])
    const queue: AiCell[] = [{ x: sx, y: sy }]
    let count = 0
    while (queue.length > 0 && count < 90) {
      const c = queue.pop() as AiCell
      count++
      for (const d of DIRS) {
        let ax = c.x + d.x
        let ay = c.y + d.y
        if (world.teleport) {
          ax = wrap(ax, world.grid)
          ay = wrap(ay, world.grid)
        } else if (ax < 0 || ax >= world.grid || ay < 0 || ay >= world.grid) {
          continue
        }
        const k = key(ax, ay)
        if (seen.has(k) || world.blocked.has(k) || body.has(k)) continue
        if (world.zone && zoneOutsideDist(world.zone.box, ax, ay) > 0) continue
        seen.add(k)
        queue.push({ x: ax, y: ay })
      }
    }
    return count
  }

  const food = nearestFood(self.head, world.foods, cfg.searchRadius)

  // Aggression target: the nearest enemy head we can bully (we are at least as long).
  let prey: { x: number; y: number } | null = null
  if (cfg.aggression > 0 && !world.passThrough) {
    const radius = 5 + cfg.aggression * 12
    let bd = radius + 1
    for (const s of world.snakes) {
      if (s.id === self.id || s.seg.length === 0) continue
      const h = s.seg[0]
      const d = manhattan(self.head, h)
      if (d < bd && self.length >= s.seg.length - 1) {
        bd = d
        // aim 2 cells ahead of the prey's head — cut it off, don't chase its tail
        prey = { x: h.x + s.dir.x * 2, y: h.y + s.dir.y * 2 }
      }
    }
  }

  const scoreDir = (d: AiCell): number => {
    let nx = self.head.x + d.x
    let ny = self.head.y + d.y
    if (world.teleport) {
      nx = wrap(nx, world.grid)
      ny = wrap(ny, world.grid)
    }
    // Instant death -> never pick (unless everything is death).
    if (!world.teleport && (nx < 0 || nx >= world.grid || ny < 0 || ny >= world.grid)) return Infinity
    if (world.blocked.has(key(nx, ny))) return Infinity
    if (body.has(key(nx, ny))) return Infinity

    let danger = 0
    if (world.zone) danger += zoneOutsideDist(world.zone.box, nx, ny) * 600

    // Raycast: probe straight ahead, danger grows the sooner something is hit.
    let px = nx
    let py = ny
    for (let i = 1; i <= cfg.lookahead; i++) {
      px += d.x
      py += d.y
      let qx = px
      let qy = py
      if (world.teleport) {
        qx = wrap(qx, world.grid)
        qy = wrap(qy, world.grid)
      } else if (qx < 0 || qx >= world.grid || qy < 0 || qy >= world.grid) {
        danger += 500
        break
      }
      if (world.blocked.has(key(qx, qy)) || body.has(key(qx, qy))) {
        danger += 500 / i
        break
      }
      if (world.zone) danger += zoneOutsideDist(world.zone.box, qx, qy) * 60
      let near = 0
      for (const o of NEAR8) if (body.has(key(qx + o.x, qy + o.y))) near++
      danger += near * 8
    }

    // Don't swim into a pocket smaller than the snake (medium+ only).
    if (difficulty !== "easy") {
      const room = freeRoom(nx, ny)
      if (room < Math.max(12, self.length * 2)) danger += 800
    }

    let score = danger

    // Food: reward moves that get closer to the nearest food.
    if (food) {
      const before = manhattan(self.head, food)
      const after = manhattan({ x: nx, y: ny }, food)
      if (after < before) score -= (cfg.searchRadius - after) * FOOD_WEIGHT
    }

    // Aggression: reward cutting off the prey.
    if (prey) {
      const before = manhattan(self.head, prey)
      const after = manhattan({ x: nx, y: ny }, prey)
      if (after < before) score -= cfg.aggression * 60
    }

    // Zone warning: drift toward where the zone is about to be.
    if (world.zone?.warning && world.zone.target) {
      const t = world.zone.target
      const cx = (t.minX + t.maxX) / 2
      const cy = (t.minY + t.maxY) / 2
      const before = Math.abs(self.head.x - cx) + Math.abs(self.head.y - cy)
      const after = Math.abs(nx - cx) + Math.abs(ny - cy)
      if (after < before) score -= 25
    }

    return score
  }

  const cands = DIRS.filter((d) => !(d.x === -self.dir.x && d.y === -self.dir.y))
  const scored = cands.map((d) => ({ d, s: scoreDir(d) })).sort((a, b) => a.s - b.s)

  // Easy bots sometimes just wander (that's the fun of beating them).
  if (Math.random() < cfg.mistakeChance) {
    const safe = scored.filter((c) => c.s < Infinity)
    const pool = safe.length > 0 ? safe : scored
    return pool[Math.floor(Math.random() * pool.length)].d
  }
  return scored[0].d
}

/** Fun snake names for auto-filled bots (unused ones are picked first). */
const BOT_NAMES = ["Viper", "Cobra", "Mamba", "Python", "Anaconda", "Boa", "Kaa", "Naga", "Slinky", "Bolt", "Zara", "Rex"]

/** Pick a bot name nobody in the room is using yet. */
export function pickBotName(used: Set<string>, botIndex: number): string {
  const free = BOT_NAMES.find((n) => !used.has(n))
  return free ?? `Bot ${botIndex + 1}`
}
