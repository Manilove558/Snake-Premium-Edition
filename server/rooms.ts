// server/rooms.ts — rooms, lobby, matchmaking, game lifecycle, reconnect handling, server-side bots
// and SERVER-SIDE RANKED SETTLING.
//
// Transport-agnostic: it talks to the world through the tiny `Transport` interface and has NO timers.
// Everything time-based (countdown, reconnect grace, public auto-start, cleanup) is driven by
// `tick(now)`, which server/index.ts calls 20x per second. That makes the whole thing deterministic
// and testable without sockets (see scripts/net-selftest.ts).
//
// Ranked (v23): `settings.ranked` is a ROOM property chosen at creation — everybody in the room is rated or
// nobody is. When a ranked match ends the server calculates RP/MMR with calculateMatchRankings() from the
// ratings it SNAPSHOTTED at match start and writes ranked/{uid} through the RankedStore (Firebase Admin SDK).
// Clients never write ratings.
import { randomBytes, timingSafeEqual } from "node:crypto"
import { BATTLE_MAPS } from "../lib/battle-maps"
import { applyMatchResult, calculateMatchRankings, toRankedPlayer, type RankedPlayer } from "../lib/ranked"
import { rankProfileRecord, type RankProfileBundle } from "../lib/ranked-profile"
import {
  DEFAULT_ROOM_SETTINGS,
  MODE_RULES,
  NET,
  PLAYER_COLORS,
  RANKED_MIN_HUMANS,
  RANKED_MIN_PLAYERS_MESSAGE,
  ROOM_CODE_CHARS,
  asObject,
  isBotLevel,
  isDir,
  isGameMode,
  isPlayerColor,
  isRoomCode,
  normalizeRoomCode,
  sanitizeName,
  sanitizeSkinId,
  type AckResult,
  type GameMode,
  type GameOverPayload,
  type GameStartPayload,
  type JoinedInfo,
  type LobbyPlayer,
  type NetErrorCode,
  type RankedResultPayload,
  type RankedResultRow,
  type RoomSettings,
  type RoomSnapshot,
  type RoomStatus,
  type S2CEvent,
  type S2CPayload,
} from "../shared/snake-protocol"
import { BotController, planBots, type BotSpec } from "./bots"
import { GameEngine } from "./engine"
import type { RankedRecordData, RankedStore } from "./ranked-store"

/** How the manager talks to connected sockets. server/index.ts implements it with socket.io. */
export interface Transport {
  /** send to everybody in the room */
  toRoom<E extends S2CEvent>(code: string, event: E, payload: S2CPayload<E>): void
  /** send to one socket */
  toSocket<E extends S2CEvent>(socketId: string, event: E, payload: S2CPayload<E>): void
  /** subscribe / unsubscribe a socket to the room's broadcast channel */
  joinChannel(socketId: string, code: string): void
  leaveChannel(socketId: string, code: string): void
}

export interface RoomManagerOptions {
  /** Where ranked ratings live. null / missing = this server cannot run ranked rooms (RANKED_UNAVAILABLE). */
  rankedStore?: RankedStore | null
  /** randomness for map picks / bot names (tests inject a seeded one) */
  rng?: () => number
  /** logger for server-side problems (default console.error) */
  log?: (msg: string, err?: unknown) => void
}

interface RoomPlayer {
  id: string
  /** secret reconnect token */
  token: string
  /** Firebase uid verified from the ID token (null = unverified / guest) */
  uid: string | null
  name: string
  color: string
  skinId: string
  vip: boolean
  ready: boolean
  socketId: string | null
  joinedAt: number
  /** set while disconnected: the snake / slot is removed when `now` passes it */
  dropAt: number | null
  /** left the running match with FORFEIT_MATCH ("Back to room"): out of this round, still in the room */
  forfeited: boolean
}

/** Everything the server must remember about ONE ranked match. Created at the countdown, never changed by clients. */
interface RankedSession {
  roomCode: string
  /** who is rated: every human seat, with the verified uid (fixed at match start, survives leavers) */
  participants: { id: string; uid: string; name: string }[]
  /** ratings as they were when the match STARTED — the only numbers the result is calculated from */
  pre: Record<string, RankProfileBundle> | null
  preError: string | null
  ready: Promise<void>
  settled: boolean
  /** settling (incl. the database write) has finished — the room may be deleted / rematched */
  done: boolean
}

interface Room {
  code: string
  status: RoomStatus
  hostId: string
  settings: RoomSettings
  isPublic: boolean
  createdAt: number
  autoStartAt: number | null
  players: Map<string, RoomPlayer>
  /** AI bots of the current match (added when the countdown starts, removed on rematch) */
  bots: BotSpec[]
  controller: BotController | null
  engine: GameEngine | null
  startsAt: number | null
  lastResult: GameOverPayload | null
  endedAt: number | null
  ranked: RankedSession | null
  lastRanked: RankedResultPayload | null
}

type StartKind = "manual" | "auto" | "rematch"

const ok = <T extends object>(v: T): AckResult<T> => ({ ok: true, ...v })
const fail = (code: NetErrorCode, message: string): AckResult<never> => ({ ok: false, code, message })

/** constant-time string compare (reconnect tokens) */
function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  return ba.length === bb.length && timingSafeEqual(ba, bb)
}

/** The fixed rules of a ranked room: classic, teleport ON, no snake collision, no bots. */
function applyRankedRules(s: RoomSettings): RoomSettings {
  return { ...s, mode: "classic", teleport: true, avoidCollision: true, bots: false, ranked: true }
}

export class RoomManager {
  private readonly rooms = new Map<string, Room>()
  /** socket id -> where that socket currently is */
  private readonly bySocket = new Map<string, { code: string; playerId: string }>()
  /** uid -> the (unsettled) ranked match that account is part of */
  private readonly rankedActive = new Map<string, RankedSession>()
  private readonly rankedStore: RankedStore | null
  private readonly rng: () => number
  private readonly log: (msg: string, err?: unknown) => void

  constructor(
    private readonly transport: Transport,
    opts: RoomManagerOptions = {},
  ) {
    this.rankedStore = opts.rankedStore ?? null
    this.rng = opts.rng ?? Math.random
    this.log = opts.log ?? ((msg, err) => console.error(msg, err ?? ""))
  }

  /** Can this server run ranked rooms at all? (needs Firebase Admin credentials + database URL) */
  get rankedAvailable(): boolean {
    return this.rankedStore !== null
  }

  // =========================================================================
  // Requests (each returns the acknowledgement for the client)
  // =========================================================================

  createRoom(socketId: string, raw: unknown, now: number, verifiedUid: string | null = null): AckResult<JoinedInfo> {
    if (this.rooms.size >= NET.MAX_ROOMS) return fail("SERVER_BUSY", "Server is full, try again in a moment")
    const p = asObject(raw)
    const settings = this.parseSettings(p.settings, DEFAULT_ROOM_SETTINGS, true)
    const gate = this.rankedGate(settings.ranked, verifiedUid)
    if (gate) return gate
    this.leaveCurrent(socketId, now)
    const room = this.newRoom(now, settings, p.isPublic === true)
    return this.addPlayer(room, socketId, p, now, verifiedUid)
  }

  joinRoom(socketId: string, raw: unknown, now: number, verifiedUid: string | null = null): AckResult<JoinedInfo> {
    const p = asObject(raw)
    const code = normalizeRoomCode(p.code)
    if (!isRoomCode(code)) return fail("BAD_REQUEST", "Room codes are 6 characters")
    const room = this.rooms.get(code)
    if (!room) return fail("ROOM_NOT_FOUND", "No room with that code")
    if (p.expectRanked === true && !room.settings.ranked) {
      return fail("NOT_RANKED", "That room is not a ranked room. Use the Casual tab to join it.")
    }
    const gate = this.rankedGate(room.settings.ranked, verifiedUid, room)
    if (gate) return gate
    if (room.status !== "lobby") return fail("ROOM_IN_PROGRESS", "That match has already started")
    if (room.players.size >= MODE_RULES[room.settings.mode].maxPlayers) return fail("ROOM_FULL", "Room is full")
    this.leaveCurrent(socketId, now)
    return this.addPlayer(room, socketId, p, now, verifiedUid)
  }

  /** "Join Global": the fullest open public lobby of that mode (and kind: casual / ranked), or a brand-new one. */
  quickMatch(socketId: string, raw: unknown, now: number, verifiedUid: string | null = null): AckResult<JoinedInfo> {
    const p = asObject(raw)
    const ranked = p.ranked === true
    // Ranked global rooms are always classic
    const mode: GameMode = ranked ? "classic" : isGameMode(p.mode) ? p.mode : "classic"
    const gate = this.rankedGate(ranked, verifiedUid)
    if (gate) return gate
    this.leaveCurrent(socketId, now)
    let best: Room | null = null
    for (const r of this.rooms.values()) {
      if (!r.isPublic || r.status !== "lobby" || r.settings.mode !== mode || r.settings.ranked !== ranked) continue
      if (r.players.size >= MODE_RULES[mode].maxPlayers) continue
      if (ranked && verifiedUid && this.hasUid(r, verifiedUid)) continue // one seat per account in a ranked room
      if (!best || r.players.size > best.players.size) best = r
    }
    if (best) return this.addPlayer(best, socketId, p, now, verifiedUid)
    if (this.rooms.size >= NET.MAX_ROOMS) return fail("SERVER_BUSY", "Server is full, try again in a moment")
    const base: RoomSettings = { ...DEFAULT_ROOM_SETTINGS, mode }
    return this.addPlayer(this.newRoom(now, ranked ? applyRankedRules(base) : base, true), socketId, p, now, verifiedUid)
  }

  /** Re-attach a new socket to an existing player (page reload, network drop, app resumed). */
  reconnect(socketId: string, raw: unknown, now: number): AckResult<JoinedInfo> {
    const p = asObject(raw)
    const code = normalizeRoomCode(p.code)
    const room = this.rooms.get(code)
    const player = room?.players.get(typeof p.playerId === "string" ? p.playerId : "")
    if (!room || !player || typeof p.token !== "string" || !safeEqual(player.token, p.token)) {
      return fail("BAD_SESSION", "Session expired")
    }
    // Same player on a second socket (another tab): the newest one wins, the old one is told why.
    if (player.socketId && player.socketId !== socketId) {
      const old = player.socketId
      this.bySocket.delete(old)
      this.transport.leaveChannel(old, code)
      this.transport.toSocket(old, "NET_NOTICE", { code: "SESSION_REPLACED", message: "Signed in from another tab" })
    }
    this.leaveCurrent(socketId, now, code, player.id)
    player.socketId = socketId
    player.dropAt = null
    this.bySocket.set(socketId, { code, playerId: player.id })
    this.transport.joinChannel(socketId, code)
    this.pushRoom(room, now)
    this.resync(room, socketId, now)
    return ok(this.joinedInfo(room, player, now))
  }

  leave(socketId: string, now: number): AckResult {
    if (!this.bySocket.has(socketId)) return fail("NOT_IN_ROOM", "You are not in a room")
    this.leaveCurrent(socketId, now)
    return ok({})
  }

  setReady(socketId: string, raw: unknown, now: number): AckResult {
    const ctx = this.ctx(socketId)
    if (!ctx) return fail("NOT_IN_ROOM", "You are not in a room")
    if (ctx.room.status !== "lobby") return fail("BAD_STATE", "Match already started")
    ctx.player.ready = asObject(raw).ready === true
    this.pushRoom(ctx.room, now)
    return ok({})
  }

  updateProfile(socketId: string, raw: unknown, now: number): AckResult {
    const ctx = this.ctx(socketId)
    if (!ctx) return fail("NOT_IN_ROOM", "You are not in a room")
    if (ctx.room.status !== "lobby") return fail("BAD_STATE", "Can only be changed in the lobby")
    const p = asObject(raw)
    if (typeof p.name === "string") ctx.player.name = sanitizeName(p.name, ctx.player.name)
    if (p.skinId !== undefined) ctx.player.skinId = sanitizeSkinId(p.skinId)
    if (typeof p.vip === "boolean") ctx.player.vip = p.vip
    if (isPlayerColor(p.color) && !this.colorTaken(ctx.room, p.color, ctx.player.id)) ctx.player.color = p.color
    this.pushRoom(ctx.room, now)
    return ok({})
  }

  updateSettings(socketId: string, raw: unknown, now: number): AckResult {
    const ctx = this.ctx(socketId)
    if (!ctx) return fail("NOT_IN_ROOM", "You are not in a room")
    if (ctx.room.hostId !== ctx.player.id) return fail("NOT_HOST", "Only the host can change settings")
    if (ctx.room.status !== "lobby") return fail("BAD_STATE", "Can only be changed in the lobby")
    // `ranked` is decided once, at room creation: parseSettings(…, false) keeps the room's value.
    ctx.room.settings = this.parseSettings(raw, ctx.room.settings, false)
    for (const pl of ctx.room.players.values()) pl.ready = false
    this.syncAutoStart(ctx.room, now)
    this.pushRoom(ctx.room, now)
    return ok({})
  }

  startGame(socketId: string, now: number): AckResult {
    const ctx = this.ctx(socketId)
    if (!ctx) return fail("NOT_IN_ROOM", "You are not in a room")
    const { room, player } = ctx
    if (room.hostId !== player.id) return fail("NOT_HOST", "Only the host can start the match")
    if (room.status !== "lobby" && room.status !== "ended") return fail("BAD_STATE", "Match already started")
    // From the result screen the host can start the next round straight away ("Rematch")
    const rematch = room.status === "ended"
    const blocked = this.canStart(room, rematch ? "rematch" : "manual")
    if (blocked) return blocked
    if (rematch) this.recycle(room, now)
    this.beginCountdown(room, now)
    return ok({})
  }

  /** Host: after GAME_OVER, go back to the lobby for a rematch. */
  resetRoom(socketId: string, now: number): AckResult {
    const ctx = this.ctx(socketId)
    if (!ctx) return fail("NOT_IN_ROOM", "You are not in a room")
    if (ctx.room.hostId !== ctx.player.id) return fail("NOT_HOST", "Only the host can do that")
    if (ctx.room.status !== "ended") return fail("BAD_STATE", "The match is not over yet")
    const room = ctx.room
    this.recycle(room, now)
    if (!this.rooms.has(room.code)) return ok({})
    room.status = "lobby"
    this.syncAutoStart(room, now)
    this.pushRoom(room, now)
    return ok({})
  }

  /**
   * "Back to room" in the middle of a match: my snake leaves the round (it counts as last place — in a ranked room
   * the server settles me as a leaver) but I stay in the room and can play the next round.
   */
  forfeitMatch(socketId: string, now: number): AckResult {
    const ctx = this.ctx(socketId)
    if (!ctx) return fail("NOT_IN_ROOM", "You are not in a room")
    const { room, player } = ctx
    if ((room.status === "countdown" || room.status === "playing") && room.engine && !player.forfeited) {
      player.forfeited = true
      room.engine.removePlayer(player.id)
      this.pushRoom(room, now)
    }
    return ok({})
  }

  /** Hot path (no ack): queue a turn. Silently ignored when invalid — a cheater gains nothing from probing. */
  moveInput(socketId: string, raw: unknown): void {
    const ctx = this.ctx(socketId)
    if (!ctx || ctx.room.status !== "playing" || !ctx.room.engine || ctx.player.forfeited) return
    const p = asObject(raw)
    if (!isDir(p.dir) || typeof p.seq !== "number") return
    ctx.room.engine.setDirection(ctx.player.id, p.dir, p.seq)
  }

  /** The socket is gone. Keep the slot (and the snake!) for RECONNECT_GRACE_MS, then remove it. */
  onDisconnect(socketId: string, now: number): void {
    const ctx = this.ctx(socketId)
    this.bySocket.delete(socketId)
    if (!ctx) return
    ctx.player.socketId = null
    ctx.player.dropAt = now + NET.RECONNECT_GRACE_MS
    this.pushRoom(ctx.room, now)
  }

  // =========================================================================
  // Clock — call every NET.TICK_MS
  // =========================================================================

  tick(now: number): void {
    for (const room of [...this.rooms.values()]) {
      // reconnect grace expired
      for (const p of [...room.players.values()]) {
        if (p.dropAt !== null && now >= p.dropAt) this.dropPlayer(room, p.id, now)
      }
      if (!this.rooms.has(room.code)) continue

      if (room.status === "lobby") {
        this.syncAutoStart(room, now)
        if (room.isPublic && room.autoStartAt !== null && now >= room.autoStartAt) {
          if (this.canStart(room, "auto")) {
            room.autoStartAt = null // e.g. a ranked lobby that lost a player: wait for the next join
            this.pushRoom(room, now)
          } else {
            this.beginCountdown(room, now)
          }
        }
      } else if (room.status === "countdown") {
        if (room.startsAt !== null && now >= room.startsAt) {
          room.status = "playing"
          this.pushRoom(room, now)
        }
      } else if (room.status === "playing" && room.engine) {
        room.controller?.think(room.engine, now) // bots choose their turn right before the engine moves them
        const out = room.engine.tick(now)
        if (out.sync) this.transport.toRoom(room.code, "GAME_STATE_SYNC", out.sync)
        for (const d of out.died) this.transport.toRoom(room.code, "PLAYER_DIED", d)
        if (out.over) this.finishMatch(room, out.over, now)
      } else if (room.status === "ended" && room.endedAt !== null) {
        const settling = room.ranked !== null && !room.ranked.done
        if (!settling && (room.players.size === 0 || now - room.endedAt > NET.ENDED_ROOM_TTL_MS)) this.deleteRoom(room)
      }
    }
  }

  stats(): { rooms: number; players: number; playing: number } {
    let players = 0
    let playing = 0
    for (const r of this.rooms.values()) {
      players += r.players.size
      if (r.status === "playing") playing++
    }
    return { rooms: this.rooms.size, players, playing }
  }

  /** Test / debug helper. */
  getRoom(code: string): Readonly<Room> | undefined {
    return this.rooms.get(code)
  }

  // =========================================================================
  // Internals
  // =========================================================================

  private ctx(socketId: string): { room: Room; player: RoomPlayer } | null {
    const at = this.bySocket.get(socketId)
    const room = at ? this.rooms.get(at.code) : undefined
    const player = room?.players.get(at?.playerId ?? "")
    return room && player ? { room, player } : null
  }

  private newRoom(now: number, settings: RoomSettings, isPublic: boolean): Room {
    let code = ""
    do {
      code = Array.from(randomBytes(NET.ROOM_CODE_LENGTH), (b: number) => ROOM_CODE_CHARS[b % ROOM_CODE_CHARS.length]).join("")
    } while (this.rooms.has(code))
    const room: Room = {
      code,
      status: "lobby",
      hostId: "",
      settings,
      isPublic,
      createdAt: now,
      autoStartAt: null,
      players: new Map(),
      bots: [],
      controller: null,
      engine: null,
      startsAt: null,
      lastResult: null,
      endedAt: null,
      ranked: null,
      lastRanked: null,
    }
    this.rooms.set(code, room)
    return room
  }

  private deleteRoom(room: Room): void {
    for (const p of room.players.values()) {
      if (p.socketId) {
        this.bySocket.delete(p.socketId)
        this.transport.leaveChannel(p.socketId, room.code)
      }
    }
    if (room.ranked) this.releaseRankedUids(room.ranked)
    this.rooms.delete(room.code)
  }

  private colorTaken(room: Room, color: string, exceptId?: string): boolean {
    for (const p of room.players.values()) if (p.id !== exceptId && p.color === color) return true
    return false
  }

  private hasUid(room: Room, uid: string): boolean {
    for (const p of room.players.values()) if (p.uid === uid) return true
    return false
  }

  /**
   * Gate for everything that creates / enters a RANKED room: the server must be able to settle ranked, and the
   * player must be verified (Firebase ID token), once per account. Casual rooms pass straight through.
   */
  private rankedGate(ranked: boolean, verifiedUid: string | null, room?: Room): AckResult<never> | null {
    if (!ranked) return null
    if (!this.rankedStore) return fail("RANKED_UNAVAILABLE", "Ranked is not available on this server right now")
    if (!verifiedUid) return fail("NOT_VERIFIED", "Ranked rooms need a Google sign-in (your account could not be verified)")
    if (room && this.hasUid(room, verifiedUid)) return fail("RANKED_RULES", "This account is already in the room")
    return null
  }

  private addPlayer(room: Room, socketId: string, raw: Record<string, unknown>, now: number, verifiedUid: string | null = null): AckResult<JoinedInfo> {
    const color =
      (isPlayerColor(raw.color) && !this.colorTaken(room, raw.color) ? raw.color : undefined) ??
      PLAYER_COLORS.find((c) => !this.colorTaken(room, c)) ??
      PLAYER_COLORS[0]
    const player: RoomPlayer = {
      id: `p_${randomBytes(6).toString("hex")}`,
      token: randomBytes(16).toString("hex"),
      uid: verifiedUid,
      name: sanitizeName(raw.name),
      color,
      skinId: sanitizeSkinId(raw.skinId),
      vip: raw.vip === true,
      ready: false,
      socketId,
      joinedAt: now,
      dropAt: null,
      forfeited: false,
    }
    room.players.set(player.id, player)
    if (!room.hostId) room.hostId = player.id
    this.bySocket.set(socketId, { code: room.code, playerId: player.id })
    this.transport.joinChannel(socketId, room.code)
    this.syncAutoStart(room, now)
    this.pushRoom(room, now)
    return ok(this.joinedInfo(room, player, now))
  }

  private joinedInfo(room: Room, player: RoomPlayer, now: number): JoinedInfo {
    return { code: room.code, playerId: player.id, token: player.token, room: this.snapshot(room, now) }
  }

  /** A socket leaves its current room on purpose (or because it is creating / joining another one). */
  private leaveCurrent(socketId: string, now: number, keepCode?: string, keepPlayerId?: string): void {
    const at = this.bySocket.get(socketId)
    if (!at) return
    if (at.code === keepCode && at.playerId === keepPlayerId) return
    const room = this.rooms.get(at.code)
    this.bySocket.delete(socketId)
    this.transport.leaveChannel(socketId, at.code)
    if (room) this.dropPlayer(room, at.playerId, now)
  }

  /** Remove a player from a room for good. In a running match the snake turns into food (and, ranked: last place). */
  private dropPlayer(room: Room, playerId: string, now: number): void {
    const p = room.players.get(playerId)
    if (!p) return
    if ((room.status === "countdown" || room.status === "playing") && room.engine) room.engine.removePlayer(playerId)
    room.players.delete(playerId)
    if (p.socketId) {
      this.bySocket.delete(p.socketId)
      this.transport.leaveChannel(p.socketId, room.code)
    }
    if (room.players.size === 0) {
      // A ranked match must still be finished and settled (everybody who left counts as a leaver) before the room goes.
      const live = (room.status === "countdown" || room.status === "playing") && room.engine !== null
      if (live && room.ranked && !room.ranked.settled) return
      return void this.deleteRoom(room)
    }
    if (room.hostId === playerId) {
      // oldest connected player becomes host; if everyone is away, the oldest of all
      const list = [...room.players.values()].sort((a, b) => a.joinedAt - b.joinedAt)
      room.hostId = (list.find((x) => x.socketId !== null) ?? list[0]).id
    }
    this.syncAutoStart(room, now)
    this.pushRoom(room, now)
  }

  /**
   * `base` is the room's current (or default) settings. Unknown / invalid keys keep their old value.
   * `allowRanked`: only room CREATION may switch ranked on — afterwards the flag is frozen.
   */
  private parseSettings(raw: unknown, base: RoomSettings, allowRanked: boolean): RoomSettings {
    const p = asObject(raw)
    const ranked = allowRanked ? p.ranked === true : base.ranked
    const next: RoomSettings = {
      mode: isGameMode(p.mode) ? p.mode : base.mode,
      map: typeof p.map === "string" && BATTLE_MAPS.some((m) => m.id === p.map) ? p.map : base.map,
      teleport: typeof p.teleport === "boolean" ? p.teleport : base.teleport,
      avoidCollision: typeof p.avoidCollision === "boolean" ? p.avoidCollision : base.avoidCollision,
      grid: typeof p.grid === "boolean" ? p.grid : base.grid,
      bots: typeof p.bots === "boolean" ? p.bots : base.bots,
      botLevel: isBotLevel(p.botLevel) ? p.botLevel : base.botLevel,
      ranked,
    }
    return ranked ? applyRankedRules(next) : next
  }

  /** Fewest HUMANS that may start this room right now. */
  private minPlayersFor(room: Room): number {
    if (room.settings.ranked) return Math.max(MODE_RULES.classic.minPlayers, RANKED_MIN_HUMANS)
    // "Fill empty slots": one human is enough, bots top the room up when the match starts
    return room.settings.bots ? 1 : MODE_RULES[room.settings.mode].minPlayers
  }

  /**
   * null = the match may start; otherwise the reason.
   * "rematch" = started from the result screen: players who are gone are dropped first, so they do not count.
   * "auto"    = public lobby timer: a player inside the reconnect grace period does not block it.
   */
  private canStart(room: Room, kind: StartKind): AckResult<never> | null {
    const all = [...room.players.values()]
    const present = kind === "rematch" ? all.filter((p) => p.socketId !== null) : all
    if (room.settings.ranked) {
      if (!this.rankedStore) return fail("RANKED_UNAVAILABLE", "Ranked is not available on this server right now")
      if (room.ranked && !room.ranked.done) return fail("BAD_STATE", "Saving the last ranked result… try again in a moment")
      if (present.length < RANKED_MIN_HUMANS) return fail("NOT_ENOUGH_PLAYERS", RANKED_MIN_PLAYERS_MESSAGE)
      const unverified = present.find((p) => p.uid === null)
      if (unverified) {
        return fail("NOT_VERIFIED", `Everybody in a ranked room must be signed in with Google — ${unverified.name} is not verified`)
      }
      if (new Set(present.map((p) => p.uid)).size !== present.length) {
        return fail("RANKED_RULES", "Ranked needs a different account for every player")
      }
      for (const p of present) {
        const other = p.uid ? this.rankedActive.get(p.uid) : undefined
        if (other && other.roomCode !== room.code) return fail("RANKED_RULES", `${p.name} is still in another ranked match`)
      }
    } else if (present.length < this.minPlayersFor(room)) {
      return fail("NOT_ENOUGH_PLAYERS", `Need at least ${this.minPlayersFor(room)} players for ${room.settings.mode}`)
    }
    if (kind === "manual") {
      for (const pl of all) if (pl.socketId === null) return fail("NOT_READY", "Waiting for a player to reconnect")
      for (const pl of all) if (pl.id !== room.hostId && !pl.ready) return fail("NOT_READY", `${pl.name} is not ready yet`)
    }
    return null
  }

  /** Public lobbies start by themselves: 30 s after the minimum is reached, at once when full. */
  private syncAutoStart(room: Room, now: number): void {
    if (!room.isPublic || room.status !== "lobby") return
    const rules = MODE_RULES[room.settings.mode]
    const before = room.autoStartAt
    if (room.players.size < this.minPlayersFor(room)) room.autoStartAt = null
    else if (room.players.size >= rules.maxPlayers) room.autoStartAt = Math.min(room.autoStartAt ?? Infinity, now + NET.COUNTDOWN_MS)
    else if (room.autoStartAt === null) room.autoStartAt = now + NET.PUBLIC_AUTOSTART_MS
    if (before !== room.autoStartAt && this.rooms.has(room.code)) this.pushRoom(room, now)
  }

  /** Back to a clean lobby state: old bots go, forfeits are forgotten, players who never came back are dropped. */
  private recycle(room: Room, now: number): void {
    if (room.ranked) this.releaseRankedUids(room.ranked)
    room.bots = []
    room.controller = null
    room.engine = null
    room.startsAt = null
    room.lastResult = null
    room.lastRanked = null
    room.endedAt = null
    room.ranked = null
    room.isPublic = false // a finished global match is not re-opened to strangers
    for (const pl of [...room.players.values()]) {
      if (pl.socketId === null) this.dropPlayer(room, pl.id, now) // those who never came back
      else {
        pl.ready = false
        pl.forfeited = false
      }
    }
  }

  private beginCountdown(room: Room, now: number): void {
    room.status = "countdown"
    room.autoStartAt = null
    room.startsAt = now + NET.COUNTDOWN_MS
    room.lastResult = null
    room.lastRanked = null
    const ranked = room.settings.ranked

    // Ranked rooms: the arena is drawn at random for EVERY match (nobody picks the map)
    if (ranked) room.settings = { ...room.settings, map: BATTLE_MAPS[Math.floor(this.rng() * BATTLE_MAPS.length)].id }

    // Server-side bots fill the empty slots (never in a ranked room)
    const humans = [...room.players.values()].sort((a, b) => a.joinedAt - b.joinedAt)
    room.bots =
      !ranked && room.settings.bots
        ? planBots({
            mode: room.settings.mode,
            level: room.settings.botLevel,
            humanNames: humans.map((p) => p.name),
            humanColors: humans.map((p) => p.color),
            humanCount: humans.length,
            lastJoinedAt: humans.length > 0 ? humans[humans.length - 1].joinedAt : now,
            rng: this.rng,
          })
        : []

    const seats = [
      ...humans.map((p) => ({ id: p.id, name: p.name, uid: p.uid, bot: false, joinedAt: p.joinedAt })),
      ...room.bots.map((b) => ({ id: b.id, name: b.name, uid: null as string | null, bot: true, joinedAt: b.joinedAt })),
    ].sort((a, b) => a.joinedAt - b.joinedAt)

    room.engine = new GameEngine({
      mode: room.settings.mode,
      settings: room.settings,
      players: seats.map((p) => ({ id: p.id, name: p.name, uid: p.uid, bot: p.bot })),
      startAt: room.startsAt,
    })
    room.controller = room.bots.length > 0 ? new BotController(room.bots, room.engine.seed) : null
    room.ranked = ranked ? this.openRankedSession(room, humans, now) : null

    const payload: GameStartPayload = {
      config: room.engine.config,
      startsAt: room.startsAt,
      serverTime: now,
      state: room.engine.snapshot(),
    }
    this.transport.toRoom(room.code, "GAME_STARTING", payload)
    this.pushRoom(room, now)
  }

  /** Freeze who is rated and start reading everybody's rating NOW (the snapshot the result is calculated from). */
  private openRankedSession(room: Room, humans: RoomPlayer[], now: number): RankedSession {
    const participants = humans.map((p) => ({ id: p.id, uid: p.uid as string, name: p.name }))
    const session: RankedSession = {
      roomCode: room.code,
      participants,
      pre: null,
      preError: null,
      ready: Promise.resolve(),
      settled: false,
      done: false,
    }
    for (const p of participants) this.rankedActive.set(p.uid, session)
    const store = this.rankedStore
    session.ready = (async () => {
      if (!store) throw new Error("no ranked store")
      session.pre = await store.fetchProfiles(
        participants.map((p) => p.uid),
        now,
      )
    })().catch((err: unknown) => {
      session.preError = err instanceof Error ? err.message : String(err)
      this.log("[ranked] could not read the ratings at match start", err)
    })
    return session
  }

  private finishMatch(room: Room, over: GameOverPayload, now: number): void {
    room.status = "ended"
    room.endedAt = now
    room.lastResult = over
    this.transport.toRoom(room.code, "GAME_OVER", over)
    this.pushRoom(room, now)
    if (room.ranked) void this.settleRanked(room, room.ranked, over, now)
  }

  /**
   * THE server-side ranked settlement. Inputs: the ratings snapshotted at match start + the authoritative standings.
   *  - everybody in the room is rated (all-or-nothing); a leaver / dropped player is LAST place and still settled
   *  - calculateMatchRankings() is zero-sum, and because every row comes from the SAME snapshot it stays zero-sum
   *    even when somebody disconnected before the end
   *  - the result is written to ranked/{uid} by the RankedStore (Admin SDK); then RANKED_RESULT goes to the room
   */
  private async settleRanked(room: Room, session: RankedSession, over: GameOverPayload, now: number): Promise<void> {
    if (session.settled) return
    session.settled = true
    let payload: RankedResultPayload
    try {
      await session.ready
      payload = await this.computeAndSave(session, over, now)
    } catch (err) {
      this.log("[ranked] settle failed", err)
      payload = { rows: [], saved: false, note: "Could not save the ranked result. Nobody's rating was changed." }
    }
    session.done = true
    this.releaseRankedUids(session)
    if (room.ranked === session) {
      room.lastRanked = payload
      if (this.rooms.get(room.code) === room) this.transport.toRoom(room.code, "RANKED_RESULT", payload)
    }
  }

  private async computeAndSave(session: RankedSession, over: GameOverPayload, now: number): Promise<RankedResultPayload> {
    const pre = session.pre
    if (!pre) return { rows: [], saved: false, note: "Ratings were unavailable — this match did not count." }
    const standings = over.standings.filter((s) => !s.bot)
    if (standings.length < RANKED_MIN_HUMANS) {
      return { rows: [], saved: false, note: `${RANKED_MIN_PLAYERS_MESSAGE} — this match did not count.` }
    }
    // the uid travels with the standings (a player who left is no longer in the room list); only seats rated at the start count
    const rated = new Map(session.participants.map((p) => [p.id, p.uid]))
    if (standings.some((s) => !s.uid || rated.get(s.id) !== s.uid || !pre[s.uid])) {
      return { rows: [], saved: false, note: "A player wasn't verified — this match did not count." }
    }
    const n = standings.length
    const players: RankedPlayer[] = standings.map((s) =>
      toRankedPlayer(pre[s.uid as string].profile, {
        placement: s.disconnected ? n : s.placement, // leavers / dropped players finish last
        kills: s.kills,
        peakMass: s.peakMass,
      }),
    )
    const results = calculateMatchRankings(players)
    const byUid = new Map(results.map((r) => [r.uid, r]))

    const records: Record<string, RankedRecordData> = {}
    const rows: RankedResultRow[] = standings.map((s) => {
      const uid = s.uid as string
      const res = byUid.get(uid)
      if (!res) throw new Error("ranked: missing result")
      const before = pre[uid]
      const bundle: RankProfileBundle = {
        profile: { ...applyMatchResult(before.profile, res, now), uid },
        wins: before.wins,
        losses: before.losses,
      }
      records[uid] = rankProfileRecord(bundle, res.placement === 1)
      return {
        id: s.id,
        uid,
        name: s.name,
        placement: res.placement,
        leaver: s.disconnected,
        rpBefore: res.rpBefore,
        rpAfter: res.rpAfter,
        rpDelta: res.rpDelta,
        mmrDelta: res.mmrDelta,
        tier: res.tierAfter.id,
        promoted: res.promoted,
        demoted: res.demoted,
      }
    })
    rows.sort((a, b) => a.placement - b.placement)

    const store = this.rankedStore
    if (!store) return { rows, saved: false, note: "Ranked is not available on this server — nothing was saved." }
    let lastErr: unknown = null
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await store.writeResults(records)
        return { rows, saved: true, note: null }
      } catch (err) {
        lastErr = err
      }
    }
    this.log("[ranked] could not write ranked/{uid}", lastErr)
    return { rows, saved: false, note: "Could not save the ratings to the database — they were not changed." }
  }

  private releaseRankedUids(session: RankedSession): void {
    for (const [uid, s] of this.rankedActive) if (s === session) this.rankedActive.delete(uid)
  }

  /** Bring a (re)connected socket up to date. */
  private resync(room: Room, socketId: string, now: number): void {
    if ((room.status === "countdown" || room.status === "playing") && room.engine && room.startsAt !== null) {
      this.transport.toSocket(socketId, "GAME_STARTING", {
        config: room.engine.config,
        startsAt: room.startsAt,
        serverTime: now,
        state: room.engine.snapshot(),
      })
    } else if (room.status === "ended" && room.lastResult) {
      this.transport.toSocket(socketId, "GAME_OVER", room.lastResult)
      if (room.lastRanked) this.transport.toSocket(socketId, "RANKED_RESULT", room.lastRanked)
    }
  }

  private snapshot(room: Room, now: number): RoomSnapshot {
    const rules = MODE_RULES[room.settings.mode]
    const humans: LobbyPlayer[] = [...room.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      skinId: p.skinId,
      ready: p.id === room.hostId ? true : p.ready,
      isHost: p.id === room.hostId,
      connected: p.socketId !== null,
      joinedAt: p.joinedAt,
      uid: p.uid,
      vip: p.vip,
      bot: false,
      botLevel: null,
    }))
    const bots: LobbyPlayer[] = room.bots.map((b) => ({
      id: b.id,
      name: b.name,
      color: b.color,
      skinId: "default",
      ready: true,
      isHost: false,
      connected: true,
      joinedAt: b.joinedAt,
      uid: null,
      vip: false,
      bot: true,
      botLevel: b.level,
    }))
    return {
      code: room.code,
      status: room.status,
      hostId: room.hostId,
      settings: room.settings,
      isPublic: room.isPublic,
      autoStartAt: room.autoStartAt,
      minPlayers: this.minPlayersFor(room),
      maxPlayers: rules.maxPlayers,
      players: [...humans, ...bots].sort((a, b) => a.joinedAt - b.joinedAt),
      serverTime: now,
    }
  }

  private pushRoom(room: Room, now: number): void {
    this.transport.toRoom(room.code, "ROOM_UPDATE", this.snapshot(room, now))
  }
}
