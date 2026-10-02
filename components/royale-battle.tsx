"use client"

// components/royale-battle.tsx — Snake Battle Royale engine + UI (4-8 players, 120x120 map).
//
// Reuses the classic battle's architecture on purpose:
//   * every client owns its snake and broadcasts it every grid tick (rooms/{CODE}/snakes/{id})
//   * collisions are judged by the victim's own client (victim-authoritative)
//   * the same portal slots (centerEl / sideEl / leftEl) of the classic board frame
// Battle-Royale additions:
//   * host-authoritative: zone clock (written once), food top-up (1x / s), spawn seats, winner
//   * transactional food claims, interpolated rendering (60 fps) over 6-7 Hz grid ticks
//   * camera window + minimap, shrinking zone with 3 s grace, spectator mode, victory stats
import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { X, Skull, Crown, ArrowUp, ArrowDown, ArrowLeft, ArrowRight } from "lucide-react"
import { ref, set, update, remove, onValue, push, increment, onDisconnect, runTransaction, serverTimestamp } from "firebase/database"
import { getFirebaseDb } from "@/lib/firebase"
import {
  subscribeToRoom,
  subscribeServerOffset,
  leaveRoom,
  resetRoomForRematch,
  startBattle,
  snakesRef,
  mySnakeRef,
  killFeedRef,
  BATTLE_KILL_SCORE,
  BATTLE_SNAKE_STALE_MS,
  getRoomSettings,
  playerDisplayName,
  type MpRoom,
  type MpSnakeState,
  type KillEntry,
} from "@/lib/multiplayer"
import { BR_FOOD_REFILL_MS, BR_GRID, BR_CELL, BR_MIN_LENGTH, BR_START_LENGTH, BR_TICK_MS, BR_VIEW_CELLS, ZONE_TAIL_DAMAGE } from "@/lib/br/constants"
import { claimFood, dropFoodFromBody, foodsRef, hostMaintainFood, type BrFoods } from "@/lib/br/net"
import { Camera } from "@/lib/br/camera"
import { SnakeInterpolator } from "@/lib/br/interpolation"
import { computeSpawns } from "@/lib/br/spawns"
import { drawBrFrame, drawMinimap, type DrawSnake, type MinimapDot } from "@/lib/br/render"
import { isInsideZone } from "@/lib/br/zone"
import { useRoyaleZone, useZoneDamageTracker } from "@/hooks/use-royale-zone"
import { useBattleSteering } from "@/hooks/use-battle-steering"
import { useBotHost } from "@/hooks/use-bot-host"
import { destroyVoiceManager } from "@/lib/voice-chat"
import { useSoundManager } from "./sound-manager"
import VoiceChat from "./voice-chat"
import { VipCrown } from "./vip-crown"
import RoyaleHud from "./royale-hud"
import RoyaleVictory from "./royale-victory"

const CANVAS_PX = BR_VIEW_CELLS * BR_CELL // fixed 360 x 360 — only the camera window moves

export interface RoyaleBattleProps {
  code: string
  playerId: string
  darkMode: boolean
  controlMode: "buttons" | "swipe"
  soundEnabled: boolean
  volume: number
  /** classic frame slots: board (center), dashboard (right), player column (left) */
  centerEl: HTMLElement | null
  sideEl: HTMLElement | null
  leftEl: HTMLElement | null
  bestScore: number
  onExit: () => void
  onBackToLobby: () => void
}

interface Seg {
  x: number
  y: number
}
type KillItem = KillEntry & { key: string }
interface RemoteSnake {
  interp: SnakeInterpolator
  /** last `ts` seen (compared for change only, so device clock skew is irrelevant) */
  ts: number
  /** local receive time — used for the staleness check */
  recvAt: number
}

export default function RoyaleBattle({ code, playerId, darkMode, controlMode, soundEnabled, volume, centerEl, sideEl, leftEl, onExit, onBackToLobby }: RoyaleBattleProps) {
  const [room, setRoom] = useState<MpRoom | null>(null)
  const [kills, setKills] = useState<KillItem[]>([])
  const [nowTs, setNowTs] = useState(Date.now())
  const [endBusy, setEndBusy] = useState(false)
  const [endError, setEndError] = useState("")
  const [graceLeft, setGraceLeft] = useState<number | null>(null)
  const [spectateId, setSpectateId] = useState<string | null>(null)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const arenaWrapRef = useRef<HTMLDivElement>(null)
  const swipePadRef = useRef<HTMLDivElement>(null)

  // ---- mutable game state (read inside the tick / render loops) ----------------
  const offsetRef = useRef(0) // server clock - local clock
  const roomRef = useRef<MpRoom | null>(null)
  const phaseRef = useRef("lobby")
  const aliveRef = useRef(true)
  const snakeRef = useRef<Seg[]>([])
  const dirRef = useRef({ x: 1, y: 0 })
  const pendingDirRef = useRef({ x: 1, y: 0 })
  const growthRef = useRef(0)
  const myInterp = useRef(new SnakeInterpolator())
  const remotesRef = useRef<Map<string, RemoteSnake>>(new Map())
  const snakesRawRef = useRef<Record<string, MpSnakeState>>({})
  const foodsStateRef = useRef<BrFoods>({})
  const foodCellRef = useRef<Map<string, string>>(new Map())
  const claimingRef = useRef<Set<string>>(new Set())
  const killsRef = useRef<KillItem[]>([])
  const cameraRef = useRef(new Camera())
  const spectateRef = useRef<string | null>(null)
  const spawnedRef = useRef(false)
  const prevStatusRef = useRef<string | null>(null)
  const playedWriteRef = useRef(false)
  const endedWriteRef = useRef(false)
  const appliedKillsRef = useRef<Set<string>>(new Set())
  const loopRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const tickerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const onBackToLobbyRef = useRef(onBackToLobby)
  const onExitRef = useRef(onExit)
  onBackToLobbyRef.current = onBackToLobby
  onExitRef.current = onExit

  const serverNow = () => Date.now() + offsetRef.current

  const { playFoodSound, playGameOverSound, playGameStartSound } = useSoundManager({ enabled: soundEnabled, volume })
  const soundRef = useRef({ playFoodSound, playGameOverSound, playGameStartSound })
  soundRef.current = { playFoodSound, playGameOverSound, playGameStartSound }

  // Host simulates every AI bot in the room (no-op unless I am the host)
  useBotHost(code, playerId)

  const phase = room?.status ?? "lobby"
  phaseRef.current = phase
  const myPlayer = room?.players?.[playerId] ?? null
  const isHost = room?.hostId === playerId
  const settings = getRoomSettings(room)
  const gridRef = useRef(settings.grid)
  gridRef.current = settings.grid
  const darkRef = useRef(darkMode)
  darkRef.current = darkMode
  const myColorRef = useRef("#3af08d")
  myColorRef.current = myPlayer?.color ?? "#3af08d"

  // ---- zone (hook): boxes from the host's seed, state derived from server time ----
  const frozenAt = room?.status === "ended" ? (room.game?.endedAt ?? null) : null
  const { stateAt, hud } = useRoyaleZone(room?.game?.zone, offsetRef, frozenAt)
  const stateAtRef = useRef(stateAt)
  stateAtRef.current = stateAt
  const damage = useZoneDamageTracker()

  // ---- subscriptions ----------------------------------------------------------
  useEffect(() => {
    const unsubOffset = subscribeServerOffset((o) => {
      offsetRef.current = o
    })
    const unsubRoom = subscribeToRoom(code, (r) => {
      if (r === null) {
        onExitRef.current()
        return
      }
      roomRef.current = r
      setRoom(r)
      if (r.status === "lobby") onBackToLobbyRef.current()
      if (r.status === "countdown") {
        playedWriteRef.current = false
        endedWriteRef.current = false
        if (prevStatusRef.current !== "countdown") {
          // fresh round (first start or direct rematch): reset everything local
          aliveRef.current = true
          growthRef.current = 0
          appliedKillsRef.current.clear()
          claimingRef.current.clear()
          remotesRef.current.clear()
          myInterp.current.clear()
          cameraRef.current = new Camera()
          spectateRef.current = null
          spawnedRef.current = false
          damage.reset()
          setSpectateId(null)
          setGraceLeft(null)
          setEndBusy(false)
          setEndError("")
        }
      }
      prevStatusRef.current = r.status
    })
    const unsubSnakes = onValue(snakesRef(code), (snap) => {
      const v = (snap.val() ?? {}) as Record<string, MpSnakeState>
      snakesRawRef.current = v
      const now = Date.now()
      const map = remotesRef.current
      for (const [pid, s] of Object.entries(v)) {
        if (pid === playerId) continue
        let rs = map.get(pid)
        if (!rs) {
          rs = { interp: new SnakeInterpolator(), ts: -1, recvAt: now }
          map.set(pid, rs)
        }
        if (rs.ts !== s.ts) {
          rs.ts = s.ts
          rs.recvAt = now
          rs.interp.push(s.seg ?? [], now) // feeds the 60 fps interpolation
        }
      }
      for (const pid of [...map.keys()]) if (!(pid in v)) map.delete(pid)
    })
    const unsubFoods = onValue(foodsRef(code), (snap) => {
      const v = (snap.val() ?? {}) as BrFoods
      foodsStateRef.current = v
      const cells = new Map<string, string>()
      for (const [id, c] of Object.entries(v)) cells.set(`${c.x},${c.y}`, id)
      foodCellRef.current = cells
    })
    const unsubKills = onValue(killFeedRef(code), (snap) => {
      const val = (snap.val() ?? {}) as Record<string, KillEntry>
      const items: KillItem[] = Object.entries(val)
        .map(([key, e]) => ({ key, ...e }))
        .sort((a, b) => a.ts - b.ts)
      killsRef.current = items
      setKills(items.slice(-6))
      // killer grows +2 (once per kill, applied locally — same rule as the classic battle)
      for (const it of items) {
        if (it.killerId === playerId && !appliedKillsRef.current.has(it.key)) {
          appliedKillsRef.current.add(it.key)
          growthRef.current += 2
        }
      }
    })
    return () => {
      unsubOffset()
      unsubRoom()
      unsubSnakes()
      unsubFoods()
      unsubKills()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code])

  // ---- spawn my snake on my seat of the ring ------------------------------------
  useEffect(() => {
    if (!room || spawnedRef.current || !room.game?.zone) return
    if (room.status !== "countdown" && room.status !== "playing") return
    const order =
      room.game.order ??
      Object.values(room.players ?? {})
        .sort((a, b) => (a.joinedAt ?? 0) - (b.joinedAt ?? 0))
        .map((p) => p.id)
    const seat = Math.max(0, order.indexOf(playerId))
    const spawns = computeSpawns(order.length, room.game.zone.seed % 360)
    const s = spawns[seat % spawns.length]
    dirRef.current = { x: s.dx, y: s.dy }
    pendingDirRef.current = { x: s.dx, y: s.dy }
    const snake: Seg[] = []
    for (let i = 0; i < BR_START_LENGTH; i++) snake.push({ x: s.x - s.dx * i, y: s.y - s.dy * i })
    snakeRef.current = snake
    spawnedRef.current = true
    myInterp.current.clear()
    myInterp.current.push([...snake], Date.now())
    cameraRef.current.snapTo(s.x, s.y)
    set(mySnakeRef(code, playerId), { seg: snake, dx: s.dx, dy: s.dy, ts: serverNow() }).catch(() => {})
    // v19.0.1 audit fix: crash/network-drop par ghost alive:true na rahe —
    // Firebase khud player ko dead mark karega aur snake node hata dega.
    // (serverTimestamp disconnect ke waqt evaluate hota hai, arm ke waqt nahi.)
    onDisconnect(ref(getFirebaseDb(), `rooms/${code}/players/${playerId}`))
      .update({ alive: false, diedAt: serverTimestamp() }).catch(() => {})
    onDisconnect(mySnakeRef(code, playerId)).remove().catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room])

  // ---- shared countdown (server time) -> flips countdown -> playing --------------
  useEffect(() => {
    tickerRef.current = setInterval(() => {
      setNowTs(Date.now())
      const r = roomRef.current
      if (r?.status === "countdown" && r.game?.countdownEndsAt && serverNow() >= r.game.countdownEndsAt && !playedWriteRef.current) {
        playedWriteRef.current = true
        update(ref(getFirebaseDb(), `rooms/${code}`), { status: "playing" }).catch(() => {})
      }
    }, 200)
    return () => {
      if (tickerRef.current) clearInterval(tickerRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code])

  // ---- death ---------------------------------------------------------------------
  const die = (cause: KillEntry["cause"], killerId?: string, killerName?: string) => {
    if (!aliveRef.current) return
    aliveRef.current = false
    setGraceLeft(null)
    const db = getFirebaseDb()
    const t = serverNow()
    const me = roomRef.current?.players?.[playerId]
    const body = [...snakeRef.current]
    update(ref(db, `rooms/${code}/players/${playerId}`), { alive: false, diedAt: t }).catch(() => {})
    remove(mySnakeRef(code, playerId)).catch(() => {})
    dropFoodFromBody(code, body, stateAtRef.current(t).box).catch(() => {}) // corpse -> food
    const entry: KillEntry = { killerId: killerId ?? null, killerName: killerName ?? "", victimId: playerId, victimName: me?.name ?? "Player", cause, ts: t }
    push(killFeedRef(code), entry).catch(() => {})
    if (killerId) {
      update(ref(db, `rooms/${code}/players/${killerId}`), { score: increment(BATTLE_KILL_SCORE), kills: increment(1) }).catch(() => {})
    }
    myInterp.current.clear()
    soundRef.current.playGameOverSound()
  }

  // ---- one grid tick (classic 4-way movement) --------------------------------------
  const doTick = () => {
    if (!aliveRef.current || phaseRef.current !== "playing") return
    const d = dirRef.current
    const pd = pendingDirRef.current
    if (pd.x !== -d.x || pd.y !== -d.y) dirRef.current = { ...pd }
    const dir = dirRef.current
    const head = snakeRef.current[0]
    if (!head) return
    const nx = head.x + dir.x
    const ny = head.y + dir.y

    // 1) world wall (the big map edge always kills — no teleport in Battle Royale)
    if (nx < 0 || nx >= BR_GRID || ny < 0 || ny >= BR_GRID) return die("wall")
    // 2) myself — the tail cell vacates this tick unless pending growth keeps it
    // (v19.0.1 audit fix: false "self" deaths when the head moves into the cell
    // the tail just left). growthRef is consumed AFTER this check, same as the pop.
    const myBody = growthRef.current > 0 ? snakeRef.current : snakeRef.current.slice(0, -1)
    if (myBody.some((s, i) => i > 0 && s.x === nx && s.y === ny)) return die("self")
    // 3) other snakes' bodies / heads (fresh snapshots only)
    const now = Date.now()
    for (const [pid, s] of Object.entries(snakesRawRef.current)) {
      if (pid === playerId) continue
      const rs = remotesRef.current.get(pid)
      if (rs && now - rs.recvAt > BATTLE_SNAKE_STALE_MS) continue
      if ((s.seg ?? []).some((c) => c.x === nx && c.y === ny)) {
        return die("kill", pid, roomRef.current?.players?.[pid]?.name ?? "Player")
      }
    }
    // 4) safe zone: 3 s grace outside, tail burns meanwhile
    const t = serverNow()
    const zs = stateAtRef.current(t)
    const z = damage.update(isInsideZone(zs.box, nx, ny), t)
    if (z.dead) return die("zone")
    setGraceLeft(z.outside ? z.graceLeftMs : null)

    // 5) food: claimed with a transaction, so two snakes can never eat the same one
    const fid = foodCellRef.current.get(`${nx},${ny}`)
    if (fid && !claimingRef.current.has(fid)) {
      claimingRef.current.add(fid)
      delete foodsStateRef.current[fid]
      foodCellRef.current.delete(`${nx},${ny}`)
      claimFood(code, fid).then((ok) => {
        claimingRef.current.delete(fid)
        if (!ok || !aliveRef.current) return
        growthRef.current += 1
        soundRef.current.playFoodSound()
        update(ref(getFirebaseDb(), `rooms/${code}/players/${playerId}`), { score: increment(1) }).catch(() => {})
      })
    }

    snakeRef.current.unshift({ x: nx, y: ny })
    if (growthRef.current > 0) growthRef.current -= 1
    else snakeRef.current.pop()
    if (z.outside && ZONE_TAIL_DAMAGE && snakeRef.current.length > BR_MIN_LENGTH) snakeRef.current.pop()

    myInterp.current.push([...snakeRef.current], now)
    set(mySnakeRef(code, playerId), { seg: snakeRef.current, dx: dir.x, dy: dir.y, ts: t }).catch(() => {})
  }

  useEffect(() => {
    if (phase === "playing" && aliveRef.current) loopRef.current = setInterval(doTick, BR_TICK_MS)
    return () => {
      if (loopRef.current) {
        clearInterval(loopRef.current)
        loopRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  useEffect(() => {
    if (phase === "countdown") soundRef.current.playGameStartSound()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  // ---- HOST duties: keep food on the map (runs on whoever is host, so it survives host migration) ----
  useEffect(() => {
    if (!isHost || phase !== "playing") return
    const id = setInterval(() => {
      const zs = stateAtRef.current(serverNow())
      const occupied = new Set<string>()
      for (const s of Object.values(snakesRawRef.current)) for (const c of s.seg ?? []) occupied.add(`${c.x},${c.y}`)
      hostMaintainFood(code, foodsStateRef.current, zs, occupied).catch(() => {})
    }, BR_FOOD_REFILL_MS)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHost, phase, code])

  // ---- win condition: last snake standing ----------------------------------------------
  useEffect(() => {
    if (!room || room.status !== "playing" || endedWriteRef.current) return
    const players = Object.values(room.players ?? {})
    const alive = players.filter((p) => p.alive)
    if (alive.length > 1) return
    endedWriteRef.current = true
    // nobody left alive (same-tick deaths): the one who lasted longest wins
    const winnerId =
      alive[0]?.id ?? [...players].sort((a, b) => (b.diedAt ?? 0) - (a.diedAt ?? 0) || (b.kills ?? 0) - (a.kills ?? 0))[0]?.id ?? null
    // v19.0.1 audit fix: first-writer-wins transaction. Har client apna winner
    // compute karta hai aur same-tick deaths par ye alag ho sakta hai —
    // plain update (last-write-wins) galat player ko jita deta. Pehla committed
    // writer jeetta hai, baaki abort hote hain.
    void (async () => {
      try {
        const res = await runTransaction(ref(getFirebaseDb(), `rooms/${code}/game`), (g) => {
          const cur = (g ?? {}) as Record<string, unknown>
          if (cur["status"] === "ended" || cur["winner"] != null) return // koi pehle end kar chuka — abort
          return { ...cur, status: "ended", winner: winnerId, endedAt: serverNow() }
        })
        if (res.committed) {
          await update(ref(getFirebaseDb(), `rooms/${code}`), { status: "ended" }).catch(() => {})
        }
      } catch {
        /* best-effort: doosra client end kar dega */
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room])

  useEffect(() => {
    if (room?.status === "ended" && room.game?.winner === playerId && aliveRef.current) soundRef.current.playGameStartSound()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room?.status])

  // ---- spectator: who does the camera follow? ------------------------------------------
  const survivors = () =>
    Object.values(roomRef.current?.players ?? {})
      .filter((p) => p.alive && p.id !== playerId && remotesRef.current.has(p.id))
      .sort((a, b) => (a.joinedAt ?? 0) - (b.joinedAt ?? 0))

  const resolveFollowId = (): string | null => {
    if (aliveRef.current) return playerId
    const alive = survivors()
    if (alive.length === 0) {
      const w = roomRef.current?.game?.winner
      return w && w !== playerId && remotesRef.current.has(w) ? w : null
    }
    const cur = spectateRef.current
    if (cur && (alive.some((p) => p.id === cur) || roomRef.current?.game?.winner === cur)) return cur
    // first choice: whoever eliminated me, otherwise the first survivor
    const killerId = killsRef.current.find((k) => k.victimId === playerId)?.killerId
    const next = alive.find((p) => p.id === killerId) ?? alive[0]
    spectateRef.current = next.id
    setSpectateId(next.id)
    return next.id
  }

  const cycleSpectate = () => {
    if (aliveRef.current || phaseRef.current !== "playing") return
    const alive = survivors()
    if (alive.length < 2) return
    const i = alive.findIndex((p) => p.id === spectateRef.current)
    const next = alive[(i + 1) % alive.length]
    spectateRef.current = next.id
    setSpectateId(next.id)
  }

  // ---- 60 fps render loop (interpolated snakes + smooth camera) -----------------------------
  useEffect(() => {
    let raf = 0
    let last = performance.now()
    const frame = (t: number) => {
      raf = requestAnimationFrame(frame)
      const canvas = canvasRef.current
      const ctx = canvas?.getContext("2d")
      if (!canvas || !ctx) return
      const dt = Math.min(100, t - last)
      last = t
      const now = Date.now()
      const r = roomRef.current
      const zone = stateAtRef.current(now + offsetRef.current)
      const followId = resolveFollowId()

      const snakes: DrawSnake[] = []
      const dots: MinimapDot[] = []
      if (aliveRef.current && snakeRef.current.length > 0) {
        const seg = myInterp.current.sample(now)
        if (seg.length > 0) {
          snakes.push({ id: playerId, color: myColorRef.current, seg, mine: true })
          dots.push({ color: myColorRef.current, x: seg[0].x, y: seg[0].y, mine: true })
        }
      }
      for (const [pid, rs] of remotesRef.current) {
        const p = r?.players?.[pid]
        if (!p || !p.alive || now - rs.recvAt > BATTLE_SNAKE_STALE_MS) continue
        const seg = rs.interp.sample(now)
        if (seg.length === 0) continue
        snakes.push({ id: pid, color: p.color, seg, mine: false })
        dots.push({ color: p.color, x: seg[0].x, y: seg[0].y, mine: false })
      }

      const target = snakes.find((s) => s.id === followId)?.seg[0]
      if (target) cameraRef.current.follow(target.x, target.y, dt)

      drawBrFrame(ctx, {
        camera: cameraRef.current,
        zone,
        foods: Object.values(foodsStateRef.current),
        snakes,
        now,
        darkMode: darkRef.current,
        grid: gridRef.current,
        followId,
      })
      drawMinimap(ctx, { camera: cameraRef.current, zone, dots, now })
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---- controls (same behaviour as the classic battle) ----------------------------------------
  const setDir = (x: number, y: number) => {
    pendingDirRef.current = { x, y }
  }
  const iAmAlive = myPlayer?.alive ?? true
  useBattleSteering({
    canSteer: () => phaseRef.current === "playing" && aliveRef.current,
    controlMode,
    getDir: () => dirRef.current,
    setDir,
    getSurfaces: () => [swipePadRef.current, arenaWrapRef.current],
    rerunKey: `${phase}|${iAmAlive}|${!!centerEl}|${!!sideEl}|${!!leftEl}`,
  })

  const handleExit = async () => {
    if (loopRef.current) clearInterval(loopRef.current)
    if (tickerRef.current) clearInterval(tickerRef.current)
    destroyVoiceManager(code, playerId)
    try {
      await leaveRoom(code, playerId)
    } catch {}
    onExit()
  }

  const handleRematch = async () => {
    if (!isHost || endBusy) return
    setEndBusy(true)
    setEndError("")
    try {
      await startBattle(code) // dispatches to Battle Royale because the room mode is "royale"
    } catch (e) {
      setEndError(e instanceof Error ? e.message : "Could not start the rematch.")
      setEndBusy(false)
    }
  }

  const handleBackToRoom = async () => {
    if (!isHost || endBusy) return
    setEndBusy(true)
    setEndError("")
    try {
      await resetRoomForRematch(code)
    } catch {
      setEndError("Could not go back to the room.")
      setEndBusy(false)
    }
  }

  // ---- derived UI ------------------------------------------------------------------------------
  const players = Object.values(room?.players ?? {})
  const aliveCount = players.filter((p) => p.alive).length
  const total = Math.max(room?.game?.order?.length ?? 0, players.length)
  const countdownEndsAt = room?.game?.countdownEndsAt ?? 0
  const countdownNum = phase === "countdown" ? Math.max(1, Math.ceil((countdownEndsAt - (nowTs + offsetRef.current)) / 1000)) : 0
  const ranking = [...players].sort((a, b) => Number(b.alive) - Number(a.alive) || (b.kills ?? 0) - (a.kills ?? 0) || (b.score ?? 0) - (a.score ?? 0))
  const placement =
    !iAmAlive && myPlayer ? 1 + players.filter((p) => p.alive || (p.diedAt ?? 0) > (myPlayer.diedAt ?? 0)).length : null
  const spectatingName = phase === "playing" && !iAmAlive ? (room?.players?.[spectateId ?? ""]?.name ?? "") : null
  const steering = (phase === "countdown" || phase === "playing") && iAmAlive
  const glassBox = "bg-white/70 dark:bg-white/5 border border-black/5 dark:border-white/10"
  const dpadBtn = `${glassBox} d-pad-btn w-full h-full min-h-[48px] min-w-[48px] rounded-2xl flex items-center justify-center active:scale-95 transition-transform`

  const killText = (k: KillEntry) => {
    const kn = k.killerId ? playerDisplayName(room?.players?.[k.killerId], k.killerName) : k.killerName
    const vn = playerDisplayName(room?.players?.[k.victimId], k.victimName)
    return k.cause === "kill"
      ? `${kn} eliminated ${vn}`
      : k.cause === "zone"
        ? `${vn} was caught by the zone`
        : k.cause === "wall"
          ? `${vn} hit the wall`
          : `${vn} crashed into themselves`
  }

  if (!centerEl || !sideEl || !leftEl) return null

  return (
    <>
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

          {phase === "countdown" && countdownNum > 0 && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/25">
              <span className="font-black text-white" style={{ fontSize: 100, fontFamily: "'Arial Black','Segoe UI Black',Impact,sans-serif", textShadow: "0 0 32px rgba(34,217,122,0.95)" }}>
                {countdownNum}
              </span>
              <span className="text-xs font-bold text-white/90">Battle Royale · {total} players</span>
            </div>
          )}

          {phase === "ended" && room?.game?.zone && (
            <RoyaleVictory
              players={players}
              winnerId={room.game.winner ?? null}
              myId={playerId}
              startAt={room.game.zone.startAt}
              endedAt={room.game.endedAt ?? room.game.zone.startAt}
              isHost={isHost}
              busy={endBusy}
              error={endError}
              onRematch={handleRematch}
              onBackToRoom={handleBackToRoom}
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
                <div style={{ gridColumn: 2, gridRow: 1 }}><button aria-label="Up" onTouchStart={() => setDir(0, -1)} onClick={() => setDir(0, -1)} className={dpadBtn}><ArrowUp className="h-6 w-6" /></button></div>
                <div style={{ gridColumn: 1, gridRow: 2 }}><button aria-label="Left" onTouchStart={() => setDir(-1, 0)} onClick={() => setDir(-1, 0)} className={dpadBtn}><ArrowLeft className="h-6 w-6" /></button></div>
                <div style={{ gridColumn: 3, gridRow: 2 }}><button aria-label="Right" onTouchStart={() => setDir(1, 0)} onClick={() => setDir(1, 0)} className={dpadBtn}><ArrowRight className="h-6 w-6" /></button></div>
                <div style={{ gridColumn: 2, gridRow: 3 }}><button aria-label="Down" onTouchStart={() => setDir(0, 1)} onClick={() => setDir(0, 1)} className={dpadBtn}><ArrowDown className="h-6 w-6" /></button></div>
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
          {!steering && <div className="flex-1" />}
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
                <span className="font-semibold truncate flex-1 min-w-0">{p.vip && <VipCrown className="h-3 w-3" />}{playerDisplayName(p)}</span>
                {!p.alive && <Skull className="w-3 h-3 shrink-0 opacity-70" />}
                <span className="font-extrabold tabular-nums" title="kills">{p.kills ?? 0}</span>
              </div>
            ))}
          </div>
          {kills.length > 0 && (
            <div className="shrink-0 px-2.5 py-1.5 border-t border-black/5 dark:border-white/10 text-[10px] opacity-60 leading-tight">
              💀 {killText(kills[kills.length - 1])}
            </div>
          )}
        </div>,
        leftEl,
      )}
    </>
  )
}
