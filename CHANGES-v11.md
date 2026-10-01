# v11 changes

## 1. Profile name edit
- Profile (👤) → name ke saath ✏️ icon → naya naam likho → ✔ (2–16 characters).
- Naam cloud me `users/{uid}/profile/name` (+ `nameEdited: true`) aur `publicProfiles/{uid}/name` me save hota hai.
- Dobara Google login karne par bhi edited naam Google ke naam se overwrite nahi hota.
- Sign out par naam is device se clear hota hai (agla banda mix na ho).
- Firebase rules me koi change nahi chahiye.

## 2. Multiplayer "YOUR NAME"
- Login hai → profile wala naam automatically dikhta hai (read-only, "change it in Profile" hint).
- Guest hai → pehle jaisa naam type karna padta hai.
- Friends request bhi ab profile wala naam bhejti hai.

## 3. Store
- Skins 9 → 34, Trails 4 → 17, Food 3 → 12 (kuch VIP-only).
- Trails/food ke naye shapes: dot, square, diamond, star, heart, ring (`lib/shapes.ts`).
- Store me Skins tab ab "Snake skins" aur "Food" sections me bata hai.

## 4. VIP Pass perks
- 2x coins (pehle se), +50% gems (high-score reward), daily reward 500 coins + 25 gems.
- VIP-only: 6 skins, 3 trails, 2 food. VIP khatam hone par equipped VIP item apne aap default ho jata hai.
- 👑 crown naam ke saath: multiplayer lobby/battle aur profile me.
- `skin_vip` (VIP Gold) ab VIP-only hai.

## Note
`FREE_MODE = true` (lib/store.ts) hone se abhi sab kuch free hai — prices data me set hain; `false` karte hi chalu.
