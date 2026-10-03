"use client"

import type { CSSProperties } from "react"

// Premium 3 · 2 · 1 start countdown (DOM overlay, pure CSS animation — GPU friendly, no canvas redraws).
// Each number is keyed, so every tick replays: punch-in (scale + blur-to-sharp) -> hold -> soft fade-out,
// while a progress ring drains over exactly 1 s and two shockwave rings expand behind the digit.
// Colours walk coral -> amber -> brand green, so "1" already feels like "go".
const TONE: Record<number, { c: string; glow: string }> = {
  3: { c: "#ff6b81", glow: "255,107,129" },
  2: { c: "#ffb627", glow: "255,182,39" },
  1: { c: "#22d97a", glow: "34,217,122" },
}

interface Props {
  /** 3, 2, 1 — anything <= 0 renders nothing */
  value: number
  /** small caption above the ring */
  label?: string
  /** small caption under the ring */
  sub?: string
}

export function CountdownOverlay({ value, label = "GET READY", sub }: Props) {
  if (value <= 0) return null
  const tone = TONE[value] ?? TONE[1]
  const R = 46
  const C = 2 * Math.PI * R
  const vars = { "--cd-c": tone.c, "--cd-g": tone.glow, "--cd-len": C } as CSSProperties
  return (
    <div className="cd-root" style={vars} role="timer" aria-live="assertive" aria-label={`Starting in ${value}`}>
      <div className="cd-label">{label}</div>

      <div className="cd-stage" key={value}>
        <span className="cd-wave" />
        <span className="cd-wave cd-wave-2" />
        <svg className="cd-ring" viewBox="0 0 100 100" aria-hidden>
          <circle cx="50" cy="50" r={R} className="cd-track" />
          <circle cx="50" cy="50" r={R} className="cd-prog" strokeDasharray={C} />
        </svg>
        <span className="cd-num">{value}</span>
      </div>

      <div className="cd-pips" aria-hidden>
        {[3, 2, 1].map((n) => (
          <i key={n} className={n >= value ? "on" : ""} />
        ))}
      </div>
      {sub && <div className="cd-sub">{sub}</div>}
    </div>
  )
}
