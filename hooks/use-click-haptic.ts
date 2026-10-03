"use client"

// hooks/use-click-haptic.ts — a short vibration on EVERY button press (phones / devices that support vibration).
//
//  * ONE global listener on `document` (capture phase): covers every screen, popup and the battle D-pads.
//  * Follows the Settings "Vibration" switch; does nothing on devices without vibration support.
//  * To keep a button from vibrating give it (or a parent) the attribute  data-no-haptic .
import { useEffect, useRef } from "react"
import { pressableOf } from "@/lib/pressable"

export const CLICK_HAPTIC_MS = 15

export function useClickHaptic({ enabled = true }: { enabled?: boolean } = {}) {
  const enabledRef = useRef(enabled)
  enabledRef.current = enabled

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!enabledRef.current) return
      if (typeof navigator === "undefined" || !("vibrate" in navigator)) return
      const el = pressableOf(e.target)
      if (!el || el.closest("[data-no-haptic]")) return
      try {
        navigator.vibrate(CLICK_HAPTIC_MS)
      } catch {
        // vibration blocked by the browser — ignore
      }
    }
    document.addEventListener("click", onClick, true)
    return () => document.removeEventListener("click", onClick, true)
  }, [])
}
