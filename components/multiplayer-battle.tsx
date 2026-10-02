"use client"

import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { Button } from "@/components/ui/button"
import { X, Trophy, Skull, Crown, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, RotateCcw, Home, Loader2 } from "lucide-react"
import { ref, set, update, remove, onValue, push, increment } from "firebase/database"
import { getFirebaseAuth, getFirebaseDb } from "@/lib/firebase"
import {
  subscribeToRoom,
  leaveRoom,
  resetRoomForRematch,
  startBattle,
  snakesRef,
  mySnakeRef,
  foodRef,
  killFeedRef,
  BATTLE_SPAWNS,
  BATTLE_TICK_MS,
  BATTLE_KILL_SCORE,
  BATTLE_SNAKE_STALE_MS,
  getRoomSettings,
  playerDisplayName,
  type MpRoom,
  type MpSnakeState,
  type KillEntry,
} from "@/lib/multiplayer"
import { getBattleMap } from "@/lib/battle-maps"
import { claimRankRewards } from "@/lib/store"
import VoiceChat from "./voice-chat"
import { FriendAction } from "./snake-friends"
import { destroyVoiceManager } from "@/lib/voice-chat"
import { useSoundManager } from "./sound-manager"
import { RankedTag, RatingDelta, TierBadge } from "./ranked-panel"
import {
  checkRankedEligibility,
  computeEloChanges,
  computeStandings,
  lastPlaceElo,
  RANKED_REASON_TEXT,
  type RankedIneligibleReason,
  type RankedRecord,
} from "@/lib/ranked"
import { armDisconnectPenalty, fetchRankedRecords, isGoogleUser, writeRankedUpdates, type RankedWrite } from "@/lib/ranked-db"
import { VipCrown } from "./vip-crown"
import { useBotHost } from "@/hooks/use-bot-host"

const CELL = 18 // battle arena render size (bigger on phones)
const BW = 20
const BH = 20

interface Props {
  code: string
  playerId: string
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
  onExit: () => void
  onBackToLobby: () => void
}

interface Seg {
  x: number
  y: number
}

type KillItem = KillEntry & { key: string }

/** Ranked bookkeeping for ONE battle (created when the battle starts, only for eligible ranked matches). */
interface RankedSession {
  key: string
  myUid: string
  /** everyone who took part when the battle started (so quitters can still be ranked last) */
  participants: { playerId: string; uid: string; name: string }[]
  /** ratings BEFORE the match — read at the start so every client computes from the same numbers */
  pre: Record<string, RankedRecord> | null
  /** what I get if I quit / disconnect (last place) */
  lastPlace: RankedWrite | null
  ready: Promise<void>
  failed: boolean
  disarm: (() => Promise<void>) | null
  settled: boolean
}

interface RankedResultRow {
  rank: number
  oldElo: number
  newElo: number
  delta: number
}

const matchKeyOf = (r: MpRoom) => `${r.code}:${r.game?.countdownEndsAt ?? 0}`

export default function MultiplayerBattle({ code, playerId, darkMode, controlMode, soundEnabled, volume, centerEl, sideEl, leftEl, bestScore, onExit, onBackToLobby }: Props) {
  const [room, setRoom] = useState<MpRoom | null>(null)
  const [snakes, setSnakes] = useState<Record<string, MpSnakeState>>({})
  const [food, setFood] = useState<Seg | null>(null)
  const [kills, setKills] = useState<KillItem[]>([])
  const [nowTs, setNowTs] = useState(Date.now())
  const [frame, setFrame] = useState(0)
  const [endBusy, setEndBusy] = useState(false)
  const [endError, setEndError] = useState("")
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // Ranked mode (only used when room.isRanked)
  const [rankedInfo, setRankedInfo] = useState<{ eligible: boolean; reason?: RankedIneligibleReason } | null>(null)
  const [rankedResult, setRankedResult] = useState<Record<string, RankedResultRow> | null>(null)
  const [rankedError, setRankedError] = useState("")
  // Rank Pass: reward for passing into a new tier this match (coins + always 1 gem)
  const [rankReward, setRankReward] = useState<{ coins: number; gems: number; tiers: string[] } | null>(null)
  const rankedRef = useRef<RankedSession | null>(null)

  // Battle sounds (food / death / countdown / win) — same sounds + volume as single-player
  const { playFoodSound, playGameOverSound, playGameStartSound } = useSoundManager({
    enabled: soundEnabled,
    volume,
  })
  const soundRef = useRef({ playFoodSound, playGameOverSound, playGameStartSound })
  soundRef.current = { playFoodSound, playGameOverSound, playGameStartSound }

  // Host simulates every AI bot in the room (no-op unless I am the host)
  useBotHost(code, playerId)

  // Mutable game state (used inside the tick loop)
  const snakeRef = useRef<Seg[]>([])
  const dirRef = useRef({ x: 1, y: 0 })
  const pendingDirRef = useRef({ x: 1, y: 0 })
  const growthRef = useRef(0)
  const aliveRef = useRef(true)
  const phaseRef = useRef("lobby")
  const roomRef = useRef<MpRoom | null>(null)
  const snakesStateRef = useRef<Record<string, MpSnakeState>>({})
  const foodStateRef = useRef<Seg | null>(null)
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

  const phase = room?.status ?? "lobby"
  phaseRef.current = phase
  const myPlayer = room?.players?.[playerId] ?? null
  const isHost = room?.hostId === playerId

  // Host-chosen room settings: map (walls / portals), teleport, grid, snake collision
  const settings = getRoomSettings(room)
  // Ranked rules are fixed: teleport + no snake collision are always ON (also for rooms made before this rule)
  if (room?.isRanked) { settings.teleport = true; settings.avoidCollision = true }
  const battleMap = getBattleMap(settings.map)
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const mapRef = useRef(battleMap)
  mapRef.current = battleMap
  const wallSetRef = useRef<Set<string>>(new Set())
  wallSetRef.current = new Set(battleMap.walls.map((w) => `${w.x},${w.y}`))

  // --- subscriptions -------------------------------------------------------
  useEffect(() => {
    const unsubRoom = subscribeToRoom(code, (r) => {
      if (r === null) {
        onExitRef.current()
        return
      }
      roomRef.current = r
      setRoom(r)
      if (r.status === "lobby") {
        onBackToLobbyRef.current()
      }
      if (r.status === "countdown") {
        playedWriteRef.current = false
        endedWriteRef.current = false
        if (prevStatusRef.current !== "countdown") {
          // Fresh round (first start or a direct Rematch): reset my local snake state
          aliveRef.current = true
          growthRef.current = 0
          appliedKillsRef.current.clear()
          spawnedRef.current = false
          setEndBusy(false)
          setEndError("")
          rankedRef.current = null
          setRankedInfo(null)
          setRankedResult(null)
          setRankedError("")
          setRankReward(null)
        }
      }
      prevStatusRef.current = r.status
    })
    const unsubSnakes = onValue(snakesRef(code), (snap) => {
      const v = (snap.val() ?? {}) as Record<string, MpSnakeState>
      snakesStateRef.current = v
      setSnakes(v)
    })
    const unsubFood = onValue(foodRef(code), (snap) => {
      const v = (snap.val() ?? null) as Seg | null
      foodStateRef.current = v
      setFood(v)
    })
    const unsubKills = onValue(killFeedRef(code), (snap) => {
      const val = (snap.val() ?? {}) as Record<string, KillEntry>
      const items: KillItem[] = Object.entries(val)
        .map(([key, e]) => ({ key, ...e }))
        .sort((a, b) => a.ts - b.ts)
      setKills(items.slice(-6))
      // Killer grows +2 segments (applied locally, once per kill)
      for (const it of items) {
        if (it.killerId === playerId && !appliedKillsRef.current.has(it.key)) {
          appliedKillsRef.current.add(it.key)
          growthRef.current += 2
        }
      }
    })
    return () => {
      unsubRoom()
      unsubSnakes()
      unsubFood()
      unsubKills()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code])

  // --- spawn my snake once the room (player order) is known -----------------
  useEffect(() => {
    if (!room || spawnedRef.current) return
    const order = Object.values(room.players ?? {})
      .sort((a, b) => (a.joinedAt ?? 0) - (b.joinedAt ?? 0))
      .map((p) => p.id)
    const idx = Math.max(0, order.indexOf(playerId))
    const s = BATTLE_SPAWNS[idx % BATTLE_SPAWNS.length]
    dirRef.current = { x: s.dx, y: s.dy }
    pendingDirRef.current = { x: s.dx, y: s.dy }
    const snake: Seg[] = []
    for (let i = 0; i < 3; i++) snake.push({ x: s.x - s.dx * i, y: s.y - s.dy * i })
    snakeRef.current = snake
    spawnedRef.current = true
    set(mySnakeRef(code, playerId), { seg: snake, dx: s.dx, dy: s.dy, ts: Date.now() }).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room])

  // --- countdown ticker (also flips countdown -> playing once) --------------
  useEffect(() => {
    tickerRef.current = setInterval(() => {
      setNowTs(Date.now())
      const r = roomRef.current
      if (r?.status === "countdown" && r.game?.countdownEndsAt) {
        if (Date.now() >= r.game.countdownEndsAt && !playedWriteRef.current) {
          playedWriteRef.current = true
          update(ref(getFirebaseDb(), `rooms/${code}`), { status: "playing" }).catch(() => {})
        }
      }
    }, 200)
    return () => {
      if (tickerRef.current) clearInterval(tickerRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code])

  // --- death ----------------------------------------------------------------
  const die = (cause: "kill" | "wall" | "self", killerId?: string, killerName?: string) => {
    if (!aliveRef.current) return
    aliveRef.current = false
    const db = getFirebaseDb()
    const me = roomRef.current?.players?.[playerId]
    update(ref(db, `rooms/${code}/players/${playerId}`), { alive: false }).catch(() => {})
    remove(mySnakeRef(code, playerId)).catch(() => {})
    const entry: KillEntry = {
      killerId: killerId ?? null,
      killerName: killerName ?? "",
      victimId: playerId,
      victimName: me?.name ?? "Player",
      cause,
      ts: Date.now(),
    }
    push(killFeedRef(code), entry).catch(() => {})
    if (killerId) {
      update(ref(db, `rooms/${code}/players/${killerId}`), { score: increment(BATTLE_KILL_SCORE) }).catch(() => {})
    }
    soundRef.current.playGameOverSound()
  }

  // --- eat ------------------------------------------------------------------
  const eat = () => {
    growthRef.current += 1
    soundRef.current.playFoodSound()
    update(ref(getFirebaseDb(), `rooms/${code}/players/${playerId}`), { score: increment(1) }).catch(() => {})
    // Spawn replacement food on a free cell
    const taken = new Set<string>()
    for (const s of Object.values(snakesStateRef.current)) {
      for (const seg of s.seg ?? []) taken.add(`${seg.x},${seg.y}`)
    }
    for (const seg of snakeRef.current) taken.add(`${seg.x},${seg.y}`)
    for (const k of wallSetRef.current) taken.add(k)
    for (const [a, b] of mapRef.current.portals) {
      taken.add(`${a.x},${a.y}`)
      taken.add(`${b.x},${b.y}`)
    }
    const free: Seg[] = []
    for (let x = 0; x < BW; x++) for (let y = 0; y < BH; y++) if (!taken.has(`${x},${y}`)) free.push({ x, y })
    if (free.length > 0) {
      const f = free[Math.floor(Math.random() * free.length)]
      set(foodRef(code), f).catch(() => {})
      foodStateRef.current = f
      setFood(f)
    }
  }

  // --- main tick -------------------------------------------------------------
  const doTick = () => {
    if (!aliveRef.current || phaseRef.current !== "playing") return
    const d = dirRef.current
    const pd = pendingDirRef.current
    if (pd.x !== -d.x || pd.y !== -d.y) dirRef.current = { ...pd }
    const dir = dirRef.current
    const head = snakeRef.current[0]
    if (!head) return
    const cfg = settingsRef.current
    let nx = head.x + dir.x
    let ny = head.y + dir.y

    // Arena edge: teleport to the opposite side, or die on the wall
    if (nx < 0 || nx >= BW || ny < 0 || ny >= BH) {
      if (!cfg.teleport) {
        die("wall")
        return
      }
      nx = (nx + BW) % BW
      ny = (ny + BH) % BH
    }
    let newHead = { x: nx, y: ny }

    // Map walls
    if (wallSetRef.current.has(`${newHead.x},${newHead.y}`)) {
      die("wall")
      return
    }

    // Portals: entering one end comes out of the other
    for (const [a, b] of mapRef.current.portals) {
      if (a.x === newHead.x && a.y === newHead.y) {
        newHead = { x: b.x, y: b.y }
        break
      }
      if (b.x === newHead.x && b.y === newHead.y) {
        newHead = { x: a.x, y: a.y }
        break
      }
    }
    // Self — the tail cell vacates this tick unless pending growth keeps it
    // (v19.0.1 audit fix: false "self" deaths when the head moves into the cell
    // the tail just left). eat() runs after this check and adds growth, so the
    // growthRef value here already decides whether the tail pops this tick.
    const myBody = growthRef.current > 0 ? snakeRef.current : snakeRef.current.slice(0, -1)
    if (myBody.some((s, i) => i > 0 && s.x === newHead.x && s.y === newHead.y)) {
      die("self")
      return
    }
    // Food
    const f = foodStateRef.current
    const ateFood = !!f && f.x === newHead.x && f.y === newHead.y
    // Other snakes (fresh only)
    const now = Date.now()
    for (const [pid, s] of Object.entries(snakesStateRef.current)) {
      if (cfg.avoidCollision) break // snakes pass through each other
      if (pid === playerId) continue
      if (now - (s.ts ?? 0) > BATTLE_SNAKE_STALE_MS) continue
      if ((s.seg ?? []).some((seg) => seg.x === newHead.x && seg.y === newHead.y)) {
        const killerName = roomRef.current?.players?.[pid]?.name ?? "Player"
        die("kill", pid, killerName)
        return
      }
    }

    if (ateFood) eat()
    snakeRef.current.unshift(newHead)
    if (growthRef.current > 0) growthRef.current -= 1
    else snakeRef.current.pop()

    set(mySnakeRef(code, playerId), {
      seg: snakeRef.current,
      dx: dir.x,
      dy: dir.y,
      ts: Date.now(),
    }).catch(() => {})
    setFrame((n) => n + 1)
  }

  // --- game loop --------------------------------------------------------------
  useEffect(() => {
    if (phase === "playing" && aliveRef.current) {
      loopRef.current = setInterval(doTick, BATTLE_TICK_MS)
    }
    return () => {
      if (loopRef.current) {
        clearInterval(loopRef.current)
        loopRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  // --- countdown + win jingles -------------------------------------------------
  useEffect(() => {
    if (phase === "countdown") soundRef.current.playGameStartSound()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])
  useEffect(() => {
    if (room?.status === "ended" && room.game?.winner === playerId && aliveRef.current) {
      soundRef.current.playGameStartSound()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room?.status])

  // --- ranked: start of battle ---------------------------------------------------
  // Fix who is playing, check eligibility, read everybody's rating BEFORE the match and arm
  // the quit/disconnect penalty (last place). Casual rooms never enter this code.
  const initRankedSession = (r: MpRoom, key: string) => {
    const players = Object.values(r.players ?? {})
    const check = checkRankedEligibility({ isRanked: !!r.isRanked, players })
    if (!check.eligible) {
      rankedRef.current = null
      setRankedInfo({ eligible: false, reason: check.reason })
      return
    }
    const cu = getFirebaseAuth().currentUser
    const me = players.find((p) => p.id === playerId)
    if (!cu || !me || me.uid !== cu.uid || !isGoogleUser(cu)) {
      rankedRef.current = null
      setRankedInfo({ eligible: false, reason: "guest_player" })
      return
    }
    const s: RankedSession = {
      key,
      myUid: cu.uid,
      participants: players.map((p) => ({ playerId: p.id, uid: p.uid as string, name: p.name })),
      pre: null,
      lastPlace: null,
      ready: Promise.resolve(),
      failed: false,
      disarm: null,
      settled: false,
    }
    rankedRef.current = s
    setRankedInfo({ eligible: true })
    s.ready = (async () => {
      const pre = await fetchRankedRecords(s.participants.map((p) => p.uid))
      s.pre = pre
      const mine = pre[s.myUid]
      const opponents = s.participants.filter((p) => p.uid !== s.myUid).map((p) => pre[p.uid].elo)
      s.lastPlace = {
        elo: lastPlaceElo(mine, opponents),
        wins: mine.wins,
        losses: mine.losses + 1,
        matches: mine.matches + 1,
      }
      s.disarm = await armDisconnectPenalty(s.myUid, s.lastPlace)
    })().catch(() => {
      s.failed = true
    })
  }

  useEffect(() => {
    if (!room || room.status !== "playing" || !room.isRanked) return
    const key = matchKeyOf(room)
    if (rankedRef.current?.key === key) return
    initRankedSession(room, key)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room?.status, room?.game?.countdownEndsAt])

  // --- ranked: end of battle -----------------------------------------------------
  // Final standings -> new Elo for everyone (shown on the results screen). Security rules only
  // let me write MY OWN ranked/{uid}, so each client saves its own record (one update() call).
  const settleRanked = async (r: MpRoom) => {
    const s = rankedRef.current
    if (!s || s.settled || s.key !== matchKeyOf(r)) return
    s.settled = true
    try {
      await s.ready
      const pre = s.pre
      if (s.failed || !pre) throw new Error("ratings unavailable")
      const deaths = Object.values(r.game?.killFeed ?? {}).map((k) => ({ id: k.victimId, ts: k.ts ?? 0 }))
      const ranks = computeStandings({
        participants: s.participants.map((p) => p.playerId),
        present: Object.keys(r.players ?? {}),
        winnerId: r.game?.winner ?? null,
        deaths,
      })
      const next = computeEloChanges(
        s.participants.map((p) => ({ uid: p.uid, elo: pre[p.uid].elo, rank: ranks[p.playerId], matches: pre[p.uid].matches })),
      )
      const rows: Record<string, RankedResultRow> = {}
      for (const p of s.participants) {
        const oldElo = pre[p.uid].elo
        rows[p.playerId] = { rank: ranks[p.playerId], oldElo, newElo: next[p.uid], delta: next[p.uid] - oldElo }
      }
      setRankedResult(rows)
      // the real result replaces the quit penalty
      await s.disarm?.().catch(() => {})
      const mine = pre[s.myUid]
      const won = ranks[playerId] === 1
      await writeRankedUpdates({
        [s.myUid]: {
          elo: next[s.myUid],
          wins: mine.wins + (won ? 1 : 0),
          losses: mine.losses + (won ? 0 : 1),
          matches: mine.matches + 1,
        },
      })
      // Rank Pass: rating saved -> pay out every newly reached tier (once per tier, see claimRankRewards)
      const reward = claimRankRewards(next[s.myUid])
      if (reward.tiers.length > 0) setRankReward(reward)
    } catch {
      setRankedError("Could not save your rating. Check your connection.")
    }
  }

  useEffect(() => {
    if (room?.status === "ended" && room.isRanked) void settleRanked(room)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room?.status])

  // Leaving while the battle is running = last place (same as a disconnect, just applied right away)
  const settleRankedOnExit = async () => {
    const s = rankedRef.current
    const r = roomRef.current
    if (!s || s.settled || !r || !r.isRanked) return
    if (r.status === "ended") {
      await settleRanked(r)
      return
    }
    if (r.status !== "playing") return
    s.settled = true
    const work = (async () => {
      await s.ready
      await s.disarm?.().catch(() => {})
      if (s.lastPlace) await writeRankedUpdates({ [s.myUid]: s.lastPlace })
    })().catch(() => {})
    // don't trap the player on this screen when offline (Firebase keeps the write queued)
    await Promise.race([work, new Promise((res) => setTimeout(res, 3000))])
  }

  // --- win detection -----------------------------------------------------------
  useEffect(() => {
    if (!room || room.status !== "playing" || endedWriteRef.current) return
    const alive = Object.values(room.players ?? {}).filter((p) => p.alive)
    if (alive.length > 1) return
    endedWriteRef.current = true
    let winnerId: string | null = alive[0]?.id ?? null
    if (!winnerId) {
      const all = Object.values(room.players ?? {})
      winnerId = all.sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0]?.id ?? null
    }
    update(ref(getFirebaseDb(), `rooms/${code}`), { status: "ended", "game/winner": winnerId }).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room])

  // --- controls -----------------------------------------------------------------
  const setDir = (x: number, y: number) => {
    pendingDirRef.current = { x, y }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase()
      if (k === "arrowup" || k === "w") setDir(0, -1)
      else if (k === "arrowdown" || k === "s") setDir(0, 1)
      else if (k === "arrowleft" || k === "a") setDir(-1, 0)
      else if (k === "arrowright" || k === "d") setDir(1, 0)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  // Swipe steering — EXACTLY like single-player: a SEPARATE swipe pad below
  // the arena (plus the arena itself), native listeners with passive:false +
  // preventDefault, continuous tracking on touchmove.
  const arenaWrapRef = useRef<HTMLDivElement>(null)
  const swipePadRef = useRef<HTMLDivElement>(null)
  const swipeStartRef = useRef({ x: 0, y: 0 })
  const controlModeRef = useRef(controlMode)
  controlModeRef.current = controlMode
  // tiny haptic buzz on swipe (same default-on behavior as single-player)
  const buzz = (ms: number) => {
    try {
      if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate(ms)
    } catch {}
  }
  useEffect(() => {
    // Same as single-player: swipe works on the separate pad AND the arena
    const surfaces = [swipePadRef.current, arenaWrapRef.current].filter(
      (el): el is HTMLDivElement => el !== null,
    )
    if (surfaces.length === 0) return
    const onStart = (e: TouchEvent) => {
      if (phaseRef.current !== "playing" || controlModeRef.current === "buttons") return
      e.preventDefault()
      const t = e.touches[0]
      swipeStartRef.current = { x: t.clientX, y: t.clientY }
    }
    const onMove = (e: TouchEvent) => {
      if (phaseRef.current !== "playing" || controlModeRef.current === "buttons") return
      e.preventDefault()
      const t = e.touches[0]
      const dx = t.clientX - swipeStartRef.current.x
      const dy = t.clientY - swipeStartRef.current.y
      if (Math.abs(dx) > 30 || Math.abs(dy) > 30) {
        const d = dirRef.current
        if (Math.abs(dx) > Math.abs(dy)) {
          if (dx > 0 && d.x !== -1) setDir(1, 0)
          else if (dx < 0 && d.x !== 1) setDir(-1, 0)
        } else {
          if (dy > 0 && d.y !== -1) setDir(0, 1)
          else if (dy < 0 && d.y !== 1) setDir(0, -1)
        }
        buzz(15)
        swipeStartRef.current = { x: t.clientX, y: t.clientY }
      }
    }
    // Add event listeners with passive: false to ensure preventDefault works
    surfaces.forEach((surface) => {
      surface.addEventListener("touchstart", onStart, { passive: false })
      surface.addEventListener("touchmove", onMove, { passive: false })
    })
    return () => {
      surfaces.forEach((surface) => {
        surface.removeEventListener("touchstart", onStart)
        surface.removeEventListener("touchmove", onMove)
      })
    }
    // Re-run when the phase changes: the swipe pad only renders from the
    // countdown onward, so listeners must attach when it appears.
  }, [phase, controlMode, centerEl, sideEl, leftEl])

  const handleExit = async () => {
    if (loopRef.current) clearInterval(loopRef.current)
    if (tickerRef.current) clearInterval(tickerRef.current)
    destroyVoiceManager(code, playerId)
    await settleRankedOnExit().catch(() => {})
    try {
      await leaveRoom(code, playerId)
    } catch {}
    onExit()
  }

  // Rematch: start the next round right away (same room, same settings)
  const handleRematch = async () => {
    if (!isHost || endBusy) return
    setEndBusy(true)
    setEndError("")
    try {
      await startBattle(code)
    } catch (e) {
      setEndError(e instanceof Error ? e.message : "Could not start the rematch.")
      setEndBusy(false)
    }
  }

  // Back to room: everyone returns to the lobby (host can change map / settings)
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

  // --- drawing -------------------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    const now = Date.now()

    // Same background + grid look as the classic canvas
    const bg = ctx.createLinearGradient(0, 0, canvas.width, canvas.height)
    bg.addColorStop(0, darkMode ? "#101820" : "#eef4ea")
    bg.addColorStop(1, darkMode ? "#0a0f14" : "#dbe8d6")
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    if (settings.grid) {
      ctx.strokeStyle = darkMode ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.06)"
      ctx.lineWidth = 1
      for (let x = 1; x < BW; x++) {
        ctx.beginPath()
        ctx.moveTo(x * CELL, 0)
        ctx.lineTo(x * CELL, BH * CELL)
        ctx.stroke()
      }
      for (let y = 1; y < BH; y++) {
        ctx.beginPath()
        ctx.moveTo(0, y * CELL)
        ctx.lineTo(BW * CELL, y * CELL)
        ctx.stroke()
      }
    }

    // Map walls
    ctx.fillStyle = darkMode ? "#3b5a49" : "#7f9d8b"
    for (const w of battleMap.walls) {
      ctx.beginPath()
      ctx.roundRect(w.x * CELL + 0.5, w.y * CELL + 0.5, CELL - 1, CELL - 1, 3)
      ctx.fill()
    }

    // Portals (each pair has its own colour)
    const portalColors = ["#4da6ff", "#c77dff"]
    battleMap.portals.forEach(([a, b], pi) => {
      const color = portalColors[pi % portalColors.length]
      for (const c of [a, b]) {
        const cx = c.x * CELL + CELL / 2
        const cy = c.y * CELL + CELL / 2
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

    // Food
    if (food) {
      ctx.save()
      ctx.shadowColor = "rgba(255,80,120,0.9)"
      ctx.shadowBlur = 10
      ctx.fillStyle = "#ff5078"
      ctx.beginPath()
      ctx.arc(food.x * CELL + CELL / 2, food.y * CELL + CELL / 2, CELL / 2 - 2, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }

    // Remote snakes (fresh only), then mine on top
    const drawSnake = (seg: Seg[], color: string, glow: boolean) => {
      seg.forEach((s, i) => {
        ctx.save()
        if (glow && i === 0) {
          ctx.shadowColor = color
          ctx.shadowBlur = 10
        }
        ctx.fillStyle = color
        ctx.globalAlpha = i === 0 ? 1 : Math.max(0.45, 1 - (i / Math.max(seg.length, 1)) * 0.5)
        const r = 4
        const x = s.x * CELL + 1
        const y = s.y * CELL + 1
        const w = CELL - 2
        ctx.beginPath()
        ctx.roundRect(x, y, w, w, r)
        ctx.fill()
        ctx.restore()
      })
    }

    const entries = Object.entries(snakes).filter(([, s]) => now - (s.ts ?? 0) <= BATTLE_SNAKE_STALE_MS)
    for (const [pid, s] of entries) {
      if (pid === playerId) continue
      const color = room?.players?.[pid]?.color ?? "#888888"
      drawSnake(s.seg ?? [], color, false)
    }
    if (aliveRef.current && snakeRef.current.length > 0) {
      drawSnake(snakeRef.current, myPlayer?.color ?? "#3af08d", true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snakes, food, frame, darkMode, room, centerEl])

  // --- derived UI ------------------------------------------------------------------
  const countdownEndsAt = room?.game?.countdownEndsAt ?? 0
  const countdownNum = phase === "countdown" ? Math.max(1, Math.ceil((countdownEndsAt - nowTs) / 1000)) : 0
  const leaderboard = Object.values(room?.players ?? {}).sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
  const winner = room?.status === "ended" ? room.players?.[room.game?.winner ?? ""] : null

  const killText = (k: KillEntry) => {
    const kn = k.killerId ? playerDisplayName(room?.players?.[k.killerId], k.killerName) : k.killerName
    const vn = playerDisplayName(room?.players?.[k.victimId], k.victimName)
    return k.cause === "kill"
      ? `${kn} eliminated ${vn}`
      : k.cause === "wall"
        ? `${vn} hit the wall`
        : `${vn} crashed into themselves`
  }

  const glassBox = "bg-white/70 dark:bg-white/5 border border-black/5 dark:border-white/10"
  const dpadBtn = `${glassBox} d-pad-btn w-full h-full min-h-[48px] min-w-[48px] rounded-2xl flex items-center justify-center active:scale-95 transition-transform`
  const steering = phase === "countdown" || (phase === "playing" && aliveRef.current)
  const myScore = myPlayer?.score ?? 0

  if (!centerEl || !sideEl || !leftEl) return null

  return (
    <>
      {/* CENTER: the classic board frame, the battle is drawn on it */}
      {createPortal(
        <div
          ref={arenaWrapRef}
          className="relative rounded-2xl overflow-hidden premium-glow border border-black/10 dark:border-white/10"
          style={{ width: "min(100cqw, 100cqh)", aspectRatio: "1 / 1" }}
        >
          <canvas
            ref={canvasRef}
            width={BW * CELL}
            height={BH * CELL}
            className="block w-full h-full touch-none"
            style={{ imageRendering: "auto" }}
          />
          {phase === "countdown" && countdownNum > 0 && (
            <div className="absolute inset-0 flex items-center justify-center">
              <span
                className="font-black text-white"
                style={{ fontSize: 110, fontFamily: "'Arial Black','Segoe UI Black',Impact,sans-serif", textShadow: "0 0 32px rgba(34,217,122,0.95)" }}
              >
                {countdownNum}
              </span>
            </div>
          )}
          {phase === "playing" && !aliveRef.current && (
            <div className="absolute inset-x-0 top-2 flex justify-center">
              <div className="px-3 py-1.5 rounded-xl bg-black/70 text-white text-xs font-semibold flex items-center gap-1.5">
                <Skull className="w-4 h-4" /> Eliminated — spectating…
              </div>
            </div>
          )}
          {phase === "playing" && !aliveRef.current && room?.isRanked && rankedInfo?.eligible && (
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
                <div className="text-white font-bold text-lg">{winner ? `${playerDisplayName(winner)} wins!` : "Battle over!"}</div>
                <div className="text-white/70 text-xs mt-1">Scores</div>
                <div className="mt-2 flex flex-col gap-1 max-h-32 overflow-y-auto">
                  {leaderboard.map((p) => {
                    const rr = rankedResult?.[p.id]
                    return (
                      <div key={p.id} className="flex flex-wrap items-center justify-center gap-2 text-sm text-white">
                        <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: p.color }} />
                        <span className="font-medium">{p.vip && <VipCrown className="h-3.5 w-3.5" />}{playerDisplayName(p)}</span>
                        <span className="font-bold">{p.score ?? 0}</span>
                        {rr && <RatingDelta delta={rr.delta} />}
                        {rr && <TierBadge elo={rr.newElo} />}
                        {p.id !== playerId && <FriendAction targetUid={p.uid} />}
                      </div>
                    )
                  })}
                </div>
                {room?.isRanked && (
                  <div className="mt-2 text-[11px] text-white/70">
                    {rankedError ? (
                      <span className="text-red-300">{rankedError}</span>
                    ) : rankedResult ? (
                      "Ranked result saved"
                    ) : rankedInfo && !rankedInfo.eligible && rankedInfo.reason ? (
                      `${RANKED_REASON_TEXT[rankedInfo.reason]} — no Elo change`
                    ) : (
                      "Calculating rating…"
                    )}
                  </div>
                )}
                {rankReward && (
                  <div className="mt-2 mx-auto max-w-[240px] rounded-lg bg-amber-400/20 border border-amber-400/50 px-3 py-1.5 text-[12px] font-bold text-amber-300">
                    🎉 Rank pass: {rankReward.tiers.join(", ")}!
                    <div className="text-white">+{rankReward.coins.toLocaleString()} coins · +{rankReward.gems} gem{rankReward.gems > 1 ? "s" : ""}</div>
                  </div>
                )}
                {/* Split button: Rematch | Back to room */}
                <div
                  className={`mt-4 mx-auto flex h-16 w-full max-w-[220px] rounded-xl overflow-hidden shadow-lg shadow-emerald-500/30 bg-gradient-to-r from-emerald-500 to-emerald-400 ${
                    !isHost ? "opacity-50" : ""
                  }`}
                >
                  <button
                    onClick={handleRematch}
                    disabled={!isHost || endBusy}
                    aria-label="Rematch"
                    title="Rematch"
                    className="flex-1 flex flex-col items-center justify-center gap-0.5 text-white hover:bg-white/15 active:bg-white/25 transition-colors disabled:cursor-not-allowed disabled:hover:bg-transparent"
                  >
                    {endBusy ? <Loader2 className="w-6 h-6 animate-spin" /> : <RotateCcw className="w-6 h-6" />}
                    <span className="text-[10px] font-semibold leading-none">Rematch</span>
                  </button>
                  <div className="w-px my-2 bg-white/50" />
                  <button
                    onClick={handleBackToRoom}
                    disabled={!isHost || endBusy}
                    aria-label="Back to room"
                    title="Back to room"
                    className="flex-1 flex flex-col items-center justify-center gap-0.5 text-white hover:bg-white/15 active:bg-white/25 transition-colors disabled:cursor-not-allowed disabled:hover:bg-transparent"
                  >
                    <Home className="w-6 h-6" />
                    <span className="text-[10px] font-semibold leading-none">Back to room</span>
                  </button>
                </div>
                {!isHost && <div className="text-white/60 text-xs mt-2">Waiting for host to choose…</div>}
                {endError && <div className="text-red-300 text-xs mt-2">{endError}</div>}
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
            <button
              aria-label="Leave battle"
              title="Leave battle"
              onClick={handleExit}
              className="d-pad-btn self-center h-10 w-10 rounded-full flex items-center justify-center text-red-500 bg-white/70 dark:bg-white/5 border border-red-500/30 shadow-sm active:scale-90 transition-transform"
            >
              <X className="h-5 w-5" />
            </button>
            <div className="rounded-xl bg-white/70 dark:bg-white/[0.06] border border-black/5 dark:border-white/10 px-2.5 py-1 text-center">
              <div className="text-[8px] uppercase tracking-wider opacity-50 font-semibold">Best</div>
              <div className="text-base font-extrabold tabular-nums leading-tight">{Math.max(bestScore, myScore)}</div>
            </div>
          </div>

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
                <div style={{ gridColumn: 2, gridRow: 1 }}><button aria-label="Up" onTouchStart={() => setDir(0, -1)} onClick={() => setDir(0, -1)} className={dpadBtn}><ArrowUp className="h-6 w-6" /></button></div>
                <div style={{ gridColumn: 1, gridRow: 2 }}><button aria-label="Left" onTouchStart={() => setDir(-1, 0)} onClick={() => setDir(-1, 0)} className={dpadBtn}><ArrowLeft className="h-6 w-6" /></button></div>
                <div style={{ gridColumn: 3, gridRow: 2 }}><button aria-label="Right" onTouchStart={() => setDir(1, 0)} onClick={() => setDir(1, 0)} className={dpadBtn}><ArrowRight className="h-6 w-6" /></button></div>
                <div style={{ gridColumn: 2, gridRow: 3 }}><button aria-label="Down" onTouchStart={() => setDir(0, 1)} onClick={() => setDir(0, 1)} className={dpadBtn}><ArrowDown className="h-6 w-6" /></button></div>
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
        <div
          className={`h-full max-h-full w-full rounded-2xl overflow-hidden flex flex-col shadow-sm ${glassBox}`}
        >
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
                <span className="font-semibold truncate flex-1 min-w-0">{p.vip && <VipCrown className="h-3 w-3" />}{playerDisplayName(p)}</span>
                {!p.alive && <Skull className="w-3 h-3 shrink-0 opacity-70" />}
                <span className="font-extrabold tabular-nums">{p.score ?? 0}</span>
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
