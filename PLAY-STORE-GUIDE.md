# Snake Premium — Play Store Guide (Hinglish)

Tumhara game ab **offline Android app** banne ke liye taiyaar hai. Niche har step
click-by-click hai. Jo kaam main kar chuka hoon woh Part 1 me hai — tumhe sirf
Part 2 aur 3 manually karne hain.

## Part 1 — Maine kya ready kar diya (tumhe kuch nahi karna)

- Game ka **static offline build** (`out/` folder) — game me koi internet call
  nahi hai, font/sound sab app ke andar pack hain. Bina internet ke chalega.
- **Capacitor** setup — yahi web build ko native Android app banata hai.
- `android/` folder — poora Android project (Android Studio me khulne layak).
- App icon har size me laga diya (`mipmap-*` folders).
- Package name: `com.mani.snakegame` — **yeh permanent hai**. Play Store par
  ek baar publish hone ke baad kabhi nahi badal sakta.
- Version: `versionCode 1`, `versionName "2.1.5"`,
- Play Store listing assets `play-store-assets/` me:
  - `icon-512.png` — Play Store icon (512x512)
  - `feature-graphic-1024x500.png` — banner (1024x500)

## Part 2 — AAB file banana (Android Studio, tumhare computer par)

**Consequence pehle:** AAB (Android App Bundle) woh file hai jo Play Store par
upload hoti hai. Bina iske publish nahi hoga.

1. **Android Studio** install karo: https://developer.android.com/studio
   (pehli baar khulne par SDK download hoga — internet + 10-15 min lagega).
2. Android Studio me **Open** → ZIP se nikla `Snake-Game-main/android` folder
   select karo → OK. Pehli Gradle sync me 5-10 min lag sakta hai, ruk jao.
3. Menu: **Build → Generate Signed Bundle / APK…**
4. **Android App Bundle** select → Next.
5. **Key store path → Create new…**
   - Koi safe jagah chuno (Documents ke andar ek folder), password do aur
     **password + file location likh ke rakho (diary me ya password manager me)**.
   - ⚠️ **Agar yeh keystore file kho gayi to is app ka update tum KABHI nahi
     de paoge** — Play Store purani key ke bina update accept nahi karta.
     Backup zaroor rakho (pen drive / Drive par).
   - Key alias: `snake`, baaki fields apne hisaab se bharo → OK.
6. **release** variant select → **Create**.
7. Build khatam hone par file milegi:
   `Snake-Game-main/android/app/build/outputs/bundle/release/app-release.aab`
   — yahi Play Store par upload hogi.

> Baad me game update karna ho to: code badlo → `npm run build` →
> `npx cap sync android` → Android Studio me wapas signed AAB banao, lekin
> `android/app/build.gradle` me `versionCode` 1 se 2 (phir 3…) **badhana mat
> bhoolna** — bina badhe Play Store naya version accept nahi karega.

## Part 3 — Play Console par publish (tumhare Google account se)

**Consequence pehle:** Play Console ka developer account **$25 one-time fee**
leta hai (lagbhag ₹2,100). Bina pay kiye app publish nahi hogi.

1. https://play.google.com/console par jao → account banao, $25 pay karo.
   (Identity verification me 1-2 din lag sakte hain.)
2. **Create app** → naam: `Snake Premium` → language: English →
   App or game: **Game** → Free → declarations tick karo → Create.
3. **Dashboard** par saare task poore karo (sab mandatory hain):
   - **App access** → "All functionality available without special access".
   - **Ads** → "No, my app does not contain ads".
   - **Content rating** → questionnaire bharo (violence nahi, gambling nahi…)
     → rating milegi **Everyone**.
   - **Target audience** → 13+ ya jo sahi lage (bachon wala section mat chuno
     warna extra forms bharne padenge).
   - **Data safety** → koi data collect nahi hota: location, contacts, files —
     sab "No". (Game localStorage me sirf high score rakhta hai, woh bhi phone
     ke andar hi rehta hai.)
4. **Store listing** (Main store listing):
   - App icon: `play-store-assets/icon-512.png`
   - Feature graphic: `play-store-assets/feature-graphic-1024x500.png`
   - Screenshots: kam se kam **2 phone screenshots** — game apne phone par
     kholo aur kheench lo (gameplay + mode preview wala).
   - Short description (80 chars): `Classic Snake, reimagined — 14 modes, swipe controls, offline play.`
   - Full description: neeche diya hai, copy-paste kar lena.
5. **Testing → Internal testing** → naya release → `app-release.aab` upload
   karo → khud install karke test karo.
6. Sab sahi lage to **Production → Create new release** → wahi AAB →
   **Rollout**. Review me 1-7 din lagte hain.

### Full description (copy-paste)

```
Snake Premium — the classic Snake game, rebuilt for modern phones.

• 14 game modes: Classic, Speed, Walls, Maze, Timed, Box, Tunnel, Mill,
  Apartment, Campaign, Zigzag, Portal, Reverse and Shrinking
• Swipe or button controls — your choice
• Haptic feedback and sound effects (mutable)
• Random snake start position every game
• Campaign mode with 10 handcrafted levels
• High scores saved on your device
• 100% offline — no internet needed, no ads, no data collected

How to play: guide the snake to eat food and grow. Don't hit walls or
yourself! Swipe anywhere to change game modes.
```

## Zaruri notes

- **Internet permission nahi maangi gayi** — app offline chalti hai, Play Store
  ka Data safety form bharna aasaan rahega.
- Game ka web version ab `npm start` se nahi chalega (static export mode hai).
  Web par dekhna ho to: `npx serve out` → browser me localhost kholo.
- Yeh ZIP me `out/` (bana hua game) bhi included hai, taaki seedha Android
  Studio kholo aur AAB banao.
