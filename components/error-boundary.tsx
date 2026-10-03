"use client"
import React from "react"
import { createPortal } from "react-dom"

type Props = {
  /** shown in the message, e.g. "Store" */
  name: string
  children: React.ReactNode
  /** "Close" button: leave the broken screen (e.g. back to the game). The boundary resets itself afterwards. */
  onClose?: () => void
}
type State = { error: Error | null }

/**
 * Without an error boundary, ONE uncaught error while rendering (or inside a useEffect) unmounts the WHOLE React tree
 * and the player is left with a blank white screen. This catches it, keeps the rest of the game alive and shows what
 * went wrong (so it can be reported) with a way out.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(`[ErrorBoundary:${this.props.name}]`, error, info.componentStack)
  }

  private reset = () => {
    this.props.onClose?.()
    this.setState({ error: null })
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    const card = (
      <div role="alertdialog" aria-modal="true" className="fixed inset-0 z-[700] flex items-center justify-center bg-black/50 p-4">
        <div className="w-full max-w-[340px] rounded-2xl bg-white text-[#123321] p-4 shadow-2xl">
          <h2 className="text-base font-extrabold">{this.props.name} mein kuch gadbad ho gayi</h2>
          <p className="mt-1 text-xs opacity-70">Game band nahi hua. Neeche wali line support ko bhej do taaki ise theek kiya ja sake.</p>
          <pre className="mt-2 max-h-28 overflow-auto rounded-lg bg-black/5 p-2 text-[10px] leading-snug whitespace-pre-wrap break-words">
            {String(error.message || error).slice(0, 400)}
          </pre>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button onClick={this.reset} className="min-h-[44px] rounded-xl bg-black/5 text-sm font-bold active:scale-95 transition-transform">
              Band karo
            </button>
            <button onClick={() => window.location.reload()} className="min-h-[44px] rounded-xl bg-emerald-500 text-sm font-bold text-white active:scale-95 transition-transform">
              Reload
            </button>
          </div>
        </div>
      </div>
    )
    return typeof document !== "undefined" ? createPortal(card, document.body) : card
  }
}
