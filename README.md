# Smooth movement toggle (Battle Royale style)

Settings -> MOVEMENT -> "Smooth movement" (ON by default, saved on the device).
ON  = snake glides between cells at 60fps (Battle Royale style)
OFF = classic cell-by-cell steps
Works in: single-player, classic multiplayer battle, Battle Royale. Game logic/speed/collisions are unchanged.

NEW       lib/smooth-move.ts, components/smooth-snake-layer.tsx
MODIFIED  components/snake-game.tsx, home-popups.tsx, multiplayer-battle.tsx, royale-battle.tsx

NOTE: multiplayer-battle.tsx and royale-battle.tsx here ALSO contain the AI-bots changes from the previous update
(bots-update.zip). Apply bots-update first, then this folder over it.
