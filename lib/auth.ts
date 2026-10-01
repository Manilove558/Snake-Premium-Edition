"use client"
import { useEffect, useState } from "react"
import { GoogleAuthProvider, signInWithPopup, signInWithCredential, signOut as fbSignOut, onAuthStateChanged, type User } from "firebase/auth"
import { Capacitor, registerPlugin } from "@capacitor/core"
import { getFirebaseAuth } from "./firebase"

// Native Google sign-in (Android app). Plugin: @capacitor-firebase/authentication (see LOGIN-SETUP.md).
const NativeAuth = registerPlugin<any>("FirebaseAuthentication")

export function useAuthUser() {
  const [user, setUser] = useState<User | null>(null)
  const [ready, setReady] = useState(false)
  useEffect(() => {
    let off = () => {}
    try { off = onAuthStateChanged(getFirebaseAuth(), (u) => { setUser(u); setReady(true) }) } catch { setReady(true) }
    return () => off()
  }, [])
  return { user, ready }
}

export async function signInWithGoogle(): Promise<{ ok: boolean; error?: string }> {
  try {
    const auth = getFirebaseAuth()
    if (Capacitor.isNativePlatform()) {
      const res = await NativeAuth.signInWithGoogle({ skipNativeAuth: true })
      const idToken = res?.credential?.idToken
      if (!idToken) return { ok: false, error: "Google did not return a token" }
      await signInWithCredential(auth, GoogleAuthProvider.credential(idToken))
    } else {
      await signInWithPopup(auth, new GoogleAuthProvider())
    }
    return { ok: true }
  } catch (e: any) {
    const raw: string = String(e?.code || e?.message || "")
    const code = raw.toLowerCase()
    // User ne khud cancel kiya
    if (code.includes("popup-closed") || code.includes("12501") || code.includes("cancel")) return { ok: false }
    // Internet nahi
    if (code.includes("network")) return { ok: false, error: "No internet connection" }
    // Popup block (web)
    if (code.includes("popup-blocked")) return { ok: false, error: "Popup was blocked — allow popups and try again" }
    // Native plugin APK me hai hi nahi (purana build)
    if (code.includes("unimplemented") || code.includes("not implemented") || code.includes("does not have") || code.includes("no such method")) {
      return { ok: false, error: "Google login is purane build me nahi hai — naya APK banao (LOGIN-SETUP.md dekho)" }
    }
    // SHA-1 mismatch: Firebase me is build ka SHA-1 registered nahi
    if (code.includes("developer_error") || code.includes("error 10") || code.includes("status{statuscode=developer_error")) {
      return { ok: false, error: "SHA-1 mismatch — Firebase console me is build ka SHA-1 add karo" }
    }
    // Phone me Google account / Play Services dikkat
    if (code.includes("12500") || code.includes("sign_in_failed") || code.includes("play services")) {
      return { ok: false, error: "Phone me Google account ya Play Services check karo" }
    }
    return { ok: false, error: "Sign-in failed. Please try again" }
  }
}

export async function signOutUser() {
  try { if (Capacitor.isNativePlatform()) await NativeAuth.signOut() } catch {}
  await fbSignOut(getFirebaseAuth())
}
