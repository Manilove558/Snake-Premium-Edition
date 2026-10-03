"use client"
import { useEffect, useRef, useState, type ReactNode } from "react"
import { useBackButton } from "@/hooks/use-back-button"
import { createPortal } from "react-dom"
import { X, Volume2, VolumeX, Trophy, Globe, Users, Moon, Sun, Gamepad2, Move, Vibrate, VibrateOff, Smartphone, ChevronLeft, ChevronRight } from "lucide-react"
import { fetchLeaderboard, type LeaderboardRow } from "@/lib/ranked-db"
import { getTier } from "@/lib/ranked"
import { openPlayerProfile, useFriends } from "@/lib/friends"
import { useAuthUser } from "@/lib/auth"
import { PlayerAvatar } from "./player-avatar"
import { usePanelTarget } from "./panel-host"
import { VipCrown } from "./vip-crown"

const box = "rounded-2xl border border-black/5 dark:border-white/10 bg-white/70 dark:bg-white/5"

/** Centered popup that fits any landscape screen: safe-area padding, scrolls inside when short, 48dp close button, Android Back closes it. */
export function PopupShell({ title, onClose, children }: { title: ReactNode; onClose: () => void; children: ReactNode }) {
  const panelTarget = usePanelTarget()
  useBackButton(true, () => onClose())
  const close = () => onClose()
  return createPortal(
    <div
      className="absolute inset-0 z-[10] flex items-center justify-center bg-black/55 backdrop-blur-sm p-2"
      onClick={close}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[min(100%,40rem)] max-h-full flex flex-col rounded-3xl bg-[#f1f4f1] dark:bg-[#0d1f16] border border-emerald-500/30 shadow-2xl text-[#123321] dark:text-[#eafff3] animate-fade-in"
      >
        <div className="flex items-center gap-2 px-4 pt-2 pb-1 shrink-0">
          <h3 className="text-base font-bold truncate">{title}</h3>
          <button aria-label="Close" onClick={close} className={`panel-inner-close d-pad-btn ml-auto h-12 w-12 shrink-0 rounded-full flex items-center justify-center ${box}`}><X className="h-5 w-5" /></button>
        </div>
        <div className="min-h-0 overflow-y-auto overscroll-contain px-4 pb-4 flex flex-col gap-2">{children}</div>
      </div>
    </div>,
    panelTarget,
  )
}

/* ---------------- Rank ---------------- */
export function RankPopup({ onClose }: { onClose: () => void }) {
  const { user } = useAuthUser()
  const { friends } = useFriends()
  const [rows, setRows] = useState<LeaderboardRow[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [tab, setTab] = useState<"global" | "friends">("global")
  useEffect(() => {
    let on = true
    fetchLeaderboard(50).then((r) => on && setRows(r)).catch(() => on && setFailed(true))
    return () => { on = false }
  }, [])
  const shown = (rows ?? []).filter((r) => tab === "global" || friends[r.uid] || r.uid === user?.uid).slice(0, tab === "global" ? 20 : 50)
  const tabBtn = (k: "global" | "friends", label: string, icon: ReactNode) => (
    <button key={k} onClick={() => setTab(k)} className={`d-pad-btn flex-1 min-h-[48px] rounded-xl border text-sm font-bold flex items-center justify-center gap-1.5 ${tab === k ? "border-emerald-500 bg-emerald-500/15 text-emerald-600 dark:text-emerald-300" : `${box} text-muted-foreground`}`}>{icon}{label}</button>
  )
  return (
    <PopupShell title={<span className="flex items-center gap-2"><Trophy className="h-4 w-4 text-amber-500" />Ranked <span className="text-amber-500">Leaderboard</span></span>} onClose={onClose}>
      <div className="flex gap-2">{tabBtn("global", "Global", <Globe className="h-4 w-4" />)}{tabBtn("friends", "Friends", <Users className="h-4 w-4" />)}</div>
      {failed ? <div className={`${box} p-4 text-center text-sm text-muted-foreground`}>Leaderboard could not load. Check your connection.</div>
        : rows === null ? <div className={`${box} p-4 text-center text-sm text-muted-foreground`}>Loading…</div>
        : shown.length === 0 ? <div className={`${box} p-4 text-center text-sm text-muted-foreground`}>{tab === "friends" ? "None of your friends are ranked yet." : "No ranked players yet."}</div>
        : shown.map((r, i) => {
          const t = getTier(r.elo)
          const me = r.uid === user?.uid
          return (
            <button key={r.uid} onClick={() => openPlayerProfile(r.uid)} className={`d-pad-btn min-h-[48px] flex items-center gap-2.5 rounded-xl border px-3 py-1.5 text-left ${me ? "border-emerald-500 bg-emerald-500/10" : "border-black/5 dark:border-white/10 bg-white/60 dark:bg-white/5"}`}>
              <span className={`w-6 text-center font-extrabold tabular-nums ${i === 0 ? "text-amber-500" : i === 1 ? "text-slate-400" : i === 2 ? "text-amber-700" : "text-muted-foreground"}`}>{i + 1}</span>
              <PlayerAvatar photo={r.photo} avatarId={r.avatar} vip={r.vip} size={32} ring={false} />
              <span className="min-w-0 flex-1 truncate text-sm font-bold">{r.vip && <VipCrown className="h-3.5 w-3.5" />}{r.name}{me && <span className="ml-1.5 rounded-md bg-emerald-500 px-1.5 py-0.5 text-[9px] font-bold text-white">YOU</span>}</span>
              <span className="shrink-0 text-sm font-extrabold tabular-nums" style={{ color: t.color }}>{t.emoji} {r.elo}</span>
            </button>
          )
        })}
      <div className="text-center text-[10px] text-muted-foreground">Top players by ranked Elo rating</div>
    </PopupShell>
  )
}

/* ---------------- Map / game mode ---------------- */
export type MapModeEntry = {
  value: string
  name: string
  walls: { x: number; y: number }[]
  portals?: { entrance: { x: number; y: number }; exit: { x: number; y: number } }[]
}

/** Mini 20x20 board preview (walls + portals) — same look as the Room Settings map tiles. */
function MapTilePreview({ walls, portals }: { walls: MapModeEntry["walls"]; portals?: MapModeEntry["portals"] }) {
  const portalColors = ["#4da6ff", "#c77dff", "#ffb84d"]
  return (
    <svg viewBox="0 0 20 20" className="w-full h-auto rounded-md" style={{ background: "rgba(127,127,127,0.12)" }}>
      {walls.map((w, i) => (
        <rect key={i} x={w.x} y={w.y} width={1} height={1} fill="currentColor" opacity={0.65} />
      ))}
      {(portals ?? []).map((pr, pi) =>
        [pr.entrance, pr.exit].map((c, ci) => (
          <circle key={`${pi}-${ci}`} cx={c.x + 0.5} cy={c.y + 0.5} r={1.2} fill="none" stroke={portalColors[pi % portalColors.length]} strokeWidth={0.5} />
        )),
      )}
    </svg>
  )
}

export function MapPopup({ modes, active, onPick, onClose }: { modes: MapModeEntry[]; active: string; onPick: (value: string) => void; onClose: () => void }) {
  return (
    <PopupShell title={<>Select <span className="text-emerald-500">Map</span></>} onClose={onClose}>
      <div className="grid grid-cols-4 gap-2">
        {modes.map((m) => {
          const on = m.value === active
          return (
            <button
              key={m.value}
              onClick={() => onPick(m.value)}
              aria-pressed={on}
              className={`d-pad-btn min-w-0 p-1.5 rounded-xl border-2 text-center transition-colors ${on ? "border-emerald-500 bg-emerald-500/10" : "border-black/10 dark:border-white/10 hover:border-black/30 dark:hover:border-white/30"}`}
            >
              <MapTilePreview walls={m.walls} portals={m.portals} />
              <div className={`mt-1 text-[11px] font-semibold truncate ${on ? "text-emerald-500" : ""}`}>{m.name}</div>
            </button>
          )
        })}
      </div>
    </PopupShell>
  )
}

/* ---------------- Settings (sound + theme + controls + vibration) ---------------- */
type SettingsProps = {
  soundEnabled: boolean; setSoundEnabled: (v: boolean) => void
  volume: number; setVolume: (v: number) => void
  darkMode: boolean; setDarkMode: (v: boolean) => void
  controlMode: "buttons" | "swipe"; setControlMode: (m: "buttons" | "swipe") => void
  hapticEnabled: boolean; setHapticEnabled: (v: boolean) => void; hapticSupported: boolean
  /** Battle-Royale-style gliding movement (single-player, classic battle and Battle Royale) */
  smoothMove: boolean; setSmoothMove: (v: boolean) => void
  /** sound on every button press (separate from the game-sounds toggle) */
  clickSound: boolean; setClickSound: (v: boolean) => void
  /** the click sound's OWN volume 0..1 (press the "Click sound" row and swipe left / right) */
  clickVolume: number; setClickVolume: (v: number) => void
  /** Notch Display / Safe Area Cutout: ON = UI stays clear of the camera notch + rounded corners, OFF = full-screen edge-to-edge */
  notchSafe: boolean; setNotchSafe: (v: boolean) => void
  onClose: () => void
}
export function SettingsPopup({ soundEnabled, setSoundEnabled, volume, setVolume, darkMode, setDarkMode, controlMode, setControlMode, hapticEnabled, setHapticEnabled, hapticSupported, smoothMove, setSmoothMove, clickSound, setClickSound, clickVolume, setClickVolume, notchSafe, setNotchSafe, onClose }: SettingsProps) {
  const label = "text-[10px] tracking-[.2em] font-bold opacity-50 px-1"
  const seg = (v: "buttons" | "swipe", text: string, icon: ReactNode) => (
    <button key={v} onClick={() => setControlMode(v)} aria-pressed={controlMode === v}
      className={`d-pad-btn flex-1 min-h-[48px] rounded-xl border-2 text-sm font-bold flex items-center justify-center gap-1.5 ${controlMode === v ? "border-emerald-500 bg-emerald-500/15 text-emerald-600 dark:text-emerald-300" : `${box} border-black/10`}`}>
      {icon}{text}
    </button>
  )
  return (
    <PopupShell title="Settings" onClose={onClose}>
      <div className="grid gap-x-3 gap-y-2" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))" }}>
        {/* Sound */}
        <div className="flex flex-col gap-2">
          <div className={label}>SOUND</div>
          <div className={`${box} min-h-[48px] px-3 py-1 flex items-center gap-2`}>
            <button type="button" onClick={() => setSoundEnabled(!soundEnabled)} aria-pressed={!soundEnabled} aria-label={soundEnabled ? "Mute sound" : "Unmute sound"} className="d-pad-btn h-12 w-12 shrink-0 flex items-center justify-center text-muted-foreground">
              {volume === 0 || !soundEnabled ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
            </button>
            <input type="range" min={0} max={100} value={Math.round(volume * 100)} onChange={(e) => setVolume(Number(e.target.value) / 100)} aria-label="Game volume" className="flex-1 h-12 accent-emerald-500 cursor-pointer" />
            <span className="w-9 text-right text-xs tabular-nums opacity-60">{Math.round(volume * 100)}%</span>
          </div>
        </div>
        {/* Theme + vibration */}
        <div className="flex flex-col gap-2">
          <div className={label}>THEME</div>
          <Row title={darkMode ? "Dark theme" : "Light theme"} hint="Switch light / dark" on={darkMode} onToggle={() => setDarkMode(!darkMode)} icon={darkMode ? <Moon className="h-5 w-5" /> : <Sun className="h-5 w-5" />} />
          <div className={label}>VIBRATION &amp; SOUND</div>
          <Row title="Vibration" hint={hapticSupported ? "Vibrates on every button press" : "Not supported on this device"} on={hapticEnabled && hapticSupported} disabled={!hapticSupported} icon={hapticEnabled && hapticSupported ? <Vibrate className="h-5 w-5" /> : <VibrateOff className="h-5 w-5" />}
            onToggle={() => {
              const v = !hapticEnabled
              setHapticEnabled(v)
              if (v && hapticSupported) { try { navigator.vibrate(15) } catch {} }
            }} />
          <ClickSoundRow on={clickSound} onToggle={() => setClickSound(!clickSound)} volume={clickVolume} setVolume={setClickVolume} />
        </div>
      </div>
      {/* Controls */}
      <div className={label}>CONTROLS</div>
      <div className="flex gap-2">
        {seg("buttons", "Buttons", <Gamepad2 className="h-4 w-4" />)}
        {seg("swipe", "Swipe", <Move className="h-4 w-4" />)}
      </div>
      {/* Movement style */}
      <div className={label}>MOVEMENT</div>
      <Row title="Smooth movement" hint={smoothMove ? "Battle Royale style: the snake glides" : "Off: classic cell-by-cell steps"} on={smoothMove} onToggle={() => setSmoothMove(!smoothMove)} icon={<Move className="h-5 w-5" />} />
      {/* Display: notch / safe area */}
      <div className={label}>DISPLAY</div>
      <Row title="Notch Display / Safe Area Cutout" hint={notchSafe ? "On: the UI stays clear of the notch and rounded corners" : "Off: full screen, the UI uses the whole display"} on={notchSafe} onToggle={() => setNotchSafe(!notchSafe)} icon={<Smartphone className="h-5 w-5" />} />
    </PopupShell>
  )
}

function Row({ title, hint, on, onToggle, disabled, icon }: { title: string; hint: string; on: boolean; onToggle: () => void; disabled?: boolean; icon?: ReactNode }) {
  return (
    <div className={`${box} min-h-[52px] px-3 py-1 flex items-center gap-2.5 ${disabled ? "opacity-50" : ""}`}>
      {icon && <span className="shrink-0 text-muted-foreground">{icon}</span>}
      <span className="min-w-0 flex-1"><span className="block text-sm font-bold">{title}</span><span className="block text-xs text-muted-foreground">{hint}</span></span>
      <button role="switch" aria-checked={on} aria-label={title} disabled={disabled} onClick={onToggle} className="d-pad-btn h-12 w-14 shrink-0 flex items-center justify-center">
        <span className={`relative block h-6 w-11 rounded-full transition-colors ${on ? "bg-emerald-500" : "bg-black/20 dark:bg-white/20"}`}>
          <span className={`absolute top-[3px] h-[18px] w-[18px] rounded-full bg-white shadow transition-all ${on ? "left-[23px]" : "left-[3px]"}`} />
        </span>
      </button>
    </div>
  )
}

/** Speaker icon whose sound waves grow / shrink with the level (1-3 arcs), swap to an X when muted. */
function SpeakerIcon({ level, muted }: { level: number; muted: boolean }) {
  const wave = (d: string, active: boolean, delay: number) => (
    <path
      d={d}
      style={{
        opacity: active ? 1 : 0,
        transform: active ? "scale(1)" : "scale(.55)",
        transformOrigin: "10px 12px",
        transition: `opacity .2s ease ${delay}ms, transform .35s cubic-bezier(.34,1.56,.64,1) ${delay}ms`,
      }}
    />
  )
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M11 5 6 9H3v6h3l5 4V5z" fill="currentColor" fillOpacity=".25" />
      {wave("M15.5 9a4 4 0 0 1 0 6", !muted && level > 0, 0)}
      {wave("M18 6.8a7.5 7.5 0 0 1 0 10.4", !muted && level > 0.33, 45)}
      {wave("M20.6 4.4a11 11 0 0 1 0 15.2", !muted && level > 0.66, 90)}
      <g style={{ opacity: muted ? 1 : 0, transform: muted ? "scale(1)" : "scale(.4)", transformOrigin: "18px 12px", transition: "opacity .2s ease, transform .35s cubic-bezier(.34,1.56,.64,1)" }}>
        <path d="M16 9.5l5 5" /><path d="M21 9.5l-5 5" />
      </g>
    </svg>
  )
}

/** "Click sound" row with its own volume bar built into the button:
 *  tap = on / off,  press + swipe left / right = lower / raise the click volume (full row width = 0..100%).
 *  Keyboard: Enter / Space toggles, Left / Right arrows change the volume by 5%.
 *  Motion: tap ripple, row lifts + glows while dragging, fill follows the finger 1:1 with a glowing edge, the speaker's
 *  waves grow with the level, the % badge pops, the switch knob springs. All of it is off for prefers-reduced-motion. */
function ClickSoundRow({ on, onToggle, volume, setVolume }: { on: boolean; onToggle: () => void; volume: number; setVolume: (v: number) => void }) {
  const drag = useRef<{ x: number; vol: number; w: number; moved: boolean } | null>(null)
  const [dragging, setDragging] = useState(false)
  const [ripple, setRipple] = useState<{ id: number; x: number; y: number } | null>(null)
  const [pulse, setPulse] = useState(0)
  const pct = Math.round(volume * 100)
  const clamp = (v: number) => Math.min(1, Math.max(0, Math.round(v * 100) / 100))
  const preview = (v: number) => {
    if (v <= 0) return
    try { const a = new Audio("/sounds/click.mp3"); a.volume = clamp(v); a.play().catch(() => {}) } catch {}
  }
  const end = () => { drag.current = null; setDragging(false) }
  return (
    <div
      role="switch"
      aria-checked={on}
      aria-label={`Click sound, volume ${pct}%`}
      tabIndex={0}
      data-no-click-sound
      data-drag={dragging}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(); setPulse((n) => n + 1) }
        else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
          e.preventDefault()
          const v = clamp(volume + (e.key === "ArrowRight" ? 0.05 : -0.05))
          setVolume(v); if (on) preview(v)
        }
      }}
      onPointerDown={(e) => {
        if (e.pointerType === "mouse" && e.button !== 0) return
        const r = e.currentTarget.getBoundingClientRect()
        drag.current = { x: e.clientX, vol: volume, w: Math.max(1, r.width), moved: false }
        setRipple({ id: Date.now(), x: e.clientX - r.left, y: e.clientY - r.top })
        try { e.currentTarget.setPointerCapture(e.pointerId) } catch {}
      }}
      onPointerMove={(e) => {
        const d = drag.current
        if (!d) return
        const dx = e.clientX - d.x
        if (!d.moved && Math.abs(dx) < 8) return // the small wobble of a tap is not a swipe
        if (!d.moved) { d.moved = true; setDragging(true) }
        setVolume(clamp(d.vol + dx / d.w))
      }}
      onPointerUp={(e) => {
        const d = drag.current
        if (!d) return
        end()
        setPulse((n) => n + 1)
        if (d.moved) { if (on) preview(d.vol + (e.clientX - d.x) / d.w) }
        else onToggle()
      }}
      onPointerCancel={end}
      onContextMenu={(e) => e.preventDefault()}
      style={{ touchAction: "pan-y" }}
      className={`${box} cs-row relative overflow-hidden min-h-[56px] px-3 py-1 flex items-center gap-2.5 select-none cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-emerald-500`}
    >
      {/* scale marks (10 steps) */}
      <div aria-hidden className="cs-scale absolute inset-x-0 bottom-0 h-1.5 text-emerald-600 dark:text-emerald-300" />
      {/* volume fill = the bar attached to the button */}
      <div aria-hidden data-off={!on} className="cs-fill absolute inset-y-0 left-0" style={{ width: `${pct}%` }}>
        <span className="cs-edge" />
      </div>
      {/* tap ripple */}
      {ripple && <span key={ripple.id} aria-hidden className="cs-ripple" style={{ left: ripple.x, top: ripple.y }} onAnimationEnd={() => setRipple(null)} />}

      <span key={pulse} className={`relative shrink-0 h-12 w-8 flex items-center justify-center ${on ? "text-emerald-600 dark:text-emerald-300" : "text-muted-foreground"} ${pulse > 0 ? "cs-pop" : ""}`}>
        <SpeakerIcon level={volume} muted={!on || volume === 0} />
      </span>

      <span className="relative min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-sm font-bold">
          Click sound
          <span className={`cs-badge text-[11px] font-bold tabular-nums rounded-full px-1.5 py-px ${dragging ? "cs-badge-on" : ""}`}>{pct}%</span>
        </span>
        <span className="flex items-center gap-0.5 text-xs text-muted-foreground h-4">
          {dragging ? (
            <span className="cs-fade">Release to set volume</span>
          ) : (
            <>
              <ChevronLeft className="cs-nudge-l h-3 w-3 shrink-0" />
              <span className="truncate">Swipe for volume</span>
              <ChevronRight className="cs-nudge-r h-3 w-3 shrink-0" />
            </>
          )}
        </span>
      </span>

      <span aria-hidden className="relative h-12 w-14 shrink-0 flex items-center justify-center">
        <span className={`relative block h-6 w-11 rounded-full transition-colors duration-300 ${on ? "bg-emerald-500" : "bg-black/20 dark:bg-white/20"}`}>
          <span className="cs-knob absolute top-[3px] h-[18px] w-[18px] rounded-full bg-white shadow" style={{ left: on ? 23 : 3 }} />
        </span>
      </span>
    </div>
  )
}
