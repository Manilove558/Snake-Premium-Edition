> **v23 update:** this document describes the original (v21/v22) integration. Since v23 the Socket.io server is the ONLY
> multiplayer path: the Firebase-vs-Socket toggle, `lib/multiplayer.ts`' Firebase code, `multiplayer-battle.tsx`,
> `royale-battle.tsx` and the host-browser bot runner are gone. Ranked, bots and matchmaking now run on the server —
> see `CHANGES-v23.md`. Sections below that talk about running "next to" Firebase are historical.

# Real-time network layer (Socket.io) — setup & integration

Server-authoritative multiplayer that runs **next to** the existing Firebase battle (nothing was replaced).

```
shared/snake-protocol.ts   event names, payload types, rules/constants, validators   (server + browser)
shared/sync-reducer.ts     applies GAME_STATE_SYNC deltas to the client view          (server tests + browser)
server/engine.ts           authoritative simulation: moves, collisions, food, power-ups, zone, placements
server/rooms.ts            rooms, lobby, matchmaking, countdown, reconnect grace, host migration
server/index.ts            Socket.io wiring, rate limits, 20 TPS loop, /health          (only file that imports socket.io)
hooks/useSnakeNetwork.ts   the React hook (connection, ping, state merge, interpolation)
scripts/net-selftest.ts    engine + rooms + delta-sync tests (no sockets needed)
```

Reused as-is from the game: `lib/br/zone.ts`, `lib/br/spawns.ts`, `lib/br/constants.ts`, `lib/br/interpolation.ts`,
`lib/battle-maps.ts`. The zone is derived from `(seed, startAt)` on **both** sides, so it is never sent per tick.

## 1. Install & run

```bash
npm i socket.io socket.io-client
npm i -D tsx

npm run server:dev        # Socket.io server on :4000   (GET /health -> JSON)
npm run dev               # Next.js on :3000
npm run test:net          # engine/rooms/delta tests -> "NET: ALL TESTS PASSED"
npm run server:typecheck  # type-check the server with its own tsconfig
```

`.env.local`: `NEXT_PUBLIC_SNAKE_SERVER_URL=http://localhost:4000` (see `.env.example`).

> **Run it as its own long-lived process** (Railway / Fly.io / Render / VPS). It cannot live inside Next.js:
> the app is exported statically (`webDir: "out"` in `capacitor.config.ts`) and serverless hosts cannot keep WebSockets open.
> Production needs `wss://` (HTTPS) — Android WebViews block plain `ws://` to remote hosts.
> Set `CORS_ORIGINS` to your site; the default already allows `localhost:3000` and the Capacitor WebView origins.

## 2. How a match flows

```
CREATE_ROOM / JOIN_ROOM / QUICK_MATCH  ->  ack { code, playerId, token, room }      (token = reconnect secret)
ROOM_UPDATE  (every lobby change)      <-  RoomSnapshot { players[{ready,isHost,connected,color,skinId}], settings, autoStartAt }
SET_READY / UPDATE_PROFILE / UPDATE_SETTINGS (host)
START_GAME (host)                      ->  GAME_STARTING { config, startsAt, state }   3 s countdown, full first snapshot
                                       <-  GAME_STATE_SYNC  deltas @ ≤20 Hz (normally ~6.7 Hz: one per 150 ms step)
MOVE_INPUT { dir, seq }                ->  (fire-and-forget; the server validates everything)
                                       <-  PLAYER_DIED { cause, killer, placement }
                                       <-  GAME_OVER { winnerId, standings[{placement,kills,peakMass,disconnected}] }
RESET_ROOM (host)                      ->  back to the lobby for a rematch
```

* **20 TPS** simulation (50 ms); a snake moves every 3 ticks = **150 ms** (same pace as today), every 2 ticks (100 ms) with the speed power-up.
* **Rules:** reversals rejected, ≤2 buffered turns, simultaneous collision resolution (head-on kills both, a shielded snake survives),
  corpses become food (every 3rd segment), power-ups `speed` (6 s) and `shield` (5 s, collision-immune; walls/zone still kill),
  Royale zone damage (3 s grace, tail loss while outside), 10-minute hard cap.
* **Disconnects:** the slot **and the snake** are kept for 15 s (`RECONNECT_GRACE_MS`). Back in time → same snake, full resync.
  Otherwise the snake dies (`cause: "disconnect"`), becomes food and the player is flagged `disconnected` in the standings.
* **Host left?** The oldest connected player becomes host.
* **Public lobbies** (`QUICK_MATCH` / `isPublic`): auto-start 30 s after the minimum is reached, 3 s after it is full.

## 3. Lobby — plugging the hook into `components/multiplayer-lobby.tsx`

`multiplayer-lobby.tsx` talks to Firebase through `createRoom / joinRoom / subscribeToRoom / updateRoomSettings / startBattle / joinGlobal`.
Don't rip that out — add the network path next to it (e.g. a toggle, or when `NEXT_PUBLIC_SNAKE_SERVER_URL` is set).

| Existing Firebase call            | `useSnakeNetwork` equivalent                         |
|-----------------------------------|------------------------------------------------------|
| `createRoom(...)`                 | `net.createRoom({ name, color, skinId, settings })`  |
| `joinRoom(code, ...)`             | `net.joinRoom({ code, name })`                       |
| `joinGlobal(...)`                 | `net.quickMatch({ name, mode })`                     |
| `subscribeToRoom(code, cb)`       | automatic: `net.room`, `net.players`                 |
| `updateRoomSettings(code, patch)` | `net.updateSettings(patch)` (host)                   |
| `startBattle(code)`               | `net.startGame()` (host)                             |
| `leaveRoom(code, id)`             | `net.leaveRoom()`                                    |
| host/ready flags                  | `net.me?.isHost`, `player.ready`, `net.setReady(b)`  |

```tsx
"use client"
import { useState } from "react"
import { useSnakeNetwork } from "@/hooks/useSnakeNetwork"

/** Drop-in lobby for the Socket.io mode. `name` / `skinId` come from the profile you already have. */
export function NetworkLobby({ name, skinId }: { name: string; skinId?: string }) {
  const net = useSnakeNetwork({ onError: (e) => console.warn("[net]", e.code, e.message) })
  const [code, setCode] = useState("")

  const pingColor = net.ping === null ? "#888" : net.ping < 80 ? "#3af08d" : net.ping < 160 ? "#ffe14d" : "#ff5d7a"

  return (
    <div>
      {/* connection badge: ping in ms, reconnect indicator */}
      <div style={{ color: pingColor }}>
        {!net.isConnected ? (net.isReconnecting ? "Reconnecting…" : "Offline") : `${net.ping ?? "–"} ms`}
      </div>
      {net.lastError && <p onClick={net.clearError}>{net.lastError.message}</p>}

      {!net.room ? (
        <>
          <button onClick={() => net.createRoom({ name, skinId })}>Create room</button>
          <input value={code} onChange={(e) => setCode(e.target.value)} maxLength={6} placeholder="CODE" />
          <button onClick={() => net.joinRoom({ code, name, skinId })}>Join</button>
          <button onClick={() => net.quickMatch({ name, skinId, mode: "classic" })}>Join global</button>
        </>
      ) : (
        <>
          <h3>Room {net.room.code}</h3>
          {net.players.map((p) => (
            <div key={p.id} style={{ opacity: p.connected ? 1 : 0.4 }}>
              <span style={{ color: p.color }}>●</span> {p.name} {p.isHost && "👑"} {p.ready && "✔"}
              {!p.connected && " (reconnecting…)"}
            </div>
          ))}

          {net.me?.isHost ? (
            <>
              <button onClick={() => net.updateSettings({ mode: net.room!.settings.mode === "royale" ? "classic" : "royale" })}>
                Mode: {net.room.settings.mode}
              </button>
              <button onClick={() => net.startGame()}>Start ({net.players.length}/{net.room.maxPlayers})</button>
            </>
          ) : (
            <button onClick={() => net.setReady(!net.players.find((p) => p.id === net.me?.playerId)?.ready)}>Ready</button>
          )}
          {net.room.autoStartAt && <p>Starts at {new Date(net.room.autoStartAt - net.serverOffsetMs).toLocaleTimeString()}</p>}
          <button onClick={() => net.leaveRoom()}>Leave</button>
        </>
      )}

      {net.phase === "countdown" && <p>Get ready…</p>}
      {/* when net.phase === "playing" render <NetworkArena net={net} /> (section 4) */}
    </div>
  )
}
```

Reloading the page mid-lobby or mid-match restores the session automatically (room code + player id + token live in `sessionStorage`).

## 4. Game — feeding real-time coordinates into the renderers

`net.gameState` (React state, ~7 Hz) is for HUD: scores, alive count, foods. For the canvas use the **render-loop helpers** — they don't trigger React re-renders:

* `net.sampleSnakes(now)` → every snake with **interpolated** cells at 60 fps (`RenderSnake` has the same `id / color / seg / mine` fields as `DrawSnake` in `lib/br/render.ts`)
* `net.gameViewRef.current.foods` → live food map
* `net.getZone()` → the Royale `ZoneState` (box, target, warning …), computed from the server clock

### 4a. Battle Royale — reuse `drawBrFrame` + `Camera` unchanged

```tsx
"use client"
import { useEffect, useRef } from "react"
import { Camera } from "@/lib/br/camera"
import { drawBrFrame } from "@/lib/br/render"
import { BR_CELL, BR_VIEW_CELLS } from "@/lib/br/constants"
import type { UseSnakeNetwork } from "@/hooks/useSnakeNetwork"

export function NetworkArena({ net }: { net: UseSnakeNetwork }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const camera = useRef(new Camera())
  const netRef = useRef(net)
  netRef.current = net // the rAF loop always sees the latest hook value without restarting

  useEffect(() => {
    let raf = 0
    let last = performance.now()
    const frame = (t: number) => {
      raf = requestAnimationFrame(frame)
      const n = netRef.current
      const ctx = canvasRef.current?.getContext("2d")
      const zone = n.getZone()
      if (!ctx || !zone) return

      const snakes = n.sampleSnakes(t) // <- smoothed server positions
      const mine = snakes.find((s) => s.mine)
      const spectate = mine ?? snakes[0] // dead? follow whoever is still alive
      if (spectate) camera.current.follow(spectate.seg[0].x, spectate.seg[0].y, t - last)
      last = t

      drawBrFrame(ctx, {
        camera: camera.current,
        zone,
        foods: [...n.gameViewRef.current.foods.values()],
        snakes,
        now: t,
        darkMode: true,
        grid: true,
        followId: mine ? null : (spectate?.id ?? null),
      })
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [])

  return <canvas ref={canvasRef} width={BR_VIEW_CELLS * BR_CELL} height={BR_VIEW_CELLS * BR_CELL} />
}
```

### 4b. Classic 20×20 arena (walls / portals from `net.config`)

`drawBrFrame` is built for the 120×120 world, so the classic arena needs a small draw function (or reuse the one inside `multiplayer-battle.tsx`):

```ts
import type { RenderSnake, UseSnakeNetwork } from "@/hooks/useSnakeNetwork"

export function drawClassic(ctx: CanvasRenderingContext2D, net: UseSnakeNetwork, snakes: RenderSnake[], cell = 18) {
  const cfg = net.config
  if (!cfg) return
  ctx.clearRect(0, 0, cfg.cols * cell, cfg.rows * cell)
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
    s.seg.forEach((c, i) => ctx.fillRect(c.x * cell + 1, c.y * cell + 1, cell - 2, cell - 2)) // c.x/c.y are floats while gliding
    ctx.globalAlpha = 1
  }
}
```

### 4c. `components/snake-game.tsx` / `SmoothSnakeLayer` — feed my own snake

`SmoothSnakeLayer` takes the snake as `Cell[]` and glides between updates. Hand it the server's cells and the server's step length:

```tsx
const cfg = net.config
const mine = net.gameState?.snakes.find((s) => s.id === net.me?.playerId)

{cfg && (
  <SmoothSnakeLayer
    snake={mine?.cells ?? []}                       // new array on every sync -> new glide target
    active={net.phase === "playing" && !!mine?.alive}
    tickMs={mine?.stepMs ?? cfg.stepMs}             // 150 ms, 100 ms while sped up
    cell={18} cols={cfg.cols} rows={cfg.rows}
    skin={mySkin} graceActive={false} darkMode
  />
)}
```

### 4d. Input — reuse `useBattleSteering`

```tsx
import { useBattleSteering } from "@/hooks/use-battle-steering"
import { DIR_VECTOR, dirFromVector } from "@/shared/snake-protocol"

useBattleSteering({
  canSteer: () => net.phase === "playing",
  controlMode: "swipe",
  getDir: () => {
    const mine = net.gameViewRef.current.snakes.get(net.me?.playerId ?? "")
    const v = mine ? DIR_VECTOR[mine.dir] : { dx: 0, dy: 0 }
    return { x: v.dx, y: v.dy }
  },
  setDir: (x, y) => {
    const d = dirFromVector(x, y)
    if (d) net.sendMove(d) // filtered locally: same / opposite direction costs no message
  },
  getSurfaces: () => [arenaEl.current],
  rerunKey: net.phase,
})
```

### 4e. Match end → ranked

`onGameOver` / `net.result.standings` already contain exactly what `calculateMatchRankings()` (`lib/ranked.ts`) needs:

```ts
useSnakeNetwork({
  onGameOver: (r) => {
    const players = r.standings.map((row) => ({
      uid: row.id,                 // map room player id -> account id (see "Not included" below)
      placement: row.disconnected ? r.standings.length : row.placement, // leavers count as last
      kills: row.kills,
      peakMass: row.peakMass,
      ...profileOf(row.id),        // mmr, rp, gamesPlayed, protectionGamesLeft from your DB
    }))
    const updates = calculateMatchRankings(players) // zero-sum
  },
})
```

**Do this on the server**, not in the browser — that is the whole point of a server-authoritative match (a client that computes its own result can lie).

## 5. Lag handling in one picture

* **Interpolation:** the server only sends a snake when it moved (every 150 ms). The hook pushes each update into a `SnakeInterpolator`
  (the Royale's class), which slides every segment from its old to its new cell over `stepMs` → 60 fps motion, no extrapolation, no rubber-banding.
* **Ping:** a `PING` every 2 s; `net.ping` = smoothed RTT (EMA, ms). The same probe estimates the server-clock offset (best of the last 8 samples) → `net.getServerTime()`.
* **Input latency** ≈ ½ RTT + up to 150 ms (a turn is applied at the snake's next step). The server echoes `seq` per snake (`SnakeView.seq`) so client-side
  prediction can be added later without a protocol change.
* **Bandwidth:** only moved snakes, flat `[x,y,…]` arrays, food as add/remove patches, zone derived from `(seed, startAt)`.
  A full snapshot is re-sent every 5 s as a safety net and on every (re)connect.

## 6. Anti-cheat built in

Clients can only send a direction. The server owns positions, food, collisions, scores, placements. Additionally: payload validation + sanitising
(names, colours, codes), per-socket token buckets (`MOVE_INPUT` 30/s, requests 5/s, disconnect after 200 violations), 10 KB max message size,
reconnect tokens compared in constant time, ≤2 buffered turns, 180° turns rejected server-side too.

## 7. Not included (deliberate scope limits)

* **Auth:** `uid` / display name are not verified. For ranked, send the Firebase **ID token** on connect (`auth: { token }`) and verify it in
  `io.use(...)` with `firebase-admin`; then bind `uid` to the player. Without this anyone can claim any name.
* **Bots** (the Firebase mode runs them in the host's browser) and the **friends / VIP / store** features are not ported.
* **Scaling:** one Node process holds all rooms in memory (fine for hundreds of players). For several instances add the Socket.io Redis adapter
  **and** sticky routing by room code — rooms are not shareable across processes.
* **Compression:** `perMessageDeflate` is off (CPU vs. bandwidth); payloads are small. Enable it only if egress cost matters.
* The Socket.io wiring (`server/index.ts`, `hooks/useSnakeNetwork.ts`) was type-checked against a stub of the Socket.io API but **not run against the
  real package** in the build environment — do a first smoke test locally (`server:dev` + two browser tabs).
