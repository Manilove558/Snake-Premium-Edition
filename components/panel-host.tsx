"use client"
import { createContext, useCallback, useContext, useState } from "react"

/**
 * Central-frame architecture.
 * SnakeGame owns ONE `activeView`. Every panel (Store, Vault, Settings, Profile, ...) renders INSIDE the
 * central frame (portal into the "panel layer") instead of a full-screen popup, so the left strip and the
 * right dashboard stay visible and usable.
 */
export type ViewId =
  | "GAME"
  | "STORE"
  | "VAULT"
  | "SETTINGS"
  | "PROFILE"
  | "FRIENDS"
  | "MAILBOX"
  | "ADMIN"
  | "RANK"
  | "MAP"
  | "MULTIPLAYER"

type Ctx = {
  activeView: ViewId
  setActiveView: (v: ViewId) => void
  /** The empty layer element inside the central frame that panels portal into. */
  frame: HTMLElement | null
}

export const PanelHostContext = createContext<Ctx | null>(null)

/** Drop-in replacement for `useState(false)` of a panel: open <=> activeView === id. */
export function usePanelState(id: ViewId): [boolean, (v: boolean) => void] {
  const ctx = useContext(PanelHostContext)
  const [local, setLocal] = useState(false)
  const setActive = ctx?.setActiveView
  const current = ctx?.activeView
  const set = useCallback(
    (v: boolean) => {
      if (!setActive) return setLocal(v)
      // opening switches the frame to this panel; closing only returns to the game if this panel is still the one showing
      if (v) setActive(id)
      else setActive(current === id || current === undefined ? "GAME" : current)
    },
    [setActive, current, id],
  )
  return ctx ? [current === id, set] : [local, setLocal]
}

/** Where a panel should portal to: the central frame (falls back to <body> outside the game screen). */
export function usePanelTarget(): HTMLElement {
  const ctx = useContext(PanelHostContext)
  return ctx?.frame ?? (typeof document !== "undefined" ? document.body : (null as unknown as HTMLElement))
}
