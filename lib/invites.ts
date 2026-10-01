"use client"

import { useEffect, useState } from "react"
import { onDisconnect, onValue, ref, remove, serverTimestamp, set } from "firebase/database"
import { getFirebaseDb } from "./firebase"

// ---------------------------------------------------------------------------
// Room invites + presence.
//   invites/{toUid}/{roomCode} = { roomCode, fromUid, fromName, fromPhoto, hostPlayerId, at }
//   presence/{uid}            = { online, lastSeen }
//
// Only the room HOST can invite (enforced by firebase-rules.json: the sender's
// uid must match the room's host player entry). One invite per (player, room);
// re-inviting just refreshes it. Invites expire after INVITE_TTL_MS.
// ---------------------------------------------------------------------------

export interface RoomInvite {
  roomCode: string
  fromUid: string
  fromName: string
  fromPhoto: string | null
  /** equipped in-game avatar item id (so the invite shows the avatar they actually wear) */
  avatarId: string | null
  /** sender's VIP status (VIP-only avatars only render while VIP) */
  fromVip: boolean
  hostPlayerId: string
  at: number
}

/** Invite lifetime: 5 seconds — the popup auto-vanishes on timeout. */
export const INVITE_TTL_MS = 5_000

const db = () => getFirebaseDb()

/** Host invites a friend to their room. Throws if the rules reject it (not host). */
export async function sendRoomInvite(opts: {
  fromUid: string
  fromName: string
  fromPhoto: string | null
  avatarId: string | null
  fromVip: boolean
  hostPlayerId: string
  toUid: string
  roomCode: string
}): Promise<void> {
  const { fromUid, fromName, fromPhoto, avatarId, fromVip, hostPlayerId, toUid, roomCode } = opts
  if (!toUid || toUid === fromUid || !roomCode) return
  const invite: RoomInvite = {
    roomCode,
    fromUid,
    fromName: fromName.trim().slice(0, 24) || "Player",
    fromPhoto: fromPhoto ?? null,
    avatarId: avatarId ?? null,
    fromVip: !!fromVip,
    hostPlayerId,
    at: Date.now(),
  }
  await set(ref(db(), `invites/${toUid}/${roomCode}`), invite)
}

/** Remove an invite (accept / decline / expired). Anyone involved may delete. */
export async function removeRoomInvite(toUid: string, roomCode: string): Promise<void> {
  await remove(ref(db(), `invites/${toUid}/${roomCode}`)).catch(() => {})
}

/** Live invites for me; expired ones are pruned automatically. */
export function useRoomInvites(uid: string | null) {
  const [invites, setInvites] = useState<Record<string, RoomInvite>>({})

  const isFresh = (inv: RoomInvite, now: number) =>
    !!inv && typeof inv.at === "number" && now - inv.at < INVITE_TTL_MS && !!inv.roomCode

  useEffect(() => {
    setInvites({})
    if (!uid) return

    const applySnapshot = (v: Record<string, RoomInvite>) => {
      const now = Date.now()
      const fresh: Record<string, RoomInvite> = {}
      Object.entries(v).forEach(([k, inv]) => {
        if (isFresh(inv, now)) fresh[k] = inv
        else removeRoomInvite(uid, k)
      })
      setInvites(fresh)
    }

    let off = () => {}
    try {
      off = onValue(
        ref(db(), `invites/${uid}`),
        (s) => applySnapshot((s.val() ?? {}) as Record<string, RoomInvite>),
        () => {},
      )
    } catch {}

    // Re-check every 2s so invites vanish from the UI right on timeout,
    // even when no new database event arrives.
    const id = setInterval(() => {
      setInvites((cur) => {
        const now = Date.now()
        let changed = false
        const fresh: Record<string, RoomInvite> = {}
        Object.entries(cur).forEach(([k, inv]) => {
          if (isFresh(inv, now)) fresh[k] = inv
          else {
            changed = true
            removeRoomInvite(uid, k)
          }
        })
        return changed ? fresh : cur
      })
    }, 2000)

    return () => {
      off()
      clearInterval(id)
    }
  }, [uid])
  return invites
}

// --------------------------------- presence ----------------------------------

export interface PresenceState {
  online: boolean
  lastSeen: number
}

/**
 * Heartbeat: marks me online now, refreshes every 60s, and auto-marks me
 * offline if the app closes or the connection drops. Call once per sign-in.
 */
export function startPresence(uid: string): () => void {
  const r = ref(db(), `presence/${uid}`)
  let dead = false
  let timer: ReturnType<typeof setInterval> | null = null
  const markOnline = () => {
    if (dead) return
    set(r, { online: true, lastSeen: serverTimestamp() }).catch(() => {})
  }
  const markOffline = () => {
    set(r, { online: false, lastSeen: serverTimestamp() }).catch(() => {})
  }
  try {
    markOnline()
    onDisconnect(r).set({ online: false, lastSeen: serverTimestamp() }).catch(() => {})
    timer = setInterval(markOnline, 60_000)
  } catch {}
  return () => {
    dead = true
    if (timer) clearInterval(timer)
    markOffline()
  }
}

const OFFLINE_AFTER_MS = 90_000

/** Live online/offline for a list of uids (e.g. my friends). */
export function usePresence(uids: string[]) {
  const [map, setMap] = useState<Record<string, PresenceState>>({})
  const key = [...uids].sort().join(",")
  useEffect(() => {
    setMap({})
    if (uids.length === 0) return
    const offs: (() => void)[] = []
    try {
      const d = db()
      uids.forEach((u) => {
        offs.push(
          onValue(
            ref(d, `presence/${u}`),
            (s) => {
              const v = s.val()
              const lastSeen = typeof v?.lastSeen === "number" ? v.lastSeen : 0
              const online = v?.online === true && Date.now() - lastSeen < OFFLINE_AFTER_MS
              setMap((m) => ({ ...m, [u]: { online, lastSeen } }))
            },
            () => {},
          ),
        )
      })
    } catch {}
    return () => offs.forEach((o) => o())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return map
}
