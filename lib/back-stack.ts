/**
 * Central Back-button manager (LIFO handler stack).
 *
 * Why one manager instead of every panel calling history.pushState():
 *  - Back is ONE global event. Whoever is on top of the UI (confirm dialog > panel > match > home) must get it first.
 *  - Per-panel pushState/popstate pairs fight each other (several listeners fire for one Back press, stale entries pile up).
 *  - Native (Capacitor) has no history at all: the hardware button is a plain event we dispatch into this stack.
 *
 * Contract: handlers are called top-first. A handler returns `true` when it consumed the press.
 * If nobody consumes it, the fallback (root handler) runs -> "press again to exit" / exit dialog.
 */

export type BackHandler = () => boolean | void

type Entry = { id: number; handler: BackHandler }

const stack: Entry[] = []
let nextId = 1
let fallback: BackHandler | null = null

/** Register a handler on top of the stack. Returns an unregister function. */
export function pushBackHandler(handler: BackHandler): () => void {
  const id = nextId++
  stack.push({ id, handler })
  return () => {
    const i = stack.findIndex((e) => e.id === id)
    if (i >= 0) stack.splice(i, 1)
  }
}

/** Last-resort handler when the stack is empty (the "home" screen). */
export function setBackFallback(h: BackHandler | null) { fallback = h }

/** Feed one Back press into the stack. Returns true if something handled it. */
export function dispatchBack(): boolean {
  for (let i = stack.length - 1; i >= 0; i--) {
    let consumed: boolean | void = false
    try { consumed = stack[i].handler() } catch (e) { console.error("[back] handler failed", e) }
    // `undefined` (a handler that just closes something) counts as consumed — only an explicit `false` passes the press down
    if (consumed !== false) return true
  }
  if (fallback) { try { fallback() } catch (e) { console.error("[back] fallback failed", e) } return true }
  return false
}

export const backStackDepth = () => stack.length

/* ------------------------------------------------------------------ platform wiring ------------------------------------------------------------------ */

type Cleanup = () => void
let activeCleanup: Cleanup | null = null
const SENTINEL = "__snake_back_guard__"

/**
 * Web / PWA: keep exactly ONE dummy history entry in front of the real page.
 *   [real page] [sentinel]  <- user is here
 * Back pops the sentinel -> `popstate` fires -> we dispatch into the stack and immediately push the sentinel again,
 * so the user never actually leaves. Normal browser navigation stays intact because we only ever add ONE entry
 * (never a growing pile) and we never touch entries that aren't ours.
 */
function installWebGuard(): Cleanup {
  const arm = () => { if (history.state?.[SENTINEL] !== true) history.pushState({ [SENTINEL]: true }, "") }
  arm()
  const onPop = () => {
    // The sentinel was just consumed by the Back press -> re-arm first (so a slow handler can never leave us unguarded)
    arm()
    dispatchBack()
  }
  window.addEventListener("popstate", onPop)
  // bfcache / tab restore can drop our entry: re-arm when the page becomes visible again
  const onShow = () => arm()
  window.addEventListener("pageshow", onShow)
  return () => {
    window.removeEventListener("popstate", onPop)
    window.removeEventListener("pageshow", onShow)
  }
}

/**
 * Native Android (Capacitor): the hardware / gesture Back is `App.addListener("backButton")`.
 * Registering ANY listener disables Capacitor's default behaviour (webview.goBack() / finish()), so we are fully in charge:
 * `App.exitApp()` is only ever called by the exit confirmation.
 */
async function installNativeGuard(): Promise<Cleanup> {
  const { App } = await import("@capacitor/app")
  const handle = await App.addListener("backButton", () => { dispatchBack() })
  return () => { void handle.remove() }
}

export async function exitApplication(): Promise<void> {
  try {
    const { Capacitor } = await import("@capacitor/core")
    if (Capacitor.isNativePlatform()) {
      const { App } = await import("@capacitor/app")
      await App.exitApp()
      return
    }
  } catch { /* fall through to web */ }
  // Web: tear the guard down FIRST (otherwise the popstate from history.go would re-open the exit dialog), then step back
  // past [real page][sentinel]. (window.close() only works for script-opened windows, so this is the best a PWA can do.)
  activeCleanup?.()
  activeCleanup = null
  history.go(-2)
}

/** Install the right guard for the current platform. Returns a cleanup. Call once, from the root component. */
export async function installBackGuard(): Promise<Cleanup> {
  let native = false
  try {
    const { Capacitor } = await import("@capacitor/core")
    native = Capacitor.isNativePlatform()
  } catch { /* plain web */ }
  const cleanup = native ? await installNativeGuard() : installWebGuard()
  activeCleanup = cleanup
  return () => { cleanup(); if (activeCleanup === cleanup) activeCleanup = null }
}
