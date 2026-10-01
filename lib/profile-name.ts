"use client"
import { useSyncExternalStore } from "react"
import { ref, update } from "firebase/database"
import { updateProfile } from "firebase/auth"
import { getFirebaseAuth, getFirebaseDb } from "./firebase"

// The name a player picked in Profile. Priority everywhere (multiplayer, friends, public profile):
//   custom name (edited in Profile)  >  Google display name  >  "Player"
// Cloud copy: users/{uid}/profile/{name, nameEdited} and publicProfiles/{uid}/name.
export const NAME_MIN = 2
export const NAME_MAX = 16
const KEY = "snake-player-name"

let custom = ""
let loaded = false
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

function load() {
  if (loaded || typeof window === "undefined") return
  loaded = true
  try { custom = window.localStorage.getItem(KEY) || "" } catch {}
}

/** Remember the edited name on this device (empty string = no custom name). */
export function setLocalCustomName(n: string) {
  load()
  custom = n
  try { n ? window.localStorage.setItem(KEY, n) : window.localStorage.removeItem(KEY) } catch {}
  emit()
}
export function getCustomName(): string { load(); return custom }

function subscribe(cb: () => void) { load(); listeners.add(cb); return () => { listeners.delete(cb) } }

/** The name to show for a signed-in user (custom > Google name > "Player"). Re-renders when it changes. */
export function useDisplayName(user: { displayName: string | null } | null | undefined): string {
  const c = useSyncExternalStore(subscribe, () => { load(); return custom }, () => "")
  return c || user?.displayName || "Player"
}

export const cleanName = (raw: string) => raw.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim().slice(0, NAME_MAX)

export function validateName(raw: string): { ok: true; name: string } | { ok: false; error: string } {
  const name = cleanName(raw)
  if (name.length < NAME_MIN) return { ok: false, error: `Name must be at least ${NAME_MIN} characters` }
  if (!/[\p{L}\p{N}]/u.test(name)) return { ok: false, error: "Name needs at least one letter or number" }
  return { ok: true, name }
}

/** Save a new name for the signed-in account. Works offline for the local copy; cloud errors are reported. */
export async function saveProfileName(uid: string, raw: string): Promise<{ ok: boolean; error?: string; note?: string; name?: string }> {
  const v = validateName(raw)
  if (!v.ok) return v
  const name = v.name
  setLocalCustomName(name)
  try {
    const db = getFirebaseDb()
    const write = update(ref(db), {
      [`users/${uid}/profile/name`]: name,
      [`users/${uid}/profile/nameEdited`]: true,
      [`publicProfiles/${uid}/name`]: name,
    })
    // Offline, Firebase queues the write and only resolves once it reaches the server — don't leave the UI waiting
    const synced = await Promise.race([write.then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), 6000))])
    if (!synced) { write.catch(() => {}); return { ok: true, name, note: "Saved — will sync when you're back online" } }
    // Keep Firebase Auth in sync too (best effort — the cloud profile above is the source of truth)
    const cu = getFirebaseAuth().currentUser
    if (cu && cu.uid === uid) updateProfile(cu, { displayName: name }).catch(() => {})
    return { ok: true, name }
  } catch {
    return { ok: false, name, error: "Saved on this device, but couldn't reach the server. Check your internet and try again." }
  }
}
