// lib/net-adapter.ts — turns the live Socket.io state (hooks/useSnakeNetwork.ts) into the classic `MpRoom` shape the
// lobby / battle screens were built around. Pure: no React, no sockets, no Firebase.
//
// This is what keeps the multiplayer UI looking exactly like the old Firebase version while every byte of gameplay now
// comes from the authoritative server.
import type { MpPlayer, MpRoom } from "./multiplayer"
import type { GameConfig, GameOverPayload, PlayerDiedEvent, RoomSnapshot } from "@/shared/snake-protocol"
import type { SnakeView } from "@/shared/sync-reducer"

export interface NetLike {
  room: RoomSnapshot | null
  gameState: { snakes: SnakeView[] } | null
  killFeed: PlayerDiedEvent[]
  result: GameOverPayload | null
  config: GameConfig | null
  startsAt: number | null
}

export function toMpRoom(net: NetLike): MpRoom | null {
  const r = net.room
  if (!r) return null
  const inMatch = r.status === "countdown" || r.status === "playing" || r.status === "ended"
  const snakes = new Map((net.gameState?.snakes ?? []).map((s) => [s.id, s]))
  const diedAt = new Map<string, number>()
  for (const e of net.killFeed) if (!diedAt.has(e.id)) diedAt.set(e.id, e.t) // newest first -> keep the latest entry per player
  const players: Record<string, MpPlayer> = {}
  for (const p of r.players) {
    const s = snakes.get(p.id)
    players[p.id] = {
      id: p.id,
      name: p.name,
      color: p.color,
      joinedAt: p.joinedAt,
      uid: p.uid,
      vip: p.vip,
      bot: p.bot,
      botLevel: p.botLevel ?? undefined,
      // outside a match everybody is "alive"; inside, a player without a living snake is out
      alive: inMatch ? !!s?.alive : true,
      score: s?.score ?? 0,
      kills: s?.kills ?? 0,
      diedAt: diedAt.get(p.id) ?? null,
    }
  }
  const zone = net.config?.zone ?? null
  const endedAt = net.result && net.startsAt !== null ? net.startsAt + net.result.durationMs : null
  return {
    code: r.code,
    status: r.status,
    hostId: r.hostId,
    createdAt: 0,
    isPublic: r.isPublic,
    isRanked: r.settings.ranked,
    autoStartAt: r.autoStartAt,
    settings: {
      mode: r.settings.mode,
      map: r.settings.map,
      teleport: r.settings.teleport,
      grid: r.settings.grid,
      avoidCollision: r.settings.avoidCollision,
      bots: r.settings.bots,
      botLevel: r.settings.botLevel,
    },
    players,
    game: inMatch ? { winner: net.result?.winnerId ?? null, zone, endedAt } : null,
  }
}

/** One kill-feed line, in the wording of the classic screens. */
export function killLine(e: PlayerDiedEvent, isBot: (id: string | null) => boolean): string {
  const tag = (id: string | null, name: string) => (isBot(id) ? `${name} [BOT]` : name)
  switch (e.cause) {
    case "kill":
    case "head_on":
      return e.killerName ? `${tag(e.killerId, e.killerName)} eliminated ${tag(e.id, e.name)}` : `${tag(e.id, e.name)} crashed head-on`
    case "zone":
      return `${tag(e.id, e.name)} was caught by the zone`
    case "wall":
      return `${tag(e.id, e.name)} hit the wall`
    case "disconnect":
      return `${tag(e.id, e.name)} left the match`
    default:
      return `${tag(e.id, e.name)} crashed into themselves`
  }
}
