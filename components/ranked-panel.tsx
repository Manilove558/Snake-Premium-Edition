"use client"

import { useEffect, useState } from "react"
import { createPortal } from "react-dom"
import { Button } from "@/components/ui/button"
import { Trophy, Plus, Loader2, ArrowLeft, LogIn, Swords, Globe, X, Check, Gift } from "lucide-react"
import { normalizeRoomCode } from "@/lib/multiplayer"
import { signInWithGoogle } from "@/lib/auth"
import { subscribeMyRanked, fetchLeaderboard, fetchRankPosition, type LeaderboardRow } from "@/lib/ranked-db"
import {
  getTier,
  getNextTier,
  newRankedRecord,
  RANKED_MIN_PLAYERS,
  RANK_PASS_COINS,
  RANK_PASS_GEMS,
  TIERS,
  type RankedRecord,
} from "@/lib/ranked"
import { useStore, claimRankRewards } from "@/lib/store"
import { openPlayerProfile } from "@/lib/friends"
import { PlayerAvatar } from "./player-avatar"
import { VipCrown } from "./vip-crown"
import { usePanelTarget } from "./panel-host"

// ---------------------------------------------------------------------------
// Small shared pieces (also used by the battle results screen)
// ---------------------------------------------------------------------------

/** Medal + tier name, coloured by tier. */
export function TierBadge({ elo, className = "", onClick }: { elo: number; className?: string; onClick?: () => void }) {
  const t = getTier(elo)
  const cls = `inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-bold leading-none whitespace-nowrap ${className}`
  const style = { color: t.color, borderColor: `${t.color}66`, backgroundColor: `${t.color}22` }
  // With onClick the medal is a button: tap it to see the rank details (RankDetailsSheet)
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={`${cls} cursor-pointer active:scale-95 transition-transform`} style={style} title={`${t.name} (${elo} Elo) — tap for details`} aria-label={`${t.name} rank, ${elo} Elo. Tap for details`}>
        <span aria-hidden>{t.emoji}</span>
        {t.name}
        <span aria-hidden className="opacity-60">›</span>
      </button>
    )
  }
  return (
    <span className={cls} style={style} title={`${t.name} (${elo} Elo)`}>
      <span aria-hidden>{t.emoji}</span>
      {t.name}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Rank details: opens when a rank medal is tapped (own profile, other players' profiles, leaderboard)
// ---------------------------------------------------------------------------

export function RankDetailsSheet({
  name,
  rec,
  isMe,
  myElo,
  onClose,
}: {
  name: string
  rec: RankedRecord
  /** true when this is my own rank: shows the Rank Pass rewards + Claim button */
  isMe: boolean
  /** my rating, to say how far above / below me the other player is */
  myElo?: number | null
  onClose: () => void
}) {
  const st = useStore()
  const [pos, setPos] = useState<{ position: number; capped: boolean } | null>(null)
  const [posFailed, setPosFailed] = useState(false)
  const [msg, setMsg] = useState("")
  const tier = getTier(rec.elo)
  const next = getNextTier(rec.elo)
  const pct = next ? Math.max(0, Math.min(100, Math.round(((rec.elo - tier.min) / (next.min - tier.min)) * 100))) : 100
  const played = rec.matches > 0
  const winRate = played ? Math.round((rec.wins / rec.matches) * 100) : 0
  const claimed = new Set(st.rankClaimed || [])
  const claimable = TIERS.filter((t) => RANK_PASS_COINS[t.id] !== undefined && t.min <= tier.min && !claimed.has(t.id))
  const diff = !isMe && typeof myElo === "number" ? rec.elo - myElo : null

  useEffect(() => {
    let dead = false
    setPos(null)
    setPosFailed(false)
    fetchRankPosition(rec.elo)
      .then((p) => !dead && setPos(p))
      .catch(() => !dead && setPosFailed(true))
    return () => {
      dead = true
    }
  }, [rec.elo])

  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose()
    window.addEventListener("keydown", h)
    return () => window.removeEventListener("keydown", h)
  }, [onClose])

  const claim = () => {
    const r = claimRankRewards(rec.elo)
    setMsg(r.tiers.length ? `+${r.coins.toLocaleString()} coins & +${r.gems} gem${r.gems > 1 ? "s" : ""}!` : "Nothing to claim")
    setTimeout(() => setMsg(""), 2200)
  }

  const panelTarget = usePanelTarget()
  const box = "rounded-2xl border border-black/5 dark:border-white/10 bg-white/70 dark:bg-white/5"
  return createPortal(
    <div className="fixed inset-0 z-[140] flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md max-h-[92%] overflow-y-auto rounded-t-3xl sm:rounded-3xl bg-[#f1f4f1] dark:bg-[#0b0f14] border border-black/5 dark:border-white/10 p-5 shadow-2xl animate-fade-in text-[#123321] dark:text-white"
        style={{ paddingBottom: "max(24px, var(--sai-bottom))" }}
      >
        <div className="flex items-center justify-between mb-3">
          <div className="min-w-0">
            <h3 className="text-xl font-bold text-emerald-500">Rank details</h3>
            <div className="text-[11px] text-muted-foreground truncate">{isMe ? "Your rank" : name}</div>
          </div>
          <button aria-label="Close" onClick={onClose} className={`h-9 w-9 rounded-full flex items-center justify-center ${box}`}>
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Medal + Elo */}
        <div className={`${box} p-4 text-center`} style={{ borderColor: `${tier.color}55` }}>
          <div className="text-6xl leading-none" aria-hidden>{tier.emoji}</div>
          <div className="mt-2 text-2xl font-black" style={{ color: tier.color }}>{tier.name}</div>
          <div className="text-sm font-semibold tabular-nums">{rec.elo} Elo</div>
          {!played && <div className="mt-1 text-[11px] text-muted-foreground">Unranked — no ranked match played yet (starts at 1000)</div>}
          <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
            <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: tier.color }} />
          </div>
          <div className="mt-1.5 text-[12px] text-muted-foreground">
            {next ? (
              <>
                <b className="text-foreground tabular-nums">{next.min - rec.elo}</b> Elo to <span style={{ color: next.color }} className="font-semibold">{next.emoji} {next.name}</span>
              </>
            ) : (
              "Top tier reached 💎"
            )}
          </div>
        </div>

        {/* How high in the world / compared to me */}
        <div className="grid grid-cols-2 gap-2 mt-2">
          <div className={`${box} px-4 py-2`}>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">World position</div>
            <div className="text-lg font-bold tabular-nums">
              {pos ? `#${pos.position}${pos.capped ? "+" : ""}` : posFailed ? "—" : <Loader2 className="h-4 w-4 animate-spin text-emerald-500 mt-1" />}
            </div>
          </div>
          <div className={`${box} px-4 py-2`}>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{isMe ? "Win rate" : "Vs you"}</div>
            <div className="text-lg font-bold tabular-nums">
              {isMe ? `${winRate}%` : diff === null ? "—" : diff === 0 ? "Equal" : diff > 0 ? <span className="text-red-500">+{diff} higher</span> : <span className="text-emerald-500">{Math.abs(diff)} lower</span>}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-2 mt-2 text-center">
          {(
            [
              ["Wins", rec.wins, "text-emerald-500"],
              ["Losses", rec.losses, "text-red-500"],
              ["Matches", rec.matches, ""],
              ["Win %", `${winRate}%`, ""],
            ] as const
          ).map(([l, v, c]) => (
            <div key={l} className={`${box} py-2`}>
              <div className={`text-sm font-bold tabular-nums ${c}`}>{v}</div>
              <div className="text-[10px] text-muted-foreground">{l}</div>
            </div>
          ))}
        </div>

        {/* Tier ladder (+ Rank Pass rewards for my own rank) */}
        <div className="mt-4 text-[11px] uppercase tracking-wider text-muted-foreground">Rank ladder</div>
        <div className="mt-1.5 flex flex-col gap-1.5">
          {[...TIERS].reverse().map((t) => {
            const reached = rec.elo >= t.min
            const current = t.id === tier.id
            const coins = RANK_PASS_COINS[t.id]
            const got = claimed.has(t.id)
            return (
              <div
                key={t.id}
                className={`flex items-center gap-2 rounded-xl border px-3 py-2 ${reached ? "" : "opacity-50"}`}
                style={{ borderColor: current ? t.color : "transparent", backgroundColor: current ? `${t.color}22` : undefined }}
              >
                <span className="text-lg" aria-hidden>{t.emoji}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold" style={{ color: t.color }}>{t.name}{current && <span className="ml-1.5 text-[10px] text-muted-foreground">current</span>}</div>
                  <div className="text-[10px] text-muted-foreground">{t.min}+ Elo</div>
                </div>
                {isMe && coins !== undefined && (
                  <div className="text-right text-[11px] leading-tight">
                    <div className="font-semibold tabular-nums">+{coins.toLocaleString()} coins</div>
                    <div className="text-muted-foreground">+{RANK_PASS_GEMS} gem</div>
                  </div>
                )}
                {isMe && coins !== undefined && (reached && got ? <Check className="h-4 w-4 text-emerald-500 shrink-0" /> : null)}
              </div>
            )
          })}
        </div>

        {isMe && (
          <>
            <button
              onClick={claim}
              disabled={claimable.length === 0}
              className={`mt-3 w-full h-11 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 ${
                claimable.length > 0 ? "bg-gradient-to-r from-amber-400 to-amber-300 text-[#3b2a00] shadow-md shadow-amber-400/40" : "bg-black/5 dark:bg-white/10 text-muted-foreground"
              }`}
            >
              <Gift className="h-4 w-4" />
              {claimable.length > 0 ? `Claim rank pass rewards (${claimable.length})` : "Rank pass rewards claimed ✓"}
            </button>
            <p className="mt-1.5 text-center text-[10px] text-muted-foreground">
              Every time you pass into a new tier you get coins and {RANK_PASS_GEMS} gem — once per tier.
            </p>
          </>
        )}
        {msg && <div className="mt-2 text-center text-sm font-semibold text-emerald-500">{msg}</div>}
      </div>
    </div>,
    panelTarget,
  )
}

/** The "RANKED" tag shown on ranked rooms. */
export function RankedTag({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-amber-500 to-orange-500 px-2 py-0.5 text-[10px] font-extrabold tracking-wider text-white shadow ${className}`}
    >
      <Swords className="h-3 w-3" /> RANKED
    </span>
  )
}

/** "+16" (green) / "-12" (red) rating change. */
export function RatingDelta({ delta, className = "" }: { delta: number; className?: string }) {
  const cls = delta > 0 ? "text-emerald-400" : delta < 0 ? "text-red-400" : "text-white/60"
  return <span className={`font-bold tabular-nums ${cls} ${className}`}>{delta > 0 ? `+${delta}` : delta < 0 ? `-${Math.abs(delta)}` : "±0"}</span>
}

// ---------------------------------------------------------------------------
// Lobby "Ranked" tab
// ---------------------------------------------------------------------------

interface Props {
  darkMode: boolean
  /** signed-in account id, null for guests */
  uid: string | null
  online: boolean
  /** a create/join request is running */
  busy: boolean
  /** a Join Global search is running */
  globalBusy?: boolean
  onCreate: () => void
  onJoinGlobal: () => void
  onJoin: (code: string) => void
}

export default function RankedPanel({ darkMode, uid, online, busy, globalBusy = false, onCreate, onJoinGlobal, onJoin }: Props) {
  const [view, setView] = useState<"play" | "board">("play")
  const [rec, setRec] = useState<RankedRecord | null>(null)
  const [recLoaded, setRecLoaded] = useState(false)
  const [joinCode, setJoinCode] = useState("")
  const [signInBusy, setSignInBusy] = useState(false)
  const [signInError, setSignInError] = useState("")
  const [rows, setRows] = useState<LeaderboardRow[] | null>(null)
  const [boardError, setBoardError] = useState("")
  const [sheet, setSheet] = useState<null | { name: string; rec: RankedRecord; isMe: boolean }>(null)

  const muted = darkMode ? "text-white/60" : "text-black/60"
  const card = darkMode ? "bg-white/5 border-white/10" : "bg-black/5 border-black/10"

  // My rating (live)
  useEffect(() => {
    if (!uid) {
      setRec(null)
      setRecLoaded(false)
      return
    }
    return subscribeMyRanked(uid, (r) => {
      setRec(r)
      setRecLoaded(true)
    })
  }, [uid])

  // Leaderboard loads when it is opened
  useEffect(() => {
    if (view !== "board") return
    let cancelled = false
    setRows(null)
    setBoardError("")
    fetchLeaderboard(20)
      .then((r) => !cancelled && setRows(r))
      .catch(() => !cancelled && setBoardError("Could not load the leaderboard. Check your connection."))
    return () => {
      cancelled = true
    }
  }, [view])

  // ---- guests: ranked needs a Google account ----
  if (!uid) {
    return (
      <div className="flex flex-col gap-3">
        <div className={`rounded-2xl border p-4 text-center ${card}`}>
          <Trophy className="mx-auto mb-2 h-8 w-8 text-amber-500" />
          <div className="text-sm font-bold">Ranked needs a Google account</div>
          <p className={`mt-1 text-xs ${muted}`}>Sign in to earn Elo, climb the tiers and appear on the leaderboard.</p>
        </div>
        {signInError && <div className="rounded-xl bg-red-500/15 px-3 py-2 text-xs text-red-600 dark:text-red-400">{signInError}</div>}
        <Button
          onClick={async () => {
            setSignInBusy(true)
            setSignInError("")
            const res = await signInWithGoogle()
            if (!res.ok && res.error) setSignInError(res.error)
            setSignInBusy(false)
          }}
          disabled={signInBusy}
          className="h-12 rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-400 text-base font-semibold text-white"
        >
          {signInBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <LogIn className="mr-2 h-4 w-4" />}
          Sign in with Google
        </Button>
      </div>
    )
  }

  // ---- leaderboard ----
  if (view === "board") {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <button
            onClick={() => setView("play")}
            className={`flex items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold ${darkMode ? "hover:bg-white/10" : "hover:bg-black/5"}`}
          >
            <ArrowLeft className="h-4 w-4" /> Back
          </button>
          <div className="flex items-center gap-1.5 text-sm font-bold">
            <Trophy className="h-4 w-4 text-amber-500" /> Top 20
          </div>
          <span className="w-14" />
        </div>

        {boardError && <div className="rounded-xl bg-red-500/15 px-3 py-2 text-xs text-red-600 dark:text-red-400">{boardError}</div>}
        {!rows && !boardError && (
          <div className={`flex items-center justify-center gap-2 py-8 text-xs ${muted}`}>
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        )}
        {rows && rows.length === 0 && <div className={`py-8 text-center text-xs ${muted}`}>No ranked matches yet — be the first!</div>}
        {rows && rows.length > 0 && (
          <div className="flex max-h-72 flex-col gap-1.5 overflow-y-auto pr-0.5">
            {rows.map((r, i) => {
              const mine = r.uid === uid
              return (
                <div
                  key={r.uid}
                  className={`flex items-center gap-2 rounded-xl border px-3 py-2 ${
                    mine ? "border-emerald-500 bg-emerald-500/15 ring-1 ring-emerald-500" : card
                  }`}
                >
                  <span className={`w-6 shrink-0 text-center text-xs font-bold ${i < 3 ? "text-amber-500" : muted}`}>{i + 1}</span>
                  <button type="button" onClick={() => openPlayerProfile(r.uid)} className="min-w-0 flex-1 flex items-center gap-2 text-left">
                    <PlayerAvatar photo={r.photo} avatarId={r.avatar} vip={r.vip} size={28} ring={false} />
                    <span className="min-w-0 truncate text-sm font-medium">
                      {r.vip && <VipCrown className="h-3.5 w-3.5" />}{r.name}
                      {mine && <span className={`text-[11px] ${muted}`}> (you)</span>}
                    </span>
                  </button>
                  <TierBadge elo={r.elo} onClick={() => setSheet({ name: r.name, rec: { elo: r.elo, wins: r.wins, losses: r.losses, matches: r.matches }, isMe: mine })} />
                  <span className="w-12 shrink-0 text-right text-sm font-bold tabular-nums">{r.elo}</span>
                </div>
              )
            })}
          </div>
        )}
        {sheet && <RankDetailsSheet name={sheet.name} rec={sheet.rec} isMe={sheet.isMe} myElo={rec?.elo ?? null} onClose={() => setSheet(null)} />}
      </div>
    )
  }

  // ---- play ----
  const shown = rec ?? newRankedRecord()
  const cannot = busy || globalBusy || !online

  return (
    <div className="flex flex-col gap-3">
      {/* My rating */}
      <div className={`rounded-2xl border p-4 ${card}`}>
        <div className="flex items-center justify-between">
          <div className={`text-xs font-semibold ${muted}`}>YOUR RANK</div>
          <TierBadge elo={shown.elo} onClick={() => setSheet({ name: "You", rec: shown, isMe: true })} />
        </div>
        <div className="mt-1 flex items-end gap-2">
          <span className="text-4xl font-black leading-none tabular-nums">{recLoaded ? shown.elo : "…"}</span>
          <span className={`pb-0.5 text-xs ${muted}`}>Elo</span>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
          <div className={`rounded-lg py-1.5 ${darkMode ? "bg-white/5" : "bg-black/5"}`}>
            <div className="text-sm font-bold text-emerald-500">{shown.wins}</div>
            <div className={muted}>Wins</div>
          </div>
          <div className={`rounded-lg py-1.5 ${darkMode ? "bg-white/5" : "bg-black/5"}`}>
            <div className="text-sm font-bold text-red-500">{shown.losses}</div>
            <div className={muted}>Losses</div>
          </div>
          <div className={`rounded-lg py-1.5 ${darkMode ? "bg-white/5" : "bg-black/5"}`}>
            <div className="text-sm font-bold">{shown.matches}</div>
            <div className={muted}>Matches</div>
          </div>
        </div>
        {recLoaded && !rec && <p className={`mt-2 text-center text-[11px] ${muted}`}>Unranked — play your first ranked match to get started</p>}
      </div>

      {/* Split button: Create Ranked Room | Join Global */}
      <div className="flex h-14 overflow-hidden rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 shadow-lg shadow-amber-500/30">
        <button
          onClick={onCreate}
          disabled={cannot}
          className="flex flex-1 items-center justify-center gap-2 px-1 text-sm font-semibold text-white transition-colors hover:bg-white/15 active:bg-white/25 disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          {busy ? "Creating…" : "Create Ranked Room"}
        </button>
        <div className="my-2 w-px bg-white/50" />
        <button
          onClick={onJoinGlobal}
          disabled={cannot}
          className="flex flex-1 items-center justify-center gap-2 px-1 text-sm font-semibold text-white transition-colors hover:bg-white/15 active:bg-white/25 disabled:opacity-60"
        >
          {globalBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Globe className="h-4 w-4" />}
          {globalBusy ? "Finding…" : "Join Global"}
        </button>
      </div>
      <p className={`-mt-1 text-center text-[11px] ${muted}`}>Join Global matches you with random online ranked players</p>

      <div className="my-0.5 flex items-center gap-3">
        <div className={`h-px flex-1 ${darkMode ? "bg-white/10" : "bg-black/10"}`} />
        <span className={`text-xs ${muted}`}>or join</span>
        <div className={`h-px flex-1 ${darkMode ? "bg-white/10" : "bg-black/10"}`} />
      </div>

      <input
        value={joinCode}
        onChange={(e) => setJoinCode(normalizeRoomCode(e.target.value))}
        placeholder="CODE"
        maxLength={6}
        className={`w-full rounded-xl border px-4 py-3 text-center font-mono text-sm uppercase tracking-[0.3em] outline-none focus:border-amber-500 ${
          darkMode ? "border-white/10 bg-white/5 placeholder:text-white/30" : "border-black/10 bg-black/5 placeholder:text-black/30"
        }`}
      />
      <Button onClick={() => onJoin(joinCode)} disabled={cannot} variant="outline" className="h-12 rounded-xl font-semibold">
        Join Ranked Room
      </Button>

      <Button onClick={() => setView("board")} variant="ghost" className="h-10 rounded-xl font-semibold">
        <Trophy className="mr-2 h-4 w-4 text-amber-500" /> Leaderboard
      </Button>

      <p className={`text-center text-[11px] ${muted}`}>
        Elo only counts with {RANKED_MIN_PLAYERS}+ players who are all signed in with different Google accounts. Quitting mid-battle counts as last place.
      </p>
      {sheet && <RankDetailsSheet name={sheet.name} rec={sheet.rec} isMe={sheet.isMe} myElo={rec?.elo ?? null} onClose={() => setSheet(null)} />}
    </div>
  )
}
