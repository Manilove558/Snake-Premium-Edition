"use client"

import {
  ref,
  get,
  update,
  onValue,
  onDisconnect,
  query,
  orderByChild,
  limitToLast,
  limitToFirst,
  startAt,
  serverTimestamp,
} from "firebase/database"
import type { User } from "firebase/auth"
import { getFirebaseDb } from "./firebase"
import { normalizeRankedRecord, newRankedRecord, type RankedRecord } from "./ranked"

// ---------------------------------------------------------------------------
// Realtime Database layout (see firebase-rules.json):
//   ranked/{uid} = { elo, wins, losses, matches, updatedAt }
//   rooms/{CODE}/isRanked = true           (marks a ranked room; see lib/multiplayer.ts)
// Elo maths is in lib/ranked.ts (pure). This file only talks to the database.
// ---------------------------------------------------------------------------

/** The fields a client writes (updatedAt is filled in with the server time). */
export type RankedWrite = Pick<RankedRecord, "elo" | "wins" | "losses" | "matches">

/** True when the account is signed in with Google (ranked needs a real account). */
export function isGoogleUser(user: User | null | undefined): boolean {
  return !!user && user.providerData.some((p) => p.providerId === "google.com")
}

function rankedRef(uid: string) {
  return ref(getFirebaseDb(), `ranked/${uid}`)
}

/** One player's record; a player who never played ranked gets the defaults (Elo 1000). */
export async function fetchRankedRecord(uid: string): Promise<RankedRecord> {
  const snap = await get(rankedRef(uid))
  return snap.exists() ? normalizeRankedRecord(snap.val()) : newRankedRecord()
}

/** Records for several players at once, { uid: record } (missing -> default 1000). */
export async function fetchRankedRecords(uids: string[]): Promise<Record<string, RankedRecord>> {
  const list = await Promise.all(uids.map((u) => fetchRankedRecord(u)))
  const out: Record<string, RankedRecord> = {}
  uids.forEach((u, i) => (out[u] = list[i]))
  return out
}

/** Live-subscribe to my own record. Callback gets null until my first ranked match. */
export function subscribeMyRanked(uid: string, cb: (rec: RankedRecord | null) => void): () => void {
  return onValue(
    rankedRef(uid),
    (snap) => cb(snap.exists() ? normalizeRankedRecord(snap.val()) : null),
    () => cb(null),
  )
}

/**
 * Save ranked results with ONE update() call (multi-path, atomic).
 * NOTE: with the security rules in firebase-rules.json a player may only write their OWN
 * ranked/{uid}, so a normal client passes a single uid here. If you later move scoring to a
 * Cloud Function you can pass every player's uid in this same call.
 */
export async function writeRankedUpdates(results: Record<string, RankedWrite>): Promise<void> {
  const updates: Record<string, unknown> = {}
  for (const [uid, r] of Object.entries(results)) {
    updates[`ranked/${uid}`] = {
      elo: r.elo,
      wins: r.wins,
      losses: r.losses,
      matches: r.matches,
      updatedAt: serverTimestamp(),
    }
  }
  if (Object.keys(updates).length === 0) return
  await update(ref(getFirebaseDb()), updates)
}

/**
 * Quit / disconnect protection. The server writes `lastPlace` to ranked/{uid} if this client
 * drops off (app killed, connection lost). Call the returned disarm() once the real result has
 * been saved — otherwise closing the app after the match would still apply the penalty.
 */
export async function armDisconnectPenalty(uid: string, lastPlace: RankedWrite): Promise<() => Promise<void>> {
  const od = onDisconnect(rankedRef(uid))
  await od.set({
    elo: lastPlace.elo,
    wins: lastPlace.wins,
    losses: lastPlace.losses,
    matches: lastPlace.matches,
    updatedAt: serverTimestamp(),
  })
  return () => od.cancel()
}

export interface LeaderboardRow {
  uid: string
  name: string
  elo: number
  wins: number
  losses: number
  matches: number
  /** public profile bits for the avatar next to the name (guests / missing profile → defaults) */
  photo: string | null
  avatar: string | null
  vip: boolean
}

/** Top players by Elo (highest first): ranked ordered by child "elo", last 20, reversed. */
export async function fetchLeaderboard(limit = 20): Promise<LeaderboardRow[]> {
  const db = getFirebaseDb()
  const snap = await get(query(ref(db, "ranked"), orderByChild("elo"), limitToLast(limit)))
  const rows: Pick<LeaderboardRow, "uid" | "elo" | "wins" | "losses" | "matches">[] = []
  snap.forEach((child) => {
    const rec = normalizeRankedRecord(child.val())
    rows.push({ uid: child.key as string, elo: rec.elo, wins: rec.wins, losses: rec.losses, matches: rec.matches })
  })
  rows.reverse() // RTDB returns ascending order
  // Only the name is world-readable; photo / avatar need a signed-in user, so fall back to name-only.
  const infos = await Promise.all(
    rows.map(async (r) => {
      const base = { name: "Player", photo: null as string | null, avatar: null as string | null, vip: false }
      try {
        const v = (await get(ref(db, `publicProfiles/${r.uid}`))).val()
        if (v) return { name: typeof v.name === "string" && v.name ? v.name : "Player", photo: v.photo || null, avatar: typeof v.avatar === "string" ? v.avatar : null, vip: !!v.vip }
      } catch {
        try {
          const n = (await get(ref(db, `publicProfiles/${r.uid}/name`))).val()
          if (typeof n === "string" && n) base.name = n
        } catch {}
      }
      return base
    }),
  )
  return rows.map((r, i) => ({ ...r, ...infos[i] }))
}

/**
 * World position of a rating: how many players are rated strictly higher (+1).
 * Counts at most `cap` players so it stays cheap; `capped` means "cap or more players are ahead".
 */
export async function fetchRankPosition(elo: number, cap = 500): Promise<{ position: number; capped: boolean }> {
  const snap = await get(query(ref(getFirebaseDb(), "ranked"), orderByChild("elo"), startAt(elo + 1), limitToFirst(cap)))
  const ahead = snap.size
  return { position: ahead + 1, capped: ahead >= cap }
}
