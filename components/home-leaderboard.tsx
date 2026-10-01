"use client"
import { useEffect, useState } from "react"
import { Trophy } from "lucide-react"
import { fetchLeaderboard, type LeaderboardRow } from "@/lib/ranked-db"
import { getTier } from "@/lib/ranked"

/**
 * Compact ranked leaderboard shown in the empty space above the home-screen
 * header. The parent animates it in/out (max-height + opacity) when the
 * player switches to/from the multiplayer (ranked) mode or starts a game.
 */
export function HomeLeaderboard() {
  const [rows, setRows] = useState<LeaderboardRow[]>([])
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let on = true
    fetchLeaderboard(5)
      .then((r) => { if (on) setRows(r) })
      .catch(() => { if (on) setFailed(true) })
    // refresh every minute while the home screen is up
    const t = setInterval(() => {
      fetchLeaderboard(5).then((r) => { if (on) setRows(r) }).catch(() => {})
    }, 60_000)
    return () => { on = false; clearInterval(t) }
  }, [])

  if (failed || rows.length === 0) return null

  return (
    <div className="rounded-2xl bg-white/70 dark:bg-white/5 backdrop-blur-sm border border-black/5 dark:border-white/10 shadow-sm px-3.5 py-2.5">
      <div className="flex items-center gap-1.5 mb-1.5">
        <Trophy className="h-3.5 w-3.5 text-amber-500" />
        <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Ranked leaderboard</span>
      </div>
      <div className="space-y-1">
        {rows.map((r, i) => {
          const t = getTier(r.elo)
          return (
            <div key={r.uid} className="flex items-center gap-2 text-[12px]">
              <span className={`w-5 text-center font-bold tabular-nums ${i === 0 ? "text-amber-500" : i === 1 ? "text-slate-400" : i === 2 ? "text-amber-700 dark:text-amber-600" : "text-muted-foreground"}`}>
                {i + 1}
              </span>
              <span className="flex-1 min-w-0 truncate font-semibold">{r.name}</span>
              <span className="shrink-0 text-[11px] font-bold tabular-nums" style={{ color: t.color }}>
                {t.emoji} {r.elo}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
