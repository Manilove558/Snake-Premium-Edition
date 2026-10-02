"use client"

import {
  ref,
  set,
  get,
  update,
  remove,
  onValue,
  onDisconnect,
  serverTimestamp,
} from "firebase/database"
import { getFirebaseDb } from "./firebase"
import { BATTLE_MAPS, getBattleMap, blockedCellKeys } from "./battle-maps"
import { startBattleRoyale } from "./br/net"
import { isBotDifficulty, pickBotName, type BotDifficulty } from "./bot-ai"

// ---------------------------------------------------------------------------
// Multiplayer rooms (Phase 1: lobby — create / join / live player list)
// Realtime Database layout:
//   rooms/{CODE} = {
//     status: "lobby" | "starting" | "playing" | "ended",
//     hostId: string,
//     createdAt: number,
//     players: { [playerId]: { id, name, color, joinedAt, alive, score } }
//   }
// ---------------------------------------------------------------------------

export interface MpPlayer {
  id: string
  name: string
  color: string
  joinedAt: number
  alive: boolean
  score: number
  /** account id of a signed-in player (lets others send a friend request); null for guests */
  uid?: string | null
  /** VIP Pass holder — shown with a crown next to the name */
  vip?: boolean
  /** Battle Royale stats */
  kills?: number
  /** server time (ms) when this player was eliminated (Battle Royale) */
  diedAt?: number | null
  /** true for AI bots (simulated by the host, see hooks/use-bot-host.ts) */
  isBot?: boolean
  /** bot brain difficulty (only meaningful when isBot is true) */
  botDifficulty?: BotDifficulty
}

/** Game mode picked by the host in Room Settings. */
export type MpMode = "classic" | "royale"

/** Host-controlled room settings (stored at rooms/{CODE}/settings). */
export interface MpSettings {
  /** "classic" = 20x20 arena (default), "royale" = Snake Battle Royale (120x120, shrinking zone, 4-8 players) */
  mode: MpMode
  /** battle map id, see lib/battle-maps.ts */
  map: string
  /** true: snakes wrap around the edges instead of dying on the wall */
  teleport: boolean
  /** show grid lines in the arena */
  grid: boolean
  /** true: snakes pass through each other, nobody is eliminated by a collision */
  avoidCollision: boolean
  /** true (default): empty slots are auto-filled with AI bots when the battle starts */
  fillBots: boolean
  /** difficulty of auto-filled / manually added bots */
  botDifficulty: BotDifficulty
}

export const DEFAULT_MP_SETTINGS: MpSettings = {
  mode: "classic",
  map: "classic",
  teleport: false,
  grid: true,
  avoidCollision: false,
  fillBots: true,
  botDifficulty: "medium",
}

/** Room settings with defaults filled in (older rooms have none). */
export function getRoomSettings(room?: { settings?: Partial<MpSettings> | null; isRanked?: boolean } | null): MpSettings {
  const s = room?.settings ?? {}
  return {
    // Ranked rooms are always classic
    mode: !room?.isRanked && s.mode === "royale" ? "royale" : "classic",
    map: BATTLE_MAPS.some((m) => m.id === s.map) ? (s.map as string) : DEFAULT_MP_SETTINGS.map,
    teleport: typeof s.teleport === "boolean" ? s.teleport : DEFAULT_MP_SETTINGS.teleport,
    grid: typeof s.grid === "boolean" ? s.grid : DEFAULT_MP_SETTINGS.grid,
    avoidCollision: typeof s.avoidCollision === "boolean" ? s.avoidCollision : DEFAULT_MP_SETTINGS.avoidCollision,
    fillBots: typeof s.fillBots === "boolean" ? s.fillBots : DEFAULT_MP_SETTINGS.fillBots,
    botDifficulty: isBotDifficulty(s.botDifficulty) ? s.botDifficulty : DEFAULT_MP_SETTINGS.botDifficulty,
  }
}

export interface MpRoom {
  code: string
  status: "lobby" | "countdown" | "playing" | "ended"
  hostId: string
  createdAt: number
  /** true for rooms created via "Join Global" (matchmaking with strangers) */
  isPublic?: boolean
  /** true for Ranked Rooms (Elo is updated when the battle ends, see lib/ranked.ts) */
  isRanked?: boolean
  /** server-time (ms) when a global room auto-starts its battle */
  autoStartAt?: number | null
  settings?: Partial<MpSettings> | null
  players: Record<string, MpPlayer>
  game?: {
    countdownEndsAt?: number
    food?: { x: number; y: number } | null
    winner?: string | null
    killFeed?: Record<string, KillEntry> | null
    /** Battle Royale: zone clock (seed + server start time), see lib/br/zone.ts */
    zone?: { seed: number; startAt: number } | null
    /** Battle Royale: player ids in spawn-seat order (fixed at match start) */
    order?: string[] | null
    /** Battle Royale: many foods instead of one */
    foods?: Record<string, { x: number; y: number }> | null
    /** Battle Royale: server time (ms) when the last snake won */
    endedAt?: number | null
  } | null
}

export const MP_PLAYER_COLORS = [
  "#3af08d", // green
  "#ff9f1a", // orange
  "#4da6ff", // blue
  "#ff5d7a", // pink
  "#c77dff", // purple
  "#ffe14d", // yellow
  "#4dd8ff", // cyan
  "#ff8a4d", // coral
]

export const MAX_MP_PLAYERS = 8

// Room codes avoid confusing chars (no 0/O, 1/I/L)
const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"

export function generateRoomCode(): string {
  let code = ""
  for (let i = 0; i < 6; i++) {
    code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]
  }
  return code
}

export function generatePlayerId(): string {
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`
}

export function normalizeRoomCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6)
}

function roomRef(code: string) {
  return ref(getFirebaseDb(), `rooms/${code}`)
}

function publicRef(code?: string) {
  return ref(getFirebaseDb(), code ? `publicLobby/${code}` : "publicLobby")
}

function playerRef(code: string, playerId: string) {
  return ref(getFirebaseDb(), `rooms/${code}/players/${playerId}`)
}

/** Create a room and join as host. Retries the code on (very rare) collision. */
export async function createRoom(
  playerName: string,
  isPublic = false,
  uid: string | null = null,
  vip = false,
  isRanked = false,
): Promise<{ code: string; playerId: string }> {
  const name = playerName.trim().slice(0, 16) || "Player"
  const playerId = generatePlayerId()
  if (isRanked && !uid) throw new Error("Sign in with Google to create a ranked room")

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateRoomCode()
    const snap = await get(roomRef(code))
    if (snap.exists()) continue

    const player: MpPlayer = {
      id: playerId,
      name,
      color: MP_PLAYER_COLORS[0],
      joinedAt: serverTimestamp() as unknown as number,
      alive: true,
      score: 0,
      uid,
      vip,
    }
    await set(roomRef(code), {
      status: "lobby",
      hostId: playerId,
      createdAt: serverTimestamp(),
      isPublic,
      ...(isRanked ? { isRanked: true } : {}),
      // Ranked rules are fixed: teleport + no snake collision are always ON, the host can't change them
      ...(isRanked ? { settings: { teleport: true, avoidCollision: true } } : {}),
      players: { [playerId]: player },
    })
    // Global rooms are listed in a small index so other players can find them
    if (isPublic) await set(publicRef(code), { createdAt: serverTimestamp() })
    // Auto-remove the player if the app closes / loses connection abruptly
    await onDisconnect(playerRef(code, playerId)).remove()
    return { code, playerId }
  }
  throw new Error("Could not create a room, please try again")
}

export type JoinResult =
  | { playerId: string }
  | { error: "ROOM_NOT_FOUND" | "GAME_IN_PROGRESS" | "ROOM_FULL" | "NOT_RANKED" | "SIGN_IN_REQUIRED" }

/** Join an existing lobby-room. */
export async function joinRoom(
  rawCode: string,
  playerName: string,
  uid: string | null = null,
  vip = false,
  /** true when joining through "Join Ranked Room": the room must be a ranked room */
  expectRanked = false,
): Promise<JoinResult> {
  const code = normalizeRoomCode(rawCode)
  const name = playerName.trim().slice(0, 16) || "Player"
  const snap = await get(roomRef(code))
  if (!snap.exists()) return { error: "ROOM_NOT_FOUND" }

  const room = snap.val() as Omit<MpRoom, "code">
  if (expectRanked && !room.isRanked) return { error: "NOT_RANKED" }
  // Ranked rooms are for signed-in players only (guests could never earn Elo anyway)
  if (room.isRanked && !uid) return { error: "SIGN_IN_REQUIRED" }
  if (room.status !== "lobby") return { error: "GAME_IN_PROGRESS" }
  const existing = Object.values(room.players ?? {}) as MpPlayer[]
  if (existing.length >= MAX_MP_PLAYERS) return { error: "ROOM_FULL" }

  const playerId = generatePlayerId()
  // First colour nobody in the room is using (so a re-joining player never
  // duplicates someone else's colour)
  const usedColors = new Set(existing.map((p) => p.color))
  const freeColor = MP_PLAYER_COLORS.find((c) => !usedColors.has(c))
  const player: MpPlayer = {
    id: playerId,
    name,
    color: freeColor ?? MP_PLAYER_COLORS[existing.length % MP_PLAYER_COLORS.length],
    joinedAt: serverTimestamp() as unknown as number,
    alive: true,
    score: 0,
    uid,
    vip,
  }
  await set(playerRef(code, playerId), player)
  await onDisconnect(playerRef(code, playerId)).remove()
  return { playerId }
}

/** Leave a room. Deletes the room when no human remains, promotes the oldest human when the host leaves. */
export async function leaveRoom(code: string, playerId: string): Promise<void> {
  const rRef = roomRef(code)
  const snap = await get(rRef)
  if (!snap.exists()) return
  const room = snap.val() as Omit<MpRoom, "code">

  await remove(playerRef(code, playerId))

  const remaining = (Object.values(room.players ?? {}) as MpPlayer[]).filter((p) => p.id !== playerId)
  const humansLeft = remaining.filter((p) => !p.isBot)
  if (humansLeft.length === 0) {
    // Nobody real left (bots alone are not a room) -> delete everything
    await remove(rRef)
    await remove(publicRef(code)).catch(() => {})
    return
  }
  if (room.hostId === playerId) {
    // A bot can never be host (no client simulates it) -> promote the oldest HUMAN
    humansLeft.sort((a, b) => (a.joinedAt ?? 0) - (b.joinedAt ?? 0))
    await update(rRef, { hostId: humansLeft[0].id })
  }
}

/** Live-subscribe to a room. Callback gets null when the room is deleted. */
export function subscribeToRoom(code: string, cb: (room: MpRoom | null) => void): () => void {
  const rRef = roomRef(code)
  return onValue(
    rRef,
    (snap) => {
      if (!snap.exists()) {
        cb(null)
        return
      }
      cb({ code, ...(snap.val() as Omit<MpRoom, "code">) })
    },
    () => cb(null),
  )
}

// ---------------------------------------------------------------------------
// Phase 2: battle — shared arena, real-time snake sync, kills, food
// Sync model: every client owns its snake and broadcasts it each tick to
//   rooms/{CODE}/snakes/{playerId} = { seg: [{x,y}...], dx, dy, ts }
// Collisions are detected locally by each client against all fresh snakes.
// Food: whoever eats it spawns the replacement (last-write-wins, fine for friends).
// Kills: victim's client writes the kill-feed entry + credits the killer.
// ---------------------------------------------------------------------------

export interface MpSnakeState {
  seg: { x: number; y: number }[]
  dx: number
  dy: number
  ts: number
}

export interface KillEntry {
  killerId: string | null
  killerName: string
  victimId: string
  victimName: string
  cause: "kill" | "wall" | "self" | "zone"
  ts: number
}

export const BATTLE_MIN_PLAYERS = 2
export const BATTLE_TICK_MS = 150
export const BATTLE_KILL_SCORE = 2
export const BATTLE_SNAKE_STALE_MS = 2500

// 8 spread-out spawn points (head cell + initial direction)
export const BATTLE_SPAWNS = [
  { x: 3, y: 3, dx: 1, dy: 0 },
  { x: 16, y: 3, dx: -1, dy: 0 },
  { x: 3, y: 16, dx: 1, dy: 0 },
  { x: 16, y: 16, dx: -1, dy: 0 },
  { x: 9, y: 2, dx: 0, dy: 1 },
  { x: 10, y: 17, dx: 0, dy: -1 },
  { x: 2, y: 10, dx: 1, dy: 0 },
  { x: 17, y: 9, dx: -1, dy: 0 },
]

export function snakesRef(code: string) {
  return ref(getFirebaseDb(), `rooms/${code}/snakes`)
}

export function mySnakeRef(code: string, playerId: string) {
  return ref(getFirebaseDb(), `rooms/${code}/snakes/${playerId}`)
}

export function foodRef(code: string) {
  return ref(getFirebaseDb(), `rooms/${code}/game/food`)
}

export function killFeedRef(code: string) {
  return ref(getFirebaseDb(), `rooms/${code}/game/killFeed`)
}

/** First food: a random free cell near the middle (never on a wall / portal). */
function pickStartFood(mapId: string): { x: number; y: number } {
  const blocked = blockedCellKeys(getBattleMap(mapId))
  const free: { x: number; y: number }[] = []
  for (let x = 5; x <= 14; x++) for (let y = 5; y <= 14; y++) if (!blocked.has(`${x},${y}`)) free.push({ x, y })
  return free.length > 0 ? free[Math.floor(Math.random() * free.length)] : { x: 10, y: 10 }
}

/** Host changes one or more room settings (only lobby). */
export async function updateRoomSettings(code: string, patch: Partial<MpSettings>): Promise<void> {
  const updates: Record<string, unknown> = {}
  if (patch.mode !== undefined && (patch.mode === "classic" || patch.mode === "royale")) updates["settings/mode"] = patch.mode
  if (patch.map !== undefined && BATTLE_MAPS.some((m) => m.id === patch.map)) updates["settings/map"] = patch.map
  if (patch.teleport !== undefined) updates["settings/teleport"] = !!patch.teleport
  if (patch.grid !== undefined) updates["settings/grid"] = !!patch.grid
  if (patch.avoidCollision !== undefined) updates["settings/avoidCollision"] = !!patch.avoidCollision
  if (patch.fillBots !== undefined) updates["settings/fillBots"] = !!patch.fillBots
  if (patch.botDifficulty !== undefined && isBotDifficulty(patch.botDifficulty)) updates["settings/botDifficulty"] = patch.botDifficulty
  if (Object.keys(updates).length === 0) return
  await update(roomRef(code), updates)
}

// ---------------------------------------------------------------------------
// AI bots — the host simulates them (hooks/use-bot-host.ts) and broadcasts
// their snakes like any player, so no client needs a special protocol.
// Bots are stored as players with isBot: true and count toward head counts.
// ---------------------------------------------------------------------------

export const BOT_ID_PREFIX = "bot_"
/** at least one seat stays for a human */
export const MAX_BOTS_PER_ROOM = MAX_MP_PLAYERS - 1

export function generateBotId(): string {
  return `${BOT_ID_PREFIX}${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

/** Host adds one AI bot to the lobby (ranked rooms never get bots). */
export async function addBot(code: string, difficulty: BotDifficulty = "medium"): Promise<string> {
  const snap = await get(roomRef(code))
  if (!snap.exists()) throw new Error("Room not found")
  const room = snap.val() as Omit<MpRoom, "code">
  if (room.isRanked) throw new Error("Bots can't join ranked rooms")
  const players = Object.values(room.players ?? {}) as MpPlayer[]
  if (players.length >= MAX_MP_PLAYERS) throw new Error("Room is full")
  const botCount = players.filter((p) => p.isBot).length
  if (botCount >= MAX_BOTS_PER_ROOM) throw new Error("Bot limit reached")

  const usedColors = new Set(players.map((p) => p.color))
  const color = MP_PLAYER_COLORS.find((c) => !usedColors.has(c)) ?? MP_PLAYER_COLORS[botCount % MP_PLAYER_COLORS.length]
  const name = pickBotName(new Set(players.map((p) => p.name)), botCount)
  const id = generateBotId()
  const bot: MpPlayer = {
    id,
    name,
    color,
    joinedAt: Date.now(),
    alive: true,
    score: 0,
    uid: null,
    isBot: true,
    botDifficulty: difficulty,
  }
  await set(playerRef(code, id), bot)
  return id
}

/** Host removes one AI bot (also wipes its live snake, if any). */
export async function removeBot(code: string, botId: string): Promise<void> {
  if (!botId.startsWith(BOT_ID_PREFIX)) throw new Error("Not a bot")
  await remove(playerRef(code, botId)).catch(() => {})
  await remove(ref(getFirebaseDb(), `rooms/${code}/snakes/${botId}`)).catch(() => {})
}

/** UI label for a player — AI bots get a [BOT] marker in lobbies, leaderboards, kill feeds and winner banners. */
export function playerDisplayName(
  p: Pick<MpPlayer, "name" | "isBot"> | null | undefined,
  fallback = "Player",
): string {
  const name = p?.name?.trim() ? p.name : fallback
  return p?.isBot ? `${name} [BOT]` : name
}

/**
 * Fill every empty slot with an AI bot. Called by the host right before the
 * battle starts (both classic and Battle Royale). Returns how many bots were added.
 * No-op when the room is ranked, the setting is off, or no human is in the room.
 */
export async function autoFillBots(code: string, room: Omit<MpRoom, "code">): Promise<number> {
  const settings = getRoomSettings(room)
  if (room.isRanked || !settings.fillBots) return 0
  const before = Object.values(room.players ?? {}) as MpPlayer[]
  const realCount = before.filter((p) => !p.isBot).length
  if (realCount === 0) return 0 // never start a bots-only room
  let added = 0
  for (let i = before.length; i < MAX_MP_PLAYERS; i++) {
    try {
      await addBot(code, settings.botDifficulty)
      added++
    } catch {
      break
    }
  }
  return added
}

/** Host starts the battle: reset players, set shared countdown, clear snakes. */
export async function startBattle(code: string): Promise<void> {
  const rRef = roomRef(code)
  const snap = await get(rRef)
  if (!snap.exists()) throw new Error("Room not found")
  const room = snap.val() as Omit<MpRoom, "code">
  // Fill empty slots with AI bots BEFORE the head-count check (ranked rooms never get bots)
  await autoFillBots(code, room)
  const fresh = (await get(rRef)).val() as Omit<MpRoom, "code">
  const players = Object.values(fresh.players ?? {}) as MpPlayer[]
  // Battle Royale has its own start (zone clock, many foods, 4-8 players)
  if (!room.isRanked && getRoomSettings(room).mode === "royale") return startBattleRoyale(code, fresh)
  if (players.length < BATTLE_MIN_PLAYERS) throw new Error(`Need at least ${BATTLE_MIN_PLAYERS} players to start`)

  // Ranked rooms: the arena is drawn at random for EVERY match (nobody picks the map)
  const mapId = room.isRanked
    ? BATTLE_MAPS[Math.floor(Math.random() * BATTLE_MAPS.length)].id
    : getRoomSettings(room).map

  const updates: Record<string, unknown> = {
    status: "countdown",
    "game/countdownEndsAt": Date.now() + 3000,
    ...(room.isRanked ? { "settings/map": mapId } : {}),
    "game/food": pickStartFood(mapId),
    "game/winner": null,
    "game/killFeed": null,
    autoStartAt: null,
    snakes: null,
  }
  for (const p of players) {
    updates[`players/${p.id}/alive`] = true
    updates[`players/${p.id}/score`] = 0
  }
  await update(rRef, updates)
  // Game started -> nobody new can join through Global matchmaking
  await remove(publicRef(code)).catch(() => {})
}

/** Host sends everyone back to the lobby for a rematch. */
export async function resetRoomForRematch(code: string): Promise<void> {
  const rRef = roomRef(code)
  const snap = await get(rRef)
  if (!snap.exists()) return
  const room = snap.val() as Omit<MpRoom, "code">
  const players = Object.values(room.players ?? {}) as MpPlayer[]
  const updates: Record<string, unknown> = {
    status: "lobby",
    game: null,
    snakes: null,
    isPublic: false,
    autoStartAt: null,
  }
  for (const p of players) {
    updates[`players/${p.id}/alive`] = true
    updates[`players/${p.id}/score`] = 0
    updates[`players/${p.id}/kills`] = 0
    updates[`players/${p.id}/diedAt`] = null
  }
  await update(rRef, updates)
}

// ---------------------------------------------------------------------------
// Global matchmaking ("Join Global"): play with random players online.
// Index node publicLobby/{CODE} = { createdAt } lists rooms open to strangers.
// ---------------------------------------------------------------------------

export const GLOBAL_AUTOSTART_MS = 30000

/**
 * Oldest global room that is still in the lobby, has a live host and free slots.
 * Casual and ranked global matchmaking never mix: `ranked` picks which kind of room to look for.
 */
async function findOpenPublicRoom(ranked = false): Promise<string | null> {
  const snap = await get(publicRef())
  if (!snap.exists()) return null
  const entries = Object.entries(snap.val() as Record<string, { createdAt?: number }>)
  entries.sort((a, b) => (a[1]?.createdAt ?? 0) - (b[1]?.createdAt ?? 0) || a[0].localeCompare(b[0]))

  for (const [code] of entries) {
    const rs = await get(roomRef(code))
    if (!rs.exists()) {
      await remove(publicRef(code)).catch(() => {})
      continue
    }
    const room = rs.val() as Omit<MpRoom, "code">
    const players = Object.values(room.players ?? {}) as MpPlayer[]
    if (players.length === 0) {
      // Abandoned room shell -> clean it up
      await remove(roomRef(code)).catch(() => {})
      await remove(publicRef(code)).catch(() => {})
      continue
    }
    if (room.status !== "lobby") {
      await remove(publicRef(code)).catch(() => {})
      continue
    }
    if (!room.isPublic || !players.some((p) => p.id === room.hostId)) continue
    if (!!room.isRanked !== ranked) continue
    if (players.length >= MAX_MP_PLAYERS) continue
    return code
  }
  return null
}

/**
 * Join a random global lobby. If nobody is waiting, open a new global room and wait
 * for others. When two players click at the same moment, the older room always wins,
 * so both end up in the same room.
 */
export async function joinGlobal(
  playerName: string,
  uid: string | null = null,
  vip = false,
  /** true = "Join Global" inside the Ranked tab: only ranked global rooms, Google sign-in required */
  ranked = false,
): Promise<{ code: string; playerId: string }> {
  if (ranked && !uid) throw new Error("Sign in with Google to play ranked")
  for (let attempt = 0; attempt < 3; attempt++) {
    const open = await findOpenPublicRoom(ranked)
    if (open) {
      const res = await joinRoom(open, playerName, uid, vip, ranked)
      if (!("error" in res)) return { code: open, playerId: res.playerId }
      continue // room filled / started meanwhile -> look again
    }

    const mine = await createRoom(playerName, true, uid, vip, ranked)
    const winner = await findOpenPublicRoom(ranked)
    if (winner && winner !== mine.code) {
      // Someone else opened an older global room -> merge into it
      await leaveRoom(mine.code, mine.playerId)
      const res = await joinRoom(winner, playerName, uid, vip, ranked)
      if (!("error" in res)) return { code: winner, playerId: res.playerId }
      continue
    }
    return mine
  }
  return createRoom(playerName, true, uid, vip, ranked)
}

/** Set (or clear with null) the shared auto-start time of a global room. */
export async function setAutoStartAt(code: string, at: number | null): Promise<void> {
  await update(roomRef(code), { autoStartAt: at })
}

/** If the host vanished (closed the app), the oldest remaining player takes over. */
export async function claimHost(code: string, playerId: string): Promise<void> {
  await update(roomRef(code), { hostId: playerId })
}

/** Difference between the server clock and this device's clock (ms). */
export function subscribeServerOffset(cb: (offset: number) => void): () => void {
  return onValue(ref(getFirebaseDb(), ".info/serverTimeOffset"), (snap) => cb(Number(snap.val()) || 0))
}
