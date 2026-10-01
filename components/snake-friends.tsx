"use client"
import { useEffect, useState } from "react"
import { createPortal } from "react-dom"
import {
  UserPlus,
  User as UserIcon,
  X,
  Copy,
  Check,
  Search,
  Loader2,
  ArrowLeft,
  UserCheck,
  UserMinus,
  Clock,
  Users,
  Bell,
} from "lucide-react"
import { signInWithGoogle } from "@/lib/auth"
import { fetchRankedRecord, subscribeMyRanked } from "@/lib/ranked-db"
import { newRankedRecord, type RankedRecord } from "@/lib/ranked"
import { PlayerAvatar } from "./player-avatar"
import { TierBadge, RankDetailsSheet } from "./ranked-panel"
import { useAuthUser as useAuthUserLite } from "@/lib/auth"
import { useDisplayName } from "@/lib/profile-name"
import {
  useFriends,
  usePublicProfiles,
  fetchPublicProfile,
  findPlayerByCode,
  normalizePlayerCode,
  playerCodeOf,
  sendFriendRequest,
  acceptFriendRequest,
  declineFriendRequest,
  cancelFriendRequest,
  removeFriend,
  copyToClipboard,
  type PublicProfile,
} from "@/lib/friends"

const glass = "bg-white/70 dark:bg-white/5 backdrop-blur-sm border border-black/5 dark:border-white/10 shadow-sm"

function Avatar({ photo, avatar, vip, size = 40, animate = false }: { photo?: string | null; avatar?: string | null; vip?: boolean; size?: number; animate?: boolean }) {
  return <PlayerAvatar photo={photo} avatarId={avatar} vip={!!vip} size={size} animate={animate} />
}

/** Ranked medal + Elo of any player (readable by every signed-in player). Tap the medal for the details. */
function RankRow({ uid, name, isMe }: { uid: string; name: string; isMe: boolean }) {
  const [rec, setRec] = useState<RankedRecord | null | "loading">("loading")
  const [myElo, setMyElo] = useState<number | null>(null)
  const [open, setOpen] = useState(false)
  const { user } = useAuthUserLite()
  const myUid = user?.uid ?? null

  useEffect(() => {
    let dead = false
    setRec("loading")
    fetchRankedRecord(uid)
      .then((r) => !dead && setRec(r))
      .catch(() => !dead && setRec(null))
    return () => {
      dead = true
    }
  }, [uid])

  // my own rating, to show "X higher / lower than you"
  useEffect(() => {
    setMyElo(null)
    if (!myUid || isMe) return
    return subscribeMyRanked(myUid, (r) => setMyElo((r ?? newRankedRecord()).elo))
  }, [myUid, isMe])

  const r = rec === "loading" || rec === null ? null : rec
  return (
    <div className={`mt-2 rounded-2xl px-4 py-2.5 flex items-center justify-between ${glass}`}>
      <div>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Ranked</div>
        <div className="text-lg font-bold tabular-nums">
          {rec === "loading" ? <Loader2 className="h-4 w-4 animate-spin text-emerald-500" /> : r ? <>{r.elo} <span className="text-[11px] font-medium text-muted-foreground">Elo · {r.wins}W {r.losses}L</span></> : "—"}
        </div>
      </div>
      {r && <TierBadge elo={r.elo} onClick={() => setOpen(true)} className="!text-[13px] !px-3 !py-1.5" />}
      {open && r && <RankDetailsSheet name={name} rec={r} isMe={isMe} myElo={myElo} onClose={() => setOpen(false)} />}
    </div>
  )
}

type View = { uid: string; profile: PublicProfile | null | "loading" }

export function SnakeFriends() {
  const { user, ready, uid, friends, incoming, sent } = useFriends()
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<"friends" | "requests">("friends")
  const [view, setView] = useState<View | null>(null)
  const [code, setCode] = useState("")
  const [searching, setSearching] = useState(false)
  const [searchErr, setSearchErr] = useState("")
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const [actErr, setActErr] = useState("")
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [loginBusy, setLoginBusy] = useState(false)
  const [loginErr, setLoginErr] = useState("")

  const requestUids = Object.keys(incoming)
  const friendUids = Object.keys(friends)
  const profiles = usePublicProfiles(friendUids)
  const myCode = uid ? playerCodeOf(uid) : ""
  const myName = useDisplayName(user)
  const me = user ? { uid: user.uid, name: myName, photo: user.photoURL } : null

  const openView = async (targetUid: string, preloaded?: PublicProfile | null) => {
    setActErr("")
    setConfirmRemove(false)
    if (preloaded) return setView({ uid: targetUid, profile: preloaded })
    setView({ uid: targetUid, profile: "loading" })
    try {
      setView({ uid: targetUid, profile: await fetchPublicProfile(targetUid, true) })
    } catch {
      setView({ uid: targetUid, profile: null })
    }
  }

  // Other parts of the app (multiplayer lobby) can open a player's profile
  useEffect(() => {
    const h = (e: Event) => {
      const t = (e as CustomEvent).detail?.uid as string | undefined
      if (!t) return
      setOpen(true)
      openView(t)
    }
    window.addEventListener("open-player-profile", h)
    return () => window.removeEventListener("open-player-profile", h)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Android back button closes the sheet
  useEffect(() => {
    if (!open) return
    history.pushState({ friends: 1 }, "")
    const onPop = () => {
      setOpen(false)
      setView(null)
    }
    window.addEventListener("popstate", onPop)
    return () => window.removeEventListener("popstate", onPop)
  }, [open])

  const close = () => {
    if (history.state?.friends) history.back()
    else {
      setOpen(false)
      setView(null)
    }
    setSearchErr("")
    setActErr("")
  }

  const openPanel = () => {
    setTab(requestUids.length > 0 ? "requests" : "friends")
    setOpen(true)
  }

  const login = async () => {
    setLoginBusy(true)
    setLoginErr("")
    const r = await signInWithGoogle()
    setLoginBusy(false)
    if (r.error) setLoginErr(r.error)
  }

  const copyId = async () => {
    if (await copyToClipboard(myCode)) {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }
  }

  const doSearch = async () => {
    const c = normalizePlayerCode(code)
    if (c.length !== 8) return setSearchErr("A Player ID has 8 letters / numbers.")
    setSearching(true)
    setSearchErr("")
    try {
      const p = await findPlayerByCode(c)
      if (!p) setSearchErr("No player found with this ID.")
      else {
        setCode("")
        openView(p.uid, p)
      }
    } catch {
      setSearchErr("Could not search. Check your connection.")
    } finally {
      setSearching(false)
    }
  }

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    setActErr("")
    try {
      await fn()
    } catch {
      setActErr("Something went wrong. Check your connection and try again.")
    } finally {
      setBusy(false)
    }
  }

  const relationOf = (t: string) =>
    t === uid ? "me" : friends[t] ? "friend" : incoming[t] ? "incoming" : sent[t] ? "sent" : "none"

  // ------------------------------- profile view -------------------------------
  const renderProfile = () => {
    if (!view) return null
    const p = view.profile
    const rel = relationOf(view.uid)
    const joined = p && p !== "loading" && p.createdAt ? new Date(p.createdAt).toLocaleDateString([], { month: "short", year: "numeric" }) : null
    return (
      <>
        <button
          onClick={() => {
            setView(null)
            setActErr("")
            setConfirmRemove(false)
          }}
          className="d-pad-btn flex items-center gap-1 text-sm text-muted-foreground mb-3"
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        {p === "loading" ? (
          <div className="py-10 flex justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-emerald-500" />
          </div>
        ) : !p ? (
          <div className={`rounded-2xl p-4 text-center text-sm ${glass}`}>This player&apos;s profile is not available yet.</div>
        ) : (
          <>
            <div className={`rounded-2xl p-4 flex items-center gap-3 ${glass}`}>
              <Avatar photo={p.photo} avatar={p.avatar} vip={p.vip} size={72} animate />
              <div className="min-w-0">
                <div className="font-bold truncate">{p.name}</div>
                <div className="text-[10px] tracking-wider text-emerald-600 dark:text-emerald-300 mt-0.5">PLAYER ID · {p.pid}</div>
                {p.vip && <div className="text-[11px] text-amber-500 mt-0.5">★ VIP</div>}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 mt-3">
              {(
                [
                  ["Best score", p.best.toLocaleString()],
                  ["Items owned", String(p.owned)],
                ] as const
              ).map(([l, v]) => (
                <div key={l} className={`rounded-2xl px-4 py-2 ${glass}`}>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{l}</div>
                  <div className="text-lg font-bold tabular-nums">{v}</div>
                </div>
              ))}
            </div>
            <RankRow uid={p.uid} name={p.name} isMe={rel === "me"} />
            {joined && <div className="mt-2 text-[11px] text-muted-foreground">Member since {joined}</div>}

            <div className="mt-4">
              {rel === "me" && <div className="text-center text-sm text-muted-foreground">This is you</div>}
              {rel === "none" && (
                <button
                  disabled={busy || !me}
                  onClick={() => me && run(() => sendFriendRequest(me, p.uid))}
                  className="d-pad-btn w-full h-11 rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-400 text-white font-semibold flex items-center justify-center gap-2 disabled:opacity-60"
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />} Add friend
                </button>
              )}
              {rel === "sent" && (
                <div className="flex gap-2">
                  <div className={`flex-1 h-11 rounded-xl flex items-center justify-center gap-2 text-sm text-muted-foreground ${glass}`}>
                    <Clock className="h-4 w-4" /> Request sent
                  </div>
                  <button
                    disabled={busy}
                    onClick={() => uid && run(() => cancelFriendRequest(uid, p.uid))}
                    className="d-pad-btn px-4 h-11 rounded-xl text-sm font-semibold border border-black/10 dark:border-white/15 text-muted-foreground"
                  >
                    Cancel
                  </button>
                </div>
              )}
              {rel === "incoming" && (
                <div className="flex gap-2">
                  <button
                    disabled={busy}
                    onClick={() => uid && run(() => acceptFriendRequest(uid, p.uid))}
                    className="d-pad-btn flex-1 h-11 rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-400 text-white font-semibold flex items-center justify-center gap-2"
                  >
                    <Check className="h-4 w-4" /> Accept
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => uid && run(() => declineFriendRequest(uid, p.uid))}
                    className="d-pad-btn px-4 h-11 rounded-xl text-sm font-semibold border border-black/10 dark:border-white/15 text-muted-foreground"
                  >
                    Decline
                  </button>
                </div>
              )}
              {rel === "friend" && (
                <>
                  <div className="flex items-center justify-center gap-2 text-sm text-emerald-500 font-semibold">
                    <UserCheck className="h-4 w-4" /> You are friends
                  </div>
                  <button
                    disabled={busy}
                    onClick={() => {
                      if (!confirmRemove) return setConfirmRemove(true)
                      if (uid) run(() => removeFriend(uid, p.uid)).then(() => setConfirmRemove(false))
                    }}
                    className={`d-pad-btn mt-3 w-full h-10 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 border ${
                      confirmRemove ? "bg-red-500 text-white border-red-500" : "border-black/10 dark:border-white/15 text-muted-foreground"
                    }`}
                  >
                    <UserMinus className="h-4 w-4" /> {confirmRemove ? "Tap again to remove" : "Remove friend"}
                  </button>
                </>
              )}
              {actErr && <p className="text-[12px] text-red-500 text-center mt-2">{actErr}</p>}
            </div>
          </>
        )}
      </>
    )
  }

  // -------------------------------- main view ---------------------------------
  const renderMain = () => (
    <>
      {/* My Player ID */}
      <div className={`rounded-2xl px-4 py-2.5 flex items-center justify-between gap-2 ${glass}`}>
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Your Player ID</div>
          <div className="font-bold tracking-widest text-emerald-600 dark:text-emerald-300">{myCode}</div>
        </div>
        <button
          onClick={copyId}
          className="d-pad-btn h-9 px-3 rounded-full flex items-center gap-1.5 text-xs font-semibold border border-black/10 dark:border-white/15"
        >
          {copied ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>

      {/* Search */}
      <div className="mt-3">
        <div className="flex gap-2">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 12))}
            onKeyDown={(e) => e.key === "Enter" && doSearch()}
            placeholder="Enter Player ID"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            className="flex-1 h-11 px-3 rounded-xl bg-white/70 dark:bg-white/5 border border-black/10 dark:border-white/15 text-sm tracking-widest outline-none focus:border-emerald-500"
          />
          <button
            onClick={doSearch}
            disabled={searching}
            aria-label="Search player"
            className="d-pad-btn h-11 w-11 rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-400 text-white flex items-center justify-center disabled:opacity-60"
          >
            {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          </button>
        </div>
        {searchErr && <p className="text-[12px] text-red-500 mt-1.5">{searchErr}</p>}
      </div>

      {/* Tabs */}
      <div className={`mt-4 grid grid-cols-2 p-1 rounded-xl ${glass}`}>
        {(
          [
            ["friends", `Friends (${friendUids.length})`],
            ["requests", "Requests"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`relative h-9 rounded-lg text-sm font-semibold transition-colors ${
              tab === id ? "bg-emerald-500 text-white" : "text-muted-foreground"
            }`}
          >
            {label}
            {id === "requests" && requestUids.length > 0 && (
              <span className="ml-1.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold">
                {requestUids.length}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="mt-3 flex flex-col gap-2 max-h-[38vh] overflow-y-auto">
        {tab === "friends" &&
          (friendUids.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">
              <Users className="h-8 w-8 mx-auto mb-2 opacity-40" />
              No friends yet. Search a Player ID or add players from multiplayer.
            </div>
          ) : (
            friendUids.map((f) => {
              const p = profiles[f]
              return (
                <button
                  key={f}
                  onClick={() => openView(f, p ?? undefined)}
                  className={`d-pad-btn w-full text-left rounded-2xl p-3 flex items-center gap-3 ${glass}`}
                >
                  <Avatar photo={p?.photo} avatar={p?.avatar} vip={p?.vip} size={40} />
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold truncate">{p ? p.name : "…"}</div>
                    <div className="text-[10px] tracking-wider text-muted-foreground">ID · {p?.pid ?? playerCodeOf(f)}</div>
                  </div>
                  {p && <div className="text-xs text-muted-foreground tabular-nums">Best {p.best.toLocaleString()}</div>}
                </button>
              )
            })
          ))}

        {tab === "requests" &&
          (requestUids.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">
              <Bell className="h-8 w-8 mx-auto mb-2 opacity-40" />
              No friend requests right now.
            </div>
          ) : (
            requestUids.map((r) => {
              const q = incoming[r]
              return (
                <div key={r} className={`rounded-2xl p-3 flex items-center gap-3 ${glass}`}>
                  <button onClick={() => openView(r)} className="d-pad-btn flex items-center gap-3 min-w-0 flex-1 text-left">
                    <Avatar photo={q.photo} size={40} />
                    <div className="min-w-0">
                      <div className="font-semibold truncate">{q.name}</div>
                      <div className="text-[10px] tracking-wider text-muted-foreground">wants to be your friend</div>
                    </div>
                  </button>
                  <button
                    disabled={busy}
                    aria-label="Accept"
                    onClick={() => uid && run(() => acceptFriendRequest(uid, r))}
                    className="d-pad-btn h-9 w-9 rounded-full bg-emerald-500 text-white flex items-center justify-center"
                  >
                    <Check className="h-4 w-4" />
                  </button>
                  <button
                    disabled={busy}
                    aria-label="Decline"
                    onClick={() => uid && run(() => declineFriendRequest(uid, r))}
                    className="d-pad-btn h-9 w-9 rounded-full border border-black/10 dark:border-white/15 text-muted-foreground flex items-center justify-center"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              )
            })
          ))}
        {actErr && <p className="text-[12px] text-red-500 text-center">{actErr}</p>}
      </div>
    </>
  )

  return (
    <>
      <button
        aria-label="Friends"
        onClick={openPanel}
        className="d-pad-btn relative inline-flex items-center justify-center h-10 w-10 rounded-full hover:bg-accent hover:text-accent-foreground"
      >
        <UserPlus className="h-5 w-5" />
        {requestUids.length > 0 && (
          <span className="absolute top-0.5 right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center ring-2 ring-white dark:ring-[#0b0f14]">
            {requestUids.length > 9 ? "9+" : requestUids.length}
          </span>
        )}
      </button>

      {open &&
        createPortal(
          <div
            className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center backdrop-blur-md bg-black/30 dark:bg-black/55"
            onClick={close}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl bg-[#f1f4f1] dark:bg-[#0b0f14] border border-black/5 dark:border-white/10 p-5 shadow-2xl animate-fade-in text-[#123321] dark:text-white"
              style={{ paddingBottom: "max(24px, env(safe-area-inset-bottom))" }}
            >
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xl font-bold text-emerald-500">Friends</h3>
                <button
                  aria-label="Close"
                  onClick={close}
                  className={`d-pad-btn h-9 w-9 rounded-full flex items-center justify-center ${glass}`}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {!ready ? (
                <div className="py-10 flex justify-center">
                  <Loader2 className="h-6 w-6 animate-spin text-emerald-500" />
                </div>
              ) : !user ? (
                <>
                  <div className={`rounded-2xl p-4 text-center ${glass}`}>
                    <div className="mx-auto h-14 w-14 rounded-full bg-emerald-500/15 flex items-center justify-center mb-2">
                      <Users className="h-7 w-7 text-emerald-500" />
                    </div>
                    <div className="font-bold">Sign in to use Friends</div>
                    <p className="text-[12px] text-muted-foreground mt-1">
                      Friends need an account so your Player ID stays yours. Sign in with Google to add and search players.
                    </p>
                  </div>
                  <button
                    onClick={login}
                    disabled={loginBusy}
                    className="d-pad-btn mt-4 w-full h-12 rounded-xl bg-white text-[#1f1f1f] border border-black/10 shadow-md font-semibold flex items-center justify-center gap-3 disabled:opacity-60"
                  >
                    {loginBusy && <Loader2 className="h-5 w-5 animate-spin" />} Continue with Google
                  </button>
                  {loginErr && <p className="text-[12px] text-red-500 text-center mt-2">{loginErr}</p>}
                </>
              ) : view ? (
                renderProfile()
              ) : (
                renderMain()
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}

/**
 * Small "add friend" control for another player's row (multiplayer lobby / results).
 * Shows nothing for guests, yourself, or players without an account.
 */
export function FriendAction({ targetUid }: { targetUid?: string | null }) {
  const { user, uid, friends, incoming, sent } = useFriends()
  const [busy, setBusy] = useState(false)
  const myName = useDisplayName(user)
  if (!uid || !user || !targetUid || targetUid === uid) return null

  const me = { uid, name: myName, photo: user.photoURL }
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await fn()
    } catch {
    } finally {
      setBusy(false)
    }
  }

  if (friends[targetUid])
    return (
      <span title="Friend" className="flex items-center gap-0.5 text-[10px] font-semibold text-emerald-500">
        <UserCheck className="w-3.5 h-3.5" />
      </span>
    )
  if (incoming[targetUid])
    return (
      <button
        disabled={busy}
        onClick={(e) => {
          e.stopPropagation()
          act(() => acceptFriendRequest(uid, targetUid))
        }}
        className="px-2 py-0.5 rounded-full bg-emerald-500 text-white text-[10px] font-bold"
      >
        Accept
      </button>
    )
  if (sent[targetUid])
    return (
      <span title="Request sent" className="flex items-center gap-0.5 text-[10px] font-semibold opacity-60">
        <Clock className="w-3.5 h-3.5" /> Sent
      </span>
    )
  return (
    <button
      disabled={busy}
      aria-label="Add friend"
      title="Add friend"
      onClick={(e) => {
        e.stopPropagation()
        act(() => sendFriendRequest(me, targetUid))
      }}
      className="p-1.5 rounded-full bg-emerald-500/15 text-emerald-500 hover:bg-emerald-500/25"
    >
      {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
    </button>
  )
}
