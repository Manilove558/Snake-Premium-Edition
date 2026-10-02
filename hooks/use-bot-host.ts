"use client"

// hooks/use-bot-host.ts — the host client simulates every AI bot in the room.
//
// Design (host-authoritative, zero protocol changes):
//   * Bots are ordinary players (isBot: true) in rooms/{code}/players.
//   * ONLY the client whose playerId === room.hostId runs this hook's loop.
//   * Each tick it moves every living bot with the AI brain (lib/bot-ai.ts),
//     writes rooms/{code}/snakes/{botId} exactly like a human client would,
//     and applies the same eat / die / killfeed / score rules as the battle
//     components — so every other client renders bots with its existing code.
//   * Host migration: the new host has no local sims, so it adopts the live
//     snake snapshots from Firebase and keeps simulating seamlessly.

import { useEffect, useRef } from "react"
import { increment, onValue, push, ref, remove, set, update } from "firebase/database"
import { getFirebaseDb } from "@/lib/firebase"
import {
  BOT_DIFFICULTY_CONFIG,
  decideBotDirection,
  isBotDifficulty,
  type AiSnake,
  type BotDifficulty,
  type BotWorld,
} from "@/lib/bot-ai"
import {
  BATTLE_KILL_SCORE,
  BATTLE_SNAKE_STALE_MS,
  BATTLE_SPAWNS,
  BATTLE_TICK_MS,
  foodRef,
  getRoomSettings,
  killFeedRef,
  mySnakeRef,
  playerDisplayName,
  snakesRef,
  subscribeToRoom,
  type KillEntry,
  type MpPlayer,
  type MpRoom,
  type MpSnakeState,
  type MpSettings,
} from "@/lib/multiplayer"
import { blockedCellKeys, getBattleMap } from "@/lib/battle-maps"
import { BR_GRID, BR_MIN_LENGTH, BR_START_LENGTH, BR_TICK_MS, ZONE_TAIL_DAMAGE } from "@/lib/br/constants"
import { computeSpawns } from "@/lib/br/spawns"
import { buildZoneBoxes, getZoneState, isInsideZone, ZoneDamageTracker, type ZoneBox, type ZoneState } from "@/lib/br/zone"
import { claimFood, dropFoodFromBody, fetchServerOffset, foodsRef, type BrFoods } from "@/lib/br/net"

interface Seg {
  x: number
  y: number
}

interface BotSim {
  seg: Seg[]
  dir: Seg
  growth: number
  alive: boolean
  /** stagger AI decisions so bots don't all think on the same tick */
  ticks: number
  /** killfeed keys that already granted +2 growth (no double counting) */
  appliedKills: Set<string>
  /** local time (ms) this sim was created — old kills are never re-granted */
  bornAt: number
  /** per-bot zone grace timer (Battle Royale) */
  zone: ZoneDamageTracker
}

const EMPTY_BLOCKED = new Set<string>()

const byJoinedAt = (a: MpPlayer, b: MpPlayer) => (a.joinedAt ?? 0) - (b.joinedAt ?? 0)

export function useBotHost(code: string | null, playerId: string) {
  const codeRef = useRef(code)
  codeRef.current = code
  const playerIdRef = useRef(playerId)
  playerIdRef.current = playerId

  const roomRef = useRef<MpRoom | null>(null)
  const snakesRef2 = useRef<Record<string, MpSnakeState>>({})
  const foodClassicRef = useRef<Seg | null>(null)
  const brFoodsRef = useRef<BrFoods>({})
  const foodCellRef = useRef(new Map<string, string>())
  const sims = useRef(new Map<string, BotSim>())
  const offsetRef = useRef(0)
  const zoneSeedRef = useRef<number | null>(null)
  const zoneBoxesRef = useRef<ZoneBox[] | null>(null)
  const matchKeyRef = useRef<string | null>(null)
  const claimingRef = useRef(new Set<string>())
  /** every killfeed key seen so far — new sims (e.g. after host migration) seed appliedKills from this */
  const seenKillKeysRef = useRef(new Set<string>())

  // --- helpers (all state lives in refs, so these are render-independent) ---

  const liveBots = (room: MpRoom): MpPlayer[] =>
    Object.values(room.players ?? {}).filter((p) => p.isBot && p.alive)

  const playerOrder = (room: MpRoom): string[] =>
    Object.values(room.players ?? {}).sort(byJoinedAt).map((p) => p.id)

  const botDifficultyOf = (bot: MpPlayer): BotDifficulty =>
    isBotDifficulty(bot.botDifficulty) ? bot.botDifficulty : "medium"

  const newSim = (): BotSim => ({
    seg: [],
    dir: { x: 1, y: 0 },
    growth: 0,
    alive: true,
    ticks: Math.floor(Math.random() * 3),
    appliedKills: new Set(seenKillKeysRef.current),
    bornAt: Date.now(),
    zone: new ZoneDamageTracker(),
  })

  /** Adopt a live snapshot (host migration) instead of spawning fresh. */
  const adoptSim = (snap: MpSnakeState): BotSim => {
    const sim = newSim()
    sim.seg = (snap.seg ?? []).map((c) => ({ x: c.x, y: c.y }))
    sim.dir = { x: snap.dx ?? 1, y: snap.dy ?? 0 }
    return sim
  }

  /** Every snake as the AI / collision code should see it: live bot sims win over stale snapshots. */
  const liveSnakes = (): Record<string, { seg: Seg[]; ts: number }> => {
    const out: Record<string, { seg: Seg[]; ts: number }> = {}
    const now = Date.now()
    for (const [pid, s] of Object.entries(snakesRef2.current)) {
      if (!s?.seg?.length) continue
      out[pid] = { seg: s.seg, ts: s.ts ?? 0 }
    }
    for (const [bid, sim] of sims.current) {
      if (sim.alive && sim.seg.length > 0) out[bid] = { seg: sim.seg, ts: now }
    }
    return out
  }

  const freshSnakes = (now: number): Record<string, { seg: Seg[]; ts: number }> => {
    const out: Record<string, { seg: Seg[]; ts: number }> = {}
    for (const [pid, s] of Object.entries(liveSnakes())) {
      if (now - s.ts > BATTLE_SNAKE_STALE_MS) continue
      out[pid] = s
    }
    return out
  }

  // --- classic battle ------------------------------------------------------

  const ensureClassicSpawned = (code: string, room: MpRoom) => {
    const order = playerOrder(room)
    for (const bot of liveBots(room)) {
      if (sims.current.has(bot.id)) continue
      const snap = snakesRef2.current[bot.id]
      if (snap?.seg?.length) {
        sims.current.set(bot.id, adoptSim(snap))
        continue
      }
      const idx = Math.max(0, order.indexOf(bot.id))
      const s = BATTLE_SPAWNS[idx % BATTLE_SPAWNS.length]
      const sim = newSim()
      for (let i = 0; i < 3; i++) sim.seg.push({ x: s.x - s.dx * i, y: s.y - s.dy * i })
      sim.dir = { x: s.dx, y: s.dy }
      sims.current.set(bot.id, sim)
      set(mySnakeRef(code, bot.id), { seg: sim.seg, dx: s.dx, dy: s.dy, ts: Date.now() }).catch(() => {})
    }
  }

  /** Mirrors the battle component's die(): mark dead, clear snake, killfeed, killer score. */
  const killBotClassic = (
    code: string, room: MpRoom, bot: MpPlayer, sim: BotSim,
    cause: KillEntry["cause"], killerId?: string, killerName?: string,
  ) => {
    if (!sim.alive) return
    sim.alive = false
    sim.seg = []
    const db = getFirebaseDb()
    update(ref(db, `rooms/${code}/players/${bot.id}`), { alive: false }).catch(() => {})
    remove(mySnakeRef(code, bot.id)).catch(() => {})
    const entry: KillEntry = {
      killerId: killerId ?? null,
      killerName: killerName ?? "",
      victimId: bot.id,
      victimName: playerDisplayName(bot),
      cause,
      ts: Date.now(),
    }
    push(killFeedRef(code), entry).catch(() => {})
    if (killerId) {
      update(ref(db, `rooms/${code}/players/${killerId}`), { score: increment(BATTLE_KILL_SCORE) }).catch(() => {})
    }
    void room
  }

  /** Mirrors the battle component's eat(): grow, score, replacement food on a free cell. */
  const eatClassic = (code: string, bot: MpPlayer, sim: BotSim, wallSet: Set<string>, portals: [Seg, Seg][]) => {
    sim.growth += 1
    const db = getFirebaseDb()
    update(ref(db, `rooms/${code}/players/${bot.id}`), { score: increment(1) }).catch(() => {})
    const taken = new Set<string>()
    for (const s of Object.values(liveSnakes())) for (const c of s.seg) taken.add(`${c.x},${c.y}`)
    for (const k of wallSet) taken.add(k)
    for (const [a, b] of portals) {
      taken.add(`${a.x},${a.y}`)
      taken.add(`${b.x},${b.y}`)
    }
    const free: Seg[] = []
    for (let x = 0; x < 20; x++) for (let y = 0; y < 20; y++) if (!taken.has(`${x},${y}`)) free.push({ x, y })
    if (free.length > 0) {
      const f = free[Math.floor(Math.random() * free.length)]
      set(foodRef(code), f).catch(() => {})
      foodClassicRef.current = f
    }
  }

  /** One classic tick for one bot — mirrors multiplayer-battle.tsx doTick() exactly. */
  const stepClassic = (
    code: string, room: MpRoom, bot: MpPlayer, sim: BotSim,
    settings: MpSettings, wallSet: Set<string>, portals: [Seg, Seg][], now: number,
  ) => {
    const dir = sim.dir
    const head = sim.seg[0]
    if (!head) return
    let nx = head.x + dir.x
    let ny = head.y + dir.y
    // arena edge: teleport wraps, otherwise the wall kills (no teleport in royale — this is classic)
    if (nx < 0 || nx >= 20 || ny < 0 || ny >= 20) {
      if (!settings.teleport) {
        killBotClassic(code, room, bot, sim, "wall")
        return
      }
      nx = (nx + 20) % 20
      ny = (ny + 20) % 20
    }
    let newHead = { x: nx, y: ny }
    if (wallSet.has(`${newHead.x},${newHead.y}`)) {
      killBotClassic(code, room, bot, sim, "wall")
      return
    }
    for (const [a, b] of portals) {
      if (a.x === newHead.x && a.y === newHead.y) { newHead = { x: b.x, y: b.y }; break }
      if (b.x === newHead.x && b.y === newHead.y) { newHead = { x: a.x, y: a.y }; break }
    }
    // self — the tail cell vacates this tick unless pending growth keeps it
    const myBody = sim.growth > 0 ? sim.seg : sim.seg.slice(0, -1)
    if (myBody.some((s, i) => i > 0 && s.x === newHead.x && s.y === newHead.y)) {
      killBotClassic(code, room, bot, sim, "self")
      return
    }
    const f = foodClassicRef.current
    const ateFood = !!f && f.x === newHead.x && f.y === newHead.y
    // other snakes (fresh snapshots / live sims only)
    for (const [pid, s] of Object.entries(freshSnakes(now))) {
      if (settings.avoidCollision) break
      if (pid === bot.id) continue
      if (s.seg.some((c) => c.x === newHead.x && c.y === newHead.y)) {
        killBotClassic(code, room, bot, sim, "kill", pid, playerDisplayName(room.players?.[pid]))
        return
      }
    }
    if (ateFood) eatClassic(code, bot, sim, wallSet, portals)
    sim.seg.unshift(newHead)
    if (sim.growth > 0) sim.growth -= 1
    else sim.seg.pop()
    set(mySnakeRef(code, bot.id), { seg: sim.seg, dx: dir.x, dy: dir.y, ts: Date.now() }).catch(() => {})
  }

  const tickClassic = (code: string, room: MpRoom) => {
    const settings = getRoomSettings(room)
    const bots = liveBots(room)
    if (bots.length === 0) return
    ensureClassicSpawned(code, room)
    const wallSet = blockedCellKeys(getBattleMap(settings.map))
    const portals = getBattleMap(settings.map).portals as [Seg, Seg][]
    const now = Date.now()
    for (const bot of bots) {
      const sim = sims.current.get(bot.id)
      if (!sim || !sim.alive || sim.seg.length === 0) continue
      const diff = botDifficultyOf(bot)
      sim.ticks++
      if (sim.ticks % BOT_DIFFICULTY_CONFIG[diff].reactionTicks === 0) {
        // live sims (bots) carry fresher bodies+dirs than their Firebase snapshots
        const ai: AiSnake[] = Object.entries(freshSnakes(now)).map(([id, s]) => {
          const osim = sims.current.get(id)
          const snap = snakesRef2.current[id]
          return { id, seg: s.seg, dir: osim ? { ...osim.dir } : { x: snap?.dx ?? 1, y: snap?.dy ?? 0 } }
        })
        const world: BotWorld = {
          grid: 20,
          foods: foodClassicRef.current ? [foodClassicRef.current] : [],
          snakes: ai,
          blocked: wallSet,
          zone: null,
          teleport: settings.teleport,
          passThrough: settings.avoidCollision,
        }
        const nd = decideBotDirection(
          { id: bot.id, head: sim.seg[0], dir: sim.dir, length: sim.seg.length, growing: sim.growth > 0 },
          world, diff,
        )
        if (!(nd.x === -sim.dir.x && nd.y === -sim.dir.y)) sim.dir = nd
      }
      stepClassic(code, room, bot, sim, settings, wallSet, portals, now)
    }
  }

  // --- Battle Royale ---------------------------------------------------------

  const ensureRoyaleSpawned = (code: string, room: MpRoom, bots: MpPlayer[]) => {
    const order = room.game?.order ?? playerOrder(room)
    const seed = room.game?.zone?.seed ?? 0
    const spawns = computeSpawns(order.length, seed % 360)
    for (const bot of bots) {
      if (sims.current.has(bot.id)) continue
      const snap = snakesRef2.current[bot.id]
      if (snap?.seg?.length) {
        sims.current.set(bot.id, adoptSim(snap))
        continue
      }
      const seat = Math.max(0, order.indexOf(bot.id))
      const s = spawns[seat % spawns.length]
      const sim = newSim()
      for (let i = 0; i < BR_START_LENGTH; i++) sim.seg.push({ x: s.x - s.dx * i, y: s.y - s.dy * i })
      sim.dir = { x: s.dx, y: s.dy }
      sims.current.set(bot.id, sim)
      set(mySnakeRef(code, bot.id), { seg: sim.seg, dx: s.dx, dy: s.dy, ts: Date.now() + offsetRef.current }).catch(() => {})
    }
  }

  /** Mirrors royale-battle.tsx die(): dead + diedAt, corpse becomes food, killfeed, killer score/kills. */
  const killBotRoyale = (
    code: string, room: MpRoom, bot: MpPlayer, sim: BotSim,
    cause: KillEntry["cause"], killerId: string | undefined, killerName: string | undefined,
    zs: ZoneState | null, serverNow: number,
  ) => {
    if (!sim.alive) return
    sim.alive = false
    const body = [...sim.seg]
    sim.seg = []
    const db = getFirebaseDb()
    update(ref(db, `rooms/${code}/players/${bot.id}`), { alive: false, diedAt: serverNow }).catch(() => {})
    remove(mySnakeRef(code, bot.id)).catch(() => {})
    if (zs) dropFoodFromBody(code, body, zs.box).catch(() => {})
    const entry: KillEntry = {
      killerId: killerId ?? null,
      killerName: killerName ?? "",
      victimId: bot.id,
      victimName: playerDisplayName(bot),
      cause,
      ts: serverNow,
    }
    push(killFeedRef(code), entry).catch(() => {})
    if (killerId) {
      update(ref(db, `rooms/${code}/players/${killerId}`), {
        score: increment(BATTLE_KILL_SCORE),
        kills: increment(1),
      }).catch(() => {})
    }
    void room
  }

  /** One royale tick for one bot — mirrors royale-battle.tsx doTick() exactly. */
  const stepRoyale = (
    code: string, room: MpRoom, bot: MpPlayer, sim: BotSim,
    zs: ZoneState, serverNow: number, now: number,
  ) => {
    const dir = sim.dir
    const head = sim.seg[0]
    if (!head) return
    const nx = head.x + dir.x
    const ny = head.y + dir.y
    // 1) world wall (the big map edge always kills — no teleport in Battle Royale)
    if (nx < 0 || nx >= BR_GRID || ny < 0 || ny >= BR_GRID) {
      killBotRoyale(code, room, bot, sim, "wall", undefined, undefined, zs, serverNow)
      return
    }
    // 2) myself — the tail cell vacates this tick unless pending growth keeps it
    const myBody = sim.growth > 0 ? sim.seg : sim.seg.slice(0, -1)
    if (myBody.some((s, i) => i > 0 && s.x === nx && s.y === ny)) {
      killBotRoyale(code, room, bot, sim, "self", undefined, undefined, zs, serverNow)
      return
    }
    // 3) other snakes' bodies / heads (fresh only)
    for (const [pid, s] of Object.entries(freshSnakes(now))) {
      if (pid === bot.id) continue
      if (s.seg.some((c) => c.x === nx && c.y === ny)) {
        killBotRoyale(code, room, bot, sim, "kill", pid, playerDisplayName(room.players?.[pid]), zs, serverNow)
        return
      }
    }
    // 4) safe zone: 3 s grace outside, tail burns meanwhile
    const z = sim.zone.update(isInsideZone(zs.box, nx, ny), serverNow)
    if (z.dead) {
      killBotRoyale(code, room, bot, sim, "zone", undefined, undefined, zs, serverNow)
      return
    }
    // 5) food: claimed with a transaction, so two snakes can never eat the same one
    const fid = foodCellRef.current.get(`${nx},${ny}`)
    if (fid && !claimingRef.current.has(fid)) {
      claimingRef.current.add(fid)
      claimFood(code, fid).then((ok) => {
        claimingRef.current.delete(fid)
        const s2 = sims.current.get(bot.id)
        if (!ok || !s2 || !s2.alive) return
        s2.growth += 1
        update(ref(getFirebaseDb(), `rooms/${code}/players/${bot.id}`), { score: increment(1) }).catch(() => {})
      })
    }
    sim.seg.unshift({ x: nx, y: ny })
    if (sim.growth > 0) sim.growth -= 1
    else sim.seg.pop()
    if (z.outside && ZONE_TAIL_DAMAGE && sim.seg.length > BR_MIN_LENGTH) sim.seg.pop()
    set(mySnakeRef(code, bot.id), { seg: sim.seg, dx: dir.x, dy: dir.y, ts: serverNow }).catch(() => {})
  }

  const tickRoyale = (code: string, room: MpRoom) => {
    const zoneRec = room.game?.zone
    if (!zoneRec) return
    const bots = liveBots(room)
    if (bots.length === 0) return
    if (zoneSeedRef.current !== zoneRec.seed) {
      zoneSeedRef.current = zoneRec.seed
      zoneBoxesRef.current = buildZoneBoxes(zoneRec.seed)
    }
    const boxes = zoneBoxesRef.current
    if (!boxes) return
    ensureRoyaleSpawned(code, room, bots)
    const serverNow = Date.now() + offsetRef.current
    const zs = getZoneState(boxes, serverNow - zoneRec.startAt)
    const now = Date.now()
    const foods: Seg[] = Object.values(brFoodsRef.current).map((c) => ({ x: c.x, y: c.y }))
    for (const bot of bots) {
      const sim = sims.current.get(bot.id)
      if (!sim || !sim.alive || sim.seg.length === 0) continue
      const diff = botDifficultyOf(bot)
      sim.ticks++
      if (sim.ticks % BOT_DIFFICULTY_CONFIG[diff].reactionTicks === 0) {
        // live sims (bots) carry fresher bodies+dirs than their Firebase snapshots
        const ai: AiSnake[] = Object.entries(freshSnakes(now)).map(([id, s]) => {
          const osim = sims.current.get(id)
          const snap = snakesRef2.current[id]
          return { id, seg: s.seg, dir: osim ? { ...osim.dir } : { x: snap?.dx ?? 1, y: snap?.dy ?? 0 } }
        })
        const world: BotWorld = {
          grid: BR_GRID,
          foods,
          snakes: ai,
          blocked: EMPTY_BLOCKED,
          zone: { box: zs.box, target: zs.target, warning: zs.warning },
          teleport: false,
          passThrough: false,
        }
        const nd = decideBotDirection(
          { id: bot.id, head: sim.seg[0], dir: sim.dir, length: sim.seg.length, growing: sim.growth > 0 },
          world, diff,
        )
        if (!(nd.x === -sim.dir.x && nd.y === -sim.dir.y)) sim.dir = nd
      }
      stepRoyale(code, room, bot, sim, zs, serverNow, now)
    }
  }

  // --- subscriptions --------------------------------------------------------

  useEffect(() => {
    const c = codeRef.current
    if (!c) return
    fetchServerOffset().then((o) => { offsetRef.current = o }).catch(() => {})
    const unsubRoom = subscribeToRoom(c, (r) => { roomRef.current = r })
    const unsubSnakes = onValue(snakesRef(c), (s) => {
      snakesRef2.current = (s.val() ?? {}) as Record<string, MpSnakeState>
    })
    const unsubFood = onValue(foodRef(c), (s) => {
      foodClassicRef.current = (s.val() ?? null) as Seg | null
    })
    const unsubBrFoods = onValue(foodsRef(c), (s) => {
      const foods = (s.val() ?? {}) as BrFoods
      brFoodsRef.current = foods
      const m = new Map<string, string>()
      for (const [fid, cell] of Object.entries(foods)) m.set(`${cell.x},${cell.y}`, fid)
      foodCellRef.current = m
    })
    // killer grows +2 segments (mirrors the battle components' local killfeed watcher)
    const unsubKills = onValue(killFeedRef(c), (s) => {
      const val = (s.val() ?? {}) as Record<string, KillEntry>
      for (const [key, e] of Object.entries(val)) {
        seenKillKeysRef.current.add(key)
        if (!e.killerId) continue
        const sim = sims.current.get(e.killerId)
        if (sim && sim.alive && !sim.appliedKills.has(key) && e.ts >= sim.bornAt - 5000) {
          sim.appliedKills.add(key)
          sim.growth += 2
        }
      }
    })
    return () => {
      unsubRoom()
      unsubSnakes()
      unsubFood()
      unsubBrFoods()
      unsubKills()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code])

  // --- main loop: ONLY the host simulates ------------------------------------

  useEffect(() => {
    const c = codeRef.current
    if (!c) return
    let lastClassic = 0
    let lastRoyale = 0
    const id = setInterval(() => {
      const room = roomRef.current
      const cc = codeRef.current
      if (!room || !cc || room.hostId !== playerIdRef.current) return
      const status = room.status
      // a new match (or back to lobby) forgets old sims — every bot respawns fresh
      const mk = `${status}:${room.game?.countdownEndsAt ?? 0}`
      if (matchKeyRef.current !== mk) {
        matchKeyRef.current = mk
        sims.current.clear()
      }
      if (status !== "countdown" && status !== "playing") return
      const mode = getRoomSettings(room).mode
      const now = Date.now()
      if (mode === "royale") {
        if (status === "playing") {
          if (now - lastRoyale >= BR_TICK_MS) {
            lastRoyale = now
            tickRoyale(cc, room)
          }
        } else {
          ensureRoyaleSpawned(cc, room, liveBots(room))
        }
      } else {
        if (status === "playing") {
          if (now - lastClassic >= BATTLE_TICK_MS) {
            lastClassic = now
            tickClassic(cc, room)
          }
        } else {
          ensureClassicSpawned(cc, room)
        }
      }
    }, 100)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code])
}
