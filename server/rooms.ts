// server/rooms.ts — rooms, lobby, matchmaking, game lifecycle, reconnect handling.
//
// Transport-agnostic: it talks to the world through the tiny `Transport` interface and has NO timers.
// Everything time-based (countdown, reconnect grace, public auto-start, cleanup) is driven by
// `tick(now)`, which server/index.ts calls 20x per second. That makes the whole thing deterministic
// and testable without sockets (see scripts/net-selftest.ts).
import { randomBytes, timingSafeEqual } from "node:crypto"
import { BATTLE_MAPS } from "../lib/battle-maps"
import {
  DEFAULT_ROOM_SETTINGS,
  MODE_RULES,
  NET,
  PLAYER_COLORS,
  ROOM_CODE_CHARS,
  asObject,
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
  type RoomSettings,
  type RoomSnapshot,
  type RoomStatus,
  type S2CEvent,
  type S2CPayload,
} from "../shared/snake-protocol"
import { GameEngine } from "./engine"

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

interface RoomPlayer {
  id: string
  /** secret reconnect token */
  token: string
  /** Firebase uid verified from the ID token (null = unverified / guest) */
  uid: string | null
  name: string
  color: string
  skinId: string
  ready: boolean
  socketId: string | null
  joinedAt: number
  /** set while disconnected: the snake / slot is removed when `now` passes it */
  dropAt: number | null
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
  engine: GameEngine | null
  startsAt: number | null
  lastResult: GameOverPayload | null
  endedAt: number | null
}

const ok = <T extends object>(v: T): AckResult<T> => ({ ok: true, ...v })
const fail = (code: NetErrorCode, message: string): AckResult<never> => ({ ok: false, code, message })

/** constant-time string compare (reconnect tokens) */
function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  return ba.length === bb.length && timingSafeEqual(ba, bb)
}

export class RoomManager {
  private readonly rooms = new Map<string, Room>()
  /** socket id -> where that socket currently is */
  private readonly bySocket = new Map<string, { code: string; playerId: string }>()

  constructor(private readonly transport: Transport) {}

  // =========================================================================
  // Requests (each returns the acknowledgement for the client)
  // =========================================================================

  createRoom(socketId: string, raw: unknown, now: number, verifiedUid: string | null = null): AckResult<JoinedInfo> {
    if (this.rooms.size >= NET.MAX_ROOMS) return fail("SERVER_BUSY", "Server is full, try again in a moment")
    const p = asObject(raw)
    this.leaveCurrent(socketId, now)
    const room = this.newRoom(now, this.parseSettings(p.settings, DEFAULT_ROOM_SETTINGS), p.isPublic === true)
    return this.addPlayer(room, socketId, p, now, verifiedUid)
  }

  joinRoom(socketId: string, raw: unknown, now: number, verifiedUid: string | null = null): AckResult<JoinedInfo> {
    const p = asObject(raw)
    const code = normalizeRoomCode(p.code)
    if (!isRoomCode(code)) return fail("BAD_REQUEST", "Room codes are 6 characters")
    const room = this.rooms.get(code)
    if (!room) return fail("ROOM_NOT_FOUND", "No room with that code")
    if (room.status !== "lobby") return fail("ROOM_IN_PROGRESS", "That match has already started")
    if (room.players.size >= MODE_RULES[room.settings.mode].maxPlayers) return fail("ROOM_FULL", "Room is full")
    this.leaveCurrent(socketId, now)
    return this.addPlayer(room, socketId, p, now, verifiedUid)
  }

  /** "Join Global": the fullest open public lobby of that mode, or a brand-new one. */
  quickMatch(socketId: string, raw: unknown, now: number, verifiedUid: string | null = null): AckResult<JoinedInfo> {
    const p = asObject(raw)
    const mode: GameMode = isGameMode(p.mode) ? p.mode : "classic"
    this.leaveCurrent(socketId, now)
    let best: Room | null = null
    for (const r of this.rooms.values()) {
      if (!r.isPublic || r.status !== "lobby" || r.settings.mode !== mode) continue
      if (r.players.size >= MODE_RULES[mode].maxPlayers) continue
      if (!best || r.players.size > best.players.size) best = r
    }
    if (best) return this.addPlayer(best, socketId, p, now, verifiedUid)
    if (this.rooms.size >= NET.MAX_ROOMS) return fail("SERVER_BUSY", "Server is full, try again in a moment")
    return this.addPlayer(this.newRoom(now, { ...DEFAULT_ROOM_SETTINGS, mode }, true), socketId, p, now, verifiedUid)
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
    if (isPlayerColor(p.color) && !this.colorTaken(ctx.room, p.color, ctx.player.id)) ctx.player.color = p.color
    this.pushRoom(ctx.room, now)
    return ok({})
  }

  updateSettings(socketId: string, raw: unknown, now: number): AckResult {
    const ctx = this.ctx(socketId)
    if (!ctx) return fail("NOT_IN_ROOM", "You are not in a room")
    if (ctx.room.hostId !== ctx.player.id) return fail("NOT_HOST", "Only the host can change settings")
    if (ctx.room.status !== "lobby") return fail("BAD_STATE", "Can only be changed in the lobby")
    ctx.room.settings = this.parseSettings(raw, ctx.room.settings)
    for (const pl of ctx.room.players.values()) pl.ready = false // new rules -> everybody confirms again
    this.syncAutoStart(ctx.room, now)
    this.pushRoom(ctx.room, now)
    return ok({})
  }

  startGame(socketId: string, now: number): AckResult {
    const ctx = this.ctx(socketId)
    if (!ctx) return fail("NOT_IN_ROOM", "You are not in a room")
    const { room, player } = ctx
    if (room.hostId !== player.id) return fail("NOT_HOST", "Only the host can start the match")
    if (room.status !== "lobby") return fail("BAD_STATE", "Match already started")
    const rules = MODE_RULES[room.settings.mode]
    if (room.players.size < rules.minPlayers) {
      return fail("NOT_ENOUGH_PLAYERS", `Need at least ${rules.minPlayers} players for ${room.settings.mode}`)
    }
    for (const pl of room.players.values()) {
      if (pl.id !== room.hostId && !pl.ready) return fail("NOT_READY", "Everybody has to be ready")
      if (pl.socketId === null) return fail("NOT_READY", "Waiting for a player to reconnect")
    }
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
    for (const pl of [...room.players.values()]) {
      if (pl.socketId === null) this.dropPlayer(room, pl.id, now) // those who never came back
      else pl.ready = false
    }
    if (!this.rooms.has(room.code)) return ok({})
    room.status = "lobby"
    room.engine = null
    room.startsAt = null
    room.lastResult = null
    room.endedAt = null
    this.syncAutoStart(room, now)
    this.pushRoom(room, now)
    return ok({})
  }

  /** Hot path (no ack): queue a turn. Silently ignored when invalid — a cheater gains nothing from probing. */
  moveInput(socketId: string, raw: unknown): void {
    const ctx = this.ctx(socketId)
    if (!ctx || ctx.room.status !== "playing" || !ctx.room.engine) return
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
        if (room.isPublic && room.autoStartAt !== null && now >= room.autoStartAt) this.beginCountdown(room, now)
      } else if (room.status === "countdown") {
        if (room.startsAt !== null && now >= room.startsAt) {
          room.status = "playing"
          this.pushRoom(room, now)
        }
      } else if (room.status === "playing" && room.engine) {
        const out = room.engine.tick(now)
        if (out.sync) this.transport.toRoom(room.code, "GAME_STATE_SYNC", out.sync)
        for (const d of out.died) this.transport.toRoom(room.code, "PLAYER_DIED", d)
        if (out.over) {
          room.status = "ended"
          room.endedAt = now
          room.lastResult = out.over
          this.transport.toRoom(room.code, "GAME_OVER", out.over)
          this.pushRoom(room, now)
        }
      } else if (room.status === "ended" && room.endedAt !== null && now - room.endedAt > NET.ENDED_ROOM_TTL_MS) {
        this.deleteRoom(room)
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
      engine: null,
      startsAt: null,
      lastResult: null,
      endedAt: null,
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
    this.rooms.delete(room.code)
  }

  private colorTaken(room: Room, color: string, exceptId?: string): boolean {
    for (const p of room.players.values()) if (p.id !== exceptId && p.color === color) return true
    return false
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
      ready: false,
      socketId,
      joinedAt: now,
      dropAt: null,
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

  /** Remove a player from a room for good. In a running match the snake turns into food. */
  private dropPlayer(room: Room, playerId: string, now: number): void {
    const p = room.players.get(playerId)
    if (!p) return
    if ((room.status === "countdown" || room.status === "playing") && room.engine) room.engine.removePlayer(playerId)
    room.players.delete(playerId)
    if (p.socketId) {
      this.bySocket.delete(p.socketId)
      this.transport.leaveChannel(p.socketId, room.code)
    }
    if (room.players.size === 0) return void this.rooms.delete(room.code)
    if (room.hostId === playerId) {
      // oldest connected player becomes host; if everyone is away, the oldest of all
      const list = [...room.players.values()].sort((a, b) => a.joinedAt - b.joinedAt)
      room.hostId = (list.find((x) => x.socketId !== null) ?? list[0]).id
    }
    this.syncAutoStart(room, now)
    this.pushRoom(room, now)
  }

  private parseSettings(raw: unknown, base: RoomSettings): RoomSettings {
    const p = asObject(raw)
    const mode = isGameMode(p.mode) ? p.mode : base.mode
    return {
      mode,
      map: typeof p.map === "string" && BATTLE_MAPS.some((m) => m.id === p.map) ? p.map : base.map,
      teleport: typeof p.teleport === "boolean" ? p.teleport : base.teleport,
      avoidCollision: typeof p.avoidCollision === "boolean" ? p.avoidCollision : base.avoidCollision,
    }
  }

  /** Public lobbies start by themselves: 30 s after the minimum is reached, at once when full. */
  private syncAutoStart(room: Room, now: number): void {
    if (!room.isPublic || room.status !== "lobby") return
    const rules = MODE_RULES[room.settings.mode]
    const before = room.autoStartAt
    if (room.players.size < rules.minPlayers) room.autoStartAt = null
    else if (room.players.size >= rules.maxPlayers) room.autoStartAt = Math.min(room.autoStartAt ?? Infinity, now + NET.COUNTDOWN_MS)
    else if (room.autoStartAt === null) room.autoStartAt = now + NET.PUBLIC_AUTOSTART_MS
    if (before !== room.autoStartAt && this.rooms.has(room.code)) this.pushRoom(room, now)
  }

  private beginCountdown(room: Room, now: number): void {
    room.status = "countdown"
    room.autoStartAt = null
    room.startsAt = now + NET.COUNTDOWN_MS
    room.lastResult = null
    const list = [...room.players.values()].sort((a, b) => a.joinedAt - b.joinedAt)
    room.engine = new GameEngine({
      mode: room.settings.mode,
      settings: room.settings,
      players: list.map((p) => ({ id: p.id, name: p.name, uid: p.uid })),
      startAt: room.startsAt,
    })
    const payload: GameStartPayload = {
      config: room.engine.config,
      startsAt: room.startsAt,
      serverTime: now,
      state: room.engine.snapshot(),
    }
    this.transport.toRoom(room.code, "GAME_STARTING", payload)
    this.pushRoom(room, now)
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
    }
  }

  private snapshot(room: Room, now: number): RoomSnapshot {
    const rules = MODE_RULES[room.settings.mode]
    const players: LobbyPlayer[] = [...room.players.values()]
      .sort((a, b) => a.joinedAt - b.joinedAt)
      .map((p) => ({
        id: p.id,
        name: p.name,
        color: p.color,
        skinId: p.skinId,
        ready: p.id === room.hostId ? true : p.ready,
        isHost: p.id === room.hostId,
        connected: p.socketId !== null,
        joinedAt: p.joinedAt,
        uid: p.uid,
      }))
    return {
      code: room.code,
      status: room.status,
      hostId: room.hostId,
      settings: room.settings,
      isPublic: room.isPublic,
      autoStartAt: room.autoStartAt,
      minPlayers: rules.minPlayers,
      maxPlayers: rules.maxPlayers,
      players,
      serverTime: now,
    }
  }

  private pushRoom(room: Room, now: number): void {
    this.transport.toRoom(room.code, "ROOM_UPDATE", this.snapshot(room, now))
  }
}
