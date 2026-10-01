# v12 changes

## 1. Store → Avatars tab (nayi)
- Store me ab 4 tabs: Skins · Trails · **Avatars** · VIP Pass.
- Player yaha se apni profile pic badal sakta hai. 6 avatars FREE (+ "Google Photo" default), 12 avatars VIP Pass me (👑 🐉 🐺 🦁 🦅 🦄 🔥 💎 👽 🤖 🥷 🦂).
- VIP avatar ke liye alag buy nahi: VIP active hai to sab use kar sakte ho; VIP khatam hone par equipped VIP avatar apne aap Google photo par wapas.
- Avatar profile (👤), header button, friends/profile view — sab jagah dikhta hai, dusre players ko bhi (`publicProfiles/{uid}/avatar`).
- Code: `lib/store.ts` (ITEMS, `equipped.avatar`), `components/player-avatar.tsx`, `components/snake-store.tsx`.

## 2. Ranked tab: Create Ranked Room | Join Global
- Ranked ka bada button ab beech se 2 hisso me: **Create Ranked Room** aur **Join Global** (sirf ranked players se match).
- Casual Global aur Ranked Global alag hain (ek dusre ke room me nahi jaate).
- Ranked global room me countdown tab shuru hota hai jab 3+ players ho (Elo ke liye minimum 3).
- Code: `components/ranked-panel.tsx`, `lib/multiplayer.ts` (`joinGlobal(..., ranked)`), `components/multiplayer-lobby.tsx`.

## 3. Rank sab ko dikhta hai + medal par click
- Apni profile me aur kisi bhi player ki profile me: rank medal + Elo + W/L (sab signed-in player dekh sakte hain).
- Medal par tap → **Rank details**: tier, Elo, next tier tak progress bar, world position (#N), win rate, poori rank ladder, aur dusre player ke liye "tumse kitna higher/lower".
- Leaderboard ke medal par bhi tap chalta hai.
- Code: `RankDetailsSheet` + `TierBadge onClick` in `components/ranked-panel.tsx`.

## 4. Rank Pass rewards
- Jab player pehli baar naye tier me pahunchta hai: **coins + hamesha 1 gem**.
  Gold = 1000 coins, Platinum = 2000, Diamond = 4000 (Silver/Bronze me reward nahi: sab Silver (1000 Elo) se start karte hain).
- Har tier ka reward sirf ek baar (`rankClaimed` cloud save me). Match ke baad auto milta hai; Rank details me "Claim" button bhi hai (backup).
- Amounts badalne ke liye: `RANK_PASS_COINS` / `RANK_PASS_GEMS` in `lib/ranked.ts`.

## Note
Firebase rules me koi change nahi chahiye.

## v13.1 — verification fixes (Sep 30, 2026)
- Fixed `lib/ranked-db.ts`: `snap.numChildren()` → `snap.size` (Firebase v12 removed `numChildren()`; caused a real TS error).
- Re-applied PC mode-change fix in `components/snake-game.tsx`: mouse drag works like touch swipe on the mode picker; canvas hint now "Swipe / drag to change". Touch handlers untouched (Android unchanged).
- Verified: `tsc --noEmit` 0 errors, `npm run build` success.
