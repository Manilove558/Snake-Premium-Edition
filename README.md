# AI Bots update

Copy the folders in this directory over your project (same paths). 4 new files, 5 modified files:

NEW        lib/bot-ai.ts              pure bot brain (BFS food seeking, raycast + flood-fill avoidance, zone logic, Easy/Medium/Hard)
NEW        lib/bot-host.ts            host-side runner: spawns, ticks, collisions, deaths, food, heartbeat (classic + royale)
NEW        hooks/use-bot-host.ts      runs the runner on the host; host takeover if the host drops
NEW        components/bot-tag.tsx     [BOT] badge
MODIFIED   lib/multiplayer.ts         bot fields/settings, auto-fill at start, cleanup, leaveRoom fix
MODIFIED   components/multiplayer-battle.tsx, royale-battle.tsx, royale-victory.tsx, multiplayer-lobby.tsx

No Firebase rules change needed (rooms/$code is already open for read/write).
Tuning knobs: BOT_FILL_TARGET (lib/multiplayer.ts), BOT_DIFFICULTY (lib/bot-ai.ts).
