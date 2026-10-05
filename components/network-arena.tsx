"use client"

// components/network-arena.tsx — Socket.io battle screen (runs next to the Firebase battles).
// Rendering: Royale reuses drawBrFrame + Camera; classic uses a small canvas painter.
// Match end -> ranked settles through the Firebase SDK (same trust model as the Firebase
// path: every client computes from the server's authoritative standings and writes ONLY
// its own record; security rules bind the write to auth.uid).
import { useEffect, useRef, useState } from "react"
import type { UseSnakeNetwork, RenderSnake } from "@/hooks/useSnakeNetwork"
import { useBattleSteering } from "@/hooks/use-battle-steering"
import { Camera } from "@/lib/br/camera"
import { drawBrFrame } from "@/lib/br/render"
import { BR_CELL, BR_VIEW_CELLS } from "@/lib/br/constants"
import { DIR_VECTOR, dirFromVector, type Dir } from "@/shared/snake-protocol"
import {
  applyMatchResult,
  calculateMatchRankings,
  createRankProfile,
  RANKED_MIN_PLAYERS,
  toRankedPlayer,
  type RankedPlayer,
} from "@/lib/ranked"
import {
  armDisconnectPenaltyV2,
  fetchRankProfiles,
  lastPlaceRankProfile,
  writeRankProfiles,
  type RankProfileBundle,
} from "@/lib/ranked-db"
import { RatingDelta } from "./ranked-panel"

interface Props {
  net: UseSnakeNetwork
  darkMode: boolean
  controlMode: "swipe" | "buttons"
  isRanked: boolean
  myUid: string | null
  onExit: () => void
}

/** Classic 20x20-style painter (drawBrFrame is built for the 120x120 Royale world). */
function drawClassic(
  ctx: CanvasRenderingContext2D,
  net: UseSnakeNetwork,
  snakes: RenderSnake[],
  darkMode: boolean,
) {
  const cfg = net.config
  if (!cfg) return
  const cell = 18
  const W = cfg.cols * cell
  const H = cfg.rows * cell
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.fillStyle = darkMode ? "#0b0f14" : "#e8f0e4"
  ctx.fillRect(0, 0, W, H)
  ctx.fillStyle = darkMode ? "#ffffff14" : "#00000010"
  for (let x = 0; x <= cfg.cols; x++) ctx.fillRect(x * cell, 0, 1, H)
  for (let y = 0; y <= cfg.rows; y++) ctx.fillRect(0, y * cell, W, 1)
  ctx.fillStyle = "#3a4048"
  for (const w of cfg.walls) ctx.fillRect(w.x * cell, w.y * cell, cell, cell)
  for (const f of net.gameViewRef.current.foods.values()) {
    ctx.fillStyle = f.kind === "speed" ? "#ffe14d" : f.kind === "shield" ? "#4da6ff" : "#ff5d7a"
    ctx.beginPath()
    ctx.arc((f.x + 0.5) * cell, (f.y + 0.5) * cell, cell * 0.32, 0, Math.PI * 2)
    ctx.fill()
  }
  for (const s of snakes) {
    ctx.globalAlpha = s.shielded ? 0.6 : 1
    ctx.fillStyle = s.color
    s.seg.forEach((c, i) => {
      if (i === 0) {
        // head
        ctx.fillStyle = s.color
        ctx.fillRect(c.x * cell, c.y * cell, cell, cell)
        ctx.fillStyle = s.color
      } else {
        ctx.fillRect(c.x * cell + 1, c.y * cell + 1, cell - 2, cell - 2)
      }
    })
    ctx.globalAlpha = 1
  }
}

interface RankedRow {
  placement: number
  name: string
  delta: number
  newRp: number
}

export default function NetworkArena({ net, darkMode, controlMode, isRanked, myUid, onExit }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const arenaEl = useRef<HTMLDivElement>(null)
  const camera = useRef(new Camera())
  const netRef = useRef(net)
  netRef.current = net
  const [rankedRows, setRankedRows] = useState<RankedRow[] | null>(null)
  const [rankedNote, setRankedNote] = useState<string | null>(null)
  const [myDelta, setMyDelta] = useState<number | null>(null)
  const settledRef = useRef(false)
  const disarmRef = useRef<(() => Promise<void>) | null>(null)
  /** Everybody's rating as it was BEFORE the match. Frozen at the countdown so a faster client's write can't change what a slower client computes from. */
  const preMatchRef = useRef<Record<string, RankProfileBundle> | null>(null)
  const mode = net.config?.mode ?? net.room?.settings.mode ?? "classic"
  const isRoyale = mode === "royale"

  // ---- steering -----------------------------------------------------------
  useBattleSteering({
    canSteer: () => netRef.current.phase === "playing",
    controlMode,
    getDir: () => {
      const mine = netRef.current.gameViewRef.current.snakes.get(netRef.current.me?.playerId ?? "")
      const v = mine ? DIR_VECTOR[mine.dir as Dir] : { dx: 0, dy: 0 }
      return { x: v.dx, y: v.dy }
    },
    setDir: (x, y) => {
      const d = dirFromVector(x, y)
      if (d) netRef.current.sendMove(d)
    },
    getSurfaces: () => [arenaEl.current],
    rerunKey: net.phase,
  })

  // ---- render loop ----------------------------------------------------------
  useEffect(() => {
    let raf = 0
    let last = performance.now()
    const frame = (t: number) => {
      raf = requestAnimationFrame(frame)
      const n = netRef.current
      const canvas = canvasRef.current
      const ctx = canvas?.getContext("2d")
      if (!ctx) return
      const snakes = n.sampleSnakes(t)
      if (n.config?.mode === "royale") {
        const zone = n.getZone()
        if (!zone) return
        const mine = snakes.find((s) => s.mine)
        const spectate = mine ?? snakes[0]
        if (spectate?.seg[0]) camera.current.follow(spectate.seg[0].x, spectate.seg[0].y, t - last)
        last = t
        drawBrFrame(ctx, {
          camera: camera.current,
          zone,
          foods: [...n.gameViewRef.current.foods.values()].map((f) => ({ x: f.x, y: f.y })),
          snakes,
          now: t,
          darkMode,
          grid: true,
          followId: mine ? null : (spectate?.id ?? null),
        })
      } else {
        drawClassic(ctx, n, snakes, darkMode)
      }
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [darkMode])

  // ---- ranked: arm the quit penalty when the match starts -------------------
  useEffect(() => {
    if (net.phase !== "countdown" || !isRanked || !myUid || !net.me) return
    let cancelled = false
    ;(async () => {
      try {
        // uid per player from the verified lobby records (fallback: fresh profile)
        const uids = net.players.map((p) => p.uid ?? `unverified:${p.id}`)
        const bundles = await fetchRankProfiles(uids.filter((u) => !u.startsWith("unverified:")))
        for (const p of net.players) {
          const u = p.uid ?? `unverified:${p.id}`
          if (!bundles[u]) bundles[u] = { profile: createRankProfile(u), wins: 0, losses: 0 }
        }
        if (cancelled) return
        preMatchRef.current = bundles
        const myKey = net.players.find((p) => p.id === net.me!.playerId)?.uid ?? `unverified:${net.me!.playerId}`
        const penalty = lastPlaceRankProfile(bundles, myKey)
        if (cancelled) return
        // write the penalty under my REAL firebase uid (rules bind it to auth.uid)
        disarmRef.current = await armDisconnectPenaltyV2(myUid, {
          profile: { ...penalty.profile, uid: myUid },
          wins: penalty.wins,
          losses: penalty.losses,
        })
      } catch {
        /* ranked unavailable — the match still plays */
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [net.phase === "countdown"])

  // ---- ranked: settle at game over ------------------------------------------
  useEffect(() => {
    if (net.phase !== "ended" || !net.result || settledRef.current) return
    settledRef.current = true
    void disarmRef.current?.().catch(() => {})
    if (!isRanked || !myUid || !net.me) return
    ;(async () => {
      try {
        const standings = net.result!.standings
        // calculateMatchRankings needs at least RANKED_MIN_PLAYERS (3) — otherwise it throws
        if (standings.length < RANKED_MIN_PLAYERS) {
          setRankedNote(`Ranked needs ${RANKED_MIN_PLAYERS}+ players — this match did not count.`)
          return
        }
        // The uid comes with the server's standings: a player who left is no longer in net.players,
        // so looking uids up there made every match with a leaver skip ranked for EVERYONE.
        const idToUid = new Map(standings.map((s) => [s.id, s.uid]))
        const unverified = standings.some((s) => !idToUid.get(s.id))
        if (unverified) {
          setRankedNote("⚠ Ranked skipped — a player wasn't verified (Google sign-in).")
          return
        }
        const uids = standings.map((s) => idToUid.get(s.id) as string)
        // Use the ratings frozen at the countdown. Re-reading now would return opponents who already
        // settled (their ratings changed) -> every client computes a different match -> zero-sum breaks.
        const frozen = preMatchRef.current
        const bundles = frozen && uids.every((u) => frozen[u]) ? frozen : await fetchRankProfiles(uids)
        const players: RankedPlayer[] = standings.map((s) => {
          const uid = idToUid.get(s.id) as string
          return toRankedPlayer(bundles[uid].profile, {
            placement: s.disconnected ? standings.length : s.placement,
            kills: s.kills,
            peakMass: s.peakMass,
          })
        })
        const results = calculateMatchRankings(players)
        const byUid = new Map(results.map((r) => [r.uid, r]))
        const rows: RankedRow[] = standings.map((s) => {
          const uid = idToUid.get(s.id) as string
          const r = byUid.get(uid)!
          return { placement: r.placement, name: s.name, delta: r.rpDelta, newRp: r.rpAfter }
        })
        setRankedRows(rows.sort((a, b) => a.placement - b.placement))
        // write ONLY my own record (security rules enforce auth.uid)
        const myPlayerId = net.me!.playerId
        const myStandUid = idToUid.get(myPlayerId) as string
        const myRes = byUid.get(myStandUid)!
        const myBundle: RankProfileBundle = bundles[myStandUid]
        const settled: Record<string, RankProfileBundle> = {
          [myUid]: {
            profile: { ...applyMatchResult(myBundle.profile, myRes), uid: myUid },
            wins: myBundle.wins,
            losses: myBundle.losses,
          },
        }
        const wonUid = myRes.placement === 1 ? myUid : null
        await writeRankProfiles(settled, wonUid)
        setMyDelta(myRes.rpDelta)
      } catch {
        setRankedNote("Could not save your rating. Check your connection.")
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [net.phase, net.result])

  const backToLobby = () => {
    settledRef.current = false
    preMatchRef.current = null
    setRankedRows(null)
    setRankedNote(null)
    setMyDelta(null)
    if (net.me?.isHost) void net.resetRoom().catch(() => {})
    else void net.leaveRoom().catch(() => {})
  }

  const pingColor = net.ping === null ? "#888" : net.ping < 80 ? "#3af08d" : net.ping < 160 ? "#ffe14d" : "#ff5d7a"
  const mySnake = net.gameState?.snakes.find((s) => s.id === net.me?.playerId)

  return (
    <div className="flex flex-col items-center gap-2 p-2 w-full max-w-xl mx-auto">
      {/* HUD */}
      <div className="flex items-center justify-between w-full text-xs">
        <span className="font-mono" style={{ color: pingColor }}>
          {net.ping ?? "–"} ms
        </span>
        <span className="opacity-70">
          {net.phase === "countdown" ? "Get ready…" : `🐍 ${net.gameState?.aliveCount ?? 0} alive`}
        </span>
        <span className="opacity-70">Score: {mySnake?.score ?? 0}</span>
      </div>

      {/* arena */}
      <div ref={arenaEl} className="relative w-full flex justify-center touch-none select-none">
        <canvas
          ref={canvasRef}
          width={isRoyale ? BR_VIEW_CELLS * BR_CELL : net.config ? net.config.cols * 18 : 360}
          height={isRoyale ? BR_VIEW_CELLS * BR_CELL : net.config ? net.config.rows * 18 : 360}
          style={{ maxWidth: "100%", height: "auto", borderRadius: 12 }}
        />
        {net.phase === "countdown" && net.startsAt && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-6xl font-black text-white drop-shadow-lg">
              {Math.max(1, Math.ceil((net.startsAt - net.getServerTime()) / 1000))}
            </div>
          </div>
        )}
      </div>

      {/* killfeed */}
      {net.killFeed.length > 0 && (
        <div className="text-[11px] opacity-70 h-4 overflow-hidden">
          💀 {net.killFeed[0].name}
          {net.killFeed[0].killerName ? ` — killed by ${net.killFeed[0].killerName}` : ""}
        </div>
      )}

      {/* game over */}
      {net.phase === "ended" && net.result && (
        <div className={`w-full p-4 rounded-2xl border ${darkMode ? "bg-white/5 border-white/10" : "bg-black/5 border-black/10"}`}>
          <div className="text-center font-bold text-lg mb-2">
            {net.result.winnerId === net.me?.playerId ? "🏆 You win!" : "Battle over!"}
          </div>
          {isRanked && myDelta !== null && (
            <div className="flex justify-center mb-2">
              <RatingDelta delta={myDelta} />
            </div>
          )}
          {rankedNote && <div className="text-xs text-center opacity-70 mb-2">{rankedNote}</div>}
          <div className="flex flex-col gap-1 max-h-44 overflow-y-auto mb-3">
            {(rankedRows ?? net.result.standings.map((s) => ({ placement: s.placement, name: s.name, delta: 0, newRp: 0 })))
              .sort((a, b) => a.placement - b.placement)
              .map((r, i) => (
                <div key={i} className="flex justify-between text-sm px-2">
                  <span>
                    #{r.placement} {r.name}
                  </span>
                  {isRanked && rankedRows && (
                    <span className={r.delta >= 0 ? "text-emerald-400" : "text-red-400"}>
                      {r.delta >= 0 ? "+" : ""}
                      {r.delta} RP
                    </span>
                  )}
                </div>
              ))}
          </div>
          <div className="flex gap-2">
            <button
              onClick={backToLobby}
              className="flex-1 px-4 py-2 rounded-xl bg-emerald-500 text-white font-semibold text-sm active:scale-95"
            >
              {net.me?.isHost ? "Back to lobby" : "Leave"}
            </button>
            <button
              onClick={onExit}
              className={`px-4 py-2 rounded-xl text-sm ${darkMode ? "bg-white/10" : "bg-black/10"}`}
            >
              ✕
            </button>
          </div>
        </div>
      )}
      {net.phase !== "ended" && (
        <button onClick={onExit} className={`text-xs px-3 py-1 rounded-lg ${darkMode ? "bg-white/10" : "bg-black/10"}`}>
          ✕ Leave match
        </button>
      )}
    </div>
  )
}
