"use client"
import { createPortal } from "react-dom"
import { useBackButton } from "@/hooks/use-back-button"

type Props = {
  open: boolean
  title: string
  message?: string
  confirmLabel: string
  cancelLabel?: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}

/**
 * Small modal used for "Exit Game?" / "Leave match?". It registers its OWN back handler, so while it is open
 * pressing Back = Cancel (the dialog always sits on top of the back stack).
 */
export function ConfirmDialog({ open, title, message, confirmLabel, cancelLabel = "Stay", danger = true, onConfirm, onCancel }: Props) {
  useBackButton(open, () => { onCancel() })
  if (!open || typeof document === "undefined") return null
  return createPortal(
    <div
      role="alertdialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-[500] flex items-center justify-center bg-black/60 backdrop-blur-sm p-3"
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[320px] rounded-2xl border border-black/10 dark:border-white/10 bg-white dark:bg-[#0d1f16] text-[#123321] dark:text-[#eafff3] p-4 shadow-2xl"
      >
        <h2 className="text-base font-extrabold">{title}</h2>
        {message && <p className="mt-1 text-xs opacity-70">{message}</p>}
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button autoFocus onClick={onCancel} className="d-pad-btn min-h-[44px] rounded-xl border border-black/10 dark:border-white/15 bg-black/5 dark:bg-white/10 text-sm font-bold active:scale-95 transition-transform">
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className={`d-pad-btn min-h-[44px] rounded-xl text-sm font-bold text-white active:scale-95 transition-transform ${danger ? "bg-red-500" : "bg-emerald-500"}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
