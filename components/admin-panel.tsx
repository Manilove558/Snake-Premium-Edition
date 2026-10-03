"use client"
import { useEffect, useMemo, useRef, useState } from "react"
import { useBackButton } from "@/hooks/use-back-button"
import { createPortal } from "react-dom"
import { usePanelState, usePanelTarget } from "./panel-host"
import {
  Shield, X, Plus, Pencil, Trash2, RotateCcw, EyeOff, Eye, Crown, Search,
  User as UserIcon, Users, Send, Upload, Megaphone, Coins, Gem, Copy, Check,
  CalendarDays, Tags, Clock3,
} from "lucide-react"
import { useAuthUser } from "@/lib/auth"
import {
  useIsAdmin, listAdmins, addAdminByCode, removeAdmin,
  saveCustomItem, saveOverride, deleteCustomItem, clearOverride, setItemHidden,
  saveCategory, deleteCategory, searchPlayers, type AdminEntry,
} from "@/lib/admin"
import { playerCodeOf, type PublicProfile } from "@/lib/friends"
import { sendMailToPlayer, sendNewsToAll, listNews, deleteNews, rewardText, MAX_MAIL_ITEMS, type NewsRow } from "@/lib/mailbox"
import {
  ITEM_BY_ID, useCatalog, refreshCatalog, MAX_AVATAR_DATA_URL, useHiddenItems, useCategories,
  categoryNamesOf, isLiveNow, type StoreItem, type Kind, type CatalogOverride, type Currency, type Category,
} from "@/lib/store"
import { boardSvg } from "@/lib/skin-preview"
import { PlayerAvatar } from "./player-avatar"

const glass = "bg-white/70 dark:bg-white/5 backdrop-blur-sm border border-black/5 dark:border-white/10 shadow-sm"
const SHAPES = ["dot", "square", "diamond", "star", "heart", "ring"]
const HEX_RE = /^#[0-9a-fA-F]{6}$/
const MAX_GIF_BYTES = 300_000

const inputCls = "w-full rounded-xl px-3 h-10 text-sm bg-black/5 dark:bg-white/10 border border-transparent outline-none focus:border-emerald-500 transition-colors"
const areaCls = "w-full rounded-xl px-3 py-2 text-sm bg-black/5 dark:bg-white/10 border border-transparent outline-none focus:border-emerald-500 transition-colors resize-none"
const btnPrimary = "d-pad-btn rounded-xl px-4 h-10 text-sm font-semibold text-white bg-gradient-to-r from-emerald-500 to-emerald-400 shadow-md shadow-emerald-500/30 disabled:opacity-50 inline-flex items-center justify-center gap-1.5"
const btnGhost = `d-pad-btn rounded-xl px-3 h-9 text-xs font-semibold ${glass} inline-flex items-center justify-center gap-1`
const iconBtn = "d-pad-btn h-9 w-9 rounded-xl flex items-center justify-center bg-black/5 dark:bg-white/10"
const pill = (on: boolean) =>
  `d-pad-btn shrink-0 text-[13px] font-medium px-3 py-1.5 rounded-full border transition-colors ${on
    ? "bg-emerald-500 border-emerald-500 text-white shadow-sm shadow-emerald-500/30"
    : "bg-white/60 dark:bg-white/5 border-black/10 dark:border-white/10 text-muted-foreground"}`

// ---------------------------------------------------------------- header button
export function AdminButton() {
  const admin = useIsAdmin()
  const [open, setOpen] = usePanelState("ADMIN")
  const panelTarget = usePanelTarget()
  if (!admin) return null
  return (
    <>
      <button
        aria-label="Admin panel"
        title="Admin panel"
        aria-pressed={open}
        onClick={() => setOpen(!open)}
        className="rounded-full d-pad-btn h-12 w-12 flex items-center justify-center bg-amber-400/20 text-amber-600 dark:text-amber-300 border border-amber-400/40"
      >
        <Shield className="h-5 w-5" />
      </button>
      {open && createPortal(<AdminPanel onClose={() => setOpen(false)} />, panelTarget)}
    </>
  )
}

// ---------------------------------------------------------------- small pieces
function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">{label}</div>
      {children}
      {hint && <div className="text-[10px] text-muted-foreground mt-1">{hint}</div>}
    </label>
  )
}

function Section({ title, icon, sub, children }: { title: string; icon: React.ReactNode; sub?: string; children: React.ReactNode }) {
  return (
    <section className={`rounded-2xl p-3 ${glass}`}>
      <div className="flex items-center gap-2">
        <span className="text-emerald-500">{icon}</span>
        <div className="text-sm font-bold">{title}</div>
      </div>
      {sub && <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div>}
      <div className="mt-2.5">{children}</div>
    </section>
  )
}

function Toast({ msg }: { msg: string }) {
  if (!msg) return null
  return (
    <div className="fixed z-[260] left-1/2 -translate-x-1/2 bottom-[max(24px,var(--sai-bottom))] max-w-[90vw] rounded-full px-5 py-2.5 text-sm font-semibold text-white bg-emerald-500 shadow-lg shadow-emerald-500/40 animate-fade-in">
      {msg}
    </div>
  )
}

function priceText(it: StoreItem) {
  if (it.price === 0 && !it.vipOnly) return "Free"
  if (it.vipOnly && it.price === 0) return "VIP only"
  return it.currency === "inr" ? `₹${it.price}` : `${it.price.toLocaleString()} ${it.currency === "gems" ? "gems" : "coins"}`
}

/** Preview that works for unsaved drafts too (does not go through the catalog). */
function DraftPreview({ item, size = 56 }: { item: StoreItem; size?: number }) {
  if (item.kind === "avatar") {
    if (item.img) {
      // eslint-disable-next-line @next/next/no-img-element
      return <img src={item.imgStill || item.img} alt={item.name} style={{ width: size, height: size }} className="rounded-full object-cover ring-2 ring-emerald-500 bg-white" />
    }
    return (
      <div
        className="rounded-full flex items-center justify-center ring-2 ring-emerald-500"
        style={{ width: size, height: size, fontSize: size * 0.47, background: item.bg ? `linear-gradient(135deg, ${item.bg[0]}, ${item.bg[1]})` : "#10b981" }}
      >
        <span>{item.emoji || "🙂"}</span>
      </div>
    )
  }
  return <div className="w-full h-16 rounded-lg overflow-hidden border border-black/10 dark:border-white/10" dangerouslySetInnerHTML={{ __html: boardSvg(item, false) }} />
}

// ---------------------------------------------------------------- avatar image upload
const toDataUrl = (blobOrBuf: Blob) =>
  new Promise<string>((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(String(r.result))
    r.onerror = () => rej(new Error("File padh nahi paya"))
    r.readAsDataURL(blobOrBuf)
  })

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((res, rej) => {
    const im = new Image()
    im.onload = () => res(im)
    im.onerror = () => rej(new Error("Ye image khul nahi rahi"))
    im.src = src
  })

/** Square, centre-cropped canvas of an image (avatars are round, so 256px is plenty). */
function squareCanvas(im: HTMLImageElement, px = 256): HTMLCanvasElement {
  const c = document.createElement("canvas")
  c.width = c.height = px
  const ctx = c.getContext("2d")!
  const side = Math.min(im.naturalWidth, im.naturalHeight)
  ctx.drawImage(im, (im.naturalWidth - side) / 2, (im.naturalHeight - side) / 2, side, side, 0, 0, px, px)
  return c
}

/** GIF: drop the "loop forever" block so it plays exactly once (bytes are otherwise untouched). */
function stripGifLoop(buf: Uint8Array): Uint8Array {
  const sig = [0x21, 0xff, 0x0b, 0x4e, 0x45, 0x54, 0x53, 0x43, 0x41, 0x50, 0x45, 0x32, 0x2e, 0x30] // ext + "NETSCAPE2.0"
  for (let i = 0; i < Math.min(buf.length - 19, 4096); i++) {
    if (sig.every((b, k) => buf[i + k] === b) && buf[i + 18] === 0x00) {
      const out = new Uint8Array(buf.length - 19)
      out.set(buf.subarray(0, i), 0)
      out.set(buf.subarray(i + 19), i)
      return out
    }
  }
  return buf
}

/** GIF total play duration in ms: sum of every frame's delay from its Graphic
 *  Control Extension block (0x21 0xF9 … 2-byte little-endian delay in 1/100 s).
 *  Falls back to 2500ms when no delays are found. */
function gifDurationMs(buf: Uint8Array): number {
  let total = 0
  for (let i = 0; i + 7 < buf.length; i++) {
    if (buf[i] === 0x21 && buf[i + 1] === 0xf9 && buf[i + 2] === 0x04) {
      total += (buf[i + 4] | (buf[i + 5] << 8)) * 10
    }
  }
  return Math.min(30000, Math.max(200, total > 0 ? total : 2500))
}

/** Turn an uploaded file into { img, imgStill? } data URLs small enough for the catalog. */
async function processAvatarFile(file: File): Promise<{ img: string; imgStill?: string; imgMs?: number }> {
  if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) throw new Error("Sirf PNG, JPG, WEBP ya GIF")
  if (file.type === "image/gif") {
    if (file.size > MAX_GIF_BYTES) throw new Error(`GIF ${Math.round(MAX_GIF_BYTES / 1000)}KB se chhota rakho (256×256 ke aas-paas resize karo)`)
    const bytes = stripGifLoop(new Uint8Array(await file.arrayBuffer()))
    // plain ArrayBuffer copy: newer lib.dom BlobPart rejects Uint8Array<ArrayBufferLike>
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    const img = await toDataUrl(new Blob([buf], { type: "image/gif" }))
    const still = squareCanvas(await loadImage(img)).toDataURL("image/png")
    if (img.length > MAX_AVATAR_DATA_URL || still.length > MAX_AVATAR_DATA_URL) throw new Error("GIF abhi bhi bhari hai, aur chhota karo")
    return { img, imgStill: still, imgMs: gifDurationMs(bytes) }
  }
  const im = await loadImage(await toDataUrl(file))
  const canvas = squareCanvas(im)
  for (const [type, q] of [["image/webp", 0.88], ["image/jpeg", 0.85], ["image/jpeg", 0.7]] as const) {
    const url = canvas.toDataURL(type, q)
    if (url.startsWith(`data:${type}`) && url.length <= MAX_AVATAR_DATA_URL) return { img: url }
  }
  const png = canvas.toDataURL("image/png")
  if (png.length <= MAX_AVATAR_DATA_URL) return { img: png }
  throw new Error("Image bahut bhari hai")
}

function AvatarUpload({ d, set, onError }: { d: StoreItem; set: (p: Partial<StoreItem>) => void; onError: (m: string) => void }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const pick = async (f?: File | null) => {
    if (!f) return
    setBusy(true)
    try {
      const r = await processAvatarFile(f)
      set({ img: r.img, imgStill: r.imgStill, imgMs: r.imgMs })
    } catch (e) {
      onError(e instanceof Error ? e.message : "Upload nahi hua")
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ""
    }
  }
  const isGif = !!d.img && (d.img.startsWith("data:image/gif") || d.img.endsWith(".gif"))
  return (
    <div className="col-span-2 space-y-2">
      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={busy}
        className="d-pad-btn w-full rounded-2xl border-2 border-dashed border-emerald-500/50 bg-emerald-500/5 py-3 flex flex-col items-center gap-1 text-sm font-semibold text-emerald-700 dark:text-emerald-300 disabled:opacity-60"
      >
        <Upload className="h-5 w-5" />
        {busy ? "Process ho raha hai…" : d.img ? "Dusri image chuno" : "Image / GIF chuno"}
        <span className="text-[11px] font-normal text-muted-foreground">PNG · JPG · WEBP · GIF (GIF max {Math.round(MAX_GIF_BYTES / 1000)}KB)</span>
      </button>
      {d.img && isGif && (
        <div className="rounded-xl bg-amber-400/15 text-amber-800 dark:text-amber-200 text-[11px] px-3 py-1.5">
          🎞️ GIF avatar: <b>Store</b> aur profile kholne par <b>ek baar</b> chalega, baaki jagah still frame dikhega.
        </div>
      )}
      <Field label="Ya path (public/avatars me file rakhi ho)">
        <input
          className={inputCls}
          value={d.img?.startsWith("data:") ? "" : d.img || ""}
          onChange={(e) => set({ img: e.target.value.trim(), imgStill: undefined, imgMs: undefined })}
          placeholder={d.img?.startsWith("data:") ? "Upload ki hui image use ho rahi hai" : "/avatars/my-avatar.png"}
        />
      </Field>
    </div>
  )
}

// ---------------------------------------------------------------- item form (bottom sheet)
function blankDraft(kind: Kind): StoreItem {
  const base: StoreItem = { id: "", kind, name: "", price: 0, currency: "coins" }
  if (kind === "skin") return { ...base, head: "#34d399", a: "#059669", b: "#10b981", glow: "#34d399" }
  if (kind === "trail") return { ...base, palette: ["#34d399", "#a7f3d0"], shape: "dot" }
  if (kind === "avatar") return { ...base, emoji: "🙂", bg: ["#34d399", "#059669"] }
  if (kind === "vip") return { ...base, name: "VIP Pass", price: 149, currency: "inr", days: 30 }
  return base
}

function Sheet({ title, onClose, children, compact }: { title: string; onClose: () => void; children: React.ReactNode; compact?: boolean }) {
  useBackButton(true, () => onClose()) // Android Back / the red ✕ close this sheet before the admin panel itself
  // Portal into the central frame (outside the Admin panel) so the sheet — search box, tabs, list — always sits ON TOP of the
  // Admin page. Rendered inside it, the Admin card's animation/transform trapped the `fixed` sheet and its top got hidden.
  const target = usePanelTarget()
  const node = (
    <div className={`snake-sheet fixed inset-0 z-[230] flex ${compact ? "items-center p-4" : "items-end sm:items-center"} justify-center bg-black/40 backdrop-blur-sm`} onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className={`${compact ? "w-full max-w-[340px] max-h-[70%] rounded-3xl" : "w-full max-w-md max-h-[90%] rounded-t-3xl sm:rounded-3xl"} overflow-y-auto overscroll-contain text-[#123321] dark:text-white bg-[#f1f4f1] dark:bg-[#0b0f14] border border-black/5 dark:border-white/10 p-4 shadow-2xl animate-fade-in text-[#123321] dark:text-white`}
        style={{ paddingBottom: "max(20px, var(--sai-bottom))" }}
      >
        <div className="flex items-center justify-between mb-2.5">
          <h3 className="text-lg font-bold text-emerald-500">{title}</h3>
          <button onClick={onClose} aria-label="Band karo" className={`d-pad-btn h-9 w-9 rounded-full flex items-center justify-center ${glass}`}><X className="h-4 w-4" /></button>
        </div>
        {children}
      </div>
    </div>
  )
  return target ? createPortal(node, target) : node
}

/** Admin decides how an item is sold: Free, Coins, Gems or real money (₹). */
const DEFAULT_PRICE: Record<Currency, number> = { coins: 500, gems: 100, inr: 49 }
function PriceEditor({ d, set }: { d: StoreItem; set: (p: Partial<StoreItem>) => void }) {
  const mode: "free" | Currency = d.price === 0 ? "free" : d.currency
  const pick = (m: "free" | Currency) => {
    if (m === "free") set({ price: 0, currency: "coins" })
    else set({ currency: m, price: d.price > 0 ? d.price : DEFAULT_PRICE[m] })
  }
  const opts: ["free" | Currency, string][] = [["free", "Free"], ["coins", "Coins"], ["gems", "Gems"], ["inr", "₹ INR"]]
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Price</div>
      <div className="flex gap-1.5 flex-wrap">
        {opts.map(([m, l]) => <button key={m} type="button" onClick={() => pick(m)} className={pill(mode === m)}>{l}</button>)}
      </div>
      {mode !== "free" && (
        <div className="mt-2 relative">
          <input type="number" min={1} className={`${inputCls} pr-16`} value={d.price} onChange={(e) => set({ price: Math.max(1, Math.floor(Number(e.target.value) || 1)) })} />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-semibold text-muted-foreground uppercase">{mode === "inr" ? "₹" : mode}</span>
        </div>
      )}
      {mode === "inr" && <div className="text-[10px] text-amber-600 dark:text-amber-300 mt-1">₹ payment tab kaam karega jab Google Play Billing juda ho. Tab tak ye item demo me bina paise ke mil jayega.</div>}
    </div>
  )
}

/** ms timestamp → "YYYY-MM-DDTHH:mm" for <input type="datetime-local"> */
const toLocalInput = (ts: number) => {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}
/** Short human text for a schedule, e.g. "12 Oct 10:00 → 20 Oct 18:00". */
function schedText(it: StoreItem): string {
  const f = (ts: number) => new Date(ts).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
  if (it.startAt && it.endAt) return `${f(it.startAt)} → ${f(it.endAt)}`
  if (it.startAt) return `${f(it.startAt)} se`
  if (it.endAt) return `${f(it.endAt)} tak`
  return ""
}

function ItemForm({ kind, initial, onDone, onClose }: { kind: Kind; initial?: StoreItem; onDone: (msg: string) => void; onClose: () => void }) {
  const isCustom = !!initial?.id.startsWith("custom_")
  const [d, setD] = useState<StoreItem>(() => (initial ? { ...initial } : blankDraft(kind)))
  const [avatarMode, setAvatarMode] = useState<"emoji" | "image">(() => (initial?.img ? "image" : "emoji"))
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState("")
  const set = (p: Partial<StoreItem>) => setD((x) => ({ ...x, ...p }))
  const cats = useCategories().filter((c) => c.kind === kind)
  const schedulable = kind === "skin" || kind === "trail" || kind === "food" || kind === "avatar"

  const finalize = (item: StoreItem): StoreItem => {
    if (kind === "avatar") {
      if (avatarMode === "image") {
        delete item.emoji; delete item.bg
        if (!item.imgStill) { delete item.imgStill; delete item.imgMs }
      }
      else { delete item.img; delete item.imgStill; delete item.imgMs }
    }
    return item
  }

  const save = async () => {
    if (!d.name.trim()) { setErr("Naam likho"); return }
    if (d.price < 0) { setErr("Price 0 ya zyada rakho"); return }
    if (kind === "avatar" && avatarMode === "image" && !d.img) { setErr("Pehle image chuno"); return }
    if (d.startAt && d.endAt && d.endAt <= d.startAt) { setErr("End date start date ke baad hona chahiye"); return }
    setSaving(true)
    setErr("")
    try {
      // categories / schedule: null = clear the field in the DB (RTDB deletes null keys)
      const cleanCats = [...new Set((d.categories || []).map((c) => c.trim().slice(0, 40)).filter(Boolean))].slice(0, 5)
      const catSched = {
        categories: cleanCats.length ? cleanCats : null,
        startAt: d.startAt || null,
        endAt: d.endAt || null,
      }
      if (!initial) {
        const id = `custom_${kind}_${Date.now().toString(36)}`
        const item = { ...finalize({ ...d, id, name: d.name.trim() }), ...catSched }
        await saveCustomItem(item as StoreItem)
        await refreshCatalog()
        onDone(`"${item.name}" ban gaya!`)
      } else if (isCustom) {
        const item = { ...finalize({ ...d, name: d.name.trim() }), ...catSched }
        await saveCustomItem(item as StoreItem)
        await refreshCatalog()
        onDone(`"${item.name}" update ho gaya`)
      } else {
        const b = ITEM_BY_ID[initial.id]
        const dd = finalize({ ...d })
        const ov: CatalogOverride = {}
        const keys = ["name", "vipOnly", "featured", "head", "a", "b", "glow", "rainbow", "palette", "shape", "emoji", "bg", "img", "imgStill", "imgMs", "days"] as const
        for (const k of keys) {
          const bv = (b as unknown as Record<string, unknown>)[k]
          const dv = (dd as unknown as Record<string, unknown>)[k]
          if (JSON.stringify(bv ?? null) !== JSON.stringify(dv ?? null)) (ov as Record<string, unknown>)[k] = dv
        }
        // pricing is written explicitly (an item without an admin price stays free by default)
        if (initial.price !== dd.price || initial.currency !== dd.currency) { ov.price = dd.price; ov.currency = dd.currency }
        // categories: compare as arrays (order-insensitive); null clears. Also clears the legacy `category` key.
        {
          const bCats = [...(initial.categories || [])].sort()
          const dCats = [...new Set((dd.categories || []).map((c) => c.trim().slice(0, 40)).filter(Boolean))].sort().slice(0, 5)
          if (JSON.stringify(bCats) !== JSON.stringify(dCats)) {
            (ov as Record<string, unknown>).categories = dCats.length ? dCats : null
            ;(ov as Record<string, unknown>).category = null
          }
        }
        // schedule: write only when changed; null clears a previously set value
        for (const k of ["startAt", "endAt"] as const) {
          const rawDv = (dd as unknown as Record<string, unknown>)[k]
          const bv = (initial as unknown as Record<string, unknown>)[k] ?? null
          const dv = (typeof rawDv === "string" ? rawDv.trim() : rawDv) || null
          if (bv !== dv) (ov as Record<string, unknown>)[k] = dv
        }
        if (!Object.keys(ov).length) { onDone("Kuch badla nahi"); return }
        await saveOverride(initial.id, ov)
        await refreshCatalog()
        onDone(`"${d.name}" update ho gaya`)
      }
    } catch (e) {
      setErr(e instanceof Error ? `Error: ${e.message}` : "Save nahi hua (rules publish hue?)")
    } finally {
      setSaving(false)
    }
  }

  const color = (label: string, key: "head" | "a" | "b" | "glow", fallback: string) => (
    <Field label={label}>
      <input type="color" className="h-9 w-full rounded-xl cursor-pointer bg-transparent" value={HEX_RE.test(d[key] || "") ? d[key]! : fallback} onChange={(e) => set({ [key]: e.target.value })} />
    </Field>
  )

  return (
    <Sheet title={initial ? (isCustom ? "Custom item edit" : "Item edit") : "Naya item"} onClose={onClose}>
      <div className={`flex items-center gap-3 rounded-2xl p-2.5 ${glass}`}>
        <div className={kind === "avatar" ? "" : "w-24"}><DraftPreview item={d} size={52} /></div>
        <div className="min-w-0">
          <div className="font-bold truncate">{d.name || "Naam likho…"}</div>
          <div className="text-[11px] text-muted-foreground">{priceText(d)}</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2.5 mt-2.5">
        <div className="col-span-2"><Field label="Naam"><input className={inputCls} value={d.name} onChange={(e) => set({ name: e.target.value })} placeholder="Item ka naam" /></Field></div>
        <div className="col-span-2"><PriceEditor d={d} set={set} /></div>
        <label className="col-span-2 flex items-center gap-2 text-[13px] rounded-xl px-3 h-10 border border-amber-400/40 bg-amber-400/10">
          <input type="checkbox" checked={!!d.vipOnly} onChange={(e) => set({ vipOnly: e.target.checked })} className="h-4 w-4 accent-amber-500" />
          <Crown className="h-4 w-4 text-amber-500" /> Sirf VIP walon ke liye <span className="text-[10px] text-muted-foreground">(price 0)</span>
        </label>

        {kind === "skin" && (<>
          {color("Head", "head", "#34d399")}
          {color("Body A", "a", "#059669")}
          {color("Body B", "b", "#10b981")}
          {color("Glow", "glow", "#34d399")}
          <label className="col-span-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={!!d.rainbow} onChange={(e) => set({ rainbow: e.target.checked })} className="h-4 w-4 accent-emerald-500" /> Rainbow effect</label>
        </>)}

        {kind === "trail" && (<>
          <div className="col-span-2"><Field label="Palette (comma se hex colors)"><input className={inputCls} value={(d.palette || []).join(", ")} onChange={(e) => set({ palette: e.target.value.split(",").map((s) => s.trim()).filter((s) => HEX_RE.test(s)).slice(0, 8) })} placeholder="#34d399, #a7f3d0" /></Field></div>
          <div className="col-span-2">
            <Field label="Shape">
              <select className={inputCls} value={d.shape || "dot"} onChange={(e) => set({ shape: e.target.value as StoreItem["shape"] })}>
                {SHAPES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
          </div>
        </>)}

        {kind === "avatar" && (<>
          <div className="col-span-2 flex gap-1.5">
            {(["emoji", "image"] as const).map((m) => (
              <button key={m} onClick={() => setAvatarMode(m)} className={pill(avatarMode === m)}>
                {m === "emoji" ? "Emoji" : "Image / GIF"}
              </button>
            ))}
          </div>
          {avatarMode === "emoji" ? (<>
            <div className="col-span-2"><Field label="Emoji"><input className={inputCls} value={d.emoji || ""} onChange={(e) => set({ emoji: [...e.target.value].slice(0, 4).join("") })} placeholder="🐍" /></Field></div>
            <Field label="BG 1"><input type="color" className="h-9 w-full rounded-xl cursor-pointer bg-transparent" value={HEX_RE.test(d.bg?.[0] || "") ? d.bg![0] : "#34d399"} onChange={(e) => set({ bg: [e.target.value, d.bg?.[1] || "#059669"] })} /></Field>
            <Field label="BG 2"><input type="color" className="h-9 w-full rounded-xl cursor-pointer bg-transparent" value={HEX_RE.test(d.bg?.[1] || "") ? d.bg![1] : "#059669"} onChange={(e) => set({ bg: [d.bg?.[0] || "#34d399", e.target.value] })} /></Field>
          </>) : (
            <AvatarUpload d={d} set={set} onError={setErr} />
          )}
        </>)}

        {kind === "vip" && (
          <div className="col-span-2"><Field label="Duration (days)"><input type="number" min={1} max={365} className={inputCls} value={d.days || 30} onChange={(e) => set({ days: Math.max(1, Math.min(365, Math.floor(Number(e.target.value) || 30))) })} /></Field></div>
        )}

        {kind !== "vip" && (
          <div className="col-span-2">
            <Field label="Categories" hint={cats.length ? undefined : "Pehle 'Categories' tab me banao, phir yahan chunna (max 5)"}>
              {cats.length === 0 ? (
                <div className="text-[12px] text-muted-foreground">Koi category nahi bani</div>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {cats.map((c) => {
                    const on = (d.categories || []).includes(c.id)
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => {
                          const cur = d.categories || []
                          set({ categories: on ? cur.filter((x) => x !== c.id) : [...cur, c.id].slice(0, 5) })
                        }}
                        className={`${pill(on)} inline-flex items-center gap-1`}
                      >
                        {on && <Check className="h-3 w-3" />}{c.name}
                      </button>
                    )
                  })}
                </div>
              )}
            </Field>
          </div>
        )}

        {schedulable && (
          <>
            <div className="col-span-2">
              <Field label="Schedule (optional)" hint="Khali rakho = hamesha dikhega. Date lagao = store me sirf uss time dikhega.">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <div className="text-[10px] text-muted-foreground mb-1">Start</div>
                    <input type="datetime-local" className={inputCls} value={d.startAt ? toLocalInput(d.startAt) : ""} onChange={(e) => set({ startAt: e.target.value ? new Date(e.target.value).getTime() : undefined })} />
                  </div>
                  <div>
                    <div className="text-[10px] text-muted-foreground mb-1">End</div>
                    <input type="datetime-local" className={inputCls} value={d.endAt ? toLocalInput(d.endAt) : ""} onChange={(e) => set({ endAt: e.target.value ? new Date(e.target.value).getTime() : undefined })} />
                  </div>
                </div>
              </Field>
            </div>
            {(d.startAt || d.endAt) && (
              <div className="col-span-2 -mt-1 flex items-center gap-1.5 text-[11px] text-sky-600 dark:text-sky-300">
                <Clock3 className="h-3.5 w-3.5" /> Store me dikhega: {schedText(d)}
              </div>
            )}
          </>
        )}
      </div>

      {err && <div className="mt-2.5 rounded-xl bg-red-500/10 text-red-600 dark:text-red-300 text-[13px] px-3 py-2">{err}</div>}
      <button onClick={save} disabled={saving} className={`${btnPrimary} w-full mt-3`}>
        {saving ? "Saving…" : initial ? "Save changes" : "Create item"}
      </button>
    </Sheet>
  )
}

// ---------------------------------------------------------------- item manager
function ItemManager({ kind, title, flash }: { kind: Kind; title: string; flash: (m: string) => void }) {
  const catalog = useCatalog()
  const items = useMemo(() => catalog.filter((i) => i.kind === kind), [catalog, kind])
  const [q, setQ] = useState("")
  const [editing, setEditing] = useState<StoreItem | null>(null)
  const [adding, setAdding] = useState(false)
  const shown = useMemo(() => items.filter((i) => i.name.toLowerCase().includes(q.trim().toLowerCase())), [items, q])
  const done = (m: string) => { flash(m); setEditing(null); setAdding(false) }

  const toggleDisable = async (it: StoreItem) => {
    try {
      await setItemHidden(it.id, true)
      await refreshCatalog()
      flash(`"${it.name}" hide ho gaya — "Hidden" tab me wapas la sakte ho`)
    } catch { flash("Nahi hua (rules publish hue?)") }
  }

  const del = async (it: StoreItem) => {
    if (!window.confirm(`"${it.name}" hamesha ke liye delete?`)) return
    try { await deleteCustomItem(it.id); await refreshCatalog(); flash("Delete ho gaya") } catch { flash("Nahi hua (rules publish hue?)") }
  }

  const reset = async (it: StoreItem) => {
    if (!window.confirm(`"${it.name}" ke saare admin changes hata du?`)) return
    try { await clearOverride(it.id); await refreshCatalog(); flash("Wapas original ho gaya") } catch { flash("Nahi hua (rules publish hue?)") }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input className={`${inputCls} pl-9`} value={q} onChange={(e) => setQ(e.target.value)} placeholder={`${title} dhundo… (${items.length})`} />
        </div>
        <button onClick={() => { setAdding(true); setEditing(null) }} className={`${btnPrimary} !px-3`} aria-label="Naya banao"><Plus className="h-4 w-4" /> Naya</button>
      </div>

      {shown.length === 0 && <div className="py-8 text-center text-sm text-muted-foreground">Kuch nahi mila</div>}

      <div className="space-y-1.5">
        {shown.map((it) => {
          const custom = it.id.startsWith("custom_")
          const catNames = categoryNamesOf(it)
          return (
            <div key={it.id} className={`rounded-2xl pl-2 pr-1.5 py-1.5 flex items-center gap-2.5 ${glass}`}>
              <div className="w-11 h-10 shrink-0 flex items-center justify-center overflow-hidden rounded-lg">
                {it.kind === "avatar"
                  ? <PlayerAvatar avatarId={it.id} vip size={36} ring={false} />
                  : it.kind === "vip"
                    ? <Crown className="h-6 w-6 text-amber-500" />
                    : <div className="w-full h-full rounded-lg overflow-hidden border border-black/10 dark:border-white/10" dangerouslySetInnerHTML={{ __html: boardSvg(it, false) }} />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-bold truncate leading-tight">{it.name}</div>
                <div className="text-[10px] text-muted-foreground flex items-center gap-1 flex-wrap leading-tight mt-0.5">
                  <span>{priceText(it)}</span>
                  {it.vipOnly && <span className="inline-flex items-center gap-0.5 text-amber-500 font-semibold"><Crown className="h-2.5 w-2.5" />VIP</span>}
                  {custom && <span className="rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 px-1.5 font-bold">CUSTOM</span>}
                  {it.imgStill && <span className="rounded-full bg-sky-500/15 text-sky-600 dark:text-sky-300 px-1.5 font-bold">GIF</span>}
                  {catNames.slice(0, 2).map((n) => (
                    <span key={n} className="inline-flex items-center gap-0.5 rounded-full bg-violet-500/15 text-violet-600 dark:text-violet-300 px-1.5 font-bold"><Tags className="h-2.5 w-2.5" />{n}</span>
                  ))}
                  {catNames.length > 2 && (
                    <span className="rounded-full bg-violet-500/15 text-violet-600 dark:text-violet-300 px-1.5 font-bold">+{catNames.length - 2}</span>
                  )}
                  {(it.startAt || it.endAt) && (
                    <span title={schedText(it)} className={`inline-flex items-center gap-0.5 rounded-full px-1.5 font-bold ${isLiveNow(it) ? "bg-sky-500/15 text-sky-600 dark:text-sky-300" : "bg-amber-500/15 text-amber-600 dark:text-amber-300"}`}>
                      <CalendarDays className="h-2.5 w-2.5" />{isLiveNow(it) ? schedText(it) : "Scheduled (abhi hidden)"}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button title="Edit" aria-label="Edit" onClick={() => { setEditing(it); setAdding(false) }} className={iconBtn}><Pencil className="h-4 w-4" /></button>
                {!custom ? (<>
                  <button title="Hide" aria-label="Hide" onClick={() => toggleDisable(it)} className={iconBtn}><EyeOff className="h-4 w-4" /></button>
                  <button title="Reset" aria-label="Reset" onClick={() => reset(it)} className={iconBtn}><RotateCcw className="h-4 w-4" /></button>
                </>) : (
                  <button title="Delete" aria-label="Delete" onClick={() => del(it)} className="d-pad-btn h-9 w-9 rounded-xl flex items-center justify-center bg-red-500/15 text-red-600 dark:text-red-300"><Trash2 className="h-4 w-4" /></button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {adding && <ItemForm kind={kind} onDone={done} onClose={() => setAdding(false)} />}
      {editing && <ItemForm kind={editing.kind} initial={editing} onDone={done} onClose={() => setEditing(null)} />}
    </div>
  )
}

// ---------------------------------------------------------------- hidden items tab
const KIND_LABEL: Record<Kind, string> = { skin: "Skin", trail: "Trail", food: "Food", avatar: "Avatar", vip: "VIP" }

function HiddenTab({ flash }: { flash: (m: string) => void }) {
  const hidden = useHiddenItems()
  const [q, setQ] = useState("")
  const shown = useMemo(() => hidden.filter((i) => i.name.toLowerCase().includes(q.trim().toLowerCase())), [hidden, q])

  const unhide = async (it: StoreItem) => {
    try {
      await setItemHidden(it.id, false)
      await refreshCatalog()
      flash(`"${it.name}" wapas store me dikhega`)
    } catch { flash("Nahi hua (rules publish hue?)") }
  }

  return (
    <div className="space-y-2">
      <Section title={`Hidden items (${hidden.length})`} icon={<EyeOff className="h-4 w-4" />} sub="Ye items store me nahi dikhte. Yahan se wapas la sakte ho.">
        <div className="relative">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input className={`${inputCls} pl-9`} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Hidden item dhundo…" />
        </div>
      </Section>
      {shown.length === 0 && (
        <div className="py-10 text-center text-sm text-muted-foreground">
          {hidden.length === 0 ? "Koi item hidden nahi hai 👍" : "Kuch nahi mila"}
        </div>
      )}
      <div className="space-y-1.5">
        {shown.map((it) => (
          <div key={it.id} className={`rounded-2xl pl-2 pr-1.5 py-1.5 flex items-center gap-2.5 ${glass}`}>
            <div className="w-11 h-10 shrink-0 flex items-center justify-center overflow-hidden rounded-lg opacity-70">
              {it.kind === "avatar"
                ? <PlayerAvatar avatarId={it.id} vip size={36} ring={false} />
                : it.kind === "vip"
                  ? <Crown className="h-6 w-6 text-amber-500" />
                  : <div className="w-full h-full rounded-lg overflow-hidden border border-black/10 dark:border-white/10" dangerouslySetInnerHTML={{ __html: boardSvg(it, false) }} />}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-bold truncate leading-tight">{it.name}</div>
              <div className="text-[10px] text-muted-foreground leading-tight mt-0.5">{KIND_LABEL[it.kind]}{it.vipOnly ? " · VIP" : ""}</div>
            </div>
            <button onClick={() => unhide(it)} className={`${btnGhost} !h-9`} title="Wapas dikhao">
              <Eye className="h-4 w-4 text-emerald-500" /> Unhide
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- categories tab
const CAT_KINDS: { id: Kind; label: string }[] = [
  { id: "skin", label: "Skins" },
  { id: "trail", label: "Trails" },
  { id: "food", label: "Food" },
  { id: "avatar", label: "Avatars" },
]

function CategoriesTab({ flash }: { flash: (m: string) => void }) {
  const cats = useCategories()
  const catalog = useCatalog()
  const [name, setName] = useState("")
  const [kind, setKind] = useState<Kind>("skin")
  const [busy, setBusy] = useState(false)
  const counts = useMemo(() => {
    const m: Record<string, number> = {}
    for (const it of catalog) {
      const ids = it.categories && it.categories.length ? it.categories : it.category ? [it.category] : []
      for (const c of ids) m[c] = (m[c] || 0) + 1
    }
    return m
  }, [catalog])

  const add = async () => {
    const cleanName = name.trim().slice(0, 30)
    if (!cleanName) { flash("Category ka naam likho"); return }
    setBusy(true)
    try {
      const id = `cat_${kind}_${cleanName.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 24) || Date.now().toString(36)}`
      await saveCategory({ id, name: cleanName, kind })
      await refreshCatalog()
      setName("")
      flash(`"${cleanName}" category ban gayi`)
    } catch (e) {
      flash(e instanceof Error ? e.message : "Nahi bana (rules publish hue?)")
    } finally {
      setBusy(false)
    }
  }

  const del = async (c: Category) => {
    if (!window.confirm(`"${c.name}" category hata du? (items rahenge, bas grouping hategi)`)) return
    try { await deleteCategory(c.id); await refreshCatalog(); flash("Category hat gayi") }
    catch { flash("Nahi hua (rules publish hue?)") }
  }

  return (
    <div className="space-y-3">
      <Section title="Nayi category" icon={<Tags className="h-4 w-4" />} sub="Store me ye filter chips banenge. Item ko category item edit me lagao.">
        <div className="flex gap-1.5 flex-wrap mb-2.5">
          {CAT_KINDS.map((k) => <button key={k.id} type="button" onClick={() => setKind(k.id)} className={pill(kind === k.id)}>{k.label}</button>)}
        </div>
        <div className="flex gap-2">
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Jaise: Diwali Special" maxLength={30} />
          <button onClick={add} disabled={busy} className={btnPrimary}><Plus className="h-4 w-4" /> Banao</button>
        </div>
      </Section>

      {CAT_KINDS.map((k) => {
        const list = cats.filter((c) => c.kind === k.id)
        if (!list.length) return null
        return (
          <Section key={k.id} title={`${k.label} categories`} icon={<Tags className="h-4 w-4" />} sub={`${list.length} categories`}>
            <div className="space-y-1.5">
              {list.map((c) => (
                <div key={c.id} className={`rounded-xl px-3 py-2 flex items-center gap-2 ${glass}`}>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-bold truncate">{c.name}</div>
                    <div className="text-[10px] text-muted-foreground">{counts[c.id] || 0} items</div>
                  </div>
                  <button onClick={() => del(c)} title="Delete" aria-label="Delete" className="d-pad-btn h-9 w-9 rounded-xl flex items-center justify-center bg-red-500/15 text-red-600 dark:text-red-300">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          </Section>
        )
      })}
      {cats.length === 0 && <div className="py-8 text-center text-sm text-muted-foreground">Abhi koi category nahi — upar se banao</div>}
    </div>
  )
}

// ---------------------------------------------------------------- item picker (mail rewards)
const PICK_KINDS: { id: Kind | "all"; label: string }[] = [
  { id: "all", label: "Sab" }, { id: "skin", label: "Skins" }, { id: "trail", label: "Trails" }, { id: "food", label: "Food" }, { id: "avatar", label: "Avatars" }, { id: "vip", label: "VIP Pass" },
]
const BASE_IDS = ["skin_classic", "trail_none", "food_classic", "avatar_photo"]

function ItemPicker({ selected, onChange, vipDays, onVipDays, onClose }: {
  selected: string[]
  onChange: (ids: string[]) => void
  vipDays: number
  onVipDays: (n: number) => void
  onClose: () => void
}) {
  const catalog = useCatalog()
  const [q, setQ] = useState("")
  const [kind, setKind] = useState<Kind | "all">("all")
  const list = useMemo(
    () => catalog.filter((i) => (kind === "all" ? i.kind !== "vip" : i.kind === kind) && !BASE_IDS.includes(i.id) && i.name.toLowerCase().includes(q.trim().toLowerCase())),
    [catalog, kind, q],
  )
  const toggle = (it: StoreItem) => {
    // VIP Pass is gifted as days (not as an item id) — the mail claim extends the pass
    if (it.kind === "vip") {
      onVipDays(vipDays > 0 ? 0 : Math.max(1, Math.min(365, Math.floor(Number(it.days) || 30))))
      return
    }
    const id = it.id
    if (selected.includes(id)) onChange(selected.filter((x) => x !== id))
    else if (selected.length < MAX_MAIL_ITEMS) onChange([...selected, id])
  }
  const isOn = (it: StoreItem) => (it.kind === "vip" ? vipDays > 0 : selected.includes(it.id))
  return (
    <Sheet compact title={`Items chuno (${selected.length}/${MAX_MAIL_ITEMS})${vipDays > 0 ? ` + VIP ${vipDays} din` : ""}`} onClose={onClose}>
      <div className="relative">
        <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input className={`${inputCls} pl-9`} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Naam se dhundo…" />
      </div>
      <div className="flex gap-1.5 mt-2 overflow-x-auto [scrollbar-width:none]">
        {PICK_KINDS.map((k) => <button key={k.id} onClick={() => setKind(k.id)} className={pill(kind === k.id)}>{k.label}</button>)}
      </div>
      {kind === "vip" && (
        <div className="mt-2 rounded-xl bg-amber-400/10 border border-amber-400/30 text-amber-700 dark:text-amber-300 text-[11px] px-3 py-1.5">
          VIP Pass dino ke hisab se bheja jata hai — tap karne par {vipDays > 0 ? `${vipDays} din select hai (dobara tap = hatao)` : "pass ke din select honge"}.
        </div>
      )}
      <div className="mt-2.5 space-y-1.5">
        {list.length === 0 && <div className="py-6 text-center text-sm text-muted-foreground">Kuch nahi mila</div>}
        {list.map((it) => {
          const on = isOn(it)
          return (
            <button key={it.id} onClick={() => toggle(it)} className={`d-pad-btn w-full text-left rounded-2xl pl-2 pr-3 py-1.5 flex items-center gap-2.5 border ${on ? "border-emerald-500 bg-emerald-500/10" : `border-black/5 dark:border-white/10 ${glass}`}`}>
              <div className="w-11 h-10 shrink-0 flex items-center justify-center overflow-hidden rounded-lg">
                {it.kind === "avatar"
                  ? <PlayerAvatar avatarId={it.id} vip size={36} ring={false} />
                  : it.kind === "vip"
                    ? <Crown className="h-6 w-6 text-amber-500" />
                    : <div className="w-full h-full rounded-lg overflow-hidden border border-black/10 dark:border-white/10" dangerouslySetInnerHTML={{ __html: boardSvg(it, false) }} />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-bold truncate leading-tight">{it.name}</div>
                <div className="text-[10px] text-muted-foreground leading-tight mt-0.5 capitalize">{it.kind}{it.vipOnly ? " · VIP" : ""}{it.kind === "vip" && it.days ? ` · ${it.days} din` : ""}</div>
              </div>
              <span className={`h-6 w-6 shrink-0 rounded-full flex items-center justify-center ${on ? "bg-emerald-500 text-white" : "border border-black/20 dark:border-white/20"}`}>{on && <Check className="h-4 w-4" />}</span>
            </button>
          )
        })}
      </div>
      <button onClick={onClose} className={`${btnPrimary} w-full mt-3`}>Done ({selected.length}{vipDays > 0 ? ` + VIP ${vipDays}d` : ""})</button>
    </Sheet>
  )
}

// ---------------------------------------------------------------- mail tab
function MailTab({ flash }: { flash: (m: string) => void }) {
  const [target, setTarget] = useState<"player" | "all">("player")
  const [pid, setPid] = useState("")
  const [pq, setPq] = useState("")
  const [results, setResults] = useState<PublicProfile[]>([])
  const [searching, setSearching] = useState(false)
  const [picked, setPicked] = useState<PublicProfile | null>(null)
  const [title, setTitle] = useState("")
  const [body, setBody] = useState("")
  const [coins, setCoins] = useState(0)
  const [gems, setGems] = useState(0)
  const [vipDays, setVipDays] = useState(0)
  const [items, setItems] = useState<string[]>([])
  const [picking, setPicking] = useState(false)
  const catalog = useCatalog()
  const [sending, setSending] = useState(false)
  const [news, setNews] = useState<NewsRow[]>([])
  const reload = () => listNews().then(setNews).catch(() => {})
  useEffect(() => { reload() }, [])

  // player search (debounced): name or Player ID
  useEffect(() => {
    if (target !== "player" || picked || pq.trim().length < 2) { setResults([]); return }
    setSearching(true)
    const t = setTimeout(() => {
      searchPlayers(pq)
        .then((r) => setResults(r))
        .catch(() => setResults([]))
        .finally(() => setSearching(false))
    }, 350)
    return () => clearTimeout(t)
  }, [pq, target, picked])

  const pickPlayer = (p: PublicProfile) => {
    setPicked(p)
    setPid(p.pid)
    setResults([])
  }
  const clearPlayer = () => { setPicked(null); setPid(""); setPq(""); setResults([]) }

  const resetRewards = () => { setCoins(0); setGems(0); setVipDays(0); setItems([]) }

  const send = async () => {
    if (target === "all" && !window.confirm("Ye SABHI players ko jayega. Pakka bhejna hai?")) return
    setSending(true)
    try {
      const draft = { title, body, coins, gems, vipDays, items }
      const r = target === "all" ? await sendNewsToAll(draft) : await sendMailToPlayer(pid, draft)
      flash(r.msg)
      if (r.ok) { setTitle(""); setBody(""); setCoins(0); setGems(0); setVipDays(0); setItems([]); if (target === "all") reload() }
    } catch (e) {
      flash(e instanceof Error ? e.message : "Nahi bheja (rules publish hue?)")
    } finally {
      setSending(false)
    }
  }

  const num = (set: (n: number) => void) => (e: React.ChangeEvent<HTMLInputElement>) => set(Math.max(0, Math.min(100000000, Math.floor(Number(e.target.value) || 0))))

  return (
    <div className="space-y-3">
      <Section title="News / Reward bhejo" icon={<Send className="h-4 w-4" />} sub="Player ke Mailbox (🔔) me aayega, reward wo khud Claim karega.">
        <div className="flex gap-1.5">
          {([["player", "Ek player ko", <UserIcon key="u" className="h-3.5 w-3.5" />], ["all", "Sabhi ko", <Users key="a" className="h-3.5 w-3.5" />]] as const).map(([v, l, ic]) => (
            <button key={v} onClick={() => setTarget(v)} className={`${pill(target === v)} inline-flex items-center gap-1`}>{ic}{l}</button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-2.5 mt-2.5">
          {target === "player" && (
            <div className="col-span-2">
              <Field label="Player dhundo (naam ya Player ID)">
                {picked ? (
                  <div className={`rounded-xl px-3 py-2 flex items-center gap-2.5 ${glass}`}>
                    <PlayerAvatar photo={picked.photo} avatarId={picked.avatar} vip={picked.vip} size={32} ring={false} />
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-bold truncate">{picked.name}</div>
                      <div className="text-[10px] text-muted-foreground font-mono tracking-widest">{picked.pid}</div>
                    </div>
                    <button onClick={clearPlayer} aria-label="Hatao" className="d-pad-btn h-8 w-8 rounded-full flex items-center justify-center bg-black/5 dark:bg-white/10">
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <div className="relative">
                    <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <input
                      className={`${inputCls} pl-9`}
                      value={pq}
                      onChange={(e) => setPq(e.target.value)}
                      placeholder="Naam ya ID likho… (kam se kam 2 akshar)"
                    />
                    {(searching || results.length > 0) && (
                      <div className={`absolute z-10 left-0 right-0 top-full mt-1 rounded-2xl overflow-hidden ${glass} max-h-56 overflow-y-auto`}>
                        {searching && <div className="px-3 py-2.5 text-[12px] text-muted-foreground">Dhund raha hu…</div>}
                        {!searching && results.map((p) => (
                          <button key={p.uid} onClick={() => pickPlayer(p)} className="d-pad-btn w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-emerald-500/10">
                            <PlayerAvatar photo={p.photo} avatarId={p.avatar} vip={p.vip} size={30} ring={false} />
                            <span className="flex-1 min-w-0">
                              <span className="block text-[13px] font-bold truncate">{p.name}</span>
                              <span className="block text-[10px] text-muted-foreground font-mono tracking-widest">{p.pid}</span>
                            </span>
                          </button>
                        ))}
                        {!searching && results.length === 0 && pq.trim().length >= 2 && (
                          <div className="px-3 py-2.5 text-[12px] text-muted-foreground">Koi player nahi mila</div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </Field>
            </div>
          )}
          <div className="col-span-2"><Field label="Title"><input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Jaise: Diwali gift 🪔" maxLength={80} /></Field></div>
          <div className="col-span-2"><Field label="Message (optional)"><textarea className={areaCls} rows={2} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Player ko kya batana hai…" maxLength={600} /></Field></div>
          <Field label="Coins reward"><div className="relative"><Coins className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-amber-500" /><input type="number" min={0} className={`${inputCls} pl-9`} value={coins} onChange={num(setCoins)} /></div></Field>
          <Field label="Gems reward"><div className="relative"><Gem className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-sky-500" /><input type="number" min={0} className={`${inputCls} pl-9`} value={gems} onChange={num(setGems)} /></div></Field>
          <Field label="VIP Pass (din)"><div className="relative"><Crown className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-amber-500" /><input type="number" min={0} max={365} className={`${inputCls} pl-9`} value={vipDays} onChange={(e) => setVipDays(Math.max(0, Math.min(365, Math.floor(Number(e.target.value) || 0))))} placeholder="0 = nahi" /></div></Field>
          <Field label="Skins / Items">
            <button type="button" onClick={() => setPicking(true)} className={`${inputCls} text-left flex items-center justify-between gap-2`}>
              <span className={items.length ? "font-semibold" : "text-muted-foreground"}>{items.length ? `${items.length} chune` : "Chuno…"}</span>
              <Plus className="h-4 w-4 shrink-0 text-emerald-500" />
            </button>
          </Field>
          {items.length > 0 && (
            <div className="col-span-2 flex flex-wrap gap-1.5">
              {items.map((id) => (
                <button key={id} type="button" onClick={() => setItems(items.filter((x) => x !== id))} className="d-pad-btn inline-flex items-center gap-1 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 pl-2.5 pr-1.5 py-1 text-[11px] font-semibold">
                  {catalog.find((c) => c.id === id)?.name || id}<X className="h-3 w-3" />
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex gap-1.5 mt-2">
          <button onClick={() => { resetRewards() }} className={`${btnGhost} flex-1`}>Sirf news</button>
          <button onClick={() => { setCoins(10000); setGems(100) }} className={`${btnGhost} flex-1`}>10K + 100</button>
          <button onClick={() => setVipDays(30)} className={`${btnGhost} flex-1`}>VIP 30 din</button>
        </div>
        {picking && <ItemPicker selected={items} onChange={setItems} vipDays={vipDays} onVipDays={setVipDays} onClose={() => setPicking(false)} />}
        <button onClick={send} disabled={sending || !title.trim() || (target === "player" && pid.length !== 8)} className={`${btnPrimary} w-full mt-3`}>
          <Send className="h-4 w-4" /> {sending ? "Bhej raha hu…" : target === "all" ? "Sabko bhejo" : "Bhejo"}
        </button>
      </Section>

      <Section title="Sabko bheji hui news" icon={<Megaphone className="h-4 w-4" />} sub={`${news.length} news`}>
        {news.length === 0 ? (
          <div className="text-xs text-muted-foreground">Abhi koi broadcast nahi</div>
        ) : (
          <div className="space-y-1.5">
            {news.map((n) => (
              <div key={n.id} className="flex items-center gap-2 rounded-xl pl-3 pr-1.5 py-1.5 bg-black/5 dark:bg-white/10">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold truncate">{n.title}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {n.at ? new Date(n.at).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : ""}
                    {(n.coins > 0 || n.gems > 0 || n.vipDays > 0 || n.items.length > 0) && ` · 🎁 ${rewardText(n)}`}
                  </div>
                </div>
                <button
                  title="Delete"
                  onClick={async () => { if (window.confirm(`"${n.title}" sabke mailbox se hata du?`)) { await deleteNews(n.id).catch(() => flash("Nahi hua")); reload() } }}
                  className="d-pad-btn h-9 w-9 rounded-xl flex items-center justify-center bg-red-500/15 text-red-600 dark:text-red-300"
                ><Trash2 className="h-4 w-4" /></button>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  )
}

// ---------------------------------------------------------------- players tab (admins)
function PlayersTab({ flash }: { flash: (m: string) => void }) {
  const [admins, setAdmins] = useState<AdminEntry[]>([])
  const [newAdmin, setNewAdmin] = useState("")
  const reloadAdmins = () => listAdmins().then(setAdmins).catch(() => {})
  useEffect(() => { reloadAdmins() }, [])

  const addA = async () => {
    const r = await addAdminByCode(newAdmin.trim()).catch((e) => ({ ok: false, msg: e instanceof Error ? e.message : "Error" }))
    flash(r.msg)
    if (r.ok) { setNewAdmin(""); reloadAdmins() }
  }

  return (
    <div className="space-y-3">
      <Section title="Admins" icon={<Shield className="h-4 w-4" />} sub="IOXN75FA hamesha main admin rahega.">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between rounded-xl px-3 py-2 border border-amber-400/40 bg-amber-400/10">
            <span className="text-sm font-mono font-bold tracking-widest">IOXN75FA</span>
            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-700 dark:text-amber-300"><Crown className="h-3.5 w-3.5" /> MAIN ADMIN</span>
          </div>
          {admins.map((a) => (
            <div key={a.uid} className="flex items-center justify-between rounded-xl px-3 py-2 bg-black/5 dark:bg-white/10">
              <span className="text-sm font-mono font-bold tracking-widest">{a.pid}</span>
              <button onClick={() => removeAdmin(a.uid).then(reloadAdmins)} className="text-xs text-red-500 font-semibold">Hatao</button>
            </div>
          ))}
          {admins.length === 0 && <div className="text-xs text-muted-foreground px-1">Koi extra admin nahi</div>}
        </div>
        <div className="flex gap-2 mt-2.5">
          <input className={`${inputCls} font-mono tracking-widest`} value={newAdmin} onChange={(e) => setNewAdmin(e.target.value.toUpperCase())} placeholder="Player ID" maxLength={8} />
          <button onClick={addA} className={btnPrimary}>Add</button>
        </div>
      </Section>
    </div>
  )
}

// ---------------------------------------------------------------- panel
type PanelTab = "skins" | "trails" | "food" | "avatars" | "vip" | "mail" | "players" | "hidden" | "cats"

export function AdminPanel({ onClose }: { onClose: () => void }) {
  const { user } = useAuthUser()
  const myPid = user ? playerCodeOf(user.uid) : ""
  const [tab, setTab] = useState<PanelTab>("skins")
  const [toast, setToast] = useState("")
  const [copied, setCopied] = useState(false)
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(""), 2600) }
  const hiddenCount = useHiddenItems().length
  const TABS: { id: PanelTab; label: string }[] = [
    { id: "skins", label: "Skins" },
    { id: "trails", label: "Trails" },
    { id: "food", label: "Food" },
    { id: "avatars", label: "Avatars" },
    { id: "vip", label: "VIP" },
    { id: "hidden", label: `Hidden${hiddenCount ? ` (${hiddenCount})` : ""}` },
    { id: "cats", label: "Categories" },
    { id: "mail", label: "Mail" },
    { id: "players", label: "Admins" },
  ]

  useBackButton(true, () => onClose())
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => { document.body.style.overflow = prev }
  }, [])
  const close = () => onClose()

  return (
    <div
      className="absolute inset-0 z-[10] backdrop-blur-md bg-black/25 dark:bg-black/50 text-[#123321] dark:text-white"
      style={{ paddingTop: "max(8px, var(--sai-top))", paddingBottom: "max(8px, var(--sai-bottom))" }}
    >
      <div className="mx-2 sm:mx-auto max-w-2xl h-full flex flex-col rounded-3xl animate-fade-in shadow-2xl border border-white/40 dark:border-white/10 bg-[#f1f4f1]/95 dark:bg-[#0b0f14]/95 overflow-hidden">
        {/* header */}
        <div className="shrink-0 px-4 pt-3.5 pb-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <h2 className="text-2xl leading-7 font-bold text-emerald-500 flex items-center gap-1.5"><Shield className="h-5 w-5" /> Admin</h2>
              {myPid && (
                <button
                  onClick={() => { navigator.clipboard?.writeText(myPid).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1400) }).catch(() => {}) }}
                  className="d-pad-btn inline-flex items-center gap-1 text-[10px] tracking-[.15em] text-muted-foreground uppercase"
                >
                  ID · {myPid} {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3 opacity-60" />}
                </button>
              )}
            </div>
            <button onClick={close} aria-label="Back" className={`panel-inner-close d-pad-btn h-10 w-10 rounded-full flex items-center justify-center ${glass}`}><X className="h-5 w-5" /></button>
          </div>
          <div className="flex gap-1.5 mt-2.5 overflow-x-auto -mx-4 px-4 [scrollbar-width:none]">
            {TABS.map((t) => (
              <button key={t.id} onClick={() => setTab(t.id)} className={pill(tab === t.id)}>{t.label}</button>
            ))}
          </div>
        </div>

        {/* body */}
        <div className="flex-1 overflow-y-auto overscroll-contain px-4 pt-1 pb-6">
          {tab === "skins" && <ItemManager kind="skin" title="Skins" flash={flash} />}
          {tab === "trails" && <ItemManager kind="trail" title="Trails" flash={flash} />}
          {tab === "food" && <ItemManager kind="food" title="Food" flash={flash} />}
          {tab === "avatars" && <ItemManager kind="avatar" title="Avatars" flash={flash} />}
          {tab === "vip" && <ItemManager kind="vip" title="VIP Pass" flash={flash} />}
          {tab === "hidden" && <HiddenTab flash={flash} />}
          {tab === "cats" && <CategoriesTab flash={flash} />}
          {tab === "mail" && <MailTab flash={flash} />}
          {tab === "players" && <PlayersTab flash={flash} />}
        </div>
      </div>
      <Toast msg={toast} />
    </div>
  )
}
