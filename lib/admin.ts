"use client"
import { useEffect, useState } from "react"
import { get, ref, set, update, remove } from "firebase/database"
import { getFirebaseDb } from "./firebase"
import { playerCodeOf, normalizePlayerCode, findPlayerByCode } from "./friends"
import { useAuthUser } from "./auth"
import type { StoreItem, CatalogOverride } from "./store"

/**
 * Admin system.
 * - BOOTSTRAP_ADMIN_PIDS: these Player IDs are always admins (no DB entry needed).
 * - Extra admins live in RTDB `admins/{uid} = true` and can be managed from the panel.
 * - The same check exists in firebase-rules.json for `storeConfig`, `grants`, `admins`.
 */
export const BOOTSTRAP_ADMIN_PIDS = ["IOXN75FA"]

export const isBootstrapAdminPid = (pid?: string | null): boolean =>
  !!pid && BOOTSTRAP_ADMIN_PIDS.includes(normalizePlayerCode(pid))

export async function fetchIsAdmin(uid: string, pid?: string | null): Promise<boolean> {
  if (isBootstrapAdminPid(pid)) return true
  try {
    const snap = await get(ref(getFirebaseDb(), `admins/${uid}`))
    return snap.val() === true
  } catch {
    return false
  }
}

/** True when the signed-in player is an admin. UI gating only — rules enforce it server-side. */
export function useIsAdmin(): boolean {
  const { user } = useAuthUser()
  const [isAdmin, setIsAdmin] = useState(false)
  useEffect(() => {
    let on = true
    if (!user) {
      setIsAdmin(false)
      return
    }
    fetchIsAdmin(user.uid, playerCodeOf(user.uid)).then((v) => {
      if (on) setIsAdmin(v)
    })
    return () => {
      on = false
    }
  }, [user?.uid])
  return isAdmin
}

// ------------------------- admin list management -------------------------
export interface AdminEntry { uid: string; pid: string }

export async function listAdmins(): Promise<AdminEntry[]> {
  const snap = await get(ref(getFirebaseDb(), "admins"))
  const v = snap.val() || {}
  return Object.keys(v)
    .filter((k) => v[k] === true)
    .map((uid) => ({ uid, pid: playerCodeOf(uid) }))
}

export async function addAdminByCode(playerCode: string): Promise<{ ok: boolean; msg: string }> {
  const prof = await findPlayerByCode(playerCode)
  if (!prof) return { ok: false, msg: "Player ID nahi mila" }
  if (isBootstrapAdminPid(prof.pid)) return { ok: true, msg: `${prof.pid} pehle se main admin hai` }
  await set(ref(getFirebaseDb(), `admins/${prof.uid}`), true)
  return { ok: true, msg: `${prof.name} (${prof.pid}) ab admin hai` }
}

export async function removeAdmin(uid: string): Promise<void> {
  await remove(ref(getFirebaseDb(), `admins/${uid}`))
}

// ------------------------- store catalog management -------------------------
const clean = (o: unknown) => JSON.parse(JSON.stringify(o))

/** Save a brand-new custom item (full definition). */
export async function saveCustomItem(item: StoreItem): Promise<void> {
  await update(ref(getFirebaseDb(), `storeConfig/items/${item.id}`), clean(item))
}

/** Save a partial override for a built-in item (only the given fields). */
export async function saveOverride(id: string, ov: CatalogOverride): Promise<void> {
  await update(ref(getFirebaseDb(), `storeConfig/overrides/${id}`), clean(ov))
}

/** Delete a custom item permanently. */
export async function deleteCustomItem(id: string): Promise<void> {
  await remove(ref(getFirebaseDb(), `storeConfig/items/${id}`))
}

/** Remove all overrides for a built-in item (back to the coded defaults). */
export async function clearOverride(id: string): Promise<void> {
  await remove(ref(getFirebaseDb(), `storeConfig/overrides/${id}`))
}

/** Hide (or unhide) any catalog item — built-in or custom. Hidden items leave the
 *  store/catalog but stay visible in the admin panel's "Hidden" tab with their count. */
export async function setItemHidden(id: string, hidden: boolean): Promise<void> {
  if (!/^[a-z0-9_]{1,48}$/.test(id)) throw new Error("Galat item id")
  await update(ref(getFirebaseDb(), `storeConfig/overrides/${id}`), hidden ? { disabled: true } : { disabled: null })
}

// ------------------------- item categories -------------------------
import type { Category } from "./store"

/** Create or rename an admin category (id must be unique). */
export async function saveCategory(cat: Category): Promise<void> {
  if (!/^[a-z0-9_]{1,40}$/.test(cat.id)) throw new Error("Galat category id")
  const name = cat.name.trim().slice(0, 30)
  if (!name) throw new Error("Naam likho")
  if (cat.kind !== "skin" && cat.kind !== "trail" && cat.kind !== "food" && cat.kind !== "avatar") throw new Error("Galat kind")
  await set(ref(getFirebaseDb(), `storeConfig/categories/${cat.id}`), { name, kind: cat.kind })
}

/** Delete an admin category. Items that listed it lose just that id (their other categories stay). */
export async function deleteCategory(id: string): Promise<void> {
  if (!/^[a-z0-9_]{1,40}$/.test(id)) throw new Error("Galat category id")
  const db = getFirebaseDb()
  await remove(ref(db, `storeConfig/categories/${id}`))
  // strip the id from every custom item / override that references it
  try {
    const snap = await dbGet(ref(db, "storeConfig"))
    const v = snap.val()
    if (!v || typeof v !== "object") return
    const jobs: Promise<void>[] = []
    for (const section of ["items", "overrides"] as const) {
      const m = (v as Record<string, unknown>)[section]
      if (!m || typeof m !== "object") continue
      for (const [k, raw] of Object.entries(m as Record<string, unknown>)) {
        if (!raw || typeof raw !== "object") continue
        const r = raw as Record<string, unknown>
        const patch: Record<string, unknown> = {}
        if (Array.isArray(r.categories) && (r.categories as unknown[]).includes(id)) {
          const rest = (r.categories as unknown[]).filter((c) => c !== id)
          patch.categories = rest.length ? rest : null // null deletes the key
        }
        if (r.category === id) patch.category = null // legacy single field
        if (Object.keys(patch).length) jobs.push(update(ref(db, `storeConfig/${section}/${k}`), patch).then(() => undefined))
      }
    }
    await Promise.all(jobs)
  } catch { /* category itself is already deleted; item cleanup is best-effort */ }
}

// ------------------------- player search (mail recipients) -------------------------
import { get as dbGet, limitToFirst, orderByChild, query as dbQuery } from "firebase/database"
import type { PublicProfile } from "./friends"

const cleanProfile = (uid: string, v: unknown): PublicProfile | null => {
  if (!v || typeof v !== "object") return null
  const r = v as Record<string, unknown>
  const name = typeof r.name === "string" && r.name.trim() ? r.name.trim().slice(0, 40) : "Player"
  return {
    uid,
    name,
    photo: typeof r.photo === "string" ? r.photo : null,
    pid: typeof r.pid === "string" ? r.pid : "",
    best: Math.max(0, Math.floor(Number(r.best) || 0)),
    owned: Math.max(0, Math.floor(Number(r.owned) || 0)),
    vip: r.vip === true,
    avatar: typeof r.avatar === "string" ? r.avatar : "avatar_photo",
    createdAt: typeof r.createdAt === "number" ? r.createdAt : null,
  }
}

/**
 * Find players for the mail recipient picker: exact 8-char Player ID, or a
 * case-insensitive name / Player-ID substring search over public profiles.
 * Needs the admin read on `publicProfiles` (see firebase-rules.json).
 */
export async function searchPlayers(q: string): Promise<PublicProfile[]> {
  const needle = q.trim()
  if (needle.length < 2) return []
  // Exact Player ID → direct lookup (no full scan needed)
  if (/^[A-Z0-9]{8}$/i.test(needle)) {
    const p = await findPlayerByCode(needle).catch(() => null)
    return p ? [p] : []
  }
  const db = getFirebaseDb()
  const snap = await dbGet(dbQuery(ref(db, "publicProfiles"), orderByChild("name"), limitToFirst(400)))
  const v = snap.val()
  if (!v || typeof v !== "object") return []
  const low = needle.toLowerCase()
  const up = needle.toUpperCase()
  const out: PublicProfile[] = []
  for (const [uid, raw] of Object.entries(v as Record<string, unknown>)) {
    const p = cleanProfile(uid, raw)
    if (!p) continue
    if (p.name.toLowerCase().includes(low) || (p.pid && p.pid.toUpperCase().includes(up))) {
      out.push(p)
      if (out.length >= 20) break
    }
  }
  return out
}
