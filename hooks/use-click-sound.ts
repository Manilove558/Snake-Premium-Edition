"use client"

// hooks/use-click-sound.ts — plays /sounds/click.mp3 whenever the player presses ANY button / link / switch / tab.
//
//  * ONE global listener on `document` (capture phase), so it covers every screen: the game, store, vault, profile,
//    settings, lobby, battle D-pads, dialogs / popups (portals), ...  No per-button code needed.
//  * Follows the "Click sound" switch and its OWN volume (swipe on the Settings row); not the game volume bar or mute.
//  * To keep a button silent give it (or a parent) the attribute  data-no-click-sound .
import { useEffect, useRef } from "react"
import { pressableOf } from "@/lib/pressable"

const CLICK_SRC = "/sounds/click.mp3"

export function useClickSound({ enabled = true, volume = 1 }: { enabled?: boolean; volume?: number } = {}) {
  const enabledRef = useRef(enabled)
  enabledRef.current = enabled
  const volumeRef = useRef(volume)
  volumeRef.current = volume

  useEffect(() => {
    const base = new Audio(CLICK_SRC)
    base.preload = "auto"
    base.load()

    const onClick = (e: MouseEvent) => {
      if (!enabledRef.current || volumeRef.current <= 0) return
      const el = pressableOf(e.target)
      if (!el || el.closest("[data-no-click-sound]")) return
      // a clone per click lets quick taps overlap instead of cutting each other off
      const a = base.cloneNode() as HTMLAudioElement
      a.volume = Math.min(1, Math.max(0, volumeRef.current))
      a.play().catch(() => {})
    }

    document.addEventListener("click", onClick, true)
    return () => document.removeEventListener("click", onClick, true)
  }, [])
}
