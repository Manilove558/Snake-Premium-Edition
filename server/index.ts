// server/index.ts — Socket.io entry point (the ONLY server file that imports socket.io).
//
//   npm i socket.io            (and: npm i -D tsx)
//   npm run server:dev         -> tsx watch server/index.ts
//
// Environment
//   PORT          default 4000
//   CORS_ORIGINS  comma separated allow-list, default covers Next dev + Capacitor (see below)
//
// This must run as its OWN long-lived Node process (Railway, Fly.io, Render, a VPS …).
// It cannot live inside Next.js: the app is exported statically (webDir: "out") and serverless
// hosts such as Vercel cannot hold WebSocket connections open.
import { createServer } from "node:http"
import { Server, type Socket } from "socket.io"
import {
  NET,
  PROTOCOL_VERSION,
  type AckResult,
  type ClientToServerEvents,
  type NetErrorCode,
  type S2CEvent,
  type S2CPayload,
  type ServerToClientEvents,
} from "../shared/snake-protocol"
import { RoomManager, type Transport } from "./rooms"

type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents>

const PORT = Number(process.env.PORT ?? 4000)
const DEFAULT_ORIGINS = [
  "http://localhost:3000", // next dev
  "capacitor://localhost", // iOS WebView
  "http://localhost", // Android WebView (Capacitor)
  "https://localhost", // Android WebView with androidScheme: "https"
]
const ORIGINS = (process.env.CORS_ORIGINS ?? DEFAULT_ORIGINS.join(","))
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)

// ---------------------------------------------------------------------------
// HTTP (health check only) + Socket.io
// ---------------------------------------------------------------------------

const httpServer = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ ok: true, protocol: PROTOCOL_VERSION, uptimeSec: Math.round(process.uptime()), ...manager.stats() }))
    return
  }
  res.writeHead(404).end()
})

const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: { origin: ORIGINS, methods: ["GET", "POST"] },
  pingInterval: 10_000, // socket.io's own liveness check (the app-level PING below measures latency)
  pingTimeout: 8_000,
  maxHttpBufferSize: 10_000, // all our payloads are tiny — refuse anything big
  transports: ["websocket", "polling"],
})

/** socket.io <-> RoomManager. The two casts are the only place event names lose their static typing. */
type AnyEmitter = { emit: (event: string, payload: unknown) => unknown }
const transport: Transport = {
  toRoom: <E extends S2CEvent>(code: string, event: E, payload: S2CPayload<E>) => {
    ;(io.to(code) as unknown as AnyEmitter).emit(event, payload)
  },
  toSocket: <E extends S2CEvent>(socketId: string, event: E, payload: S2CPayload<E>) => {
    const s = io.sockets.sockets.get(socketId)
    if (s) (s as unknown as AnyEmitter).emit(event, payload)
  },
  joinChannel: (socketId, code) => void io.sockets.sockets.get(socketId)?.join(code),
  leaveChannel: (socketId, code) => void io.sockets.sockets.get(socketId)?.leave(code),
}
const manager = new RoomManager(transport)

// ---------------------------------------------------------------------------
// Per-socket rate limiting (token bucket). Direction inputs get a generous bucket, everything else a small one.
// ---------------------------------------------------------------------------

class Bucket {
  private tokens: number
  private last = Date.now()
  constructor(
    private readonly capacity: number,
    private readonly perSec: number,
  ) {
    this.tokens = capacity
  }
  take(): boolean {
    const now = Date.now()
    this.tokens = Math.min(this.capacity, this.tokens + ((now - this.last) / 1000) * this.perSec)
    this.last = now
    if (this.tokens < 1) return false
    this.tokens -= 1
    return true
  }
}

const reply = (ack: unknown, result: unknown): void => {
  if (typeof ack === "function") (ack as (r: unknown) => void)(result)
}
const failure = (code: NetErrorCode, message: string): AckResult<never> => ({ ok: false, code, message })

io.on("connection", (socket: GameSocket) => {
  const control = new Bucket(10, 5) // lobby / room requests
  const moves = new Bucket(40, 30) // MOVE_INPUT
  let violations = 0

  const noteViolation = (): void => {
    if (++violations > 200) socket.disconnect(true) // hammering the server: drop the connection
  }

  /** Run a request handler: rate-limit it, never let an exception escape, always answer the ack. */
  const handle = (ack: unknown, fn: () => unknown): void => {
    if (!control.take()) {
      noteViolation()
      return reply(ack, failure("RATE_LIMITED", "Slow down"))
    }
    try {
      reply(ack, fn())
    } catch (err) {
      console.error("[handler]", err)
      reply(ack, failure("INTERNAL", "Something went wrong"))
    }
  }

  socket.on("CREATE_ROOM", (p, ack) => handle(ack, () => manager.createRoom(socket.id, p, Date.now())))
  socket.on("JOIN_ROOM", (p, ack) => handle(ack, () => manager.joinRoom(socket.id, p, Date.now())))
  socket.on("QUICK_MATCH", (p, ack) => handle(ack, () => manager.quickMatch(socket.id, p, Date.now())))
  socket.on("RECONNECT_ROOM", (p, ack) => handle(ack, () => manager.reconnect(socket.id, p, Date.now())))
  socket.on("LEAVE_ROOM", (ack) => handle(ack, () => manager.leave(socket.id, Date.now())))
  socket.on("SET_READY", (p, ack) => handle(ack, () => manager.setReady(socket.id, p, Date.now())))
  socket.on("UPDATE_PROFILE", (p, ack) => handle(ack, () => manager.updateProfile(socket.id, p, Date.now())))
  socket.on("UPDATE_SETTINGS", (p, ack) => handle(ack, () => manager.updateSettings(socket.id, p, Date.now())))
  socket.on("START_GAME", (ack) => handle(ack, () => manager.startGame(socket.id, Date.now())))
  socket.on("RESET_ROOM", (ack) => handle(ack, () => manager.resetRoom(socket.id, Date.now())))

  socket.on("MOVE_INPUT", (p) => {
    if (!moves.take()) {
      noteViolation()
      return
    }
    try {
      manager.moveInput(socket.id, p)
    } catch (err) {
      console.error("[move]", err)
    }
  })

  // Latency probe: answer immediately with the server clock. The client measures the round trip.
  socket.on("PING", (_clientTs, ack) => reply(ack, Date.now()))

  socket.on("disconnect", () => manager.onDisconnect(socket.id, Date.now()))
})

// ---------------------------------------------------------------------------
// 20 TPS loop. Self-correcting setTimeout (setInterval drifts). If the event loop stalls we do NOT
// run catch-up ticks — that would make every snake lurch forward — we just resume from "now".
// ---------------------------------------------------------------------------

let nextTickAt = Date.now() + NET.TICK_MS
let slowTicks = 0
const loop = (): void => {
  const started = Date.now()
  try {
    manager.tick(started)
  } catch (err) {
    console.error("[tick]", err) // one bad room must not kill the server
  }
  const spent = Date.now() - started
  if (spent > NET.TICK_MS / 2 && ++slowTicks % 20 === 1) console.warn(`[tick] slow: ${spent} ms (budget ${NET.TICK_MS} ms)`)

  nextTickAt += NET.TICK_MS
  if (nextTickAt < Date.now() - NET.TICK_MS * 5) nextTickAt = Date.now() + NET.TICK_MS // fell far behind: resync
  setTimeout(loop, Math.max(0, nextTickAt - Date.now()))
}

httpServer.listen(PORT, () => {
  console.log(`[snake] Socket.io server on :${PORT}  (protocol v${PROTOCOL_VERSION}, ${NET.TICK_RATE} TPS)`)
  console.log(`[snake] allowed origins: ${ORIGINS.join(", ")}`)
  loop()
})

const shutdown = (): void => {
  console.log("[snake] shutting down")
  void io.close(() => process.exit(0))
  const force = setTimeout(() => process.exit(0), 3_000)
  ;(force as unknown as { unref?: () => void }).unref?.() // don't keep the process alive just for this timer
}
process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)
