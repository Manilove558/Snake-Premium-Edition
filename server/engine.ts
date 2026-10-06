// server/engine.ts — the AUTHORITATIVE snake simulation. Pure: no sockets, no timers, no Date.now().
//
// Time is injected (`tick(now)`), randomness is seeded, so a match can be replayed and unit-tested
// exactly. The room layer (server/rooms.ts) calls tick() 20 times a second and forwards the result.
//
// One simulation tick (every 50 ms):
//   0. forced removals (a disconnected player's snake is removed)
//   1. power-up expiry
//   2. Battle Royale zone check (3 s grace outside, then death)
//   3. movement — each snake advances one cell when its cooldown (3 ticks, 2 with speed) is up
//   4. collisions — resolved SIMULTANEOUSLY on the post-move board (so head-to-head and head-swaps are fair)
//   5. deaths — placements, kill credit, body -> food pellets
//   6. food eaten by survivors, power-ups applied
//   7. food refill
//   8. match-over check
//   9. build a delta GAME_STATE_SYNC (only snakes that changed)
import { BATTLE_GRID, getBattleMap } from "../lib/battle-maps"
import {
  BR_DROP_EVERY,
  BR_FOOD_REFILL_MS,
  BR_FOOD_TARGET,
  BR_GRID,
  BR_MIN_LENGTH,
  BR_START_LENGTH,
  ZONE_GRACE_MS,
  ZONE_TAIL_DAMAGE,
} from "../lib/br/constants"
import { computeSpawns } from "../lib/br/spawns"
import { buildZoneBoxes, getZoneState, isInsideZone, mulberry32, randomCellInBox, type ZoneBox, type ZoneState } from "../lib/br/zone"
import type { BotWorld } from "../lib/bot-ai"
import {
  DIR_VECTOR,
  NET,
  OPPOSITE_DIR,
  type DeathCause,
  type Dir,
  type FoodKind,
  type FoodNet,
  type GameConfig,
  type GameMode,
  type GameOverPayload,
  type GameStateSync,
  type PlayerDiedEvent,
  type Point,
  type RoomSettings,
  type SnakeNet,
  type StandingRow,
} from "../shared/snake-protocol"

/** Same 8 spawn points as BATTLE_SPAWNS in lib/multiplayer.ts (that file is client-only, so it is mirrored here). */
const CLASSIC_SPAWNS: readonly { x: number; y: number; dx: number; dy: number }[] = [
  { x: 3, y: 3, dx: 1, dy: 0 },
  { x: 16, y: 3, dx: -1, dy: 0 },
  { x: 3, y: 16, dx: 1, dy: 0 },
  { x: 16, y: 16, dx: -1, dy: 0 },
  { x: 9, y: 2, dx: 0, dy: 1 },
  { x: 10, y: 17, dx: 0, dy: -1 },
  { x: 2, y: 10, dx: 1, dy: 0 },
  { x: 17, y: 9, dx: -1, dy: 0 },
]

export interface EnginePlayer {
  id: string
  name: string
  /** verified account id, echoed into the final standings (survives the player leaving the room) */
  uid?: string | null
  /** AI bot (server/bots.ts): flagged in the standings, never rated */
  bot?: boolean
}

export interface EngineOptions {
  mode: GameMode
  settings: Pick<RoomSettings, "map" | "teleport" | "avoidCollision">
  players: EnginePlayer[]
  /** server time (ms) of the FIRST tick; ticks before this are ignored (countdown) */
  startAt: number
  /** deterministic seed (zone, spawns, food). Defaults to a random one. */
  seed?: number
}

export interface TickOutput {
  /** null when nothing changed this tick */
  sync: GameStateSync | null
  died: PlayerDiedEvent[]
  /** set exactly once, on the tick the match ends */
  over: GameOverPayload | null
}

interface Snake {
  id: string
  name: string
  uid: string | null
  bot: boolean
  seg: Point[]
  dir: Dir
  /** buffered turns (max 2) so a quick "up, left" inside one step is not lost */
  queue: Dir[]
  alive: boolean
  score: number
  kills: number
  peak: number
  /** ticks until the next move */
  cooldown: number
  speedUntil: number
  shieldUntil: number
  /** when the head left the safe zone (null = inside) */
  outsideSince: number | null
  /** newest MOVE_INPUT seq received */
  seq: number
  /** newest seq the client may consider handled: updated only when the snake MOVES, so it travels with the delta */
  ackSeq: number
  dirty: boolean
  diedAt: number | null
  placement: number | null
  disconnected: boolean
}

interface Food {
  id: number
  x: number
  y: number
  kind: FoodKind
}

interface Death {
  snake: Snake
  cause: DeathCause
  killer: Snake | null
}

const emptyOutput = (): TickOutput => ({ sync: null, died: [], over: null })

export class GameEngine {
  readonly config: GameConfig
  readonly startAt: number
  readonly seed: number

  private readonly cols: number
  private readonly rows: number
  private readonly rng: () => number
  private readonly snakes = new Map<string, Snake>() // insertion order = spawn seat
  private readonly foods = new Map<number, Food>()
  private readonly foodAt = new Map<number, number>() // cell key -> food id
  private readonly walls = new Set<number>()
  private readonly portalTo = new Map<number, Point>() // cell key -> where you come out
  private readonly zoneBoxes: ZoneBox[] | null
  private readonly foodTarget: number

  private nextFoodId = 1
  private tickIndex = 0
  private lastFullTick = 0
  private nextRefillAt = 0
  private foodAdded: FoodNet[] = []
  private foodRemoved: number[] = []
  private readonly pendingRemovals = new Set<string>()
  private over = false
  private result: GameOverPayload | null = null

  constructor(opts: EngineOptions) {
    this.startAt = opts.startAt
    this.seed = (opts.seed ?? Math.floor(Math.random() * 0xffffffff)) >>> 0
    this.rng = mulberry32(this.seed)

    const royale = opts.mode === "royale"
    this.cols = this.rows = royale ? BR_GRID : BATTLE_GRID
    const map = royale ? null : getBattleMap(opts.settings.map)

    this.config = {
      mode: opts.mode,
      cols: this.cols,
      rows: this.rows,
      tickRate: NET.TICK_RATE,
      stepMs: NET.STEP_TICKS * NET.TICK_MS,
      fastStepMs: NET.FAST_STEP_TICKS * NET.TICK_MS,
      teleport: royale ? false : opts.settings.teleport,
      avoidCollision: opts.settings.avoidCollision,
      map: map?.id ?? "royale",
      walls: map ? map.walls.map((w) => ({ x: w.x, y: w.y })) : [],
      portals: map ? map.portals.map(([a, b]) => [{ x: a.x, y: a.y }, { x: b.x, y: b.y }] as [Point, Point]) : [],
      zone: royale ? { seed: this.seed, startAt: opts.startAt } : null,
    }
    for (const w of this.config.walls) this.walls.add(this.key(w.x, w.y))
    for (const [a, b] of this.config.portals) {
      this.portalTo.set(this.key(a.x, a.y), b)
      this.portalTo.set(this.key(b.x, b.y), a)
    }
    this.zoneBoxes = royale ? buildZoneBoxes(this.seed) : null
    this.foodTarget = royale ? BR_FOOD_TARGET : NET.CLASSIC_FOOD_TARGET
    this.nextRefillAt = opts.startAt + BR_FOOD_REFILL_MS

    this.spawnSnakes(opts.players, royale)
    this.refillFood(opts.startAt, this.foodTarget) // initial fill (royale: the full 70)
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Queue a turn. Returns false if it was rejected (dead / unknown / 180° reversal / stale seq).
   * Reversals are judged against the LAST QUEUED direction, so "up then down" can never fold a snake onto itself.
   */
  setDirection(playerId: string, dir: Dir, seq: number): boolean {
    const s = this.snakes.get(playerId)
    if (!s || !s.alive || this.over) return false
    if (!Number.isFinite(seq) || seq <= s.seq) return false // duplicate / out of order
    s.seq = seq
    const last = s.queue.length > 0 ? s.queue[s.queue.length - 1] : s.dir
    if (dir === last || dir === OPPOSITE_DIR[last]) return false
    if (s.queue.length >= 2) return false
    s.queue.push(dir)
    return true
  }

  /** The player left or timed out: the snake dies on the next tick (cause "disconnect") and turns into food. */
  removePlayer(playerId: string): void {
    const s = this.snakes.get(playerId)
    if (!s) return
    s.disconnected = true
    if (s.alive) this.pendingRemovals.add(playerId)
  }

  get isOver(): boolean {
    return this.over
  }

  getResult(): GameOverPayload | null {
    return this.result
  }

  aliveCount(): number {
    let n = 0
    for (const s of this.snakes.values()) if (s.alive) n++
    return n
  }

  /** Full snapshot of the current state. Read-only: does not disturb the delta bookkeeping. */
  snapshot(): GameStateSync {
    return {
      tick: this.tickIndex,
      t: this.lastTickTime || this.startAt,
      full: true,
      snakes: [...this.snakes.values()].map((s) => this.toNet(s)),
      foodAdd: [...this.foods.values()].map((f) => ({ ...f })),
      foodRemove: [],
      aliveCount: this.aliveCount(),
    }
  }

  // -------------------------------------------------------------------------
  // Bot support (server/bots.ts) — read-only views, the engine never trusts a bot more than a human
  // -------------------------------------------------------------------------

  /** Ids of the alive snakes that will MOVE on the next tick: a bot decides its turn right before that. */
  dueToMove(): string[] {
    const out: string[] = []
    for (const s of this.snakes.values()) if (s.alive && s.cooldown <= 1) out.push(s.id)
    return out
  }

  /** Head-first cells + heading of one alive snake (null when dead / unknown). */
  snakeCells(id: string): { seg: Point[]; dir: Dir } | null {
    const s = this.snakes.get(id)
    return s && s.alive ? { seg: s.seg.map((c) => ({ x: c.x, y: c.y })), dir: s.dir } : null
  }

  /** Shrinking-zone state at server time `now` (null in classic). */
  zoneAt(now: number): ZoneState | null {
    return this.zoneBoxes ? getZoneState(this.zoneBoxes, now - this.startAt) : null
  }

  /** The world as lib/bot-ai.ts wants to see it (every alive snake, humans + bots). */
  botWorld(now: number): BotWorld {
    if (!this.botStatic) {
      this.botStatic = {
        walls: new Set(this.config.walls.map((w) => `${w.x},${w.y}`)),
        portals: this.config.portals.map(([a, b]) => [{ x: a.x, y: a.y }, { x: b.x, y: b.y }] as const),
      }
    }
    const zone = this.zoneAt(now)
    return {
      width: this.cols,
      height: this.rows,
      wrap: this.config.teleport,
      walls: this.botStatic.walls,
      portals: this.botStatic.portals,
      passThrough: this.config.avoidCollision,
      foods: [...this.foods.values()].map((f) => ({ x: f.x, y: f.y })),
      snakes: [...this.snakes.values()]
        .filter((s) => s.alive)
        .map((s) => ({ id: s.id, seg: s.seg, dx: DIR_VECTOR[s.dir].dx, dy: DIR_VECTOR[s.dir].dy })),
      zone: zone ? { box: zone.box, target: zone.target, shrinking: zone.shrinking, warning: zone.warning } : null,
    }
  }
  private botStatic: { walls: Set<string>; portals: readonly (readonly [Point, Point])[] } | null = null

  /** Read-only view for tests / debugging. */
  inspect(): { snakes: ReadonlyMap<string, Readonly<Snake>>; foods: ReadonlyMap<number, Readonly<Food>> } {
    return { snakes: this.snakes, foods: this.foods }
  }

  private lastTickTime = 0

  /** Advance the simulation. Call every NET.TICK_MS (the room layer does). */
  tick(now: number): TickOutput {
    if (this.over || now < this.startAt) return emptyOutput()
    this.tickIndex++
    this.lastTickTime = now

    const out = emptyOutput()
    const aliveAtStart = this.aliveCount()
    const dying = new Map<Snake, Death>()
    const kill = (snake: Snake, cause: DeathCause, killer: Snake | null) => {
      if (!dying.has(snake)) dying.set(snake, { snake, cause, killer })
    }

    // 0. forced removals ------------------------------------------------------------------------
    for (const id of this.pendingRemovals) {
      const s = this.snakes.get(id)
      if (s && s.alive) kill(s, "disconnect", null)
    }
    this.pendingRemovals.clear()

    // 1. power-up expiry ------------------------------------------------------------------------
    for (const s of this.snakes.values()) {
      if (!s.alive) continue
      if (s.speedUntil && now >= s.speedUntil) {
        s.speedUntil = 0
        s.dirty = true
      }
      if (s.shieldUntil && now >= s.shieldUntil) {
        s.shieldUntil = 0
        s.dirty = true
      }
    }

    // 2. zone -----------------------------------------------------------------------------------
    const zone = this.zoneBoxes ? getZoneState(this.zoneBoxes, now - this.startAt) : null
    if (zone) {
      for (const s of this.snakes.values()) {
        if (!s.alive || dying.has(s)) continue
        const head = s.seg[0]
        if (isInsideZone(zone.box, head.x, head.y)) {
          s.outsideSince = null
        } else {
          if (s.outsideSince === null) s.outsideSince = now
          if (now - s.outsideSince >= ZONE_GRACE_MS) kill(s, "zone", null)
        }
      }
    }

    // 3. movement -------------------------------------------------------------------------------
    const moved: Snake[] = []
    const ate = new Map<Snake, Food>()
    for (const s of this.snakes.values()) {
      if (!s.alive || dying.has(s)) continue
      s.cooldown -= 1
      if (s.cooldown > 0) continue
      s.cooldown = s.speedUntil > now ? NET.FAST_STEP_TICKS : NET.STEP_TICKS

      const dir = s.queue.shift() ?? s.dir
      s.dir = dir
      s.ackSeq = s.seq
      const { dx, dy } = DIR_VECTOR[dir]
      let nx = s.seg[0].x + dx
      let ny = s.seg[0].y + dy
      if (nx < 0 || ny < 0 || nx >= this.cols || ny >= this.rows) {
        if (this.config.teleport) {
          nx = (nx + this.cols) % this.cols
          ny = (ny + this.rows) % this.rows
        } else {
          kill(s, "wall", null)
          continue
        }
      }
      if (this.walls.has(this.key(nx, ny))) {
        kill(s, "wall", null)
        continue
      }
      const exit = this.portalTo.get(this.key(nx, ny))
      if (exit) {
        nx = exit.x
        ny = exit.y
      }

      s.seg.unshift({ x: nx, y: ny })
      const foodId = this.foodAt.get(this.key(nx, ny))
      const food = foodId !== undefined ? this.foods.get(foodId) : undefined
      if (food) ate.set(s, food)
      else s.seg.pop() // no food: the tail follows
      // Outside the zone the snake also loses a tail segment every step (never below BR_MIN_LENGTH)
      if (ZONE_TAIL_DAMAGE && s.outsideSince !== null && s.seg.length > BR_MIN_LENGTH) s.seg.pop()
      s.dirty = true
      moved.push(s)
    }

    // 4. collisions (simultaneous, on the post-move board) --------------------------------------
    if (moved.length > 0) {
      const occupancy = new Map<number, { snake: Snake; index: number }[]>()
      for (const s of this.snakes.values()) {
        if (!s.alive || dying.has(s)) continue
        s.seg.forEach((c, index) => {
          const k = this.key(c.x, c.y)
          const list = occupancy.get(k)
          if (list) list.push({ snake: s, index })
          else occupancy.set(k, [{ snake: s, index }])
        })
      }
      const movedSet = new Set(moved)
      for (const s of moved) {
        if (s.shieldUntil > now) continue // shield: immune to collisions (walls & zone still kill)
        const head = s.seg[0]
        let hitSelf = false
        let hitOther: Snake | null = null
        let headOn: Snake | null = null
        for (const e of occupancy.get(this.key(head.x, head.y)) ?? []) {
          if (e.snake === s) {
            if (e.index > 0) hitSelf = true
            continue
          }
          if (this.config.avoidCollision) continue
          if (e.index === 0 && movedSet.has(e.snake)) headOn = e.snake // both heads entered this cell
          else hitOther = hitOther ?? e.snake
        }
        if (hitSelf) kill(s, "self", null)
        else if (headOn) {
          // two normal snakes: both die. A shielded one survives and is credited with the kill.
          if (headOn.shieldUntil > now) kill(s, "kill", headOn)
          else kill(s, "head_on", null)
        } else if (hitOther) kill(s, "kill", hitOther)
      }
    }

    // 5. deaths ---------------------------------------------------------------------------------
    if (dying.size > 0) {
      // Everyone eliminated on the same tick shares one placement (matches how ties are ranked in lib/ranked.ts).
      const placement = aliveAtStart - dying.size + 1
      for (const { snake: s, cause, killer } of dying.values()) {
        s.alive = false
        s.placement = placement
        s.diedAt = now
        s.dirty = true
        s.queue.length = 0
        s.speedUntil = 0
        s.shieldUntil = 0
        this.dropBodyAsFood(s)
        if (killer) {
          killer.kills += 1
          killer.score += NET.KILL_SCORE
          killer.dirty = true
        }
        out.died.push({
          id: s.id,
          name: s.name,
          cause,
          killerId: killer?.id ?? null,
          killerName: killer?.name ?? null,
          placement,
          aliveCount: aliveAtStart - dying.size,
          t: now,
        })
      }
    }

    // 6. food eaten by SURVIVORS only (a snake that dies on the pellet's cell does not eat it) ------
    for (const [s, food] of ate) {
      if (!s.alive || !this.foods.has(food.id)) continue
      this.removeFood(food.id)
      s.score += NET.FOOD_SCORE
      if (food.kind === "speed") s.speedUntil = now + NET.SPEED_MS
      else if (food.kind === "shield") s.shieldUntil = now + NET.SHIELD_MS
      s.dirty = true
    }
    for (const s of moved) if (s.alive) s.peak = Math.max(s.peak, s.seg.length)

    // 7. food refill ----------------------------------------------------------------------------
    if (this.zoneBoxes) {
      if (now >= this.nextRefillAt) {
        this.nextRefillAt = now + BR_FOOD_REFILL_MS
        const box = zone ? (zone.warning && zone.target ? zone.target : zone.box) : undefined
        this.refillFood(now, this.foodTarget, box, 12)
      }
    } else {
      this.refillFood(now, this.foodTarget)
    }

    // 8. match over? ----------------------------------------------------------------------------
    const alive = this.aliveCount()
    const started = this.snakes.size
    if (alive === 0 || (alive === 1 && started >= 2)) out.over = this.finish("last_alive", now)
    else if (now - this.startAt >= NET.MATCH_MAX_MS) out.over = this.finish("timeout", now)

    // 9. sync -----------------------------------------------------------------------------------
    const full = out.over !== null || this.tickIndex - this.lastFullTick >= NET.FULL_SYNC_EVERY_TICKS
    const hasDelta = this.foodAdded.length > 0 || this.foodRemoved.length > 0 || [...this.snakes.values()].some((s) => s.dirty)
    if (full || hasDelta) {
      out.sync = full ? this.snapshot() : this.buildDelta(now)
      if (full) this.lastFullTick = this.tickIndex
      this.clearDeltaState()
    }
    return out
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private key(x: number, y: number): number {
    return y * this.cols + x
  }

  private spawnSnakes(players: EnginePlayer[], royale: boolean): void {
    // Fisher–Yates with the match RNG so seats are not simply "join order"
    const order = players.slice()
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1))
      ;[order[i], order[j]] = [order[j], order[i]]
    }
    const spawns = royale ? computeSpawns(order.length, this.seed % 360) : CLASSIC_SPAWNS
    const length = royale ? BR_START_LENGTH : NET.CLASSIC_START_LENGTH
    order.forEach((p, i) => {
      const sp = spawns[i % spawns.length]
      const seg: Point[] = []
      for (let k = 0; k < length; k++) seg.push({ x: sp.x - sp.dx * k, y: sp.y - sp.dy * k })
      const dir: Dir = sp.dx === 1 ? "RIGHT" : sp.dx === -1 ? "LEFT" : sp.dy === 1 ? "DOWN" : "UP"
      this.snakes.set(p.id, {
        id: p.id,
        name: p.name,
        uid: p.uid ?? null,
        bot: p.bot === true,
        seg,
        dir,
        queue: [],
        alive: true,
        score: 0,
        kills: 0,
        peak: length,
        cooldown: NET.STEP_TICKS,
        speedUntil: 0,
        shieldUntil: 0,
        outsideSince: null,
        seq: 0,
        ackSeq: 0,
        dirty: true,
        diedAt: null,
        placement: null,
        disconnected: false,
      })
    })
  }

  private addFood(x: number, y: number, kind: FoodKind): boolean {
    const k = this.key(x, y)
    if (x < 0 || y < 0 || x >= this.cols || y >= this.rows || this.walls.has(k) || this.foodAt.has(k)) return false
    const food: Food = { id: this.nextFoodId++, x, y, kind }
    this.foods.set(food.id, food)
    this.foodAt.set(k, food.id)
    this.foodAdded.push({ ...food })
    return true
  }

  private removeFood(id: number): void {
    const f = this.foods.get(id)
    if (!f) return
    this.foods.delete(id)
    this.foodAt.delete(this.key(f.x, f.y))
    this.foodRemoved.push(id)
  }

  /** A dead snake's body becomes pellets: every BR_DROP_EVERY-th segment (same rule as the Firebase battle). */
  private dropBodyAsFood(s: Snake): void {
    for (let i = 0; i < s.seg.length; i += BR_DROP_EVERY) this.addFood(s.seg[i].x, s.seg[i].y, "normal")
  }

  private rollKind(): FoodKind {
    if (this.rng() >= NET.POWERUP_CHANCE) return "normal"
    return this.rng() < 0.5 ? "speed" : "shield"
  }

  /** Top the map up to `target` pellets on free cells (inside `box` when given), at most `maxNew` at a time. */
  private refillFood(_now: number, target: number, box?: ZoneBox, maxNew = Infinity): void {
    let missing = Math.min(target - this.foods.size, maxNew)
    if (missing <= 0) return
    const occupied = new Set<number>()
    for (const s of this.snakes.values()) if (s.alive) for (const c of s.seg) occupied.add(this.key(c.x, c.y))
    const maxAttempts = missing * 30 // fixed up-front: `missing` shrinks inside the loop
    for (let attempt = 0; attempt < maxAttempts && missing > 0; attempt++) {
      const c = box ? randomCellInBox(box, this.rng) : { x: Math.floor(this.rng() * this.cols), y: Math.floor(this.rng() * this.rows) }
      if (occupied.has(this.key(c.x, c.y))) continue
      if (this.addFood(c.x, c.y, this.rollKind())) missing--
    }
  }

  private finish(reason: GameOverPayload["reason"], now: number): GameOverPayload {
    this.over = true
    const all = [...this.snakes.values()]
    const alive = all.filter((s) => s.alive)

    // Survivors: the last one standing wins; on timeout the longest snake wins (equal length = shared place).
    for (const s of alive) {
      s.placement = 1 + alive.filter((o) => o.seg.length > s.seg.length).length
    }
    const top = alive.filter((s) => s.placement === 1)
    const winnerId = reason === "last_alive" ? (alive.length === 1 ? alive[0].id : null) : top.length === 1 ? top[0].id : null

    const standings: StandingRow[] = all
      .map((s) => ({
        id: s.id,
        uid: s.uid,
        name: s.name,
        placement: s.placement ?? this.snakes.size,
        kills: s.kills,
        score: s.score,
        peakMass: s.peak,
        survivedMs: Math.max(0, (s.diedAt ?? now) - this.startAt),
        disconnected: s.disconnected,
        bot: s.bot,
      }))
      .sort((a, b) => a.placement - b.placement || b.kills - a.kills || b.score - a.score)

    this.result = { winnerId, reason, durationMs: Math.max(0, now - this.startAt), standings }
    return this.result
  }

  private toNet(s: Snake): SnakeNet {
    const flat: number[] = []
    if (s.alive) for (const c of s.seg) flat.push(c.x, c.y)
    return {
      id: s.id,
      seg: flat,
      dir: s.dir,
      alive: s.alive,
      score: s.score,
      kills: s.kills,
      speedUntil: s.speedUntil,
      shieldUntil: s.shieldUntil,
      // state-based, not time-based: expiry zeroes speedUntil every tick, so snapshot and delta always agree
      stepMs: (s.speedUntil ? NET.FAST_STEP_TICKS : NET.STEP_TICKS) * NET.TICK_MS,
      seq: s.ackSeq,
    }
  }

  private buildDelta(now: number): GameStateSync {
    return {
      tick: this.tickIndex,
      t: now,
      full: false,
      snakes: [...this.snakes.values()].filter((s) => s.dirty).map((s) => this.toNet(s)),
      foodAdd: this.foodAdded,
      foodRemove: this.foodRemoved,
      aliveCount: this.aliveCount(),
    }
  }

  private clearDeltaState(): void {
    for (const s of this.snakes.values()) s.dirty = false
    this.foodAdded = []
    this.foodRemoved = []
  }
}
