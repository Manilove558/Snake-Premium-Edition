# v15 changes

## 1. Admin panel — naya design
- Naya "Admin Console": gradient header, apna Player ID (copy button), icon wale tabs (Skins / Trails / Avatars / VIP / Mail / Admins).
- Items ab card-grid me hain, search box ke saath. Edit/Naya item ab bottom-sheet me khulta hai.
- Admin access: Player ID **IOXN75FA** hamesha main admin (lib/admin.ts + firebase-rules.json me pehle jaisa).

## 2. Avatar section — image / GIF upload
- Avatars tab → Naya → "Image / GIF" → file chuno (PNG, JPG, WEBP, GIF).
- Image 256x256 me crop hoti hai; GIF max 300KB, loop hata diya jata hai (ek baar chalta hai) aur still frame khud ban jata hai.
- "Sirf VIP Pass walon ke liye" tick karo to VIP avatar ban jata hai.

## 3. VIP avatar (spanish.gif)
- `avatar_vip_spanish` ("VIP Spanish Girl") VIP avatar me add hai. Files: public/avatars/avatar_vip_spanish.gif (256px, ek baar chalne wala) + avatar_vip_spanish_still.png.
- Jab koi player ki profile / ID kholta hai to GIF **ek baar** chalta hai. Baaki jagah (lobby, friends list, store) still frame dikhta hai.

## 4. Mailbox 🔔
- Header me bell icon (login hone par) — red badge me nayi news + unclaimed rewards ki ginti.
- Admin panel → Mail: ek player ko (Player ID se) ya sabhi players ko news/reward bhejo. Reward player ko Mailbox se **Claim** karna padta hai (ek hi baar claim hota hai).
- Sabko bheji news admin panel se delete bhi ho sakti hai.
- Purana seedha "coins bhejo" hata diya (ab sab Mail se, claim ke saath).

## 5. Game fixes
- Shrinking mode (play area shrink over time) hata diya.
- Campaign me canvas ke bahar wala "Level 1 / 100" text hata diya (canvas ke andar wala HUD waisa hi hai).
- Multiplayer Ranked: har match ka map random. Lobby me map picker ki jagah "🎲 Random map" dikhta hai.

## ⚠️ Zaroori: Firebase rules dobara publish karo
`firebase-rules.json` me naye `news` aur `mailbox` nodes add hue hain. Firebase Console → Realtime Database → Rules me is file ka content paste karke Publish karo, warna Mailbox / Mail bhejna kaam nahi karega.

## v15.2 — Admin panel: game UI jaisa + compact (Android)
- Store/Profile jaisi hi styling: same overlay + rounded card, emerald title, pill tabs, glass cards, emerald buttons, same bottom-sheet aur toast.
- Items ab compact rows me (chhota preview + naam + price + Edit/Hide/Reset icons), pehle bade cards the — ek screen par zyada items.
- Inputs/buttons 40px, icon buttons 36px, chhote labels; Mail form 2-line message + coins/gems ek row me.
- Sirf `components/admin-panel.tsx` badla hai (baaki sab v15_1 jaisa, build fix bhi bacha hua).

## v15.3 — VIP Pass bug fix
- Bug: VIP Pass activate hone ke baad bhi store me dobara click karke pass mil jata tha (days add hote jaate the).
- Ab: pass chalu hai to button disabled hai ("Active · 27d left") aur `buy()` bhi block karta hai. Pass khatam hone ke baad hi dobara activate hoga.
- Files: lib/store.ts, components/snake-store.tsx.

## v15.4 — Admin decide karega pricing (per item)
- Admin panel → kisi bhi item (Skin / Trail / Avatar / VIP Pass) ko Edit karo → **Price**: `Free` · `Coins` · `Gems` · `₹ INR` chuno aur amount daalo. Naya item banate waqt bhi yehi.
- Store me turant dikhta hai: Free item par "FREE" button, baaki par unka price. Global "Launch offer" banner hata diya.
- Default: jab tak admin ne kisi built-in item ka price set nahi kiya, wo FREE hai (`FREE_MODE` ab sirf ye default hai). Admin ke "Reset" se item wapas free ho jata hai. Coded prices sirf suggestion hain.
- Avatars par bhi price lag sakta hai (kharidne ke baad hi use hota hai). VIP-only tick alag se kaam karta hai.
- ⚠️ ₹ INR wale items aur Gem packs abhi bhi demo me free milte hain (`TEST_MODE = true`) jab tak Google Play Billing nahi juda. Coins/Gems wali pricing poori tarah kaam karti hai.
- Files: lib/store.ts, components/snake-store.tsx, components/admin-panel.tsx.

## v15.5 — Mail reward: VIP Pass + Skins/Items
- Admin panel → Mail me ab Coins/Gems ke saath **VIP Pass (din)** aur **Skins / Items** bhi bhej sakte ho (ek player ko ya sabhi ko). Items picker me Skins/Trails/Food/Avatars search + select (max 12).
- Player ke Mailbox me reward chips dikhte hain (coins, gems, 👑 VIP Nd, item names). "Claim" dabane par ek hi baar milta hai: coins/gems jud jate hain, VIP din chalte pass me add ho jate hain (naya pass ho to shuru), items unlock ho jate hain (auto-equip nahi hote).
- "Sab rewards claim karo" ab VIP din aur items bhi jodta hai.
- ⚠️ `firebase-rules.json` me `vipDays` aur `items` add hue hain — Firebase Console me Rules dobara Publish karo, warna VIP/items wali mail bhejna fail hoga.
- Files: lib/store.ts, lib/mailbox.ts, components/mailbox.tsx, components/admin-panel.tsx, firebase-rules.json.

## v15.6 — Google Play Billing (asli payment: UPI / Card / Redeem code)
- ₹ wale items aur gem packs ab **Google Play Billing** se kharidte hain (native Android). Payment sheet me **UPI, debit/credit card, netbanking aur redeem code** apne aap aata hai — alag code ki zaroorat nahi. Redeem/promo codes Play Console se bante hain.
- Naya `lib/billing.ts`: SKU mapping (`snake_item_<id>`, `snake_gems_<packId>`), Play price fetch (dukaan me sahi ₹ price Play Console wala dikhta hai), purchase flow, aur `purchases/{uid}/{orderId}` me receipt (admin audit).
- `lib/store.ts`: `grantBlocker()` (payment sheet khulne se PEHLE check — galat item ke liye paise nahi katega), `grantAfterPurchaseItem()`, `grantAfterPurchaseGems()` (sirf confirmed payment ke baad grant).
- Store UI: ₹ item par Play wala price + Buy → sheet → turant unlock; payment cancel par kuch nahi kat-ta. Busy state me button "Payment…" dikhata hai.
- `TEST_MODE = true` rehne tak sab demo hai (paise nahi katega). Asli payment ke liye: Play Console me products banao → `TEST_MODE = false` → `npx cap sync` → naya AAB. Poori guide `PLAY-BILLING-SETUP.md` me hai.
- Web par demo mode hi rahega (Play Billing web par nahi chalta).
- Files: lib/billing.ts (naya), lib/store.ts, components/snake-store.tsx, package.json (plugin), firebase-rules.json (`purchases` node — dobara Publish karo), PLAY-BILLING-SETUP.md (naya).

## v15.6.1 — Billing web build fix
- Bug: `npm run dev` par "Module not found: @adplorg/capacitor-in-app-purchase" aata tha (billing.ts build time par plugin package dhoondta tha).
- Ab plugin sirf **runtime** par Capacitor registry se judta hai (`registerPlugin`) — web build kabhi plugin package import nahi karta, isliye ye error dobara nahi aayega. Native Android par kaam same rahega (plugin `npx cap sync` se judta hai).
- Files: lib/billing.ts.

## v15.6.2 — Firebase rules fix
- Bug (meri galti): v15.6 me `purchases` node galti se `"rules"` ke BAHAR jud gaya tha — Firebase Console me paste karne par "Error saving rules - Expected '}'" aata tha.
- Ab `purchases` sahi jagah `"rules"` ke andar hai. JSON validate kar liya hai.
- Files: firebase-rules.json.

## v15.6.3 — Firebase rules: numChildren fix
- Bug: `news` aur `mailbox` ke `items` validation me `newData.numChildren()` tha — ye method Firebase rules me hota hi nahi (sirf app ke SDK me hai), isliye Publish par "No such method/property 'numChildren'" error aata tha.
- Ab sirf `newData.hasChildren()` hai; har item ki key/value check `$itemId` rule se hoti hai (admin panel waise bhi max 12 items bhejta hai).
- Files: firebase-rules.json.

## v15.6.4 — Demo confirm popup
- Demo mode me ab ₹ item ya gem pack par Buy dabane se seedha grant nahi hota — pehle ek chhota confirm popup aata hai ("Demo khareed hai — paise nahi katega", Confirm/Cancel). Galti se tap se bachne ke liye.
- Sirf demo mode me lagta hai; asli Google Play sheet wale flow (payMode === "play") me koi badlav nahi.
- Files: components/snake-store.tsx.

## v15.7 — Vault + tap-to-play GIF avatars
- Header me naya **Vault** icon (Store ke bagal me) — har player ko dikhta hai. Vault me player ke apne saare items (Skins / Trails / Food / Avatars) hain, wahi se **Equip** kar sakta hai.
- Jo item equipped hai wo Vault me sabse **upar "Equipped"** section me dikhta hai (skin, trail, food, avatar), aur har tab me bhi equipped item pehle aata hai.
- Store (aur Vault) me GIF wala avatar ab **click/tap karne par** ek baar chalta hai (pehle apne aap chalta tha).
- Files: components/snake-vault.tsx (naya), components/player-avatar.tsx (`tapToPlay`), components/snake-store.tsx, components/snake-game.tsx, lib/store.ts (spanish gif `imgMs: 2000`).
- Deploy: `npm run build` → `npx cap sync android` → Android Studio se run.

## v15.7.1 — Vault compact + nested-button fix
- Bug: Vault ke "Equipped" tile (button) ke andar GIF avatar ka button tha → "<button> cannot be a descendant of <button>" hydration error. Ab Equipped tile `div[role=button]` hai, aur wahan avatar sirf still dikhta hai.
- Vault compact: Equipped ek hi row me 4 chhote tiles; items 3-column chhote cards (chhota preview, 11px naam, 28px Equip button); header aur tabs chhote.
- Preview ab component ke bahar hai, isliye toast/state change par GIF reset nahi hota.
