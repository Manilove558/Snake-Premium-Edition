"use client"
import { get, onValue, ref, remove, serverTimestamp, set } from "firebase/database"
import { getFirebaseDb } from "./firebase"

// One device at a time per Google account.
// sessions/{uid} = { id: <device id>, at } — whoever logs in last owns the account.
// Every logged-in device watches that node; if it names a different device, this one fires
// "session-kicked" (SessionGuard then logs it out). Several tabs of the SAME browser/app share one
// device id, so they never kick each other (they also share one Firebase login).
const DEVICE_KEY = "snake-device-id"
let memId = ""
function deviceId(): string {
  const make = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`)
  try {
    let id = localStorage.getItem(DEVICE_KEY)
    if (!id) { id = make(); localStorage.setItem(DEVICE_KEY, id) }
    return id
  } catch {
    return memId || (memId = make())
  }
}

let off: (() => void) | null = null
let claimedUid: string | null = null

export function stopWatchingSession() { off?.(); off = null }

/** Take over the account for this device and start watching for another device taking it over. Never blocks. */
export function claimSession(uid: string) {
  stopWatchingSession()
  claimedUid = uid
  const r = ref(getFirebaseDb(), `sessions/${uid}`)
  const me = deviceId()
  set(r, { id: me, at: serverTimestamp() })
    .then(() => {
      if (claimedUid !== uid) return // logged out meanwhile
      off = onValue(
        r,
        (snap) => {
          const v = snap.val()
          // only an EXISTING session of another device counts (an empty node / failed write never kicks anybody)
          if (v && typeof v.id === "string" && v.id !== me) {
            stopWatchingSession()
            window.dispatchEvent(new CustomEvent("session-kicked"))
          }
        },
        () => {}, // rules not published yet / no permission → feature stays off, game keeps working
      )
    })
    .catch(() => {})
}

/** Normal logout: free the account — but only if the session is still ours (a kicked device must not erase the new owner). */
export async function releaseSession(uid: string) {
  stopWatchingSession()
  claimedUid = null
  try {
    const r = ref(getFirebaseDb(), `sessions/${uid}`)
    const s = await get(r)
    if (s.val()?.id === deviceId()) await remove(r)
  } catch {}
}
