"use client"

// components/royale-hud.tsx — DOM overlay on top of the arena canvas:
// Alive counter, match timer, zone timer / warning banner, out-of-zone countdown, spectator label.
import { Skull, Users, Timer, AlertTriangle, Eye } from "lucide-react"
import { formatClock, type ZoneState } from "@/lib/br/zone"

interface Props {
  alive: number
  total: number
  /** ms since match start */
  elapsedMs: number
  zone: ZoneState
  /** ms left before I die outside the zone (null = I'm inside / not playing) */
  graceLeftMs: number | null
  /** name of the snake the camera follows while I'm eliminated */
  spectating: string | null
  /** my final placement once eliminated */
  placement: number | null
}

export default function RoyaleHud({ alive, total, elapsedMs, zone, graceLeftMs, spectating, placement }: Props) {
  const nextSec = zone.msToNextShrink === null ? null : Math.ceil(zone.msToNextShrink / 1000)
  return (
    <>
      {/* top-left: Alive + timer (the minimap sits top-right) */}
      <div className="pointer-events-none absolute left-2 top-2 flex flex-col gap-1">
        <div className="flex items-center gap-1.5 rounded-lg bg-black/65 px-2 py-1 text-[11px] font-bold text-white">
          <Users className="h-3.5 w-3.5 text-emerald-400" />
          Alive: <span className="tabular-nums">{alive} / {total}</span>
        </div>
        <div className="flex items-center gap-1.5 rounded-lg bg-black/65 px-2 py-1 text-[11px] font-semibold text-white">
          <Timer className="h-3.5 w-3.5 text-sky-300" />
          <span className="tabular-nums">{formatClock(elapsedMs)}</span>
        </div>
        <div className={`rounded-lg px-2 py-1 text-[10px] font-semibold tabular-nums ${zone.warning ? "bg-red-600/85 text-white" : "bg-black/65 text-white/80"}`}>
          {zone.shrinking ? "Zone closing…" : nextSec === null ? "Final zone" : `Zone in ${formatClock(nextSec * 1000)}`}
        </div>
      </div>

      {/* 5 s warning before a shrink */}
      {zone.warning && !zone.shrinking && nextSec !== null && (
        <div className="pointer-events-none absolute inset-x-0 top-[34%] flex justify-center">
          <div className="flex animate-pulse items-center gap-2 rounded-xl bg-red-600/90 px-3 py-1.5 text-xs font-extrabold text-white shadow-lg">
            <AlertTriangle className="h-4 w-4" /> Zone shrinking in {nextSec}s
          </div>
        </div>
      )}

      {/* out of the zone: 3 s grace */}
      {graceLeftMs !== null && (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
          <div className="rounded-xl bg-red-700/90 px-3 py-1.5 text-xs font-extrabold text-white shadow-lg">
            ⚠ Outside the zone — {Math.max(0, Math.ceil(graceLeftMs / 1000))}s to get back!
          </div>
        </div>
      )}

      {/* spectator banner */}
      {spectating !== null && (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center px-2">
          <div className="flex items-center gap-1.5 rounded-xl bg-black/75 px-3 py-1.5 text-[11px] font-semibold text-white">
            <Skull className="h-3.5 w-3.5" />
            {placement ? `#${placement} — ` : ""}Eliminated · <Eye className="h-3.5 w-3.5" /> {spectating || "…"} <span className="opacity-60">(tap to switch)</span>
          </div>
        </div>
      )}
    </>
  )
}
