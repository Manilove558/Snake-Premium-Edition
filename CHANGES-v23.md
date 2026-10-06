# v23 — Socket-Only Migration

Socket.io is now the **only** multiplayer gameplay path. Firebase stays for meta only: Auth, profiles, friends, invites,
store/battle-pass data, leaderboard **reads**, and the stored ranked records.

## What changed
### 1. Server-side ranked settling
- `server/rooms.ts` snapshots every player's rating (`server/ranked-store.ts`, Firebase Admin SDK) **when the countdown starts**.
- When the match ends the server runs `calculateMatchRankings` (`lib/ranked.ts`) on that snapshot and writes `ranked/{uid}`
  for all players in **one** multi-path update, then sends `RANKED_RESULT` (RP/MMR/tier per player) to the room.
- Leavers / disconnects / "Back to room" mid-match = **last place**, still settled. Because every row comes from the same
  snapshot, RP and MMR stay zero-sum even with leavers.
- Min 3 players kept; message is still `Ranked needs 3+ players`.
- If the database write fails the result says so (`saved:false`) — nothing is claimed. Rematch is blocked until the previous result is settled.
- All client ranked writes are removed (`lib/ranked-db.ts` is read-only; `armDisconnectPenalty` & co. deleted).
- Env: `FIREBASE_SERVICE_ACCOUNT_JSON` + **`FIREBASE_DATABASE_URL`** (loaded by the existing `.env.local` loader). Without them ranked
  rooms are refused with `RANKED_UNAVAILABLE`; casual still works. `/health` now also reports `ranked: true|false`.

### 2. Room-level ranked
- `RoomSettings.ranked`, chosen by the host at **creation**, all-or-nothing, frozen afterwards (UPDATE_SETTINGS cannot change it).
- Ranked rules enforced by the server: classic, teleport ON, no snake collision, random map each match, no bots.
- Everybody in a ranked room must be verified (Firebase ID token) with a different account; otherwise `NOT_VERIFIED` / `RANKED_RULES`.
- The per-player "ranked" opt-in toggle is gone. The existing Casual / Ranked tabs now create/join ranked rooms (`expectRanked`, `QUICK_MATCH {ranked}`).

### 3. Firebase realtime sync removed
- Mode toggle removed from `components/multiplayer-lobby.tsx`; the lobby keeps the **same classic UI**, now driven by Socket.io.
- Deleted: `multiplayer-battle.tsx`, `royale-battle.tsx`, `network-*.tsx`, `lib/bot-host.ts`, `hooks/use-bot-host.ts`, `lib/br/net.ts`.
- New (same layout/look as the old classic screens): `classic-net-battle.tsx`, `royale-net-battle.tsx`, `net-provider.tsx` (one shared socket),
  `lib/net-adapter.ts` (socket state -> classic `MpRoom` shape). `lib/multiplayer.ts` is now types/helpers only.
- The socket only opens while multiplayer is on screen. "Server not running" shows the existing clear message (`Can't reach the game server at … npm run server:dev`).
- Untouched: single-player, Auth, profiles, friends, invites (accept now joins via socket), leaderboard reads, store, admin, avatars, battle pass, voice chat.

### 4. Server-side bots
- `server/bots.ts` + `lib/bot-ai.ts` (same pure brain): bots are normal engine snakes driven by the server through `engine.setDirection`.
- Lobby setting "Fill empty slots" + difficulty easy/medium/hard; classic fills to 4, royale to 8. Tagged `[BOT]` in lobby, leaderboard and kill feed. Ranked rooms never have bots.

### 5. Protocol v3 -> v4
New: `RoomSettings.ranked/grid/bots/botLevel`, `LobbyPlayer.vip/bot/botLevel`, `StandingRow.bot`, `RANKED_RESULT`, `FORFEIT_MATCH`,
`expectRanked`, `QUICK_MATCH.ranked`, error codes `NOT_VERIFIED, NOT_RANKED, RANKED_RULES, RANKED_UNAVAILABLE, BAD_TOKEN`.

## firebase-rules.json — DOES IT NEED CHANGES?
**Yes, two small ones (publish the new file):**
1. `invites/{to}/{room}`: the old rule verified the host against `rooms/{code}` in Firebase. Rooms no longer exist there, so the
   check was removed (sender must still be `fromUid == auth.uid`). Without this change, sending invites would fail.
2. `ranked/{uid}`: `.write` is now `false`. The Admin SDK **bypasses rules**, so the server keeps working; this just stops clients
   from editing ratings. (Optional but recommended — the server does not need it.)
`rooms/*` stays open only because voice-chat signalling still uses `rooms/{code}/voice|signals`. `publicLobby` is unused.

## Tests
- `npm run test:net` extended: server ranked calc (zero-sum, snapshot-at-start not influenced by later DB edits), leaver-as-last-place,
  room-level ranked enforcement (frozen flag, NOT_VERIFIED, NOT_RANKED, RANKED_UNAVAILABLE, one seat per account, min-3 message),
  save-failure reporting, bot fill/tagging/movement, no bots in ranked.
- `npx tsx scripts/ranked-selftest.ts` still passes.

## Verification status (be honest)
Run in the build sandbox: `npm run test:net` -> ALL TESTS PASSED, `ranked-selftest` -> ALL TESTS PASSED, server files (`rooms/bots/ranked-store/engine`)
type-check clean with strict tsc.
**Could not run in the sandbox** (npm registry tarballs return 403, so no `node_modules`): full `npx tsc --noEmit`, `npm run server:typecheck`,
`npm run build`, and booting the server for `/health`. Client files were checked against the real shared/server code only (no React/Next types available).
Please run these four on your machine before shipping.
