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
