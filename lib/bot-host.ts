"use client"

// lib/bot-host.ts — HOST-SIDE bot runner (classic battle + Battle Royale).
//
// Bots are ordinary room players (`rooms/{CODE}/players/bot_xxx`, flagged `bot: true`) whose snakes are
// driven by the HOST's browser. They write to the SAME nodes a human does:
//     rooms/{CODE}/snakes/{botId}       every tick  (so humans collide with bots exactly like with humans)
//     rooms/{CODE}/players/{botId}      alive / score / kills
//     rooms/{CODE}/game/killFeed        when a bot dies
//     rooms/{CODE}/game/food(s)         when a bot eats
// so NO other client needs to know bots exist, and nothing can desync: there is exactly one brain per bot.
//
// Host migration: a bot's state can be rebuilt from its snake node, and the runner heart-beats
// `game/botBeat`; if the beat stops, the oldest human takes over the host role (see hooks/use-bot-host.ts).
import { increment, onValue, push, ref, remove, set, update } from "firebase/database"
import { getFirebaseDb } from "./firebase"
import {
  BATTLE_KILL_SCORE,
  BATTLE_SNAKE_STALE_MS,
  BATTLE_SPAWNS,
  BATTLE_TICK_MS,
  foodRef,
  getRoomSettings,
  killFeedRef,
  mySnakeRef,
  snakesRef,
  subscribeServerOffset,
  type KillEntry,
  type MpPlayer,
  type MpRoom,
  type MpSnakeState,
} from "./multiplayer"
import { getBattleMap } from "./battle-maps"
import { BotBrain, DEFAULT_BOT_LEVEL, isBotId, isBotLevel, type BotCell, type BotWorld } from "./bot-ai"
import { BR_GRID, BR_MIN_LENGTH, BR_START_LENGTH, ZONE_TAIL_DAMAGE } from "./br/constants"
import { claimFood, dropFoodFromBody, foodsRef, type BrFoods } from "./br/net"
import { computeSpawns } from "./br/spawns"
import { buildZoneBoxes, getZoneState, isInsideZone, ZoneDamageTracker, type ZoneBox, type ZoneState } from "./br/zone"

type Mode = "classic" | "royale"

interface BotState {
  id: string
  seg: BotCell[]
  dx: number
  dy: number
  growth: number
  alive: boolean
  brain: BotBrain
  damage: ZoneDamageTracker
}

const BEAT_EVERY_MS = 1000

export class BotHost {
  private bots = new Map<string, BotState>()
  private snakes: Record<string, MpSnakeState> = {}
  private seen = new Map<string, { ts: number; recvAt: number }>()
  private food: BotCell | null = null // classic: single food
  private foods: BrFoods = {} // royale: many foods
  private foodCells = new Map<string, string>()
  private appliedKills = new Set<string>()
  private claiming = new Set<string>()
  private offset = 0
  private matchKey = ""
  private spawned = false
  private boxes: { seed: number; list: ZoneBox[] } | null = null
  private beatAt = 0
  private unsubs: (() => void)[] = []
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(
    private code: string,
    private getRoom: () => MpRoom | null,
  ) {}

  // ---- lifecycle -------------------------------------------------------------------------------

  start() {
    const code = this.code
    this.unsubs.push(subscribeServerOffset((o) => (this.offset = o)))
    this.unsubs.push(
      onValue(snakesRef(code), (snap) => {
        const v = (snap.val() ?? {}) as Record<string, MpSnakeState>
        this.snakes = v
        const now = Date.now()
        for (const [pid, s] of Object.entries(v)) {
          const r = this.seen.get(pid)
          if (!r || r.ts !== s.ts) this.seen.set(pid, { ts: s.ts, recvAt: now })
        }
        for (const pid of [...this.seen.keys()]) if (!(pid in v)) this.seen.delete(pid)
      }),
    )
    this.unsubs.push(onValue(foodRef(code), (snap) => (this.food = (snap.val() ?? null) as BotCell | null)))
    this.unsubs.push(
      onValue(foodsRef(code), (snap) => {
        this.foods = (snap.val() ?? {}) as BrFoods
        const cells = new Map<string, string>()
        for (const [id, c] of Object.entries(this.foods)) cells.set(`${c.x},${c.y}`, id)
        this.foodCells = cells
      }),
    )
    // A bot that kills somebody grows +2, exactly like a human killer (applied once per kill-feed entry).
    this.unsubs.push(
      onValue(killFeedRef(code), (snap) => {
        const val = (snap.val() ?? {}) as Record<string, KillEntry>
        for (const [key, k] of Object.entries(val)) {
          if (!k.killerId || this.appliedKills.has(key)) continue
          const b = this.bots.get(k.killerId)
          if (!b) continue
          this.appliedKills.add(key)
          if (b.alive) b.growth += 2
        }
      }),
    )
    this.timer = setInterval(() => {
      try {
        this.tick()
      } catch (e) {
        // a bad frame must never take the host's own game down
        if (typeof process !== "undefined" && process.env?.BOT_DEBUG) console.error("[bot-host] tick failed", e)
      }
    }, BATTLE_TICK_MS)
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    for (const u of this.unsubs) u()
    this.unsubs = []
    this.bots.clear()
  }

  // ---- helpers ---------------------------------------------------------------------------------

  private db = () => getFirebaseDb()
  private serverNow = () => Date.now() + this.offset
  private playerRef = (id: string) => ref(this.db(), `rooms/${this.code}/players/${id}`)

  private fresh(pid: string): boolean {
    const r = this.seen.get(pid)
    return !r || Date.now() - r.recvAt <= BATTLE_SNAKE_STALE_MS
  }

  private zoneAt(room: MpRoom, serverMs: number): ZoneState | null {
    const z = room.game?.zone
    if (!z) return null
    if (!this.boxes || this.boxes.seed !== z.seed) this.boxes = { seed: z.seed, list: buildZoneBoxes(z.seed) }
    return getZoneState(this.boxes.list, serverMs - z.startAt)
  }

  /** Spawn seats = the same formulas the human clients use for their own snake. */
  private seatOf(room: MpRoom, mode: Mode, id: string): { x: number; y: number; dx: number; dy: number; len: number } | null {
    const players = Object.values(room.players ?? {})
    if (mode === "royale") {
      const zone = room.game?.zone
      if (!zone) return null
      const order = room.game?.order ?? [...players].sort((a, b) => (a.joinedAt ?? 0) - (b.joinedAt ?? 0)).map((p) => p.id)
      const spawns = computeSpawns(order.length, zone.seed % 360)
      const s = spawns[Math.max(0, order.indexOf(id)) % spawns.length]
      return { ...s, len: BR_START_LENGTH }
    }
    const order = [...players].sort((a, b) => (a.joinedAt ?? 0) - (b.joinedAt ?? 0)).map((p) => p.id)
    const s = BATTLE_SPAWNS[Math.max(0, order.indexOf(id)) % BATTLE_SPAWNS.length]
    return { ...s, len: 3 }
  }

  private makeBot(room: MpRoom, p: MpPlayer, seg: BotCell[], dx: number, dy: number): BotState {
    const level = isBotLevel(p.botLevel) ? p.botLevel : getRoomSettings(room).botLevel ?? DEFAULT_BOT_LEVEL
    return { id: p.id, seg, dx, dy, growth: 0, alive: true, brain: new BotBrain(level), damage: new ZoneDamageTracker() }
  }

  // ---- match phases ------------------------------------------------------------------------------

  private spawnAll(room: MpRoom, mode: Mode) {
    for (const p of Object.values(room.players ?? {})) {
      if (!isBotId(p.id)) continue
      const seat = this.seatOf(room, mode, p.id)
      if (!seat) return // royale zone record not there yet -> try again next tick
      const seg: BotCell[] = []
      for (let i = 0; i < seat.len; i++) seg.push({ x: seat.x - seat.dx * i, y: seat.y - seat.dy * i })
      this.bots.set(p.id, this.makeBot(room, p, seg, seat.dx, seat.dy))
      set(mySnakeRef(this.code, p.id), { seg, dx: seat.dx, dy: seat.dy, ts: mode === "royale" ? this.serverNow() : Date.now() }).catch(() => {})
    }
    this.spawned = true
  }

  /** Host migration mid-match: rebuild every living bot from what is already in the database. */
  private adoptAll(room: MpRoom, mode: Mode) {
    for (const p of Object.values(room.players ?? {})) {
      if (!isBotId(p.id) || !p.alive) continue
      const s = this.snakes[p.id]
      if (s?.seg?.length) this.bots.set(p.id, this.makeBot(room, p, s.seg.map((c) => ({ x: c.x, y: c.y })), s.dx, s.dy))
      else this.markDead(room, mode, p.id, "self") // alive on paper but no snake: never let it stall the match
    }
    this.spawned = true
  }

  private markDead(room: MpRoom, mode: Mode, id: string, cause: KillEntry["cause"]) {
    const b = this.bots.get(id) ?? { id, seg: [], dx: 0, dy: 0, growth: 0, alive: true, brain: new BotBrain(), damage: new ZoneDamageTracker() }
    this.die(room, mode, b, cause)
  }

  private heartbeat() {
    const now = Date.now()
    if (now - this.beatAt < BEAT_EVERY_MS) return
    this.beatAt = now
    update(ref(this.db(), `rooms/${this.code}/game`), { botBeat: this.serverNow() }).catch(() => {})
  }

  // ---- the tick ----------------------------------------------------------------------------------

  private tick() {
    const room = this.getRoom()
    if (!room) return
    const mode: Mode = !room.isRanked && getRoomSettings(room).mode === "royale" ? "royale" : "classic"
    const key = `${room.code}:${room.game?.countdownEndsAt ?? 0}`
    if (key !== this.matchKey) {
      this.matchKey = key
      this.bots.clear()
      this.appliedKills.clear()
      this.claiming.clear()
      this.spawned = false
    }
    if (room.status === "countdown") {
      this.heartbeat()
      if (!this.spawned) this.spawnAll(room, mode)
      return
    }
    if (room.status !== "playing") return
    this.heartbeat()
    if (!this.spawned) this.adoptAll(room, mode)

    const settings = getRoomSettings(room)
    const map = getBattleMap(settings.map)
    const classic = mode === "classic"
    const world: BotWorld = {
      width: classic ? 20 : BR_GRID,
      height: classic ? 20 : BR_GRID,
      wrap: classic && settings.teleport,
      walls: classic ? new Set(map.walls.map((w) => `${w.x},${w.y}`)) : new Set<string>(),
      portals: classic ? map.portals : [],
      passThrough: classic && settings.avoidCollision,
      foods: classic ? (this.food ? [this.food] : []) : Object.values(this.foods),
      snakes: [],
      zone: null,
    }
    const t = this.serverNow()
    const zs = classic ? null : this.zoneAt(room, t)
    if (zs) world.zone = { box: zs.box, target: zs.target, shrinking: zs.shrinking, warning: zs.warning }
    const snakes = world.snakes as { id: string; seg: readonly BotCell[]; dx: number; dy: number }[]
    for (const [pid, s] of Object.entries(this.snakes)) {
      if (this.bots.has(pid) || !this.fresh(pid)) continue
      snakes.push({ id: pid, seg: s.seg ?? [], dx: s.dx, dy: s.dy })
    }
    for (const b of this.bots.values()) if (b.alive) snakes.push({ id: b.id, seg: b.seg.slice(), dx: b.dx, dy: b.dy })

    // random order each tick so no bot always wins head-on races
    const order = [...this.bots.values()].filter((b) => b.alive).sort(() => Math.random() - 0.5)
    for (const b of order) {
      if (!b.alive || room.players?.[b.id]?.alive === false) {
        b.alive = false
        continue
      }
      const dir = b.brain.decide({ id: b.id, seg: b.seg, dx: b.dx, dy: b.dy, growth: b.growth }, world)
      b.dx = dir.x
      b.dy = dir.y
      if (classic) this.moveClassic(room, b, world, settings.teleport)
      else this.moveRoyale(room, b, t, zs)
    }
  }

  // ---- movement: identical rules to the human engines -------------------------------------------

  /** Other snakes a bot can crash into (fresh humans + other living bots, LIVE positions). */
  private obstacles(self: BotState): { id: string; seg: readonly BotCell[] }[] {
    const out: { id: string; seg: readonly BotCell[] }[] = []
    for (const [pid, s] of Object.entries(this.snakes)) {
      if (pid === self.id || this.bots.has(pid) || !this.fresh(pid)) continue
      out.push({ id: pid, seg: s.seg ?? [] })
    }
    for (const o of this.bots.values()) if (o.alive && o.id !== self.id) out.push({ id: o.id, seg: o.seg })
    return out
  }

  private moveClassic(room: MpRoom, b: BotState, world: BotWorld, teleport: boolean) {
    const head = b.seg[0]
    let nx = head.x + b.dx
    let ny = head.y + b.dy
    if (nx < 0 || nx >= 20 || ny < 0 || ny >= 20) {
      if (!teleport) return this.die(room, "classic", b, "wall")
      nx = (nx + 20) % 20
      ny = (ny + 20) % 20
    }
    if (world.walls.has(`${nx},${ny}`)) return this.die(room, "classic", b, "wall")
    let newHead: BotCell = { x: nx, y: ny }
    for (const [a, c] of world.portals) {
      if (a.x === nx && a.y === ny) { newHead = { x: c.x, y: c.y }; break }
      if (c.x === nx && c.y === ny) { newHead = { x: a.x, y: a.y }; break }
    }
    const myBody = b.growth > 0 ? b.seg : b.seg.slice(0, -1)
    if (myBody.some((s, i) => i > 0 && s.x === newHead.x && s.y === newHead.y)) return this.die(room, "classic", b, "self")
    if (!world.passThrough) {
      for (const o of this.obstacles(b)) {
        if (o.seg.some((s) => s.x === newHead.x && s.y === newHead.y)) {
          return this.die(room, "classic", b, "kill", o.id, room.players?.[o.id]?.name ?? "Player")
        }
      }
    }
    const f = this.food
    if (f && f.x === newHead.x && f.y === newHead.y) this.eatClassic(room, b, newHead)
    b.seg.unshift(newHead)
    if (b.growth > 0) b.growth -= 1
    else b.seg.pop()
    set(mySnakeRef(this.code, b.id), { seg: b.seg, dx: b.dx, dy: b.dy, ts: Date.now() }).catch(() => {})
  }

  private eatClassic(room: MpRoom, b: BotState, at: BotCell) {
    b.growth += 1
    update(this.playerRef(b.id), { score: increment(1) }).catch(() => {})
    const map = getBattleMap(getRoomSettings(room).map)
    const taken = new Set<string>([`${at.x},${at.y}`])
    for (const s of Object.values(this.snakes)) for (const c of s.seg ?? []) taken.add(`${c.x},${c.y}`)
    for (const o of this.bots.values()) for (const c of o.seg) taken.add(`${c.x},${c.y}`)
    for (const w of map.walls) taken.add(`${w.x},${w.y}`)
    for (const [a, c] of map.portals) { taken.add(`${a.x},${a.y}`); taken.add(`${c.x},${c.y}`) }
    const free: BotCell[] = []
    for (let x = 0; x < 20; x++) for (let y = 0; y < 20; y++) if (!taken.has(`${x},${y}`)) free.push({ x, y })
    if (free.length === 0) return
    const nf = free[Math.floor(Math.random() * free.length)]
    this.food = nf
    set(foodRef(this.code), nf).catch(() => {})
  }

  private moveRoyale(room: MpRoom, b: BotState, t: number, zs: ZoneState | null) {
    const head = b.seg[0]
    const nx = head.x + b.dx
    const ny = head.y + b.dy
    if (nx < 0 || nx >= BR_GRID || ny < 0 || ny >= BR_GRID) return this.die(room, "royale", b, "wall")
    const myBody = b.growth > 0 ? b.seg : b.seg.slice(0, -1)
    if (myBody.some((s, i) => i > 0 && s.x === nx && s.y === ny)) return this.die(room, "royale", b, "self")
    for (const o of this.obstacles(b)) {
      if (o.seg.some((s) => s.x === nx && s.y === ny)) {
        return this.die(room, "royale", b, "kill", o.id, room.players?.[o.id]?.name ?? "Player")
      }
    }
    let outside = false
    if (zs) {
      const z = b.damage.update(isInsideZone(zs.box, nx, ny), t)
      if (z.dead) return this.die(room, "royale", b, "zone")
      outside = z.outside
    }
    const fid = this.foodCells.get(`${nx},${ny}`)
    if (fid && !this.claiming.has(fid)) {
      this.claiming.add(fid)
      delete this.foods[fid]
      this.foodCells.delete(`${nx},${ny}`)
      claimFood(this.code, fid).then((ok) => {
        this.claiming.delete(fid)
        if (!ok || !b.alive) return
        b.growth += 1
        update(this.playerRef(b.id), { score: increment(1) }).catch(() => {})
      })
    }
    b.seg.unshift({ x: nx, y: ny })
    if (b.growth > 0) b.growth -= 1
    else b.seg.pop()
    if (outside && ZONE_TAIL_DAMAGE && b.seg.length > BR_MIN_LENGTH) b.seg.pop()
    set(mySnakeRef(this.code, b.id), { seg: b.seg, dx: b.dx, dy: b.dy, ts: t }).catch(() => {})
  }

  // ---- elimination (same writes as a human's die()) ---------------------------------------------

  private die(room: MpRoom, mode: Mode, b: BotState, cause: KillEntry["cause"], killerId?: string, killerName?: string) {
    if (!b.alive) return
    b.alive = false
    const t = mode === "royale" ? this.serverNow() : Date.now()
    update(this.playerRef(b.id), mode === "royale" ? { alive: false, diedAt: t } : { alive: false }).catch(() => {})
    remove(mySnakeRef(this.code, b.id)).catch(() => {})
    if (mode === "royale" && b.seg.length > 0) {
      const box = this.zoneAt(room, t)?.box ?? { minX: 0, minY: 0, maxX: BR_GRID - 1, maxY: BR_GRID - 1 }
      dropFoodFromBody(this.code, [...b.seg], box).catch(() => {}) // corpse -> food
    }
    const entry: KillEntry = {
      killerId: killerId ?? null,
      killerName: killerName ?? "",
      victimId: b.id,
      victimName: room.players?.[b.id]?.name ?? "Bot",
      cause,
      ts: t,
    }
    push(killFeedRef(this.code), entry).catch(() => {})
    if (killerId) {
      update(this.playerRef(killerId), { score: increment(BATTLE_KILL_SCORE), ...(mode === "royale" ? { kills: increment(1) } : {}) }).catch(() => {})
    }
  }
}

