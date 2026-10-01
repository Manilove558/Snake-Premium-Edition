"use client"
import { useEffect, useState } from "react"
import { Capacitor, registerPlugin } from "@capacitor/core"
import { ref, set } from "firebase/database"
import { getFirebaseDb } from "./firebase"
import { TEST_MODE } from "./store"

/**
 * Real-money billing via Google Play Billing (native Android only).
 *
 * Play Store policy: digital goods (skins, VIP pass, gems) bought inside the
 * Android app MUST go through Google Play Billing — no Razorpay/UPI-direct
 * inside the app. The Play payment sheet itself offers UPI, cards, netbanking
 * AND redeem-code entry, so one integration covers all three.
 * Google Play redeem/promo codes need no app code: create them in Play Console
 * and players redeem them in the Play Store or right inside the payment sheet.
 *
 * SKU convention (create these EXACT IDs as one-time products in Play Console):
 *   store item  ->  snake_item_<itemId>      (e.g. snake_item_vip_pass)
 *   gem pack    ->  snake_gems_<packId>      (e.g. snake_gems_gp2)
 */

export type BillingMode = "demo" | "play"

/** 'play' only on native Android with TEST_MODE off. Everywhere else = demo (no real charge). */
export function billingMode(): BillingMode {
  if (TEST_MODE) return "demo"
  try {
    if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android") return "play"
  } catch {
    /* not in a Capacitor runtime (web/SSR) */
  }
  return "demo"
}

const safe = (s: string) => s.toLowerCase().replace(/[^a-z0-9_]/g, "_")
export const skuForItem = (itemId: string) => `snake_item_${safe(itemId)}`
export const skuForGemPack = (packId: string) => `snake_gems_${safe(packId)}`

interface PlayProduct {
  id: string
  displayPrice?: string
  priceInMicros?: number
  currencyCode?: string
}
interface PlayPluginShape {
  getProducts(options: { productIds: string[] }): Promise<{ products: PlayProduct[] }>
  purchaseProduct(options: { productId: string; referenceUUID: string }): Promise<{ transaction: string }>
}

/**
 * The native plugin is wired into the app by `npx cap sync` (native Android code).
 * We reach it through Capacitor's plugin registry at RUNTIME only — the web/Next.js
 * build never imports the npm package, so `npm run dev` / `npm run build` can never
 * break with "Module not found" even if the package isn't installed here.
 */
let pluginProxy: PlayPluginShape | null = null
function loadPlugin(): PlayPluginShape | null {
  try {
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== "android") return null
  } catch {
    return null
  }
  if (!pluginProxy) {
    try {
      pluginProxy = registerPlugin<PlayPluginShape>("CapacitorInAppPurchase")
    } catch {
      return null
    }
  }
  return pluginProxy
}

export interface PlayPrice {
  sku: string
  display: string
  micros: number
  currency: string
}

/** Batch-fetch Play prices for SKUs. Returns {} when billing isn't available — caller falls back to the coded ₹ price. */
export async function fetchPlayPrices(skus: string[]): Promise<Record<string, PlayPrice>> {
  const out: Record<string, PlayPrice> = {}
  if (billingMode() !== "play" || skus.length === 0) return out
  try {
    const p = loadPlugin()
    if (!p) return out
    const { products } = await p.getProducts({ productIds: [...new Set(skus)] })
    for (const pr of products ?? []) {
      if (!pr?.id) continue
      out[pr.id] = {
        sku: pr.id,
        display: pr.displayPrice || "",
        micros: pr.priceInMicros || 0,
        currency: pr.currencyCode || "INR",
      }
    }
  } catch {
    /* Play not ready or products missing in Play Console */
  }
  return out
}

const priceCache: Record<string, PlayPrice> = {}

/** React hook: Play display prices for SKUs (session-cached). Empty when billing is off. */
export function usePlayPrices(skus: string[]): Record<string, PlayPrice> {
  const key = [...new Set(skus)].sort().join(",")
  const [prices, setPrices] = useState<Record<string, PlayPrice>>(() => {
    const c: Record<string, PlayPrice> = {}
    for (const s of key.split(",")) if (s && priceCache[s]) c[s] = priceCache[s]
    return c
  })
  useEffect(() => {
    if (!key || billingMode() !== "play") return
    const missing = key.split(",").filter((s) => s && !priceCache[s])
    if (!missing.length) return
    let alive = true
    fetchPlayPrices(missing).then((r) => {
      if (!alive) return
      Object.assign(priceCache, r)
      setPrices({ ...priceCache })
    })
    return () => {
      alive = false
    }
  }, [key])
  return prices
}

export interface PurchaseResult {
  ok: boolean
  orderId?: string
  msg: string
}

function parseOrderId(transaction: string): string {
  try {
    const t = JSON.parse(transaction) as Record<string, unknown>
    const nested = t.purchase as Record<string, unknown> | undefined
    const id = t.orderId ?? t.order_id ?? nested?.orderId ?? nested?.order_id
    if (typeof id === "string" && id) return id
  } catch {
    /* not JSON */
  }
  return `play_${Date.now().toString(36)}`
}

/** Launch the Google Play payment sheet (UPI / cards / netbanking / redeem code). */
export async function purchaseSku(sku: string, uid: string): Promise<PurchaseResult> {
  if (billingMode() !== "play") return { ok: false, msg: "Demo mode chal raha hai" }
  try {
    const p = loadPlugin()
    if (!p) return { ok: false, msg: "Play Billing nahi mila — app update karo" }
    const { transaction } = await p.purchaseProduct({ productId: sku, referenceUUID: uid })
    return { ok: true, orderId: parseOrderId(transaction), msg: "Payment safal! 🎉" }
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e)
    if (/cancel|cancell|dismiss/i.test(m)) return { ok: false, msg: "Payment cancel kiya" }
    return { ok: false, msg: `Payment nahi hua: ${m.slice(0, 90)}` }
  }
}

/** Best-effort purchase receipt for the admin (audit trail). Never blocks the grant. */
export async function logPurchase(
  uid: string,
  e: { sku: string; orderId: string; kind: string; ref: string },
): Promise<void> {
  try {
    await set(ref(getFirebaseDb(), `purchases/${uid}/${e.orderId}`), {
      sku: e.sku,
      kind: e.kind,
      ref: e.ref,
      at: Date.now(),
    })
  } catch {
    /* audit only */
  }
}
