// lib/bot-ai.ts — PURE bot brain for multiplayer (no Firebase, no React, no timers).
//
// One `BotBrain` per bot. Every grid tick the host hands it a snapshot of the world and gets back
// the next 4-way direction. The brain never mutates anything, so it is trivial to unit-test and it
// works for BOTH game modes (classic 20x20 arena and the 120x120 Battle Royale):
//
//   * Pathfinding / food seeking : BFS over free cells inside `searchRadius`, remembering which first
//                                  step reaches the nearest food (portals + edge-wrap aware)
//   * Collision avoidance        : every candidate step is raycast `lookAhead` cells, checked against
//                                  walls, map borders, ALL snake bodies (humans + bots) and the bot's
//                                  own body, plus a flood-fill so it never turns into a dead end
//   * Zone awareness (royale)    : leaves a closing zone early and runs back inside when outside
//   * Aggression                 : stronger bots cut off the head of shorter snakes
//   * Difficulty                 : reaction delay, scan radius, look-ahead, mistakes, aggression
import { isInsideZone, type ZoneBox } from "./br/zone"

// ---------------------------------------------------------------------------
// Identity helpers (shared by lobby, battle screens and the host runner)
// ---------------------------------------------------------------------------

export const BOT_ID_PREFIX = "bot_"
export const isBotId = (id: string | null | undefined): boolean => !!id && id.startsWith(BOT_ID_PREFIX)
export const makeBotId = (): string => `${BOT_ID_PREFIX}${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

export const BOT_NAMES = [
  "Viper", "Mamba", "Cobra", "Python", "Taipan", "Adder", "Boa", "Naga",
  "Asp", "Rattler", "Sidewinder", "Anaconda", "Krait", "Copperhead", "Basilisk", "Slither",
] as const

/** Unique bot names that are not already used in the room. */
export function pickBotNames(count: number, taken: Set<string>, rng: () => number = Math.random): string[] {
  const pool = BOT_NAMES.filter((n) => !taken.has(n))
  // Fisher-Yates so the names differ every match
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[pool[i], pool[j]] = [pool[j], pool[i]]
  }
  const out: string[] = pool.slice(0, count)
  for (let i = 1; out.length < count; i++) out.push(`Bot ${i + taken.size}`)
  return out
}

// ---------------------------------------------------------------------------
// Difficulty
// ---------------------------------------------------------------------------

export type BotLevel = "easy" | "medium" | "hard"
export const BOT_LEVELS: readonly BotLevel[] = ["easy", "medium", "hard"]
export const DEFAULT_BOT_LEVEL: BotLevel = "medium"
export const isBotLevel = (v: unknown): v is BotLevel => v === "easy" || v === "medium" || v === "hard"

export interface BotDifficulty {
  level: BotLevel
  label: string
  /** Reaction delay: the bot re-plans only every N ticks. In between it just keeps going while the way ahead is free. */
  reactionTicks: number
  /** Food scan radius in cells (also the BFS window). */
  searchRadius: number
  /** Raycast depth: how many cells straight ahead a candidate move is checked. */
  lookAhead: number
  /** Flood-fill cap (dead-end detection). 0 = the bot does not check free space at all. */
  spaceCap: number
  /** 0..1 — how hard it hunts shorter snakes (cut-off moves). */
  aggression: number
  /** Chance per re-plan of taking a random safe move instead of the best one. */
  mistakeChance: number
  /** Avoid cells that an equal / longer enemy head can reach next tick. */
  headAwareness: boolean
}

export const BOT_DIFFICULTY: Record<BotLevel, BotDifficulty> = {
  easy: { level: "easy", label: "Easy", reactionTicks: 3, searchRadius: 7, lookAhead: 2, spaceCap: 10, aggression: 0, mistakeChance: 0.07, headAwareness: false },
  medium: { level: "medium", label: "Medium", reactionTicks: 2, searchRadius: 13, lookAhead: 4, spaceCap: 36, aggression: 0.35, mistakeChance: 0.015, headAwareness: true },
  hard: { level: "hard", label: "Hard", reactionTicks: 1, searchRadius: 22, lookAhead: 6, spaceCap: 90, aggression: 0.85, mistakeChance: 0, headAwareness: true },
}

// ---------------------------------------------------------------------------
// World snapshot
// ---------------------------------------------------------------------------

export interface BotCell {
  x: number
  y: number
}

export interface BotSnakeView {
  id: string
  /** head first */
  seg: readonly BotCell[]
  dx: number
  dy: number
}

export interface BotZoneView {
  box: ZoneBox
  /** box after the next shrink (null once the final zone is reached) */
  target: ZoneBox | null
  shrinking: boolean
  warning: boolean
}

export interface BotWorld {
  width: number
  height: number
  /** true = the arena edge teleports to the opposite side (classic "Teleport" option) */
  wrap: boolean
  /** "x,y" keys of solid map walls */
  walls: ReadonlySet<string>
  portals: readonly (readonly [BotCell, BotCell])[]
  /** true = snakes pass through each other (room option "Avoid snake collision") */
  passThrough: boolean
  foods: readonly BotCell[]
  /** EVERY snake in the match (humans + bots). The brain skips its own id. */
  snakes: readonly BotSnakeView[]
  /** Battle Royale only */
  zone?: BotZoneView | null
}

export interface BotSelf {
  id: string
  /** head first */
  seg: readonly BotCell[]
  dx: number
  dy: number
  /** pending growth (the tail stays this tick when > 0) */
  growth: number
}

// ---------------------------------------------------------------------------
// Grid helpers
// ---------------------------------------------------------------------------

const DIRS: readonly BotCell[] = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
]

const keyOf = (w: BotWorld, x: number, y: number) => y * w.width + x

/** One step from (x,y). Mirrors the battle engines exactly: edge wrap / wall death, solid walls, portals. */
export function stepCell(w: BotWorld, x: number, y: number, dx: number, dy: number): BotCell | null {
  let nx = x + dx
  let ny = y + dy
  if (nx < 0 || nx >= w.width || ny < 0 || ny >= w.height) {
    if (!w.wrap) return null
    nx = (nx + w.width) % w.width
    ny = (ny + w.height) % w.height
  }
  if (w.walls.has(`${nx},${ny}`)) return null
  for (const [a, b] of w.portals) {
    if (a.x === nx && a.y === ny) return { x: b.x, y: b.y }
    if (b.x === nx && b.y === ny) return { x: a.x, y: a.y }
  }
  return { x: nx, y: ny }
}

function axisDist(w: BotWorld, a: number, b: number, size: number): number {
  const d = Math.abs(a - b)
  return w.wrap ? Math.min(d, size - d) : d
}
const manhattan = (w: BotWorld, a: BotCell, b: BotCell) => axisDist(w, a.x, b.x, w.width) + axisDist(w, a.y, b.y, w.height)
const chebyshev = (w: BotWorld, a: BotCell, b: BotCell) => Math.max(axisDist(w, a.x, b.x, w.width), axisDist(w, a.y, b.y, w.height))

/** Cells the bot can NOT enter this tick: other snakes + its own body (tail vacates unless it is growing). */
function buildBlocked(w: BotWorld, self: BotSelf): Set<number> {
  const s = new Set<number>()
  if (!w.passThrough) {
    for (const o of w.snakes) {
      if (o.id === self.id) continue
      for (const c of o.seg) s.add(keyOf(w, c.x, c.y))
    }
  }
  const end = self.growth > 0 ? self.seg.length : self.seg.length - 1
  for (let i = 1; i < end; i++) s.add(keyOf(w, self.seg[i].x, self.seg[i].y))
  return s
}

/** Raycast: number of free cells in a straight line after `from` (max `max`). */
function rayClear(w: BotWorld, blocked: Set<number>, from: BotCell, d: BotCell, max: number): number {
  let c = from
  let n = 0
  while (n < max) {
    const nx = stepCell(w, c.x, c.y, d.x, d.y)
    if (!nx || blocked.has(keyOf(w, nx.x, nx.y))) break
    c = nx
    n++
  }
  return n
}

/** Number of free cells reachable from `start` (stops counting at `cap`). Detects dead ends. */
function floodCount(w: BotWorld, blocked: Set<number>, start: BotCell, cap: number): number {
  const seen = new Set<number>([keyOf(w, start.x, start.y)])
  const stack: BotCell[] = [start]
  let n = 0
  while (stack.length > 0 && n < cap) {
    const c = stack.pop() as BotCell
    n++
    for (const d of DIRS) {
      const nn = stepCell(w, c.x, c.y, d.x, d.y)
      if (!nn) continue
      const k = keyOf(w, nn.x, nn.y)
      if (seen.has(k) || blocked.has(k)) continue
      seen.add(k)
      stack.push(nn)
    }
  }
  return n
}

interface Candidate {
  dir: BotCell
  cell: BotCell | null
  safe: boolean
}

/**
 * Pathfinding. One BFS from the head over free cells, every frontier cell remembers WHICH of the
 * candidate first steps it came from. Returns, per candidate, the path length to the nearest food.
 */
function foodDistances(w: BotWorld, blocked: Set<number>, head: BotCell, cands: Candidate[], foods: readonly BotCell[], radius: number): (number | undefined)[] {
  const out: (number | undefined)[] = cands.map(() => undefined)
  const foodKeys = new Set<number>()
  for (const f of foods) if (chebyshev(w, head, f) <= radius) foodKeys.add(keyOf(w, f.x, f.y))
  if (foodKeys.size === 0) return out

  const visited = new Set<number>()
  const qx: number[] = []
  const qy: number[] = []
  const qf: number[] = []
  const qd: number[] = []
  cands.forEach((c, i) => {
    if (!c.safe || !c.cell) return
    visited.add(keyOf(w, c.cell.x, c.cell.y))
    qx.push(c.cell.x)
    qy.push(c.cell.y)
    qf.push(i)
    qd.push(1)
  })
  const need = qx.length
  let found = 0
  for (let h = 0; h < qx.length; h++) {
    const x = qx[h]
    const y = qy[h]
    const first = qf[h]
    const d = qd[h]
    if (out[first] === undefined && foodKeys.has(keyOf(w, x, y))) {
      out[first] = d
      if (++found >= need) break
    }
    if (d >= radius * 2) continue
    for (const dd of DIRS) {
      const n = stepCell(w, x, y, dd.x, dd.y)
      if (!n) continue
      const k = keyOf(w, n.x, n.y)
      if (visited.has(k) || blocked.has(k)) continue
      if (chebyshev(w, head, n) > radius) continue
      visited.add(k)
      qx.push(n.x)
      qy.push(n.y)
      qf.push(first)
      qd.push(d + 1)
    }
  }
  return out
}

const edgeDist = (b: ZoneBox, c: BotCell) => Math.min(c.x - b.minX, b.maxX - c.x, c.y - b.minY, b.maxY - c.y)

// ---------------------------------------------------------------------------
// The brain
// ---------------------------------------------------------------------------

export class BotBrain {
  private cooldown = 0

  constructor(
    public level: BotLevel = DEFAULT_BOT_LEVEL,
    private rng: () => number = Math.random,
  ) {}

  private get cfg(): BotDifficulty {
    return BOT_DIFFICULTY[this.level]
  }

  reset() {
    this.cooldown = 0
  }

  /** Next heading (never a 180° turn). */
  decide(self: BotSelf, w: BotWorld): BotCell {
    const cfg = this.cfg
    const head = self.seg[0]
    const dir: BotCell = { x: self.dx, y: self.dy }
    const blocked = buildBlocked(w, self)

    // Safe zone I should be in (royale): the NEXT box while the border is closing / about to close
    const z = w.zone ?? null
    const zoneBox = z ? ((z.warning || z.shrinking) && z.target ? z.target : z.box) : null
    const headInZone = zoneBox ? isInsideZone(zoneBox, head.x, head.y) : true

    // --- reaction delay ---------------------------------------------------------------------------
    // Between plans the bot keeps its heading, but ONLY while the whole look-ahead ray is clear:
    // danger is always answered immediately, the delay just makes it slow to react to NEW food.
    if (this.cooldown > 0 && headInZone) {
      this.cooldown--
      const ahead = stepCell(w, head.x, head.y, dir.x, dir.y)
      if (ahead && !blocked.has(keyOf(w, ahead.x, ahead.y)) && rayClear(w, blocked, ahead, dir, cfg.lookAhead) >= cfg.lookAhead) return dir
    }
    this.cooldown = Math.max(0, cfg.reactionTicks - 1)

    // --- candidates: straight / left / right -------------------------------------------------------
    const cands: Candidate[] = DIRS.filter((d) => !(d.x === -dir.x && d.y === -dir.y)).map((d) => {
      const cell = stepCell(w, head.x, head.y, d.x, d.y)
      return { dir: d, cell, safe: !!cell && !blocked.has(keyOf(w, cell.x, cell.y)) }
    })

    // --- usable foods (royale: ignore food that is outside the zone I must be in) -------------------
    const foods = zoneBox ? w.foods.filter((f) => isInsideZone(zoneBox, f.x, f.y)) : w.foods
    const dists = foodDistances(w, blocked, head, cands, foods, cfg.searchRadius)
    let nearest: BotCell | null = null
    let nearestD = Infinity
    for (const f of foods) {
      const d = manhattan(w, head, f)
      if (d < nearestD) {
        nearestD = d
        nearest = f
      }
    }

    // --- enemy heads: where can they be next tick? -------------------------------------------------------
    const threats: { keys: Set<number>; stronger: boolean; head: BotCell; dir: BotCell; len: number }[] = []
    if (!w.passThrough) {
      for (const o of w.snakes) {
        if (o.id === self.id || o.seg.length === 0) continue
        const h = o.seg[0]
        const keys = new Set<number>()
        for (const d of DIRS) {
          if (d.x === -o.dx && d.y === -o.dy) continue
          const n = stepCell(w, h.x, h.y, d.x, d.y)
          if (n) keys.add(keyOf(w, n.x, n.y))
        }
        threats.push({ keys, stronger: o.seg.length >= self.seg.length, head: h, dir: { x: o.dx, y: o.dy }, len: o.seg.length })
      }
    }

    // --- score every SAFE candidate ---------------------------------------------------------------------
    const scored: { c: Candidate; score: number }[] = []
    cands.forEach((c, i) => {
      if (!c.safe || !c.cell) return
      const n = c.cell
      let score = 0

      // raycast: clear cells straight ahead after this step
      const ray = rayClear(w, blocked, n, c.dir, cfg.lookAhead)
      score += ray * 2
      if (ray < cfg.lookAhead) score -= (cfg.lookAhead - ray) * 3

      // dead-end detection
      if (cfg.spaceCap > 0) {
        const space = floodCount(w, blocked, n, cfg.spaceCap)
        const need = Math.min(cfg.spaceCap, self.seg.length + 2)
        if (space < need) score -= 60 + 140 * (1 - space / need)
        else score += Math.min(space, cfg.spaceCap) * 0.05
      }

      // food: BFS path length, else greedy pull toward the nearest food
      let foodWeight = headInZone ? 28 : 6
      const fd = dists[i]
      if (fd !== undefined) {
        score += foodWeight * (1 - fd / (cfg.searchRadius * 2 + 1)) + (fd === 1 ? 8 : 0)
      } else if (nearest) {
        foodWeight *= 0.3
        score += foodWeight * Math.max(-1, Math.min(1, (nearestD - manhattan(w, n, nearest)) / 2))
      }

      // enemy heads
      const nk = keyOf(w, n.x, n.y)
      for (const t of threats) {
        if (cfg.headAwareness && t.keys.has(nk)) score -= t.stronger ? 70 : 12
        // aggression: shorter prey -> move toward the cell 3 steps in front of its head (cut-off)
        if (cfg.aggression > 0 && !t.stronger && t.len + 1 < self.seg.length && chebyshev(w, head, t.head) <= cfg.searchRadius * 0.75) {
          let tx = t.head.x
          let ty = t.head.y
          for (let s = 0; s < 3; s++) {
            const nx = stepCell(w, tx, ty, t.dir.x, t.dir.y)
            if (!nx) break
            tx = nx.x
            ty = nx.y
          }
          const target = { x: tx, y: ty }
          score += cfg.aggression * 7 * (manhattan(w, head, target) - manhattan(w, n, target)) * 0.5
        }
      }

      // map border: hugging a hard edge is how snakes get cornered
      if (!w.wrap) {
        const e = Math.min(n.x, w.width - 1 - n.x, n.y, w.height - 1 - n.y)
        if (e < 2) score -= (2 - e) * 2
      }

      // shrinking zone
      if (zoneBox) {
        const inZone = isInsideZone(zoneBox, n.x, n.y)
        const cx = (zoneBox.minX + zoneBox.maxX) / 2
        const cy = (zoneBox.minY + zoneBox.maxY) / 2
        const dc = (p: BotCell) => Math.hypot(p.x - cx, p.y - cy)
        if (!inZone && headInZone) score -= 60
        if (!headInZone) score += 14 * (dc(head) - dc(n)) // run back inside
        else if ((z?.warning || z?.shrinking) && edgeDist(zoneBox, n) < 2) score -= 8
      }

      score += this.rng() * 0.8 // tie-breaker so bots are not robotic
      scored.push({ c, score })
    })

    // --- no safe move: doomed. Keep going straight (or whatever is physically possible) ----------
    if (scored.length === 0) {
      const any = cands.find((c) => c.cell) ?? cands[0]
      return any ? any.dir : dir
    }

    // --- mistakes (difficulty) ----------------------------------------------------------------------------
    if (scored.length > 1 && this.rng() < cfg.mistakeChance) {
      return scored[Math.floor(this.rng() * scored.length)].c.dir
    }
    scored.sort((a, b) => b.score - a.score)
    return scored[0].c.dir
  }
}
