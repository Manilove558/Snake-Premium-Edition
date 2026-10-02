"use client"

// components/royale-victory.tsx — "Last Snake Standing" victory screen with per-player match stats.
import { Trophy, Crown, Skull, RotateCcw, Home, Loader2 } from "lucide-react"
import { FriendAction } from "./snake-friends"
import { VipCrown } from "./vip-crown"
import { BotTag } from "./bot-tag"
import { formatClock } from "@/lib/br/zone"
import { isBotPlayer, type MpPlayer } from "@/lib/multiplayer"

interface Props {
  players: MpPlayer[]
  winnerId: string | null
  myId: string
  /** server ms: match start / end (survival time = diedAt - startAt, winner = endedAt - startAt) */
  startAt: number
  endedAt: number
  isHost: boolean
  busy: boolean
  error: string
  onRematch: () => void
  onBackToRoom: () => void
}

export interface StatRow {
  player: MpPlayer
  placement: number
  kills: number
  survivedMs: number
}

/** Winner first, then whoever lasted longest (kills break ties). */
export function buildStats(players: MpPlayer[], winnerId: string | null, startAt: number, endedAt: number): StatRow[] {
  const end = (p: MpPlayer) => (p.id === winnerId || p.alive ? endedAt : (p.diedAt ?? endedAt))
  return [...players]
    .sort((a, b) => {
      if (a.id === winnerId) return -1
      if (b.id === winnerId) return 1
      return end(b) - end(a) || (b.kills ?? 0) - (a.kills ?? 0)
    })
    .map((player, i) => ({ player, placement: i + 1, kills: player.kills ?? 0, survivedMs: Math.max(0, end(player) - startAt) }))
}

export default function RoyaleVictory({ players, winnerId, myId, startAt, endedAt, isHost, busy, error, onRematch, onBackToRoom }: Props) {
  const rows = buildStats(players, winnerId, startAt, endedAt)
  const winner = rows.find((r) => r.player.id === winnerId)
  const me = rows.find((r) => r.player.id === myId)

  return (
    <div className="absolute inset-0 flex overflow-y-auto rounded-2xl bg-black/70">
      <div className="m-auto w-full max-w-[330px] px-3 py-2 text-center">
        <Trophy className="mx-auto mb-1 h-9 w-9 text-amber-400" />
        <div className="text-base font-extrabold text-white">
          {winner ? (winner.player.id === myId ? "🏆 VICTORY — Last Snake Standing!" : `${winner.player.name} wins!`) : "Battle over!"}
        </div>

        {me && (
          <div className="mx-auto mt-2 grid max-w-[260px] grid-cols-3 gap-1.5 text-white">
            {[
              ["Place", `#${me.placement}`],
              ["Kills", String(me.kills)],
              ["Survived", formatClock(me.survivedMs)],
            ].map(([k, v]) => (
              <div key={k} className="rounded-lg border border-white/15 bg-white/10 px-1 py-1">
                <div className="text-[8px] uppercase tracking-wider opacity-60">{k}</div>
                <div className="text-sm font-extrabold tabular-nums">{v}</div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-2 max-h-36 overflow-y-auto rounded-lg bg-white/5 p-1">
          <div className="grid grid-cols-[18px_1fr_32px_44px_auto] items-center gap-x-1.5 px-1 pb-0.5 text-[8px] uppercase tracking-wider text-white/50">
            <span>#</span><span className="text-left">Player</span><span>Kills</span><span>Time</span><span />
          </div>
          {rows.map((r) => (
            <div
              key={r.player.id}
              className={`grid grid-cols-[18px_1fr_32px_44px_auto] items-center gap-x-1.5 rounded px-1 py-0.5 text-[11px] text-white ${r.player.id === myId ? "bg-emerald-500/20" : ""}`}
            >
              <span className="font-bold">{r.placement === 1 ? <Crown className="h-3 w-3 text-amber-400" /> : r.placement}</span>
              <span className="flex min-w-0 items-center gap-1 text-left">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: r.player.color }} />
                <span className="truncate font-medium">{isBotPlayer(r.player) && <BotTag />}{r.player.vip && <VipCrown className="h-3 w-3" />}{r.player.name}</span>
                {r.player.id !== winnerId && <Skull className="h-3 w-3 shrink-0 opacity-50" />}
              </span>
              <span className="font-bold tabular-nums">{r.kills}</span>
              <span className="tabular-nums opacity-80">{formatClock(r.survivedMs)}</span>
              <span>{r.player.id !== myId && <FriendAction targetUid={r.player.uid} />}</span>
            </div>
          ))}
        </div>

        <div className={`mx-auto mt-3 flex h-14 w-full max-w-[220px] overflow-hidden rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-400 shadow-lg shadow-emerald-500/30 ${!isHost ? "opacity-50" : ""}`}>
          <button onClick={onRematch} disabled={!isHost || busy} aria-label="Rematch" className="flex flex-1 flex-col items-center justify-center gap-0.5 text-white transition-colors hover:bg-white/15 active:bg-white/25 disabled:cursor-not-allowed disabled:hover:bg-transparent">
            {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <RotateCcw className="h-5 w-5" />}
            <span className="text-[10px] font-semibold leading-none">Rematch</span>
          </button>
          <div className="my-2 w-px bg-white/50" />
          <button onClick={onBackToRoom} disabled={!isHost || busy} aria-label="Back to room" className="flex flex-1 flex-col items-center justify-center gap-0.5 text-white transition-colors hover:bg-white/15 active:bg-white/25 disabled:cursor-not-allowed disabled:hover:bg-transparent">
            <Home className="h-5 w-5" />
            <span className="text-[10px] font-semibold leading-none">Back to room</span>
          </button>
        </div>
        {!isHost && <div className="mt-2 text-xs text-white/60">Waiting for host to choose…</div>}
        {error && <div className="mt-2 text-xs text-red-300">{error}</div>}
      </div>
    </div>
  )
}
