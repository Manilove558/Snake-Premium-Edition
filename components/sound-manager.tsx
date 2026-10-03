"use client"

import { useRef, useEffect, useCallback } from "react"
import { playSfx, preloadSfx } from "@/lib/sfx"

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
      preloadSfx(["walk-a", "walk-b", "food"])
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

  // Snake step: soft "slither". Two variants played alternately + a little random pitch, throttled to 60 ms.
  const lastStepRef = useRef({ t: 0, flip: false })
  const playWalkSound = useCallback(() => {
    const v = volumeRef.current
    if (!enabledRef.current || v <= 0) return
    const now = performance.now()
    if (now - lastStepRef.current.t < 60) return
    lastStepRef.current.t = now
    lastStepRef.current.flip = !lastStepRef.current.flip
    playSfx(lastStepRef.current.flip ? "walk-a" : "walk-b", { gain: v, rate: 0.94 + Math.random() * 0.12 })
  }, [])

  // Food bite: quick bites in a row climb a major scale (up to an octave); a pause of 1.6 s resets it.
  const biteRef = useRef({ t: 0, streak: 0 })
  const playFoodSound = useCallback(() => {
    const v = volumeRef.current
    if (!enabledRef.current || v <= 0) return
    const now = performance.now()
    const b = biteRef.current
    b.streak = now - b.t < 1600 ? Math.min(b.streak + 1, 7) : 0
    b.t = now
    const semis = [0, 2, 4, 5, 7, 9, 11, 12][b.streak]
    playSfx("food", { gain: v * 0.9, rate: Math.pow(2, semis / 12) })
  }, [])

  const playGameOverSound = useCallback(() => {
    const el = withVolume(enabledRef.current ? gameOverSoundRef.current : null)
    if (el) {
      el.currentTime = 0
      el.play().catch((err) => console.error("Error playing game over sound:", err))
    }
  }, [withVolume])

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
  }
}

