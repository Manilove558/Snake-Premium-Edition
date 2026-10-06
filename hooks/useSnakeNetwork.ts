"use client"

// hooks/useSnakeNetwork.ts — the ONE place the UI talks to the Socket.io server.
//
//   const net = useSnakeNetwork()
//   net.createRoom({ name: "Mani" })           // lobby
//   net.startGame()                            // host
//   net.sendMove("LEFT")                       // in game (call from keyboard / swipe handlers)
//   net.sampleSnakes()                         // inside requestAnimationFrame: smoothed 60 fps positions
//
// What it handles for you
//   • connection + automatic reconnection (exponential back-off, Infinity attempts)
//   • session restore: room code + player id + secret token live in sessionStorage, so a page reload
//     or a network drop re-attaches you to the SAME snake (server keeps it 15 s)
//   • latency: a PING every 2 s -> `ping` (smoothed RTT in ms) and a server-clock offset
//   • state merge: GAME_STATE_SYNC deltas are folded into one mutable GameView (shared/sync-reducer.ts)
//   • smoothing: one SnakeInterpolator per snake (the same class the Battle Royale already uses)
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { io, type Socket } from "socket.io-client"
import { SnakeInterpolator, type Cell } from "@/lib/br/interpolation"
import { buildZoneBoxes, getZoneState, type ZoneBox, type ZoneState } from "@/lib/br/zone"
import {
  OPPOSITE_DIR,
  type AckResult,
  type ClientToServerEvents,
  type CreateRoomPayload,
  type Dir,
  type FoodNet,
  type GameConfig,
  type GameOverPayload,
  type JoinRoomPayload,
  type JoinedInfo,
  type LobbyPlayer,
  type NetError,
  type PlayerDiedEvent,
  type PlayerProfile,
  type QuickMatchPayload,
  type RankedResultPayload,
  type ReconnectPayload,
  type RoomSettings,
  type RoomSnapshot,
  type RoomStatus,
  type ServerToClientEvents,
} from "@/shared/snake-protocol"
import { pushGlide } from "@/lib/smooth-move"
import { applyGameSync, createGameView, type GameView, type SnakeView } from "@/shared/sync-reducer"

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

type NetSocket = Socket<ServerToClientEvents, ClientToServerEvents>
type Empty = Record<never, never>

/** "idle" = connected (or not) but not inside any room. Otherwise the room's status. */
export type NetPhase = "idle" | RoomStatus

/** React-state copy of the match (updates at sync rate, ~7 Hz). For 60 fps drawing use sampleSnakes(). */
export interface GameSnapshot {
  tick: number
  /** server time (ms) of the last sync */
  serverTime: number
  aliveCount: number
  snakes: SnakeView[]
  foods: FoodNet[]
}

/** One smoothed snake for the render loop. Field names match DrawSnake in lib/br/render.ts. */
export interface RenderSnake {
  id: string
  name: string
  color: string
  /** interpolated cells, head first (floats while gliding) */
  seg: Cell[]
  mine: boolean
  alive: boolean
  dir: Dir
  shielded: boolean
  boosted: boolean
}

export interface UseSnakeNetworkOptions {
  /** Socket.io server URL. Default: NEXT_PUBLIC_SNAKE_SERVER_URL or http://localhost:4000 */
  url?: string
  /** connect on mount (default true). With false call `connect()` yourself. */
  autoConnect?: boolean
  /** latency probe interval, ms (default 2000) */
  pingIntervalMs?: number
  /**
   * Return a fresh Firebase ID token (or null for guests). Called on every
   * (re)connect so token refresh works. The server verifies it when
   * FIREBASE_SERVICE_ACCOUNT_JSON is configured and binds the verified uid
   * to your lobby player (LobbyPlayer.uid) — used for the verified badge
   * and for ranked settling.
   */
  getIdToken?: () => Promise<string | null>
  onPlayerDied?: (e: PlayerDiedEvent) => void
  /** standings include placement / kills / peakMass = the input of calculateMatchRankings() */
  onGameOver?: (r: GameOverPayload) => void
  onError?: (e: NetError) => void
}

export interface UseSnakeNetwork {
  // ---- connection ---------------------------------------------------------
  isConnected: boolean
  /** true between a lost connection and the moment it is back */
  isReconnecting: boolean
  /** smoothed round-trip time in ms; null until the first answer / while offline */
  ping: number | null
  /** server clock = Date.now() + serverOffsetMs */
  serverOffsetMs: number
  getServerTime: () => number
  connect: () => void
  disconnect: () => void

  // ---- room / lobby -------------------------------------------------------
  phase: NetPhase
  room: RoomSnapshot | null
  players: LobbyPlayer[]
  me: { playerId: string; isHost: boolean } | null

  // ---- match --------------------------------------------------------------
  config: GameConfig | null
  /** server time (ms) when the countdown ends / ended */
  startsAt: number | null
  gameState: GameSnapshot | null
  /** newest first, max 8 */
  killFeed: PlayerDiedEvent[]
  result: GameOverPayload | null
  /** v23: the server-computed ranked result (RP / MMR per player). null in casual rooms / until the match is settled */
  rankedResult: RankedResultPayload | null
  lastError: NetError | null
  clearError: () => void

  // ---- actions (all return the server's acknowledgement) -----------------------
  createRoom: (p: CreateRoomPayload) => Promise<AckResult<JoinedInfo>>
  joinRoom: (p: JoinRoomPayload) => Promise<AckResult<JoinedInfo>>
  quickMatch: (p: QuickMatchPayload) => Promise<AckResult<JoinedInfo>>
  leaveRoom: () => Promise<AckResult>
  setReady: (ready: boolean) => Promise<AckResult>
  updateProfile: (p: Partial<PlayerProfile>) => Promise<AckResult>
  updateSettings: (p: Partial<RoomSettings>) => Promise<AckResult>
  startGame: () => Promise<AckResult>
  /** host: back to the lobby after GAME_OVER */
  resetRoom: () => Promise<AckResult>
  /** "Back to room" during a match: my snake leaves the round (ranked: counted as a leaver) but I stay in the room */
  forfeitMatch: () => Promise<AckResult>
  /** Send a turn. Returns false if it was filtered locally (not playing, dead, same / opposite direction). */
  sendMove: (dir: Dir) => boolean

  // ---- rendering helpers -----------------------------------------------------
  /** mutable live state for requestAnimationFrame loops (does NOT trigger re-renders) */
  gameViewRef: React.MutableRefObject<GameView>
  /** smoothed snakes at `now` (performance.now()). Cheap enough to call every frame. */
  sampleSnakes: (now?: number) => RenderSnake[]
  /** Battle Royale zone right now (null in classic) */
  getZone: () => ZoneState | null
}

// ---------------------------------------------------------------------------
// Session persistence (survives reload / network drop; cleared on leave)
// ---------------------------------------------------------------------------

const SESSION_KEY = "snake-net-session"

function loadSession(): ReconnectPayload | null {
  try {
    const raw = typeof window === "undefined" ? null : window.sessionStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const s = JSON.parse(raw) as Partial<ReconnectPayload>
    return typeof s.code === "string" && typeof s.playerId === "string" && typeof s.token === "string"
      ? { code: s.code, playerId: s.playerId, token: s.token }
      : null
  } catch {
    return null
  }
}
function saveSession(s: ReconnectPayload): void {
  try {
    window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(s))
  } catch {
    /* private mode / quota: reconnect-after-reload just won't work */
  }
}
function clearSession(): void {
  try {
    window.sessionStorage.removeItem(SESSION_KEY)
  } catch {
    /* ignore */
  }
}

const failure = (code: NetError["code"], message: string): AckResult<never> => ({ ok: false, code, message })

const DEFAULT_URL = process.env.NEXT_PUBLIC_SNAKE_SERVER_URL ?? "http://localhost:4000"
const REQUEST_TIMEOUT_MS = 6_000

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useSnakeNetwork(options: UseSnakeNetworkOptions = {}): UseSnakeNetwork {
  const { url = DEFAULT_URL, autoConnect = true, pingIntervalMs = 2_000 } = options

  // callbacks live in a ref so changing them never reconnects the socket
  const optsRef = useRef(options)
  optsRef.current = options

  const socketRef = useRef<NetSocket | null>(null)

  const [isConnected, setIsConnected] = useState(false)
  const [isReconnecting, setIsReconnecting] = useState(false)
  const [ping, setPing] = useState<number | null>(null)
  const [serverOffsetMs, setServerOffsetMs] = useState(0)
  const [room, setRoom] = useState<RoomSnapshot | null>(null)
  const [me, setMe] = useState<{ playerId: string; isHost: boolean } | null>(null)
  const [config, setConfig] = useState<GameConfig | null>(null)
  const [startsAt, setStartsAt] = useState<number | null>(null)
  const [gameState, setGameState] = useState<GameSnapshot | null>(null)
  const [killFeed, setKillFeed] = useState<PlayerDiedEvent[]>([])
  const [result, setResult] = useState<GameOverPayload | null>(null)
  const [rankedResult, setRankedResult] = useState<RankedResultPayload | null>(null)
  const [lastError, setLastError] = useState<NetError | null>(null)

  // mutable mirrors for the render loop / event handlers (no re-render needed)
  const roomRef = useRef<RoomSnapshot | null>(null)
  const meRef = useRef<{ playerId: string } | null>(null)
  const configRef = useRef<GameConfig | null>(null)
  const viewRef = useRef<GameView>(createGameView())
  const interpRef = useRef(new Map<string, SnakeInterpolator>())
  const colorRef = useRef(new Map<string, { color: string; name: string }>())
  const offsetRef = useRef(0)
  const zoneBoxesRef = useRef<{ seed: number; boxes: ZoneBox[] } | null>(null)
  const seqRef = useRef(0)
  const lastDirRef = useRef<Dir | null>(null)

  const reportError = useCallback((e: NetError) => {
    setLastError(e)
    optsRef.current.onError?.(e)
  }, [])

  // ---- local state helpers -----------------------------------------------------
  const resetGame = useCallback(() => {
    viewRef.current = createGameView()
    interpRef.current.clear()
    configRef.current = null
    zoneBoxesRef.current = null
    lastDirRef.current = null
    setGameState(null)
    setConfig(null)
    setStartsAt(null)
    setResult(null)
    setRankedResult(null)
    setKillFeed([])
  }, [])

  const resetAll = useCallback(() => {
    roomRef.current = null
    meRef.current = null
    colorRef.current.clear()
    setRoom(null)
    setMe(null)
    resetGame()
  }, [resetGame])

  const applyRoom = useCallback(
    (s: RoomSnapshot) => {
      roomRef.current = s
      colorRef.current = new Map(s.players.map((p) => [p.id, { color: p.color, name: p.name }]))
      setRoom(s)
      const id = meRef.current?.playerId
      if (id) setMe({ playerId: id, isHost: s.hostId === id })
      if (s.status === "lobby") resetGame() // rematch: clear the previous match
    },
    [resetGame],
  )

  /** Remember who I am in a room (from CREATE / JOIN / QUICK_MATCH / RECONNECT acks). */
  const adopt = useCallback(
    (info: JoinedInfo) => {
      saveSession({ code: info.code, playerId: info.playerId, token: info.token })
      meRef.current = { playerId: info.playerId }
      applyRoom(info.room)
    },
    [applyRoom],
  )

  const toSnapshot = (v: GameView): GameSnapshot => ({
    tick: v.tick,
    serverTime: v.serverTime,
    aliveCount: v.aliveCount,
    snakes: [...v.snakes.values()],
    foods: [...v.foods.values()],
  })

  /** Fold one GAME_STATE_SYNC into the live view, the interpolators and the React snapshot. */
  const ingestSync = useCallback((sync: Parameters<ServerToClientEvents["GAME_STATE_SYNC"]>[0]) => {
    const view = viewRef.current
    const changed = applyGameSync(view, sync)
    const now = performance.now()
    for (const id of changed) {
      const s = view.snakes.get(id)
      if (!s || !s.alive) {
        interpRef.current.delete(id)
        continue
      }
      let it = interpRef.current.get(id)
      if (!it) {
        it = new SnakeInterpolator()
        interpRef.current.set(id, it)
      }
      pushGlide(it, s.cells, now) // a teleport / portal hop snaps instead of gliding across the board
    }
    if (sync.full) for (const id of [...interpRef.current.keys()]) if (!view.snakes.get(id)?.alive) interpRef.current.delete(id)

    // Keep my local "last sent direction" in step with the server once it has caught up with my inputs.
    const mine = meRef.current ? view.snakes.get(meRef.current.playerId) : undefined
    if (mine && mine.alive && mine.seq >= seqRef.current) lastDirRef.current = mine.dir
    setGameState(toSnapshot(view))
  }, [])

  // ---- request helper (promise + own timeout) ------------------------------------
  const request = useCallback(<T extends object>(send: (socket: NetSocket, done: (r: AckResult<T>) => void) => void): Promise<AckResult<T>> => {
    return new Promise((resolve) => {
      const socket = socketRef.current
      if (!socket || !socket.connected) return resolve(failure("CONNECT_ERROR", "Not connected to the game server"))
      let settled = false
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        resolve(failure("TIMEOUT", "The server did not answer"))
      }, REQUEST_TIMEOUT_MS)
      send(socket, (r) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(r)
      })
    })
  }, [])

  const track = useCallback(
    <T extends object>(p: Promise<AckResult<T>>): Promise<AckResult<T>> =>
      p.then((r) => {
        if (!r.ok) reportError({ code: r.code, message: r.message })
        return r
      }),
    [reportError],
  )

  // ---- socket lifecycle ---------------------------------------------------------------
  useEffect(() => {
    const socket: NetSocket = io(url, {
      transports: ["websocket", "polling"],
      autoConnect: false,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 400,
      reconnectionDelayMax: 5_000,
      randomizationFactor: 0.5,
      timeout: 8_000,
      // fresh ID token on every (re)connect; guests send none
      auth: (cb) => {
        const getIdToken = optsRef.current.getIdToken
        if (!getIdToken) return cb({})
        getIdToken()
          .then((t) => cb(t ? { token: t } : {}))
          .catch(() => cb({}))
      },
    })
    socketRef.current = socket

    // ---- latency + clock offset ----
    let pingTimer: ReturnType<typeof setInterval> | null = null
    let inFlight = false
    let emaPing: number | null = null
    const samples: { rtt: number; offset: number }[] = []

    const probe = () => {
      if (!socket.connected || inFlight) return
      inFlight = true
      const t0 = performance.now()
      const guard = setTimeout(() => (inFlight = false), 3_000) // lost probe must not block the next one
      socket.emit("PING", Date.now(), (serverTs: number) => {
        clearTimeout(guard)
        inFlight = false
        const rtt = performance.now() - t0
        emaPing = emaPing === null ? rtt : emaPing * 0.7 + rtt * 0.3
        setPing(Math.round(emaPing))
        // NTP-style estimate: the server stamped its clock about rtt/2 ago. Trust the fastest of the last 8 samples.
        samples.push({ rtt, offset: serverTs + rtt / 2 - Date.now() })
        if (samples.length > 8) samples.shift()
        const best = samples.reduce((a, b) => (b.rtt < a.rtt ? b : a))
        offsetRef.current = best.offset
        setServerOffsetMs(Math.round(best.offset))
      })
    }

    // ---- connection events ----
    socket.on("connect", () => {
      setIsConnected(true)
      setIsReconnecting(false)
      setLastError((e) => (e?.code === "CONNECT_ERROR" ? null : e))
      probe()
      if (pingTimer) clearInterval(pingTimer)
      pingTimer = setInterval(probe, pingIntervalMs)

      // Page reload or dropped connection: take my snake / lobby slot back.
      const session = loadSession()
      if (session) {
        socket.emit("RECONNECT_ROOM", session, (r) => {
          if (r.ok) adopt(r)
          else {
            clearSession()
            resetAll() // the room is gone (match over, grace expired, server restarted)
          }
        })
      }
    })

    socket.on("disconnect", (reason) => {
      setIsConnected(false)
      setPing(null)
      inFlight = false
      if (pingTimer) clearInterval(pingTimer)
      pingTimer = null
      // "io client disconnect" = we asked for it; anything else the manager retries by itself
      if (reason !== "io client disconnect") setIsReconnecting(true)
    })

    socket.on("connect_error", (err) => {
      setIsReconnecting(true)
      // "websocket error" alone says nothing — name the URL and the usual fix
      reportError({
        code: "CONNECT_ERROR",
        message: `Can't reach the game server at ${url} — is it running? (npm run server:dev)${err.message ? ` [${err.message}]` : ""}`,
      })
    })
    socket.io.on("reconnect_attempt", () => setIsReconnecting(true))

    // ---- game events ----
    socket.on("ROOM_UPDATE", (s) => applyRoom(s))

    socket.on("GAME_STARTING", (p) => {
      // new match (or resync after reconnect): rebuild everything from the full snapshot
      viewRef.current = createGameView()
      interpRef.current.clear()
      configRef.current = p.config
      zoneBoxesRef.current = p.config.zone ? { seed: p.config.zone.seed, boxes: buildZoneBoxes(p.config.zone.seed) } : null
      if (samples.length === 0) offsetRef.current = p.serverTime - Date.now() // rough, until the first ping lands
      setConfig(p.config)
      setStartsAt(p.startsAt)
      setResult(null)
      setRankedResult(null)
      setKillFeed([])
      seqRef.current = 0
      lastDirRef.current = null
      ingestSync(p.state)
    })

    socket.on("GAME_STATE_SYNC", (s) => ingestSync(s))

    socket.on("PLAYER_DIED", (e) => {
      setKillFeed((f) => [e, ...f].slice(0, 8))
      optsRef.current.onPlayerDied?.(e)
    })

    socket.on("GAME_OVER", (r) => {
      setResult(r)
      optsRef.current.onGameOver?.(r)
    })

    socket.on("RANKED_RESULT", (r) => setRankedResult(r))

    socket.on("NET_NOTICE", (e) => {
      reportError(e)
      if (e.code === "SESSION_REPLACED") {
        clearSession() // another tab took over this player: this tab goes back to idle
        resetAll()
      }
    })

    if (autoConnect) socket.connect()

    return () => {
      if (pingTimer) clearInterval(pingTimer)
      socket.removeAllListeners()
      socket.io.removeAllListeners()
      socket.disconnect()
      socketRef.current = null
    }
    // callbacks above are stable (useCallback with stable deps); only the connection settings should reconnect
  }, [url, autoConnect, pingIntervalMs, adopt, applyRoom, ingestSync, reportError, resetAll])

  // ---- actions ---------------------------------------------------------------------------
  const createRoom = useCallback(
    (p: CreateRoomPayload) =>
      track(request<JoinedInfo>((s, done) => s.emit("CREATE_ROOM", p, done))).then((r) => {
        if (r.ok) adopt(r)
        return r
      }),
    [request, track, adopt],
  )
  const joinRoom = useCallback(
    (p: JoinRoomPayload) =>
      track(request<JoinedInfo>((s, done) => s.emit("JOIN_ROOM", p, done))).then((r) => {
        if (r.ok) adopt(r)
        return r
      }),
    [request, track, adopt],
  )
  const quickMatch = useCallback(
    (p: QuickMatchPayload) =>
      track(request<JoinedInfo>((s, done) => s.emit("QUICK_MATCH", p, done))).then((r) => {
        if (r.ok) adopt(r)
        return r
      }),
    [request, track, adopt],
  )
  const leaveRoom = useCallback(async () => {
    const r = await request<Empty>((s, done) => s.emit("LEAVE_ROOM", done))
    clearSession() // leave locally even if the server did not answer
    resetAll()
    return r
  }, [request, resetAll])

  const setReady = useCallback((ready: boolean) => track(request<Empty>((s, done) => s.emit("SET_READY", { ready }, done))), [request, track])
  const updateProfile = useCallback((p: Partial<PlayerProfile>) => track(request<Empty>((s, done) => s.emit("UPDATE_PROFILE", p, done))), [request, track])
  const updateSettings = useCallback((p: Partial<RoomSettings>) => track(request<Empty>((s, done) => s.emit("UPDATE_SETTINGS", p, done))), [request, track])
  const startGame = useCallback(() => track(request<Empty>((s, done) => s.emit("START_GAME", done))), [request, track])
  const resetRoom = useCallback(() => track(request<Empty>((s, done) => s.emit("RESET_ROOM", done))), [request, track])
  const forfeitMatch = useCallback(() => request<Empty>((s, done) => s.emit("FORFEIT_MATCH", done)), [request])

  const sendMove = useCallback((dir: Dir): boolean => {
    const socket = socketRef.current
    const id = meRef.current?.playerId
    if (!socket || !socket.connected || !id || roomRef.current?.status !== "playing") return false
    const mine = viewRef.current.snakes.get(id)
    if (!mine || !mine.alive) return false
    const last = lastDirRef.current ?? mine.dir
    if (dir === last || dir === OPPOSITE_DIR[last]) return false // pointless / illegal: don't spend a message
    lastDirRef.current = dir
    socket.emit("MOVE_INPUT", { dir, seq: ++seqRef.current })
    return true
  }, [])

  const connect = useCallback(() => void socketRef.current?.connect(), [])
  const disconnect = useCallback(() => void socketRef.current?.disconnect(), [])
  const clearError = useCallback(() => setLastError(null), [])
  const getServerTime = useCallback(() => Date.now() + offsetRef.current, [])

  // ---- render helpers ----------------------------------------------------------------------
  const sampleSnakes = useCallback((now: number = performance.now()): RenderSnake[] => {
    const out: RenderSnake[] = []
    const view = viewRef.current
    const serverNow = Date.now() + offsetRef.current
    for (const [id, it] of interpRef.current) {
      const s = view.snakes.get(id)
      if (!s || !s.alive) continue
      const info = colorRef.current.get(id)
      out.push({
        id,
        name: info?.name ?? "",
        color: info?.color ?? "#3af08d",
        seg: it.sample(now, s.stepMs),
        mine: id === meRef.current?.playerId,
        alive: true,
        dir: s.dir,
        shielded: s.shieldUntil > serverNow,
        boosted: s.speedUntil > serverNow,
      })
    }
    return out
  }, [])

  const getZone = useCallback((): ZoneState | null => {
    const cfg = configRef.current
    const z = zoneBoxesRef.current
    if (!cfg?.zone || !z) return null
    return getZoneState(z.boxes, Date.now() + offsetRef.current - cfg.zone.startAt)
  }, [])

  const players = useMemo(() => room?.players ?? [], [room])
  const phase: NetPhase = room?.status ?? "idle"

  return {
    isConnected,
    isReconnecting,
    ping,
    serverOffsetMs,
    getServerTime,
    connect,
    disconnect,
    phase,
    room,
    players,
    me,
    config,
    startsAt,
    gameState,
    killFeed,
    result,
    rankedResult,
    lastError,
    clearError,
    createRoom,
    joinRoom,
    quickMatch,
    leaveRoom,
    setReady,
    updateProfile,
    updateSettings,
    startGame,
    resetRoom,
    forfeitMatch,
    sendMove,
    gameViewRef: viewRef,
    sampleSnakes,
    getZone,
  }
}
