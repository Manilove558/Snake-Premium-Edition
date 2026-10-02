"use client"

// hooks/use-bot-host.ts — runs the AI bots of a room on the HOST's browser.
//
//  * Only the current host runs the bots (one brain per bot -> no desync).
//  * The runner heart-beats `game/botBeat`. If the host's app dies mid-match and the beat stops, the oldest
//    remaining human takes over the host role; the new host adopts the bots from their snake nodes.
//  * Rooms without bots are untouched: the hook is a no-op for them.
import { useEffect, useRef } from "react"
import { BotHost } from "@/lib/bot-host"
import { claimHost, isBotPlayer, subscribeServerOffset, type MpRoom } from "@/lib/multiplayer"

/** Beat older than this = host is gone. */
const BEAT_TIMEOUT_MS = 6000

export function useBotHost(code: string, playerId: string, room: MpRoom | null) {
  const roomRef = useRef<MpRoom | null>(room)
  roomRef.current = room
  const offsetRef = useRef(0)

  const players = Object.values(room?.players ?? {})
  const hasBots = players.some(isBotPlayer)
  const isHost = room?.hostId === playerId
  const live = room?.status === "countdown" || room?.status === "playing"
  const active = isHost && hasBots && live

  // The runner itself
  useEffect(() => {
    if (!active) return
    const host = new BotHost(code, () => roomRef.current)
    host.start()
    return () => host.stop()
  }, [active, code])

  // Host takeover during a match (only rooms that have bots)
  useEffect(() => subscribeServerOffset((o) => (offsetRef.current = o)), [])
  useEffect(() => {
    if (!hasBots || !live || isHost) return
    const id = setInterval(() => {
      const r = roomRef.current
      if (!r || (r.status !== "playing" && r.status !== "countdown")) return
      const humans = Object.values(r.players ?? {})
        .filter((p) => !isBotPlayer(p) && p.id !== r.hostId)
        .sort((a, b) => (a.joinedAt ?? 0) - (b.joinedAt ?? 0))
      if (humans[0]?.id !== playerId) return // only ONE successor tries
      const hostPresent = !!r.players?.[r.hostId]
      const beat = r.game?.botBeat ?? 0
      const stale = beat > 0 && Date.now() + offsetRef.current - beat > BEAT_TIMEOUT_MS
      if (!hostPresent || stale) claimHost(code, playerId).catch(() => {})
    }, 2000)
    return () => clearInterval(id)
  }, [hasBots, live, isHost, code, playerId])
}
