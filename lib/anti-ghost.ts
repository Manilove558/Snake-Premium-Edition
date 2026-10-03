// lib/anti-ghost.ts — Anti-Ghosting for the on-screen direction buttons.
//
//  * Fires on POINTER DOWN (the instant a finger lands), not on click (which only fires after the finger lifts and is
//    dropped / delayed when a 2nd finger is down or taps are fast). Every finger is its own pointer, so holding one
//    button and tapping another registers both.
//  * The click that follows a touch / mouse press is ignored (detail > 0), so a stale click can never re-apply an old
//    direction on top of a newer press. Keyboard activation (Enter / Space -> click with detail 0) still works.
//  * Long-press context menu is blocked.
import type { MouseEvent, PointerEvent } from "react"
import { playButtonClickSound } from "@/lib/button-sound"

export function antiGhostProps(fire: () => void) {
  const press = () => {
    playButtonClickSound() // synthesized tick on every D-pad press
    fire()
  }
  return {
    // the global click.mp3 listener skips these buttons (they have their own tick sound)
    "data-no-click-sound": "",
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      if (e.pointerType === "mouse" && e.button !== 0) return
      press()
    },
    onClick: (e: MouseEvent<HTMLElement>) => {
      if (e.detail === 0) press()
    },
    onContextMenu: (e: MouseEvent<HTMLElement>) => e.preventDefault(),
  }
}
