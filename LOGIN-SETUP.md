# Google login + cloud save — setup (Hinglish)

Code ready hai. Sirf ye 4 cheezein tumhe Firebase/Android side par karni hain.

## 1. Google sign-in ON karo (web + app dono ke liye)
Firebase console → project `snake-premium-e` → **Authentication → Sign-in method → Google → Enable** → Save.
Live website par chalane ho to **Authentication → Settings → Authorized domains** me apna domain add karo (`localhost` pehle se hota hai).

## 2. Database rules publish karo (bahut zaroori)
Firebase console → **Realtime Database → Rules** → `firebase-rules.json` ka content paste → **Publish**.
Isse har player sirf apna data padh/likh sakta hai (`users/{uid}`); multiplayer rooms pehle jaise chalenge.

## 3. Android app ke liye (sirf Play Store / APK build par)
Browser me popup se login chal jata hai, lekin Android WebView me native plugin chahiye:

1. Terminal me (project root):
   ```
   npm install
   ```
   (`@capacitor-firebase/authentication` package.json me pehle se hai.)
2. Firebase console → Project settings → **Add app → Android** → package name `com.mani.snakegame`.
3. Apne computer ka **SHA-1** nikalo aur Firebase me add karo:
   - Windows: `keytool -list -v -keystore "%USERPROFILE%\.android\debug.keystore" -alias androiddebugkey -storepass android -keypass android`
   - Mac/Linux: `keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android -keypass android`
   - (Play Store release ke liye Play Console → App integrity wala SHA-1 bhi add karo.)
4. `google-services.json` download karke `android/app/` me rakho.
5. Terminal me:
   ```
   npm run build
   npx cap sync android
   node scripts/fix-android-google.js
   ```
   Ye script check karta hai: `rgcfaIncludeGoogle = true` (bina iske Google login ki native
   libraries APK me nahi aati), `google-services.json` maujood hai, **mic permissions
   (RECORD_AUDIO + MODIFY_AUDIO_SETTINGS) manifest me hain**, aur SHA-1 ka command batata hai.
6. Android Studio me **Build → Clean**, phir **Generate Signed Bundle / APK → APK → debug** → Finish.
7. Phone se purana app **uninstall** karke naya install karo (sign alag hoga to update fail hoga).

Agar login phir bhi na ho to app me jo error message dikhe wo note karo — ab wo seedha wajah
batata hai (plugin missing / SHA-1 mismatch / no Google account).

## 4. Test
`npm run dev` → header me 👤 icon → **Continue with Google**. Sign-in ke baad coins/gems/skins/best score cloud me save hote hain
(Firebase console → Realtime Database → `users/<uid>/game` me dikhega). Doosre phone/browser par same account se login karke wahi progress milega.

## Kaise kaam karta hai
- Har Google account ka apna unique `uid` hota hai → `users/{uid}` me alag profile. Profile me Player ID (uid ke pehle 8 characters) dikhta hai.
- Login se pehle ka **guest progress** account me merge hota hai (kuch delete nahi hota): naya wallet/equipment jeetta hai, owned items jud jate hain, best score max.
- Sign out par pehle cloud me save hota hai, phir is device se data clear hota hai — taaki agla banda alag account se login kare to progress mix na ho.
- Internet na ho to game guest ki tarah chalta hai aur net aane par save ho jata hai.

## Dhyan rakhne wali baat
Coins/gems abhi phone (client) me calculate hote hain, isliye technically koi tech-savvy user apna hi data badal sakta hai.
Account ki security (koi doosre ka data na dekh/badal sake) rules se safe hai. Jab real-money gems chalu karo, tab payment
verification server par (Cloud Functions + Play Billing) karna padega.
