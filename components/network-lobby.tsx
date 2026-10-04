"use client"

// components/network-lobby.tsx — Socket.io lobby UI (runs next to the Firebase lobby, nothing replaced).
// Owned by <NetworkSession/>, which passes the live `net` hook object.
import { useState } from "react"
import type { UseSnakeNetwork } from "@/hooks/useSnakeNetwork"
import type { GameMode } from "@/shared/snake-protocol"

interface Props {
  net: UseSnakeNetwork
  name: string
  darkMode: boolean
  isRanked: boolean
  onRankedChange: (v: boolean) => void
  canRank: boolean // false = guest / unverified: ranked toggle disabled
  onExit: () => void
}

export default function NetworkLobby({ net, name, darkMode, isRanked, onRankedChange, canRank, onExit }: Props) {
  const [code, setCode] = useState("")
  const [busy, setBusy] = useState(false)
  const [mode, setMode] = useState<GameMode>("classic")

  const pingColor = net.ping === null ? "#888" : net.ping < 80 ? "#3af08d" : net.ping < 160 ? "#ffe14d" : "#ff5d7a"
  const me = net.players.find((p) => p.id === net.me?.playerId)
  const isHost = net.me?.isHost ?? false

  const run = async (fn: () => Promise<{ ok: boolean; message?: string }>) => {
    setBusy(true)
    try {
      const r = await fn()
      if (!r.ok) net.clearError()
    } finally {
      setBusy(false)
    }
  }

  const card = darkMode ? "bg-white/5 border-white/10" : "bg-black/5 border-black/10"
  const btn =
    "px-4 py-2 rounded-xl font-semibold text-sm transition active:scale-95 disabled:opacity-50"
  const primary = `${btn} bg-emerald-500 text-white hover:bg-emerald-600`
  const ghost = `${btn} ${darkMode ? "bg-white/10 hover:bg-white/20" : "bg-black/10 hover:bg-black/20"}`

  return (
    <div className="flex flex-col gap-3 p-4 max-w-md mx-auto w-full">
      {/* connection badge */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-mono" style={{ color: pingColor }}>
          {!net.isConnected ? (net.isReconnecting ? "Reconnecting…" : "Offline") : `${net.ping ?? "–"} ms`}
        </span>
        <span className="text-[11px] opacity-60">⚡ Socket.io mode</span>
      </div>

      {net.lastError && (
        <button onClick={net.clearError} className={`text-xs px-3 py-2 rounded-xl border ${card} text-red-400 text-left`}>
          {net.lastError.message} (tap to dismiss)
        </button>
      )}

      {!net.room ? (
        <div className={`flex flex-col gap-3 p-4 rounded-2xl border ${card}`}>
          <div className="text-sm opacity-70">
            Playing as <b>{name || "Player"}</b>
          </div>
          <div className="flex gap-2">
            {(["classic", "royale"] as GameMode[]).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`${btn} flex-1 ${mode === m ? "bg-emerald-500 text-white" : darkMode ? "bg-white/10" : "bg-black/10"}`}
              >
                {m === "classic" ? "⚔ Classic" : "👑 Royale"}
              </button>
            ))}
          </div>
          <button disabled={busy || !net.isConnected} className={primary} onClick={() => void run(() => net.createRoom({ name: name || "Player", settings: { mode } }))}>
            Create room
          </button>
          <div className="flex gap-2">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 6))}
              placeholder="CODE"
              maxLength={6}
              className={`flex-1 px-3 py-2 rounded-xl border ${card} font-mono tracking-widest uppercase text-center`}
            />
            <button disabled={busy || !net.isConnected || code.length !== 6} className={ghost} onClick={() => void run(() => net.joinRoom({ code, name: name || "Player" }))}>
              Join
            </button>
          </div>
          <button disabled={busy || !net.isConnected} className={ghost} onClick={() => void run(() => net.quickMatch({ name: name || "Player", mode }))}>
            🌍 Quick match
          </button>
          <button className={`${ghost} opacity-70`} onClick={onExit}>
            ← Back
          </button>
        </div>
      ) : (
        <div className={`flex flex-col gap-3 p-4 rounded-2xl border ${card}`}>
          <div className="flex items-center justify-between">
            <span className="font-mono text-lg tracking-widest font-bold">{net.room.code}</span>
            <button
              className="text-xs opacity-60 hover:opacity-100"
              onClick={() => {
                try {
                  void navigator.clipboard.writeText(net.room!.code)
                } catch {
                  /* clipboard unavailable */
                }
              }}
            >
              📋 copy
            </button>
          </div>

          <div className="flex flex-col gap-1">
            {net.players.map((p) => (
              <div key={p.id} className="flex items-center gap-2 text-sm" style={{ opacity: p.connected ? 1 : 0.4 }}>
                <span style={{ color: p.color }}>●</span>
                <span className="flex-1 truncate">{p.name}</span>
                {p.uid && <span title="Verified Google account" className="text-emerald-400 text-xs">✓</span>}
                {p.isHost && <span title="Host">👑</span>}
                {p.ready && <span className="text-emerald-400">✔</span>}
                {!p.connected && <span className="text-xs opacity-60">(reconnecting…)</span>}
              </div>
            ))}
          </div>

          {/* ranked opt-in (per player) */}
          <label className="flex items-center gap-2 text-xs opacity-80 cursor-pointer">
            <input
              type="checkbox"
              checked={isRanked}
              disabled={!canRank}
              onChange={(e) => onRankedChange(e.target.checked)}
            />
            🏆 Ranked — count this match for my rating
            {!canRank && <span className="opacity-60">(Google sign-in needed)</span>}
          </label>

          {isHost ? (
            <div className="flex gap-2">
              <button
                disabled={busy}
                className={ghost}
                onClick={() => void run(() => net.updateSettings({ mode: net.room!.settings.mode === "royale" ? "classic" : "royale" }))}
              >
                Mode: {net.room.settings.mode}
              </button>
              <button disabled={busy} className={`${primary} flex-1`} onClick={() => void run(() => net.startGame())}>
                Start ({net.players.length}/{net.room.maxPlayers})
              </button>
            </div>
          ) : (
            <button disabled={busy} className={primary} onClick={() => void run(() => net.setReady(!(me?.ready ?? false)))}>
              {me?.ready ? "Not ready" : "Ready ✔"}
            </button>
          )}
          {net.room.autoStartAt && (
            <p className="text-xs opacity-60 text-center">
              Auto-starts {new Date(net.room.autoStartAt - net.serverOffsetMs).toLocaleTimeString()}
            </p>
          )}
          <button disabled={busy} className={`${ghost} opacity-70`} onClick={() => void run(() => net.leaveRoom())}>
            Leave room
          </button>
        </div>
      )}
    </div>
  )
}
