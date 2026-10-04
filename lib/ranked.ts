// lib/ranked.ts — PURE ranked-mode logic (no Firebase, no React, no Date.now() inside the match math)
// so it is deterministic and easy to unit-test. Database access lives in lib/ranked-db.ts.
//
// ============================================================================================
//  DUAL-TRACK RATING
// ============================================================================================
//  MMR (hidden)  – skill estimate. Used ONLY for matchmaking and for the "expected placement"
//                  maths. Never touched by shields, decay or tier floors, so it keeps tracking
//                  true skill even when the visible number is being protected.
//  RP  (visible) – Rank Points shown to the player. Drives tiers, shields, decay, rewards.
//
//  Both tracks start at 1000 (Silver) and move by the SAME performance signal (below) but with
//  their own K-factor and their own constraints.
//
// ============================================================================================
//  MATCH MATHS (N players, 3 <= N <= 8)
// ============================================================================================
//  1. Expected placement (pairwise Elo, uses hidden MMR):
//       P(j beats i) = 1 / (1 + 10^((MMR_i - MMR_j) / 400))
//       E_i          = 1 + sum_{j != i} P(j beats i)         (1 = expected to win, N = expected last)
//     NB: this is the same quantity as "N - sum_j 1/(1 + 10^((MMR_j - MMR_i) / 400))", i.e. N minus
//     the expected number of opponents i BEATS. (Writing "1 + the expected number beaten" would
//     give the strongest player the WORST expected placement, so the sign is flipped here.)
//     Expected placement is converted to a 0..1 score:   Ŝ_i = (N - E_i) / (N - 1)
//     Σ Ŝ_i = N/2 exactly, because P(i beats j) + P(j beats i) = 1.
//
//  2. Actual performance (each factor is a tie-aware PERCENTILE inside the lobby, 0..1):
//       S_place = (N - avgPlacement) / (N - 1)
//       S_kills = percentile of kills,  S_mass = percentile of peak mass
//       P_i     = 0.50 * S_place + 0.30 * S_kills + 0.20 * S_mass
//     Percentiles (instead of raw values) mean every factor has mean exactly 0.5 — so
//     Σ P_i = N/2 = Σ Ŝ_i, i.e. the "surprise" P_i - Ŝ_i is already zero-sum BEFORE K is applied —
//     and one absurd kill/mass number from a cheater cannot blow up the score; only ordering counts.
//
//  3. Raw delta:   raw_i = K_i * (P_i - Ŝ_i)           (|raw_i| <= K_i)
//
//  4. Zero-sum normalisation: see distributeZeroSum(). Σ RP delta == 0 and Σ MMR delta == 0
//     EXACTLY (integers), so the economy can never inflate. Shields / floors are paid for by the
//     winners of that match, not printed out of thin air.
//
// ============================================================================================

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Both tracks start here (= Silver). */
export const MMR_START = 1000
export const RP_START = 1000
/** RP is open-ended above Master; this is only a sanity ceiling for corrupted data. */
export const RP_MAX = 99_999

/** Lobby size the maths is designed for. */
export const RANKED_MAX_PLAYERS = 8

/** Performance weights (must sum to 1). */
export const WEIGHT_PLACEMENT = 0.5
export const WEIGHT_KILLS = 0.3
export const WEIGHT_MASS = 0.2

/** K-factors (maximum RP / MMR swing of one match for one player). */
export const K_PLACEMENT_MATCHES = 40
export const K_STANDARD = 20
export const K_HIGH_RANK = 10
/** A player is in "placement" while they have played fewer than this many ranked matches. */
export const PLACEMENT_GAMES = 5

/** Demotion Shield: number of protected games after a promotion. */
export const PROTECTION_GAMES = 3

const DAY_MS = 86_400_000

// ---------------------------------------------------------------------------
// Tiers
// ---------------------------------------------------------------------------

export type TierId = "bronze" | "silver" | "gold" | "platinum" | "diamond" | "master"

export interface Tier {
  id: TierId
  name: string
  emoji: string
  /** badge colour (works on dark and light backgrounds) */
  color: string
  /** lowest RP of this tier */
  min: number
}

export const TIERS: Tier[] = [
  { id: "bronze", name: "Bronze", emoji: "🥉", color: "#cd7f32", min: 0 },
  { id: "silver", name: "Silver", emoji: "🥈", color: "#9aa5b1", min: 1000 },
  { id: "gold", name: "Gold", emoji: "🥇", color: "#f5b301", min: 1500 },
  { id: "platinum", name: "Platinum", emoji: "💠", color: "#2bc4b4", min: 2000 },
  { id: "diamond", name: "Diamond", emoji: "💎", color: "#4da6ff", min: 2500 },
  { id: "master", name: "Master", emoji: "👑", color: "#b44dff", min: 3000 },
]

/** A tier plus where `rp` sits inside it. */
export interface TierInfo extends Tier {
  /** 0 = Bronze … 5 = Master */
  index: number
  /** highest RP of this tier, or null for Master (open-ended) */
  max: number | null
  next: Tier | null
  /** RP gained since the tier started */
  rpIntoTier: number
  /** RP still needed for the next tier, or null at the top */
  rpToNext: number | null
  /** 0..1 progress through this tier (1 at Master) */
  progress: number
}

/**
 * Bronze 0–999 · Silver 1000–1499 · Gold 1500–1999 · Platinum 2000–2499 · Diamond 2500–2999 · Master 3000+
 * Garbage input (NaN, negative) is treated as 0 RP.
 */
export function calculateTier(rp: number): TierInfo {
  const v = Number.isFinite(rp) ? Math.max(0, Math.floor(rp)) : 0
  let index = 0
  for (let i = TIERS.length - 1; i >= 0; i--) {
    if (v >= TIERS[i].min) {
      index = i
      break
    }
  }
  const tier = TIERS[index]
  const next = TIERS[index + 1] ?? null
  return {
    ...tier,
    index,
    max: next ? next.min - 1 : null,
    next,
    rpIntoTier: v - tier.min,
    rpToNext: next ? next.min - v : null,
    progress: next ? (v - tier.min) / (next.min - tier.min) : 1,
  }
}

/** Same as calculateTier — kept because several components already call getTier(). */
export const getTier = (rp: number): TierInfo => calculateTier(rp)

/** The next tier above `rp`, or null at the top. */
export function getNextTier(rp: number): Tier | null {
  return TIERS.find((t) => t.min > rp) ?? null
}

/**
 * "Apex Legend" is a leaderboard title, not an RP band: the top APEX_LEGEND_TOP_N players that are
 * ALSO in the Master tier. (The tier table in the spec stops at Master 3000+.)
 * `position` is the 1-based global leaderboard position.
 */
export const APEX_LEGEND_TOP_N = 10
export function isApexLegend(rp: number, position: number): boolean {
  return calculateTier(rp).id === "master" && Number.isInteger(position) && position >= 1 && position <= APEX_LEGEND_TOP_N
}

// ---------------------------------------------------------------------------
// Payload types
// ---------------------------------------------------------------------------

/** One participant of a finished battle, as reported to the ranking system. */
export interface RankedPlayer {
  uid: string
  /** hidden matchmaking rating BEFORE the match */
  mmr: number
  /** visible rank points BEFORE the match */
  rp: number
  /** ranked matches completed BEFORE this one (drives placement-match K) */
  gamesPlayed: number
  /** 1 = winner … N = first out. Ties allowed (same number) — they share the average rank. */
  placement: number
  /** eliminations credited to this player */
  kills: number
  /** biggest snake length / mass reached during the match */
  peakMass: number
  /** Demotion Shield: protected games still left before this match (default 0) */
  protectionGamesLeft?: number
  /** tier that the shield protects (default: the player's current tier) */
  shieldTier?: TierId
}

export type RankedIntegrityFlag =
  /** a field was NaN / negative / out of range and was repaired */
  | "input_sanitized"
  /** total kills > N-1 (impossible in a battle royale) → kills factor ignored for the whole lobby */
  | "kills_inconsistent"

export interface PerformanceBreakdown {
  /** 0..1 percentile scores (1 = best in lobby) */
  placement: number
  kills: number
  mass: number
  /** weighted blend: 0.5 / 0.3 / 0.2 */
  composite: number
}

/** Result for ONE player of one match. Returned in the same order as the input array. */
export interface MMRUpdateResult {
  uid: string

  /** placement as reported */
  placement: number
  /** placement after averaging ties (e.g. two players tied for 2nd → 2.5 each) */
  effectivePlacement: number
  /** E_i = 1 + Σ P(j beats i), from hidden MMR */
  expectedPlacement: number
  /** Ŝ_i = (N - E_i) / (N - 1), 0..1 */
  expectedScore: number
  performance: PerformanceBreakdown

  kFactorRP: number
  kFactorMMR: number

  mmrBefore: number
  mmrAfter: number
  mmrDelta: number

  rpBefore: number
  rpAfter: number
  rpDelta: number

  tierBefore: TierInfo
  tierAfter: TierInfo
  promoted: boolean
  demoted: boolean

  /** RP loss that was prevented by the Demotion Shield / the 0-RP floor (paid by this match's winners) */
  rpProtected: number
  /** true if the Demotion Shield actually saved RP in this match */
  shieldTriggered: boolean
  /** state to store on the profile after this match */
  protectionGamesLeft: number
  shieldTier: TierId | null

  gamesPlayed: number
  flags: RankedIntegrityFlag[]
}

/** Persistent per-user ranking state. Timestamps are epoch milliseconds. */
export interface UserRankProfile {
  uid: string
  mmr: number
  rp: number
  gamesPlayed: number
  /** last time the player finished a ranked match */
  lastActiveAt: number
  protectionGamesLeft: number
  shieldTier: TierId | null
  /** decay has been charged up to this moment (makes applyDemotionDecay idempotent). null = never. */
  lastDecayAt: number | null
}

export interface DecayRule {
  graceDays: number
  rpPerDay: number
  /** decay never pushes RP below this */
  floor: number
}

/** Inactivity decay — only the top tiers decay. Floor = the tier's own minimum, so decay never demotes. */
export const DECAY_RULES: Partial<Record<TierId, DecayRule>> = {
  master: { graceDays: 3, rpPerDay: 50, floor: 3000 },
  diamond: { graceDays: 7, rpPerDay: 25, floor: 2500 },
  platinum: { graceDays: 14, rpPerDay: 10, floor: 2000 },
}

// ---------------------------------------------------------------------------
// Small maths helpers
// ---------------------------------------------------------------------------

/** Pairwise Elo: probability that a player rated `a` beats a player rated `b`. */
const winProbability = (a: number, b: number): number => 1 / (1 + Math.pow(10, (b - a) / 400))

const num = (v: unknown, fallback: number): number => (typeof v === "number" && Number.isFinite(v) ? v : fallback)

/**
 * K-factor.
 *   RP track : 40 during the first 5 matches, 10 for Master+, else 20.
 *   MMR track: 40 during the first 5 matches, else 20 (the hidden rating keeps adapting at the top).
 */
export function getKFactor(gamesPlayed: number, rp: number, track: "rp" | "mmr" = "rp"): number {
  if (gamesPlayed < PLACEMENT_GAMES) return K_PLACEMENT_MATCHES
  if (track === "rp" && calculateTier(rp).id === "master") return K_HIGH_RANK
  return K_STANDARD
}

/**
 * Tie-aware percentile of every value inside the lobby, 0 (worst) … 1 (best).
 * Tied values share the average of the ranks they occupy, so Σ scores = N/2 always.
 * Returns the average (1-based) rank too.
 */
function percentiles(values: number[], higherIsBetter: boolean): { score: number[]; rank: number[] } {
  const n = values.length
  const score: number[] = []
  const rank: number[] = []
  for (const v of values) {
    let better = 0
    let equal = 0
    for (const o of values) {
      if (o === v) equal++
      else if (higherIsBetter ? o > v : o < v) better++
    }
    const avgRank = better + (equal + 1) / 2 // e.g. two tied for 2nd → 2.5
    rank.push(avgRank)
    score.push((n - avgRank) / (n - 1))
  }
  return { score, rank }
}

/**
 * ZERO-SUM NORMALISATION.
 *
 * Input : raw[i]      – unconstrained per-player deltas (|raw_i| <= K_i)
 *         minDelta[i] – most negative integer delta player i may take (<= 0). RP: the floor created by a
 *                       Demotion Shield or the 0-RP floor. MMR: not going below 0.
 * Output: integer deltas with Σ == 0 EXACTLY, and each player's delta never beyond its limit.
 *
 *  1. Balance. Let Pos = Σ positive raw, Neg = Σ |negative raw|. Scale the larger side down to the
 *     smaller one (T = min(Pos, Neg)). Signs are preserved (a loser never gains), and no one's delta
 *     ever EXCEEDS their own K cap. With equal K (the normal case) Pos ≈ Neg and nothing is lost.
 *  2. Protect. Anyone whose loss would cross their limit is clamped to it. The RP they were spared is
 *     taken back from the winners, pro rata — so protection is paid for, never printed.
 *  3. Round. Largest-remainder rounding on the unclamped players so the integer sum is exactly 0.
 *     Ties are broken by uid so the result does not depend on input order.
 */
function distributeZeroSum(
  raw: number[],
  minDelta: number[],
  ids: string[],
): { deltas: number[]; protectedAmount: number[] } {
  const n = raw.length
  const d = raw.slice()
  const protectedAmount: number[] = new Array<number>(n).fill(0)
  const EPS = 1e-9

  // 1. balance
  let pos = 0
  let neg = 0
  for (const x of d) {
    if (x > 0) pos += x
    else if (x < 0) neg -= x
  }
  const T = Math.min(pos, neg)
  if (T <= EPS) return { deltas: new Array<number>(n).fill(0), protectedAmount }
  for (let i = 0; i < n; i++) d[i] = d[i] > 0 ? (d[i] * T) / pos : (d[i] * T) / neg

  // 2. protect (shield / floor) — claw the spared RP back from the winners
  const fixed: boolean[] = new Array<boolean>(n).fill(false)
  let spared = 0
  for (let i = 0; i < n; i++) {
    if (d[i] < minDelta[i]) {
      protectedAmount[i] = minDelta[i] - d[i]
      spared += protectedAmount[i]
      d[i] = minDelta[i]
      fixed[i] = true
    }
  }
  if (spared > 0) {
    let gains = 0
    for (const x of d) if (x > 0) gains += x
    const keep = gains > 0 ? Math.max(0, (gains - spared) / gains) : 0
    for (let i = 0; i < n; i++) if (d[i] > 0) d[i] *= keep
  }

  // 3. round to integers, Σ stays 0
  // Snap to a 1e-9 grid first: summation order changes the last float bits, and without this two
  // mathematically equal remainders could be ranked differently depending on input order.
  for (let i = 0; i < n; i++) d[i] = Math.round(d[i] * 1e9) / 1e9
  let fixedSum = 0
  const free: number[] = []
  for (let i = 0; i < n; i++) {
    if (fixed[i]) fixedSum += d[i]
    else free.push(i)
  }
  const target = Math.round(-fixedSum)
  const base = free.map((i) => Math.floor(d[i]))
  let need = target - base.reduce((a, b) => a + b, 0)
  need = Math.max(0, Math.min(free.length, need))
  const order = free
    .map((i, k) => ({ i, k, frac: d[i] - base[k] }))
    .sort((a, b) => b.frac - a.frac || (ids[a.i] < ids[b.i] ? -1 : ids[a.i] > ids[b.i] ? 1 : 0))
  const bump = new Set(order.slice(0, need).map((o) => o.i))

  const out: number[] = new Array<number>(n).fill(0)
  for (let i = 0; i < n; i++) if (fixed[i]) out[i] = Math.round(d[i])
  free.forEach((i, k) => {
    out[i] = base[k] + (bump.has(i) ? 1 : 0)
  })
  return { deltas: out.map((x) => x + 0), protectedAmount } // "+ 0" turns -0 into 0
}

// ---------------------------------------------------------------------------
// Match calculation
// ---------------------------------------------------------------------------

interface CleanPlayer {
  uid: string
  mmr: number
  rp: number
  games: number
  placement: number
  kills: number
  /** reported kills with NaN/negatives repaired but NOT clamped — used to detect impossible reports */
  rawKills: number
  mass: number
  shieldLeft: number
  shieldTier: TierId | null
  repaired: boolean
}

function sanitizePlayer(p: RankedPlayer, n: number): CleanPlayer {
  const mmr = num(p.mmr, NaN)
  const rp = num(p.rp, NaN)
  const games = num(p.gamesPlayed, NaN)
  const placement = num(p.placement, NaN)
  const kills = num(p.kills, NaN)
  const mass = num(p.peakMass, NaN)
  const shield = num(p.protectionGamesLeft ?? 0, NaN)
  const clean: CleanPlayer = {
    uid: p.uid,
    mmr: Math.min(RP_MAX, Math.max(0, Math.round(Number.isNaN(mmr) ? MMR_START : mmr))),
    rp: Math.min(RP_MAX, Math.max(0, Math.round(Number.isNaN(rp) ? RP_START : rp))),
    games: Math.max(0, Math.floor(Number.isNaN(games) ? 0 : games)),
    placement: Math.min(n, Math.max(1, Math.round(Number.isNaN(placement) ? n : placement))), // unknown → last
    kills: Math.min(n - 1, Math.max(0, Math.floor(Number.isNaN(kills) ? 0 : kills))),
    rawKills: Math.max(0, Math.floor(Number.isNaN(kills) ? 0 : kills)),
    mass: Math.max(0, Number.isNaN(mass) ? 0 : mass),
    shieldLeft: Math.min(PROTECTION_GAMES, Math.max(0, Math.floor(Number.isNaN(shield) ? 0 : shield))),
    shieldTier: p.shieldTier ?? null,
    repaired: false,
  }
  clean.repaired =
    Number.isNaN(mmr) || Number.isNaN(rp) || Number.isNaN(games) || Number.isNaN(placement) || Number.isNaN(kills) ||
    Number.isNaN(mass) || clean.mmr !== p.mmr || clean.rp !== p.rp || clean.placement !== p.placement ||
    clean.kills !== p.kills || clean.mass !== p.peakMass
  return clean
}

/**
 * Rank one finished battle. Pure and deterministic: same input → same output, regardless of input order.
 *
 * Guarantees (checked by an internal invariant):
 *   Σ rpDelta  === 0     and     Σ mmrDelta === 0
 *
 * @throws RangeError if the lobby is not 3..8 players; Error on duplicate uids.
 */
export function calculateMatchRankings(players: RankedPlayer[]): MMRUpdateResult[] {
  const n = players.length
  if (n < RANKED_MIN_PLAYERS || n > RANKED_MAX_PLAYERS) {
    throw new RangeError(`calculateMatchRankings: need ${RANKED_MIN_PLAYERS}-${RANKED_MAX_PLAYERS} players, got ${n}`)
  }
  if (new Set(players.map((p) => p.uid)).size !== n) throw new Error("calculateMatchRankings: duplicate uid")

  const ps = players.map((p) => sanitizePlayer(p, n))

  // --- 1. expected placement from hidden MMR ---------------------------------------------------
  const expectedPlacement = ps.map((pi) => {
    let e = 1
    for (const pj of ps) if (pj !== pi) e += winProbability(pj.mmr, pi.mmr) // P(j beats i)
    return e
  })
  const expectedScore = expectedPlacement.map((e) => (n - e) / (n - 1)) // Ŝ_i

  // --- 2. actual performance (percentiles, weights 50/30/20) -----------------------------------
  const place = percentiles(ps.map((p) => p.placement), false) // lower placement number = better
  // Kill sanity: every kill eliminates someone, so Σ kills <= N-1. Otherwise the report is lying:
  // ignore the kills factor for the whole lobby (everyone scores 0.5) rather than let it be farmed.
  // (Checked on the UNclamped reports — clamping each value to N-1 first would hide a lie.)
  const killsConsistent = ps.reduce((a, p) => a + p.rawKills, 0) <= n - 1
  const kills = killsConsistent ? percentiles(ps.map((p) => p.kills), true) : { score: ps.map(() => 0.5), rank: [] }
  const mass = percentiles(ps.map((p) => p.mass), true)
  const composite = ps.map(
    (_, i) => WEIGHT_PLACEMENT * place.score[i] + WEIGHT_KILLS * kills.score[i] + WEIGHT_MASS * mass.score[i],
  )

  // --- 3. raw deltas: K * (actual - expected) ---------------------------------------------------
  const tierBefore = ps.map((p) => calculateTier(p.rp))
  const kRP = ps.map((p) => getKFactor(p.games, p.rp, "rp"))
  const kMMR = ps.map((p) => getKFactor(p.games, p.rp, "mmr"))
  const rawRP = ps.map((_, i) => kRP[i] * (composite[i] - expectedScore[i]))
  const rawMMR = ps.map((_, i) => kMMR[i] * (composite[i] - expectedScore[i]))

  // RP floors: a Demotion Shield protects the start of the shielded tier; nobody goes below 0.
  const shielded = ps.map((p) => p.shieldLeft > 0)
  const rpFloor = ps.map((p, i) => {
    if (!shielded[i]) return 0
    const id = p.shieldTier ?? tierBefore[i].id
    const tierMin = TIERS.find((t) => t.id === id)?.min ?? 0
    return Math.min(p.rp, tierMin)
  })
  const ids = ps.map((p) => p.uid)

  // --- 4. zero-sum normalisation ----------------------------------------------------------------
  const rp = distributeZeroSum(rawRP, ps.map((p, i) => -(p.rp - rpFloor[i])), ids)
  const mmr = distributeZeroSum(rawMMR, ps.map((p) => -p.mmr), ids)

  // Fail loudly instead of silently inflating the economy.
  if (rp.deltas.reduce((a, b) => a + b, 0) !== 0 || mmr.deltas.reduce((a, b) => a + b, 0) !== 0) {
    throw new Error("calculateMatchRankings: zero-sum invariant violated")
  }

  // --- 5. assemble results ----------------------------------------------------------------------
  return ps.map((p, i): MMRUpdateResult => {
    const rpAfter = p.rp + rp.deltas[i]
    const tierAfter = calculateTier(rpAfter)
    const promoted = tierAfter.index > tierBefore[i].index
    const demoted = tierAfter.index < tierBefore[i].index

    // Shield bookkeeping: a promotion grants a fresh shield on the NEW tier; a demotion clears it;
    // otherwise each protected game uses one charge.
    let protectionGamesLeft = Math.max(0, p.shieldLeft - 1)
    let shieldTier: TierId | null = protectionGamesLeft > 0 ? (p.shieldTier ?? tierBefore[i].id) : null
    if (promoted) {
      protectionGamesLeft = PROTECTION_GAMES
      shieldTier = tierAfter.id
    } else if (demoted) {
      protectionGamesLeft = 0
      shieldTier = null
    }

    const flags: RankedIntegrityFlag[] = []
    if (p.repaired) flags.push("input_sanitized")
    if (!killsConsistent) flags.push("kills_inconsistent")

    return {
      uid: p.uid,
      placement: p.placement,
      effectivePlacement: place.rank[i],
      expectedPlacement: expectedPlacement[i],
      expectedScore: expectedScore[i],
      performance: { placement: place.score[i], kills: kills.score[i], mass: mass.score[i], composite: composite[i] },
      kFactorRP: kRP[i],
      kFactorMMR: kMMR[i],
      mmrBefore: p.mmr,
      mmrAfter: p.mmr + mmr.deltas[i],
      mmrDelta: mmr.deltas[i],
      rpBefore: p.rp,
      rpAfter,
      rpDelta: rp.deltas[i],
      tierBefore: tierBefore[i],
      tierAfter,
      promoted,
      demoted,
      rpProtected: Math.round(rp.protectedAmount[i]),
      shieldTriggered: shielded[i] && rp.protectedAmount[i] > 0.5 && rpFloor[i] > 0,
      protectionGamesLeft,
      shieldTier,
      gamesPlayed: p.games + 1,
      flags,
    }
  })
}

// ---------------------------------------------------------------------------
// Profile helpers
// ---------------------------------------------------------------------------

/** Fresh profile for a player who has never played ranked. */
export function createRankProfile(uid: string, now: number = Date.now()): UserRankProfile {
  return {
    uid,
    mmr: MMR_START,
    rp: RP_START,
    gamesPlayed: 0,
    lastActiveAt: now,
    protectionGamesLeft: 0,
    shieldTier: null,
    lastDecayAt: null,
  }
}

/** Snapshot of a profile as a RankedPlayer for the next match (add placement / kills / peakMass). */
export function toRankedPlayer(
  profile: UserRankProfile,
  match: Pick<RankedPlayer, "placement" | "kills" | "peakMass">,
): RankedPlayer {
  return {
    uid: profile.uid,
    mmr: profile.mmr,
    rp: profile.rp,
    gamesPlayed: profile.gamesPlayed,
    protectionGamesLeft: profile.protectionGamesLeft,
    shieldTier: profile.shieldTier ?? undefined,
    ...match,
  }
}

/** Write a match result back onto the profile. Also resets the inactivity clock. */
export function applyMatchResult(profile: UserRankProfile, result: MMRUpdateResult, now: number = Date.now()): UserRankProfile {
  return {
    ...profile,
    mmr: result.mmrAfter,
    rp: result.rpAfter,
    gamesPlayed: result.gamesPlayed,
    lastActiveAt: now,
    protectionGamesLeft: result.protectionGamesLeft,
    shieldTier: result.shieldTier,
    lastDecayAt: null,
  }
}

// ---------------------------------------------------------------------------
// Inactivity decay
// ---------------------------------------------------------------------------

/**
 * Charge inactivity decay up to `now`. Pure and IDEMPOTENT — call it as often as you like (on login,
 * from a daily job, when rendering the leaderboard); each full day is only ever charged once.
 *
 *   decay starts after:  lastActiveAt + graceDays
 *   chargeable days   :  floor((now - max(decayStart, lastDecayAt)) / 24h)
 *   new RP            :  max(floor, rp - rpPerDay * days)
 *
 * Master: 3 grace days, -50/day, floor 3000 · Diamond: 7, -25, 2500 · Platinum: 14, -10, 2000.
 * Each floor is the tier's own minimum, so decay can never demote. Gold and below do not decay.
 * Only RP decays — the hidden MMR is left alone (skill does not rust, the visible rank does).
 * The Demotion Shield is irrelevant here: the floor already guarantees no demotion.
 */
export function applyDemotionDecay(user: UserRankProfile, now: number = Date.now()): UserRankProfile {
  const rule = DECAY_RULES[calculateTier(user.rp).id]
  if (!rule || !Number.isFinite(now) || !Number.isFinite(user.lastActiveAt) || now <= user.lastActiveAt) {
    return { ...user }
  }

  const decayStart = user.lastActiveAt + rule.graceDays * DAY_MS
  const chargedFrom = Math.max(decayStart, user.lastDecayAt ?? 0)
  const days = Math.floor((now - chargedFrom) / DAY_MS)
  if (days <= 0) return { ...user }

  return {
    ...user,
    rp: Math.max(rule.floor, user.rp - rule.rpPerDay * days),
    lastDecayAt: chargedFrom + days * DAY_MS, // only whole days are consumed; the remainder carries over
  }
}

// ===========================================================================
// LEGACY / APP-COMPAT SECTION
// Everything below is the pre-existing API that components/multiplayer-battle.tsx, ranked-panel.tsx,
// snake-profile.tsx etc. still import. It is unchanged except that Elo is no longer capped at 3000
// (Master is open-ended). New code should use calculateMatchRankings() instead of computeEloChanges().
// ===========================================================================

export const ELO_START = 1000
export const ELO_MIN = 0
/** @deprecated RP is open-ended above Master; this is only a sanity ceiling. */
export const ELO_MAX = RP_MAX
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
