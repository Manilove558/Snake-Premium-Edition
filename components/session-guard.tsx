"use client"
import { useEffect, useState } from "react"
import { createPortal } from "react-dom"
import { ShieldAlert } from "lucide-react"
import { signOutUser } from "@/lib/auth"
import { detachAccount } from "@/lib/cloud"

/**
 * Shown when the same Google account is opened on another device: this device is logged out
 * (without saving — the new device owns the account now) and the player is told why.
 */
export function SessionGuard() {
  const [kicked, setKicked] = useState(false)
  useEffect(() => {
    const h = async () => {
      setKicked(true)
      try { await detachAccount(false) } catch {}
      try { await signOutUser() } catch {}
    }
    window.addEventListener("session-kicked", h)
    return () => window.removeEventListener("session-kicked", h)
  }, [])
  if (!kicked) return null
  return createPortal(
    <div className="fixed inset-0 z-[400] flex items-center justify-center bg-black/50 backdrop-blur-sm p-6">
      <div className="w-full max-w-xs rounded-3xl bg-[#f1f4f1] dark:bg-[#0b0f14] border border-black/5 dark:border-white/10 p-5 shadow-2xl text-center text-[#123321] dark:text-white animate-fade-in">
        <div className="mx-auto h-12 w-12 rounded-full bg-amber-400/20 flex items-center justify-center"><ShieldAlert className="h-6 w-6 text-amber-500" /></div>
        <div className="mt-3 text-lg font-bold">Logged out</div>
        <p className="mt-1.5 text-[13px] text-muted-foreground leading-snug">Your account was opened on another device. You can play on only one device at a time.</p>
        <button onClick={() => setKicked(false)} className="d-pad-btn mt-4 w-full h-11 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-emerald-500 to-emerald-400 shadow-md shadow-emerald-500/30">OK</button>
      </div>
    </div>,
    document.body,
  )
}
