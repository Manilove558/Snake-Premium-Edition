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
import {
  applyDemotionDecay,
  applyMatchResult,
  calculateMatchRankings,
  createRankProfile,
  MMR_START,
  toRankedPlayer,
  type RankedPlayer,
  type TierId,
  type UserRankProfile,
} from "./ranked"

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

// ---------------------------------------------------------------------------
// v20 profiles: full UserRankProfile (MMR + RP + shield + decay).
// The battle screen uses these; the legacy {elo,wins,losses,matches} API above stays for compat.
// ---------------------------------------------------------------------------

/** A v20 profile plus the legacy win/loss counters the leaderboard panel still shows. */
export interface RankProfileBundle {
  profile: UserRankProfile
  wins: number
  losses: number
}

const isTierId = (v: unknown): v is TierId =>
  v === "bronze" || v === "silver" || v === "gold" || v === "platinum" || v === "diamond" || v === "master"

/**
 * Turn a raw ranked/{uid} value into a full v20 profile.
 * Old {elo,wins,losses,matches} records migrate: elo -> RP, matches -> gamesPlayed, MMR starts fresh at 1000.
 */
export function normalizeRankProfile(uid: string, raw: unknown): RankProfileBundle {
  const r = (raw ?? {}) as Record<string, unknown>
  const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d)
  if (raw == null || typeof raw !== "object") {
    return { profile: createRankProfile(uid), wins: 0, losses: 0 }
  }
  const old = normalizeRankedRecord(raw)
  const profile: UserRankProfile = {
    uid,
    rp: Math.max(0, Math.round(num(r.rp, old.elo))),
    mmr: Math.max(0, Math.round(num(r.mmr, MMR_START))),
    gamesPlayed: Math.max(0, Math.floor(num(r.gamesPlayed, old.matches))),
    lastActiveAt: num(r.lastActiveAt, 0),
    protectionGamesLeft: Math.max(0, Math.min(3, Math.floor(num(r.protectionGamesLeft, 0)))),
    shieldTier: isTierId(r.shieldTier) ? r.shieldTier : null,
    lastDecayAt: typeof r.lastDecayAt === "number" && Number.isFinite(r.lastDecayAt) ? r.lastDecayAt : null,
  }
  return { profile, wins: old.wins, losses: old.losses }
}

/** Profiles for several players at once, with inactivity decay applied. Missing -> fresh profile. */
export async function fetchRankProfiles(uids: string[], now: number = Date.now()): Promise<Record<string, RankProfileBundle>> {
  const snaps = await Promise.all(uids.map((u) => get(rankedRef(u))))
  const out: Record<string, RankProfileBundle> = {}
  uids.forEach((u, i) => {
    const s = snaps[i]
    const b = normalizeRankProfile(u, s.exists() ? s.val() : null)
    b.profile = applyDemotionDecay(b.profile, now)
    out[u] = b
  })
  return out
}

/**
 * Save full v20 profiles with ONE update() call (multi-path, atomic).
 * `elo` mirrors RP so the leaderboard index (orderByChild('elo')) keeps working.
 * `wonUid` (the match winner, if any) gets wins+1; everyone else gets losses+1.
 */
export async function writeRankProfiles(
  bundles: Record<string, RankProfileBundle>,
  wonUid: string | null,
): Promise<void> {
  const updates: Record<string, unknown> = {}
  for (const [uid, b] of Object.entries(bundles)) {
    const p = b.profile
    const won = uid === wonUid
    updates[`ranked/${uid}`] = {
      elo: Math.round(p.rp),
      rp: Math.round(p.rp),
      mmr: Math.round(p.mmr),
      gamesPlayed: p.gamesPlayed,
      lastActiveAt: p.lastActiveAt,
      protectionGamesLeft: p.protectionGamesLeft,
      shieldTier: p.shieldTier,
      lastDecayAt: p.lastDecayAt,
      wins: b.wins + (won ? 1 : 0),
      losses: b.losses + (won ? 0 : 1),
      matches: p.gamesPlayed,
      updatedAt: serverTimestamp(),
    }
  }
  if (Object.keys(updates).length === 0) return
  await update(ref(getFirebaseDb()), updates)
}

/**
 * Synthetic last-place finish for the quit/disconnect penalty (v20 system).
 * Opponents take proxy placements by RP order (best first); I finish last with nothing to show.
 */
export function lastPlaceRankProfile(
  bundles: Record<string, RankProfileBundle>,
  myUid: string,
): RankProfileBundle {
  const uids = Object.keys(bundles)
  const n = uids.length
  const mine = bundles[myUid]
  const opp = uids.filter((u) => u !== myUid).sort((a, b) => bundles[b].profile.rp - bundles[a].profile.rp)
  const players: RankedPlayer[] = uids.map((uid) => {
    const b = bundles[uid]
    const isMe = uid === myUid
    return toRankedPlayer(b.profile, {
      placement: isMe ? n : opp.indexOf(uid) + 1,
      kills: 0,
      peakMass: 0,
    })
  })
  const res = calculateMatchRankings(players).find((r) => r.uid === myUid)
  if (!res) throw new Error("lastPlaceRankProfile: no result")
  return { profile: applyMatchResult(mine.profile, res), wins: mine.wins, losses: mine.losses }
}

/** Arm the onDisconnect penalty with a full v20 profile (quitting counts as a loss). */
export async function armDisconnectPenaltyV2(uid: string, bundle: RankProfileBundle): Promise<() => Promise<void>> {
  const od = onDisconnect(rankedRef(uid))
  const p = bundle.profile
  await od.set({
    elo: Math.round(p.rp),
    rp: Math.round(p.rp),
    mmr: Math.round(p.mmr),
    gamesPlayed: p.gamesPlayed,
    lastActiveAt: p.lastActiveAt,
    protectionGamesLeft: p.protectionGamesLeft,
    shieldTier: p.shieldTier,
    lastDecayAt: p.lastDecayAt,
    wins: bundle.wins,
    losses: bundle.losses + 1,
    matches: p.gamesPlayed,
    updatedAt: serverTimestamp(),
  })
  return () => od.cancel()
}
