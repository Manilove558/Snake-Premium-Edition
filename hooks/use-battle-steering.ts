"use client"

// hooks/use-battle-steering.ts — keyboard (WASD / arrows) + swipe steering for the arena and the swipe pad.
// Same behaviour as the classic battle (native listeners, passive:false, continuous swipe tracking).
import { useEffect, useRef } from "react"

interface Options {
  /** true while the snake may be steered (countdown / playing and alive) */
  canSteer: () => boolean
  controlMode: "buttons" | "swipe"
  getDir: () => { x: number; y: number }
  setDir: (x: number, y: number) => void
  /** elements that accept swipes (arena + swipe pad); read at (re)attach time */
  getSurfaces: () => (HTMLElement | null)[]
  /** change this to re-attach listeners when the portal targets appear */
  rerunKey: string
}

export function useBattleSteering({ canSteer, controlMode, getDir, setDir, getSurfaces, rerunKey }: Options) {
  const optsRef = useRef({ canSteer, controlMode, getDir, setDir })
  optsRef.current = { canSteer, controlMode, getDir, setDir }
  const start = useRef({ x: 0, y: 0 })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase()
      const { setDir } = optsRef.current
      if (k === "arrowup" || k === "w") setDir(0, -1)
      else if (k === "arrowdown" || k === "s") setDir(0, 1)
      else if (k === "arrowleft" || k === "a") setDir(-1, 0)
      else if (k === "arrowright" || k === "d") setDir(1, 0)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  useEffect(() => {
    const surfaces = getSurfaces().filter((el): el is HTMLElement => el !== null)
    if (surfaces.length === 0) return
    const buzz = (ms: number) => {
      try {
        if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate(ms)
      } catch {}
    }
    const onStart = (e: TouchEvent) => {
      const o = optsRef.current
      if (!o.canSteer() || o.controlMode === "buttons") return
      e.preventDefault()
      const t = e.touches[0]
      start.current = { x: t.clientX, y: t.clientY }
    }
    const onMove = (e: TouchEvent) => {
      const o = optsRef.current
      if (!o.canSteer() || o.controlMode === "buttons") return
      e.preventDefault()
      const t = e.touches[0]
      const dx = t.clientX - start.current.x
      const dy = t.clientY - start.current.y
      if (Math.abs(dx) > 30 || Math.abs(dy) > 30) {
        const d = o.getDir()
        if (Math.abs(dx) > Math.abs(dy)) {
          if (dx > 0 && d.x !== -1) o.setDir(1, 0)
          else if (dx < 0 && d.x !== 1) o.setDir(-1, 0)
        } else {
          if (dy > 0 && d.y !== -1) o.setDir(0, 1)
          else if (dy < 0 && d.y !== 1) o.setDir(0, -1)
        }
        buzz(15)
        start.current = { x: t.clientX, y: t.clientY }
      }
    }
    surfaces.forEach((s) => {
      s.addEventListener("touchstart", onStart, { passive: false })
      s.addEventListener("touchmove", onMove, { passive: false })
    })
    return () => {
      surfaces.forEach((s) => {
        s.removeEventListener("touchstart", onStart)
        s.removeEventListener("touchmove", onMove)
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rerunKey, controlMode])
}
