"use client"

// components/royale-net-battle.tsx — Snake Battle Royale (4-8 players, 120x120 map), driven by the Socket.io server.
//
// v23: replaces components/royale-battle.tsx. Same look and layout (camera window + minimap on the board frame, royale
// HUD, victory card, survivors list on the left, steering on the right) — but the server now runs everything:
// movement, collisions, the shrinking zone (3 s grace, tail burn), food top-up, corpses -> food, winner and the bots.
// The browser only draws the interpolated snakes and sends turns.
import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { X, Skull, Crown, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Home, RotateCcw, Loader2 } from "lucide-react"
import { useBackButton } from "@/hooks/use-back-button"
import { ConfirmDialog } from "./confirm-dialog"
import { useNet } from "./net-provider"
import { BR_CELL, BR_VIEW_CELLS } from "@/lib/br/constants"
import { Camera } from "@/lib/br/camera"
import { drawBrFrame, drawMinimap, type DrawSnake, type MinimapDot } from "@/lib/br/render"
import { isInsideZone, ZoneDamageTracker } from "@/lib/br/zone"
import { useRoyaleZone } from "@/hooks/use-royale-zone"
import { useBattleSteering } from "@/hooks/use-battle-steering"
import { destroyVoiceManager } from "@/lib/voice-chat"
import { useSoundManager } from "./sound-manager"
import VoiceChat from "./voice-chat"
import { VipCrown } from "./vip-crown"
import RoyaleHud from "./royale-hud"
import RoyaleVictory from "./royale-victory"
import { BotTag } from "./bot-tag"
import { CountdownOverlay } from "@/components/countdown-overlay"
import { antiGhostProps } from "@/lib/anti-ghost"
import { isBotPlayer, getRoomSettings } from "@/lib/multiplayer"
import { killLine } from "@/lib/net-adapter"
import { DIR_VECTOR, dirFromVector, type Dir } from "@/shared/snake-protocol"
import type { NetBattleProps } from "./classic-net-battle"

const CANVAS_PX = BR_VIEW_CELLS * BR_CELL // fixed 360 x 360 — only the camera window moves

export default function RoyaleNetBattle({ darkMode, controlMode, soundEnabled, volume, centerEl, sideEl, leftEl, smoothMove = true, onExit, onBackToLobby, onReturnToRoom }: NetBattleProps) {
  const { net, mp: room } = useNet()
  const netRef = useRef(net)
  netRef.current = net
  const code = net.room?.code ?? ""
  const playerId = net.me?.playerId ?? ""
  const [nowTs, setNowTs] = useState(Date.now())
  const [endBusy, setEndBusy] = useState(false)
  const [endError, setEndError] = useState("")
  const [graceLeft, setGraceLeft] = useState<number | null>(null)
  const [spectateId, setSpectateId] = useState<string | null>(null)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const arenaWrapRef = useRef<HTMLDivElement>(null)
  const swipePadRef = useRef<HTMLDivElement>(null)

  const { playWalkSound, playFoodSound, playGameOverSound, playGameStartSound, playCountdownSound, playEliminationSound, playZoneWarningSound, playZoneShrinkSound } = useSoundManager({ enabled: soundEnabled, volume })
  const soundRef = useRef({ playWalkSound, playFoodSound, playGameOverSound, playGameStartSound, playCountdownSound, playEliminationSound, playZoneWarningSound, playZoneShrinkSound })
  soundRef.current = { playWalkSound, playFoodSound, playGameOverSound, playGameStartSound, playCountdownSound, playEliminationSound, playZoneWarningSound, playZoneShrinkSound }

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
  const gridRef = useRef(settings.grid)
  gridRef.current = settings.grid
  const darkRef = useRef(darkMode)
  darkRef.current = darkMode
  const smoothRef = useRef(smoothMove)
  smoothRef.current = smoothMove
  const iAmAlive = phase === "lobby" ? true : (myPlayer?.alive ?? true)
  const aliveRef = useRef(iAmAlive)
  aliveRef.current = iAmAlive

  // ---- zone: boxes from the server's seed, state derived from the server clock -------------------
  const offsetRef = useRef(0)
  offsetRef.current = net.serverOffsetMs
  const frozenAt = phase === "ended" ? (room?.game?.endedAt ?? null) : null
  const { stateAt, hud } = useRoyaleZone(room?.game?.zone, offsetRef, frozenAt)
  const stateAtRef = useRef(stateAt)
  stateAtRef.current = stateAt
  const damageRef = useRef(new ZoneDamageTracker())

  // ---- room lifecycle ------------------------------------------------------------------------------
  const seenRoomRef = useRef(false)
  useEffect(() => {
    if (room) seenRoomRef.current = true
    else if (seenRoomRef.current) onExitRef.current()
  }, [room])
  useEffect(() => {
    if (phase === "lobby" && seenRoomRef.current) onBackToLobbyRef.current()
  }, [phase])
  useEffect(() => {
    if (phase === "countdown") {
      setEndBusy(false)
      setEndError("")
      setGraceLeft(null)
      setSpectateId(null)
      spectateRef.current = null
      damageRef.current.reset()
      cameraRef.current = new Camera()
      lastHeadRef.current = ""
      lastScoreRef.current = 0
      killsHeardRef.current = 0
    }
  }, [phase])

  // ---- countdown + sounds -----------------------------------------------------------------------------
  useEffect(() => {
    const id = setInterval(() => setNowTs(Date.now()), 200)
    return () => clearInterval(id)
  }, [])
  const countdownNum = phase === "countdown" && net.startsAt ? Math.max(1, Math.ceil((net.startsAt - net.getServerTime()) / 1000)) : 0
  void nowTs
  useEffect(() => {
    if (countdownNum > 0) soundRef.current.playCountdownSound(countdownNum)
  }, [countdownNum])

  const prevPhaseSndRef = useRef<string>("")
  useEffect(() => {
    if (phase === "playing" && prevPhaseSndRef.current === "countdown") soundRef.current.playGameStartSound()
    if (phase === "ended" && prevPhaseSndRef.current !== "ended") soundRef.current.playGameStartSound()
    prevPhaseSndRef.current = phase
  }, [phase])
  const wasAliveRef = useRef(true)
  useEffect(() => {
    if (phase === "playing" && wasAliveRef.current && !iAmAlive) {
      soundRef.current.playGameOverSound()
      setGraceLeft(null)
    }
    wasAliveRef.current = iAmAlive
  }, [iAmAlive, phase])
  const killsHeardRef = useRef(0)
  useEffect(() => {
    const n = net.killFeed.length
    if (phase === "playing" && !iAmAlive && n > killsHeardRef.current && net.killFeed[0]?.id !== playerId) soundRef.current.playEliminationSound()
    killsHeardRef.current = n
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [net.killFeed])
  const prevZoneSndRef = useRef({ warning: false, shrinking: false })
  useEffect(() => {
    const z = hud.state
    const p = prevZoneSndRef.current
    if (phase === "playing") {
      if (z.warning && !p.warning) soundRef.current.playZoneWarningSound()
      if (z.shrinking && !p.shrinking) soundRef.current.playZoneShrinkSound()
    }
    prevZoneSndRef.current = { warning: z.warning, shrinking: z.shrinking }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hud.state.warning, hud.state.shrinking, phase])

  const cameraRef = useRef(new Camera())
  const spectateRef = useRef<string | null>(null)
  const lastHeadRef = useRef("")
  const lastScoreRef = useRef(0)
  const graceSecRef = useRef<number | null>(null)

  // ---- spectator: who does the camera follow? -----------------------------------------------------------
  const resolveFollowId = (snakeIds: string[]): string | null => {
    if (aliveRef.current) return netRef.current.me?.playerId ?? null
    const alive = snakeIds.filter((id) => id !== netRef.current.me?.playerId)
    if (alive.length === 0) return null
    const cur = spectateRef.current
    if (cur && alive.includes(cur)) return cur
    // first choice: whoever eliminated me, otherwise the first survivor
    const killerId = netRef.current.killFeed.find((k) => k.id === netRef.current.me?.playerId)?.killerId
    const next = alive.find((id) => id === killerId) ?? alive[0]
    spectateRef.current = next
    setSpectateId(next)
    return next
  }
  const cycleSpectate = () => {
    if (aliveRef.current || phaseRef.current !== "playing") return
    const ids = netRef.current.sampleSnakes().map((s) => s.id).filter((id) => id !== netRef.current.me?.playerId)
    if (ids.length < 2) return
    const i = ids.indexOf(spectateRef.current ?? "")
    const next = ids[(i + 1) % ids.length]
    spectateRef.current = next
    setSpectateId(next)
  }

  // ---- 60 fps render loop (interpolated snakes + smooth camera) --------------------------------------------
  useEffect(() => {
    let raf = 0
    let last = performance.now()
    const frame = (t: number) => {
      raf = requestAnimationFrame(frame)
      const canvas = canvasRef.current
      const ctx = canvas?.getContext("2d")
      const n = netRef.current
      if (!canvas || !ctx || !n.config) return
      const dt = Math.min(100, t - last)
      last = t
      const serverNow = n.getServerTime()
      const zone = stateAtRef.current(serverNow)
      const sampled = n.sampleSnakes(t)
      const followId = resolveFollowId(sampled.map((s) => s.id))

      const snakes: DrawSnake[] = []
      const dots: MinimapDot[] = []
      for (const s of sampled) {
        const seg = smoothRef.current ? s.seg : s.seg.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) }))
        if (seg.length === 0) continue
        snakes.push({ id: s.id, color: s.color, seg, mine: s.mine })
        dots.push({ color: s.color, x: seg[0].x, y: seg[0].y, mine: s.mine })
      }
      const target = snakes.find((s) => s.id === followId)?.seg[0]
      if (target) cameraRef.current.follow(target.x, target.y, dt)

      // my own head vs the zone: only for the "get back in!" countdown (the SERVER does the real killing)
      const mine = snakes.find((s) => s.mine)
      if (mine && phaseRef.current === "playing") {
        const hx = Math.round(mine.seg[0].x)
        const hy = Math.round(mine.seg[0].y)
        const z = damageRef.current.update(isInsideZone(zone.box, hx, hy), serverNow)
        const sec = z.outside ? Math.ceil(z.graceLeftMs / 1000) : null
        if (sec !== graceSecRef.current) {
          graceSecRef.current = sec
          setGraceLeft(z.outside ? z.graceLeftMs : null)
        }
        const key = `${hx},${hy}`
        if (key !== lastHeadRef.current) {
          lastHeadRef.current = key
          soundRef.current.playWalkSound() // soft slither on every step
        }
      }
      const mv = n.gameViewRef.current.snakes.get(n.me?.playerId ?? "")
      if (mv) {
        if (mv.score > lastScoreRef.current && phaseRef.current === "playing") soundRef.current.playFoodSound()
        lastScoreRef.current = mv.score
      }

      drawBrFrame(ctx, {
        camera: cameraRef.current,
        zone,
        foods: [...n.gameViewRef.current.foods.values()].map((f) => ({ x: f.x, y: f.y })),
        snakes,
        now: Date.now(),
        darkMode: darkRef.current,
        grid: gridRef.current,
        followId,
      })
      drawMinimap(ctx, { camera: cameraRef.current, zone, dots, now: Date.now() })
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---- controls ------------------------------------------------------------------------------------------------
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

  const handleExit = async () => {
    destroyVoiceManager(code, playerId)
    await net.leaveRoom().catch(() => {})
    onExit()
  }

  const handleRematch = async () => {
    if (!isHost || endBusy) return
    setEndBusy(true)
    setEndError("")
    const r = await net.startGame() // the room mode is "royale", the server starts a Battle Royale
    if (!r.ok) {
      setEndError(r.message)
      setEndBusy(false)
    }
  }

  // "Back to room" — available to EVERYONE on the result screen (winner, spectators, guests).
  //  * host: reset the room -> status "lobby" -> every client's screen goes back to the lobby.
  //  * everyone else: step back into the room view right now; the lobby waits there for the host's next round.
  const handleBackToRoom = async () => {
    if (endBusy) return
    if (isHost) {
      setEndBusy(true)
      setEndError("")
      const r = await net.resetRoom()
      if (!r.ok) {
        setEndError(r.message || "Could not go back to the room.")
        setEndBusy(false)
      }
      return
    }
    ;(onReturnToRoom ?? onBackToLobbyRef.current)()
  }

  // ---- derived UI ------------------------------------------------------------------------------------------------
  const players = Object.values(room?.players ?? {})
  const aliveCount = players.filter((p) => p.alive).length
  const total = players.length
  const ranking = [...players].sort((a, b) => Number(b.alive) - Number(a.alive) || (b.kills ?? 0) - (a.kills ?? 0) || (b.score ?? 0) - (a.score ?? 0))
  const myDeath = net.killFeed.find((k) => k.id === playerId)
  const placement = !iAmAlive && phase !== "lobby" ? (myDeath?.placement ?? null) : null
  const spectatingName = phase === "playing" && !iAmAlive ? (room?.players?.[spectateId ?? ""]?.name ?? "") : null
  const steering = (phase === "countdown" || phase === "playing") && iAmAlive
  const glassBox = "bg-white/70 dark:bg-white/5 border border-black/5 dark:border-white/10"
  const dpadBtn = `${glassBox} d-pad-btn anti-ghost w-full h-full min-h-[48px] min-w-[48px] rounded-2xl flex items-center justify-center active:scale-95 transition-transform`
  const isBotId = (id: string | null) => !!id && isBotPlayer({ id, bot: room?.players?.[id]?.bot })
  const lastKill = net.killFeed[0]

  // Android Back: ask before leaving a live battle (nothing to lose on the end screen)
  const [confirmLeave, setConfirmLeave] = useState(false)
  useBackButton(true, () => {
    if (phase === "ended") void handleExit()
    else setConfirmLeave(true)
  })
  if (!centerEl || !sideEl || !leftEl) return null

  return (
    <>
      <ConfirmDialog
        open={confirmLeave}
        title="Leave battle?"
        message="You will leave the room and lose your place in this match."
        confirmLabel="Leave"
        onCancel={() => setConfirmLeave(false)}
        onConfirm={() => {
          setConfirmLeave(false)
          void handleExit()
        }}
      />
      {/* CENTER: fixed-size canvas; the camera window + minimap are drawn inside it */}
      {createPortal(
        <div
          ref={arenaWrapRef}
          onClick={cycleSpectate}
          className="relative rounded-2xl overflow-hidden premium-glow border border-black/10 dark:border-white/10"
          style={{ width: "min(100cqw, 100cqh)", aspectRatio: "1 / 1" }}
        >
          <canvas ref={canvasRef} width={CANVAS_PX} height={CANVAS_PX} className="block w-full h-full touch-none" />

          {(phase === "playing" || phase === "ended") && (
            <RoyaleHud
              alive={aliveCount}
              total={total}
              elapsedMs={hud.elapsedMs}
              zone={hud.state}
              graceLeftMs={graceLeft}
              spectating={phase === "playing" && !iAmAlive ? (spectatingName ?? "") : null}
              placement={placement}
            />
          )}

          <CountdownOverlay value={phase === "countdown" ? countdownNum : 0} label="BATTLE ROYALE" sub={`${total} players`} />

          {phase === "ended" && (
            <RoyaleVictory
              players={players}
              winnerId={room?.game?.winner ?? null}
              myId={playerId}
              startAt={room?.game?.zone?.startAt ?? room?.game?.endedAt ?? net.getServerTime()}
              endedAt={room?.game?.endedAt ?? net.getServerTime()}
            />
          )}
        </div>,
        centerEl,
      )}

      {/* RIGHT: dashboard — kills / exit / score + steering */}
      {createPortal(
        <>
          <div className="flex items-center justify-between gap-1">
            <div className="text-[11px] font-bold leading-none">
              👑 Royale <span className="font-mono opacity-50">{code}</span>
            </div>
            <VoiceChat code={code} playerId={playerId} playerName={myPlayer?.name ?? "Player"} darkMode={darkMode} compact />
          </div>

          <div className="grid grid-cols-[1fr_auto_1fr] items-stretch gap-1.5">
            <div className="rounded-xl bg-white/70 dark:bg-white/[0.06] border border-black/5 dark:border-white/10 px-2.5 py-1 text-center">
              <div className="text-[8px] uppercase tracking-wider opacity-50 font-semibold">Kills</div>
              <div className="text-base font-extrabold tabular-nums leading-tight">{myPlayer?.kills ?? 0}</div>
            </div>
            <button
              aria-label="Leave battle"
              title="Leave battle"
              onClick={handleExit}
              className="d-pad-btn self-center h-10 w-10 rounded-full flex items-center justify-center text-red-500 bg-white/70 dark:bg-white/5 border border-red-500/30 shadow-sm active:scale-90 transition-transform"
            >
              <X className="h-5 w-5" />
            </button>
            <div className="rounded-xl bg-white/70 dark:bg-white/[0.06] border border-black/5 dark:border-white/10 px-2.5 py-1 text-center">
              <div className="text-[8px] uppercase tracking-wider opacity-50 font-semibold">Score</div>
              <div className="text-base font-extrabold tabular-nums leading-tight">{myPlayer?.score ?? 0}</div>
            </div>
          </div>

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
            <div ref={swipePadRef} className={`${glassBox} w-full flex-1 min-h-[96px] rounded-2xl relative overflow-hidden`} style={{ touchAction: "none" }}>
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
          {phase === "ended" ? (
            <div className="flex flex-1 flex-col justify-center gap-1.5">
              <button
                onClick={handleBackToRoom}
                disabled={endBusy}
                aria-label="Back to room"
                className="d-pad-btn h-11 w-full rounded-xl flex items-center justify-center gap-2 text-white text-sm font-bold bg-gradient-to-r from-emerald-500 to-emerald-400 shadow-md shadow-emerald-500/30 active:scale-95 transition-transform disabled:opacity-50"
              >
                {endBusy && !isHost ? <Loader2 className="h-5 w-5 animate-spin" /> : <Home className="h-5 w-5" />} Back to room
              </button>
              {isHost && (
                <button
                  onClick={handleRematch}
                  disabled={endBusy}
                  aria-label="Rematch"
                  className="d-pad-btn h-10 w-full rounded-xl flex items-center justify-center gap-2 text-sm font-bold bg-white/70 dark:bg-white/10 border border-black/10 dark:border-white/15 active:scale-95 transition-transform disabled:opacity-50"
                >
                  {endBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />} Rematch
                </button>
              )}
              {!isHost && <div className="text-center text-[10px] opacity-60">The host picks the next round</div>}
              {endError && <div className="text-center text-[10px] text-red-500">{endError}</div>}
            </div>
          ) : (
            !steering && <div className="flex-1" />
          )}
        </>,
        sideEl,
      )}

      {/* LEFT: survivors first, then by kills */}
      {createPortal(
        <div className={`h-full max-h-full w-full rounded-2xl overflow-hidden flex flex-col shadow-sm ${glassBox}`}>
          <div className="shrink-0 px-2.5 pt-2 pb-1 text-[8px] uppercase tracking-[.2em] font-bold opacity-50 text-center">
            Alive · {aliveCount}/{total}
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-1.5 pb-1.5 flex flex-col gap-1">
            {ranking.map((p, i) => (
              <div
                key={p.id}
                className={`flex items-center gap-1.5 px-2 py-1.5 rounded-xl text-[11px] ${darkMode ? "bg-white/5" : "bg-black/5"} ${p.id === playerId ? "ring-1 ring-emerald-500" : ""} ${!p.alive ? "opacity-55" : ""}`}
              >
                {i === 0 && p.alive ? <Crown className="w-3 h-3 shrink-0 text-amber-500" /> : <span className="w-3 shrink-0 text-[9px] font-bold opacity-40 text-center">{i + 1}</span>}
                <span className="w-2.5 h-2.5 shrink-0 rounded-full" style={{ backgroundColor: p.color }} />
                <span className="font-semibold truncate flex-1 min-w-0">
                  {isBotPlayer(p) && <BotTag />}
                  {p.vip && <VipCrown className="h-3 w-3" />}
                  {p.name}
                </span>
                {!p.alive && <Skull className="w-3 h-3 shrink-0 opacity-70" />}
                <span className="font-extrabold tabular-nums" title="kills">{p.kills ?? 0}</span>
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
