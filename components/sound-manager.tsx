"use client"

import { useRef, useEffect } from "react"

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
  const walkSoundRef = useRef<HTMLAudioElement | null>(null)
  const foodSoundRef = useRef<HTMLAudioElement | null>(null)
  const gameOverSoundRef = useRef<HTMLAudioElement | null>(null)
  const gameStartSoundRef = useRef<HTMLAudioElement | null>(null)

  // Initialize audio elements
  useEffect(() => {
    if (typeof window !== "undefined") {
      walkSoundRef.current = new Audio("/sounds/snake-walk.mp3")
      foodSoundRef.current = new Audio("/sounds/black_food.mp3")
      gameOverSoundRef.current = new Audio("/sounds/game-over.mp3")
      gameStartSoundRef.current = new Audio("/sounds/game-start.mp3")

      // Set volume for walk sound (it might be played frequently)
      if (walkSoundRef.current) {
        walkSoundRef.current.volume = 0.3
      }
    }

    // Cleanup
    return () => {
      walkSoundRef.current = null
      foodSoundRef.current = null
      gameOverSoundRef.current = null
      gameStartSoundRef.current = null
    }
  }, [])

  const withVolume = (el: HTMLAudioElement | null, base = 1) => {
    if (el) el.volume = Math.min(1, Math.max(0, base * volumeRef.current))
    return el
  }

  const playWalkSound = () => {
    if (enabledRef.current && walkSoundRef.current) {
      // Clone the audio to allow overlapping sounds
      const walkSound = withVolume(walkSoundRef.current.cloneNode() as HTMLAudioElement, 0.3)
      walkSound?.play().catch((err) => console.error("Error playing walk sound:", err))
    }
  }

  const playFoodSound = () => {
    const el = withVolume(enabledRef.current ? foodSoundRef.current : null)
    if (el) {
      el.currentTime = 0
      el.play().catch((err) => console.error("Error playing food sound:", err))
    }
  }

  const playGameOverSound = () => {
    const el = withVolume(enabledRef.current ? gameOverSoundRef.current : null)
    if (el) {
      el.currentTime = 0
      el.play().catch((err) => console.error("Error playing game over sound:", err))
    }
  }

  const playGameStartSound = () => {
    const el = withVolume(enabledRef.current ? gameStartSoundRef.current : null)
    if (el) {
      el.currentTime = 0
      el.play().catch((err) => console.error("Error playing game start sound:", err))
    }
  }

  return {
    playWalkSound,
    playFoodSound,
    playGameOverSound,
    playGameStartSound,
  }
}

