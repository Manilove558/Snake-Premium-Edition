"use client"
import { useEffect, useState } from "react"
import { useBackButton } from "@/hooks/use-back-button"
import { createPortal } from "react-dom"
import { usePanelState, usePanelTarget } from "./panel-host"
import { Bell, Check, Coins, Crown, Gem, Gift, Inbox, Megaphone, X } from "lucide-react"
import { useAuthUser } from "@/lib/auth"
import { claimAllMail, claimMail, hasReward as hasRew, markMailRead, useMailbox, type MailItem } from "@/lib/mailbox"
import { getCatalogItem } from "@/lib/store"

const glass = "bg-white/70 dark:bg-white/5 backdrop-blur-sm border border-black/5 dark:border-white/10 shadow-sm"

function timeAgo(at: number): string {
  if (!at) return ""
  const s = Math.max(1, Math.floor((Date.now() - at) / 1000))
  if (s < 60) return "abhi"
  if (s < 3600) return `${Math.floor(s / 60)} min pehle`
  if (s < 86400) return `${Math.floor(s / 3600)} ghante pehle`
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} din pehle`
  return new Date(at).toLocaleDateString([], { day: "numeric", month: "short" })
}

/** Header icon: bell with a red badge = unread news + rewards waiting to be claimed. */
export function MailboxButton() {
  const { user } = useAuthUser()
  const uid = user?.uid ?? null
  const { items, badge, claimable } = useMailbox(uid)
  const [open, setOpen] = usePanelState("MAILBOX")
  const panelTarget = usePanelTarget()
  if (!uid) return null

  return (
    <>
      <button
        aria-label={badge > 0 ? `Mailbox, ${badge} nayi` : "Mailbox"}
        title="Mailbox"
        onClick={() => setOpen(true)}
        className="relative d-pad-btn inline-flex items-center justify-center h-12 w-12 rounded-full hover:bg-accent hover:text-accent-foreground"
      >
        <Bell className={`h-5 w-5 ${badge > 0 ? "text-amber-500" : ""}`} />
        {badge > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold leading-[18px] text-center shadow">
            {badge > 99 ? "99+" : badge}
          </span>
        )}
      </button>
      {open && createPortal(<MailboxSheet uid={uid} items={items} claimable={claimable} onClose={() => setOpen(false)} />, panelTarget)}
    </>
  )
}

function MailboxSheet({ uid, items, claimable, onClose }: { uid: string; items: MailItem[]; claimable: number; onClose: () => void }) {
  useBackButton(true, () => onClose())
  const [msg, setMsg] = useState("")
  const [busy, setBusy] = useState<string | null>(null)
  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(""), 3000) }

  // opening the mailbox marks plain news as read; reward mails stay highlighted until claimed
  useEffect(() => {
    const unread = items.filter((m) => !m.read && !hasRew(m)).map((m) => m.key)
    if (unread.length) markMailRead(uid, unread)
  }, [items, uid])

  const claim = async (m: MailItem) => {
    setBusy(m.key)
    const r = await claimMail(uid, m)
    setBusy(null)
    flash(r.msg)
  }
  const claimAll = async () => {
    setBusy("all")
    const r = await claimAllMail(uid, items)
    setBusy(null)
    flash(r.msg)
  }

  return (
    <div className="absolute inset-0 z-[10] flex items-center justify-center backdrop-blur-md bg-black/30 dark:bg-black/55" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md max-h-full flex flex-col rounded-3xl bg-[#f1f4f1] dark:bg-[#0b0f14] border border-black/5 dark:border-white/10 p-5 shadow-2xl animate-fade-in text-[#123321] dark:text-white"
        style={{ paddingBottom: "max(20px, var(--sai-bottom))" }}
      >
        <div className="flex items-center justify-between mb-3 shrink-0">
          <div className="flex items-center gap-2">
            <Inbox className="h-5 w-5 text-emerald-500" />
            <h3 className="text-xl font-bold text-emerald-500">Mailbox</h3>
          </div>
          <button aria-label="Close" onClick={onClose} className={`panel-inner-close d-pad-btn h-9 w-9 rounded-full flex items-center justify-center ${glass}`}><X className="h-4 w-4" /></button>
        </div>

        {claimable > 1 && (
          <button
            onClick={claimAll}
            disabled={busy !== null}
            className="shrink-0 d-pad-btn mb-3 h-10 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-amber-500 to-amber-400 shadow-md shadow-amber-500/30 disabled:opacity-60 flex items-center justify-center gap-2"
          >
            <Gift className="h-4 w-4" /> Sab rewards claim karo ({claimable})
          </button>
        )}
        {msg && <div className="shrink-0 mb-2 text-center text-sm font-semibold text-emerald-600 dark:text-emerald-300">{msg}</div>}

        <div className="overflow-y-auto -mx-1 px-1 space-y-2">
          {items.length === 0 && (
            <div className="py-12 text-center text-sm text-muted-foreground">
              <Bell className="h-9 w-9 mx-auto mb-2 opacity-40" />
              Abhi koi news ya reward nahi hai.
            </div>
          )}
          {items.map((m) => {
            const hasReward = hasRew(m)
            const fresh = !m.read || (hasReward && !m.claimed)
            return (
              <div key={m.key} className={`rounded-2xl p-3 ${glass} ${fresh ? "ring-1 ring-amber-400/60" : ""}`}>
                <div className="flex items-start gap-2">
                  <div className={`mt-0.5 h-8 w-8 shrink-0 rounded-full flex items-center justify-center ${hasReward ? "bg-amber-400/20 text-amber-500" : "bg-emerald-500/15 text-emerald-500"}`}>
                    {hasReward ? <Gift className="h-4 w-4" /> : <Megaphone className="h-4 w-4" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <div className="font-bold text-sm truncate">{m.title}</div>
                      {fresh && <span className="h-2 w-2 shrink-0 rounded-full bg-red-500" />}
                    </div>
                    <div className="text-[10px] text-muted-foreground">{m.scope === "all" ? "Sabke liye" : "Sirf aapke liye"} · {timeAgo(m.at)}</div>
                    {m.body && <p className="mt-1.5 text-[13px] whitespace-pre-wrap break-words text-muted-foreground">{m.body}</p>}
                  </div>
                </div>
                {hasReward && (
                  <div className="mt-2.5 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-x-2.5 gap-y-1 flex-wrap text-sm font-bold tabular-nums min-w-0">
                      {m.coins > 0 && <span className="inline-flex items-center gap-1"><Coins className="h-4 w-4 text-amber-500" />{m.coins.toLocaleString()}</span>}
                      {m.gems > 0 && <span className="inline-flex items-center gap-1"><Gem className="h-4 w-4 text-sky-500" />{m.gems.toLocaleString()}</span>}
                      {m.vipDays > 0 && <span className="inline-flex items-center gap-1 text-amber-500"><Crown className="h-4 w-4" />VIP {m.vipDays}d</span>}
                      {m.items.map((id) => (
                        <span key={id} className="inline-flex items-center rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 px-2 py-0.5 text-[11px] font-semibold">{getCatalogItem(id)?.name || id}</span>
                      ))}
                    </div>
                    {m.claimed ? (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600 dark:text-emerald-300"><Check className="h-4 w-4" /> Claimed</span>
                    ) : (
                      <button
                        onClick={() => claim(m)}
                        disabled={busy !== null}
                        className="d-pad-btn rounded-xl px-4 h-9 text-sm font-semibold text-white bg-gradient-to-r from-emerald-500 to-emerald-400 shadow-md shadow-emerald-500/30 disabled:opacity-60"
                      >
                        {busy === m.key ? "…" : "Claim"}
                      </button>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
