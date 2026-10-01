"use client"
import { Smartphone } from "lucide-react"

/** The app is landscape-only. The Android build is locked by the manifest; on touch devices that still open it in portrait (browser / PWA) this asks the player to rotate. */
export function RotateHint() {
  return (
    <div className="rotate-hint fixed inset-0 z-[500] flex-col items-center justify-center gap-3 bg-[#0b1510] text-[#eafff3] text-center p-6">
      <Smartphone className="h-12 w-12 text-emerald-400 rotate-90" />
      <div className="text-lg font-bold">Rotate your phone</div>
      <div className="text-sm opacity-60">Snake plays in landscape mode</div>
    </div>
  )
}
