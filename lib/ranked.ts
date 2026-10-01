// lib/ranked.ts — PURE ranked-mode logic (no Firebase, no React) so it is easy to test.
// Database access lives in lib/ranked-db.ts.
//
// Elo for a free-for-all with N players:
//   S    = (N - rank) / (N - 1)                       (1st = 1, last = 0)
//   E_o  = 1 / (1 + 10^((elo_o - elo_p) / 400))       (vs every opponent o)
//   avgE = mean(E_o)
//   new  = round(elo + K * (S - avgE)), clamped to [0, 3000]
//   K    = 40 for a player's first 10 ranked matches, else 32

export const ELO_START = 1000
export const ELO_MIN = 0
export const ELO_MAX = 3000
export const K_PROVISIONAL = 40
export const K_ESTABLISHED = 32
/** A player is "provisional" (K = 40) while they have fewer than this many ranked matches. */
export const PROVISIONAL_MATCHES = 10
/** A battle only counts as ranked with at least this many players. */
export const RANKED_MIN_PLAYERS = 3

/** What is stored at ranked/{uid}. */
export interface RankedRecord {
  elo: number
  wins: number
  losses: number
  matches: number
  updatedAt?: number
}

export const newRankedRecord = (): RankedRecord => ({ elo: ELO_START, wins: 0, losses: 0, matches: 0 })

/** Turn whatever came out of the database into a safe record (missing / broken -> defaults). */
export function normalizeRankedRecord(raw: unknown): RankedRecord {
  const r = (raw ?? {}) as Partial<Record<keyof RankedRecord, unknown>>
  const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d)
  const int = (v: unknown) => Math.max(0, Math.floor(num(v, 0)))
  return {
    elo: clampElo(num(r.elo, ELO_START)),
    wins: int(r.wins),
    losses: int(r.losses),
    matches: int(r.matches),
    updatedAt: typeof r.updatedAt === "number" ? r.updatedAt : undefined,
  }
}

export const clampElo = (n: number) => Math.min(ELO_MAX, Math.max(ELO_MIN, n))

/** K-factor. `matches` = ranked matches played BEFORE this one. Unknown -> established (32). */
export function kFactor(matches?: number): number {
  return typeof matches === "number" && matches < PROVISIONAL_MATCHES ? K_PROVISIONAL : K_ESTABLISHED
}

/** Probability-style expected score of a player rated `elo` against one rated `oppElo`. */
export function expectedScore(elo: number, oppElo: number): number {
  return 1 / (1 + Math.pow(10, (oppElo - elo) / 400))
}

export interface EloPlayer {
  uid: string
  /** rating before the match */
  elo: number
  /** 1 = winner (last alive) … N = first out / quit. Ties are allowed (same number). */
  rank: number
  /** ranked matches played before this one; omit for the established K (32) */
  matches?: number
}

/** New Elo for every player of one finished battle. Returns { uid: newElo }. */
export function computeEloChanges(players: EloPlayer[]): Record<string, number> {
  const seen = new Set<string>()
  for (const p of players) {
    if (seen.has(p.uid)) throw new Error("computeEloChanges: duplicate uid")
    seen.add(p.uid)
  }
  const out: Record<string, number> = {}
  const n = players.length
  if (n < 2) {
    for (const p of players) out[p.uid] = clampElo(p.elo)
    return out
  }
  for (const p of players) {
    const s = Math.min(1, Math.max(0, (n - p.rank) / (n - 1)))
    let sumE = 0
    for (const o of players) if (o !== p) sumE += expectedScore(p.elo, o.elo)
    const avgE = sumE / (n - 1)
    out[p.uid] = clampElo(Math.round(p.elo + kFactor(p.matches) * (s - avgE)))
  }
  return out
}

/**
 * Rating of `me` if they finish LAST (used for quitting / disconnecting).
 * Last place has S = 0, so the result only depends on the opponents' ratings.
 */
export function lastPlaceElo(me: { elo: number; matches?: number }, opponentElos: number[]): number {
  const players: EloPlayer[] = [{ uid: "me", elo: me.elo, rank: opponentElos.length + 1, matches: me.matches }]
  opponentElos.forEach((elo, i) => players.push({ uid: `o${i}`, elo, rank: i + 1 }))
  return computeEloChanges(players).me
}

// ---------------------------------------------------------------------------
// Placement (who finished where)
// ---------------------------------------------------------------------------

/**
 * Final placement of every participant of a battle. Returns { playerId: rank }.
 *  - rank 1 = the winner (last alive)
 *  - everyone still in the room, in reverse order of elimination (died later = better)
 *  - anyone who is no longer in the room (quit / disconnected) is LAST — all of them get rank N
 */
export function computeStandings(input: {
  /** playerIds that took part when the battle started */
  participants: string[]
  /** playerIds still in the room when the battle ended */
  present: string[]
  winnerId: string | null
  /** elimination time per player (from the kill feed) */
  deaths: { id: string; ts: number }[]
}): Record<string, number> {
  const { participants, winnerId } = input
  const present = new Set(input.present)
  const n = participants.length
  const deathTs = new Map(input.deaths.map((d) => [d.id, d.ts]))
  const ranks: Record<string, number> = {}

  const stayed = participants.filter((id) => present.has(id))
  const order: string[] = []
  if (winnerId && stayed.includes(winnerId)) order.push(winnerId)
  // not the winner: survivors first (should not happen), then latest death first; id keeps it deterministic
  const rest = stayed
    .filter((id) => !order.includes(id))
    .sort((a, b) => {
      const ta = deathTs.has(a) ? (deathTs.get(a) as number) : Infinity
      const tb = deathTs.has(b) ? (deathTs.get(b) as number) : Infinity
      return tb - ta || (a < b ? -1 : a > b ? 1 : 0)
    })
  order.push(...rest)
  order.forEach((id, i) => (ranks[id] = i + 1))
  for (const id of participants) if (!(id in ranks)) ranks[id] = n
  return ranks
}

// ---------------------------------------------------------------------------
// Eligibility (anti-farming)
// ---------------------------------------------------------------------------

export type RankedIneligibleReason = "not_ranked" | "too_few_players" | "guest_player" | "duplicate_account"

export const RANKED_REASON_TEXT: Record<RankedIneligibleReason, string> = {
  not_ranked: "Not a ranked room",
  too_few_players: `Ranked needs at least ${RANKED_MIN_PLAYERS} players`,
  guest_player: "Every player must be signed in with Google",
  duplicate_account: "Each player must use a different account",
}

export type RankedEligibility = { eligible: true } | { eligible: false; reason: RankedIneligibleReason }

/** A battle counts as ranked ONLY if: ranked room, >= 3 players, all signed in, all uids distinct. */
export function checkRankedEligibility(input: { isRanked: boolean; players: { uid?: string | null }[] }): RankedEligibility {
  if (!input.isRanked) return { eligible: false, reason: "not_ranked" }
  if (input.players.length < RANKED_MIN_PLAYERS) return { eligible: false, reason: "too_few_players" }
  const uids = input.players.map((p) => p.uid)
  if (uids.some((u) => !u)) return { eligible: false, reason: "guest_player" }
  if (new Set(uids).size !== uids.length) return { eligible: false, reason: "duplicate_account" }
  return { eligible: true }
}

// ---------------------------------------------------------------------------
// Tiers (display only)
// ---------------------------------------------------------------------------

export interface Tier {
  id: "bronze" | "silver" | "gold" | "platinum" | "diamond"
  name: string
  emoji: string
  /** badge colour (works on dark and light backgrounds) */
  color: string
  /** lowest Elo of this tier */
  min: number
}

export const TIERS: Tier[] = [
  { id: "bronze", name: "Bronze", emoji: "🥉", color: "#cd7f32", min: 0 },
  { id: "silver", name: "Silver", emoji: "🥈", color: "#9aa5b1", min: 1000 },
  { id: "gold", name: "Gold", emoji: "🥇", color: "#f5b301", min: 1200 },
  { id: "platinum", name: "Platinum", emoji: "💠", color: "#2bc4b4", min: 1400 },
  { id: "diamond", name: "Diamond", emoji: "💎", color: "#4da6ff", min: 1600 },
]

/** Bronze < 1000, Silver 1000–1199, Gold 1200–1399, Platinum 1400–1599, Diamond 1600+. */
export function getTier(elo: number): Tier {
  for (let i = TIERS.length - 1; i >= 0; i--) if (elo >= TIERS[i].min) return TIERS[i]
  return TIERS[0]
}

// ---------------------------------------------------------------------------
// Rank Pass rewards (one-time reward when a player first reaches a higher tier)
// ---------------------------------------------------------------------------

/** Gems are ALWAYS exactly this many per rank pass (no VIP bonus, no scaling). */
export const RANK_PASS_GEMS = 1
/** Coins for passing into a tier. Silver / Bronze have none: every new player already starts at Silver (1000 Elo). */
export const RANK_PASS_COINS: Partial<Record<Tier["id"], number>> = { gold: 1000, platinum: 2000, diamond: 4000 }

/** Every tier with a reward that a player rated `elo` has reached (lowest first). */
export function rankPassesUpTo(elo: number): Tier[] {
  const cur = getTier(elo)
  return TIERS.filter((t) => t.min <= cur.min && RANK_PASS_COINS[t.id] !== undefined)
}

/** The next tier above `elo`, or null at the top. */
export function getNextTier(elo: number): Tier | null {
  return TIERS.find((t) => t.min > elo) ?? null
}
