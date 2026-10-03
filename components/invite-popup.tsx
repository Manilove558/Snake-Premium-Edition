"use client"

import { useEffect, useState } from "react"
import { Swords, X, Loader2 } from "lucide-react"
import { useAuthUser } from "@/lib/auth"
import { removeRoomInvite, startPresence, useRoomInvites, type RoomInvite } from "@/lib/invites"
import { PlayerAvatar } from "./player-avatar"

interface Props {
  darkMode: boolean
  /** Join the invited room. Returns an error message, or null on success. */
  onAccept: (invite: RoomInvite) => Promise<string | null>
}

// Card geometry for the overlapping stack (newest invite on top)
const CARD_H = 84
const PEEK = 16

/**
 * Global room-invite notifications. Rendered once at the game root: whenever a
 * host invites me, a card pops up with Join / Decline — wherever I am in the game.
 * Multiple invites stack on top of each other (newest on top); each invite
 * auto-vanishes 5 seconds after it arrives. Also runs the online-presence
 * heartbeat while I'm signed in.
 */
export default function InvitePopup({ darkMode, onAccept }: Props) {
  const { user } = useAuthUser()
  const uid = user?.uid ?? null
  const invites = useRoomInvites(uid)
  const [busyCode, setBusyCode] = useState<string | null>(null)
  const [error, setError] = useState("")
  // Invites the player already swatted away — hidden instantly, even before the
  // database delete lands. Keyed by room+timestamp so a FRESH re-invite to the
  // same room (new `at`) still pops up instead of being swallowed.
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const dismissKey = (inv: RoomInvite) => `${inv.roomCode}:${inv.at}`

  // Online-presence heartbeat while signed in (drives friends' green dots)
  useEffect(() => {
    if (!uid) return
    setDismissed(new Set())
    return startPresence(uid)
  }, [uid])

  // Oldest → newest; the newest card renders on top of the stack.
  const list = Object.values(invites)
    .filter((inv) => !dismissed.has(dismissKey(inv)))
    .sort((a, b) => a.at - b.at)
  if (!uid || list.length === 0) return null

  const accept = async (inv: RoomInvite) => {
    setBusyCode(inv.roomCode)
    setError("")
    const err = await onAccept(inv)
    setBusyCode(null)
    if (err) {
      setError(err)
    } else {
      setDismissed((s) => new Set(s).add(dismissKey(inv)))
    }
  }

  const decline = (inv: RoomInvite) => {
    setError("")
    setDismissed((s) => new Set(s).add(dismissKey(inv)))
    removeRoomInvite(uid, inv.roomCode)
  }

  return (
    <div style={{ bottom: "max(16px, var(--sai-bottom))" }} className="fixed inset-x-0 z-[70] flex flex-col items-center gap-2 pointer-events-none safe-area-px">
      {error && (
        <div className="pointer-events-auto max-w-sm w-full text-xs px-3 py-2 rounded-xl bg-red-500/15 text-red-600 dark:text-red-400 text-center">
          {error}
        </div>
      )}
      <div className="relative w-full max-w-sm" style={{ height: CARD_H + (list.length - 1) * PEEK }}>
        {list.map((inv, i) => {
          const depth = list.length - 1 - i // 0 = newest = top of the stack
          return (
            <div
              key={inv.roomCode}
              className={`absolute inset-x-0 pointer-events-auto rounded-2xl border p-4 shadow-2xl flex items-center gap-3 transition-all duration-300 ${
                darkMode ? "bg-[#0d1f16] border-emerald-400/30 text-white" : "bg-white border-emerald-600/30 text-[#123321]"
              }`}
              style={{
                height: CARD_H,
                bottom: depth * PEEK,
                zIndex: 10 + i,
                transform: `scale(${1 - depth * 0.05})`,
                transformOrigin: "bottom center",
              }}
            >
              <PlayerAvatar
                photo={inv.fromPhoto ?? null}
                avatarId={inv.avatarId ?? null}
                vip={inv.fromVip ?? false}
                size={44}
              />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold truncate">{inv.fromName} invited you!</div>
                <div className={`text-xs ${darkMode ? "text-white/60" : "text-black/60"}`}>
                  Join room <span className="font-mono font-bold tracking-widest">{inv.roomCode}</span>
                </div>
              </div>
              <button
                onClick={() => accept(inv)}
                disabled={busyCode === inv.roomCode}
                className="shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold text-white bg-gradient-to-r from-emerald-500 to-emerald-400 shadow-lg shadow-emerald-500/30 disabled:opacity-60"
              >
                {busyCode === inv.roomCode ? <Loader2 className="w-4 h-4 animate-spin" /> : <Swords className="w-4 h-4" />}
                Join
              </button>
              <button
                onClick={() => decline(inv)}
                aria-label="Decline invite"
                className={`shrink-0 p-2 rounded-full ${darkMode ? "hover:bg-white/10" : "hover:bg-black/5"}`}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
