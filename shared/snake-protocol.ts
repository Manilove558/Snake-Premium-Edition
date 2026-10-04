// shared/snake-protocol.ts — the CONTRACT between server/ and hooks/useSnakeNetwork.ts.
//
// Pure types + constants + tiny validators. No imports, no Node, no DOM, no socket.io —
// so the exact same file is used by the Node server and by the browser bundle.
//
// Design in one paragraph
//   The server is AUTHORITATIVE: clients only send a direction (MOVE_INPUT). The server runs a
//   20 TPS simulation, moves snakes every STEP_TICKS ticks (3 x 50 ms = 150 ms, the same pace as
//   the existing Firebase battle), resolves collisions / food / power-ups / zone damage and sends
//   compact GAME_STATE_SYNC deltas. Clients interpolate between those deltas at 60 fps.

export const PROTOCOL_VERSION = 1

// ---------------------------------------------------------------------------
// Directions
// ---------------------------------------------------------------------------

export type Dir = "UP" | "DOWN" | "LEFT" | "RIGHT"

export const DIRS: readonly Dir[] = ["UP", "DOWN", "LEFT", "RIGHT"]

export const DIR_VECTOR: Readonly<Record<Dir, { dx: number; dy: number }>> = {
  UP: { dx: 0, dy: -1 },
  DOWN: { dx: 0, dy: 1 },
  LEFT: { dx: -1, dy: 0 },
  RIGHT: { dx: 1, dy: 0 },
}

export const OPPOSITE_DIR: Readonly<Record<Dir, Dir>> = { UP: "DOWN", DOWN: "UP", LEFT: "RIGHT", RIGHT: "LEFT" }

export const isDir = (v: unknown): v is Dir => typeof v === "string" && (DIRS as readonly string[]).includes(v)

/** Unit vector -> Dir (used when converting the old {dx,dy} steering to the network). */
export function dirFromVector(dx: number, dy: number): Dir | null {
  if (dx === 0 && dy === -1) return "UP"
  if (dx === 0 && dy === 1) return "DOWN"
  if (dx === -1 && dy === 0) return "LEFT"
  if (dx === 1 && dy === 0) return "RIGHT"
  return null
}

// ---------------------------------------------------------------------------
// Tunables (server rules; the client only reads them from GameConfig)
// ---------------------------------------------------------------------------

export const NET = {
  /** simulation ticks per second */
  TICK_RATE: 20,
  TICK_MS: 50,
  /** a snake advances one cell every STEP_TICKS ticks: 3 x 50 = 150 ms (= BATTLE_TICK_MS / BR_TICK_MS) */
  STEP_TICKS: 3,
  /** ... every FAST_STEP_TICKS ticks while the speed power-up is active (100 ms) */
  FAST_STEP_TICKS: 2,
  /** pre-match countdown */
  COUNTDOWN_MS: 3_000,
  /** how long a dropped player may be away before the snake is removed (turns into food) */
  RECONNECT_GRACE_MS: 15_000,
  /** a full (non-delta) snapshot is re-sent this often as a safety net */
  FULL_SYNC_EVERY_TICKS: 100,
  /** public ("Join Global") lobby auto-starts this long after it reaches the minimum player count */
  PUBLIC_AUTOSTART_MS: 30_000,
  /** a finished room is deleted after this long */
  ENDED_ROOM_TTL_MS: 5 * 60_000,
  /** hard cap for one match */
  MATCH_MAX_MS: 10 * 60_000,
  MAX_ROOMS: 500,

  ROOM_CODE_LENGTH: 6,
  MAX_NAME_LENGTH: 16,

  FOOD_SCORE: 1,
  /** same value as BATTLE_KILL_SCORE in lib/multiplayer.ts */
  KILL_SCORE: 2,
  CLASSIC_FOOD_TARGET: 3,
  CLASSIC_START_LENGTH: 3,

  /** chance that a spawned food is a power-up instead of a normal pellet */
  POWERUP_CHANCE: 0.08,
  SPEED_MS: 6_000,
  SHIELD_MS: 5_000,
} as const

export type GameMode = "classic" | "royale"

export const MODE_RULES: Readonly<Record<GameMode, { minPlayers: number; maxPlayers: number }>> = {
  classic: { minPlayers: 2, maxPlayers: 8 }, // BATTLE_MIN_PLAYERS / MAX_MP_PLAYERS
  royale: { minPlayers: 4, maxPlayers: 8 }, // BR_MIN_PLAYERS / BR_MAX_PLAYERS
}

/** Same palette (and order) as MP_PLAYER_COLORS in lib/multiplayer.ts. */
export const PLAYER_COLORS: readonly string[] = [
  "#3af08d",
  "#ff9f1a",
  "#4da6ff",
  "#ff5d7a",
  "#c77dff",
  "#ffe14d",
  "#4dd8ff",
  "#ff8a4d",
]

/** Same alphabet as lib/multiplayer.ts (no 0/O/1/I/L — easy to read out loud). */
export const ROOM_CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"

// ---------------------------------------------------------------------------
// Errors & acknowledgements
// ---------------------------------------------------------------------------

export type NetErrorCode =
  | "BAD_REQUEST"
  | "RATE_LIMITED"
  | "ROOM_NOT_FOUND"
  | "ROOM_FULL"
  | "ROOM_IN_PROGRESS"
  | "NOT_IN_ROOM"
  | "NOT_HOST"
  | "BAD_STATE"
  | "NOT_ENOUGH_PLAYERS"
  | "NOT_READY"
  | "BAD_SESSION"
  | "SERVER_BUSY"
  | "SESSION_REPLACED"
  | "INTERNAL"
  /** client-side only: the socket could not connect */
  | "CONNECT_ERROR"
  /** client-side only: the server did not answer in time */
  | "TIMEOUT"

export interface NetError {
  code: NetErrorCode
  message: string
}

/** Every request that has an acknowledgement answers with this. */
export type AckResult<T extends object = Record<never, never>> = ({ ok: true } & T) | ({ ok: false } & NetError)

// ---------------------------------------------------------------------------
// Lobby
// ---------------------------------------------------------------------------

export interface RoomSettings {
  mode: GameMode
  /** battle map id from lib/battle-maps.ts (classic mode only) */
  map: string
  /** snakes wrap around the edge instead of dying on the wall (classic only) */
  teleport: boolean
  /** snakes pass through each other (nobody dies from a snake-vs-snake collision) */
  avoidCollision: boolean
}

export const DEFAULT_ROOM_SETTINGS: Readonly<RoomSettings> = {
  mode: "classic",
  map: "classic",
  teleport: false,
  avoidCollision: false,
}

export type RoomStatus = "lobby" | "countdown" | "playing" | "ended"

/** What a player can edit about themselves in the lobby. */
export interface PlayerProfile {
  name: string
  /** one of PLAYER_COLORS; a taken colour is silently replaced by a free one */
  color?: string
  /** cosmetic skin id from the store (e.g. "skin_rainbow"); the server only relays it */
  skinId?: string
}

export interface LobbyPlayer {
  id: string
  name: string
  color: string
  skinId: string
  ready: boolean
  isHost: boolean
  /** false while the player is inside the reconnect grace period */
  connected: boolean
  joinedAt: number
}

export interface RoomSnapshot {
  code: string
  status: RoomStatus
  hostId: string
  settings: RoomSettings
  isPublic: boolean
  /** server time (ms) when a public lobby starts by itself; null = not scheduled */
  autoStartAt: number | null
  minPlayers: number
  maxPlayers: number
  players: LobbyPlayer[]
  /** server clock when this snapshot was made */
  serverTime: number
}

export interface JoinedInfo {
  code: string
  /** your id inside the room — keep it, it is part of your reconnect credentials */
  playerId: string
  /** secret reconnect token — keep it with playerId (sessionStorage), never show it to other players */
  token: string
  room: RoomSnapshot
}

// ---------------------------------------------------------------------------
// Game payloads
// ---------------------------------------------------------------------------

export interface Point {
  x: number
  y: number
}

/** Everything static about a match (sent once, with GAME_STARTING). */
export interface GameConfig {
  mode: GameMode
  cols: number
  rows: number
  tickRate: number
  /** ms between two moves of a normal snake (interpolation length) */
  stepMs: number
  /** ms between two moves while the speed power-up is active */
  fastStepMs: number
  teleport: boolean
  avoidCollision: boolean
  map: string
  walls: Point[]
  /** two-way portal pairs */
  portals: [Point, Point][]
  /** Battle Royale zone clock: the zone is derived from (seed, server time − startAt) with lib/br/zone.ts */
  zone: { seed: number; startAt: number } | null
}

export type FoodKind = "normal" | "speed" | "shield"

export interface FoodNet {
  id: number
  x: number
  y: number
  kind: FoodKind
}

export interface SnakeNet {
  id: string
  /** head first, flattened [x0, y0, x1, y1, ...] (half the JSON size of {x,y} objects). Empty when dead. */
  seg: number[]
  dir: Dir
  alive: boolean
  score: number
  kills: number
  /** absolute SERVER time (ms) when the speed power-up ends; 0 = inactive */
  speedUntil: number
  /** absolute SERVER time (ms) when the shield ends; 0 = inactive */
  shieldUntil: number
  /** ms between this snake's moves right now (use it as the interpolation length) */
  stepMs: number
  /** last MOVE_INPUT seq the server has processed for this snake (for client-side prediction / input pruning) */
  seq: number
}

/**
 * Delta (or full) state update. `full: true` replaces everything the client knows;
 * otherwise only the snakes that changed are listed and foods are patched with add/remove.
 * Sent over an ordered, reliable channel (WebSocket), so deltas never arrive out of order;
 * a full snapshot is re-sent every NET.FULL_SYNC_EVERY_TICKS ticks anyway.
 */
export interface GameStateSync {
  tick: number
  /** server time (ms) of the tick */
  t: number
  full: boolean
  snakes: SnakeNet[]
  foodAdd: FoodNet[]
  foodRemove: number[]
  aliveCount: number
}

export interface GameStartPayload {
  config: GameConfig
  /** server time (ms) when the first tick runs. In the past when you reconnect mid-match. */
  startsAt: number
  serverTime: number
  /** initial (or, after a reconnect, current) full snapshot */
  state: GameStateSync
}

export type DeathCause = "wall" | "self" | "kill" | "head_on" | "zone" | "disconnect"

export interface PlayerDiedEvent {
  id: string
  name: string
  cause: DeathCause
  killerId: string | null
  killerName: string | null
  /** 1 = winner. Players eliminated on the same tick share a placement (ties). */
  placement: number
  aliveCount: number
  t: number
}

/**
 * One row per participant. `placement`, `kills` and `peakMass` are exactly the inputs of
 * calculateMatchRankings() in lib/ranked.ts (peakMass = longest the snake ever was).
 */
export interface StandingRow {
  id: string
  name: string
  placement: number
  kills: number
  score: number
  peakMass: number
  survivedMs: number
  /** true = left / dropped out: ranked systems should treat this player as last place */
  disconnected: boolean
}

export interface GameOverPayload {
  winnerId: string | null
  reason: "last_alive" | "timeout"
  durationMs: number
  standings: StandingRow[]
}

// ---------------------------------------------------------------------------
// Socket events
// ---------------------------------------------------------------------------

export interface CreateRoomPayload extends PlayerProfile {
  settings?: Partial<RoomSettings>
  /** true = listed for QUICK_MATCH ("Join Global") */
  isPublic?: boolean
}

export interface JoinRoomPayload extends PlayerProfile {
  code: string
}

export interface QuickMatchPayload extends PlayerProfile {
  mode?: GameMode
}

export interface ReconnectPayload {
  code: string
  playerId: string
  token: string
}

export interface MoveInputPayload {
  dir: Dir
  /** strictly increasing per client; the server echoes the last one it processed in SnakeNet.seq */
  seq: number
}

/** client -> server. Requests with a reply take an acknowledgement callback as last argument. */
export interface ClientToServerEvents {
  CREATE_ROOM: (p: CreateRoomPayload, ack: (r: AckResult<JoinedInfo>) => void) => void
  JOIN_ROOM: (p: JoinRoomPayload, ack: (r: AckResult<JoinedInfo>) => void) => void
  QUICK_MATCH: (p: QuickMatchPayload, ack: (r: AckResult<JoinedInfo>) => void) => void
  RECONNECT_ROOM: (p: ReconnectPayload, ack: (r: AckResult<JoinedInfo>) => void) => void
  LEAVE_ROOM: (ack: (r: AckResult) => void) => void
  SET_READY: (p: { ready: boolean }, ack: (r: AckResult) => void) => void
  UPDATE_PROFILE: (p: Partial<PlayerProfile>, ack: (r: AckResult) => void) => void
  UPDATE_SETTINGS: (p: Partial<RoomSettings>, ack: (r: AckResult) => void) => void
  START_GAME: (ack: (r: AckResult) => void) => void
  /** host only, after GAME_OVER: back to the lobby for a rematch */
  RESET_ROOM: (ack: (r: AckResult) => void) => void
  /** fire-and-forget, no ack (hot path) */
  MOVE_INPUT: (p: MoveInputPayload) => void
  /** latency probe: the server answers with its clock (ms) */
  PING: (clientTs: number, ack: (serverTs: number) => void) => void
}

/** server -> client */
export interface ServerToClientEvents {
  ROOM_UPDATE: (s: RoomSnapshot) => void
  GAME_STARTING: (p: GameStartPayload) => void
  GAME_STATE_SYNC: (s: GameStateSync) => void
  PLAYER_DIED: (e: PlayerDiedEvent) => void
  GAME_OVER: (r: GameOverPayload) => void
  /** e.g. SESSION_REPLACED when the same account reconnects from another tab */
  NET_NOTICE: (e: NetError) => void
}

export type S2CEvent = keyof ServerToClientEvents
export type S2CPayload<E extends S2CEvent> = Parameters<ServerToClientEvents[E]>[0]

// ---------------------------------------------------------------------------
// Validators / sanitisers (the server treats EVERY payload as hostile)
// ---------------------------------------------------------------------------

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)

/** Trim, drop control characters and < >, collapse spaces, cap the length. Never returns an empty name. */
export function sanitizeName(v: unknown, fallback = "Player"): string {
  if (typeof v !== "string") return fallback
  const s = v
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, NET.MAX_NAME_LENGTH)
  return s.length > 0 ? s : fallback
}

export const sanitizeSkinId = (v: unknown): string => (typeof v === "string" && /^[a-zA-Z0-9_-]{1,32}$/.test(v) ? v : "default")

export const isPlayerColor = (v: unknown): v is string => typeof v === "string" && PLAYER_COLORS.includes(v)

/** "ab-c12 3" -> "ABC123" (same rules as normalizeRoomCode in lib/multiplayer.ts). */
export const normalizeRoomCode = (raw: unknown): string =>
  typeof raw === "string" ? raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, NET.ROOM_CODE_LENGTH) : ""

export const isRoomCode = (code: string): boolean => code.length === NET.ROOM_CODE_LENGTH && [...code].every((c) => ROOM_CODE_CHARS.includes(c))

export const asObject = (v: unknown): Record<string, unknown> => (isObj(v) ? v : {})

export const isGameMode = (v: unknown): v is GameMode => v === "classic" || v === "royale"
