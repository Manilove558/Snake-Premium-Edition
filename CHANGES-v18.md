# v18 changes — central frame (in-frame panels)

- Naya `components/panel-host.tsx`: ek hi `activeView` state ('GAME' | 'STORE' | 'VAULT' | 'SETTINGS' | 'PROFILE' | 'FRIENDS' | 'MAILBOX' | 'ADMIN' | 'RANK' | 'MAP' | 'MULTIPLAYER').
- Store, Vault, Settings, Rank, Map, Profile, Friends, Mailbox, Admin aur Multiplayer lobby ab full-screen popup nahi — central frame ke andar khulte hain. Left strip aur right dashboard chalte rehte hain.
- Frame ke top-right me ✕ (close) button; panels ke andar ke purane top-level close/back buttons hide hain (`.panel-inner-close`). Smooth fade/scale transition (`panel-in`).
- Right panel top row order: Profile, Friends, Mailbox, Store, Settings ⚙️, Admin 🛡️, Vault. Settings Options grid se hata diya.
- Multiplayer lobby frame ke andar hai; room me ho to doosra panel khol/band kar sakte ho, lobby background me mounted rehta hai. Lobby ka apna Close/Leave button use hota hai (room sahi se chhodne ke liye).
- Multiplayer battle landscape layout: left me arena (available space ka sabse bada square), right me scores + kill feed + controls (D-pad / swipe pad).
- Files: panel-host.tsx (new), snake-game.tsx, home-popups.tsx, snake-store.tsx, snake-vault.tsx, snake-profile.tsx, snake-friends.tsx, mailbox.tsx, admin-panel.tsx, multiplayer-lobby.tsx, multiplayer-battle.tsx, app/globals.css

## v18.1 — Store grid
- Store me ab ek row me 3 items (pehle 2). Featured items bhi bilkul usi size ke (ek grid cell ke barabar), side-scroll me.
- Card thoda compact: chhota naam/label, 36px button.
- File: components/snake-store.tsx

## v18.2 — Map popup = Room Settings jaisa design
- Map icon dabane par ab sirf naam wale buttons nahi, balki Room Settings jaise tiles: upar mini board preview (walls / portals) aur neeche map ka naam. Ek row me 4 tiles (pehle room settings me 3).
- Preview wahi layout dikhata hai jo game me hota hai (Walls, Maze, Box, Tunnel, Mill, Apartment, Zigzag, Portal, Campaign level 1). Classic / Speed / Reverse / Multiplayer me koi wall nahi, isliye khali board.
- Selected map par emerald border + naam emerald.
- Files: components/home-popups.tsx, components/snake-game.tsx

## v18.3
- Canvas ke bahar header me "🗺 <map name>" wala chip hata diya. Map ka naam ab sirf canvas ke andar dikhta hai (preview me aur game HUD me).
- File: components/snake-game.tsx

## v18.4 — Future buttons hamesha dikhte hain
- Left strip (Future Buttons, vertical) ab har mode me rehti hai: home, classic game ke dauraan, aur multiplayer / ranked battle me bhi. Pehle game chalte waqt hat jati thi.
- Multiplayer battle ab full-screen nahi dhakta: uska panel strip ke right se shuru hota hai.
- Files: components/snake-game.tsx, components/multiplayer-battle.tsx

## v18.5 — Multiplayer ab classic canvas par
- Multiplayer battle ka alag overlay panel (apna canvas + apne controls) hata diya.
- Battle ab classic game wale hi center board frame me draw hota hai (same size, border, glow, background + grid), left Future-buttons strip bhi waisi hi.
- Right dashboard bilkul classic jaisa: Score / Best, D-pad ya "Swipe to steer" pad (Settings ke control mode ke hisab se), neeche Exit (X) button. Live battle pause nahi hoti, isliye Pause nahi hai.
- Room code, voice chat, mini leaderboard aur kill feed right panel me compact rakhe.
- Countdown, Eliminated, Result / Rematch / Back to room overlay board ke andar hi dikhte hain.
- Files: components/multiplayer-battle.tsx, components/snake-game.tsx

## v18.6 — Multiplayer layout (only when a battle is active)
- New flag `isMultiplayerActive` in snake-game.tsx. Single-player / lobby UI is unchanged.
- Player leaderboard (rank/crown, colour dot, name, skull when out, live score) moved from the right panel to a new left column between the Future-buttons strip and the board, with the latest kill below it.
- Red ✕ exit button removed from the bottom of the right panel and placed between the cards: [ SCORE ] [ ✕ ] [ BEST ].
- Files: components/multiplayer-battle.tsx, components/snake-game.tsx

## v18.7 — Room lobby
- Room me players ab ek row me 3 (grid 3 columns, compact card: colour dot, naam, HOST / (you) tag, friend action; host ke card par settings gear).
- Pehle wala bada "Start Battle" button + alag "Leave Room" button ab ek split button hai: [ Start | Leave Room ]. Start sirf host ke liye (min players poore hone par) enabled; Leave Room sabko.
- Lobby card thoda wide (max-w-md) taaki 3 cards fit ho.
- File: components/multiplayer-lobby.tsx

## v18.8 — Room players = battle jaisi row, 2 per row
- Room me player ab battle ke leaderboard jaisi horizontal row me: [host icon] ● naam (VIP crown ke saath), ek row me 2 players (3 se 2 kiya).
- "(you)" text hata ke apni row par green ring (battle jaisa). HOST ab chhota icon hai. Friend action aur host ka settings gear row ke end me.
- File: components/multiplayer-lobby.tsx

## v18.9 — Host-only start + Leave Room icon in the bottom-right bar
- Match start is host-only. Non-host: both Start buttons (lobby modal + bottom-right bar) are disabled and read "Waiting for Host...".
- Host can start from either place: the Start half of the lobby modal's [Start | Leave Room], or the bottom-right bar's Start. Start also needs the minimum players. `handleStartBattle` re-checks `isHost` as a safety net.
- Bottom-right bar inside a room: [ Start ] | [ 🚪 Leave Room ] | [ Multiplayer ]. Outside a room it stays [ Start ] | [ Multiplayer ].
- The bottom-bar Leave Room leaves the room (voice + Firebase) and returns to the default single-player view (mpView none, session cleared, frame back to GAME).
- Lobby reports room state to the home screen via `onRoomInfo` + `actionsRef` (LobbyRoomInfo / LobbyActions in multiplayer-lobby.tsx).
- Files: components/multiplayer-lobby.tsx, components/snake-game.tsx

## v18.10 — Lobby modal cleanup (single control hub)
- Central lobby modal: the [ Start | Leave Room ] block under the Voice Chat card is removed. The card now ends right after Voice Chat (global auto-start status line, when present, stays as info only).
- Start (host only), Leave Room and Multiplayer all live in the bottom-right action bar.
- Overlay padding p-2 -> p-3; the card stays vertically centred (m-auto), no empty space at the bottom.
- File: components/multiplayer-lobby.tsx

## v18.11 — Everything stays inside the central frame
- Audit: Store, Vault, Settings, Rank, Map, Profile, Friends, Mailbox, Admin and Multiplayer already render inside the central frame via the single `activeView` state (panel-host.tsx); left strip + right dashboard stay live.
- Fixed leftovers that still covered the whole screen: Store's "Get Gems/Coins" + buy-confirm sheets, Admin sheets, toasts, and the Rank details sheet (was portalled to document.body). `.panel-layer` now has `contain: layout paint`, so nested `fixed` sheets/toasts are clipped to the frame; Rank details portals into the frame; Admin sheet `dvh` -> `%`.
- Top icon row (right panel): Profile, Friends, Mailbox, Store, Settings ⚙️, Admin 🛡️, Vault, + a red Close ✕ at the end that appears only while a panel is open and returns to the game view (same as the ✕ inside the frame).
- Files: app/globals.css, components/ranked-panel.tsx, components/admin-panel.tsx, components/snake-game.tsx
