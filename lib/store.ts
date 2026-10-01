"use client"
import { useSyncExternalStore } from "react"
import { get, ref } from "firebase/database"
import { getFirebaseDb } from "./firebase"
import type { Shape } from "./shapes"
import { RANK_PASS_COINS, RANK_PASS_GEMS, rankPassesUpTo } from "./ranked"

export type Kind = "skin" | "trail" | "food" | "vip" | "avatar"
export type Currency = "coins" | "gems" | "inr"
export interface StoreItem {
  id: string
  kind: Kind
  name: string
  price: number
  currency: Currency
  featured?: boolean
  /** only usable while the VIP Pass is active (equipped item falls back to the default when VIP ends) */
  vipOnly?: boolean
  /** trails: particle shape (default "dot"), food: shape (default "star") */
  shape?: Shape
  /** skins: head colour + two alternating body colours + glow */
  head?: string
  a?: string
  b?: string
  glow?: string
  rainbow?: boolean
  /** trails / food: palette used for particles */
  palette?: string[]
  /** avatars: emoji + two background gradient colours, OR an image file under /avatars/ */
  emoji?: string
  bg?: [string, string]
  img?: string
  /** avatars: still picture shown everywhere except profile views (only for animated GIF avatars) */
  imgStill?: string
  /** avatars: GIF total play duration in ms (parsed from frame delays on upload; tap-to-play reverts to still after this) */
  imgMs?: number
  /** vip: pass duration in days (default 30) — editable from the admin panel */
  days?: number
  /** admin-made category ids (skins / trails / food / avatars) — an item can sit in several; store groups/filters by them */
  categories?: string[]
  /** @deprecated legacy single category — migrated into `categories` on load */
  category?: string
  /** schedule: item is shown in the store only between these timestamps (ms). Unset = always. */
  startAt?: number
  endAt?: number
}

export const ITEMS: StoreItem[] = [
  // ---------------------------------- Skins ----------------------------------
  { id: "skin_classic", kind: "skin", name: "Classic Green", price: 0, currency: "coins" },
  { id: "skin_solar", kind: "skin", name: "Solar Flare Skin", price: 49, currency: "inr", featured: true, head: "#ffb300", a: "#ff7a00", b: "#7cf000", glow: "#ff9f1a" },
  { id: "skin_mint", kind: "skin", name: "Mint Fresh", price: 400, currency: "coins", head: "#b9fbe0", a: "#34d399", b: "#a7f3d0", glow: "#34d399" },
  { id: "skin_bubblegum", kind: "skin", name: "Bubblegum", price: 600, currency: "coins", head: "#fbcfe8", a: "#f9a8d4", b: "#93c5fd", glow: "#f9a8d4" },
  { id: "skin_sunset", kind: "skin", name: "Sunset Blaze", price: 700, currency: "coins", head: "#ff9a5a", a: "#ff5e62", b: "#ffb347", glow: "#ff7a45" },
  { id: "skin_pumpkin", kind: "skin", name: "Pumpkin Night", price: 700, currency: "coins", head: "#fb923c", a: "#ea580c", b: "#1c1917", glow: "#f97316" },
  { id: "skin_toxic", kind: "skin", name: "Toxic Slime", price: 800, currency: "coins", head: "#b8ff3c", a: "#3aa300", b: "#0f5a00", glow: "#7cff00" },
  { id: "skin_sakura", kind: "skin", name: "Sakura Petal", price: 900, currency: "coins", head: "#ffd1e8", a: "#ff8fc0", b: "#ffc2dd", glow: "#ff8fc0" },
  { id: "skin_zebra", kind: "skin", name: "Zebra Stripe", price: 900, currency: "coins", head: "#ffffff", a: "#111827", b: "#f9fafb", glow: "#e5e7eb" },
  { id: "skin_royal", kind: "skin", name: "Royal Blue", price: 1000, currency: "coins", head: "#93c5fd", a: "#1e40af", b: "#3b82f6", glow: "#3b82f6" },
  { id: "skin_copper", kind: "skin", name: "Copper Coil", price: 1100, currency: "coins", head: "#fdba74", a: "#b45309", b: "#92400e", glow: "#f59e0b" },
  { id: "skin_neonpink", kind: "skin", name: "Neon Pink", price: 1200, currency: "coins", head: "#ff7ad9", a: "#e11d9b", b: "#ff9ce6", glow: "#ff2bd1" },
  { id: "skin_ruby", kind: "skin", name: "Ruby Viper", price: 1500, currency: "coins", head: "#ff5470", a: "#b3122f", b: "#ff7a90", glow: "#ff5470" },
  { id: "skin_lava", kind: "skin", name: "Lava Flow", price: 1800, currency: "coins", head: "#ffd166", a: "#e63900", b: "#7a1500", glow: "#ff4d00" },
  { id: "skin_midnight", kind: "skin", name: "Midnight Ninja", price: 2000, currency: "coins", head: "#94a3b8", a: "#0f172a", b: "#334155", glow: "#64748b" },
  { id: "skin_shadow", kind: "skin", name: "Shadow Coil", price: 2500, currency: "coins", head: "#c4b5fd", a: "#1f2937", b: "#4c1d95", glow: "#8b5cf6" },
  { id: "skin_bloodmoon", kind: "skin", name: "Blood Moon", price: 3000, currency: "coins", head: "#fecaca", a: "#7f1d1d", b: "#450a0a", glow: "#dc2626" },
  { id: "skin_emerald", kind: "skin", name: "Emerald Dragon", price: 250, currency: "gems", head: "#6ee7b7", a: "#047857", b: "#10b981", glow: "#10b981" },
  { id: "skin_frost", kind: "skin", name: "Arctic Frost", price: 300, currency: "gems", head: "#bae6fd", a: "#0ea5e9", b: "#7dd3fc", glow: "#38bdf8" },
  { id: "skin_thunder", kind: "skin", name: "Thunder Strike", price: 350, currency: "gems", head: "#fde047", a: "#facc15", b: "#1e1b4b", glow: "#fde047" },
  { id: "skin_galaxy", kind: "skin", name: "Galaxy Rider", price: 400, currency: "gems", head: "#e0c3ff", a: "#3b1d7a", b: "#1e3a8a", glow: "#a78bfa" },
  { id: "skin_ocean", kind: "skin", name: "Neon Ocean", price: 500, currency: "gems", head: "#38f5ff", a: "#1d4ed8", b: "#22d3ee", glow: "#22d3ee" },
  { id: "skin_aurora", kind: "skin", name: "Aurora", price: 500, currency: "gems", head: "#d9f99d", a: "#22d3ee", b: "#a3e635", glow: "#34d399" },
  { id: "skin_cyber", kind: "skin", name: "Cyber Grid", price: 600, currency: "gems", head: "#00fff0", a: "#0ea5e9", b: "#7c3aed", glow: "#00fff0" },
  { id: "skin_goldrush", kind: "skin", name: "Gold Rush", price: 600, currency: "gems", head: "#fff1a8", a: "#eab308", b: "#ca8a04", glow: "#facc15" },
  { id: "skin_firenice", kind: "skin", name: "Fire & Ice", price: 800, currency: "gems", head: "#ffffff", a: "#ef4444", b: "#38bdf8", glow: "#a78bfa" },
  { id: "skin_candy", kind: "skin", name: "Rainbow Candy", price: 1000, currency: "gems", head: "#f9a8d4", a: "#f472b6", b: "#60a5fa", glow: "#f0abfc", rainbow: true },
  { id: "skin_prism", kind: "skin", name: "Prism Rainbow", price: 1500, currency: "gems", head: "#ffffff", a: "#ffffff", b: "#ffffff", glow: "#ffffff", rainbow: true },
  // VIP-only skins (need an active VIP Pass)
  { id: "skin_vip", kind: "skin", name: "VIP Gold", price: 0, currency: "coins", vipOnly: true, head: "#ffd54a", a: "#f5b301", b: "#fbbf24", glow: "#ffd54a" },
  { id: "skin_vip_diamond", kind: "skin", name: "VIP Diamond", price: 0, currency: "coins", vipOnly: true, head: "#e0f7ff", a: "#67e8f9", b: "#ffffff", glow: "#67e8f9" },
  { id: "skin_vip_inferno", kind: "skin", name: "VIP Inferno", price: 0, currency: "coins", vipOnly: true, head: "#fff3b0", a: "#ff3d00", b: "#ffb300", glow: "#ff6d00" },
  { id: "skin_vip_phantom", kind: "skin", name: "VIP Phantom", price: 0, currency: "coins", vipOnly: true, head: "#f5d0fe", a: "#6d28d9", b: "#0f0a1f", glow: "#c026d3" },
  { id: "skin_vip_royal", kind: "skin", name: "VIP Royal Purple", price: 0, currency: "coins", vipOnly: true, head: "#f0abfc", a: "#7e22ce", b: "#d8b4fe", glow: "#c084fc" },
  { id: "skin_vip_prism", kind: "skin", name: "VIP Prism", price: 0, currency: "coins", vipOnly: true, head: "#ffffff", a: "#ffffff", b: "#ffffff", glow: "#fde68a", rainbow: true },

  // ---------------------------------- Food -----------------------------------
  { id: "food_classic", kind: "food", name: "Classic Berry", price: 0, currency: "coins" },
  { id: "food_orb", kind: "food", name: "Green Orb", price: 300, currency: "coins", palette: ["#86efac", "#16a34a"], shape: "dot" },
  { id: "food_ring", kind: "food", name: "Golden Donut", price: 500, currency: "coins", palette: ["#fcd34d", "#b45309"], shape: "ring" },
  { id: "food_heart", kind: "food", name: "Heart Candy", price: 600, currency: "coins", palette: ["#fb7185", "#be123c"], shape: "heart" },
  { id: "food_pumpkin", kind: "food", name: "Pumpkin", price: 700, currency: "coins", palette: ["#fb923c", "#9a3412"], shape: "dot" },
  { id: "food_star", kind: "food", name: "Star Food", price: 200, currency: "gems", featured: true, palette: ["#f0abfc", "#fb923c"] },
  { id: "food_moon", kind: "food", name: "Moon Star", price: 250, currency: "gems", palette: ["#e2e8f0", "#94a3b8"], shape: "star" },
  { id: "food_purple", kind: "food", name: "Purple Gem", price: 300, currency: "gems", palette: ["#c084fc", "#6b21a8"], shape: "diamond" },
  { id: "food_diamond", kind: "food", name: "Blue Diamond", price: 350, currency: "gems", palette: ["#7dd3fc", "#0284c7"], shape: "diamond" },
  { id: "food_gold", kind: "food", name: "Golden Apple", price: 500, currency: "gems", palette: ["#ffd54a", "#f59e0b"] },
  // VIP-only food
  { id: "food_vip_crown", kind: "food", name: "VIP Crown Gem", price: 0, currency: "coins", vipOnly: true, palette: ["#ffd54a", "#fff3b0"], shape: "diamond" },
  { id: "food_vip_heart", kind: "food", name: "VIP Royal Heart", price: 0, currency: "coins", vipOnly: true, palette: ["#f0abfc", "#7e22ce"], shape: "heart" },

  // ---------------------------------- Trails ---------------------------------
  { id: "trail_none", kind: "trail", name: "No Trail", price: 0, currency: "coins" },
  { id: "trail_lightning", kind: "trail", name: "Lightning", price: 300, currency: "gems", palette: ["#fef08a", "#93c5fd", "#ffffff"], shape: "diamond" },
  { id: "trail_pixel", kind: "trail", name: "Pixel Blocks", price: 400, currency: "coins", palette: ["#22c55e", "#eab308", "#ef4444", "#3b82f6"], shape: "square" },
  { id: "trail_ocean", kind: "trail", name: "Ocean Bubbles", price: 500, currency: "coins", palette: ["#67e8f9", "#38bdf8", "#a5f3fc"] },
  { id: "trail_star", kind: "trail", name: "Star Shower", price: 500, currency: "gems", palette: ["#fde047", "#fbbf24", "#fff7ae"], shape: "star" },
  { id: "trail_toxic", kind: "trail", name: "Toxic Cloud", price: 600, currency: "coins", palette: ["#a3e635", "#65a30d", "#bef264"] },
  { id: "trail_dust", kind: "trail", name: "Stardust", price: 600, currency: "coins", palette: ["#ffffff", "#fde68a", "#bae6fd"] },
  { id: "trail_ice", kind: "trail", name: "Ice Crystals", price: 700, currency: "coins", palette: ["#e0f2fe", "#7dd3fc", "#bae6fd"], shape: "diamond" },
  { id: "trail_ember", kind: "trail", name: "Embers", price: 700, currency: "coins", palette: ["#f97316", "#fb923c", "#fef08a"], shape: "square" },
  { id: "trail_hearts", kind: "trail", name: "Love Trail", price: 700, currency: "coins", palette: ["#fb7185", "#f472b6", "#fda4af"], shape: "heart" },
  { id: "trail_shadow", kind: "trail", name: "Shadow Smoke", price: 800, currency: "coins", palette: ["#94a3b8", "#475569", "#cbd5e1"] },
  { id: "trail_cosmic", kind: "trail", name: "Cosmic Trail", price: 800, currency: "gems", featured: true, palette: ["#a5f3fc", "#c4b5fd", "#f9a8d4"] },
  { id: "trail_rainbow", kind: "trail", name: "Rainbow Road", price: 900, currency: "gems", palette: ["#ef4444", "#f59e0b", "#eab308", "#22c55e", "#3b82f6", "#a855f7"] },
  { id: "trail_fire", kind: "trail", name: "Fire Trail", price: 1200, currency: "coins", palette: ["#ff5a1f", "#ffb020", "#ffe066"] },
  // VIP-only trails
  { id: "trail_vip_gold", kind: "trail", name: "VIP Golden Dust", price: 0, currency: "coins", vipOnly: true, palette: ["#ffd54a", "#fff3b0", "#f59e0b"], shape: "star" },
  { id: "trail_vip_aurora", kind: "trail", name: "VIP Aurora", price: 0, currency: "coins", vipOnly: true, palette: ["#34d399", "#22d3ee", "#a78bfa", "#f0abfc"], shape: "diamond" },
  { id: "trail_vip_hearts", kind: "trail", name: "VIP Royal Hearts", price: 0, currency: "coins", vipOnly: true, palette: ["#f0abfc", "#e879f9", "#ffffff"], shape: "heart" },

  // --------------------------------- Avatars ---------------------------------
  // Free avatars are usable by everyone. VIP avatars are usable while the VIP Pass is active
  // (no purchase step: see owns()). "avatar_photo" = the Google profile photo (default).
  { id: "avatar_photo", kind: "avatar", name: "Google Photo", price: 0, currency: "coins" },
  { id: "avatar_snake", kind: "avatar", name: "Snake", price: 0, currency: "coins", emoji: "🐍", bg: ["#34d399", "#059669"] },
  { id: "avatar_apple", kind: "avatar", name: "Red Apple", price: 0, currency: "coins", emoji: "🍎", bg: ["#fb7185", "#be123c"] },
  { id: "avatar_frog", kind: "avatar", name: "Frog", price: 0, currency: "coins", emoji: "🐸", bg: ["#bef264", "#4d7c0f"] },
  { id: "avatar_cool", kind: "avatar", name: "Cool", price: 0, currency: "coins", emoji: "😎", bg: ["#fde047", "#f59e0b"] },
  { id: "avatar_turtle", kind: "avatar", name: "Turtle", price: 0, currency: "coins", emoji: "🐢", bg: ["#5eead4", "#0f766e"] },
  { id: "avatar_star", kind: "avatar", name: "Star", price: 0, currency: "coins", emoji: "⭐", bg: ["#fcd34d", "#b45309"] },
  // VIP-only avatars
  { id: "avatar_vip_king", kind: "avatar", name: "VIP King", price: 0, currency: "coins", vipOnly: true, emoji: "👑", bg: ["#fde68a", "#d97706"] },
  { id: "avatar_vip_dragon", kind: "avatar", name: "VIP Dragon", price: 0, currency: "coins", vipOnly: true, emoji: "🐉", bg: ["#f87171", "#7f1d1d"] },
  { id: "avatar_vip_wolf", kind: "avatar", name: "VIP Wolf", price: 0, currency: "coins", vipOnly: true, emoji: "🐺", bg: ["#94a3b8", "#1e293b"] },
  { id: "avatar_vip_lion", kind: "avatar", name: "VIP Lion", price: 0, currency: "coins", vipOnly: true, emoji: "🦁", bg: ["#fdba74", "#c2410c"] },
  { id: "avatar_vip_eagle", kind: "avatar", name: "VIP Eagle", price: 0, currency: "coins", vipOnly: true, emoji: "🦅", bg: ["#93c5fd", "#1e3a8a"] },
  { id: "avatar_vip_unicorn", kind: "avatar", name: "VIP Unicorn", price: 0, currency: "coins", vipOnly: true, emoji: "🦄", bg: ["#f5d0fe", "#a21caf"] },
  { id: "avatar_vip_fire", kind: "avatar", name: "VIP Fire", price: 0, currency: "coins", vipOnly: true, emoji: "🔥", bg: ["#fde047", "#dc2626"] },
  { id: "avatar_vip_diamond", kind: "avatar", name: "VIP Diamond", price: 0, currency: "coins", vipOnly: true, emoji: "💎", bg: ["#a5f3fc", "#0369a1"] },
  { id: "avatar_vip_alien", kind: "avatar", name: "VIP Alien", price: 0, currency: "coins", vipOnly: true, emoji: "👽", bg: ["#86efac", "#166534"] },
  { id: "avatar_vip_robot", kind: "avatar", name: "VIP Robot", price: 0, currency: "coins", vipOnly: true, emoji: "🤖", bg: ["#cbd5e1", "#475569"] },
  { id: "avatar_vip_ninja", kind: "avatar", name: "VIP Ninja", price: 0, currency: "coins", vipOnly: true, emoji: "🥷", bg: ["#6b7280", "#111827"] },
  { id: "avatar_vip_scorpion", kind: "avatar", name: "VIP Scorpion", price: 0, currency: "coins", vipOnly: true, emoji: "🦂", bg: ["#c4b5fd", "#4c1d95"] },
  // VIP-only image avatars (custom artwork, usable while the VIP Pass is active)
  { id: "avatar_vip_hoodiegirl", kind: "avatar", name: "VIP Hoodie Girl", price: 0, currency: "coins", vipOnly: true, img: "/avatars/avatar_vip_hoodiegirl.png" },
  { id: "avatar_vip_boy", kind: "avatar", name: "VIP Cool Boy", price: 0, currency: "coins", vipOnly: true, img: "/avatars/avatar_vip_boy.png" },
  { id: "avatar_vip_fox", kind: "avatar", name: "VIP Fox", price: 0, currency: "coins", vipOnly: true, img: "/avatars/avatar_vip_fox.png" },
  { id: "avatar_vip_bear", kind: "avatar", name: "VIP Bear", price: 0, currency: "coins", vipOnly: true, img: "/avatars/avatar_vip_bear.png" },
  { id: "avatar_vip_beardman", kind: "avatar", name: "VIP Beardman", price: 0, currency: "coins", vipOnly: true, img: "/avatars/avatar_vip_beardman.png" },
  { id: "avatar_vip_longhair", kind: "avatar", name: "VIP Longhair Girl", price: 0, currency: "coins", vipOnly: true, img: "/avatars/avatar_vip_longhair.png" },
  { id: "avatar_vip_panda", kind: "avatar", name: "VIP Panda", price: 0, currency: "coins", vipOnly: true, img: "/avatars/avatar_vip_panda.png" },
  { id: "avatar_vip_cat", kind: "avatar", name: "VIP Cat", price: 0, currency: "coins", vipOnly: true, img: "/avatars/avatar_vip_cat.png" },
  // Animated VIP avatar: the GIF plays once when someone opens the player's profile, a still frame is used elsewhere
  { id: "avatar_vip_spanish", kind: "avatar", name: "VIP Spanish Girl", price: 0, currency: "coins", vipOnly: true, img: "/avatars/avatar_vip_spanish.gif", imgStill: "/avatars/avatar_vip_spanish_still.png" },

  // ----------------------------------- VIP -----------------------------------
  { id: "vip_pass", kind: "vip", name: "VIP Pass (30 days)", price: 149, currency: "inr", featured: true },
]
export const ITEM_BY_ID: Record<string, StoreItem> = Object.fromEntries(ITEMS.map((i) => [i.id, i]))

export interface StoreState {
  coins: number
  gems: number
  owned: string[]
  equipped: { skin: string; trail: string; food: string; avatar: string }
  vipUntil: number
  /** last day the VIP daily reward was claimed */
  vipDailyAt: number
  /** rank tiers whose one-time Rank Pass reward was already claimed */
  rankClaimed: string[]
  best: number
  updatedAt: number
}
const DEFAULT: StoreState = {
  coins: 250,
  gems: 50,
  owned: ["skin_classic", "food_classic", "trail_none"],
  equipped: { skin: "skin_classic", trail: "trail_none", food: "food_classic", avatar: "avatar_cool" },
  vipUntil: 0,
  vipDailyAt: 0,
  rankClaimed: [],
  best: 0,
  updatedAt: 0,
}
const KEY = "snake-store-v1"
let state: StoreState = DEFAULT
let loaded = false
const listeners = new Set<() => void>()

function load() {
  if (loaded || typeof window === "undefined") return
  loaded = true
  try {
    const raw = window.localStorage.getItem(KEY)
    if (raw) {
      const p = JSON.parse(raw)
      state = sanitize({ ...DEFAULT, ...p, equipped: { ...DEFAULT.equipped, ...(p.equipped || {}) } })
    }
  } catch {}
}
/** When the VIP Pass runs out, VIP-only skins / trails / food are unequipped (they come back when VIP does). */
function sanitize(s: StoreState): StoreState {
  if (s.vipUntil > Date.now()) return s
  let eq = s.equipped, changed = false
  for (const k of ["skin", "trail", "food", "avatar"] as const) {
    if (getCatalogItem(eq[k])?.vipOnly) { eq = { ...eq, [k]: DEFAULT.equipped[k] }; changed = true }
  }
  return changed ? { ...s, equipped: eq } : s
}
function commit(next: StoreState, touch = true) {
  next = sanitize(next)
  state = touch ? { ...next, updatedAt: Date.now() } : next
  try { window.localStorage.setItem(KEY, JSON.stringify(state)) } catch {}
  listeners.forEach((l) => l())
}
export function subscribeStore(cb: () => void) { load(); listeners.add(cb); return () => { listeners.delete(cb) } }
function subscribe(cb: () => void) { load(); listeners.add(cb); return () => { listeners.delete(cb) } }
export function useStore(): StoreState {
  return useSyncExternalStore(subscribe, () => { load(); return state }, () => DEFAULT)
}

export function getStoreState(): StoreState { load(); return state }
export function setBest(n: number) { load(); if (n > state.best) commit({ ...state, best: n }) }
/** Replace everything (cloud load / logout). Does not bump updatedAt. */
export function replaceStore(next: StoreState) { load(); commit({ ...DEFAULT, ...next, equipped: { ...DEFAULT.equipped, ...(next.equipped || {}) } }, false) }
export function resetStore() { load(); commit({ ...DEFAULT }, false) }
export const hasProgress = (s: StoreState) => s.coins !== DEFAULT.coins || s.gems !== DEFAULT.gems || s.owned.length > DEFAULT.owned.length || s.best > 0
/** Merge two saves: newest wallet/equipment wins, owned items are unioned, best score is the max. */
export function mergeStates(a: StoreState, b: StoreState): StoreState {
  const [old, cur] = a.updatedAt <= b.updatedAt ? [a, b] : [b, a]
  return { ...cur, owned: Array.from(new Set([...old.owned, ...cur.owned])), vipUntil: Math.max(a.vipUntil, b.vipUntil), vipDailyAt: Math.max(a.vipDailyAt || 0, b.vipDailyAt || 0), rankClaimed: Array.from(new Set([...(a.rankClaimed || []), ...(b.rankClaimed || [])])), best: Math.max(a.best, b.best), updatedAt: Math.max(a.updatedAt, b.updatedAt) }
}
export const isVip = (s: StoreState = state) => s.vipUntil > Date.now()
/** Whole days (rounded up) until the running VIP Pass ends; 0 when there is none. */
export const vipDaysLeft = (s: StoreState = state) => (s.vipUntil > Date.now() ? Math.ceil((s.vipUntil - Date.now()) / 864e5) : 0)
export const owns = (s: StoreState, id: string) => {
  if (s.owned.includes(id)) return true
  const it = getCatalogItem(id)
  // avatars need no purchase: free ones are open to everybody, VIP ones while the pass is active
  // (an avatar the admin has put a price on must be bought first, then it is in `owned`)
  return it?.kind === "avatar" ? (!it.vipOnly || isVip(s)) && it.price === 0 : false
}

/** Coins earned while playing (VIP pass doubles it). */
export function earnCoins(n: number) { load(); commit({ ...state, coins: state.coins + n * (isVip() ? 2 : 1) }) }
export function earnGems(n: number) { load(); if (n > 0) commit({ ...state, gems: state.gems + (isVip() ? Math.ceil(n * 1.5) : n) }) }
/** Admin gift: exact amounts, no VIP multiplier. */
export function creditCurrency(coins: number, gems: number) { load(); commit({ ...state, coins: state.coins + Math.max(0, Math.floor(coins)), gems: state.gems + Math.max(0, Math.floor(gems)) }) }

/**
 * Admin gift from the Mailbox (claimed by the player): coins, gems, VIP days and any store items.
 * Items are only added to `owned` (not auto-equipped). VIP days extend a running pass.
 */
export interface MailReward { coins?: number; gems?: number; vipDays?: number; items?: string[] }
export function applyReward(r: MailReward): void {
  load()
  let s: StoreState = { ...state, coins: state.coins + Math.max(0, Math.floor(r.coins || 0)), gems: state.gems + Math.max(0, Math.floor(r.gems || 0)) }
  const days = Math.max(0, Math.min(365, Math.floor(r.vipDays || 0)))
  if (days > 0) {
    const base = Math.max(Date.now(), s.vipUntil)
    s = { ...s, vipUntil: base + days * 864e5, owned: s.owned.includes("skin_vip") ? s.owned : [...s.owned, "skin_vip"] }
  }
  const ids = (r.items || []).filter((id) => /^[a-z0-9_]{1,48}$/.test(id) && !s.owned.includes(id))
  if (ids.length) s = { ...s, owned: [...s.owned, ...Array.from(new Set(ids))] }
  commit(s)
}

/** VIP perk: one reward per day while the pass is active. */
export const VIP_DAILY = { coins: 500, gems: 25 }
export const vipDailyClaimed = (s: StoreState = state) => !!s.vipDailyAt && new Date(s.vipDailyAt).toDateString() === new Date().toDateString()
export function claimVipDaily(): { ok: boolean; msg: string } {
  load()
  if (!isVip()) return { ok: false, msg: "Get the VIP Pass to claim daily rewards" }
  if (vipDailyClaimed()) return { ok: false, msg: "Already claimed today — come back tomorrow!" }
  commit({ ...state, coins: state.coins + VIP_DAILY.coins, gems: state.gems + VIP_DAILY.gems, vipDailyAt: Date.now() })
  return { ok: true, msg: `+${VIP_DAILY.coins} coins & +${VIP_DAILY.gems} gems!` }
}

/**
 * Rank Pass: the first time a player reaches a higher rank tier they get coins (see RANK_PASS_COINS)
 * and always exactly RANK_PASS_GEMS (= 1) gem per tier. Each tier pays out once per account.
 * Safe to call with any rating: nothing is granted for tiers that were already claimed.
 */
export function claimRankRewards(elo: number): { coins: number; gems: number; tiers: string[] } {
  load()
  const claimed = new Set(state.rankClaimed || [])
  const fresh = rankPassesUpTo(elo).filter((t) => !claimed.has(t.id))
  if (fresh.length === 0) return { coins: 0, gems: 0, tiers: [] }
  const coins = fresh.reduce((n, t) => n + (RANK_PASS_COINS[t.id] ?? 0), 0)
  const gems = fresh.length * RANK_PASS_GEMS
  commit({ ...state, coins: state.coins + coins, gems: state.gems + gems, rankClaimed: [...claimed, ...fresh.map((t) => t.id)] })
  return { coins, gems, tiers: fresh.map((t) => t.name) }
}

export function equip(id: string): { ok: boolean; msg: string } {
  load()
  const it = getCatalogItem(id); if (!it || !owns(state, id)) return { ok: false, msg: "Not owned yet" }
  if (it.vipOnly && !isVip()) return { ok: false, msg: "VIP Pass needed to use this" }
  if (it.kind === "skin" || it.kind === "trail" || it.kind === "food" || it.kind === "avatar") { commit({ ...state, equipped: { ...state.equipped, [it.kind]: id } }); return { ok: true, msg: `${it.name} equipped` } }
  return { ok: false, msg: "Can't equip this" }
}

function grant(it: StoreItem, s: StoreState): StoreState {
  if (it.kind === "vip") {
    const days = Math.max(1, Math.min(365, Math.floor(Number(it.days) || 30)))
    const base = Math.max(Date.now(), s.vipUntil)
    const owned = s.owned.includes("skin_vip") ? s.owned : [...s.owned, "skin_vip"]
    return { ...s, vipUntil: base + days * 864e5, owned }
  }
  return { ...s, owned: [...s.owned, it.id], equipped: { ...s.equipped, [it.kind]: it.id } }
}

/** Gem packs (real money, prices are placeholders for now) and coin packs (paid with gems). */
export const CURRENCY_SYMBOL = "₹"
export const GEM_PACKS = [
  { id: "gp1", gems: 100, price: 19 },
  { id: "gp2", gems: 550, price: 99, tag: "Popular" },
  { id: "gp3", gems: 1200, price: 199 },
  { id: "gp4", gems: 3000, price: 449, tag: "Best value" },
  { id: "gp5", gems: 7000, price: 999 },
]
export const COIN_PACKS = [
  { id: "cp1", coins: 1000, gems: 50 },
  { id: "cp2", coins: 5000, gems: 200, tag: "Popular" },
  { id: "cp3", coins: 12000, gems: 450 },
  { id: "cp4", coins: 30000, gems: 1000, tag: "Best value" },
]
export function buyGemPack(id: string): { ok: boolean; msg: string } {
  load(); const p = GEM_PACKS.find((x) => x.id === id); if (!p) return { ok: false, msg: "Pack not found" }
  if (!TEST_MODE) return { ok: false, msg: "Payments are not connected yet" }
  commit({ ...state, gems: state.gems + p.gems }); return { ok: true, msg: `+${p.gems.toLocaleString()} gems added` }
}
export function buyCoinPack(id: string): { ok: boolean; msg: string; needGems?: boolean } {
  load(); const p = COIN_PACKS.find((x) => x.id === id); if (!p) return { ok: false, msg: "Pack not found" }
  if (state.gems < p.gems) return { ok: false, msg: "Not enough gems", needGems: true }
  commit({ ...state, gems: state.gems - p.gems, coins: state.coins + p.coins }); return { ok: true, msg: `+${p.coins.toLocaleString()} coins added` }
}

/**
 * Real-money purchases. TEST_MODE grants the item without charging anything.
 * For a real release replace the body with Google Play Billing (Capacitor plugin)
 * and only call grant() after the store confirms the payment.
 */
export const TEST_MODE = true
/**
 * FREE_MODE: launch default. Built-in items are FREE until the admin sets a price for them in the admin panel
 * (per item: Free / Coins / Gems / ₹). Set to false to switch the coded prices in ITEMS back on for every item.
 */
export const FREE_MODE = true
export function buy(id: string): { ok: boolean; msg: string } {
  load()
  const it = getCatalogItem(id); if (!it) return { ok: false, msg: "Item not found" }
  // VIP Pass: one activation at a time. It can be activated again only after the current pass has ended
  // (no stacking / re-clicking while it is still running).
  if (it.kind === "vip" && isVip()) return { ok: false, msg: `VIP Pass already active — ${vipDaysLeft()} day${vipDaysLeft() === 1 ? "" : "s"} left. You can activate it again after it ends.` }
  if (it.vipOnly && !isVip()) return { ok: false, msg: "VIP exclusive — activate the VIP Pass first" }
  // price 0 = free item (admin chose "Free"): unlock / activate without paying
  if (it.price === 0) {
    if (owns(state, id) && it.kind !== "vip") return { ok: false, msg: "Already owned" }
    commit(grant(it, state)); return { ok: true, msg: it.kind === "vip" ? "VIP Pass activated!" : `${it.name} unlocked & equipped!` }
  }
  if (it.currency === "inr") {
    if (!TEST_MODE) return { ok: false, msg: "Payments are not connected yet" }
    commit(grant(it, state)); return { ok: true, msg: it.kind === "vip" ? "VIP Pass activated!" : `${it.name} added!` }
  }
  if (owns(state, id)) return { ok: false, msg: "Already owned" }
  const bal = it.currency === "gems" ? state.gems : state.coins
  if (bal < it.price) return { ok: false, msg: `Not enough ${it.currency}` }
  const paid = { ...state, [it.currency]: bal - it.price } as StoreState
  commit(grant(it, paid)); return { ok: true, msg: it.kind === "vip" ? "VIP Pass activated!" : `${it.name} unlocked!` }
}

/**
 * Why a Play purchase grant would be refused — checked BEFORE the payment sheet
 * opens, so nobody pays for something they can't receive.
 */
export function grantBlocker(id: string): string | null {
  load()
  const it = getCatalogItem(id); if (!it) return "Item not found"
  if (it.kind === "vip" && isVip()) return `VIP Pass already active — ${vipDaysLeft()} day(s) left`
  if (it.vipOnly && !isVip()) return "VIP exclusive — activate the VIP Pass first"
  if (owns(state, id) && it.kind !== "vip") return "Already owned"
  return null
}

/**
 * Grant after a CONFIRMED Google Play purchase. Same checks as buy() but no
 * currency deduction — the money part already happened in the Play sheet.
 * Call ONLY after purchaseSku() returned ok.
 */
export function grantAfterPurchaseItem(id: string): { ok: boolean; msg: string } {
  const blocked = grantBlocker(id)
  if (blocked) return { ok: false, msg: blocked }
  load()
  const it = getCatalogItem(id)!
  commit(grant(it, state))
  return { ok: true, msg: it.kind === "vip" ? "VIP Pass activated! 🎉" : `${it.name} unlocked! 🎉` }
}

/** Add gems after a CONFIRMED Google Play gem-pack purchase. */
export function grantAfterPurchaseGems(packId: string): { ok: boolean; msg: string } {
  load()
  const pk = GEM_PACKS.find((x) => x.id === packId); if (!pk) return { ok: false, msg: "Pack not found" }
  commit({ ...state, gems: state.gems + pk.gems })
  return { ok: true, msg: `+${pk.gems.toLocaleString()} gems added! 🎉` }
}

// ---------------------------------------------------------------------------
// Remote catalog: admin-managed overrides + custom items (RTDB `storeConfig`)
// ---------------------------------------------------------------------------
/** Partial change to a built-in item, saved by the admin panel. */
export interface CatalogOverride extends Partial<StoreItem> { disabled?: boolean }

const CATALOG_KEY = "snake-catalog-v1"
const HEX = /^#[0-9a-fA-F]{6}$/
const SHAPES = ["dot", "square", "diamond", "star", "heart", "ring"] as const

let remoteCustom: Record<string, StoreItem> = {}
let remoteOverrides: Record<string, CatalogOverride> = {}
let catalogLoading = false
const catalogListeners = new Set<() => void>()
// getSnapshot must return a cached (stable) reference, otherwise React
// sees a "changed" store on every render and loops forever.
let catalogCache: StoreItem[] | null = null
function getCatalogSnapshot(): StoreItem[] {
  if (!catalogCache) catalogCache = getCatalogItems()
  return catalogCache
}
const notifyCatalog = () => { catalogCache = null; categoryCache = null; hiddenCache = null; catalogListeners.forEach((l) => l()) }

function hexStr(v: unknown): string | undefined {
  return typeof v === "string" && HEX.test(v) ? v : undefined
}

/** Avatar image reference: a file under /avatars/ OR a small uploaded image stored inline as a data URL. */
const DATA_IMG = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/
export const MAX_AVATAR_DATA_URL = 420_000
function cleanImgRef(v: unknown): string | undefined {
  if (typeof v !== "string" || !v) return undefined
  if (v.startsWith("/avatars/") && /^[\w\-/.]{1,80}$/.test(v)) return v
  if (v.length <= MAX_AVATAR_DATA_URL && DATA_IMG.test(v)) return v
  return undefined
}

/** Copy the optional kind-specific fields from a raw object, sanitized. */
function applyOptionalFields(item: StoreItem, v: Record<string, unknown>): void {
  const h = hexStr(v.head); if (h) item.head = h
  const a = hexStr(v.a); if (a) item.a = a
  const b = hexStr(v.b); if (b) item.b = b
  const g = hexStr(v.glow); if (g) item.glow = g
  if (v.rainbow === true) item.rainbow = true
  if (v.rainbow === false) item.rainbow = false
  if (Array.isArray(v.palette)) {
    const p = (v.palette as unknown[]).filter((c): c is string => !!hexStr(c)).slice(0, 8)
    if (p.length) item.palette = p
  }
  const shape = typeof v.shape === "string" ? v.shape : ""
  if ((SHAPES as readonly string[]).includes(shape)) item.shape = shape as Shape
  const emoji = typeof v.emoji === "string" ? v.emoji : ""
  if (emoji) item.emoji = [...emoji].slice(0, 4).join("")
  if (Array.isArray(v.bg)) {
    const b0 = hexStr((v.bg as unknown[])[0]), b1 = hexStr((v.bg as unknown[])[1])
    if (b0 && b1) item.bg = [b0, b1]
  }
  const img = cleanImgRef(v.img); if (img) item.img = img
  const still = cleanImgRef(v.imgStill); if (still) item.imgStill = still
  // GIF play duration in ms (parsed from frame delays at upload); 200ms–60s, else dropped
  const imgMs = Math.floor(Number(v.imgMs) || 0)
  if (imgMs >= 200 && imgMs <= 60000) item.imgMs = imgMs
  else if (v.imgMs !== undefined) delete item.imgMs
  const days = Math.floor(Number(v.days) || 0)
  if (days >= 1 && days <= 365) item.days = days
  if (v.featured === true) item.featured = true
  if (v.featured === false) item.featured = false
  // admin categories: array of custom category ids (max 5, each max 40 chars).
  // Legacy `category` string (single) migrates into the array.
  const cleanCatId = (c: unknown): string => (typeof c === "string" ? c.trim().slice(0, 40) : "")
  if (Array.isArray(v.categories)) {
    const arr = [...new Set((v.categories as unknown[]).map(cleanCatId).filter(Boolean))].slice(0, 5)
    if (arr.length) item.categories = arr
    else delete item.categories
  } else if (typeof v.category === "string") {
    const c = v.category.trim().slice(0, 40)
    if (c) item.categories = [c]
    else delete item.categories
  } else if (v.categories !== undefined || v.category !== undefined) {
    delete item.categories
  }
  delete item.category // legacy field never survives normalization
  // schedule: store shows the item only inside [startAt, endAt] (ms timestamps; unset = always)
  const st = Math.floor(Number(v.startAt) || 0)
  if (st > 0) item.startAt = st
  else if (v.startAt !== undefined) delete item.startAt
  const en = Math.floor(Number(v.endAt) || 0)
  if (en > 0) item.endAt = en
  else if (v.endAt !== undefined) delete item.endAt
}

/** Validate a full custom item coming from the DB. The DB key wins as the id. */
function cleanItem(key: string, v: unknown): StoreItem | null {
  if (!v || typeof v !== "object" || !/^[a-z0-9_]{1,48}$/.test(key)) return null
  const r = v as Record<string, unknown>
  const kind = r.kind
  if (kind !== "skin" && kind !== "trail" && kind !== "food" && kind !== "avatar" && kind !== "vip") return null
  const currency = r.currency
  const item: StoreItem = {
    id: key,
    kind,
    name: (typeof r.name === "string" && r.name.trim().slice(0, 40)) || "Custom item",
    price: Math.max(0, Math.min(100000000, Math.floor(Number(r.price) || 0))),
    currency: currency === "gems" || currency === "inr" ? currency : "coins",
  }
  if (r.vipOnly === true) item.vipOnly = true
  applyOptionalFields(item, r)
  return item
}

function sanitizeCustomMap(v: unknown): Record<string, StoreItem> {
  const out: Record<string, StoreItem> = {}
  if (v && typeof v === "object") {
    for (const [k, raw] of Object.entries(v as Record<string, unknown>)) {
      const c = cleanItem(k, raw)
      if (c) out[k] = c
    }
  }
  return out
}

function sanitizeOverrideMap(v: unknown, extraIds?: Set<string>): Record<string, CatalogOverride> {
  const out: Record<string, CatalogOverride> = {}
  if (v && typeof v === "object") {
    for (const [k, raw] of Object.entries(v as Record<string, unknown>)) {
      if ((!ITEM_BY_ID[k] && !extraIds?.has(k)) || !raw || typeof raw !== "object") continue
      const r = raw as Record<string, unknown>
      const ov: CatalogOverride = {}
      if (r.disabled === true) ov.disabled = true
      if (typeof r.name === "string" && r.name.trim()) ov.name = r.name.trim().slice(0, 40)
      if (r.price !== undefined) ov.price = Math.max(0, Math.min(100000000, Math.floor(Number(r.price) || 0)))
      if (r.currency === "coins" || r.currency === "gems" || r.currency === "inr") ov.currency = r.currency
      if (r.vipOnly === true) ov.vipOnly = true
      if (r.vipOnly === false) ov.vipOnly = false
      applyOptionalFields(ov as StoreItem, r)
      if (Object.keys(ov).length) out[k] = ov
    }
  }
  return out
}

/** Schedule check: is the item currently shown in the store? Ownership / equipped are NOT affected. */
export function isLiveNow(it: StoreItem, now = Date.now()): boolean {
  if (it.startAt && now < it.startAt) return false
  if (it.endAt && now > it.endAt) return false
  return true
}

// ---------------------------------------------------------------------------
// Admin categories: custom groupings for skins / trails / food / avatars
// (RTDB `storeConfig/categories/{id}` = { name, kind }). The store shows them
// as filter chips; the admin panel assigns items to them in the item form.
// ---------------------------------------------------------------------------
export interface Category { id: string; name: string; kind: Kind }
const CATEGORY_KEY_RE = /^[a-z0-9_]{1,40}$/

let remoteCategories: Record<string, Category> = {}
let categoryCache: Category[] | null = null

function sanitizeCategoryMap(v: unknown): Record<string, Category> {
  const out: Record<string, Category> = {}
  if (v && typeof v === "object") {
    for (const [k, raw] of Object.entries(v as Record<string, unknown>)) {
      if (!CATEGORY_KEY_RE.test(k) || !raw || typeof raw !== "object") continue
      const r = raw as Record<string, unknown>
      const kind = r.kind
      if (kind !== "skin" && kind !== "trail" && kind !== "food" && kind !== "avatar") continue
      const name = typeof r.name === "string" ? r.name.trim().slice(0, 30) : ""
      if (!name) continue
      out[k] = { id: k, name, kind }
    }
  }
  return out
}

function getCategorySnapshot(): Category[] {
  if (!categoryCache) categoryCache = Object.values(remoteCategories).sort((a, b) => a.name.localeCompare(b.name))
  return categoryCache
}

/** Reactive admin categories (empty before load). */
export function useCategories(): Category[] {
  return useSyncExternalStore(
    (cb) => { catalogListeners.add(cb); return () => { catalogListeners.delete(cb) } },
    getCategorySnapshot,
    getCategorySnapshot,
  )
}

/** All admin categories (safe to call before load). */
export function getCategories(): Category[] { return getCategorySnapshot() }

/** Category display name for an item ("" when none / unknown). Kept for old callers. */
export function categoryNameOf(it: StoreItem): string {
  const ids = it.categories && it.categories.length ? it.categories : it.category ? [it.category] : []
  if (!ids.length) return ""
  return remoteCategories[ids[0]]?.name || ""
}

/** All category display names for an item (one per category it sits in). */
export function categoryNamesOf(it: StoreItem): string[] {
  const ids = it.categories && it.categories.length ? it.categories : it.category ? [it.category] : []
  return ids.map((id) => remoteCategories[id]?.name || id).filter(Boolean)
}

// ---------------------------------------------------------------------------
// Hidden items: built-ins (or custom items) the admin hid via the
// `storeConfig/overrides/{id}/disabled` flag. They are skipped by the catalog,
// but the admin panel lists them separately so they can be unhidden again.
// ---------------------------------------------------------------------------
let hiddenCache: StoreItem[] | null = null

/** Every hidden item (built-in + custom), with overrides applied. */
export function getHiddenItems(): StoreItem[] {
  const out: StoreItem[] = []
  for (const b of ITEMS) {
    const ov = remoteOverrides[b.id]
    if (ov?.disabled) out.push(withPricing(b, ov))
  }
  for (const id of Object.keys(remoteCustom)) {
    if (remoteOverrides[id]?.disabled) out.push(remoteCustom[id])
  }
  return out
}

function getHiddenSnapshot(): StoreItem[] {
  if (!hiddenCache) hiddenCache = getHiddenItems()
  return hiddenCache
}

/** Reactive hidden-items list for the admin panel. */
export function useHiddenItems(): StoreItem[] {
  return useSyncExternalStore(
    (cb) => { catalogListeners.add(cb); return () => { catalogListeners.delete(cb) } },
    getHiddenSnapshot,
    getHiddenSnapshot,
  )
}

/**
 * A built-in item = coded defaults + the admin's override. Pricing is decided by the admin (admin panel →
 * item → Free / Coins / Gems / ₹): until the admin has set a price for an item it stays FREE (FREE_MODE),
 * the coded price is only a suggestion.
 */
/** Fold any legacy `category` string into the `categories` array (defensive — DB data is normalized in applyOptionalFields). */
function normalizeCategories(it: StoreItem): void {
  if ((!it.categories || !it.categories.length) && it.category) it.categories = [it.category]
  delete it.category
}
function withPricing(b: StoreItem, ov?: CatalogOverride): StoreItem {
  const merged: StoreItem = ov ? (({ disabled: _d, ...rest }) => ({ ...b, ...rest }))(ov) : { ...b }
  normalizeCategories(merged)
  if (FREE_MODE && ov?.price === undefined) return { ...merged, price: 0 }
  return merged
}

/** Full item list: built-ins (+ admin overrides) + admin's custom items. Hidden items are skipped. */
export function getCatalogItems(): StoreItem[] {
  const out: StoreItem[] = []
  for (const b of ITEMS) {
    const ov = remoteOverrides[b.id]
    if (ov?.disabled) continue
    out.push(withPricing(b, ov))
  }
  for (const id of Object.keys(remoteCustom)) {
    if (remoteOverrides[id]?.disabled) continue
    out.push(remoteCustom[id])
  }
  return out
}

/** One item by id, catalog-aware (custom + overrides). Safe to call before load. */
export function getCatalogItem(id: string): StoreItem | undefined {
  if (remoteCustom[id]) return remoteCustom[id]
  const b = ITEM_BY_ID[id]
  if (!b) return undefined
  const ov = remoteOverrides[id]
  if (ov?.disabled) return undefined
  return withPricing(b, ov)
}

/** Reactive catalog for components. */
export function useCatalog(): StoreItem[] {
  return useSyncExternalStore(
    (cb) => { catalogListeners.add(cb); return () => { catalogListeners.delete(cb) } },
    () => getCatalogSnapshot(),
    () => ITEMS,
  )
}

/** Load admin catalog from RTDB (cached in localStorage for offline). Call once at startup. */
export async function loadCatalog(): Promise<void> {
  try {
    const raw = window.localStorage.getItem(CATALOG_KEY)
    if (raw) {
      const p = JSON.parse(raw)
      if (p && typeof p === "object") {
        remoteCustom = sanitizeCustomMap(p.items)
        remoteCategories = sanitizeCategoryMap(p.categories)
        remoteOverrides = sanitizeOverrideMap(p.overrides, new Set(Object.keys(remoteCustom)))
        notifyCatalog()
      }
    }
  } catch {}
  if (catalogLoading) return
  catalogLoading = true
  try {
    const snap = await get(ref(getFirebaseDb(), "storeConfig"))
    const v = snap.val()
    if (v && typeof v === "object") {
      remoteCustom = sanitizeCustomMap(v.items)
      remoteCategories = sanitizeCategoryMap(v.categories)
      remoteOverrides = sanitizeOverrideMap(v.overrides, new Set(Object.keys(remoteCustom)))
      try { window.localStorage.setItem(CATALOG_KEY, JSON.stringify({ items: remoteCustom, overrides: remoteOverrides, categories: remoteCategories })) } catch {}
      notifyCatalog()
    }
  } catch {} finally { catalogLoading = false }
}

/** Re-fetch after the admin saves something. */
export function refreshCatalog(): Promise<void> { catalogLoading = false; return loadCatalog() }

/** Equipped slot item, guaranteed: falls back to the coded default for the slot. */
const SLOT_DEFAULT: Record<"skin" | "trail" | "food", string> = { skin: "skin_classic", trail: "trail_none", food: "food_classic" }
export function equippedItem(kind: "skin" | "trail" | "food", id: string): StoreItem {
  return getCatalogItem(id) ?? ITEM_BY_ID[SLOT_DEFAULT[kind]]
}
