"use client"
import { useEffect, useMemo, useState } from "react"
import {
  get, limitToLast, onValue, push, query, ref, remove, runTransaction, serverTimestamp, set,
} from "firebase/database"
import { getFirebaseDb } from "./firebase"
import { findPlayerByCode } from "./friends"
import { applyReward } from "./store"

/**
 * Mailbox = news + gifts from the admin.
 *  - `news/{id}`          broadcast to EVERY player (admin writes, signed-in players read)
 *  - `mailbox/{uid}/{id}` personal mail to ONE player (admin writes, only that player reads)
 * Read / claimed state lives in the player's own private node `users/{uid}/mailState/{key}`,
 * so the admin never touches player data. A reward can be claimed only once: the claim flips
 * `claimed` with a transaction and the coins/gems are credited only if that flip succeeded.
 */
export interface MailItem {
  /** unique key: "b_<id>" (broadcast) or "p_<id>" (personal) */
  key: string
  id: string
  scope: "all" | "me"
  title: string
  body: string
  coins: number
  gems: number
  /** VIP Pass days gifted (0 = none) */
  vipDays: number
  /** store item ids gifted (skins, trails, food, avatars) */
  items: string[]
  at: number
  read: boolean
  claimed: boolean
}

interface RawMail { title?: unknown; body?: unknown; coins?: unknown; gems?: unknown; vipDays?: unknown; items?: unknown; at?: unknown }
interface MailState { read?: boolean; claimed?: boolean }

const MAX_KEEP = 60
export const MAX_MAIL_ITEMS = 12
const ID_RE = /^[a-z0-9_]{1,48}$/
const itemIds = (v: unknown): string[] =>
  v && typeof v === "object" ? Object.keys(v as Record<string, unknown>).filter((k) => ID_RE.test(k)).slice(0, MAX_MAIL_ITEMS) : []
/** true when the mail carries any reward the player has to claim */
export const hasReward = (m: { coins: number; gems: number; vipDays: number; items: string[] }) => m.coins > 0 || m.gems > 0 || m.vipDays > 0 || m.items.length > 0
const num = (v: unknown, max = 100_000_000) => Math.max(0, Math.min(max, Math.floor(Number(v) || 0)))
const db = () => getFirebaseDb()

function clean(scope: "all" | "me", id: string, v: unknown, st: MailState | undefined): MailItem | null {
  if (!v || typeof v !== "object") return null
  const r = v as RawMail
  const title = typeof r.title === "string" ? r.title.trim().slice(0, 80) : ""
  if (!title) return null
  return {
    key: `${scope === "all" ? "b" : "p"}_${id}`,
    id,
    scope,
    title,
    body: typeof r.body === "string" ? r.body.trim().slice(0, 600) : "",
    coins: num(r.coins),
    gems: num(r.gems),
    vipDays: num(r.vipDays, 365),
    items: itemIds(r.items),
    at: Number(r.at) || 0,
    read: !!st?.read,
    claimed: !!st?.claimed,
  }
}

// --------------------------------------------------------------- player side
/** Live mailbox of the signed-in player (news + personal), newest first, with unread / claimable counts. */
export function useMailbox(uid: string | null | undefined) {
  const [news, setNews] = useState<Record<string, unknown>>({})
  const [mine, setMine] = useState<Record<string, unknown>>({})
  const [state, setState] = useState<Record<string, MailState>>({})

  useEffect(() => {
    if (!uid) { setNews({}); setMine({}); setState({}); return }
    const offs = [
      onValue(query(ref(db(), "news"), limitToLast(MAX_KEEP)), (s) => setNews((s.val() as Record<string, unknown>) || {}), () => {}),
      onValue(query(ref(db(), `mailbox/${uid}`), limitToLast(MAX_KEEP)), (s) => setMine((s.val() as Record<string, unknown>) || {}), () => {}),
      onValue(ref(db(), `users/${uid}/mailState`), (s) => setState((s.val() as Record<string, MailState>) || {}), () => {}),
    ]
    return () => offs.forEach((o) => o())
  }, [uid])

  const items = useMemo(() => {
    const out: MailItem[] = []
    for (const [id, v] of Object.entries(news)) { const m = clean("all", id, v, state[`b_${id}`]); if (m) out.push(m) }
    for (const [id, v] of Object.entries(mine)) { const m = clean("me", id, v, state[`p_${id}`]); if (m) out.push(m) }
    return out.sort((a, b) => b.at - a.at)
  }, [news, mine, state])

  const claimable = items.filter((m) => hasReward(m) && !m.claimed).length
  // badge = everything the player has not opened yet, plus rewards still waiting to be claimed
  const badge = items.filter((m) => !m.read || (hasReward(m) && !m.claimed)).length
  return { items, badge, claimable }
}

export async function markMailRead(uid: string, keys: string[]): Promise<void> {
  await Promise.all(keys.map((k) => set(ref(db(), `users/${uid}/mailState/${k}/read`), true).catch(() => {})))
}

/** Human readable summary of a reward, e.g. "1,000 coins + 50 gems + VIP 30 din + 2 items". */
export function rewardText(r: { coins: number; gems: number; vipDays: number; items: string[] }): string {
  return [
    r.coins ? `${r.coins.toLocaleString()} coins` : "",
    r.gems ? `${r.gems.toLocaleString()} gems` : "",
    r.vipDays ? `VIP ${r.vipDays} din` : "",
    r.items.length ? `${r.items.length} item${r.items.length > 1 ? "s" : ""}` : "",
  ].filter(Boolean).join(" + ")
}

/** Claim the reward of one mail. Credited ONCE, even with two devices / double taps. */
export async function claimMail(uid: string, m: MailItem): Promise<{ ok: boolean; msg: string }> {
  if (!hasReward(m)) return { ok: false, msg: "Is mail me koi reward nahi hai" }
  try {
    const res = await runTransaction(ref(db(), `users/${uid}/mailState/${m.key}/claimed`), (cur) => (cur === true ? undefined : true))
    if (!res.committed) return { ok: false, msg: "Reward pehle hi le liya" }
    applyReward({ coins: m.coins, gems: m.gems, vipDays: m.vipDays, items: m.items })
    set(ref(db(), `users/${uid}/mailState/${m.key}/read`), true).catch(() => {})
    return { ok: true, msg: `🎁 ${rewardText(m)} mil gaye!` }
  } catch {
    return { ok: false, msg: "Claim nahi hua — internet check karo" }
  }
}

export async function claimAllMail(uid: string, items: MailItem[]): Promise<{ ok: boolean; msg: string }> {
  const sum = { coins: 0, gems: 0, vipDays: 0, items: [] as string[] }
  for (const m of items.filter((x) => hasReward(x) && !x.claimed)) {
    try {
      const res = await runTransaction(ref(db(), `users/${uid}/mailState/${m.key}/claimed`), (cur) => (cur === true ? undefined : true))
      if (res.committed) { sum.coins += m.coins; sum.gems += m.gems; sum.vipDays += m.vipDays; sum.items.push(...m.items) }
    } catch { /* skip this one */ }
  }
  if (!hasReward(sum)) return { ok: false, msg: "Claim karne ko kuch nahi hai" }
  applyReward(sum)
  return { ok: true, msg: `🎁 ${rewardText({ ...sum, items: Array.from(new Set(sum.items)) })} mil gaye!` }
}

// --------------------------------------------------------------- admin side
export interface MailDraft { title: string; body: string; coins: number; gems: number; vipDays: number; items: string[] }

function payload(d: MailDraft) {
  const ids = Array.from(new Set(d.items.filter((i) => ID_RE.test(i)))).slice(0, MAX_MAIL_ITEMS)
  return {
    title: d.title.trim().slice(0, 80),
    body: d.body.trim().slice(0, 600),
    coins: num(d.coins),
    gems: num(d.gems),
    ...(num(d.vipDays, 365) > 0 ? { vipDays: num(d.vipDays, 365) } : {}),
    ...(ids.length ? { items: Object.fromEntries(ids.map((i) => [i, true])) } : {}),
    at: serverTimestamp(),
  }
}

/** Admin → one player (by 8-char Player ID). */
export async function sendMailToPlayer(playerCode: string, d: MailDraft): Promise<{ ok: boolean; msg: string }> {
  if (!d.title.trim()) return { ok: false, msg: "Title likho" }
  const prof = await findPlayerByCode(playerCode)
  if (!prof) return { ok: false, msg: "Player ID nahi mila" }
  await set(push(ref(db(), `mailbox/${prof.uid}`)), payload(d))
  return { ok: true, msg: `${prof.name} (${prof.pid}) ko mail bhej diya` }
}

/** Admin → every player (news / announcement, optionally with a reward each player claims once). */
export async function sendNewsToAll(d: MailDraft): Promise<{ ok: boolean; msg: string }> {
  if (!d.title.trim()) return { ok: false, msg: "Title likho" }
  await set(push(ref(db(), "news")), payload(d))
  return { ok: true, msg: "Sabhi players ko news bhej di" }
}

export interface NewsRow { id: string; title: string; coins: number; gems: number; vipDays: number; items: string[]; at: number }

export async function listNews(): Promise<NewsRow[]> {
  const snap = await get(query(ref(db(), "news"), limitToLast(MAX_KEEP)))
  const v = (snap.val() as Record<string, RawMail>) || {}
  return Object.entries(v)
    .map(([id, r]) => ({ id, title: String(r.title || ""), coins: num(r.coins), gems: num(r.gems), vipDays: num(r.vipDays, 365), items: itemIds(r.items), at: Number(r.at) || 0 }))
    .filter((n) => n.title)
    .sort((a, b) => b.at - a.at)
}

export async function deleteNews(id: string): Promise<void> {
  await remove(ref(db(), `news/${id}`))
}
