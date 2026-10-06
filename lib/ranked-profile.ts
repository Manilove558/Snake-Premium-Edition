// lib/ranked-profile.ts — PURE helpers for the stored ranked profile (no Firebase SDK, no React).
//
// Shared by the Node game server (server/ranked-store.ts, which talks to RTDB through the Admin SDK)
// and by the browser (lib/ranked-db.ts, read-only). Keeping the record <-> profile mapping in ONE file
// guarantees that what the server writes is exactly what the leaderboard / profile screens read.
import {
  applyDemotionDecay,
  createRankProfile,
  MMR_START,
  normalizeRankedRecord,
  type TierId,
  type UserRankProfile,
} from "./ranked"

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

/** Raw DB value -> bundle with inactivity decay applied (what a match is rated from). */
export function loadRankProfile(uid: string, raw: unknown, now: number): RankProfileBundle {
  const b = normalizeRankProfile(uid, raw)
  b.profile = applyDemotionDecay(b.profile, now)
  return b
}

/**
 * The value stored at ranked/{uid} after a match (everything except `updatedAt`, which the writer fills with the
 * database server time). `elo` mirrors RP so the leaderboard index (orderByChild('elo')) keeps working.
 * `won` -> wins+1, otherwise losses+1.
 */
export function rankProfileRecord(b: RankProfileBundle, won: boolean): Record<string, number | string | null> {
  const p = b.profile
  return {
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
  }
}
