"use client"

// components/battle-router.tsx — picks the battle engine from the room's game mode.
// snake-game.tsx renders <BattleRouter/> where it used to render <MultiplayerBattle/>.
import { useEffect, useState, type ComponentProps } from "react"
import MultiplayerBattle from "./multiplayer-battle"
import RoyaleBattle from "./royale-battle"
import { getRoomSettings, subscribeToRoom, type MpMode } from "@/lib/multiplayer"

type Props = ComponentProps<typeof MultiplayerBattle>

export default function BattleRouter(props: Props) {
  const [mode, setMode] = useState<MpMode | null>(null)
  const { code, onExit } = props

  useEffect(() => {
    let decided = false
    return subscribeToRoom(code, (r) => {
      if (r === null) return onExit()
      if (decided) return // the mode can only change in the lobby, i.e. before a new battle mounts
      decided = true
      setMode(getRoomSettings(r).mode)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code])

  if (mode === null) return null
  return mode === "royale" ? <RoyaleBattle {...props} /> : <MultiplayerBattle {...props} />
}
