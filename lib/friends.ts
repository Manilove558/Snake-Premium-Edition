"use client"

import { useEffect, useState } from "react"
import { get, onValue, ref, set, update } from "firebase/database"
import { getFirebaseDb } from "./firebase"
import { useAuthUser } from "./auth"
import { getStoreState, isVip } from "./store"

// ---------------------------------------------------------------------------
// Friends. Realtime Database layout (see firebase-rules.json):
//   playerIds/{PID}                   = uid        (PID = first 8 chars of uid, upper-case; searchable)
//   publicProfiles/{uid}              = { name, photo, pid, best, owned, vip, createdAt }
//   friends/{uid}/{friendUid}         = { since }  (both directions are written on accept)
//   friendRequests/{toUid}/{fromUid}  = { name, photo, pid, at }   (inbox → notification badge)
//   friendRequestsSent/{fromUid}/{toUid} = at      (so the sender sees "Request sent")
// users/{uid} stays private; only publicProfiles is visible to other players.
// ---------------------------------------------------------------------------

export const playerCodeOf = (uid: string) => uid.slice(0, 8).toUpperCase()
export const normalizePlayerCode = (raw: string) => raw.toUpperCase().replace(/[^A-Z0-9]/g, "")

export interface PublicProfile {
  uid: string
  name: string
  photo: string | null
  pid: string
  best: number
  owned: number
  vip: boolean
  /** equipped store avatar id ("avatar_photo" = show the Google photo) */
  avatar: string
  createdAt: number | null
}

export interface FriendRequest {
  name: string
  photo: string | null
  pid: string
  at: number
}

export interface FriendMe {
  uid: string
  name: string
  photo: string | null
}

const db = () => getFirebaseDb()

// ------------------------------ public profile -----------------------------

function currentStats() {
  const s = getStoreState()
  return { best: s.best, owned: Math.max(0, s.owned.length - 3), vip: isVip(s), avatar: s.equipped?.avatar || "avatar_photo" }
}

/** Make this account findable by Player ID and visible to other players. */
export async function publishPublicProfile(
  u: { uid: string; displayName: string | null; photoURL: string | null },
  createdAt: number | null,
): Promise<void> {
  const pid = playerCodeOf(u.uid)
  const data: Record<string, unknown> = {
    name: u.displayName || "Player",
    photo: u.photoURL || null,
    pid,
    ...currentStats(),
  }
  if (createdAt) data.createdAt = createdAt
  await set(ref(db(), `playerIds/${pid}`), u.uid).catch(() => {})
  await update(ref(db(), `publicProfiles/${u.uid}`), data)
  lastStats = JSON.stringify(currentStats())
}

let lastStats = ""
/** Keep best score / items in the public profile fresh (called after each cloud save). */
export async function syncPublicStats(uid: string): Promise<void> {
  const stats = currentStats()
  const json = JSON.stringify(stats)
  if (json === lastStats) return
  await update(ref(db(), `publicProfiles/${uid}`), stats)
  lastStats = json
}

const cache = new Map<string, { at: number; profile: PublicProfile | null }>()

export async function fetchPublicProfile(uid: string, force = false): Promise<PublicProfile | null> {
  const hit = cache.get(uid)
  if (!force && hit && Date.now() - hit.at < 30_000) return hit.profile
  const snap = await get(ref(db(), `publicProfiles/${uid}`))
  const v = snap.val()
  const profile: PublicProfile | null = v
    ? {
        uid,
        name: v.name || "Player",
        photo: v.photo || null,
        pid: v.pid || playerCodeOf(uid),
        best: Number(v.best) || 0,
        owned: Number(v.owned) || 0,
        vip: !!v.vip,
        avatar: typeof v.avatar === "string" ? v.avatar : "avatar_photo",
        createdAt: v.createdAt ?? null,
      }
    : null
  cache.set(uid, { at: Date.now(), profile })
  return profile
}

/** Look a player up by their 8-character Player ID. */
export async function findPlayerByCode(raw: string): Promise<PublicProfile | null> {
  const pid = normalizePlayerCode(raw)
  if (pid.length !== 8) return null
  const snap = await get(ref(db(), `playerIds/${pid}`))
  const uid = snap.val()
  if (typeof uid !== "string") return null
  return fetchPublicProfile(uid, true)
}

// -------------------------------- requests ---------------------------------

export async function acceptFriendRequest(myUid: string, fromUid: string): Promise<void> {
  const since = Date.now()
  await update(ref(db()), {
    [`friends/${myUid}/${fromUid}`]: { since },
    [`friends/${fromUid}/${myUid}`]: { since },
    [`friendRequests/${myUid}/${fromUid}`]: null,
    [`friendRequestsSent/${fromUid}/${myUid}`]: null,
  })
}

export async function declineFriendRequest(myUid: string, fromUid: string): Promise<void> {
  await update(ref(db()), {
    [`friendRequests/${myUid}/${fromUid}`]: null,
    [`friendRequestsSent/${fromUid}/${myUid}`]: null,
  })
}

/** Send a request. If they already asked me, this simply accepts. */
export async function sendFriendRequest(me: FriendMe, toUid: string): Promise<"sent" | "accepted" | "already"> {
  if (!toUid || toUid === me.uid) return "already"
  const [already, theirs] = await Promise.all([
    get(ref(db(), `friends/${me.uid}/${toUid}`)),
    get(ref(db(), `friendRequests/${me.uid}/${toUid}`)),
  ])
  if (already.exists()) return "already"
  if (theirs.exists()) {
    await acceptFriendRequest(me.uid, toUid)
    return "accepted"
  }
  const at = Date.now()
  await update(ref(db()), {
    [`friendRequests/${toUid}/${me.uid}`]: { name: me.name, photo: me.photo ?? null, pid: playerCodeOf(me.uid), at },
    [`friendRequestsSent/${me.uid}/${toUid}`]: at,
  })
  return "sent"
}

export async function cancelFriendRequest(myUid: string, toUid: string): Promise<void> {
  await update(ref(db()), {
    [`friendRequests/${toUid}/${myUid}`]: null,
    [`friendRequestsSent/${myUid}/${toUid}`]: null,
  })
}

export async function removeFriend(myUid: string, otherUid: string): Promise<void> {
  await update(ref(db()), {
    [`friends/${myUid}/${otherUid}`]: null,
    [`friends/${otherUid}/${myUid}`]: null,
  })
}

// ---------------------------------- hooks ----------------------------------

/** Live friends list, incoming requests (notifications) and requests I sent. */
export function useFriends() {
  const { user, ready } = useAuthUser()
  const uid = user?.uid ?? null
  const [friends, setFriends] = useState<Record<string, { since: number }>>({})
  const [incoming, setIncoming] = useState<Record<string, FriendRequest>>({})
  const [sent, setSent] = useState<Record<string, number>>({})

  useEffect(() => {
    setFriends({})
    setIncoming({})
    setSent({})
    if (!uid) return
    let offs: (() => void)[] = []
    try {
      const d = db()
      offs = [
        onValue(ref(d, `friends/${uid}`), (s) => setFriends(s.val() ?? {}), () => {}),
        onValue(ref(d, `friendRequests/${uid}`), (s) => setIncoming(s.val() ?? {}), () => {}),
        onValue(ref(d, `friendRequestsSent/${uid}`), (s) => setSent(s.val() ?? {}), () => {}),
      ]
    } catch {}
    return () => offs.forEach((o) => o())
  }, [uid])

  return { user, ready, uid, friends, incoming, sent }
}

/** Loads public profiles for a list of uids (cached). */
export function usePublicProfiles(uids: string[]) {
  const [map, setMap] = useState<Record<string, PublicProfile | null>>({})
  const key = [...uids].sort().join(",")
  useEffect(() => {
    let dead = false
    uids.forEach((u) => {
      fetchPublicProfile(u)
        .then((p) => !dead && setMap((m) => ({ ...m, [u]: p })))
        .catch(() => {})
    })
    return () => {
      dead = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return map
}

// --------------------------------- utilities --------------------------------

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const ta = document.createElement("textarea")
      ta.value = text
      ta.style.position = "fixed"
      ta.style.opacity = "0"
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand("copy")
      document.body.removeChild(ta)
      return ok
    } catch {
      return false
    }
  }
}

/** Ask the Friends panel to open a player's profile (used from the multiplayer lobby). */
export function openPlayerProfile(uid: string) {
  window.dispatchEvent(new CustomEvent("open-player-profile", { detail: { uid } }))
}
