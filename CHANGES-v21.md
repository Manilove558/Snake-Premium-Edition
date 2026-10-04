# v21.0 — Real-time network layer (Socket.io, server-authoritative)

Naya, **firebase ke saath-saath** chalne wala multiplayer layer. Purana Firebase battle waisa hi hai.

- `server/` — Node + Socket.io server: `engine.ts` (20 TPS authoritative simulation), `rooms.ts` (lobby, matchmaking, reconnect, host migration), `index.ts` (wiring, rate-limit, /health).
- `shared/snake-protocol.ts` — typed events (`CREATE_ROOM`, `JOIN_ROOM`, `START_GAME`, `MOVE_INPUT`, `GAME_STATE_SYNC`, `PLAYER_DIED`, `GAME_OVER` …), payloads, constants, validators.
- `shared/sync-reducer.ts` — delta -> client state merge (hook aur test dono same code use karte hain).
- `hooks/useSnakeNetwork.ts` — `isConnected`, `ping`, `players`, `gameState`, actions, `sampleSnakes()` (60 fps interpolation), `getZone()`.
- `docs/NETWORK-INTEGRATION.md` — lobby + game rendering + input + ranked integration examples.
- `scripts/net-selftest.ts` — `npm run test:net` (engine, rooms, "snapshot + deltas == server state" fuzz).
- `package.json`: sirf scripts add hue (`server:dev`, `server:start`, `server:typecheck`, `test:net`). `tsconfig.json`: `server/index.ts` Next typecheck se exclude.
- `.env.example`: `NEXT_PUBLIC_SNAKE_SERVER_URL`.

## Karna zaroori hai
1. `npm i socket.io socket.io-client` aur `npm i -D tsx`  (⚠ jab tak install nahi, `hooks/useSnakeNetwork.ts` ki wajah se `next build` fail hoga).
2. `npm run server:dev` + `npm run dev`, do browser tabs se smoke test.
3. Production: server alag Node process (Railway/Fly/Render) + `wss://`, `CORS_ORIGINS` set karo.

## Abhi nahi hai
Auth (Firebase ID token verify), bots, friends/VIP/store, multi-instance scaling. Details: docs section 7.
