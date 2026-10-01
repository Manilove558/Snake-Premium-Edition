// Google sign-in (Android) ke liye zaroori settings check/fix karta hai.
// Chalao: node scripts/fix-android-google.js   (project root se)
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const varsFile = path.join(root, "android", "variables.gradle");
const gsFile = path.join(root, "android", "app", "google-services.json");
const manifestFile = path.join(root, "android", "app", "src", "main", "AndroidManifest.xml");

let ok = true;

// 1. rgcfaIncludeGoogle = true hona chahiye (bina iske Google login ki native libraries APK me nahi aati)
const vars = fs.readFileSync(varsFile, "utf8");
if (!/rgcfaIncludeGoogle\s*=\s*true/.test(vars)) {
  const patched = vars.replace(/(\n})/, "\n    // Google sign-in (native) ke liye zaroori\n    rgcfaIncludeGoogle = true$1");
  fs.writeFileSync(varsFile, patched);
  console.log("[fix] android/variables.gradle me rgcfaIncludeGoogle = true jod diya.");
} else {
  console.log("[ok] rgcfaIncludeGoogle = true pehle se hai.");
}

// 2. google-services.json check
if (!fs.existsSync(gsFile)) {
  ok = false;
  console.log("[MISSING] android/app/google-services.json nahi mila!");
  console.log("  Firebase console -> Project settings -> Android app -> google-services.json download karke android/app/ me rakho.");
} else {
  try {
    const gs = JSON.parse(fs.readFileSync(gsFile, "utf8"));
    const pkg = gs.client?.[0]?.client_info?.android_client_info?.package_name;
    console.log(`[ok] google-services.json mila (package: ${pkg || "?"}, project: ${gs.project_info?.project_id || "?"})`);
    if (pkg && pkg !== "com.mani.snakegame") {
      ok = false;
      console.log(`[WARN] package name ${pkg} hai, com.mani.snakegame hona chahiye!`);
    }
  } catch {
    ok = false;
    console.log("[WARN] google-services.json padha nahi gaya — file corrupt ho sakti hai.");
  }
}

// 3. Mic permissions (voice chat) — AndroidManifest.xml me honi chahiye
if (fs.existsSync(manifestFile)) {
  let mf = fs.readFileSync(manifestFile, "utf8");
  let changed = false;
  for (const perm of ["android.permission.RECORD_AUDIO", "android.permission.MODIFY_AUDIO_SETTINGS"]) {
    if (!mf.includes(perm)) {
      mf = mf.replace("</manifest>", `    <uses-permission android:name="${perm}" />\n</manifest>`);
      changed = true;
    }
  }
  if (changed) {
    fs.writeFileSync(manifestFile, mf);
    console.log("[fix] AndroidManifest.xml me mic permissions (RECORD_AUDIO + MODIFY_AUDIO_SETTINGS) jod di.");
  } else {
    console.log("[ok] Mic permissions pehle se manifest me hain.");
  }
} else {
  console.log("[skip] AndroidManifest.xml nahi mila (pehle `npx cap add android` chalao).");
}

// 4. SHA-1 yaad dilao
console.log("\n--- SHA-1 (Firebase me registered hona chahiye) ---");
console.log("Apne computer par ye command chalakar SHA-1 nikalo:");
console.log('  Windows: keytool -list -v -keystore "%USERPROFILE%\\.android\\debug.keystore" -alias androiddebugkey -storepass android -keypass android');
console.log("  Mac/Linux: keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android -keypass android");
console.log("Phir Firebase console -> Project settings -> Android app me SHA-1 add karo.");

if (ok) {
  console.log("\nSab settings sahi hain. Ab Android Studio me Clean + Rebuild karo.");
} else {
  console.log("\nUpar wali cheezein theek karo, phir dobara ye script chalao.");
  process.exitCode = 1;
}
