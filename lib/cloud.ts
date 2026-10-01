"use client"
import { useSyncExternalStore } from "react"
import { get, ref, set, update } from "firebase/database"
import { getFirebaseDb } from "./firebase"
import { publishPublicProfile, syncPublicStats } from "./friends"
import { setLocalCustomName } from "./profile-name"
import { claimSession, releaseSession } from "./session"
import { getStoreState, replaceStore, resetStore, subscribeStore, mergeStates, hasProgress, RELEASE_BUILD, type StoreState } from "./store"

// Cloud save: users/{uid}/game holds the progress, users/{uid}/profile the public profile.
// Guest progress lives only in localStorage; after login it is merged into the account, never overwritten.
//
// Anti demo-loot: every save is stamped with { build: "play" | "demo" }. A RELEASE_BUILD
// never trusts a "demo"-stamped (or unstamped) cloud save — it is discarded on first
// launch and replaced with a fresh save, so free items grabbed via a circulated test
// APK can never carry over to the Play Store version on the same account.
type StampedSave = StoreState & { build?: "play" | "demo" }
const stamp = (s: StoreState): StampedSave => ({ ...clean(s), build: RELEASE_BUILD ? "play" : "demo" })
const stripStamp = (s: StampedSave): StoreState => {
  const { build: _b, ...rest } = s
  return rest as StoreState
}

// Cloud save: users/{uid}/game holds the progress, users/{uid}/profile the public profile.
// Guest progress lives only in localStorage; after login it is merged into the account, never overwritten.
export type SyncStatus = "idle" | "syncing" | "saved" | "offline"
let status: SyncStatus = "idle"
let lastSaved = 0
const ls = new Set<() => void>()
const setStatus = (s: SyncStatus) => { status = s; if (s === "saved") lastSaved = Date.now(); ls.forEach((l) => l()) }
export function useSyncStatus() {
  useSyncExternalStore((cb) => { ls.add(cb); return () => { ls.delete(cb) } }, () => status + lastSaved, () => "idle0")
  return { status, lastSaved }
}

const OWNER_KEY = "snake-store-owner"
let timer: ReturnType<typeof setTimeout> | null = null
let stop: (() => void) | null = null
let activeUid: string | null = null
const clean = (s: StoreState) => JSON.parse(JSON.stringify(s))

export async function pushNow(uid = activeUid) {
  if (!uid) return
  if (timer) { clearTimeout(timer); timer = null }
  try { setStatus("syncing"); await set(ref(getFirebaseDb(), `users/${uid}/game`), stamp(getStoreState())); syncPublicStats(uid).catch(() => {}); setStatus("saved") } catch { setStatus("offline") }
}

export async function attachAccount(u: { uid: string; displayName: string | null; photoURL: string | null }) {
  activeUid = u.uid
  claimSession(u.uid) // one device at a time: this device now owns the account, any other device gets logged out
  setStatus("syncing")
  try {
    const db = getFirebaseDb()
    const snap = await get(ref(db, `users/${u.uid}`))
    const rawCloud = snap.val()?.game as StampedSave | undefined
    // Demo-era wipe: a release build discards any cloud save that was NOT written
    // by a release ("play") build — free demo loot never restores on the Play version.
    if (RELEASE_BUILD && rawCloud && rawCloud.build !== "play") {
      console.log("[cloud] discarding demo-era save, starting fresh")
    }
    const cloud = RELEASE_BUILD && rawCloud && rawCloud.build !== "play" ? undefined : rawCloud ? stripStamp(rawCloud) : undefined
    const local = getStoreState()
    const owner = localStorage.getItem(OWNER_KEY)
    let target = local
    if (owner && owner !== u.uid) { resetStore(); target = cloud || getStoreState() } // another account's leftovers: never mix
    else if (cloud) target = hasProgress(local) || owner === u.uid ? mergeStates(local, cloud) : cloud
    replaceStore(target)
    localStorage.setItem(OWNER_KEY, u.uid)
    // A name the player edited in Profile beats the Google name (and survives every sign-in)
    const savedProf = snap.val()?.profile
    const edited = savedProf?.nameEdited && typeof savedProf.name === "string" && savedProf.name.trim() ? (savedProf.name as string) : ""
    setLocalCustomName(edited)
    const finalName = edited || u.displayName || "Player"
    const prof: Record<string, unknown> = { name: finalName, photo: u.photoURL || null, lastLogin: Date.now() }
    if (!snap.exists() || !savedProf?.createdAt) prof.createdAt = Date.now()
    await update(ref(db, `users/${u.uid}/profile`), prof)
    await set(ref(db, `users/${u.uid}/game`), stamp(getStoreState()))
    // Make the account findable by Player ID (friends) — never blocks the save if it fails
    publishPublicProfile({ ...u, displayName: finalName }, (prof.createdAt as number | undefined) ?? savedProf?.createdAt ?? null).catch(() => {})
    setStatus("saved")
  } catch {
    setStatus("offline")
  }
  stop?.()
  const unsub = subscribeStore(() => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => pushNow(u.uid), 1500)
  })
  const onHide = () => { if (document.visibilityState === "hidden") pushNow(u.uid) }
  document.addEventListener("visibilitychange", onHide)
  stop = () => { unsub(); document.removeEventListener("visibilitychange", onHide) }
}

/**
 * Save to the cloud, then clear this device so the next person starts clean.
 * save=false: this device was kicked (account opened elsewhere) — do NOT push, it would overwrite the new device's progress.
 */
export async function detachAccount(save = true) {
  const uid = activeUid
  if (save) { if (uid) { await pushNow(uid); await releaseSession(uid) } }
  else if (timer) { clearTimeout(timer); timer = null }
  stop?.(); stop = null; activeUid = null
  localStorage.removeItem(OWNER_KEY)
  setLocalCustomName("") // the next person on this device must not inherit the name
  resetStore()
  setStatus("idle")
}
