"use client"
import { onValue, ref, remove, serverTimestamp, set } from "firebase/database"
import { getFirebaseDb } from "./firebase"
import { findPlayerByCode } from "./friends"
import { creditCurrency } from "./store"

/**
 * Currency gifts: the admin writes `grants/{uid} = { coins, gems, at, by }`.
 * The player's own client picks it up (live, or on next login), credits the
 * exact amounts, and deletes the grant. Nobody can write another player's
 * `users/{uid}/game` node, so the queue keeps the owner-only rule intact.
 */
export interface Grant {
  coins: number
  gems: number
  at: number
  by: string
}

/** Admin → gift coins/gems to any player by their 8-char Player ID. */
export async function grantCurrency(
  adminUid: string,
  playerCode: string,
  coins: number,
  gems: number,
): Promise<{ ok: boolean; msg: string }> {
  const prof = await findPlayerByCode(playerCode)
  if (!prof) return { ok: false, msg: "Player ID nahi mila" }
  const c = Math.max(0, Math.min(100000000, Math.floor(coins || 0)))
  const g = Math.max(0, Math.min(100000000, Math.floor(gems || 0)))
  if (c === 0 && g === 0) return { ok: false, msg: "Coins ya gems me kuch to daalo" }
  await set(ref(getFirebaseDb(), `grants/${prof.uid}`), {
    coins: c,
    gems: g,
    at: serverTimestamp(),
    by: adminUid,
  })
  return { ok: true, msg: `${prof.name} (${prof.pid}) ko ${c.toLocaleString()} coins + ${g.toLocaleString()} gems bhej diya` }
}

/** Live listener: fires once for a pending grant (also on next login). */
export function subscribeGrants(uid: string, onGrant: (g: Grant) => void): () => void {
  return onValue(ref(getFirebaseDb(), `grants/${uid}`), (snap) => {
    const v = snap.val()
    if (!v || typeof v !== "object") return
    const coins = Math.max(0, Math.floor(Number(v.coins) || 0))
    const gems = Math.max(0, Math.floor(Number(v.gems) || 0))
    if (coins === 0 && gems === 0) return
    onGrant({ coins, gems, at: Number(v.at) || 0, by: String(v.by || "") })
  })
}

export async function consumeGrant(uid: string): Promise<void> {
  await remove(ref(getFirebaseDb(), `grants/${uid}`)).catch(() => {})
}

/** Apply a grant to the local wallet (exact amounts, cloud sync happens via the store subscription). */
export function applyGrant(g: Grant): void {
  creditCurrency(g.coins, g.gems)
}
