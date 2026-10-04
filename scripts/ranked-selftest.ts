// scripts/ranked-selftest.ts — zero-sum / shield / decay self-test for lib/ranked.ts
// Run:  npx tsx scripts/ranked-selftest.ts   (prints "ALL TESTS PASSED" on success)
import * as R from "../lib/ranked"
import assert from "node:assert"
let seed = 12345
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296)
const ri = (a: number, b: number) => Math.floor(a + rnd() * (b - a + 1))

let shieldHits = 0, floorHits = 0, promos = 0, tieRuns = 0
for (let it = 0; it < 20000; it++) {
  const n = ri(3, 8)
  const rpBase = [0, 50, 990, 1000, 1480, 2490, 2990, 3000, 3500][ri(0, 8)]
  const players: R.RankedPlayer[] = []
  let killsLeft = n - 1
  for (let i = 0; i < n; i++) {
    const k = ri(0, Math.min(killsLeft, 3)); killsLeft -= k
    const rp = Math.max(0, rpBase + ri(-60, 60))
    players.push({
      uid: "u" + i, mmr: Math.max(0, rpBase + ri(-300, 300)), rp, gamesPlayed: ri(0, 12),
      placement: rnd() < 0.2 ? ri(1, n) : i + 1, // sometimes ties
      kills: k, peakMass: ri(3, 60),
      protectionGamesLeft: rnd() < 0.4 ? ri(1, 3) : 0,
      shieldTier: rnd() < 0.5 ? R.calculateTier(rp).id : undefined,
    })
  }
  const res = R.calculateMatchRankings(players)
  assert.strictEqual(res.reduce((a, r) => a + r.rpDelta, 0), 0, "rp zero-sum")
  assert.strictEqual(res.reduce((a, r) => a + r.mmrDelta, 0), 0, "mmr zero-sum")
  res.forEach((r, i) => {
    const p = players[i]
    assert(Number.isInteger(r.rpDelta) && Number.isInteger(r.mmrDelta))
    assert(r.rpAfter >= 0 && r.mmrAfter >= 0)
    assert(Math.abs(r.rpDelta) <= r.kFactorRP, `K cap ${r.rpDelta} ${r.kFactorRP}`)
    assert(Math.abs(r.mmrDelta) <= r.kFactorMMR)
    // shield: never drops below the protected tier's minimum
    if ((p.protectionGamesLeft ?? 0) > 0) {
      const id = p.shieldTier ?? R.calculateTier(p.rp).id
      const min = Math.min(p.rp, R.TIERS.find(t => t.id === id)!.min)
      assert(r.rpAfter >= min, "shield floor")
      if (r.shieldTriggered) shieldHits++
    }
    if (r.rpProtected > 0 && r.rpAfter === 0) floorHits++
    if (r.promoted) { promos++; assert.strictEqual(r.protectionGamesLeft, 3) }
    if (r.demoted) assert.strictEqual(r.protectionGamesLeft, 0)
  })
  // order independence
  const rev = R.calculateMatchRankings([...players].reverse()).reverse()
  assert.deepStrictEqual(rev.map(r => [r.rpDelta, r.mmrDelta]), res.map(r => [r.rpDelta, r.mmrDelta]), "order independent")
  // winner (unique 1st, no tie) shouldn't lose when it's an even lobby and nothing weird
  if (new Set(players.map(p => p.placement)).size < n) tieRuns++
}
console.log({ shieldHits, floorHits, promos, tieRuns })

// --- sanity: expected placement direction & example lobby
const lobby: R.RankedPlayer[] = [
  { uid: "pro", mmr: 1800, rp: 1800, gamesPlayed: 50, placement: 1, kills: 2, peakMass: 40 },
  { uid: "mid", mmr: 1200, rp: 1200, gamesPlayed: 50, placement: 2, kills: 1, peakMass: 30 },
  { uid: "mid2", mmr: 1200, rp: 1200, gamesPlayed: 50, placement: 3, kills: 0, peakMass: 25 },
  { uid: "new", mmr: 1000, rp: 1000, gamesPlayed: 1, placement: 4, kills: 0, peakMass: 10 },
]
const out = R.calculateMatchRankings(lobby)
console.table(out.map(r => ({ uid: r.uid, E: +r.expectedPlacement.toFixed(2), perf: +r.performance.composite.toFixed(2), kRP: r.kFactorRP, rpΔ: r.rpDelta, mmrΔ: r.mmrDelta })))
assert(out[0].expectedPlacement < out[3].expectedPlacement, "strongest has best (lowest) expected placement")

// upset: weakest wins
const up = R.calculateMatchRankings(lobby.map((p, i) => ({ ...p, placement: 4 - i, kills: [0,0,1,2][i], peakMass: [10,25,30,40][i] })))
console.log("upset deltas", up.map(r => `${r.uid}:${r.rpDelta}`).join(" "))

// ties
const tie = R.calculateMatchRankings(lobby.map((p, i) => ({ ...p, placement: i < 2 ? 1 : 3 })))
assert.strictEqual(tie[0].effectivePlacement, 1.5); assert.strictEqual(tie[2].effectivePlacement, 3.5)

// inconsistent kills are neutralised & flagged; garbage input repaired
const cheat = R.calculateMatchRankings(lobby.map((p, i) => ({ ...p, kills: i === 3 ? 99 : 0 })))
assert(cheat[3].flags.includes("kills_inconsistent")); assert.strictEqual(cheat[3].performance.kills, 0.5)
const junk = R.calculateMatchRankings(lobby.map((p, i) => i === 0 ? { ...p, mmr: NaN, kills: -5, peakMass: Infinity } : p))
assert(junk[0].flags.includes("input_sanitized"))
assert.throws(() => R.calculateMatchRankings(lobby.slice(0, 2)), RangeError)
assert.throws(() => R.calculateMatchRankings([lobby[0], lobby[0], lobby[1]]))

// tiers
const edge: [number, R.TierId][] = [[0,"bronze"],[999,"bronze"],[1000,"silver"],[1499,"silver"],[1500,"gold"],[1999,"gold"],[2000,"platinum"],[2499,"platinum"],[2500,"diamond"],[2999,"diamond"],[3000,"master"],[9000,"master"],[-5,"bronze"],[NaN,"bronze"]]
for (const [rp, id] of edge) assert.strictEqual(R.calculateTier(rp).id, id, String(rp))
assert.strictEqual(R.calculateTier(3000).max, null); assert.strictEqual(R.calculateTier(2000).max, 2499)

// decay
const D = 86400000, t0 = 1_700_000_000_000
const prof = (rp: number): R.UserRankProfile => ({ ...R.createRankProfile("x", t0), rp, mmr: rp })
const dec = (rp: number, days: number, p = prof(rp)) => R.applyDemotionDecay(p, t0 + days * D)
assert.strictEqual(dec(3200, 3).rp, 3200)            // grace
assert.strictEqual(dec(3200, 3.99).rp, 3200)
assert.strictEqual(dec(3200, 4).rp, 3150)            // first day after grace
assert.strictEqual(dec(3200, 100).rp, 3000)          // floor
assert.strictEqual(dec(2600, 7).rp, 2600); assert.strictEqual(dec(2600, 8).rp, 2575); assert.strictEqual(dec(2600, 400).rp, 2500)
assert.strictEqual(dec(2100, 14).rp, 2100); assert.strictEqual(dec(2100, 15).rp, 2090); assert.strictEqual(dec(2100, 999).rp, 2000)
assert.strictEqual(dec(1900, 999).rp, 1900); assert.strictEqual(dec(500, 999).rp, 500)  // gold & below never decay
assert.strictEqual(dec(3200, 100).mmr, 3200)         // MMR untouched
// idempotent + incremental == one-shot
const a = dec(3400, 6); const a2 = R.applyDemotionDecay(a, t0 + 6 * D); assert.deepStrictEqual(a, a2)
const stepped = R.applyDemotionDecay(R.applyDemotionDecay(prof(3400), t0 + 5 * D), t0 + 9.5 * D)
assert.deepStrictEqual(stepped.rp, dec(3400, 9.5).rp)
// playing resets the clock
const played = R.applyMatchResult(a, out[0], t0 + 6 * D); assert.strictEqual(played.lastDecayAt, null)
assert.strictEqual(R.applyDemotionDecay(played, t0 + 9 * D).rp, played.rp)
// input not mutated
const frozen = Object.freeze(prof(3300)); R.applyDemotionDecay(frozen, t0 + 50 * D)
console.log("ALL TESTS PASSED")
