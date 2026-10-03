"use client"
import { useEffect, useMemo, useState } from "react"
import { useBackButton } from "@/hooks/use-back-button"
import { createPortal } from "react-dom"
import { usePanelState, usePanelTarget } from "./panel-host"
import { Vault, ChevronLeft, Check, Lock, Crown } from "lucide-react"
import { useStore, useCatalog, equip, owns, isVip, type StoreItem } from "@/lib/store"
import { boardSvg } from "@/lib/skin-preview"
import { useAuthUser } from "@/lib/auth"
import { PlayerAvatar } from "./player-avatar"

type Slot = "skin" | "trail" | "food" | "avatar"
const TABS: [Slot, string][] = [["skin", "Skins"], ["trail", "Trails"], ["food", "Food"], ["avatar", "Avatars"]]
const SLOT_NAME: Record<Slot, string> = { skin: "Skin", trail: "Trail", food: "Food", avatar: "Avatar" }
const glass = "bg-white/70 dark:bg-white/5 backdrop-blur-sm border border-black/5 dark:border-white/10 shadow-sm"

/** Item picture. Defined OUTSIDE the Vault component so it is not re-created (and the GIF reset) on every render. */
function Preview({ it, size, photo, vip, dark, tap }: { it: StoreItem; size: number; photo?: string | null; vip: boolean; dark: boolean; tap?: boolean }) {
  if (it.kind === "avatar") {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-black/5 dark:bg-white/5">
        <PlayerAvatar photo={photo} avatarId={it.id} vip={vip} size={size} ring={false} tapToPlay={tap} />
      </div>
    )
  }
  return <div className="absolute inset-0" dangerouslySetInnerHTML={{ __html: boardSvg(it, dark) }} />
}

/** Vault: the player's own collection. Equipped items are pinned at the top; tap Equip on any owned item. */
export function SnakeVault() {
  const st = useStore()
  const { user } = useAuthUser()
  const catalog = useCatalog()
  const [open, setOpen] = usePanelState("VAULT")
  const panelTarget = usePanelTarget()
  const [tab, setTab] = useState<Slot>("skin")
  const [msg, setMsg] = useState("")
  const vip = isVip(st)
  const dark = useMemo(() => open && document.documentElement.classList.contains("dark"), [open])
  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(""), 1800) }

  // Android hardware/gesture Back closes the vault (central back stack)
  useBackButton(open, () => setOpen(false))
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => { document.body.style.overflow = prev }
  }, [open])
  const close = () => setOpen(false)

  const mine = (k: Slot): StoreItem[] => catalog.filter((i) => i.kind === k && owns(st, i.id))
  const list = mine(tab).sort((a, b) => Number(st.equipped[tab] === b.id) - Number(st.equipped[tab] === a.id))
  const equippedItem = (k: Slot) => catalog.find((i) => i.id === st.equipped[k])

  return (
    <>
      <button aria-label="Vault" onClick={() => setOpen(true)} className="d-pad-btn inline-flex items-center justify-center h-12 w-12 rounded-full hover:bg-accent hover:text-accent-foreground">
        <Vault className="h-5 w-5" />
      </button>
      {open && createPortal(
        <div className="absolute inset-0 z-[10] overflow-y-auto overscroll-contain backdrop-blur-md bg-black/25 dark:bg-black/50 text-[#123321] dark:text-white"
          style={{ paddingTop: "max(12px, var(--sai-top))", paddingBottom: "max(12px, var(--sai-bottom))" }}>
          <div className="relative mx-2 sm:mx-auto max-w-xl min-h-[calc(100%-0px)] rounded-3xl px-3.5 pt-3 pb-6 animate-fade-in shadow-2xl border border-white/40 dark:border-white/10 bg-[#f1f4f1]/95 dark:bg-[#0b0f14]/95">
            <div className="flex items-center justify-between">
              <div className="flex items-baseline gap-2">
                <h2 className="text-2xl leading-7 font-bold text-emerald-500">Vault</h2>
                <span className="text-[10px] tracking-[.15em] text-muted-foreground uppercase">Your collection</span>
              </div>
              <button aria-label="Back" onClick={close} className={`panel-inner-close d-pad-btn h-12 w-12 rounded-full flex items-center justify-center ${glass}`}><ChevronLeft className="h-5 w-5" /></button>
            </div>

            {/* Equipped — always on top, one compact row */}
            <div className="mt-3 text-[10px] uppercase tracking-wider text-muted-foreground">Equipped</div>
            <div className="grid grid-cols-4 gap-2 mt-1.5">
              {TABS.map(([k]) => {
                const it = equippedItem(k)
                return (
                  <div key={k} role="button" tabIndex={0} onClick={() => setTab(k)} onKeyDown={(e) => { if (e.key === "Enter") setTab(k) }}
                    className={`d-pad-btn cursor-pointer rounded-xl p-1 flex flex-col ring-1 ${tab === k ? "ring-2 ring-emerald-500" : "ring-emerald-500/40"} ${glass}`}>
                    <div className="relative w-full aspect-square rounded-lg overflow-hidden border border-black/10 dark:border-white/10">
                      {it ? <Preview it={it} size={34} photo={user?.photoURL} vip={vip} dark={dark} /> : <div className="absolute inset-0 flex items-center justify-center text-[10px] text-muted-foreground">None</div>}
                    </div>
                    <div className="mt-1 text-center text-[9px] uppercase tracking-wider text-emerald-500 font-semibold leading-none">{SLOT_NAME[k]}</div>
                    <div className="text-center text-[10px] font-medium leading-tight truncate px-0.5">{it?.name ?? "—"}</div>
                  </div>
                )
              })}
            </div>

            {/* Tabs */}
            <div className="flex items-center gap-1.5 mt-3 overflow-x-auto [scrollbar-width:none]">
              {TABS.map(([k, n]) => (
                <button key={k} onClick={() => setTab(k)}
                  className={`d-pad-btn shrink-0 text-[12px] font-medium px-3 py-1.5 rounded-full border transition-colors ${tab === k
                    ? "bg-emerald-500 border-emerald-500 text-white shadow-sm shadow-emerald-500/30"
                    : "bg-white/60 dark:bg-white/5 border-black/10 dark:border-white/10 text-muted-foreground"}`}>{n} <span className="opacity-70">{mine(k).length}</span></button>
              ))}
            </div>

            {/* Owned items — small 3-column cards */}
            {list.length === 0 ? (
              <div className={`mt-3 rounded-xl p-5 text-center text-[12px] text-muted-foreground ${glass}`}>Nothing here yet — get {SLOT_NAME[tab].toLowerCase()}s from the Store.</div>
            ) : (
              <div className="grid grid-cols-3 gap-2 mt-2.5">
                {list.map((it) => {
                  const on = st.equipped[tab] === it.id
                  const locked = !!it.vipOnly && !vip
                  return (
                    <div key={it.id} className={`rounded-xl p-1.5 flex flex-col ${glass} ${on ? "ring-2 ring-emerald-500" : ""}`}>
                      <div className="relative w-full aspect-[4/3] rounded-lg overflow-hidden border border-black/10 dark:border-white/10">
                        <div className={`absolute inset-0 ${locked ? "opacity-60" : ""}`}><Preview it={it} size={40} photo={user?.photoURL} vip={vip} dark={dark} tap /></div>
                        {it.vipOnly && <span className="absolute top-0.5 left-0.5 inline-flex items-center rounded-full bg-amber-400 text-[#3b2a00] p-0.5"><Crown className="h-2.5 w-2.5" /></span>}
                        {locked && <span className="absolute inset-0 flex items-center justify-center pointer-events-none"><Lock className="h-4 w-4 text-white drop-shadow" /></span>}
                      </div>
                      <div className="mt-1 text-center text-[11px] font-semibold leading-tight truncate">{it.name}</div>
                      <button onClick={() => { if (!on) flash(equip(it.id).msg) }} disabled={on}
                        className={`d-pad-btn mt-1 h-7 rounded-lg text-[11px] font-semibold flex items-center justify-center gap-0.5 ${on
                          ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 border border-emerald-500/30"
                          : locked ? "bg-amber-400/20 text-amber-600 dark:text-amber-300 border border-amber-400/40"
                          : "bg-gradient-to-r from-emerald-500 to-emerald-400 text-white shadow shadow-emerald-500/30"}`}>
                        {on && <Check className="h-3 w-3" />}{locked && <Lock className="h-3 w-3" />}{on ? "Equipped" : locked ? "VIP" : "Equip"}
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
          {msg && <div className="fixed z-[120] left-1/2 -translate-x-1/2 bottom-[max(24px,var(--sai-bottom))] rounded-full px-5 py-2.5 text-sm font-semibold text-white bg-emerald-500 shadow-lg shadow-emerald-500/40">{msg}</div>}
        </div>, panelTarget)}
    </>
  )
}
