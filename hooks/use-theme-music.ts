"use client"

// hooks/use-theme-music.ts — plays the selected theme song on loop, everywhere in the app (home, store, settings, matches).
//
//  * Browsers / Android WebView block audio until the first tap, so playback starts on the player's first touch / click.
//  * Pauses while the app is in the background (home button, switching apps, screen off) and resumes when it comes back.
//  * Follows the master mute icon (`enabled`) and has its OWN volume (`volume`).
import { useEffect, useRef } from "react"
import { findTrack } from "@/lib/theme-music"

export function useThemeMusic({ trackId, enabled = true, volume = 0.5 }: { trackId: string; enabled?: boolean; volume?: number }) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const unlockedRef = useRef(false)
  const stateRef = useRef({ trackId, enabled, volume })
  stateRef.current = { trackId, enabled, volume }

  const sync = useRef(() => {})
  sync.current = () => {
    const a = audioRef.current
    if (!a) return
    const { trackId, enabled, volume } = stateRef.current
    const track = findTrack(trackId)

    // song changed -> load the new one from the start
    const want = track ? new URL(track.src, window.location.href).href : ""
    if (track && a.src !== want) { a.src = track.src; a.currentTime = 0 }
    a.volume = Math.min(1, Math.max(0, volume))

    const shouldPlay = !!track && enabled && volume > 0 && unlockedRef.current && !document.hidden
    if (shouldPlay) { if (a.paused) a.play().catch(() => {}) }
    else if (!a.paused) a.pause()
  }

  useEffect(() => {
    const a = new Audio()
    a.loop = true
    a.preload = "auto"
    audioRef.current = a

    const unlock = () => {
      unlockedRef.current = true
      sync.current()
      // keep listening: if the browser still refused the first play(), the next tap retries
      if (!a.paused) {
        document.removeEventListener("pointerdown", unlock, true)
        document.removeEventListener("keydown", unlock, true)
        document.removeEventListener("touchend", unlock, true)
      }
    }
    const onVis = () => sync.current()
    document.addEventListener("pointerdown", unlock, true)
    document.addEventListener("keydown", unlock, true)
    document.addEventListener("touchend", unlock, true)
    document.addEventListener("visibilitychange", onVis)
    sync.current()

    return () => {
      document.removeEventListener("pointerdown", unlock, true)
      document.removeEventListener("keydown", unlock, true)
      document.removeEventListener("touchend", unlock, true)
      document.removeEventListener("visibilitychange", onVis)
      a.pause()
      a.removeAttribute("src")
      audioRef.current = null
    }
  }, [])

  useEffect(() => { sync.current() }, [trackId, enabled, volume])
}
