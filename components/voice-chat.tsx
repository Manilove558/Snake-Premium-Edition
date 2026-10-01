"use client"

import { useEffect, useRef, useState } from "react"
import { Mic, MicOff, PhoneOff } from "lucide-react"
import { VoiceChatManager, getVoiceManager, releaseVoiceListener, type VoicePeer, type VoiceState } from "@/lib/voice-chat"

interface Props {
  code: string
  playerId: string
  playerName: string
  darkMode: boolean
  /** compact: just the mic button (for the battle header) */
  compact?: boolean
}

export default function VoiceChat({ code, playerId, playerName, darkMode, compact }: Props) {
  const [vcState, setVcState] = useState<VoiceState>("off")
  const [muted, setMuted] = useState(false)
  const [peers, setPeers] = useState<VoicePeer[]>([])
  const [err, setErr] = useState("")
  const mgrRef = useRef<VoiceChatManager | null>(null)
  const nameRef = useRef(playerName)
  nameRef.current = playerName

  useEffect(() => {
    // Attach to the room-session voice manager (shared across lobby <-> battle).
    // Unmounting only detaches this UI; voice keeps flowing until room leave.
    const { mgr, listenerId } = getVoiceManager(code, playerId, nameRef.current, {
      onPeers: setPeers,
      onState: (s, e) => {
        setVcState(s)
        setErr(s === "error" ? (e ?? "Mic error") : "")
      },
      onMuted: setMuted,
    })
    mgrRef.current = mgr
    return () => {
      releaseVoiceListener(code, playerId, listenerId)
      mgrRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, playerId])

  const enable = () => {
    setErr("")
    mgrRef.current?.start()
  }
  const toggleMute = () => mgrRef.current?.setMuted(!muted)
  const leave = () => mgrRef.current?.stop()

  const btnBase = `flex items-center justify-center gap-2 rounded-xl font-semibold transition active:scale-95 `

  if (compact) {
    if (vcState === "off" || vcState === "error") {
      return (
        <button
          onClick={enable}
          aria-label="Enable voice chat"
          title="Voice chat on karo"
          className={`p-2 rounded-full ${darkMode ? "hover:bg-white/10 text-white/70" : "hover:bg-black/5 text-black/60"}`}
        >
          <MicOff className="w-5 h-5" />
        </button>
      )
    }
    return (
      <div className="flex items-center gap-1">
        {vcState === "on" && peers.length > 0 && (
          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${darkMode ? "bg-emerald-400/20 text-emerald-300" : "bg-emerald-600/15 text-emerald-700"}`}>
            {peers.length + 1}
          </span>
        )}
        <button
          onClick={vcState === "starting" ? undefined : toggleMute}
          aria-label={muted ? "Unmute" : "Mute"}
          title={muted ? "Unmute" : "Mute"}
          className={`p-2 rounded-full ${
            muted
              ? "bg-red-500/20 text-red-500"
              : darkMode
                ? "bg-emerald-400/20 text-emerald-300 hover:bg-emerald-400/30"
                : "bg-emerald-600/15 text-emerald-700 hover:bg-emerald-600/25"
          }`}
        >
          {vcState === "starting" ? <Mic className="w-5 h-5 animate-pulse" /> : muted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
        </button>
      </div>
    )
  }

  return (
    <div className={`rounded-2xl border px-3 py-2.5 ${darkMode ? "border-white/10 bg-white/5" : "border-black/10 bg-black/5"}`}>
      <div className="flex items-center justify-between">
        <span className={`text-xs font-bold ${darkMode ? "text-white/80" : "text-black/80"}`}>🎙 VOICE CHAT</span>
        {vcState === "off" && (
          <button onClick={enable} className={btnBase + "px-3 py-1.5 text-xs bg-emerald-500 text-white shadow"}>
            <Mic className="w-3.5 h-3.5" /> Enable
          </button>
        )}
        {vcState === "starting" && <span className="text-xs opacity-60">Connecting…</span>}
        {vcState === "on" && (
          <div className="flex items-center gap-1.5">
            <button
              onClick={toggleMute}
              aria-label={muted ? "Unmute" : "Mute"}
              className={`p-2 rounded-full ${muted ? "bg-red-500/20 text-red-500" : darkMode ? "bg-emerald-400/20 text-emerald-300" : "bg-emerald-600/15 text-emerald-700"}`}
            >
              {muted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            </button>
            <button
              onClick={leave}
              aria-label="Leave voice chat"
              className={`p-2 rounded-full ${darkMode ? "bg-white/10 text-white/70" : "bg-black/10 text-black/60"}`}
            >
              <PhoneOff className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
      {err && <div className="text-[11px] text-red-500 mt-1.5">{err}</div>}
      {vcState === "on" && (
        <div className="text-[11px] mt-1.5 opacity-70">
          {peers.length === 0 ? (
            "Tum akele ho — doston ke enable karne ka wait karo…"
          ) : (
            <span className="flex flex-wrap gap-1.5">
              {peers.map((p) => (
                <span key={p.id} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full ${darkMode ? "bg-white/10" : "bg-black/10"}`}>
                  {p.muted ? <MicOff className="w-3 h-3" /> : <Mic className="w-3 h-3 text-emerald-500" />}
                  {p.name}
                </span>
              ))}
            </span>
          )}
        </div>
      )}
      {vcState === "off" && !err && (
        <div className="text-[11px] mt-1 opacity-50">Doston se live baat karo — mic permission lagegi</div>
      )}
    </div>
  )
}
