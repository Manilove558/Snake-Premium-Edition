"use client"

// hooks/use-notch-screen.ts — React state for the Notch setting (persisted + applied to <html data-notch>).
import { useCallback, useEffect, useState } from "react"
import { applyNotch, installNotchBarGuard, loadNotch, NOTCH_DEFAULT, saveNotch } from "@/lib/notch"

export function useNotchScreen() {
  const [notchSafe, setNotchSafeState] = useState(NOTCH_DEFAULT)

  // read the saved value once on mount (the inline script in layout.tsx already set the attribute before paint)
  useEffect(() => {
    const v = loadNotch()
    setNotchSafeState(v)
    applyNotch(v)
    return installNotchBarGuard() // keeps the bars hidden after the notification shade / Back / returning to the app
  }, [])

  const setNotchSafe = useCallback((v: boolean) => {
    setNotchSafeState(v)
    applyNotch(v) // instant: the CSS variables change right now
    saveNotch(v)
  }, [])

  return { notchSafe, setNotchSafe }
}
