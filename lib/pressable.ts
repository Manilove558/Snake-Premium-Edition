// lib/pressable.ts — "is this click on a button-like control?" (shared by the click-sound and click-vibration hooks)
export const PRESSABLE =
  "button, a[href], summary, select, input[type='checkbox'], input[type='radio'], " +
  "[role='button'], [role='switch'], [role='tab'], [role='menuitem'], [role='checkbox'], [role='radio'], [role='option']"

/** The enabled button-like element a click landed on (or inside), else null. */
export function pressableOf(target: EventTarget | null): Element | null {
  const el = (target as Element | null)?.closest?.(PRESSABLE) ?? null
  if (!el) return null
  if ((el as HTMLButtonElement).disabled || el.getAttribute("aria-disabled") === "true") return null
  return el
}
