"use client"

import { PlayerAvatar } from "./player-avatar"
import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Users, Copy, Check, LogOut, WifiOff, X, Play, Globe, Plus, Loader2, Settings, UserPlus } from "lucide-react"
import {
  getRoomSettings,
  GLOBAL_AUTOSTART_MS,
  normalizeRoomCode,
  MAX_MP_PLAYERS,
  BATTLE_MIN_PLAYERS,
  BOT_FILL_TARGET,
  botFillCount,
  isBotPlayer,
  type MpSettings,
} from "@/lib/multiplayer"
import { BOT_DIFFICULTY, BOT_LEVELS } from "@/lib/bot-ai"
import { BotTag } from "./bot-tag"
import { BATTLE_MAPS, getBattleMap, type BattleMap } from "@/lib/battle-maps"
import { BR_MIN_PLAYERS, BR_MAX_PLAYERS, BR_GRID, ZONE_INTERVAL_MS } from "@/lib/br/constants"
import { useAuthUser } from "@/lib/auth"
import { useDisplayName } from "@/lib/profile-name"
import { isVip, useStore } from "@/lib/store"
import { openPlayerProfile, useFriends, usePublicProfiles } from "@/lib/friends"
import { INVITE_TTL_MS, sendRoomInvite, usePresence } from "@/lib/invites"
import { FriendAction } from "./snake-friends"
import VoiceChat from "./voice-chat"
import { destroyVoiceManager } from "@/lib/voice-chat"
import RankedPanel, { RankedTag } from "./ranked-panel"
import { isGoogleUser } from "@/lib/ranked-db"
import { RANKED_MIN_PLAYERS } from "@/lib/ranked"
import { VipCrown } from "./vip-crown"
import { useNet } from "./net-provider"

/** What the home screen's bottom-right action bar needs to know about the room (host-only start, leave) */
export interface LobbyRoomInfo {
  inRoom: boolean
  isHost: boolean
  /** host + enough players + not already starting */
  canStart: boolean
  starting: boolean
  minPlayers: number
}
export interface LobbyActions {
  /** host only (ignored for everybody else) */
  start: () => void
  /** leave the room cleanly and close the multiplayer view */
  leave: () => Promise<void>
}
export const NO_LOBBY_ROOM: LobbyRoomInfo = { inRoom: false, isHost: false, canStart: false, starting: false, minPlayers: 2 }

interface Props {
  darkMode: boolean
  onRoomInfo?: (info: LobbyRoomInfo) => void
  actionsRef?: { current: LobbyActions | null }
  onExit: () => void
  onBattleStart: (code: string, playerId: string) => void
  /** came back via ✕ while the match is still running: do NOT hand over to the battle until the next round (countdown) */
  returnedMidMatch?: boolean
}

function Toggle({ on, onChange, darkMode, disabled }: { on: boolean; onChange: (v: boolean) => void; darkMode: boolean; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`relative w-11 h-6 shrink-0 rounded-full transition-colors ${
        on ? "bg-emerald-500" : darkMode ? "bg-white/20" : "bg-black/20"
      } ${disabled ? "opacity-70 cursor-not-allowed" : ""}`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
          on ? "translate-x-5" : ""
        }`}
      />
    </button>
  )
}

/** Tiny top-down preview of a battle map. */
function MapPreview({ map }: { map: BattleMap }) {
  const portalColors = ["#4da6ff", "#c77dff"]
  return (
    <svg viewBox="0 0 20 20" className="w-full h-auto rounded-md" style={{ background: "rgba(127,127,127,0.12)" }}>
      {map.walls.map((w, i) => (
        <rect key={i} x={w.x} y={w.y} width={1} height={1} fill="currentColor" opacity={0.65} />
      ))}
      {map.portals.map((pair, pi) =>
        pair.map((c, ci) => (
          <circle
            key={`${pi}-${ci}`}
            cx={c.x + 0.5}
            cy={c.y + 0.5}
            r={1.2}
            fill="none"
            stroke={portalColors[pi % portalColors.length]}
            strokeWidth={0.5}
          />
        )),
      )}
    </svg>
  )
}

function SettingsPanel({
  settings,
  darkMode,
  onChange,
  onClose,
  ranked = false,
}: {
  settings: MpSettings
  ranked?: boolean
  darkMode: boolean
  onChange: (patch: Partial<MpSettings>) => void
  onClose: () => void
}) {
  const muted = darkMode ? "text-white/60" : "text-black/60"
  const row = `flex items-center justify-between gap-3 px-3 py-3 rounded-xl ${darkMode ? "bg-white/5" : "bg-black/5"}`
  return (
    <div className="absolute inset-0 z-[60] flex overflow-y-auto p-2 bg-black/60 backdrop-blur-sm">
      <div
        className={`m-auto w-full max-w-sm max-h-full overflow-y-auto rounded-3xl border p-5 shadow-2xl ${
          darkMode ? "bg-[#0d1f16] border-white/10 text-white" : "bg-white border-black/10 text-[#123321]"
        }`}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Settings className="w-5 h-5 text-emerald-500" />
            <h2 className="text-lg font-bold">Room Settings</h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close settings"
            className={`p-2 rounded-full ${darkMode ? "hover:bg-white/10" : "hover:bg-black/5"}`}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Mode: Classic Battle / Snake Battle Royale (ranked rooms are always classic) */}
        {!ranked && (
          <>
            <div className={`text-xs font-semibold mb-2 ${muted}`}>MODE</div>
            <div className="grid grid-cols-2 gap-2 mb-5">
              {(
                [
                  { id: "classic", icon: "⚔️", name: "Classic Battle", sub: `2-${BR_MAX_PLAYERS} players · 20×20` },
                  { id: "royale", icon: "👑", name: "Snake Battle Royale", sub: `${BR_MIN_PLAYERS}-${BR_MAX_PLAYERS} players · ${BR_GRID}×${BR_GRID} · shrinking zone` },
                ] as const
              ).map((m) => {
                const active = settings.mode === m.id
                return (
                  <button
                    key={m.id}
                    onClick={() => onChange({ mode: m.id })}
                    className={`p-2.5 rounded-xl border-2 text-center transition-colors ${
                      active ? "border-emerald-500 bg-emerald-500/10" : darkMode ? "border-white/10 hover:border-white/30" : "border-black/10 hover:border-black/30"
                    }`}
                  >
                    <div className="text-2xl leading-none">{m.icon}</div>
                    <div className={`mt-1 text-[12px] font-bold leading-tight ${active ? "text-emerald-500" : ""}`}>{m.name}</div>
                    <div className={`mt-0.5 text-[10px] leading-tight ${muted}`}>{m.sub}</div>
                  </button>
                )
              })}
            </div>
          </>
        )}

        {settings.mode === "royale" && !ranked ? (
          <>
            <div className={`${row} mb-5`}>
              <div className="text-[11px] leading-snug">
                <div className="text-sm font-semibold mb-0.5">👑 Last Snake Standing</div>
                <div className={muted}>
                  Huge {BR_GRID}×{BR_GRID} map with a camera + minimap. The safe zone shrinks every {ZONE_INTERVAL_MS / 1000}s (5s warning). Outside it you have 3s to get back. Needs {BR_MIN_PLAYERS}+ players.
                </div>
              </div>
            </div>
            <div className={`text-xs font-semibold mb-2 ${muted}`}>ARENA</div>
            <div className={`${row} mb-1`}>
              <div>
                <div className="text-sm font-semibold">Grid</div>
                <div className={`text-[11px] ${muted}`}>Show grid lines in the arena</div>
              </div>
              <Toggle on={settings.grid} onChange={(v) => onChange({ grid: v })} darkMode={darkMode} />
            </div>
          </>
        ) : (
        <>
        {/* Map */}
        <div className={`text-xs font-semibold mb-2 ${muted}`}>MAP</div>
        {ranked ? (
          <div className={`${row} mb-5`}>
            <div>
              <div className="text-sm font-semibold">🎲 Random map</div>
              <div className={`text-[11px] ${muted}`}>Ranked matches pick a different map at random every time</div>
            </div>
          </div>
        ) : (
        <div className="grid grid-cols-3 gap-2 mb-5">
            {BATTLE_MAPS.map((m) => {
              const active = settings.map === m.id
              return (
                <button
                  key={m.id}
                  onClick={() => onChange({ map: m.id })}
                  className={`p-1.5 rounded-xl border-2 text-center transition-colors ${
                    active
                      ? "border-emerald-500 bg-emerald-500/10"
                      : darkMode
                        ? "border-white/10 hover:border-white/30"
                        : "border-black/10 hover:border-black/30"
                  }`}
                >
                  <MapPreview map={m} />
                  <div className={`mt-1 text-[11px] font-semibold ${active ? "text-emerald-500" : ""}`}>{m.name}</div>
                </button>
              )
            })}
          </div>
        )}

        {/* Arena options */}
        <div className={`text-xs font-semibold mb-2 ${muted}`}>ARENA</div>
        <div className="flex flex-col gap-2 mb-5">
          <div className={row}>
            <div>
              <div className="text-sm font-semibold">Teleport {ranked && <span title="Ranked me hamesha ON">🔒</span>}</div>
              <div className={`text-[11px] ${muted}`}>{ranked ? "Ranked rule: hamesha ON — host badal nahi sakta" : "Snakes come out of the opposite edge instead of hitting the wall"}</div>
            </div>
            <Toggle on={ranked ? true : settings.teleport} onChange={(v) => onChange({ teleport: v })} darkMode={darkMode} disabled={ranked} />
          </div>
          <div className={row}>
            <div>
              <div className="text-sm font-semibold">Grid</div>
              <div className={`text-[11px] ${muted}`}>Show grid lines in the arena</div>
            </div>
            <Toggle on={settings.grid} onChange={(v) => onChange({ grid: v })} darkMode={darkMode} />
          </div>
        </div>

        {/* Snake behavior */}
        <div className={`text-xs font-semibold mb-2 ${muted}`}>SNAKE BEHAVIOR</div>
        <div className={row}>
          <div>
            <div className="text-sm font-semibold">Avoid snake collision {ranked && <span title="Ranked me hamesha ON">🔒</span>}</div>
            <div className={`text-[11px] ${muted}`}>{ranked ? "Ranked rule: hamesha ON — host badal nahi sakta" : "Snakes pass through each other — nobody is eliminated by a collision"}</div>
          </div>
          <Toggle on={ranked ? true : settings.avoidCollision} onChange={(v) => onChange({ avoidCollision: v })} darkMode={darkMode} disabled={ranked} />
        </div>
        </>
        )}

        {/* AI bots: fill empty slots when the battle starts (never in ranked rooms) */}
        {!ranked && (
          <>
            <div className={`text-xs font-semibold mt-5 mb-2 ${muted}`}>AI BOTS</div>
            <div className={row}>
              <div>
                <div className="text-sm font-semibold">🤖 Fill empty slots</div>
                <div className={`text-[11px] ${muted}`}>
                  Bots join at start up to {BOT_FILL_TARGET[settings.mode]} players
                </div>
              </div>
              <Toggle on={settings.bots} onChange={(v) => onChange({ bots: v })} darkMode={darkMode} />
            </div>
            {settings.bots && (
              <div className="grid grid-cols-3 gap-2 mt-2">
                {BOT_LEVELS.map((lv) => {
                  const active = settings.botLevel === lv
                  return (
                    <button
                      key={lv}
                      onClick={() => onChange({ botLevel: lv })}
                      className={`py-2 rounded-xl border-2 text-[12px] font-bold transition-colors ${
                        active ? "border-emerald-500 bg-emerald-500/10 text-emerald-500" : darkMode ? "border-white/10 hover:border-white/30" : "border-black/10 hover:border-black/30"
                      }`}
                    >
                      {BOT_DIFFICULTY[lv].label}
                    </button>
                  )
                })}
              </div>
            )}
          </>
        )}

        <Button onClick={onClose} className="w-full mt-6 h-11 rounded-xl font-semibold bg-gradient-to-r from-emerald-500 to-emerald-400 text-white">
          Done
        </Button>
      </div>
    </div>
  )
}

export default function MultiplayerLobby({ darkMode, onRoomInfo, actionsRef, onExit, onBattleStart, returnedMidMatch }: Props) {
  const { net, mp: room, ensureConnected } = useNet()
  const [name, setName] = useState("")
  const [joinCode, setJoinCode] = useState("")
  const [loading, setLoading] = useState(false)
  const [globalLoading, setGlobalLoading] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const [showSettings, setShowSettings] = useState(false)
  const [tab, setTab] = useState<"casual" | "ranked">("casual")
  const { user: authUser } = useAuthUser()
  const st = useStore()
  const myUid = authUser?.uid ?? null
  // Signed-in players always use their Profile name; guests type one
  const profileName = useDisplayName(authUser)
  const signedIn = !!authUser
  const playerName = (signedIn ? profileName : name).trim().slice(0, 16)
  const [error, setError] = useState("")
  const [copied, setCopied] = useState(false)
  // The room lives on the game server: "in a room" = the socket hook has one
  const code = net.room?.code ?? ""
  const playerId = net.me?.playerId ?? ""
  const screen: "setup" | "lobby" = net.room ? "lobby" : "setup"
  // Room invites (host only): friends list with online/offline status
  const { friends } = useFriends()
  const friendUids = Object.keys(friends)
  const friendProfiles = usePublicProfiles(friendUids)
  const friendPresence = usePresence(friendUids)
  const [invitedAt, setInvitedAt] = useState<Record<string, number>>({})
  const [inviteBusy, setInviteBusy] = useState<string | null>(null)
  const [showInviteModal, setShowInviteModal] = useState(false)

  const handleInviteFriend = async (fid: string) => {
    if (!isHost || !myUid || !code || inviteBusy) return
    setInviteBusy(fid)
    try {
      await sendRoomInvite({
        fromUid: myUid,
        fromName: playerName || "Player",
        fromPhoto: authUser?.photoURL ?? null,
        avatarId: st.equipped.avatar ?? null,
        fromVip: isVip(st),
        hostPlayerId: playerId,
        toUid: fid,
        roomCode: code,
      })
      setInvitedAt((m) => ({ ...m, [fid]: Date.now() }))
    } catch {
      setError("Could not send the invite. Check your connection.")
    } finally {
      setInviteBusy(null)
    }
  }
  const [online, setOnline] = useState(true)
  const leavingRef = useRef(false)
  const battleStartedRef = useRef(false)
  const waitNextRoundRef = useRef(!!returnedMidMatch)
  const wasInRoomRef = useRef(false)
  const onBattleStartRef = useRef(onBattleStart)
  onBattleStartRef.current = onBattleStart

  // Remember the player's name + track connectivity
  useEffect(() => {
    try {
      setName(localStorage.getItem("mp_name") || "")
    } catch {}
    const update = () => setOnline(navigator.onLine)
    update()
    window.addEventListener("online", update)
    window.addEventListener("offline", update)
    return () => {
      window.removeEventListener("online", update)
      window.removeEventListener("offline", update)
    }
  }, [])

  // Opening the multiplayer screen opens the socket (and re-attaches to a running room after a reload)
  useEffect(() => {
    net.connect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Room status -> hand over to the battle view; losing the room unexpectedly -> back to the setup screen
  const status = room?.status ?? null
  useEffect(() => {
    if (!room) {
      if (wasInRoomRef.current && !leavingRef.current) setError("The room was closed or you got disconnected from it.")
      wasInRoomRef.current = false
      battleStartedRef.current = false
      return
    }
    wasInRoomRef.current = true
    // came back mid-match: sit in the room until the match ends and a NEW round starts (or the room returns to lobby)
    if (room.status === "lobby" || room.status === "countdown") waitNextRoundRef.current = false
    // Battle started -> hand over to the battle view (once per round)
    if (!waitNextRoundRef.current && (room.status === "countdown" || room.status === "playing" || room.status === "ended") && !battleStartedRef.current) {
      battleStartedRef.current = true
      onBattleStartRef.current(room.code, playerId)
    }
    if (room.status === "lobby") battleStartedRef.current = false
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, !!room])

  const players = room ? Object.values(room.players ?? {}).sort((a, b) => (a.joinedAt ?? 0) - (b.joinedAt ?? 0)) : []
  const isHost = !!room && room.hostId === playerId
  const isGlobal = !!room?.isPublic
  const settings = getRoomSettings(room)
  const isRoyale = settings.mode === "royale"
  // The SERVER decides how many players a room needs (ranked 3+, royale 4+, classic 2, or 1 when bots fill the room)
  const botsOn = settings.bots && !room?.isRanked
  const humanCount = players.filter((p) => !isBotPlayer(p)).length
  const botsToJoin = botsOn && room?.status === "lobby" ? botFillCount(settings.mode, humanCount) : 0
  const minToStart = net.room?.minPlayers ?? BATTLE_MIN_PLAYERS
  const startMin = minToStart
  const autoStartAt = room?.autoStartAt ?? null
  const secondsLeft = autoStartAt ? Math.max(0, Math.ceil((autoStartAt - net.getServerTime()) / 1000)) : null
  void now

  // Share room state + actions with the bottom-right action bar (Start / Leave Room live there too)
  const canStartNow = screen === "lobby" && isHost && !loading && players.length >= startMin && (!room?.status || room.status === "lobby")
  if (actionsRef) actionsRef.current = { start: () => { void handleStartBattle() }, leave: () => handleLeaveAndExit() }
  const onRoomInfoRef = useRef(onRoomInfo)
  onRoomInfoRef.current = onRoomInfo
  useEffect(() => {
    onRoomInfoRef.current?.({
      inRoom: screen === "lobby" && !!code,
      isHost: screen === "lobby" && isHost,
      canStart: canStartNow,
      starting: loading,
      minPlayers: startMin,
    })
  }, [screen, code, isHost, canStartNow, loading, startMin])
  useEffect(() => () => { onRoomInfoRef.current?.(NO_LOBBY_ROOM) }, [])

  // Settings panel is host-only and lobby-only
  useEffect(() => {
    if (showSettings && (!isHost || screen !== "lobby")) setShowSettings(false)
  }, [showSettings, isHost, screen])

  const handleSettingsChange = (patch: Partial<MpSettings>) => {
    if (!isHost || !code) return
    // Ranked rules are fixed (the server enforces them too): teleport + avoid-collision ON, classic, no bots
    if (room?.isRanked) patch = { ...patch, teleport: true, avoidCollision: true, mode: "classic", bots: false }
    void net.updateSettings(patch).then((r) => {
      if (!r.ok) setError(r.message || "Could not save settings. Check your connection.")
    })
  }

  // Tick for the global auto-start countdown display (the SERVER starts the match, the client only shows the timer)
  useEffect(() => {
    if (!autoStartAt) return
    const id = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(id)
  }, [autoStartAt])

  const saveName = (n: string) => {
    try {
      localStorage.setItem("mp_name", n.trim().slice(0, 16))
    } catch {}
  }

  /** Common start of every "enter a room" action: online check, name check, open the socket. */
  const prepare = async (opts: { ranked?: boolean } = {}): Promise<boolean> => {
    if (!online) return fail("You are offline. Connect to the internet to play multiplayer.")
    if (opts.ranked && !isGoogleUser(authUser)) return fail("Sign in with Google to play ranked.")
    if (!playerName) return fail("Enter your name first.")
    setError("")
    net.clearError()
    saveName(playerName)
    const connected = await ensureConnected()
    if (!connected) {
      // the hook already wrote a clear message ("Can't reach the game server … is it running?")
      return fail(net.lastError?.message ?? "Can't reach the game server. Is it running? (npm run server:dev)")
    }
    return true
  }
  const fail = (msg: string): false => {
    setError(msg)
    return false
  }

  const handleCreate = async () => {
    setLoading(true)
    try {
      if (!(await prepare())) return
      const r = await net.createRoom({ name: playerName, vip: isVip(st), settings: { ranked: false } })
      if (!r.ok) setError(r.message)
    } finally {
      setLoading(false)
    }
  }

  const handleJoinGlobal = async () => {
    setGlobalLoading(true)
    try {
      if (!(await prepare())) return
      const r = await net.quickMatch({ name: playerName, vip: isVip(st), mode: "classic" })
      if (!r.ok) setError(r.message)
    } finally {
      setGlobalLoading(false)
    }
  }

  const handleJoin = async () => {
    const clean = normalizeRoomCode(joinCode)
    if (clean.length !== 6) return setError("Room code is 6 characters.")
    setLoading(true)
    try {
      if (!(await prepare())) return
      const r = await net.joinRoom({ code: clean, name: playerName, vip: isVip(st) })
      if (!r.ok) setError(r.message)
    } finally {
      setLoading(false)
    }
  }

  // ---- Ranked rooms: the host picks "ranked" when CREATING the room; it is all-or-nothing and fixed afterwards ----
  const handleCreateRanked = async () => {
    setLoading(true)
    try {
      if (!(await prepare({ ranked: true }))) return
      const r = await net.createRoom({ name: playerName, vip: isVip(st), settings: { ranked: true } })
      if (!r.ok) setError(r.message)
    } finally {
      setLoading(false)
    }
  }

  const handleJoinRankedGlobal = async () => {
    setGlobalLoading(true)
    try {
      if (!(await prepare({ ranked: true }))) return
      const r = await net.quickMatch({ name: playerName, vip: isVip(st), ranked: true })
      if (!r.ok) setError(r.message)
    } finally {
      setGlobalLoading(false)
    }
  }

  const handleJoinRanked = async (rawCode: string) => {
    const clean = normalizeRoomCode(rawCode)
    if (clean.length !== 6) return setError("Room code is 6 characters.")
    setLoading(true)
    try {
      if (!(await prepare({ ranked: true }))) return
      const r = await net.joinRoom({ code: clean, name: playerName, vip: isVip(st), expectRanked: true })
      if (!r.ok) setError(r.message)
    } finally {
      setLoading(false)
    }
  }

  const resetToSetup = () => {
    setJoinCode("")
    setShowInviteModal(false)
    battleStartedRef.current = false
    wasInRoomRef.current = false
  }

  const handleLeave = async () => {
    leavingRef.current = true
    try {
      if (code && playerId) destroyVoiceManager(code, playerId)
      await net.leaveRoom()
    } catch {}
    resetToSetup()
    leavingRef.current = false
  }

  // Leave the room and go all the way back to the default single-player view
  const handleLeaveAndExit = async () => {
    leavingRef.current = true
    try {
      if (code && playerId) destroyVoiceManager(code, playerId)
      await net.leaveRoom()
    } catch {}
    resetToSetup()
    onExit()
    leavingRef.current = false
  }

  const handleStartBattle = async () => {
    // Only the host may start the match (UI is disabled for everybody else; the server checks it again)
    if (!isHost || players.length < startMin) return
    if (room?.status && room.status !== "lobby") return // a match is still running (e.g. host came back mid-match)
    setLoading(true)
    setError("")
    try {
      const r = await net.startGame()
      if (!r.ok) setError(r.message)
      // the room status flips to "countdown" -> the effect above hands over to the battle view
    } finally {
      setLoading(false)
    }
  }


  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(code)
    } catch {
      // clipboard may be unavailable; still show feedback
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <>
    {showSettings && isHost && (
      <SettingsPanel
        ranked={!!room?.isRanked}
        settings={settings}
        darkMode={darkMode}
        onChange={handleSettingsChange}
        onClose={() => setShowSettings(false)}
      />
    )}
    {showInviteModal && isHost && screen === "lobby" && (() => {
      const roomUids = new Set(players.map((p) => p.uid).filter(Boolean) as string[])
      const list = friendUids.filter((fid) => !roomUids.has(fid))
      return (
        <div className="absolute inset-0 z-[60] flex overflow-y-auto p-2 bg-black/60 backdrop-blur-sm">
          <div
            className={`m-auto w-full max-w-sm rounded-3xl border p-5 shadow-2xl ${
              darkMode ? "bg-[#0d1f16] border-white/10 text-white" : "bg-white border-black/10 text-[#123321]"
            }`}
          >
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <UserPlus className="w-5 h-5 text-emerald-500" />
                <h2 className="text-lg font-bold">Invite Friends</h2>
              </div>
              <button
                onClick={() => setShowInviteModal(false)}
                aria-label="Close"
                className={`p-2 rounded-full ${darkMode ? "hover:bg-white/10" : "hover:bg-black/5"}`}
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            {list.length === 0 ? (
              <p className={`text-sm text-center py-4 ${darkMode ? "text-white/60" : "text-black/60"}`}>
                All your friends are already in this room 🎉
              </p>
            ) : (
              <div className="flex flex-col gap-2 max-h-72 overflow-y-auto">
                {list.map((fid) => {
                  const prof = friendProfiles[fid]
                  const online = !!friendPresence[fid]?.online
                  const justInvited = invitedAt[fid] && Date.now() - invitedAt[fid] < INVITE_TTL_MS
                  const fname = prof?.name || "Player"
                  return (
                    <div
                      key={fid}
                      className={`flex items-center gap-3 px-3 py-2 rounded-xl ${
                        darkMode ? "bg-white/5" : "bg-black/5"
                      }`}
                    >
                      <span className="relative shrink-0">
                        <PlayerAvatar photo={prof?.photo ?? null} avatarId={prof?.avatar ?? null} vip={!!prof?.vip} size={32} ring={false} />
                        <span
                          className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 ${
                            darkMode ? "border-[#0d1f16]" : "border-white"
                          } ${online ? "bg-emerald-500" : "bg-gray-400"}`}
                          title={online ? "Online" : "Offline"}
                        />
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm font-medium truncate">{fname}</span>
                        <span className={`block text-[11px] ${online ? "text-emerald-500" : darkMode ? "text-white/40" : "text-black/40"}`}>
                          {online ? "● Online" : "○ Offline"}
                        </span>
                      </span>
                      <button
                        onClick={() => handleInviteFriend(fid)}
                        disabled={!online || !!justInvited || inviteBusy === fid}
                        className="shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold text-white bg-gradient-to-r from-emerald-500 to-emerald-400 shadow disabled:opacity-40"
                      >
                        {inviteBusy === fid ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <UserPlus className="w-3.5 h-3.5" />
                        )}
                        {justInvited ? "Invited ✓" : "Invite"}
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
            <p className={`mt-3 text-[11px] text-center ${darkMode ? "text-white/40" : "text-black/40"}`}>
              Only online friends can be invited · invite expires in 5 seconds
            </p>
          </div>
        </div>
      )
    })()}
    <div className="absolute inset-0 z-50 flex overflow-y-auto p-3 bg-black/60 backdrop-blur-sm">
      <div
        className={`m-auto w-full max-w-md rounded-3xl border p-4 shadow-2xl ${
          darkMode ? "bg-[#0d1f16] border-white/10 text-white" : "bg-white border-black/10 text-[#123321]"
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-emerald-500" />
            <h2 className="text-lg font-bold">Multiplayer Battle</h2>
          </div>
          <button
            onClick={screen === "lobby" ? handleLeave : onExit}
            aria-label="Close"
            className={`p-2 rounded-full ${darkMode ? "hover:bg-white/10" : "hover:bg-black/5"}`}
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <p className={`text-xs mb-5 ${darkMode ? "text-white/60" : "text-black/60"}`}>
          {screen === "setup"
            ? "Play live with friends or the world — needs internet"
            : isGlobal
              ? "Matching you with players worldwide"
              : "Share the code with friends"}
        </p>

        {!online && (
          <div className="flex items-center gap-2 text-xs mb-4 px-3 py-2 rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400">
            <WifiOff className="w-4 h-4" /> You are offline — multiplayer needs internet.
          </div>
        )}

        {error && (
          <div className="text-xs mb-4 px-3 py-2 rounded-xl bg-red-500/15 text-red-600 dark:text-red-400">{error}</div>
        )}

        {/* game server status: only shown when something is wrong (the classic layout stays untouched) */}
        {!net.isConnected && (net.isReconnecting || net.lastError) && (
          <div className="flex items-center gap-2 text-xs mb-4 px-3 py-2 rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400">
            <Loader2 className="w-4 h-4 shrink-0 animate-spin" />
            <span className="min-w-0 break-words">{net.lastError?.message ?? "Connecting to the game server…"}</span>
          </div>
        )}

        {screen === "setup" ? (
          <div className="flex flex-col gap-3">
            <Tabs value={tab} onValueChange={(v) => { setTab(v as "casual" | "ranked"); setError("") }}>
              <TabsList className={`grid h-10 w-full grid-cols-2 ${darkMode ? "bg-white/5 text-white/60" : "bg-black/5 text-black/60"}`}>
                <TabsTrigger value="casual" className="data-[state=active]:bg-emerald-500 data-[state=active]:text-white">
                  Casual
                </TabsTrigger>
                <TabsTrigger value="ranked" className="data-[state=active]:bg-amber-500 data-[state=active]:text-white">
                  🏆 Ranked
                </TabsTrigger>
              </TabsList>
            </Tabs>
            {tab === "ranked" ? (
              <RankedPanel
                darkMode={darkMode}
                uid={isGoogleUser(authUser) ? myUid : null}
                online={online}
                busy={loading}
                globalBusy={globalLoading}
                onCreate={handleCreateRanked}
                onJoinGlobal={handleJoinRankedGlobal}
                onJoin={handleJoinRanked}
              />
            ) : (
              <>
            <label className={`text-xs font-semibold ${darkMode ? "text-white/70" : "text-black/70"}`}>
              YOUR NAME
              <input
                value={signedIn ? profileName : name}
                onChange={(e) => !signedIn && setName(e.target.value.slice(0, 16))}
                readOnly={signedIn}
                placeholder="e.g. Mani"
                maxLength={16}
                className={`mt-1 w-full px-4 py-3 rounded-xl border text-sm font-normal outline-none focus:border-emerald-500 ${
                  signedIn ? "opacity-80 cursor-default " : ""
                }${darkMode ? "bg-white/5 border-white/10 placeholder:text-white/30" : "bg-black/5 border-black/10 placeholder:text-black/30"}`}
              />
              {signedIn && (
                <span className={`block mt-1 text-[11px] font-normal ${darkMode ? "text-white/50" : "text-black/50"}`}>
                  From your profile · change it in Profile (👤 icon)
                </span>
              )}
            </label>

            {/* Split button: Create Room | Join Global */}
            <div className="flex h-14 rounded-xl overflow-hidden shadow-lg shadow-emerald-500/30 bg-gradient-to-r from-emerald-500 to-emerald-400">
              <button
                onClick={handleCreate}
                disabled={loading || globalLoading}
                className="flex-1 flex items-center justify-center gap-2 text-sm font-semibold text-white hover:bg-white/15 active:bg-white/25 transition-colors disabled:opacity-60"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                {loading ? "Creating…" : "Create Room"}
              </button>
              <div className="w-px my-2 bg-white/50" />
              <button
                onClick={handleJoinGlobal}
                disabled={loading || globalLoading}
                className="flex-1 flex items-center justify-center gap-2 text-sm font-semibold text-white hover:bg-white/15 active:bg-white/25 transition-colors disabled:opacity-60"
              >
                {globalLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Globe className="w-4 h-4" />}
                {globalLoading ? "Finding…" : "Join Global"}
              </button>
            </div>
            <p className={`-mt-1 text-center text-[11px] ${darkMode ? "text-white/50" : "text-black/50"}`}>
              Join Global matches you with random online players
            </p>

            <div className="flex items-center gap-3 my-1">
              <div className={`flex-1 h-px ${darkMode ? "bg-white/10" : "bg-black/10"}`} />
              <span className={`text-xs ${darkMode ? "text-white/50" : "text-black/50"}`}>or join</span>
              <div className={`flex-1 h-px ${darkMode ? "bg-white/10" : "bg-black/10"}`} />
            </div>

            <div className="flex gap-2">
              <input
                value={joinCode}
                onChange={(e) => setJoinCode(normalizeRoomCode(e.target.value))}
                placeholder="CODE"
                maxLength={6}
                className={`flex-1 min-w-0 px-4 py-3 rounded-xl border text-sm font-mono tracking-[0.3em] uppercase text-center outline-none focus:border-emerald-500 ${
                  darkMode ? "bg-white/5 border-white/10 placeholder:text-white/30" : "bg-black/5 border-black/10 placeholder:text-black/30"
                }`}
              />
              <Button
                onClick={handleJoin}
                disabled={loading || globalLoading}
                variant="outline"
                className="h-[52px] rounded-xl px-5 font-semibold"
              >
                {loading ? "…" : "Join"}
              </Button>
            </div>
              </>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {room?.isRanked && (
              <div className="flex flex-col items-center gap-1">
                <RankedTag />
                {players.length < RANKED_MIN_PLAYERS ? (
                  <p className="text-center text-[11px] text-amber-600 dark:text-amber-400">
                    Ranked needs {RANKED_MIN_PLAYERS}+ players
                  </p>
                ) : (
                  <p className={`text-center text-[11px] ${darkMode ? "text-white/50" : "text-black/50"}`}>
                    RP counts — everybody in this room must be signed in with a different Google account
                  </p>
                )}
              </div>
            )}
            {isGlobal ? (
              <div
                className={`flex items-center justify-center gap-2 py-4 rounded-2xl border-2 ${
                  darkMode ? "border-emerald-400/40 bg-emerald-400/10" : "border-emerald-600/40 bg-emerald-600/10"
                }`}
              >
                <Globe className="w-5 h-5 text-emerald-500" />
                <span className="text-lg font-bold text-emerald-500">Global Match</span>
              </div>
            ) : (
              <>
            <button
              onClick={copyCode}
              className={`flex items-center justify-center gap-3 py-4 rounded-2xl border-2 border-dashed ${
                darkMode ? "border-emerald-400/40 bg-emerald-400/10" : "border-emerald-600/40 bg-emerald-600/10"
              }`}
            >
              <span className="text-3xl font-mono font-bold tracking-[0.25em] text-emerald-500">{code}</span>
              {copied ? <Check className="w-5 h-5 text-emerald-500" /> : <Copy className="w-5 h-5 text-emerald-500" />}
            </button>
            <p className={`-mt-2 text-center text-[11px] ${darkMode ? "text-white/50" : "text-black/50"}`}>
              {copied ? "Copied!" : "Tap the code to copy it"}
            </p>

              </>
            )}

            {/* Players */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className={`text-xs font-semibold ${darkMode ? "text-white/70" : "text-black/70"}`}>
                  PLAYERS ({players.length}/{MAX_MP_PLAYERS})
                </div>
                {isHost && myUid && friendUids.length > 0 && (
                  <button
                    onClick={() => setShowInviteModal(true)}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold text-white bg-gradient-to-r from-emerald-500 to-emerald-400 shadow"
                  >
                    <UserPlus className="w-3.5 h-3.5" /> Invite
                  </button>
                )}
              </div>
              {/* 2 per row, same horizontal row style as the in-battle leaderboard: dot + name (+ small tags) */}
              <div className="grid grid-cols-2 gap-1.5 max-h-44 overflow-y-auto">
                {players.map((p) => (
                  <div
                    key={p.id}
                    className={`flex items-center gap-1.5 px-2 py-1.5 rounded-xl text-[11px] min-w-0 ${
                      darkMode ? "bg-white/5" : "bg-black/5"
                    } ${p.id === playerId ? "ring-1 ring-emerald-500" : ""}`}
                  >
                    {room?.hostId === p.id && (
                      <span
                        aria-hidden
                        title="Host"
                        className="inline-block w-3.5 h-3.5 shrink-0 bg-amber-500"
                        style={{ WebkitMaskImage: "url(/host-icon.png)", maskImage: "url(/host-icon.png)", WebkitMaskSize: "contain", maskSize: "contain", WebkitMaskRepeat: "no-repeat", maskRepeat: "no-repeat", WebkitMaskPosition: "center", maskPosition: "center" }}
                      />
                    )}
                    <span
                      className="w-2.5 h-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: p.color, boxShadow: `0 0 6px ${p.color}` }}
                    />
                    <span
                      className={`font-medium truncate flex-1 min-w-0 ${p.uid ? "cursor-pointer" : ""}`}
                      onClick={() => p.uid && openPlayerProfile(p.uid)}
                    >
                      {isBotPlayer(p) && <BotTag />}{p.vip && <VipCrown className="h-3 w-3" />}{p.name}
                    </span>
                    {p.id !== playerId && <FriendAction targetUid={p.uid} />}
                    {isHost && p.id === playerId && (
                      <button
                        onClick={() => setShowSettings(true)}
                        aria-label="Room settings"
                        title="Room settings"
                        className={`p-1 -mr-1 shrink-0 rounded-full ${darkMode ? "hover:bg-white/10" : "hover:bg-black/10"}`}
                      >
                        <Settings className="w-3.5 h-3.5 text-emerald-500" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Current room settings (everyone sees them) */}
            <p className={`-mt-2 text-center text-[11px] ${darkMode ? "text-white/50" : "text-black/50"}`}>
              {isRoyale && !room?.isRanked ? (
                <>👑 Battle Royale · {BR_GRID}×{BR_GRID} · needs {BR_MIN_PLAYERS}+ players</>
              ) : (
                <>
                  Map: {room?.isRanked ? "🎲 Random (changes every match)" : getBattleMap(settings.map).name}
                  {settings.teleport ? " · Teleport" : ""}
                  {settings.avoidCollision ? " · No collision" : ""}
                </>
              )}
              {!isHost ? " · set by host" : ""}
            </p>

            {botsToJoin > 0 && (
              <p className={`-mt-2 text-center text-[11px] ${darkMode ? "text-white/50" : "text-black/50"}`}>
                🤖 {botsToJoin} {BOT_DIFFICULTY[settings.botLevel].label} bot{botsToJoin > 1 ? "s" : ""} will fill the empty slots when the battle starts
              </p>
            )}

            {/* Voice chat */}
            <VoiceChat code={code} playerId={playerId} playerName={playerName || "Player"} darkMode={darkMode} />

            {isGlobal && (
              <div
                className={`flex items-center justify-center gap-2 py-2 rounded-xl text-sm font-semibold ${
                  darkMode ? "bg-white/5 text-white/80" : "bg-black/5 text-black/70"
                }`}
              >
                {players.length < minToStart ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-emerald-500" /> Searching for players…{room?.isRanked ? ` (${players.length}/${minToStart})` : ""}
                  </>
                ) : (
                  <>Battle starts in {secondsLeft ?? Math.ceil(GLOBAL_AUTOSTART_MS / 1000)}s{botsToJoin > 0 ? " · bots fill empty slots" : ""}</>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
    </>
  )
}
