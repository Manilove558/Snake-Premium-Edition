# v22.0 — Ranked fixes (socket mode) + review

Review ke baad mile bugs, jo theek kiye gaye:

1. **Firebase rules `rp` aur `gamesPlayed` reject kar rahe the** → socket mode me ranked save HAMESHA fail hota. `firebase-rules.json` me dono fields allow kiye. ⚠ Console me rules dobara **Publish** karo.
2. **Race (zero-sum toot-ta tha):** game-over par har client opponents ki profile dobara padhta tha; jo client pehle settle ho chuka tha uski naye rating padh li jaati thi. Ab countdown par ratings "freeze" hoti hain (`preMatchRef`) aur settle usi se hota hai.
3. **Leaver ke saath ranked poora skip:** uid `net.players` se dekha jata tha, par chhodne wala player room se hat chuka hota hai. Ab server standings me `uid` bhejta hai (`StandingRow.uid`, protocol v3). Leaver ko last place milta hai.
4. **2 player match:** `calculateMatchRankings` 3 se kam par error deta tha → ab saaf message ("Ranked needs 3+ players").

Test: `npm run test:net` aur `npx tsx scripts/ranked-selftest.ts` dono pass (net-selftest me leaver-uid check jora).

## Abhi bhi baaki (fix nahi kiye, decision chahiye)
- Ranked opt-in **per player** hai → agar sab ne opt-in nahi kiya to zero-sum nahi rehta. Sahi tareeka: room-level "ranked" setting, server enforce kare (sab ya koi nahi).
- Rating abhi bhi client likhta hai; modified client apna rp badal sakta hai. Asli fix: result server settle kare (server ke paas verified uid + authoritative standings + firebase-admin pehle se hai).
- Firebase-mode battle (`multiplayer-battle.tsx`) abhi purana `computeEloChanges` use karta hai.
- Server `initAuth()` async hai: bahut jaldi aane wale connections unverified ho sakte hain; kharab token chup-chaap guest ban jata hai.
- Classic renderer portals nahi dikhata.
