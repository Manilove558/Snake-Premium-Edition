// lib/multiplayer.ts — shared TYPES + small pure helpers for the multiplayer screens.
//
// v23 (Socket-Only Migration): there is NO Firebase code in this file any more. Rooms, lobby, matchmaking and the
// match itself all live on the Socket.io game server (see hooks/useSnakeNetwork.ts + server/). The UI components still
// speak the classic `MpRoom` / `MpPlayer` shapes (so the look of the lobby and the battle screens stays exactly the
// same) — lib/net-adapter.ts converts the live Socket.io state into those shapes.
import { BATTLE_MAPS } from "./battle-maps"
import { DEFAULT_BOT_LEVEL, isBotId, isBotLevel, type BotLevel } from "./bot-ai"
import { BOT_FILL_TARGET as PROTOCOL_BOT_FILL_TARGET, botFillCount as protocolBotFillCount } from "@/shared/snake-protocol"

export interface MpPlayer {
  id: string
  name: string
  color: string
  joinedAt: number
  alive: boolean
  score: number
  /** verified account id of a signed-in player (lets others send a friend request); null for guests */
  uid?: string | null
  /** VIP Pass holder — shown with a crown next to the name */
  vip?: boolean
  /** Battle Royale stats */
  kills?: number
  /** server time (ms) when this player was eliminated */
  diedAt?: number | null
  /** true for AI bots (driven by the SERVER) — shown with a [BOT] tag */
  bot?: boolean
  /** difficulty of this bot */
  botLevel?: BotLevel
}

/** Game mode picked by the host in Room Settings. */
export type MpMode = "classic" | "royale"

/** Host-controlled room settings. */
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
  /** true: empty slots are filled with server-side AI bots when the battle starts (never in ranked rooms) */
  bots: boolean
  /** difficulty of the auto-filled bots */
  botLevel: BotLevel
}

export const DEFAULT_MP_SETTINGS: MpSettings = {
  mode: "classic",
  map: "classic",
  teleport: false,
  grid: true,
  avoidCollision: false,
  bots: true,
  botLevel: DEFAULT_BOT_LEVEL,
}

/** Room settings with defaults filled in. */
export function getRoomSettings(room?: { settings?: Partial<MpSettings> | null; isRanked?: boolean } | null): MpSettings {
  const s = room?.settings ?? {}
  return {
    // Ranked rooms are always classic
    mode: !room?.isRanked && s.mode === "royale" ? "royale" : "classic",
    map: BATTLE_MAPS.some((m) => m.id === s.map) ? (s.map as string) : DEFAULT_MP_SETTINGS.map,
    teleport: typeof s.teleport === "boolean" ? s.teleport : DEFAULT_MP_SETTINGS.teleport,
    grid: typeof s.grid === "boolean" ? s.grid : DEFAULT_MP_SETTINGS.grid,
    avoidCollision: typeof s.avoidCollision === "boolean" ? s.avoidCollision : DEFAULT_MP_SETTINGS.avoidCollision,
    // Ranked is human-only: bots are always off there
    bots: !room?.isRanked && (typeof s.bots === "boolean" ? s.bots : DEFAULT_MP_SETTINGS.bots),
    botLevel: isBotLevel(s.botLevel) ? s.botLevel : DEFAULT_MP_SETTINGS.botLevel,
  }
}

export interface MpRoom {
  code: string
  status: "lobby" | "countdown" | "playing" | "ended"
  hostId: string
  createdAt: number
  /** true for rooms created via "Join Global" (matchmaking with strangers) */
  isPublic?: boolean
  /** true for Ranked Rooms: ALL-OR-NOTHING, the server settles RP/MMR when the match ends */
  isRanked?: boolean
  /** server-time (ms) when a global room auto-starts its battle */
  autoStartAt?: number | null
  settings?: Partial<MpSettings> | null
  players: Record<string, MpPlayer>
  game?: {
    winner?: string | null
    /** Battle Royale: zone clock (seed + server start time), see lib/br/zone.ts */
    zone?: { seed: number; startAt: number } | null
    /** server time (ms) when the match ended */
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

/** Auto-fill target (humans + bots) when the battle starts. Classic = a lively 4, Battle Royale = a full 8. */
export const BOT_FILL_TARGET: Record<MpMode, number> = { ...PROTOCOL_BOT_FILL_TARGET }

export const isBotPlayer = (p: { id: string; bot?: boolean }): boolean => !!p.bot || isBotId(p.id)

/** How many bots would join if the battle started now with `humans` real players. */
export const botFillCount = (mode: MpMode, humans: number): number => protocolBotFillCount(mode, humans)

export interface KillEntry {
  killerId: string | null
  killerName: string
  victimId: string
  victimName: string
  cause: "kill" | "wall" | "self" | "zone" | "disconnect"
  ts: number
}

export const BATTLE_MIN_PLAYERS = 2
/** Public (global) lobbies start by themselves this long after the minimum is reached — the SERVER runs the timer. */
export const GLOBAL_AUTOSTART_MS = 30000

export function normalizeRoomCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6)
}
