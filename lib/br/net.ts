// lib/br/net.ts — Firebase side of Battle Royale (host-authoritative parts).
//
//   rooms/{CODE}/game/zone  = { seed, startAt }        written once by the host at match start
//   rooms/{CODE}/game/foods = { [id]: {x, y} }         many foods; host tops them up, players claim them
//   rooms/{CODE}/game/endedAt = server ms              written by whoever detects "last snake standing"
//
// Everything that has to be shared is either written once (zone) or protected by a transaction (food claim),
// so there is no per-tick host traffic.
import { get, ref, runTransaction, update } from "firebase/database"
import { getFirebaseDb } from "../firebase"
import type { MpPlayer, MpRoom } from "../multiplayer"
import { BR_FOOD_TARGET, BR_GRID, BR_DROP_EVERY, BR_MAX_PLAYERS, BR_MIN_PLAYERS } from "./constants"
import { isInsideZone, randomCellInBox, type ZoneBox, type ZoneState } from "./zone"
import type { Cell } from "./interpolation"

export interface BrZoneRecord {
  seed: number
  /** server time (ms) when the match (and the zone clock) starts */
  startAt: number
}

export type BrFoods = Record<string, Cell>

const db = () => getFirebaseDb()
const roomPath = (code: string) => `rooms/${code}`
export const foodsRef = (code: string) => ref(db(), `${roomPath(code)}/game/foods`)

/** Server-clock offset (ms) — add to Date.now() to get server time. */
export async function fetchServerOffset(): Promise<number> {
  try {
    const snap = await get(ref(db(), ".info/serverTimeOffset"))
    return Number(snap.val()) || 0
  } catch {
    return 0
  }
}

const newFoodId = () => `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`

function makeFoods(count: number, box: ZoneBox, taken: Set<string> = new Set()): BrFoods {
  const out: BrFoods = {}
  let guard = count * 8
  while (Object.keys(out).length < count && guard-- > 0) {
    const c = randomCellInBox(box)
    const key = `${c.x},${c.y}`
    if (taken.has(key)) continue
    taken.add(key)
    out[newFoodId()] = c
  }
  return out
}

/** Host starts a Battle Royale match: zone clock, first foods, reset stats, shared countdown. */
export async function startBattleRoyale(code: string, room: Omit<MpRoom, "code">): Promise<void> {
  const players = Object.values(room.players ?? {}) as MpPlayer[]
  if (players.length < BR_MIN_PLAYERS) throw new Error(`Battle Royale needs at least ${BR_MIN_PLAYERS} players`)
  if (players.length > BR_MAX_PLAYERS) throw new Error(`Battle Royale supports up to ${BR_MAX_PLAYERS} players`)

  const offset = await fetchServerOffset()
  const startAt = Date.now() + offset + 3000 // 3 s countdown, in SERVER time
  const zone: BrZoneRecord = { seed: Math.floor(Math.random() * 2 ** 31), startAt }
  const world: ZoneBox = { minX: 0, minY: 0, maxX: BR_GRID - 1, maxY: BR_GRID - 1 }

  const updates: Record<string, unknown> = {
    status: "countdown",
    "game/countdownEndsAt": startAt,
    "game/zone": zone,
    // fixed seat order (so every client picks the same spawn even if someone drops during the countdown)
    "game/order": [...players].sort((a, b) => (a.joinedAt ?? 0) - (b.joinedAt ?? 0)).map((p) => p.id),
    "game/foods": makeFoods(BR_FOOD_TARGET, world),
    "game/food": null,
    "game/winner": null,
    "game/endedAt": null,
    "game/killFeed": null,
    autoStartAt: null,
    snakes: null,
  }
  for (const p of players) {
    updates[`players/${p.id}/alive`] = true
    updates[`players/${p.id}/score`] = 0
    updates[`players/${p.id}/kills`] = 0
    updates[`players/${p.id}/diedAt`] = null
  }
  await update(ref(db(), roomPath(code)), updates)
  await update(ref(db(), "publicLobby"), { [code]: null }).catch(() => {})
}

/**
 * Claim a food exactly once. Two snakes reaching the same food in the same tick -> only one transaction
 * sees it still there, the other gets `false` and does not grow.
 */
export async function claimFood(code: string, foodId: string): Promise<boolean> {
  let existed = false
  try {
    const res = await runTransaction(ref(db(), `${roomPath(code)}/game/foods/${foodId}`), (cur) => {
      existed = cur !== null && cur !== undefined
      return null // delete it (a no-op if it was already gone)
    })
    return res.committed && existed
  } catch {
    return false
  }
}

/**
 * HOST ONLY, ~1x per second. Keeps ~BR_FOOD_TARGET foods on the map inside the safe area and removes
 * foods that fell outside the (settled) zone so nobody dies chasing bait.
 */
export async function hostMaintainFood(code: string, foods: BrFoods, zone: ZoneState, occupied: Set<string>): Promise<void> {
  const updates: Record<string, unknown> = {}
  const keep: BrFoods = {}
  for (const [id, c] of Object.entries(foods)) {
    if (!zone.shrinking && !isInsideZone(zone.box, c.x, c.y)) updates[`game/foods/${id}`] = null
    else keep[id] = c
  }
  // fewer foods as the safe area shrinks, so a tiny zone is not carpeted with food
  const area = (zone.box.maxX - zone.box.minX + 1) * (zone.box.maxY - zone.box.minY + 1)
  const target = Math.max(8, Math.min(BR_FOOD_TARGET, Math.round(area / 120)))
  const missing = Math.min(12, target - Object.keys(keep).length)
  if (missing > 0) {
    const spawnBox = zone.warning && zone.target ? zone.target : zone.box
    const taken = new Set(occupied)
    for (const c of Object.values(keep)) taken.add(`${c.x},${c.y}`)
    for (const [id, c] of Object.entries(makeFoods(missing, spawnBox, taken))) updates[`game/foods/${id}`] = c
  }
  if (Object.keys(updates).length > 0) await update(ref(db(), roomPath(code)), updates)
}

/** The victim's client turns the corpse into food (every Nth segment, only inside the safe area). */
export async function dropFoodFromBody(code: string, seg: Cell[], box: ZoneBox): Promise<void> {
  const updates: Record<string, unknown> = {}
  for (let i = 0; i < seg.length; i += BR_DROP_EVERY) {
    const c = seg[i]
    if (isInsideZone(box, c.x, c.y)) updates[`game/foods/${newFoodId()}`] = { x: c.x, y: c.y }
  }
  if (Object.keys(updates).length > 0) await update(ref(db(), roomPath(code)), updates)
}
