"use client"

// components/classic-net-battle.tsx — the classic 20x20 battle screen, driven by the Socket.io server.
//
// v23: this replaces components/multiplayer-battle.tsx. The LAYOUT is unchanged (board frame in the centre slot,
// score / exit / steering dashboard on the right, player leaderboard on the left), but nothing is simulated or synced
// through Firebase any more:
//   * the server owns every snake (movement, collisions, food, kills, winner) — see server/engine.ts
//   * this component only DRAWS the interpolated snakes and SENDS turns (net.sendMove)
//   * ranked results (RP / MMR) arrive from the server as RANKED_RESULT; the client never writes ratings
import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { X, Trophy, Skull, Crown, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, RotateCcw, Loader2 } from "lucide-react"
import { useBackButton } from "@/hooks/use-back-button"
import { useBattleSteering } from "@/hooks/use-battle-steering"
import { ConfirmDialog } from "./confirm-dialog"
import { useNet } from "./net-provider"
import { BotTag } from "./bot-tag"
import VoiceChat from "./voice-chat"
import { FriendAction } from "./snake-friends"
import { VipCrown } from "./vip-crown"
import { RankedTag, RatingDelta, TierBadge } from "./ranked-panel"
import { useSoundManager } from "./sound-manager"
import { CountdownOverlay } from "@/components/countdown-overlay"
import { destroyVoiceManager } from "@/lib/voice-chat"
import { isBotPlayer, getRoomSettings } from "@/lib/multiplayer"
import { killLine } from "@/lib/net-adapter"
import { claimRankRewards } from "@/lib/store"
import { getBattleMap } from "@/lib/battle-maps"
import { drawSnakeEyes, eyeDirection } from "@/lib/smooth-move"
import { antiGhostProps } from "@/lib/anti-ghost"
import { DIR_VECTOR, dirFromVector, type Dir } from "@/shared/snake-protocol"

const CELL = 18 // battle arena render size (bigger on phones)

export interface NetBattleProps {
  darkMode: boolean
  controlMode: "buttons" | "swipe"
  soundEnabled: boolean
  volume: number
  /** classic frame slots: the board (center) and the dashboard (right) of the single-player screen */
  centerEl: HTMLElement | null
  sideEl: HTMLElement | null
  /** left column between the Future-buttons strip and the board (player leaderboard) */
  leftEl: HTMLElement | null
  bestScore: number
  /** "Smooth movement" setting (Battle Royale style gliding). Default on. */
  smoothMove?: boolean
  onExit: () => void
  onBackToLobby: () => void
  /** Alive player pressed the red ✕ mid-match: go back to the room (lobby) while the match goes on without them */
  onReturnToRoom?: () => void
}

export default function ClassicNetBattle({ darkMode, controlMode, soundEnabled, volume, centerEl, sideEl, leftEl, bestScore, smoothMove = true, onExit, onBackToLobby, onReturnToRoom }: NetBattleProps) {
  const { net, mp: room } = useNet()
  const netRef = useRef(net)
  netRef.current = net
  const code = net.room?.code ?? ""
  const playerId = net.me?.playerId ?? ""
  const [nowTs, setNowTs] = useState(Date.now())
  const [endBusy, setEndBusy] = useState(false)
  const [endError, setEndError] = useState("")
  const [rankReward, setRankReward] = useState<{ coins: number; gems: number; tiers: string[] } | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const arenaWrapRef = useRef<HTMLDivElement>(null)
  const swipePadRef = useRef<HTMLDivElement>(null)

  const { playWalkSound, playFoodSound, playGameOverSound, playGameStartSound, playCountdownSound, playEliminationSound } = useSoundManager({
    enabled: soundEnabled,
    volume,
  })
  const soundRef = useRef({ playWalkSound, playFoodSound, playGameOverSound, playGameStartSound, playCountdownSound, playEliminationSound })
  soundRef.current = { playWalkSound, playFoodSound, playGameOverSound, playGameStartSound, playCountdownSound, playEliminationSound }

  const onBackToLobbyRef = useRef(onBackToLobby)
  const onExitRef = useRef(onExit)
  onBackToLobbyRef.current = onBackToLobby
  onExitRef.current = onExit

  const phase = room?.status ?? "lobby"
  const phaseRef = useRef(phase)
  phaseRef.current = phase
  const myPlayer = room?.players?.[playerId] ?? null
  const isHost = room?.hostId === playerId
  const settings = getRoomSettings(room)
  const cfg = net.config
  const battleMap = getBattleMap(cfg?.map ?? settings.map)
  const iAmAlive = phase === "lobby" ? true : (myPlayer?.alive ?? true)
  const aliveRef = useRef(iAmAlive)
  aliveRef.current = iAmAlive
  const smoothRef = useRef(smoothMove)
  smoothRef.current = smoothMove
  const darkRef = useRef(darkMode)
  darkRef.current = darkMode
  const gridRef = useRef(settings.grid)
  gridRef.current = settings.grid
  const eyeDirs = useRef<Map<string, { x: number; y: number }>>(new Map())

  // ---- room lifecycle: lost room -> out, host reset -> lobby --------------------------------
  const seenRoomRef = useRef(false)
  useEffect(() => {
    if (room) seenRoomRef.current = true
    else if (seenRoomRef.current) onExitRef.current()
  }, [room])
  useEffect(() => {
    if (phase === "lobby" && seenRoomRef.current) onBackToLobbyRef.current()
  }, [phase])

  // ---- countdown ticker ---------------------------------------------------------------------
  useEffect(() => {
    const id = setInterval(() => setNowTs(Date.now()), 200)
    return () => clearInterval(id)
  }, [])
  const countdownNum = phase === "countdown" && net.startsAt ? Math.max(1, Math.ceil((net.startsAt - net.getServerTime()) / 1000)) : 0
  void nowTs
  useEffect(() => {
    if (countdownNum > 0) soundRef.current.playCountdownSound(countdownNum)
  }, [countdownNum])

  // ---- sounds ---------------------------------------------------------------------------------
  const prevPhaseSndRef = useRef<string>("")
  useEffect(() => {
    // "GO" cue when the countdown hands over to play; the match-over fanfare plays for winner AND spectators
    if (phase === "playing" && prevPhaseSndRef.current === "countdown") soundRef.current.playGameStartSound()
    if (phase === "ended" && prevPhaseSndRef.current !== "ended") soundRef.current.playGameStartSound()
    prevPhaseSndRef.current = phase
  }, [phase])
  // my death
  const wasAliveRef = useRef(true)
  useEffect(() => {
    if (phase === "playing" && wasAliveRef.current && !iAmAlive) soundRef.current.playGameOverSound()
    wasAliveRef.current = iAmAlive
  }, [iAmAlive, phase])
  // someone else eliminated while I watch
  const killsHeardRef = useRef(0)
  useEffect(() => {
    const n = net.killFeed.length
    if (phase === "playing" && !iAmAlive && n > killsHeardRef.current && net.killFeed[0]?.id !== playerId) soundRef.current.playEliminationSound()
    killsHeardRef.current = n
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [net.killFeed])
  // my steps + bites: the render loop watches the head cell and the score
  const lastHeadRef = useRef("")
  const lastScoreRef = useRef(0)

  // ---- ranked: server result -> Rank Pass reward (coins / gems for newly reached tiers) -----
  const rewardedRef = useRef<unknown>(null)
  useEffect(() => {
    const rr = net.rankedResult
    if (!rr || !rr.saved || rewardedRef.current === rr) return
    rewardedRef.current = rr
    const mine = rr.rows.find((r) => r.id === playerId)
    if (!mine) return
    const reward = claimRankRewards(mine.rpAfter)
    if (reward.tiers.length > 0) setRankReward(reward)
  }, [net.rankedResult, playerId])
  useEffect(() => {
    if (phase === "countdown") {
      setEndBusy(false)
      setEndError("")
      setRankReward(null)
      lastHeadRef.current = ""
      lastScoreRef.current = 0
      killsHeardRef.current = 0
    }
  }, [phase])

  // ---- steering ----------------------------------------------------------------------------------
  const sendDir = (x: number, y: number) => {
    const d = dirFromVector(x, y)
    if (d) netRef.current.sendMove(d)
  }
  useBattleSteering({
    canSteer: () => phaseRef.current === "playing" && aliveRef.current,
    controlMode,
    getDir: () => {
      const mine = netRef.current.gameViewRef.current.snakes.get(netRef.current.me?.playerId ?? "")
      const v = mine ? DIR_VECTOR[mine.dir as Dir] : { dx: 1, dy: 0 }
      return { x: v.dx, y: v.dy }
    },
    setDir: sendDir,
    getSurfaces: () => [swipePadRef.current, arenaWrapRef.current],
    rerunKey: `${phase}|${iAmAlive}|${!!centerEl}|${!!sideEl}|${!!leftEl}`,
  })

  // ---- drawing (every animation frame; the server gives us 20 TPS, the interpolators make it glide) ----
  useEffect(() => {
    let raf = 0
    const frame = (t: number) => {
      raf = requestAnimationFrame(frame)
      const canvas = canvasRef.current
      const ctx = canvas?.getContext("2d")
      const n = netRef.current
      const c = n.config
      if (!canvas || !ctx || !c) return
      const smooth = smoothRef.current
      const dark = darkRef.current
      const W = c.cols
      const H = c.rows

      const bg = ctx.createLinearGradient(0, 0, canvas.width, canvas.height)
      bg.addColorStop(0, dark ? "#101820" : "#eef4ea")
      bg.addColorStop(1, dark ? "#0a0f14" : "#dbe8d6")
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.fillStyle = bg
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      if (gridRef.current) {
        ctx.strokeStyle = dark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.06)"
        ctx.lineWidth = 1
        for (let x = 1; x < W; x++) {
          ctx.beginPath()
          ctx.moveTo(x * CELL, 0)
          ctx.lineTo(x * CELL, H * CELL)
          ctx.stroke()
        }
        for (let y = 1; y < H; y++) {
          ctx.beginPath()
          ctx.moveTo(0, y * CELL)
          ctx.lineTo(W * CELL, y * CELL)
          ctx.stroke()
        }
      }

      // Map walls (from the server's match config)
      ctx.fillStyle = dark ? "#3b5a49" : "#7f9d8b"
      for (const w of c.walls) {
        ctx.beginPath()
        ctx.roundRect(w.x * CELL + 0.5, w.y * CELL + 0.5, CELL - 1, CELL - 1, 3)
        ctx.fill()
      }

      // Portals (each pair has its own colour)
      const portalColors = ["#4da6ff", "#c77dff"]
      c.portals.forEach(([a, b], pi) => {
        const color = portalColors[pi % portalColors.length]
        for (const p of [a, b]) {
          const cx = p.x * CELL + CELL / 2
          const cy = p.y * CELL + CELL / 2
          ctx.save()
          ctx.shadowColor = color
          ctx.shadowBlur = 10
          ctx.strokeStyle = color
          ctx.lineWidth = 2.5
          ctx.beginPath()
          ctx.arc(cx, cy, CELL / 2 - 2, 0, Math.PI * 2)
          ctx.stroke()
          ctx.globalAlpha = 0.35
          ctx.fillStyle = color
          ctx.beginPath()
          ctx.arc(cx, cy, CELL / 4, 0, Math.PI * 2)
          ctx.fill()
          ctx.restore()
        }
      })

      // Food (normal / speed / shield)
      for (const f of n.gameViewRef.current.foods.values()) {
        const color = f.kind === "speed" ? "#ffe14d" : f.kind === "shield" ? "#4da6ff" : "#ff5078"
        ctx.save()
        ctx.shadowColor = color
        ctx.shadowBlur = 10
        ctx.fillStyle = color
        ctx.beginPath()
        ctx.arc(f.x * CELL + CELL / 2, f.y * CELL + CELL / 2, CELL / 2 - 2, 0, Math.PI * 2)
        ctx.fill()
        ctx.restore()
      }

      // Snakes: others first, mine on top
      const snakes = n.sampleSnakes(t).sort((a, b) => Number(a.mine) - Number(b.mine))
      for (const s of snakes) {
        const seg = smooth ? s.seg : s.seg.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) }))
        seg.forEach((p, i) => {
          ctx.save()
          if (s.mine && i === 0) {
            ctx.shadowColor = s.color
            ctx.shadowBlur = 10
          }
          ctx.fillStyle = s.color
          ctx.globalAlpha = (i === 0 ? 1 : Math.max(0.45, 1 - (i / Math.max(seg.length, 1)) * 0.5)) * (s.shielded ? 0.7 : 1)
          ctx.beginPath()
          ctx.roundRect(p.x * CELL + 1, p.y * CELL + 1, CELL - 2, CELL - 2, 4)
          ctx.fill()
          if (s.shielded && i === 0) {
            ctx.globalAlpha = 1
            ctx.strokeStyle = "#4da6ff"
            ctx.lineWidth = 2
            ctx.stroke()
          }
          ctx.restore()
        })
        if (smooth && seg.length > 1) {
          const last = eyeDirs.current.get(s.id) ?? { x: 1, y: 0 }
          const dir = eyeDirection(seg[0], seg[1], last)
          eyeDirs.current.set(s.id, dir)
          drawSnakeEyes(ctx, seg[0].x, seg[0].y, dir, CELL)
        }
        if (s.mine && phaseRef.current === "playing") {
          const key = `${Math.round(seg[0].x)},${Math.round(seg[0].y)}`
          if (key !== lastHeadRef.current) {
            lastHeadRef.current = key
            soundRef.current.playWalkSound() // soft slither on every step
          }
        }
      }
      const mine = n.gameViewRef.current.snakes.get(n.me?.playerId ?? "")
      if (mine) {
        if (mine.score > lastScoreRef.current && phaseRef.current === "playing") soundRef.current.playFoodSound()
        lastScoreRef.current = mine.score
      }
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [])

  // ---- actions -------------------------------------------------------------------------------------
  const handleExit = async () => {
    destroyVoiceManager(code, playerId)
    await net.leaveRoom().catch(() => {})
    onExit()
  }

  // Red ✕ while still ALIVE in a running match: back to the ROOM (lobby), not out of the room.
  // My snake leaves the round (last place — in a ranked room the server settles me as a leaver); the others play on.
  const handleReturnToRoom = async () => {
    await net.forfeitMatch().catch(() => {})
    if (onReturnToRoom) onReturnToRoom()
    else onBackToLobby()
  }

  // Rematch: start the next round right away (same room, same settings)
  const handleRematch = async () => {
    if (!isHost || endBusy) return
    setEndBusy(true)
    setEndError("")
    const r = await net.startGame()
    if (!r.ok) {
      setEndError(r.message)
      setEndBusy(false)
    }
  }

  // Back to room: everyone returns to the lobby (host can change map / settings)
  const handleBackToRoom = async () => {
    if (!isHost || endBusy) return
    setEndBusy(true)
    setEndError("")
    const r = await net.resetRoom()
    if (!r.ok) {
      setEndError(r.message || "Could not go back to the room.")
      setEndBusy(false)
    }
  }

  // ---- derived UI ----------------------------------------------------------------------------------
  const leaderboard = Object.values(room?.players ?? {}).sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
  const winner = phase === "ended" ? room?.players?.[room?.game?.winner ?? ""] : null
  const lastKill = net.killFeed[0]
  const isBotId = (id: string | null) => !!id && isBotPlayer({ id, bot: room?.players?.[id]?.bot })
  const glassBox = "bg-white/70 dark:bg-white/5 border border-black/5 dark:border-white/10"
  const dpadBtn = `${glassBox} d-pad-btn anti-ghost w-full h-full min-h-[48px] min-w-[48px] rounded-2xl flex items-center justify-center active:scale-95 transition-transform`
  const steering = (phase === "countdown" || phase === "playing") && iAmAlive
  const myScore = myPlayer?.score ?? 0
  const rr = net.rankedResult

  // What the red ✕ does right now
  const aliveInMatch = (phase === "countdown" || phase === "playing") && iAmAlive
  const xBackToRoom = aliveInMatch || (phase === "ended" && isHost)
  const xAction = aliveInMatch ? handleReturnToRoom : phase === "ended" && isHost ? handleBackToRoom : handleExit

  // Android Back: on the end screen it behaves like the red ✕; mid-match it asks first so one stray swipe can't forfeit the round
  const [confirmLeave, setConfirmLeave] = useState(false)
  useBackButton(true, () => {
    if (phase === "ended") void xAction()
    else setConfirmLeave(true)
  })
  if (!centerEl || !sideEl || !leftEl) return null

  return (
    <>
      <ConfirmDialog
        open={confirmLeave}
        title={aliveInMatch ? "Leave this round?" : "Leave battle?"}
        message={aliveInMatch ? "You go back to the room and your snake is out of this round." : "You will leave the battle."}
        confirmLabel={aliveInMatch ? "Back to room" : "Leave"}
        onCancel={() => setConfirmLeave(false)}
        onConfirm={() => {
          setConfirmLeave(false)
          void xAction()
        }}
      />
      {/* CENTER: the classic board frame, the battle is drawn on it */}
      {createPortal(
        <div
          ref={arenaWrapRef}
          className="relative rounded-2xl overflow-hidden premium-glow border border-black/10 dark:border-white/10"
          style={{ width: "min(100cqw, 100cqh)", aspectRatio: "1 / 1" }}
        >
          <canvas
            ref={canvasRef}
            width={(cfg?.cols ?? 20) * CELL}
            height={(cfg?.rows ?? 20) * CELL}
            className="block w-full h-full touch-none"
            style={{ imageRendering: "auto" }}
          />
          <CountdownOverlay value={phase === "countdown" ? countdownNum : 0} label="BATTLE STARTS" />
          {phase === "playing" && !iAmAlive && (
            <div className="absolute inset-x-0 top-2 flex justify-center">
              <div className="px-3 py-1.5 rounded-xl bg-black/70 text-white text-xs font-semibold flex items-center gap-1.5">
                <Skull className="w-4 h-4" /> Eliminated — spectating…
              </div>
            </div>
          )}
          {phase === "playing" && !iAmAlive && room?.isRanked && (
            <div className="absolute inset-x-0 top-12 flex justify-center px-2">
              <div className="px-3 py-1 rounded-lg bg-black/70 text-amber-300 text-[10px] font-semibold text-center">
                Stay until the match ends — leaving now counts as last place
              </div>
            </div>
          )}
          {phase === "ended" && (
            <div className="absolute inset-0 flex overflow-y-auto bg-black/60 rounded-2xl">
              <div className="m-auto text-center px-3 py-2">
                <Trophy className="w-10 h-10 text-amber-400 mx-auto mb-2" />
                <div className="text-white font-bold text-lg">{winner ? `${winner.name} wins!` : "Battle over!"}</div>
                <div className="text-white/70 text-xs mt-1">Scores</div>
                <div className="mt-2 flex flex-col gap-1 max-h-32 overflow-y-auto">
                  {leaderboard.map((p) => {
                    const row = rr?.rows.find((r) => r.id === p.id)
                    return (
                      <div key={p.id} className="flex flex-wrap items-center justify-center gap-2 text-sm text-white">
                        <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: p.color }} />
                        <span className="font-medium">
                          {isBotPlayer(p) && <BotTag />}
                          {p.vip && <VipCrown className="h-3.5 w-3.5" />}
                          {p.name}
                        </span>
                        <span className="font-bold">{p.score ?? 0}</span>
                        {row && <RatingDelta delta={row.rpDelta} />}
                        {row && <TierBadge elo={row.rpAfter} />}
                        {p.id !== playerId && <FriendAction targetUid={p.uid} />}
                      </div>
                    )
                  })}
                </div>
                {room?.isRanked && (
                  <div className="mt-2 text-[11px] text-white/70">
                    {rr ? (
                      rr.note ? (
                        <span className={rr.saved ? "" : "text-red-300"}>{rr.note}</span>
                      ) : (
                        "Ranked result saved"
                      )
                    ) : (
                      "Calculating rating…"
                    )}
                  </div>
                )}
                {rankReward && (
                  <div className="mt-2 mx-auto max-w-[240px] rounded-lg bg-amber-400/20 border border-amber-400/50 px-3 py-1.5 text-[12px] font-bold text-amber-300">
                    🎉 Rank pass: {rankReward.tiers.join(", ")}!
                    <div className="text-white">
                      +{rankReward.coins.toLocaleString()} coins · +{rankReward.gems} gem{rankReward.gems > 1 ? "s" : ""}
                    </div>
                  </div>
                )}
                {/* Rematch / Back to room live in the right sidebar (Rematch button + red ✕) */}
              </div>
            </div>
          )}
        </div>,
        centerEl,
      )}

      {/* RIGHT: same dashboard as single-player — score / best, steering controls, exit */}
      {createPortal(
        <>
          <div className="flex items-center justify-between gap-1">
            <div className="text-[11px] font-bold leading-none">
              Battle <span className="font-mono opacity-50">{code}</span>
              {room?.isRanked && <RankedTag className="ml-1 align-middle" />}
            </div>
            <VoiceChat code={code} playerId={playerId} playerName={myPlayer?.name ?? "Player"} darkMode={darkMode} compact />
          </div>

          {/* [ SCORE ] [ ✕ Exit ] [ BEST ] */}
          <div className="grid grid-cols-[1fr_auto_1fr] items-stretch gap-1.5">
            <div className="rounded-xl bg-white/70 dark:bg-white/[0.06] border border-black/5 dark:border-white/10 px-2.5 py-1 text-center">
              <div className="text-[8px] uppercase tracking-wider opacity-50 font-semibold">Score</div>
              <div className="text-base font-extrabold tabular-nums leading-tight">{myScore}</div>
            </div>
            {/* Red ✕ (see xAction): alive in a running match -> back to the room; end screen + host -> back to the room for
                everyone; dead / spectating or guest on the end screen -> leave the battle. */}
            <button
              aria-label={xBackToRoom ? "Back to room" : "Leave battle"}
              title={xBackToRoom ? "Back to room" : "Leave battle"}
              onClick={xAction}
              disabled={phase === "ended" && isHost && endBusy}
              className="d-pad-btn self-center h-10 w-10 rounded-full flex items-center justify-center text-red-500 bg-white/70 dark:bg-white/5 border border-red-500/30 shadow-sm active:scale-90 transition-transform disabled:opacity-50"
            >
              <X className="h-5 w-5" />
            </button>
            <div className="rounded-xl bg-white/70 dark:bg-white/[0.06] border border-black/5 dark:border-white/10 px-2.5 py-1 text-center">
              <div className="text-[8px] uppercase tracking-wider opacity-50 font-semibold">Best</div>
              <div className="text-base font-extrabold tabular-nums leading-tight">{Math.max(bestScore, myScore)}</div>
            </div>
          </div>

          {/* End screen only: Rematch (host starts the next round in the same room with the same settings) */}
          {phase === "ended" && (
            <div className="flex flex-col gap-1">
              <button
                onClick={handleRematch}
                disabled={!isHost || endBusy}
                aria-label="Rematch"
                title={isHost ? "Rematch" : "Only the host can start a rematch"}
                className="d-pad-btn h-11 w-full rounded-xl flex items-center justify-center gap-2 text-white text-sm font-bold bg-gradient-to-r from-emerald-500 to-emerald-400 shadow-md shadow-emerald-500/30 active:scale-95 transition-transform disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {endBusy ? <Loader2 className="h-5 w-5 animate-spin" /> : <RotateCcw className="h-5 w-5" />}
                Rematch
              </button>
              {!isHost && <div className="text-[10px] text-center opacity-60 leading-tight">Waiting for host…</div>}
              {endError && <div className="text-[10px] text-center text-red-500 leading-tight">{endError}</div>}
            </div>
          )}

          {(settings.map !== "classic" || settings.teleport || settings.avoidCollision) && (
            <div className="text-[9px] opacity-50 leading-tight">
              {battleMap.name}
              {settings.teleport ? " · Teleport" : ""}
              {settings.avoidCollision ? " · No collision" : ""}
            </div>
          )}

          {/* Steering: D-pad or swipe pad, exactly like single-player */}
          {steering && controlMode !== "swipe" && (
            <div className="flex-1 min-h-[110px] min-w-0 flex items-center justify-center" style={{ containerType: "size" }}>
              <div className="grid gap-1.5" style={{ width: "min(100cqw, 100cqh)", aspectRatio: "1 / 1", gridTemplateColumns: "repeat(3, 1fr)", gridTemplateRows: "repeat(3, 1fr)" }}>
                <div style={{ gridColumn: 2, gridRow: 1 }}><button aria-label="Up" {...antiGhostProps(() => sendDir(0, -1))} className={dpadBtn}><ArrowUp className="h-6 w-6" /></button></div>
                <div style={{ gridColumn: 1, gridRow: 2 }}><button aria-label="Left" {...antiGhostProps(() => sendDir(-1, 0))} className={dpadBtn}><ArrowLeft className="h-6 w-6" /></button></div>
                <div style={{ gridColumn: 3, gridRow: 2 }}><button aria-label="Right" {...antiGhostProps(() => sendDir(1, 0))} className={dpadBtn}><ArrowRight className="h-6 w-6" /></button></div>
                <div style={{ gridColumn: 2, gridRow: 3 }}><button aria-label="Down" {...antiGhostProps(() => sendDir(0, 1))} className={dpadBtn}><ArrowDown className="h-6 w-6" /></button></div>
              </div>
            </div>
          )}
          {steering && controlMode !== "buttons" && (
            <div
              ref={swipePadRef}
              className={`${glassBox} w-full flex-1 min-h-[96px] rounded-2xl relative overflow-hidden`}
              style={{ touchAction: "none" }}
            >
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-muted-foreground pointer-events-none">
                <ArrowUp className="h-4 w-4 opacity-50" />
                <div className="flex gap-2 items-center opacity-50">
                  <ArrowLeft className="h-4 w-4" />
                  <span className="text-xs font-medium">Swipe to steer</span>
                  <ArrowRight className="h-4 w-4" />
                </div>
                <ArrowDown className="h-4 w-4 opacity-50" />
              </div>
            </div>
          )}
          {!steering && <div className="flex-1" />}
        </>,
        sideEl,
      )}

      {/* LEFT: stacked player leaderboard (between the Future-buttons strip and the board) */}
      {createPortal(
        <div className={`h-full max-h-full w-full rounded-2xl overflow-hidden flex flex-col shadow-sm ${glassBox}`}>
          <div className="shrink-0 px-2.5 pt-2 pb-1 text-[8px] uppercase tracking-[.2em] font-bold opacity-50 text-center">
            Players · {leaderboard.length}
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-1.5 pb-1.5 flex flex-col gap-1">
            {leaderboard.map((p, i) => (
              <div
                key={p.id}
                className={`flex items-center gap-1.5 px-2 py-1.5 rounded-xl text-[11px] ${
                  darkMode ? "bg-white/5" : "bg-black/5"
                } ${p.id === playerId ? "ring-1 ring-emerald-500" : ""} ${!p.alive ? "opacity-55" : ""}`}
              >
                {i === 0 ? <Crown className="w-3 h-3 shrink-0 text-amber-500" /> : <span className="w-3 shrink-0 text-[9px] font-bold opacity-40 text-center">{i + 1}</span>}
                <span className="w-2.5 h-2.5 shrink-0 rounded-full" style={{ backgroundColor: p.color }} />
                <span className="font-semibold truncate flex-1 min-w-0">
                  {isBotPlayer(p) && <BotTag />}
                  {p.vip && <VipCrown className="h-3 w-3" />}
                  {p.name}
                </span>
                {!p.alive && <Skull className="w-3 h-3 shrink-0 opacity-70" />}
                <span className="font-extrabold tabular-nums">{p.score ?? 0}</span>
              </div>
            ))}
          </div>
          {lastKill && (
            <div className="shrink-0 px-2.5 py-1.5 border-t border-black/5 dark:border-white/10 text-[10px] opacity-60 leading-tight">
              💀 {killLine(lastKill, isBotId)}
            </div>
          )}
        </div>,
        leftEl,
      )}
    </>
  )
}
