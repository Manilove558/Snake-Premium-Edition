// lib/notch.ts — "Notch Display / Safe Area Cutout" setting.
//
//   ON  (default) -> the UI keeps clear of the camera notch / rounded corners (CSS safe-area insets are applied)
//   OFF           -> edge-to-edge: every safe-area inset is treated as 0, the UI uses the whole screen
//
// How it works without re-rendering React: the choice is written to <html data-notch="on|off">.
// app/globals.css maps that attribute to the CSS variables --sai-top / --sai-right / --sai-bottom / --sai-left,
// and every layout rule reads those variables instead of env(safe-area-inset-*) directly.
// Changing the attribute makes the browser re-resolve the variables, so the layout adjusts instantly.
export const NOTCH_KEY = "snake-notch-safe-area"
export const NOTCH_DEFAULT = true // ON = respect the notch (the safe choice, same behaviour as before this setting existed)

export function loadNotch(): boolean {
  try {
    const v = window.localStorage.getItem(NOTCH_KEY)
    return v === null ? NOTCH_DEFAULT : v === "1"
  } catch {
    return NOTCH_DEFAULT
  }
}

export function saveNotch(on: boolean): void {
  try {
    window.localStorage.setItem(NOTCH_KEY, on ? "1" : "0")
  } catch {
    /* private mode / storage full: the setting just won't persist */
  }
}

/** Flip the attribute the CSS listens to. Instant, no React render involved. */
export function applyNotch(on: boolean): void {
  if (typeof document === "undefined") return
  document.documentElement.setAttribute("data-notch", on ? "on" : "off")
}

/**
 * Runs in <head> BEFORE the first paint (see app/layout.tsx) so a saved "OFF" never flashes the safe-area layout
 * on reload. Keep this string in sync with NOTCH_KEY / loadNotch.
 */
export const NOTCH_INIT_SCRIPT = `(function(){try{var v=localStorage.getItem(${JSON.stringify(NOTCH_KEY)});document.documentElement.setAttribute('data-notch',v==='0'?'off':'on')}catch(e){document.documentElement.setAttribute('data-notch','on')}})()`
