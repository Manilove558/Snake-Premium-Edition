# v19.0.1 — Audit fixes (static audit ke 10 priority fixes)

- Fix 1: `android/app/src/main/res/values/colors.xml` add (colorPrimary/PrimaryDark/Accent) — styles.xml ke references ab resolve hote hain, Android build blocker khatam.
- Fix 2: single-player countdown freeze — game-loop effect cleanup se `clearInterval(countdownRef)` hataya (initGame ke setCountdown(3) par effect re-run countdown ko turant maar deta tha); `sound-manager.tsx` ke 4 sound callbacks `useCallback` me wrap.
- Fix 3: admin gift infinite loop — rules me recipient ko delete-only write (`auth.uid === $uid && !newData.exists()`, `.validate` delete-aware); client pehle `consumeGrant` (delete) karta hai, delete commit hone par hi `applyGrant` (credit).
- Fix 4: BR ghost players — spawn ke saath `onDisconnect` arm: disconnect par `players/{id}` → `alive:false, diedAt:serverTimestamp()`, snake node remove.
- Fix 5: winner race — match end par `runTransaction` (first-writer-wins) on `rooms/{code}/game`; multiple clients alag winner declare nahi kar sakte.
- Fix 6: invite TTL 5s hi rakha (aapke decision ke hisaab se); lobby text "5 min" → "5 seconds" taaki UI backend se match kare.
- Fix 7: store double-tap — `buyReal` / `buyGemPackFlow` me `busyRef` synchronous guard; do rapid taps par doosra Play sheet nahi khulta.
- Fix 8: AndroidManifest me `VIBRATE` permission add (haptics ke liye).
- Fix 9: self-collision — tail cell jo is tick me vacate hoti hai use exclude (snake-game: `ateFood ? prevSnake : prevSnake.slice(0, -1)`; royale/classic battle: `growthRef.current > 0` check).
- Fix 10: per-tick `playWalkSound()` + `triggerHaptic(10)` hataya — sound/haptic ab sirf food eat aur game over par.
- Verify: `tsc --noEmit` 0 errors, production build pass, firebase-rules.json/colors.xml/AndroidManifest.xml valid.
- NOTE: runtime test (phone, 2-device Firebase) abhi bhi pending — aapko karna hai.

# v19.0 — Snake Battle Royale (4–8 players)

- Naya mode: Room Settings me MODE picker (Classic Battle / Snake Battle Royale). Royale me map options ki jagah info card + grid toggle. Ranked rooms hamesha classic.
- Royale: 120×120 world, camera viewport (360×360 canvas, 60fps interpolation), top-right minimap (player dots + zone boundary + danger zone).
- Shrinking zone: har 30s me shrink, 5s warning, 8s me close; zone ke bahar 3s grace, phir death (tail bhi jalti hai — `ZONE_TAIL_DAMAGE` se band ho sakti hai).
- 4–8 players ring spawn, ~70 food (host har second top-up), transactional food claim, dead snake ka body food banta hai.
- HUD: "Alive: n / 8" + match timer; spectator mode (killer/survivor follow, tap se cycle); victory screen (place, kills, survival time).
- Host migration: host ke jaane par duties naye host par.
- Server-time zone clock (`.info/serverTimeOffset`); Firebase rules me koi change nahi (rooms/{code} pehle se open).
- Files: lib/br/* (7 new), hooks/use-royale-zone.ts, hooks/use-battle-steering.ts, components/royale-battle.tsx, royale-hud.tsx, royale-victory.tsx, battle-router.tsx (13 new); lib/multiplayer.ts, components/multiplayer-lobby.tsx, components/snake-game.tsx (3 modified).
- NOTE: browser/Firebase runtime test nahi hua — 4 tabs/devices par test karna hai.
