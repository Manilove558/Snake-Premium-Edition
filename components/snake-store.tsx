"use client"
import { useEffect, useMemo, useState } from "react"
import { createPortal } from "react-dom"
import { ShoppingBag, ChevronLeft, Check, Plus, X, Lock, Crown, Gift } from "lucide-react"
import { StoreItem, useStore, useCatalog, buy, equip, owns, isVip, vipDaysLeft, GEM_PACKS, COIN_PACKS, CURRENCY_SYMBOL, TEST_MODE, buyGemPack, buyCoinPack, claimVipDaily, vipDailyClaimed, VIP_DAILY, grantBlocker, grantAfterPurchaseItem, grantAfterPurchaseGems, isLiveNow, useCategories, type Kind } from "@/lib/store"
import { billingMode, skuForItem, skuForGemPack, usePlayPrices, purchaseSku, logPurchase } from "@/lib/billing"
import { boardSvg } from "@/lib/skin-preview"
import { useAuthUser } from "@/lib/auth"
import { PlayerAvatar } from "./player-avatar"

type Tab = "skins" | "trails" | "avatars" | "vip"
const HIDDEN = ["skin_classic", "trail_none", "food_classic"]
const equippable = (k: string) => k === "skin" || k === "trail" || k === "food" || k === "avatar"
const KIND: Record<string, string> = { skin: "Snake skin", trail: "Trail", food: "Food", avatar: "Avatar", vip: "Membership" }
const inTab = (t: Tab, i: StoreItem) =>
  t === "avatars" ? i.kind === "avatar" : i.vipOnly ? t === "vip" : t === "skins" ? i.kind === "skin" || i.kind === "food" : t === "trails" ? i.kind === "trail" : i.kind === "vip"
const VIP_PERKS = [
  ["2x coins", "Double coins from every food you eat"],
  ["+50% gems", "Extra gems on high-score rewards"],
  ["VIP avatars", "Exclusive profile pictures — use them anywhere"],
  [`Daily reward`, `${VIP_DAILY.coins} coins + ${VIP_DAILY.gems} gems every day`],
  ["VIP-only items", "Exclusive skins, trails and food"],
  ["👑 Crown", "Shown next to your name in multiplayer"],
]
const glass = "bg-white/70 dark:bg-white/5 backdrop-blur-sm border border-black/5 dark:border-white/10 shadow-sm"
const priceText = (it: StoreItem) => (it.currency === "inr" ? `${CURRENCY_SYMBOL}${it.price}` : `${it.price.toLocaleString()} ${it.currency === "gems" ? "Gems" : "Coins"}`)

export function SnakeStore() {
  const st = useStore()
  const { user } = useAuthUser()
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<Tab>("skins")
  const [cat, setCat] = useState("all")
  const cats = useCategories()
  const tabKinds: Record<Tab, Kind[]> = { skins: ["skin", "food"], trails: ["trail"], avatars: ["avatar"], vip: [] }
  const tabCats = cats.filter((c) => tabKinds[tab].includes(c.kind))
  const switchTab = (t: Tab) => { setTab(t); setCat("all") }
  const [msg, setMsg] = useState("")
  const [sheet, setSheet] = useState<null | "gems" | "coins">(null)
  const [busy, setBusy] = useState<string | null>(null)
  // Demo-mode confirm dialog: { kind: "item", it } for ₹ items, { kind: "gems", packId } for gem packs.
  // Only used when payMode === "demo" (no real money) so a stray tap doesn't instantly grant a paid item.
  const [confirmBuy, setConfirmBuy] = useState<null | { kind: "item"; it: StoreItem } | { kind: "gems"; packId: string }>(null)
  const payMode = billingMode() // "play" = real Google Play Billing (native Android, TEST_MODE off)
  const dark = useMemo(() => open && document.documentElement.classList.contains("dark"), [open])
  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(""), 1800) }

  // Android hardware/gesture Back closes the store instead of leaving the app
  useEffect(() => {
    if (!open) return
    history.pushState({ store: 1 }, "")
    const onPop = () => setOpen(false)
    window.addEventListener("popstate", onPop)
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => { window.removeEventListener("popstate", onPop); document.body.style.overflow = prev }
  }, [open])
  const close = () => { if (history.state?.store) history.back(); else setOpen(false) }

  const act = (it: StoreItem) => {
    if (it.kind === "vip" && isVip(st)) { flash(`VIP Pass active — ${vipDaysLeft(st)} day(s) left`); return }
    if (owns(st, it.id) && equippable(it.kind)) { flash(equip(it.id).msg); return }
    if (it.currency === "inr" && it.price > 0 && payMode === "play") { void buyReal(it); return }
    // Demo mode: ask for confirmation first — no payment sheet exists here, so don't grant on a stray tap.
    if (it.currency === "inr" && it.price > 0) { setConfirmBuy({ kind: "item", it }); return }
    const r = buy(it.id)
    flash(r.msg)
    if (!r.ok && it.vipOnly) setTab("vip")
  }

  /** Real-money purchase of a store item via the Google Play sheet (UPI / cards / redeem code). */
  const buyReal = async (it: StoreItem) => {
    if (busy) return
    const blocked = grantBlocker(it.id)
    if (blocked) { flash(blocked); return }
    const uid = user?.uid
    if (!uid) { flash("Pehle login karo"); return }
    setBusy(it.id)
    try {
      const sku = skuForItem(it.id)
      const r = await purchaseSku(sku, uid)
      if (!r.ok) { flash(r.msg); return }
      const g = grantAfterPurchaseItem(it.id)
      if (g.ok) void logPurchase(uid, { sku, orderId: r.orderId!, kind: it.kind, ref: it.id })
      flash(g.ok ? g.msg : `Paise kat gaye, item nahi mila — Order ID ${r.orderId} support ko bhejo`)
    } finally { setBusy(null) }
  }

  /** Real-money purchase of a gem pack via the Google Play sheet. */
  const buyGemPackFlow = async (packId: string) => {
    // Demo mode: confirm first, grant only after the user taps Confirm.
    if (payMode !== "play") { setConfirmBuy({ kind: "gems", packId }); return }
    if (busy) return
    const uid = user?.uid
    if (!uid) { flash("Pehle login karo"); return }
    setBusy(`gems_${packId}`)
    try {
      const sku = skuForGemPack(packId)
      const r = await purchaseSku(sku, uid)
      if (!r.ok) { flash(r.msg); return }
      const g = grantAfterPurchaseGems(packId)
      if (g.ok) void logPurchase(uid, { sku, orderId: r.orderId!, kind: "gems", ref: packId })
      flash(g.ok ? g.msg : `Paise kat gaye, gems nahi mile — Order ID ${r.orderId} support ko bhejo`)
    } finally { setBusy(null) }
  }

  /** Demo-mode confirm: grant the item / gems only after the user taps Confirm. */
  const confirmDemoBuy = () => {
    if (!confirmBuy) return
    if (confirmBuy.kind === "item") {
      const it = confirmBuy.it
      const r = buy(it.id)
      flash(r.msg)
      if (!r.ok && it.vipOnly) setTab("vip")
    } else {
      flash(buyGemPack(confirmBuy.packId).msg)
    }
    setConfirmBuy(null)
  }
  const Card = ({ it, wide }: { it: StoreItem; wide?: boolean }) => {
    const on = equippable(it.kind) && st.equipped[it.kind as "skin"] === it.id
    const ownedNow = owns(st, it.id) || (it.kind === "vip" && isVip(st))
    const locked = !!it.vipOnly && !isVip(st)
    const vipRunning = it.kind === "vip" && isVip(st)
    const text = on ? "Equipped" : locked ? "VIP only" : ownedNow && equippable(it.kind) ? "Equip" : it.kind === "vip" && isVip(st) ? `Active · ${vipDaysLeft(st)}d left` : it.vipOnly && it.price === 0 ? "Unlock" : it.price === 0 ? "FREE" : priceTextFor(it)
    return (
      <div className={`${wide ? "min-w-[68%] snap-start" : ""} rounded-2xl p-2 flex flex-col ${glass} ${on ? "ring-2 ring-emerald-500 shadow-emerald-500/30" : ""}`}>
        <div className="relative w-full aspect-[3/2] rounded-xl overflow-hidden border border-black/10 dark:border-white/10">
          {it.kind === "avatar"
            ? <div className={`absolute inset-0 flex items-center justify-center bg-black/5 dark:bg-white/5 ${locked ? "opacity-60" : ""}`}><PlayerAvatar photo={user?.photoURL} avatarId={it.id} vip size={64} ring={false} tapToPlay /></div>
            : <div className={`absolute inset-0 ${locked ? "opacity-60" : ""}`} dangerouslySetInnerHTML={{ __html: boardSvg(it, dark) }} />}
          {it.vipOnly && <span className="absolute top-1 left-1 inline-flex items-center gap-0.5 rounded-full bg-amber-400 text-[#3b2a00] text-[9px] font-bold px-1.5 py-0.5"><Crown className="h-2.5 w-2.5" />VIP</span>}
          {locked && <span className="absolute inset-0 flex items-center justify-center"><Lock className="h-6 w-6 text-white drop-shadow" /></span>}
        </div>
        <div className="mt-2 text-center">
          <div className="text-[13px] font-semibold leading-tight">{it.name}</div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-0.5">{KIND[it.kind]}</div>
        </div>
        <button onClick={() => act(it)} disabled={vipRunning || busy === it.id}
          className={`d-pad-btn mt-2 h-10 rounded-xl text-[13px] font-semibold flex items-center justify-center gap-1 ${vipRunning
            ? "bg-amber-400/15 text-amber-600 dark:text-amber-300 border border-amber-400/40 opacity-90"
            : on
            ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 border border-emerald-500/30"
            : locked ? "bg-amber-400/20 text-amber-600 dark:text-amber-300 border border-amber-400/40"
            : "bg-gradient-to-r from-emerald-500 to-emerald-400 text-white shadow-md shadow-emerald-500/30"}`}>
          {on && <Check className="h-3.5 w-3.5" />}{locked && <Lock className="h-3.5 w-3.5" />}{busy === it.id ? "Payment…" : text}
        </button>
      </div>
    )
  }
  const Pill = ({ label, value, onAdd }: { label: string; value: number; onAdd: () => void }) => (
    <div className={`rounded-2xl pl-4 pr-2 py-2 flex-1 flex items-center justify-between ${glass}`}>
      <div>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className="text-xl font-bold tabular-nums">{value.toLocaleString()}</div>
      </div>
      <button aria-label={`Get more ${label}`} onClick={onAdd} className="d-pad-btn h-9 w-9 rounded-full flex items-center justify-center bg-gradient-to-br from-emerald-500 to-emerald-400 text-white shadow-md shadow-emerald-500/30"><Plus className="h-5 w-5" /></button>
    </div>
  )
  const Row = ({ big, sub, tag, price, onClick }: { big: string; sub: string; tag?: string; price: string; onClick: () => void }) => (
    <button onClick={onClick} className={`d-pad-btn w-full rounded-2xl px-4 py-3 flex items-center justify-between text-left ${glass}`}>
      <div>
        <div className="text-base font-bold">{big} {tag && <span className="ml-1 text-[10px] uppercase tracking-wider align-middle rounded-full bg-amber-400/20 text-amber-600 dark:text-amber-300 px-2 py-0.5">{tag}</span>}</div>
        <div className="text-[11px] text-muted-foreground">{sub}</div>
      </div>
      <div className="rounded-xl px-4 h-10 min-w-[84px] flex items-center justify-center text-sm font-semibold text-white bg-gradient-to-r from-emerald-500 to-emerald-400 shadow-md shadow-emerald-500/30">{price}</div>
    </button>
  )

  const catalog = useCatalog()
  const inrSkus = useMemo(() => {
    if (payMode !== "play") return [] as string[]
    const set = new Set<string>()
    for (const it of catalog) if (it.currency === "inr" && it.price > 0) set.add(skuForItem(it.id))
    for (const pk of GEM_PACKS) set.add(skuForGemPack(pk.id))
    return [...set]
  }, [catalog, payMode])
  const playPrices = usePlayPrices(inrSkus)
  const priceTextFor = (it: StoreItem) =>
    it.currency === "inr" && payMode === "play"
      ? (playPrices[skuForItem(it.id)]?.display || `${CURRENCY_SYMBOL}${it.price}`)
      : priceText(it)
  const inCat = (i: StoreItem) => cat === "all" || (i.categories && i.categories.length ? i.categories : i.category ? [i.category] : []).includes(cat)
  const list = catalog.filter((i) => inTab(tab, i) && !HIDDEN.includes(i.id) && isLiveNow(i) && inCat(i))
  const pass = list.filter((i) => i.kind === "vip")
  const vipItems = list.filter((i) => i.kind !== "vip")
  const skinsL = list.filter((i) => i.kind === "skin"), foodL = list.filter((i) => i.kind === "food")
  const avatarFree = list.filter((i) => i.kind === "avatar" && !i.vipOnly), avatarVip = list.filter((i) => i.kind === "avatar" && i.vipOnly)
  const vipOn = isVip(st), claimed = vipDailyClaimed(st)
  const claim = () => flash(claimVipDaily().msg)
  // Demo confirm dialog text (only rendered when confirmBuy is set, i.e. demo mode)
  const cbPack = confirmBuy?.kind === "gems" ? GEM_PACKS.find((p) => p.id === confirmBuy.packId) : undefined
  const cbTitle = confirmBuy ? (confirmBuy.kind === "item" ? confirmBuy.it.name : `${(cbPack?.gems ?? 0).toLocaleString()} Gems`) : ""
  const cbSub = confirmBuy ? (confirmBuy.kind === "item" ? KIND[confirmBuy.it.kind] : "Gem pack") : ""
  const cbPrice = confirmBuy ? (confirmBuy.kind === "item" ? priceTextFor(confirmBuy.it) : `${CURRENCY_SYMBOL}${cbPack?.price ?? 0}`) : ""
  const Grid = ({ items }: { items: StoreItem[] }) => <div className="grid grid-cols-2 gap-3 mt-3">{items.map((it) => <Card key={it.id} it={it} />)}</div>
  const Head = ({ t, n }: { t: string; n: number }) => <div className="text-[11px] uppercase tracking-wider text-muted-foreground mt-5">{t} <span className="opacity-60">· {n}</span></div>
  return (
    <>
      <button aria-label="Store" onClick={() => setOpen(true)} className="d-pad-btn inline-flex items-center justify-center h-10 w-10 rounded-full hover:bg-accent hover:text-accent-foreground">
        <ShoppingBag className="h-5 w-5" />
      </button>
      {open && createPortal(
        <div className="fixed inset-0 z-[100] overflow-y-auto overscroll-contain backdrop-blur-md bg-black/25 dark:bg-black/50 text-[#123321] dark:text-white"
          style={{ paddingTop: "max(12px, env(safe-area-inset-top))", paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}>
          <div className="relative mx-3 sm:mx-auto max-w-md min-h-[calc(100%-0px)] rounded-3xl px-4 pt-5 pb-10 animate-fade-in shadow-2xl border border-white/40 dark:border-white/10 bg-[#f1f4f1]/95 dark:bg-[#0b0f14]/95">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-[28px] leading-8 font-bold text-emerald-500">Store</h2>
                <div className="text-[11px] tracking-[.15em] text-muted-foreground uppercase mt-0.5">Premium Edition</div>
              </div>
              <button aria-label="Back" onClick={close} className={`d-pad-btn h-10 w-10 rounded-full flex items-center justify-center ${glass}`}><ChevronLeft className="h-5 w-5" /></button>
            </div>

            <div className="flex gap-3 mt-4"><Pill label="Gems" value={st.gems} onAdd={() => setSheet("gems")} /><Pill label="Coins" value={st.coins} onAdd={() => setSheet("coins")} /></div>

            {isVip(st) && <div className="mt-2 text-[11px] text-amber-500">★ VIP active — coins x2 ({Math.ceil((st.vipUntil - Date.now()) / 864e5)} days left)</div>}

            <div className="flex items-center justify-center gap-1.5 mt-4">
              {([["skins", "Skins"], ["trails", "Trails"], ["avatars", "Avatars"], ["vip", "VIP Pass"]] as const).map(([k, n]) => (
                <button key={k} onClick={() => switchTab(k)}
                  className={`d-pad-btn text-sm font-medium px-3.5 py-2 rounded-full border transition-colors ${tab === k
                    ? "bg-emerald-500 border-emerald-500 text-white shadow-sm shadow-emerald-500/30"
                    : "bg-white/60 dark:bg-white/5 border-black/10 dark:border-white/10 text-muted-foreground"}`}>{n}</button>
              ))}
            </div>

            {tabCats.length > 0 && (
              <div className="flex items-center justify-start gap-1.5 mt-2.5 overflow-x-auto [scrollbar-width:none] -mx-4 px-4">
                <button onClick={() => setCat("all")}
                  className={`d-pad-btn shrink-0 text-[12px] font-medium px-3 py-1.5 rounded-full border transition-colors ${cat === "all"
                    ? "bg-emerald-500 border-emerald-500 text-white shadow-sm shadow-emerald-500/30"
                    : "bg-white/60 dark:bg-white/5 border-black/10 dark:border-white/10 text-muted-foreground"}`}>Sab</button>
                {tabCats.map((c) => (
                  <button key={c.id} onClick={() => setCat(c.id)}
                    className={`d-pad-btn shrink-0 text-[12px] font-medium px-3 py-1.5 rounded-full border transition-colors ${cat === c.id
                      ? "bg-emerald-500 border-emerald-500 text-white shadow-sm shadow-emerald-500/30"
                      : "bg-white/60 dark:bg-white/5 border-black/10 dark:border-white/10 text-muted-foreground"}`}>{c.name}</button>
                ))}
              </div>
            )}

            {tab === "skins" && (<><Head t="Snake skins" n={skinsL.length} /><Grid items={skinsL} /><Head t="Food" n={foodL.length} /><Grid items={foodL} /></>)}
            {tab === "trails" && <Grid items={list} />}
            {tab === "avatars" && (
              <>
                <div className={`mt-4 rounded-2xl p-3 flex items-center gap-3 ${glass}`}>
                  <PlayerAvatar photo={user?.photoURL} avatarId={st.equipped.avatar} vip={vipOn} size={52} tapToPlay />
                  <div className="text-[12px] text-muted-foreground leading-snug">Your profile picture. Everyone can see it on your profile and in multiplayer.</div>
                </div>
                <Head t="Free avatars" n={avatarFree.length} /><Grid items={avatarFree} />
                <Head t="VIP avatars" n={avatarVip.length} /><Grid items={avatarVip} />
              </>
            )}
            {tab === "vip" && (
              <>
                <div className={`mt-4 rounded-2xl p-4 border ${vipOn ? "border-amber-400/50 bg-amber-400/10" : "border-black/5 dark:border-white/10 bg-white/70 dark:bg-white/5"}`}>
                  <div className="flex items-center gap-2 text-amber-500 font-bold"><Crown className="h-5 w-5" />VIP perks</div>
                  <ul className="mt-2 space-y-1.5">
                    {VIP_PERKS.map(([t, d]) => (
                      <li key={t} className="flex gap-2 text-[13px]"><Check className="h-4 w-4 mt-0.5 shrink-0 text-emerald-500" /><span><b>{t}</b> <span className="text-muted-foreground">— {d}</span></span></li>
                    ))}
                  </ul>
                  <button onClick={claim} disabled={!vipOn || claimed}
                    className={`d-pad-btn mt-3 w-full h-11 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 ${vipOn && !claimed ? "bg-gradient-to-r from-amber-400 to-amber-300 text-[#3b2a00] shadow-md shadow-amber-400/40" : "bg-black/5 dark:bg-white/10 text-muted-foreground"}`}>
                    <Gift className="h-4 w-4" />{!vipOn ? "Daily reward (VIP only)" : claimed ? "Claimed today ✓" : `Claim daily: ${VIP_DAILY.coins} coins + ${VIP_DAILY.gems} gems`}
                  </button>
                </div>
                <Grid items={pass} />
                <Head t="VIP exclusive skins" n={vipItems.filter((i) => i.kind === "skin").length} /><Grid items={vipItems.filter((i) => i.kind === "skin")} />
                <Head t="VIP exclusive trails" n={vipItems.filter((i) => i.kind === "trail").length} /><Grid items={vipItems.filter((i) => i.kind === "trail")} />
                <Head t="VIP exclusive food" n={vipItems.filter((i) => i.kind === "food").length} /><Grid items={vipItems.filter((i) => i.kind === "food")} />
                <Head t="VIP exclusive avatars" n={vipItems.filter((i) => i.kind === "avatar").length} /><Grid items={vipItems.filter((i) => i.kind === "avatar")} />
              </>
            )}

            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-7 mb-2">Featured</div>
            <div className="flex gap-3 overflow-x-auto snap-x snap-mandatory pb-3 -mx-4 px-4 [scrollbar-width:none]">
              {catalog.filter((i) => i.featured && isLiveNow(i)).map((it) => <Card key={it.id} it={it} wide />)}
            </div>
            <p className="text-[10px] text-muted-foreground mt-3 text-center">Earn coins by eating food (VIP: x2) and gems from high scores.</p>
          </div>
          {sheet && (
            <div className="fixed inset-0 z-[110] flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setSheet(null)}>
              <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md max-h-[85%] overflow-y-auto rounded-t-3xl sm:rounded-3xl bg-[#f1f4f1] dark:bg-[#0b0f14] border border-black/5 dark:border-white/10 p-4 pb-8 shadow-2xl animate-fade-in text-[#123321] dark:text-white">
                <div className="flex items-center justify-between mb-1">
                  <h3 className="text-xl font-bold text-emerald-500">{sheet === "gems" ? "Get Gems" : "Get Coins"}</h3>
                  <button aria-label="Close" onClick={() => setSheet(null)} className={`d-pad-btn h-9 w-9 rounded-full flex items-center justify-center ${glass}`}><X className="h-4 w-4" /></button>
                </div>
                <p className="text-[11px] text-muted-foreground mb-3">
                  {sheet === "gems" ? (payMode === "play" ? "UPI, cards & redeem codes accepted" : `Buy with real money${TEST_MODE ? " — demo prices, nothing is charged yet" : ""}`) : `Buy with gems (you have ${st.gems.toLocaleString()})`}
                </p>
                <div className="space-y-2.5">
                  {sheet === "gems"
                    ? GEM_PACKS.map((p) => <Row key={p.id} big={`${p.gems.toLocaleString()} Gems`} sub="Use gems for coins and premium items" tag={p.tag} price={payMode === "play" ? (playPrices[skuForGemPack(p.id)]?.display || `${CURRENCY_SYMBOL}${p.price}`) : `${CURRENCY_SYMBOL}${p.price}`} onClick={() => { void buyGemPackFlow(p.id); }} />)
                    : COIN_PACKS.map((p) => <Row key={p.id} big={`${p.coins.toLocaleString()} Coins`} sub={`Costs ${p.gems.toLocaleString()} gems`} tag={p.tag} price={`${p.gems.toLocaleString()} Gems`}
                        onClick={() => { const r = buyCoinPack(p.id); flash(r.msg); if (r.needGems) setSheet("gems") }} />)}
                </div>
                {sheet === "coins" && <button onClick={() => setSheet("gems")} className="d-pad-btn mt-3 w-full h-11 rounded-xl text-sm font-semibold border border-emerald-500/40 text-emerald-600 dark:text-emerald-300">Need more gems? Buy gems</button>}
              </div>
            </div>
          )}
          {msg && <div className="fixed z-[120] left-1/2 -translate-x-1/2 bottom-[max(24px,env(safe-area-inset-bottom))] rounded-full px-5 py-2.5 text-sm font-semibold text-white bg-emerald-500 shadow-lg shadow-emerald-500/40">{msg}</div>}
          {confirmBuy && (
            <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/40 backdrop-blur-sm p-6" onClick={() => setConfirmBuy(null)}>
              <div onClick={(e) => e.stopPropagation()} className="w-full max-w-xs rounded-3xl bg-[#f1f4f1] dark:bg-[#0b0f14] border border-black/5 dark:border-white/10 p-5 shadow-2xl text-center text-[#123321] dark:text-white animate-fade-in">
                <div className="text-lg font-bold">{cbTitle}</div>
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground mt-0.5">{cbSub}</div>
                <div className="mt-2 text-2xl font-bold text-emerald-500">{cbPrice}</div>
                <p className="mt-2 text-[12px] text-muted-foreground leading-snug">Demo khareed hai — paise <b>nahi</b> katega. Confirm dabane par item turant mil jayega.</p>
                <div className="mt-4 flex gap-2">
                  <button onClick={() => setConfirmBuy(null)} className="d-pad-btn flex-1 h-11 rounded-xl text-sm font-semibold bg-black/5 dark:bg-white/10">Cancel</button>
                  <button onClick={confirmDemoBuy} className="d-pad-btn flex-1 h-11 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-emerald-500 to-emerald-400 shadow-md shadow-emerald-500/30">Confirm</button>
                </div>
              </div>
            </div>
          )}
        </div>, document.body)}
    </>
  )
}
