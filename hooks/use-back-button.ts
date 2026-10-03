"use client"
import { useEffect, useRef } from "react"
import { pushBackHandler, type BackHandler } from "@/lib/back-stack"

/**
 * Register a Back-button handler while `enabled` is true.
 *
 *   useBackButton(open, () => setOpen(false))          // modal: Back closes it
 *   useBackButton(isPlaying, () => { pause(); askExit() })  // match: Back pauses + asks
 *
 * - Stack order = the order handlers became enabled, so the most recently opened layer always wins.
 * - The latest `handler` closure is always used (no stale state), without re-registering (which would reorder the stack).
 * - Return `false` from the handler to pass the press to the layer below; anything else = handled.
 * - Unregisters on disable/unmount.
 */
export function useBackButton(enabled: boolean, handler: BackHandler) {
  const ref = useRef(handler)
  ref.current = handler
  useEffect(() => {
    if (!enabled) return
    return pushBackHandler(() => ref.current())
  }, [enabled])
}
