"use client"

// components/battle-router.tsx — picks the battle screen from the room's game mode.
// snake-game.tsx renders <BattleRouter/> while a Socket.io match is running (countdown / playing / ended).
import { useRef, type ComponentProps } from "react"
import ClassicNetBattle from "./classic-net-battle"
import RoyaleNetBattle from "./royale-net-battle"
import { useNet } from "./net-provider"
import type { MpMode } from "@/lib/multiplayer"

type Props = ComponentProps<typeof ClassicNetBattle>

export default function BattleRouter(props: Props) {
  const { net } = useNet()
  // The mode can only change in the lobby, i.e. before a new battle mounts: remember the first one we see.
  const modeRef = useRef<MpMode | null>(null)
  if (modeRef.current === null && net.room) modeRef.current = net.room.settings.mode === "royale" ? "royale" : "classic"
  const mode = modeRef.current
  if (mode === null) return null
  return mode === "royale" ? <RoyaleNetBattle {...props} /> : <ClassicNetBattle {...props} />
}
