# v20.0 — Ranked system rewrite (`lib/ranked.ts`)

- Dual-track rating: hidden **MMR** (sirf matchmaking + expected placement) aur visible **RP** (tiers, shield, decay). Dono 1000 se start.
- `calculateMatchRankings(players)` — 3–8 players ka pairwise Elo: `E_i = 1 + Σ P(j beats i)`. Performance = Placement 50% + Kills 30% + Peak Mass 20% (teeno lobby ke andar percentile, tie-aware).
- **Zero-sum**: har match me `Σ rpDelta = 0` aur `Σ mmrDelta = 0` (integers, exactly). Shield / 0-RP floor ka kharcha usi match ke winners dete hain — RP kahin se print nahi hota.
- K-factor: RP → 40 (pehle 5 games), 20 (standard), 10 (Master+). MMR → 40 / 20.
- Tiers: Bronze 0–999 · Silver 1000–1499 · Gold 1500–1999 · Platinum 2000–2499 · Diamond 2500–2999 · Master 3000+. `calculateTier(rp)` progress/next-tier info bhi deta hai.
- Demotion Shield: promotion ke baad 3 protected games (`protectionGamesLeft`, `shieldTier`).
- `applyDemotionDecay(user, now?)` — idempotent. Master 3 din grace, −50/day, floor 3000 · Diamond 7, −25, 2500 · Platinum 14, −10, 2000. MMR par asar nahi.
- Anti-cheat: impossible kills (Σ > N−1) → kills factor ignore + flag `kills_inconsistent`; NaN/negative input repair + `input_sanitized`; duplicate uid par error; zero-sum invariant tootne par error.
- Helpers: `createRankProfile`, `toRankedPlayer`, `applyMatchResult`, `isApexLegend` (top-10 Master leaderboard title).
- Purana API (`computeEloChanges`, `lastPlaceElo`, `computeStandings`, eligibility, rank-pass) **same rakha** — abhi `multiplayer-battle.tsx` wahi use karta hai. Elo ka 3000 cap hata diya (Master open-ended).
- Test: `npx tsx scripts/ranked-selftest.ts` (20,000 random lobbies, zero-sum, shield, decay).
- ⚠ Tier boundaries badle (Gold pehle 1200 tha, ab 1500) — existing players ke tiers shift honge.
- ⚠ Abhi UI / `ranked-db.ts` me wire nahi hua; DB me `mmr`, `protectionGamesLeft`, `lastActiveAt` fields add karni baaki hain.
- ⚠ Cheat-resistance tabhi pura hai jab result server (Cloud Function) par calculate ho — client apna record khud likh sakta hai.
- **firebase-rules.json**: `ranked/$uid/elo` ki upper limit 3000 → 99999 (Master 3000+ ke liye). Naye optional fields allow: `mmr`, `protectionGamesLeft` (0–3), `shieldTier`, `lastActiveAt`, `lastDecayAt`. Purane records bina inke valid. ⚠ Rules Firebase Console me **Publish** karna zaroori hai.
