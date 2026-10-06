// server/ranked-store.ts — where the SERVER keeps ranked ratings (Firebase RTDB `ranked/{uid}`).
//
// v23: the game server is the only writer of ranked records. It uses the Firebase Admin SDK, which
// bypasses the database security rules (so firebase-rules.json can lock `ranked/{uid}` for clients).
//
// RoomManager only sees the tiny `RankedStore` interface, so the whole ranked flow is unit-testable with
// `MemoryRankedStore` (scripts/net-selftest.ts) and no Firebase at all.
import { loadRankProfile, type RankProfileBundle } from "../lib/ranked-profile"

/** A record exactly as stored at ranked/{uid}, without `updatedAt` (the store adds the server time). */
export type RankedRecordData = Record<string, number | string | null>

export interface RankedStore {
  /** Current ratings (inactivity decay applied). A player who never played ranked gets a fresh 1000/1000 profile. */
  fetchProfiles(uids: string[], now: number): Promise<Record<string, RankProfileBundle>>
  /** Save several players in ONE atomic multi-path update. Rejects when the write failed. */
  writeResults(records: Record<string, RankedRecordData>): Promise<void>
}

// ---------------------------------------------------------------------------
// Firebase Admin implementation
// ---------------------------------------------------------------------------

/** The slice of firebase-admin's Database we use (structural, so this file needs no SDK types). */
export interface AdminDbLike {
  ref(path?: string): {
    get(): Promise<{ exists(): boolean; val(): unknown }>
    update(values: Record<string, unknown>): Promise<void>
  }
}

export class AdminRankedStore implements RankedStore {
  /** @param serverTimestamp admin.database.ServerValue.TIMESTAMP */
  constructor(
    private readonly db: AdminDbLike,
    private readonly serverTimestamp: unknown,
  ) {}

  async fetchProfiles(uids: string[], now: number): Promise<Record<string, RankProfileBundle>> {
    const snaps = await Promise.all(uids.map((u) => this.db.ref(`ranked/${u}`).get()))
    const out: Record<string, RankProfileBundle> = {}
    uids.forEach((u, i) => {
      out[u] = loadRankProfile(u, snaps[i].exists() ? snaps[i].val() : null, now)
    })
    return out
  }

  async writeResults(records: Record<string, RankedRecordData>): Promise<void> {
    const updates: Record<string, unknown> = {}
    for (const [uid, rec] of Object.entries(records)) updates[`ranked/${uid}`] = { ...rec, updatedAt: this.serverTimestamp }
    if (Object.keys(updates).length === 0) return
    await this.db.ref().update(updates)
  }
}

// ---------------------------------------------------------------------------
// In-memory implementation (tests, and a handy fake for local experiments)
// ---------------------------------------------------------------------------

export class MemoryRankedStore implements RankedStore {
  /** uid -> raw record, as the database would hold it */
  readonly data = new Map<string, RankedRecordData>()
  /** every writeResults() call, in order */
  readonly writes: Record<string, RankedRecordData>[] = []
  /** test switches */
  failReads = false
  failWrites = false
  /** artificial delay (ms) before a read resolves — lets tests prove "ratings are snapshotted at match start" */
  readDelayMs = 0

  async fetchProfiles(uids: string[], now: number): Promise<Record<string, RankProfileBundle>> {
    if (this.readDelayMs > 0) await new Promise((r) => setTimeout(r, this.readDelayMs))
    if (this.failReads) throw new Error("memory store: read failed")
    const out: Record<string, RankProfileBundle> = {}
    for (const u of uids) out[u] = loadRankProfile(u, this.data.get(u) ?? null, now)
    return out
  }

  async writeResults(records: Record<string, RankedRecordData>): Promise<void> {
    if (this.failWrites) throw new Error("memory store: write failed")
    this.writes.push(JSON.parse(JSON.stringify(records)))
    for (const [uid, rec] of Object.entries(records)) this.data.set(uid, { ...rec })
  }
}
