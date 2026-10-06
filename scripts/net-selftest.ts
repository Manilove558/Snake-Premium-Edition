// scripts/net-selftest.ts — tests the authoritative engine, the room lifecycle and the delta sync WITHOUT sockets.
// Run:  npx tsx scripts/net-selftest.ts      (prints "NET: ALL TESTS PASSED")
import assert from "node:assert"
import { GameEngine } from "../server/engine"
import { RoomManager, type Transport } from "../server/rooms"
import { applyGameSync, createGameView, type GameView } from "../shared/sync-reducer"
import { MemoryRankedStore } from "../server/ranked-store"
import type { GameOverPayload, RankedResultPayload } from "../shared/snake-protocol"
import { DEFAULT_ROOM_SETTINGS, NET, type Dir, type GameStateSync, type PlayerDiedEvent, type S2CEvent } from "../shared/snake-protocol"

const T = NET.TICK_MS
const DIRS: Dir[] = ["UP", "DOWN", "LEFT", "RIGHT"]

// ---- helpers ---------------------------------------------------------------
let seed = 99
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296)

function mkEngine(n: number, o: Partial<ConstructorParameters<typeof GameEngine>[0]> = {}) {
  return new GameEngine({
    mode: "classic",
    settings: { ...DEFAULT_ROOM_SETTINGS, map: "classic", teleport: false, avoidCollision: false },
    players: Array.from({ length: n }, (_, i) => ({ id: "p" + i, name: "P" + i })),
    startAt: 1000,
    seed: 7,
    ...o,
  })
}
/** run `ticks` ticks starting after `from`; returns collected deaths and the final time */
function run(e: GameEngine, from: number, ticks: number, each?: (now: number) => void) {
  const died: PlayerDiedEvent[] = []
  let now = from
  let over = null as ReturnType<GameEngine["tick"]>["over"]
  for (let i = 0; i < ticks && !e.isOver; i++) {
    now += T
    each?.(now)
    const out = e.tick(now)
    died.push(...out.died)
    if (out.over) over = out.over
  }
  return { died, now, over }
}
const snake = (e: GameEngine, id: string) => e.inspect().snakes.get(id)!
const head = (e: GameEngine, id: string) => snake(e, id).seg[0]

// ============================================================================
// 1. Engine basics
// ============================================================================
{
  const e = mkEngine(2)
  // before startAt nothing happens
  assert.strictEqual(e.tick(500).sync, null)
  const h0 = { ...head(e, "p0") }
  const dir0 = snake(e, "p0").dir
  // a normal snake moves exactly once per STEP_TICKS ticks (150 ms)
  run(e, 1000 - T, 1)
  assert.deepStrictEqual(head(e, "p0"), h0, "no move on tick 1")
  run(e, 1000, 2)
  assert.notDeepStrictEqual(head(e, "p0"), h0, "moved on tick 3")
  const moved = Math.abs(head(e, "p0").x - h0.x) + Math.abs(head(e, "p0").y - h0.y)
  assert.strictEqual(moved, 1, "exactly one cell")
  assert.strictEqual(snake(e, "p0").dir, dir0)

  // reversal is rejected, stale seq is rejected, turns are queued (max 2)
  const rev = dir0 === "RIGHT" ? "LEFT" : dir0 === "LEFT" ? "RIGHT" : dir0 === "UP" ? "DOWN" : "UP"
  assert.strictEqual(e.setDirection("p0", rev, 1), false, "180° turn rejected")
  const side: Dir = dir0 === "UP" || dir0 === "DOWN" ? "LEFT" : "UP"
  assert.strictEqual(e.setDirection("p0", side, 2), true)
  assert.strictEqual(e.setDirection("p0", side, 2), false, "same seq twice")
  assert.strictEqual(e.setDirection("p0", side, 1), false, "older seq")
  assert.strictEqual(e.setDirection("nobody", side, 9), false)
}

// walls: a snake that runs off the grid dies with cause "wall", and its body becomes food
{
  const e = mkEngine(3)
  const a = snake(e, "p0") as { seg: { x: number; y: number }[]; dir: Dir }
  const b = snake(e, "p1") as { seg: { x: number; y: number }[]; dir: Dir }
  const c = snake(e, "p2") as { seg: { x: number; y: number }[]; dir: Dir }
  a.seg = [{ x: 1, y: 10 }, { x: 2, y: 10 }, { x: 3, y: 10 }]
  a.dir = "LEFT"
  b.seg = [{ x: 10, y: 15 }, { x: 10, y: 16 }, { x: 10, y: 17 }]
  b.dir = "UP"
  c.seg = [{ x: 15, y: 5 }, { x: 15, y: 4 }, { x: 15, y: 3 }]
  c.dir = "DOWN"
  const foodBefore = e.inspect().foods.size
  const { died } = run(e, 1000, 9)
  const wall = died.find((d) => d.cause === "wall")
  assert(wall && wall.id === "p0" && wall.placement === 3 && wall.killerId === null, "p0 hit the wall, placed 3rd of 3")
  assert(e.inspect().foods.size > foodBefore, "corpse turned into food")
}

// teleport: wrap instead of dying
{
  const e = mkEngine(2, { settings: { ...DEFAULT_ROOM_SETTINGS, map: "classic", teleport: true, avoidCollision: false } })
  const { died } = run(e, 1000, 120)
  assert(!died.some((d) => d.cause === "wall"), "no wall deaths with teleport")
}

// head-on: two snakes driven into the same cell both die and share placement 1
{
  const e = mkEngine(2)
  // p? spawns: with seed 7 find the two and force them to face each other on one row
  const s0 = snake(e, "p0") as { seg: { x: number; y: number }[]; dir: Dir }
  const s1 = snake(e, "p1") as { seg: { x: number; y: number }[]; dir: Dir }
  s0.seg = [{ x: 8, y: 5 }, { x: 7, y: 5 }, { x: 6, y: 5 }]
  s0.dir = "RIGHT"
  s1.seg = [{ x: 10, y: 5 }, { x: 11, y: 5 }, { x: 12, y: 5 }]
  s1.dir = "LEFT"
  const { died, over } = run(e, 1000, 3)
  assert.strictEqual(died.length, 2)
  assert(died.every((d) => d.cause === "head_on" && d.placement === 1), "both die, shared 1st place")
  assert(over && over.winnerId === null && over.reason === "last_alive", "draw")
}

// kill credit: p0 runs into p1's body. p1 heads UP; after its 2nd move its body covers (5,6) — exactly where p0 arrives
const crossing = (e: GameEngine, shield = false) => {
  const s0 = snake(e, "p0") as { seg: { x: number; y: number }[]; dir: Dir; shieldUntil: number }
  const s1 = snake(e, "p1") as { seg: { x: number; y: number }[]; dir: Dir }
  s1.seg = [{ x: 5, y: 5 }, { x: 5, y: 6 }, { x: 5, y: 7 }, { x: 5, y: 8 }, { x: 5, y: 9 }]
  s1.dir = "UP"
  s0.seg = [{ x: 3, y: 6 }, { x: 2, y: 6 }, { x: 1, y: 6 }]
  s0.dir = "RIGHT"
  if (shield) s0.shieldUntil = 1e12
}
{
  const e = mkEngine(2)
  crossing(e)
  const { died } = run(e, 1000, 6)
  const d = died.find((x) => x.id === "p0")
  assert(d && d.cause === "kill" && d.killerId === "p1", "p0 killed by p1's body")
  assert.strictEqual(snake(e, "p1").kills, 1)
  assert.strictEqual(snake(e, "p1").score, NET.KILL_SCORE)
  assert.strictEqual(d!.placement, 2)
}

// shield makes a snake immune to snake collisions; speed moves every 2 ticks
{
  const e = mkEngine(2)
  crossing(e, true)
  const { died } = run(e, 1000, 6)
  assert(!died.some((d) => d.id === "p0"), "shielded snake survives the collision")

  const f = mkEngine(2)
  const fs = snake(f, "p0") as { speedUntil: number; seg: { x: number; y: number }[]; dir: Dir; cooldown: number }
  fs.speedUntil = 1e12
  fs.seg = [{ x: 4, y: 10 }, { x: 3, y: 10 }, { x: 2, y: 10 }]
  fs.dir = "RIGHT"
  fs.cooldown = 2
  const x0 = fs.seg[0].x
  run(f, 1000, 4)
  assert.strictEqual(head(f, "p0").x - x0, 2, "2 cells in 4 ticks while sped up")
}

// food: eating grows the snake and scores
{
  const e = mkEngine(2)
  const s0 = snake(e, "p0") as { seg: { x: number; y: number }[]; dir: Dir }
  s0.seg = [{ x: 4, y: 10 }, { x: 3, y: 10 }, { x: 2, y: 10 }]
  s0.dir = "RIGHT"
  const foods = e.inspect().foods as Map<number, { id: number; x: number; y: number; kind: string }>
  const f = [...foods.values()][0]
  foods.delete(f.id)
  foods.set(f.id, { ...f, x: 5, y: 10, kind: "normal" })
  ;(e as unknown as { foodAt: Map<number, number> }).foodAt.set(10 * 20 + 5, f.id)
  run(e, 1000, 3)
  assert.strictEqual(snake(e, "p0").seg.length, 4, "grew by one")
  assert.strictEqual(snake(e, "p0").score, NET.FOOD_SCORE)
}

// disconnect: snake removed next tick (cause "disconnect"), body -> food, placement is last
{
  const e = mkEngine(3)
  run(e, 1000, 3)
  const foods = e.inspect().foods.size
  e.removePlayer("p1")
  const { died } = run(e, 1000 + 3 * T, 1)
  assert(died.length === 1 && died[0].id === "p1" && died[0].cause === "disconnect" && died[0].placement === 3)
  assert(e.inspect().foods.size > foods, "body became food")
}

// royale: standing outside the zone kills after the grace period
{
  const e = mkEngine(4, { mode: "royale", seed: 5 })
  assert(e.config.zone && e.config.cols === 120)
  assert.strictEqual(e.inspect().foods.size, 70, "full initial food")
  const r = run(e, 1000, 40 * 90) // 90 s of play, nobody steers: they run into walls/zone
  assert(r.died.length >= 3, "zone / walls eliminate players")
  assert(e.isOver, "match ends")
}

// ============================================================================
// 2. Fuzz: delta sync == snapshot at every tick, plus invariants
// ============================================================================
for (let round = 0; round < 40; round++) {
  const n = 2 + Math.floor(rnd() * 7)
  const mode = rnd() < 0.3 && n >= 4 ? "royale" : "classic"
  const e = mkEngine(n, {
    mode,
    seed: 1000 + round,
    settings: { map: ["classic", "walls", "boxes", "cross", "frame", "lanes"][round % 6], teleport: rnd() < 0.3, avoidCollision: rnd() < 0.2 },
  })
  const view: GameView = createGameView()
  applyGameSync(view, e.snapshot())
  let seq = 0
  let now = 1000
  let diedCount = 0
  for (let i = 0; i < 1500 && !e.isOver; i++) {
    now += T
    if (rnd() < 0.5) e.setDirection("p" + Math.floor(rnd() * n), DIRS[Math.floor(rnd() * 4)], ++seq)
    if (rnd() < 0.002) e.removePlayer("p" + Math.floor(rnd() * n))
    const out = e.tick(now)
    diedCount += out.died.length
    if (out.sync) applyGameSync(view, out.sync)

    // the client's view must equal the server's truth
    if (out.sync) {
      const truth = e.snapshot()
      const full = createGameView()
      applyGameSync(full, truth)
      assert.deepStrictEqual([...view.snakes.entries()].sort(), [...full.snakes.entries()].sort(), `snakes drift (round ${round}, tick ${i})`)
      assert.deepStrictEqual([...view.foods.entries()].sort(), [...full.foods.entries()].sort(), `foods drift (round ${round}, tick ${i})`)
      assert.strictEqual(view.aliveCount, e.aliveCount())
    }
    // invariants
    const occ = new Set<string>()
    for (const s of e.inspect().snakes.values()) {
      if (!s.alive) continue
      assert(s.seg.length >= 1)
      for (let k = 1; k < s.seg.length; k++) {
        const d = Math.abs(s.seg[k].x - s.seg[k - 1].x) + Math.abs(s.seg[k].y - s.seg[k - 1].y)
        assert(d === 1 || (e.config.teleport || e.config.portals.length) , "segments are connected")
      }
      for (const c of s.seg) assert(c.x >= 0 && c.y >= 0 && c.x < e.config.cols && c.y < e.config.rows, "inside the grid")
      const hk = `${s.seg[0].x},${s.seg[0].y}`
      if (!e.config.avoidCollision && s.shieldUntil <= now) assert(!occ.has(hk), "two unshielded heads never share a cell")
      occ.add(hk)
    }
  }
  const res = e.getResult()
  if (res) {
    const rows = res.standings
    assert.strictEqual(rows.length, n)
    assert(rows.every((r) => r.placement >= 1 && r.placement <= n))
    assert.strictEqual(rows.filter((r) => r.placement === 1).length >= 1, true, "someone is first")
    assert(rows.every((r, i) => i === 0 || rows[i - 1].placement <= r.placement), "sorted")
  }
}

// ============================================================================
// 3. Room manager (fake transport)
// ============================================================================
interface Sent { to: string; event: S2CEvent; payload: unknown }
function makeWorld(store?: MemoryRankedStore) {
  const sent: Sent[] = []
  const channels = new Map<string, Set<string>>() // code -> socket ids
  const transport: Transport = {
    toRoom: (code, event, payload) => void channels.get(code)?.forEach((s) => sent.push({ to: s, event, payload })),
    toSocket: (id, event, payload) => void sent.push({ to: id, event, payload }),
    joinChannel: (id, code) => void (channels.get(code) ?? channels.set(code, new Set()).get(code)!).add(id),
    leaveChannel: (id, code) => void channels.get(code)?.delete(id),
  }
  return { sent, mgr: new RoomManager(transport, { rankedStore: store ?? null, log: () => {}, rng: rnd }), channels }
}
const lastRoom = (w: ReturnType<typeof makeWorld>, sock: string) =>
  [...w.sent].reverse().find((s) => s.to === sock && s.event === "ROOM_UPDATE")!.payload as import("../shared/snake-protocol").RoomSnapshot

{
  const w = makeWorld()
  let now = 10_000
  const a = w.mgr.createRoom("sA", { name: "  Alice<script> ", color: "#ff5d7a", settings: { bots: false } }, now, "uid-alice")
  assert(a.ok)
  if (!a.ok) throw 0
  assert.strictEqual(a.room.players[0].name, "Alicescript") // < > stripped
  assert.strictEqual(a.code.length, 6)
  assert.strictEqual(a.room.players[0].isHost, true)

  // join: colour conflict is resolved, bad code / full room / bad payload are rejected
  const b = w.mgr.joinRoom("sB", { code: a.code.toLowerCase() + " ", name: "Bob", color: "#ff5d7a" }, now, "uid-bob")
  assert(b.ok)
  if (!b.ok) throw 0
  assert.notStrictEqual(b.room.players[1].color, "#ff5d7a")
  assert.strictEqual(w.mgr.joinRoom("sX", { code: "ZZZZZZ", name: "x" }, now).ok, false)
  const bad = w.mgr.joinRoom("sX", "garbage", now)
  assert(!bad.ok && bad.code === "BAD_REQUEST")

  // start rules
  const early = w.mgr.startGame("sB", now)
  assert(!early.ok && early.code === "NOT_HOST")
  const notReady = w.mgr.startGame("sA", now)
  assert(!notReady.ok && notReady.code === "NOT_READY")
  assert(w.mgr.setReady("sB", { ready: true }, now).ok)
  assert.strictEqual(lastRoom(w, "sA").players.find((p) => p.name === "Bob")!.ready, true)

  // royale needs 4
  assert(w.mgr.updateSettings("sA", { mode: "royale" }, now).ok)
  assert.strictEqual(lastRoom(w, "sA").players.find((p) => p.name === "Bob")!.ready, false, "settings change clears ready")
  w.mgr.setReady("sB", { ready: true }, now)
  const few = w.mgr.startGame("sA", now)
  assert(!few.ok && few.code === "NOT_ENOUGH_PLAYERS")
  // teleport + avoidCollision keep un-steered snakes alive, so the disconnect timing below is what ends the match
  assert(w.mgr.updateSettings("sA", { mode: "classic", map: "nonexistent", teleport: true, avoidCollision: true }, now).ok)
  assert.strictEqual(lastRoom(w, "sA").settings.map, "classic", "unknown map ignored")
  w.mgr.setReady("sB", { ready: true }, now)

  // start -> countdown -> playing
  assert(w.mgr.startGame("sA", now).ok)
  assert(w.sent.some((s) => s.event === "GAME_STARTING"))
  assert.strictEqual(w.mgr.getRoom(a.code)!.status, "countdown")
  now += NET.COUNTDOWN_MS
  w.mgr.tick(now)
  assert.strictEqual(w.mgr.getRoom(a.code)!.status, "playing")

  // input goes to the engine; spam / garbage is harmless
  w.mgr.moveInput("sA", { dir: "UP", seq: 1 })
  w.mgr.moveInput("sA", { dir: "SIDEWAYS", seq: 2 })
  w.mgr.moveInput("sA", null)
  w.mgr.moveInput("ghost", { dir: "UP", seq: 1 })

  // B drops: grace period keeps the slot, then the slot is removed and host stays A
  w.mgr.onDisconnect("sB", now)
  assert.strictEqual(lastRoom(w, "sA").players.find((p) => p.name === "Bob")!.connected, false)
  now += 5_000
  w.mgr.tick(now)
  // B comes back with the right token
  const wrong = w.mgr.reconnect("sB2", { code: a.code, playerId: b.playerId, token: "nope" }, now)
  assert(!wrong.ok && wrong.code === "BAD_SESSION")
  const back = w.mgr.reconnect("sB2", { code: a.code, playerId: b.playerId, token: b.token }, now)
  assert(back.ok)
  assert(w.sent.some((s) => s.to === "sB2" && s.event === "GAME_STARTING"), "mid-match resync sent")
  assert.strictEqual(lastRoom(w, "sA").players.find((p) => p.name === "Bob")!.connected, true)

  // duplicate tab: old socket is told
  w.mgr.reconnect("sB3", { code: a.code, playerId: b.playerId, token: b.token }, now)
  assert(w.sent.some((s) => s.to === "sB2" && s.event === "NET_NOTICE"))

  // B drops for good -> snake removed after the grace period, match ends, A wins
  w.mgr.onDisconnect("sB3", now)
  for (let i = 0; i < NET.RECONNECT_GRACE_MS / T + 5; i++) {
    now += T
    w.mgr.tick(now)
  }
  assert.strictEqual(w.mgr.getRoom(a.code)!.status, "ended")
  const over = w.sent.filter((s) => s.event === "GAME_OVER").pop()!.payload as import("../shared/snake-protocol").GameOverPayload
  const rowB = over.standings.find((r) => r.name === "Bob")!
  assert(rowB.disconnected && rowB.placement === 2, "leaver is last")
  assert.strictEqual(rowB.uid, "uid-bob", "leaver keeps his verified uid in the standings (needed to settle ranked)")
  assert.strictEqual(over.standings.find((r) => r.name === "Alicescript")!.uid, "uid-alice")
  assert.strictEqual(over.winnerId, a.playerId)

  // rematch
  assert(w.mgr.resetRoom("sA", now).ok)
  assert.strictEqual(w.mgr.getRoom(a.code)!.status, "lobby")
  // everybody leaves -> room disappears
  assert(w.mgr.leave("sA", now).ok)
  assert.strictEqual(w.mgr.getRoom(a.code), undefined)
}

// host migration + full room + quick match + public auto-start
{
  const w = makeWorld()
  let now = 50_000
  const h = w.mgr.createRoom("h", { name: "Host", settings: { bots: false } }, now)
  if (!h.ok) throw 0
  for (let i = 0; i < 7; i++) assert(w.mgr.joinRoom("j" + i, { code: h.code, name: "J" + i }, now + i).ok)
  const full = w.mgr.joinRoom("late", { code: h.code, name: "Late" }, now)
  assert(!full.ok && full.code === "ROOM_FULL")
  assert.strictEqual(new Set(lastRoom(w, "h").players.map((p) => p.color)).size, 8, "8 distinct colours")
  w.mgr.leave("h", now)
  assert.strictEqual(lastRoom(w, "j0").players.find((p) => p.isHost)!.name, "J0", "oldest player becomes host")

  // quick match fills the fullest public lobby of the mode
  const w2 = makeWorld()
  const q1 = w2.mgr.quickMatch("q1", { name: "Q1", mode: "classic", bots: false }, now)
  const q2 = w2.mgr.quickMatch("q2", { name: "Q2", mode: "classic" }, now)
  const r1 = w2.mgr.quickMatch("q3", { name: "R1", mode: "royale" }, now)
  if (!q1.ok || !q2.ok || !r1.ok) throw 0
  assert.strictEqual(q1.code, q2.code, "same classic lobby")
  assert.notStrictEqual(q1.code, r1.code, "royale gets its own lobby")
  // 2 players = classic minimum reached -> auto-start is scheduled, then fires
  const sched = lastRoom(w2, "q1").autoStartAt
  assert(sched !== null && sched - now === NET.PUBLIC_AUTOSTART_MS)
  now += NET.PUBLIC_AUTOSTART_MS
  w2.mgr.tick(now)
  assert.strictEqual(w2.mgr.getRoom(q1.code)!.status, "countdown")
  assert.strictEqual(w2.mgr.getRoom(r1.code)!.status, "countdown", "a lone royale player starts too: bots fill the room")
  assert.strictEqual(w2.mgr.getRoom(r1.code)!.bots.length, 7, "royale is topped up to 8 seats")
}

// lobby disconnect: slot is freed after the grace period, empty room is deleted
{
  const w = makeWorld()
  let now = 1
  const c = w.mgr.createRoom("a", { name: "A", settings: { bots: false } }, now)
  if (!c.ok) throw 0
  w.mgr.onDisconnect("a", now)
  now += NET.RECONNECT_GRACE_MS
  w.mgr.tick(now)
  assert.strictEqual(w.mgr.getRoom(c.code), undefined)
  assert.deepStrictEqual(w.mgr.stats(), { rooms: 0, players: 0, playing: 0 })
}

// a whole 8-player classic match through the manager, random inputs, ends cleanly
{
  const w = makeWorld()
  let now = 1_000
  const host = w.mgr.createRoom("s0", { name: "H", settings: { bots: false } }, now)
  if (!host.ok) throw 0
  for (let i = 1; i < 8; i++) {
    w.mgr.joinRoom("s" + i, { code: host.code, name: "P" + i }, now)
    w.mgr.setReady("s" + i, { ready: true }, now)
  }
  assert(w.mgr.startGame("s0", now).ok)
  let syncs = 0
  let seq = 0
  for (let i = 0; i < 20 * 400 && w.mgr.getRoom(host.code)!.status !== "ended"; i++) {
    now += T
    if (rnd() < 0.4) w.mgr.moveInput("s" + Math.floor(rnd() * 8), { dir: DIRS[Math.floor(rnd() * 4)], seq: ++seq })
    w.mgr.tick(now)
  }
  syncs = w.sent.filter((s) => s.to === "s0" && s.event === "GAME_STATE_SYNC").length
  assert.strictEqual(w.mgr.getRoom(host.code)!.status, "ended")
  assert(syncs > 10)
  const deaths = w.sent.filter((s) => s.to === "s0" && s.event === "PLAYER_DIED").length
  assert(deaths >= 7, "at least 7 deaths before one winner remains")
}

// ============================================================================
// 4. v23: ranked settling, room-level ranked, bots
// ============================================================================
const flush = () => new Promise<void>((r) => setTimeout(r, 5))
const rankedPayload = (w: ReturnType<typeof makeWorld>, sock: string) =>
  [...w.sent].reverse().find((s) => s.to === sock && s.event === "RANKED_RESULT")?.payload as RankedResultPayload | undefined

async function rankedMatch(opts: { leaver?: boolean; unverified?: boolean } = {}) {
  const store = new MemoryRankedStore()
  const w = makeWorld(store)
  let now = 100_000
  const mk = (sock: string, name: string, uid: string | null) =>
    sock === "r1"
      ? w.mgr.createRoom(sock, { name, settings: { ranked: true, bots: true } }, now, uid)
      : w.mgr.joinRoom(sock, { code, name, expectRanked: true }, now, uid)
  let code = ""
  const h = mk("r1", "A", "uA")
  if (!h.ok) throw new Error("create failed " + h.message)
  code = h.code
  assert.strictEqual(h.room.settings.ranked, true)
  assert.strictEqual(h.room.settings.bots, false, "ranked rooms never have bots")
  assert.strictEqual(h.room.settings.mode, "classic")
  const j2 = mk("r2", "B", "uB")
  const j3 = mk("r3", "C", opts.unverified ? null : "uC")
  return { store, w, code, now, h, j2, j3 }
}

async function runRanked() {
  // --- creation / join gates -------------------------------------------------
  {
    const w = makeWorld() // server WITHOUT a ranked store
    const r = w.mgr.createRoom("x", { name: "X", settings: { ranked: true } }, 1, "u")
    assert(!r.ok && r.code === "RANKED_UNAVAILABLE")
    const c = w.mgr.createRoom("x", { name: "X", settings: { ranked: false } }, 1, null)
    assert(c.ok, "casual still works without a ranked store")
  }
  {
    const w = makeWorld(new MemoryRankedStore())
    const g = w.mgr.createRoom("g", { name: "G", settings: { ranked: true } }, 1, null)
    assert(!g.ok && g.code === "NOT_VERIFIED", "unverified cannot create a ranked room")
    const casual = w.mgr.createRoom("c", { name: "C" }, 1, "uC")
    const rk = w.mgr.createRoom("k", { name: "K", settings: { ranked: true } }, 1, "uK")
    if (!casual.ok || !rk.ok) throw 0
    // the flag is frozen after creation, and cannot be toggled by the host
    assert(w.mgr.updateSettings("c", { ranked: true }, 2).ok)
    assert.strictEqual(w.mgr.getRoom(casual.code)!.settings.ranked, false, "casual room cannot become ranked")
    assert(w.mgr.updateSettings("k", { ranked: false, bots: true, mode: "royale" }, 2).ok)
    const s = w.mgr.getRoom(rk.code)!.settings
    assert(s.ranked && !s.bots && s.mode === "classic", "ranked room cannot become casual / get bots / change mode")
    // joining
    const n = w.mgr.joinRoom("g2", { code: rk.code, name: "Guest" }, 3, null)
    assert(!n.ok && n.code === "NOT_VERIFIED", "guest cannot join ranked")
    const dup = w.mgr.joinRoom("k2", { code: rk.code, name: "K again" }, 3, "uK")
    assert(!dup.ok && dup.code === "RANKED_RULES", "one seat per account")
    const wrongTab = w.mgr.joinRoom("t", { code: casual.code, name: "T", expectRanked: true }, 3, "uT")
    assert(!wrongTab.ok && wrongTab.code === "NOT_RANKED", "Ranked tab refuses a casual room")
    // ranked quick match never lands in a casual room
    const q = w.mgr.quickMatch("q", { name: "Q", ranked: true }, 4, "uQ")
    assert(q.ok && q.code !== casual.code && q.room.settings.ranked)
    const qg = w.mgr.quickMatch("qg", { name: "QG", ranked: true }, 4, null)
    assert(!qg.ok && qg.code === "NOT_VERIFIED")
  }

  // --- min players message --------------------------------------------------
  {
    const { w, h, now } = await rankedMatch()
    // only A, B, C are in (3); drop C to leave 2
    w.mgr.leave("r3", now)
    const e = w.mgr.startGame("r1", now)
    assert(!e.ok && e.code === "NOT_ENOUGH_PLAYERS" && e.message === "Ranked needs 3+ players")
    assert(h.ok)
  }
  // --- unverified player in a ranked room: refused at join ------------------
  {
    const { j3 } = await rankedMatch({ unverified: true })
    assert(!j3.ok && j3.code === "NOT_VERIFIED")
  }

  // --- full match: B leaves (last), settled server-side, zero-sum ----------
  {
    const { store, w, code, h, j2, j3 } = await rankedMatch()
    let now = 200_000
    if (!h.ok || !j2.ok || !j3.ok) throw 0
    // ratings BEFORE the match: A strong, B average (no record), C weak
    store.data.set("uA", { elo: 1500, rp: 1500, mmr: 1300, gamesPlayed: 40, lastActiveAt: now, wins: 20, losses: 20, matches: 40 })
    store.data.set("uC", { elo: 800, rp: 800, mmr: 900, gamesPlayed: 10, lastActiveAt: now, wins: 2, losses: 8, matches: 10 })
    assert(w.mgr.setReady("r2", { ready: true }, now).ok && w.mgr.setReady("r3", { ready: true }, now).ok)
    assert(w.mgr.startGame("r1", now).ok)
    assert.strictEqual(w.mgr.getRoom(code)!.bots.length, 0, "no bots in ranked")
    await flush() // ratings snapshot is read at the countdown
    // someone tampers with the stored rating DURING the match: must not influence the result
    store.data.set("uA", { elo: 3000, rp: 3000, mmr: 3000, gamesPlayed: 99, lastActiveAt: now, wins: 99, losses: 0, matches: 99 })
    now += NET.COUNTDOWN_MS
    w.mgr.tick(now)
    // B and C leave for good -> A is last alive; leavers settle LAST
    w.mgr.onDisconnect("r2", now)
    w.mgr.onDisconnect("r3", now)
    for (let i = 0; i < NET.RECONNECT_GRACE_MS / T + 10 && w.mgr.getRoom(code)!.status !== "ended"; i++) {
      now += T
      w.mgr.tick(now)
    }
    assert.strictEqual(w.mgr.getRoom(code)!.status, "ended")
    await flush()
    const res = rankedPayload(w, "r1")
    assert(res && res.saved, "RANKED_RESULT delivered and saved: " + JSON.stringify(res))
    assert.strictEqual(res!.rows.length, 3)
    const rowA = res!.rows.find((r) => r.uid === "uA")!
    const rowB = res!.rows.find((r) => r.uid === "uB")!
    const rowC = res!.rows.find((r) => r.uid === "uC")!
    assert.strictEqual(rowA.placement, 1)
    assert(rowB.leaver && rowC.leaver, "leavers flagged")
    assert(rowB.placement >= 2 && rowC.placement >= 2, "leavers are behind the winner")
    assert.strictEqual(rowA.rpBefore, 1500, "result uses the snapshot taken at match start, not the later tampered value")
    assert.strictEqual(rowA.rpDelta + rowB.rpDelta + rowC.rpDelta, 0, "RP is zero-sum even with leavers")
    assert.strictEqual(rowA.mmrDelta + rowB.mmrDelta + rowC.mmrDelta, 0, "MMR is zero-sum even with leavers")
    // the DB holds the new values for EVERY player, including those who left
    assert.strictEqual(store.writes.length, 1, "one atomic write")
    assert.strictEqual(store.data.get("uB")!.gamesPlayed, 1)
    assert.strictEqual(store.data.get("uC")!.rp, rowC.rpAfter)
    assert.strictEqual(store.data.get("uA")!.rp, rowA.rpAfter)
    assert.strictEqual(store.data.get("uA")!.wins, 21)
    // a late reconnect gets the result again
  }

  // --- write failure: honest message, nothing claimed ------------------------
  {
    const { store, w, code, h, j2, j3 } = await rankedMatch()
    let now = 300_000
    if (!h.ok || !j2.ok || !j3.ok) throw 0
    w.mgr.setReady("r2", { ready: true }, now)
    w.mgr.setReady("r3", { ready: true }, now)
    w.mgr.startGame("r1", now)
    await flush()
    store.failWrites = true
    now += NET.COUNTDOWN_MS
    w.mgr.tick(now)
    w.mgr.onDisconnect("r2", now)
    w.mgr.onDisconnect("r3", now)
    for (let i = 0; i < NET.RECONNECT_GRACE_MS / T + 10; i++) {
      now += T
      w.mgr.tick(now)
    }
    await flush()
    const res = rankedPayload(w, "r1")
    assert(res && !res.saved && res.note, "failed save is reported")
    assert.strictEqual(store.data.size, 0)
  }
}

function runBots() {
  // bots fill a casual room, are tagged, ranked rooms reject them
  const w = makeWorld()
  let now = 500_000
  const r = w.mgr.createRoom("b1", { name: "Solo", settings: { bots: true, botLevel: "hard", mode: "classic" } }, now)
  if (!r.ok) throw 0
  assert.strictEqual(r.room.settings.botLevel, "hard")
  const started = w.mgr.startGame("b1", now)
  assert(started.ok, "one human may start a casual room when bots fill it")
  const room = lastRoom(w, "b1")
  const bots = room.players.filter((p) => p.bot)
  assert.strictEqual(room.players.length, 4, "classic is topped up to 4")
  assert.strictEqual(bots.length, 3)
  assert(bots.every((b) => b.botLevel === "hard" && !b.uid && b.id.startsWith("bot_")))
  assert.strictEqual(new Set(room.players.map((p) => p.name)).size, 4, "unique names")
  // bots really move on the server and are tagged in standings
  now += NET.COUNTDOWN_MS
  w.mgr.tick(now)
  const eng = w.mgr.getRoom(r.code)!.engine!
  const before = JSON.stringify([...eng.inspect().snakes.values()].map((s) => s.seg[0]))
  for (let i = 0; i < 60; i++) {
    now += T
    w.mgr.tick(now)
  }
  const after = JSON.stringify([...eng.inspect().snakes.values()].map((s) => s.seg[0]))
  assert.notStrictEqual(before, after, "bots and human move")
  // bots off: 2 humans minimum again
  const w2 = makeWorld()
  const o = w2.mgr.createRoom("n1", { name: "N", settings: { bots: false } }, 1)
  if (!o.ok) throw 0
  const e = w2.mgr.startGame("n1", 1)
  assert(!e.ok && e.code === "NOT_ENOUGH_PLAYERS")
  // bots are never rated: casual match end produces no RANKED_RESULT / writes
  assert(!w.sent.some((s) => s.event === "RANKED_RESULT"))
  // forfeit keeps the player in the room
  assert(w.mgr.forfeitMatch("b1", now).ok)
  assert(lastRoom(w, "b1").players.some((p) => !p.bot))
}

runBots()
void runRanked().then(
  () => console.log("NET: ALL TESTS PASSED"),
  (err) => {
    console.error(err)
    process.exit(1)
  },
)
