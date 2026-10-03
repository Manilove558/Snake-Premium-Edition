"use client"
import { useEffect, useState } from "react"
import { useBackButton } from "@/hooks/use-back-button"
import { createPortal } from "react-dom"
import { usePanelState, usePanelTarget } from "./panel-host"
import { User as UserIcon, X, LogOut, Cloud, CloudOff, Loader2, Copy, Check, Pencil } from "lucide-react"
import { useAuthUser, signInWithGoogle, signOutUser } from "@/lib/auth"
import { attachAccount, detachAccount, useSyncStatus } from "@/lib/cloud"
import { useStore, getCatalogItems, isVip } from "@/lib/store"
import { copyToClipboard } from "@/lib/friends"
import { useDisplayName, saveProfileName, validateName, NAME_MAX } from "@/lib/profile-name"
import { subscribeMyRanked } from "@/lib/ranked-db"
import { newRankedRecord, type RankedRecord } from "@/lib/ranked"
import { PlayerAvatar, resolveAvatar } from "./player-avatar"
import { TierBadge, RankDetailsSheet } from "./ranked-panel"
import { VipCrown } from "./vip-crown"

const glass = "bg-white/70 dark:bg-white/5 backdrop-blur-sm border border-black/5 dark:border-white/10 shadow-sm"

export function SnakeProfile() {
  const { user, ready } = useAuthUser()
  const st = useStore()
  const { status, lastSaved } = useSyncStatus()
  const [open, setOpen] = usePanelState("PROFILE")
  const panelTarget = usePanelTarget()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState("")
  const [confirmOut, setConfirmOut] = useState(false)
  const [copied, setCopied] = useState(false)
  const uid = user?.uid
  const shownName = useDisplayName(user)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState("")
  const [nameBusy, setNameBusy] = useState(false)
  const [nameErr, setNameErr] = useState("")
  const [nameOk, setNameOk] = useState("")
  const [rank, setRank] = useState<RankedRecord | null>(null)
  const [rankOpen, setRankOpen] = useState(false)

  // Load / merge the cloud save whenever an account signs in (also on app start with a remembered login)
  useEffect(() => { if (user) attachAccount({ uid: user.uid, displayName: user.displayName, photoURL: user.photoURL }) }, [uid]) // eslint-disable-line react-hooks/exhaustive-deps

  // My ranked rating (live) — shown on my profile, everybody else sees it on their view of my profile
  useEffect(() => {
    setRank(null)
    if (!uid) return
    return subscribeMyRanked(uid, setRank)
  }, [uid])

  // Android back button closes the sheet (central back stack)
  useBackButton(open, () => { setOpen(false); setConfirmOut(false); setEditing(false) })
  const close = () => { setOpen(false); setConfirmOut(false); setErr(""); setEditing(false); setNameErr("") }

  const startEdit = () => { setDraft(shownName); setNameErr(""); setNameOk(""); setEditing(true) }
  const cancelEdit = () => { setEditing(false); setNameErr("") }
  const saveName = async () => {
    if (!uid || nameBusy) return
    const v = validateName(draft)
    if (!v.ok) { setNameErr(v.error); return }
    if (v.name === shownName) { setEditing(false); return }
    setNameBusy(true); setNameErr("")
    const r = await saveProfileName(uid, v.name)
    setNameBusy(false)
    if (r.error) { setNameErr(r.error); if (!r.ok) return }
    setEditing(false)
    setNameOk(r.note || "Name updated ✓")
    setTimeout(() => setNameOk(""), 2500)
  }

  const login = async () => { setBusy(true); setErr(""); const r = await signInWithGoogle(); setBusy(false); if (r.error) setErr(r.error) }
  const logout = async () => {
    if (!confirmOut) { setConfirmOut(true); return }
    setBusy(true); await detachAccount(); await signOutUser(); setBusy(false); setConfirmOut(false); setOpen(false)
  }
  const shortId = uid ? uid.slice(0, 8).toUpperCase() : ""
  const copyId = async () => { if (await copyToClipboard(shortId)) { setCopied(true); setTimeout(() => setCopied(false), 1500) } }
  const owned = st.owned.length - 3
  const total = getCatalogItems().filter((i) => !["skin_classic", "trail_none", "food_classic"].includes(i.id) && i.kind !== "vip" && i.kind !== "avatar").length
  const time = lastSaved ? new Date(lastSaved).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""

  return (
    <>
      {/* Same look as the avatar inside the Profile popup: thin green ring + picture. 44px picture + 2px ring = fills the whole 48px circle */}
      <button aria-label="Profile" onClick={() => setOpen(true)} className="d-pad-btn inline-flex items-center justify-center h-12 w-12 rounded-full hover:bg-accent hover:text-accent-foreground">
        {user?.photoURL || resolveAvatar(st.equipped.avatar, isVip(st)) ? <PlayerAvatar photo={user?.photoURL} avatarId={st.equipped.avatar} vip={isVip(st)} size={44} /> : <UserIcon className="h-5 w-5" />}
      </button>
      {open && createPortal(
        <div className="absolute inset-0 z-[10] flex items-center justify-center overflow-y-auto backdrop-blur-md bg-black/30 dark:bg-black/55" onClick={close}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md max-h-full overflow-y-auto rounded-3xl bg-[#f1f4f1] dark:bg-[#0b0f14] border border-black/5 dark:border-white/10 p-4 shadow-2xl animate-fade-in text-[#123321] dark:text-white"
            style={{ paddingBottom: "max(24px, var(--sai-bottom))" }}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xl font-bold text-emerald-500">Profile</h3>
              <button aria-label="Close" onClick={close} className={`panel-inner-close d-pad-btn h-12 w-12 rounded-full flex items-center justify-center ${glass}`}><X className="h-4 w-4" /></button>
            </div>

            {!ready ? <div className="py-10 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-emerald-500" /></div> : user ? (
              <>
                <div className={`rounded-2xl p-3 flex items-center gap-3 ${glass}`}>
                  <PlayerAvatar photo={user.photoURL} avatarId={st.equipped.avatar} vip={isVip(st)} size={56} animate />
                  <div className="min-w-0">
                    {editing ? (
                      <div className="flex items-center gap-1.5">
                        <input autoFocus value={draft} maxLength={NAME_MAX} onChange={(e) => { setDraft(e.target.value.slice(0, NAME_MAX)); setNameErr("") }}
                          onKeyDown={(e) => { if (e.key === "Enter") saveName(); if (e.key === "Escape") cancelEdit() }}
                          placeholder="Your name" aria-label="Player name"
                          className="min-w-0 flex-1 h-9 px-3 rounded-lg text-sm font-semibold bg-black/5 dark:bg-white/10 border border-emerald-500/50 outline-none focus:border-emerald-500" />
                        <button aria-label="Save name" onClick={saveName} disabled={nameBusy} className="d-pad-btn h-9 w-9 shrink-0 rounded-lg flex items-center justify-center bg-emerald-500 text-white disabled:opacity-60">
                          {nameBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                        </button>
                        <button aria-label="Cancel" onClick={cancelEdit} className="d-pad-btn h-9 w-9 shrink-0 rounded-lg flex items-center justify-center border border-black/10 dark:border-white/15"><X className="h-4 w-4" /></button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <div className="font-bold truncate">{isVip(st) && <VipCrown className="h-4 w-4" />}{shownName}</div>
                        <button aria-label="Edit name" onClick={startEdit} className="d-pad-btn h-6 w-6 shrink-0 rounded-md flex items-center justify-center text-emerald-600 dark:text-emerald-300 bg-emerald-500/10"><Pencil className="h-3 w-3" /></button>
                      </div>
                    )}
                    {nameErr && <div className="text-[11px] text-red-500 leading-tight mt-0.5">{nameErr}</div>}
                    {nameOk && !editing && <div className="text-[11px] text-emerald-500 mt-0.5">{nameOk}</div>}
                    <div className="text-[11px] text-muted-foreground truncate">{user.email}</div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="text-[10px] tracking-wider text-emerald-600 dark:text-emerald-300">PLAYER ID · {shortId}</span>
                      <button aria-label="Copy Player ID" onClick={copyId} className="d-pad-btn h-6 px-1.5 rounded-md flex items-center gap-1 text-[10px] font-semibold text-emerald-600 dark:text-emerald-300 bg-emerald-500/10">
                        {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}{copied ? "Copied" : "Copy"}
                      </button>
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 mt-3">
                  {([["Best score", st.best], ["Coins", st.coins], ["Gems", st.gems], ["Items owned", `${owned}/${total}`]] as const).map(([l, v]) => (
                    <div key={l} className={`rounded-2xl px-4 py-2 ${glass}`}>
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{l}</div>
                      <div className="text-lg font-bold tabular-nums">{typeof v === "number" ? v.toLocaleString() : v}</div>
                    </div>
                  ))}
                </div>
                <div className={`mt-2 rounded-2xl px-4 py-2.5 flex items-center justify-between ${glass}`}>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Ranked</div>
                    <div className="text-lg font-bold tabular-nums">{(rank ?? newRankedRecord()).elo} <span className="text-[11px] font-medium text-muted-foreground">Elo</span></div>
                  </div>
                  <TierBadge elo={(rank ?? newRankedRecord()).elo} onClick={() => setRankOpen(true)} className="!text-[13px] !px-3 !py-1.5" />
                </div>
                {isVip(st) && <div className="mt-2 text-[11px] text-amber-500">★ VIP active</div>}
                {rankOpen && <RankDetailsSheet name={shownName} rec={rank ?? newRankedRecord()} isMe onClose={() => setRankOpen(false)} />}
                <div className="mt-3 flex items-center gap-1.5 text-[12px] text-muted-foreground">
                  {status === "syncing" ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…</> : status === "offline" ? <><CloudOff className="h-3.5 w-3.5 text-amber-500" /> Offline — will save when connected</> : <><Cloud className="h-3.5 w-3.5 text-emerald-500" /> Progress saved to your account{time && ` · ${time}`}</>}
                </div>
                <button onClick={logout} disabled={busy} className={`d-pad-btn mt-4 w-full h-11 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 border ${confirmOut ? "bg-red-500 text-white border-red-500" : "border-black/10 dark:border-white/15 text-muted-foreground"}`}>
                  <LogOut className="h-4 w-4" />{confirmOut ? "Tap again to sign out" : "Sign out"}
                </button>
                {confirmOut && <p className="text-[10px] text-muted-foreground text-center mt-1.5">Your progress stays safe in the cloud. Sign in again anytime to get it back.</p>}
              </>
            ) : (
              <>
                <div className={`rounded-2xl p-4 text-center ${glass}`}>
                  <div className="mx-auto h-14 w-14 rounded-full bg-emerald-500/15 flex items-center justify-center mb-2"><UserIcon className="h-7 w-7 text-emerald-500" /></div>
                  <div className="font-bold">Playing as Guest</div>
                  <p className="text-[12px] text-muted-foreground mt-1">Your coins, gems, skins and best score are saved only on this device. Uninstalling the app or clearing data will erase them.</p>
                </div>
                <button onClick={login} disabled={busy} className="d-pad-btn mt-4 w-full h-12 rounded-xl bg-white text-[#1f1f1f] border border-black/10 shadow-md font-semibold flex items-center justify-center gap-3 disabled:opacity-60">
                  {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : (
                    <svg width="20" height="20" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.2 5.6c4.3-4 6.8-9.9 6.8-17z"/><path fill="#FBBC05" d="M10.5 28.7c-.5-1.4-.8-2.9-.8-4.7s.3-3.3.8-4.7l-7.9-6.1C.9 16.4 0 20.1 0 24s.9 7.6 2.6 10.8l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.2-5.6c-2 1.4-4.6 2.2-8.7 2.2-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z"/></svg>
                  )}
                  Continue with Google
                </button>
                {err && <p className="text-[12px] text-red-500 text-center mt-2">{err}</p>}
                <p className="text-[10px] text-muted-foreground text-center mt-3">Your current guest progress will be added to your account when you sign in.</p>
              </>
            )}
          </div>
        </div>, panelTarget)}
    </>
  )
}
