"use client"

// hooks/use-royale-zone.ts — shrinking-zone hook for Battle Royale.
//  * builds the zone boxes from the host's seed (identical on every client)
//  * `stateAt(serverNow)` is a cheap pure lookup for the 60 fps render loop / tick loop
//  * `hud` re-renders React only when a visible number (seconds, warning flag...) changes
import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react"
import { buildZoneBoxes, getZoneState, ZoneDamageTracker, type ZoneState } from "@/lib/br/zone"
import { BR_GRID } from "@/lib/br/constants"

export interface ZoneRecord {
  seed: number
  startAt: number
}

export interface ZoneHud {
  /** ms since the match started (0 during the countdown) */
  elapsedMs: number
  state: ZoneState
}

const WORLD_STATE: ZoneState = {
  box: { minX: 0, minY: 0, maxX: BR_GRID - 1, maxY: BR_GRID - 1 },
  target: null,
  warning: false,
  shrinking: false,
  msToNextShrink: null,
  nextStage: null,
  stage: 0,
}

export function useRoyaleZone(zone: ZoneRecord | null | undefined, serverOffsetRef: MutableRefObject<number>, frozenAtServerMs?: number | null) {
  const seed = zone?.seed ?? null
  const startAt = zone?.startAt ?? 0
  const boxes = useMemo(() => (seed === null ? null : buildZoneBoxes(seed)), [seed])

  const stateAt = useCallback(
    (serverNow: number): ZoneState => (boxes ? getZoneState(boxes, serverNow - startAt) : WORLD_STATE),
    [boxes, startAt],
  )

  const frozenRef = useRef<number | null>(null)
  frozenRef.current = frozenAtServerMs ?? null

  const [hud, setHud] = useState<ZoneHud>({ elapsedMs: 0, state: WORLD_STATE })
  const lastKey = useRef("")
  useEffect(() => {
    if (!boxes) return
    const id = setInterval(() => {
      const serverNow = frozenRef.current ?? Date.now() + serverOffsetRef.current
      const state = stateAt(serverNow)
      const elapsedMs = Math.max(0, serverNow - startAt)
      // only touch React state when something the HUD shows has changed
      const key = `${Math.floor(elapsedMs / 1000)}|${state.warning}|${state.shrinking}|${state.stage}|${state.msToNextShrink === null ? "x" : Math.ceil(state.msToNextShrink / 1000)}`
      if (key === lastKey.current) return
      lastKey.current = key
      setHud({ elapsedMs, state })
    }, 100)
    return () => clearInterval(id)
  }, [boxes, stateAt, startAt, serverOffsetRef])

  return { boxes, startAt, stateAt, hud }
}

/** Keeps the "outside the zone" timer for MY head (one instance per component). */
export function useZoneDamageTracker() {
  const ref = useRef<ZoneDamageTracker | null>(null)
  if (ref.current === null) ref.current = new ZoneDamageTracker()
  return ref.current
}
