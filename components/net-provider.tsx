"use client"

// components/net-provider.tsx — owns the ONE Socket.io connection of the app (v23: the only multiplayer path).
//
// Lobby and battle screens are mounted at different times by snake-game.tsx, but they must share the same socket,
// the same room and the same match state — so the hook lives here, above both of them.
// The socket is NOT opened while the player is in single-player: `connect()` is called when the multiplayer lobby opens
// and `disconnect()` when it closes (snake-game.tsx).
import { createContext, useCallback, useContext, useMemo, useRef, type ReactNode } from "react"
import { useSnakeNetwork, type UseSnakeNetwork } from "@/hooks/useSnakeNetwork"
import { useAuthUser } from "@/lib/auth"
import { toMpRoom } from "@/lib/net-adapter"
import type { MpRoom } from "@/lib/multiplayer"

interface NetContextValue {
  net: UseSnakeNetwork
  /** the live room in the classic `MpRoom` shape (null while not in a room) */
  mp: MpRoom | null
  /** opens the socket if needed and resolves true once it is connected (false after `timeoutMs`) */
  ensureConnected: (timeoutMs?: number) => Promise<boolean>
}

const NetContext = createContext<NetContextValue | null>(null)

export function NetProvider({ children }: { children: ReactNode }) {
  const { user } = useAuthUser()
  const userRef = useRef(user)
  userRef.current = user

  // Fresh Firebase ID token on every (re)connect. The server verifies it (Firebase Admin) and binds the verified uid
  // to the player — that is what makes ranked rooms possible. Guests send none.
  const getIdToken = useCallback(async (): Promise<string | null> => {
    try {
      const u = userRef.current
      return u ? await u.getIdToken() : null
    } catch {
      return null
    }
  }, [])

  const net = useSnakeNetwork({ autoConnect: false, getIdToken })
  const netRef = useRef(net)
  netRef.current = net

  const mp = useMemo(
    () => toMpRoom({ room: net.room, gameState: net.gameState, killFeed: net.killFeed, result: net.result, config: net.config, startsAt: net.startsAt }),
    [net.room, net.gameState, net.killFeed, net.result, net.config, net.startsAt],
  )

  const ensureConnected = useCallback(async (timeoutMs = 6000): Promise<boolean> => {
    if (netRef.current.isConnected) return true
    netRef.current.connect()
    const until = Date.now() + timeoutMs
    while (Date.now() < until) {
      await new Promise((r) => setTimeout(r, 100))
      if (netRef.current.isConnected) return true
    }
    return netRef.current.isConnected
  }, [])

  const value = useMemo<NetContextValue>(() => ({ net, mp, ensureConnected }), [net, mp, ensureConnected])
  return <NetContext.Provider value={value}>{children}</NetContext.Provider>
}

export function useNet(): NetContextValue {
  const v = useContext(NetContext)
  if (!v) throw new Error("useNet() must be used inside <NetProvider>")
  return v
}
