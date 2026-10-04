"use client"

// components/network-session.tsx — owns the Socket.io hook and switches lobby <-> arena.
// Rendered by MultiplayerLobby when the player picks the "⚡ Socket" tab.
import { useCallback, useState } from "react"
import { useSnakeNetwork } from "@/hooks/useSnakeNetwork"
import { useAuthUser } from "@/lib/auth"
import NetworkLobby from "./network-lobby"
import NetworkArena from "./network-arena"

interface Props {
  darkMode: boolean
  controlMode?: "swipe" | "buttons"
  onExit: () => void
}

export default function NetworkSession({ darkMode, controlMode = "swipe", onExit }: Props) {
  const { user: authUser } = useAuthUser()
  const [isRanked, setIsRanked] = useState(false)

  // Fresh Firebase ID token for the socket handshake (null = guest). The server
  // verifies it when FIREBASE_SERVICE_ACCOUNT_JSON is configured.
  const getIdToken = useCallback(async (): Promise<string | null> => {
    try {
      const u = authUser
      if (!u) return null
      return await u.getIdToken()
    } catch {
      return null
    }
  }, [authUser])

  const net = useSnakeNetwork({ getIdToken })

  const name = (authUser?.displayName ?? "").trim().slice(0, 16) || "Player"
  // Ranked needs a Google-signed-in player (same rule as the Firebase path)
  const canRank =
    !!authUser && authUser.providerData.some((p) => p.providerId === "google.com")

  const inMatch = net.phase === "countdown" || net.phase === "playing" || net.phase === "ended"

  if (inMatch) {
    return (
      <NetworkArena
        net={net}
        darkMode={darkMode}
        controlMode={controlMode}
        isRanked={isRanked && canRank}
        myUid={authUser?.uid ?? null}
        onExit={onExit}
      />
    )
  }
  return (
    <NetworkLobby
      net={net}
      name={name}
      darkMode={darkMode}
      isRanked={isRanked}
      onRankedChange={setIsRanked}
      canRank={canRank}
      onExit={onExit}
    />
  )
}
