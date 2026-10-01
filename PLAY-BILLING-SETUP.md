# Google Play Billing Setup — UPI / Card / Redeem Code se INR purchase

Is game me ab asli payment jud gaya hai. Player jab koi ₹ wala item ya gem pack kharidega,
to **Google Play ka payment sheet** khulega — usme **UPI, debit/credit card, netbanking**
aur **redeem code** ka option apne aap aata hai. Alag se kuch banane ki zaroorat nahi.

> **Zaroori baat (pehle padho):** Play Store ke niyam ke hisaab se Android app ke andar
> digital cheezon (skin, VIP pass, gems) ke liye **sirf Google Play Billing** use ho sakta hai.
> App ke andar Razorpay/UPI-direct lagana niyam ke khilaaf hai — aisa kiya to Google app
> hata sakta hai. Isliye yehi sahi tareeka hai.
>
> Google har sale par **15% commission** kaat-ta hai (saal ke pehle $1M tak, uske baad 30%).

## Abhi kya hoga (bina setup ke)

- `TEST_MODE = true` hai (`lib/store.ts`), isliye sab kuch **demo** me chalega —
  paise nahi katega, item free me mil jayega. Aap aaram se UI test kar sakte ho.
- Asli payment ke liye neeche ke steps karne padenge, phir `TEST_MODE = false` karna hai.

## Step 1 — Play Console me products banao

Har ₹ wale item ke liye Play Console me **ek one-time product** banana hai.
Product ka **Product ID bilkul exact** hona chahiye (ek akshar bhi alag hua to game use nahi pehchanega):

1. [Play Console](https://play.google.com/console) kholo → apni Snake game app chuno.
2. Left menu → **Monetize** → **Products** → **In-app products**.
3. **Create product** dabao. Har product ke liye:
   - **Product ID** — neeche wali list se copy karo (exact).
   - **Name** — jo marzi (player ko dikhega), jaise "VIP Pass 30 Days".
   - **Description** — chhota sa, jaise "30 din ka VIP Pass".
   - **Price** — INR me daalo (neeche suggested price hai, aap apna bhi rakh sakte ho —
     lekin dhyan rahe, game me jo price dikhega wo **Play Console wala** hi hoga).
   - **Status: Active** karo.
4. **Save** karo. Har product ke liye dohrayein.

### Product ID list (exact copy karo)

**Store items** (admin panel me jo item ₹ me bechoge, uska ID is formula se banega:
`snake_item_` + item ka id — custom item ka id admin panel me item ke naam ke neeche dikhta hai):

| Product ID | Cheez | Suggested ₹ |
|---|---|---|
| `snake_item_vip_pass` | VIP Pass (30 days) | ₹149 |
| `snake_item_skin_solar` | Solar Flare Skin | ₹49 |

**Gem packs** (ye 5 fixed hain):

| Product ID | Cheez | Suggested ₹ |
|---|---|---|
| `snake_gems_gp1` | 100 gems | ₹19 |
| `snake_gems_gp2` | 550 gems (Popular) | ₹99 |
| `snake_gems_gp3` | 1200 gems | ₹199 |
| `snake_gems_gp4` | 3000 gems (Best value) | ₹449 |
| `snake_gems_gp5` | 7000 gems | ₹999 |

> Note: agar admin panel se kisi **naye item** ko ₹ price doge (jaise koi custom skin),
> to uske liye bhi Play Console me `snake_item_<us item ka id>` product banana padega,
> warna player ko "Payment nahi hua" milega. Bina product wala ₹ item demo me free milta rahega.

## Step 2 — Redeem codes (Google Play promo codes)

Iske liye **app me kuch nahi karna** — codes Play Console se bante hain:

1. Play Console → **Monetize** → **Promo codes** → **Create promo code**.
2. Product chuno (jaise `snake_item_vip_pass`), code ki ginti aur naam daalo.
3. Player code ko **Play Store app** me redeem karega, ya payment sheet me
   "Redeem code" option se — item turant unlock ho jayega.

## Step 3 — TEST_MODE band karo (asli payment chalu)

Jab saare products **Active** ho jayein:

1. `lib/store.ts` kholo.
2. `export const TEST_MODE = true` ko `export const TEST_MODE = false` karo.
3. Dobara build karo.

> **Pehele test karo, phir live karo:** Play Console → **Setup** → **License testing** me
> apne Gmail IDs add karo → app ko **Closed testing** track par daalo. License tester se
> kharidne par paise nahi katega ("Test purchase"). Sab theek lage tabhi production me bhejo.

## Step 4 — Android Studio me plugin jodo

Payment wala native code app me aana chahiye:

1. Apne Capacitor Android project folder me terminal kholo:
   ```
   npm install @adplorg/capacitor-in-app-purchase
   npx cap sync android
   ```
   (Note: ye package sirf Android project me chahiye taaki `cap sync` native code jod sake.
   Web wale folder me `npm run dev` / `npm run build` iske bina bhi chalega.)
2. Android Studio me project dobara kholo/sync karo.
3. **Naya AAB build** karo aur Play Console par upload karo (purana AAB kaam nahi karega —
   usme billing code nahi hai).

## Step 5 — Firebase rules dobara publish karo

Is ZIP ke `firebase-rules.json` me naya `purchases` node hai (kharid ki receipt admin ke liye):

1. Firebase Console → **snake-premium-e** → **Realtime Database** → **Rules**.
2. Is ZIP ka `firebase-rules.json` poora copy-paste karo → **Publish**.

## Kaise kaam karega (player ke liye)

1. Store me ₹ wale item par **sahi ₹ price** (Play Console wala) dikhega → **Buy** dabao.
2. Google Play ka sheet khulega → **UPI / Card / Netbanking / Redeem code** chuno → pay karo.
3. Payment safal hote hi item **turant unlock** ho jayega (skin/equip, VIP activate, gems add).
4. Payment cancel kiya to kuch nahi katega, koi item nahi milega.
5. Har safal kharid ki receipt `purchases/{player}/{orderId}` me save hoti hai (admin dekh sakta hai).

## Web version par kya hoga

Web par Play Billing nahi chalta, isliye wahan **demo mode** hi rahega (paise nahi katega).
Agar web par bhi asli payment chahiye to Razorpay jodna padega — wo alag kaam hai, jab
kaho to kar dunga.

## Mushkil aaye to

- **"Payment nahi hua"** → Play Console me Product ID exact hai ya nahi check karo, aur
  product **Active** hai ya nahi.
- **Price purana dikh raha** → Play ko price update me kuch ghante lag sakte hain; app
  band karke kholo.
- **"Play Billing nahi mila"** → `npx cap sync` dobara chalao aur naya AAB banao.
