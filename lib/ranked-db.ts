"use client"

import {
  ref,
  get,
  onValue,
  query,
  orderByChild,
  limitToLast,
  limitToFirst,
  startAt,
} from "firebase/database"
import type { User } from "firebase/auth"
import { getFirebaseDb } from "./firebase"
import { normalizeRankedRecord, newRankedRecord, type RankedRecord } from "./ranked"

// ---------------------------------------------------------------------------
// Realtime Database layout (see firebase-rules.json):
//   ranked/{uid} = { elo, rp, mmr, gamesPlayed, wins, losses, matches, ..., updatedAt }
//
// v23: this file is READ-ONLY. Ranked results are calculated and written by the game server
// (server/ranked-store.ts, Firebase Admin SDK) — the browser never writes ranked/{uid} any more.
// The rating maths is in lib/ranked.ts (pure); the record <-> profile mapping is in lib/ranked-profile.ts.
// ---------------------------------------------------------------------------

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
