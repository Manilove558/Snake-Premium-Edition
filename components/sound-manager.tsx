"use client"

import { useRef, useEffect, useCallback } from "react"
import { playSfx, preloadSfx, startLoop, type LoopHandle, playCountdownTick, playElimination, playZoneWarning, playZoneShrink } from "@/lib/sfx"

interface SoundManagerProps {
  enabled?: boolean
  /** Master volume 0..1 (persisted by the caller) */
  volume?: number
}

export function useSoundManager({ enabled = true, volume = 1 }: SoundManagerProps = {}) {
  const enabledRef = useRef(enabled)
  enabledRef.current = enabled
  const volumeRef = useRef(volume)
  volumeRef.current = volume
  const gameOverSoundRef = useRef<HTMLAudioElement | null>(null)
  const gameStartSoundRef = useRef<HTMLAudioElement | null>(null)

  // Initialize audio elements
  useEffect(() => {
    if (typeof window !== "undefined") {
      gameOverSoundRef.current = new Audio("/sounds/game-over.mp3")
      gameStartSoundRef.current = new Audio("/sounds/game-start.mp3")
      // short, frequent cues are decoded once and played through Web Audio (instant, no per-play allocation)
      preloadSfx(["snake-walk.mp3", "food"])
    }

    // Cleanup
    return () => {
      gameOverSoundRef.current = null
      gameStartSoundRef.current = null
    }
  }, [])

  // v19.0.1 audit fix: memoize all callbacks so the game-loop effect in
  // snake-game.tsx (which lists them as deps) doesn't re-run on every render.
  const withVolume = useCallback(
    (el: HTMLAudioElement | null, base = 1) => {
      if (el) el.volume = Math.min(1, Math.max(0, base * volumeRef.current))
      return el
    },
    [],
  )

  // Snake walk: the "snake-walk.mp3" slither plays as a gapless LOOP while the snake is moving. Every step calls
  // playWalkSound(); if no step arrives for 300 ms (paused, crashed, game over) the loop fades out.
  // `scale` (0..1) lets a spectator hear OTHER snakes more quietly than their own snake.
  const walkRef = useRef<{ h: LoopHandle | null; timer: ReturnType<typeof setTimeout> | null }>({ h: null, timer: null })
  const stopWalk = useCallback(() => {
    const w = walkRef.current
    if (w.timer) { clearTimeout(w.timer); w.timer = null }
    if (w.h) { w.h.stop(); w.h = null }
  }, [])
  const playWalkSound = useCallback((scale = 1) => {
    const s = typeof scale === "number" ? scale : 1
    const v = volumeRef.current
    if (!enabledRef.current || v <= 0) { stopWalk(); return }
    const w = walkRef.current
    const gain = v * 0.8 * s
    if (!w.h) w.h = startLoop("snake-walk.mp3", gain)
    else w.h.setGain(gain)
    if (w.timer) clearTimeout(w.timer)
    w.timer = setTimeout(stopWalk, 300)
  }, [stopWalk])
  useEffect(() => stopWalk, [stopWalk]) // leaving the screen silences it

  // Countdown 3 / 2 / 1 tick (rising notes), follows the master volume + mute
  const playCountdownSound = useCallback((n: number) => {
    const v = volumeRef.current
    if (!enabledRef.current || v <= 0) return
    playCountdownTick(n, v)
  }, [])

  // Food bite: quick bites in a row climb a major scale (up to an octave); a pause of 1.6 s resets it.
  const biteRef = useRef({ t: 0, streak: 0 })
  const playFoodSound = useCallback((scale = 1) => {
    const s = typeof scale === "number" ? scale : 1
    const v = volumeRef.current
    if (!enabledRef.current || v <= 0) return
    const now = performance.now()
    const b = biteRef.current
    b.streak = now - b.t < 1600 ? Math.min(b.streak + 1, 7) : 0
    b.t = now
    const semis = [0, 2, 4, 5, 7, 9, 11, 12][b.streak]
    playSfx("food", { gain: v * 0.9 * s, rate: Math.pow(2, semis / 12) })
  }, [])

  // Events that happen to OTHER players / the zone (spectator audio + Battle Royale zone cues).
  // They follow the same mute + master volume as every other cue.
  const playEliminationSound = useCallback(() => {
    if (!enabledRef.current || volumeRef.current <= 0) return
    playElimination(volumeRef.current)
  }, [])
  const playZoneWarningSound = useCallback(() => {
    if (!enabledRef.current || volumeRef.current <= 0) return
    playZoneWarning(volumeRef.current)
  }, [])
  const playZoneShrinkSound = useCallback(() => {
    if (!enabledRef.current || volumeRef.current <= 0) return
    playZoneShrink(volumeRef.current)
  }, [])

  const playGameOverSound = useCallback(() => {
    stopWalk()
    const el = withVolume(enabledRef.current ? gameOverSoundRef.current : null)
    if (el) {
      el.currentTime = 0
      el.play().catch((err) => console.error("Error playing game over sound:", err))
    }
  }, [withVolume, stopWalk])

  const playGameStartSound = useCallback(() => {
    const el = withVolume(enabledRef.current ? gameStartSoundRef.current : null)
    if (el) {
      el.currentTime = 0
      el.play().catch((err) => console.error("Error playing game start sound:", err))
    }
  }, [withVolume])

  return {
    playWalkSound,
    playFoodSound,
    playGameOverSound,
    playGameStartSound,
    playCountdownSound,
    playEliminationSound,
    playZoneWarningSound,
    playZoneShrinkSound,
  }
}

