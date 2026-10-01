"use client"
import { useEffect, useRef, useState } from "react"
import { getCatalogItem, type StoreItem } from "@/lib/store"

/**
 * The avatar item a player is really showing, or null (= use the Google photo).
 * A VIP avatar only counts while that player still has VIP (`vip`), otherwise it falls back to the photo.
 */
export function resolveAvatar(avatarId?: string | null, vip = false): StoreItem | null {
  const it = avatarId ? getCatalogItem(avatarId) : undefined
  if (!it || it.kind !== "avatar") return null
  // image avatar, or classic emoji avatar
  if (!it.img && (!it.emoji || !it.bg)) return null
  if (it.vipOnly && !vip) return null
  return it
}


// ---------------------------------------------------------------------------
// Animated (GIF) avatars: shown as a still picture everywhere, and only play
// (once) when `animate` is set — i.e. in the Store's avatar cards and when
// somebody opens the player's profile. Everywhere else: still frame, no tap.
// The GIF is fetched once and every play gets a FRESH blob URL, so the
// animation always restarts from the first frame instead of showing the last one.
// ---------------------------------------------------------------------------
const gifBlobs = new Map<string, Promise<Blob>>()
function loadGifBlob(src: string): Promise<Blob> {
  let p = gifBlobs.get(src)
  if (!p) {
    p = fetch(src).then((r) => r.blob())
    p.catch(() => gifBlobs.delete(src))
    gifBlobs.set(src, p)
  }
  return p
}

/** Fresh object URL for `src` (restarts the GIF each time `key` changes); null until ready. */
function usePlayOnceSrc(src: string | undefined, enabled: boolean, key: string): string | null {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    setUrl(null)
    if (!enabled || !src) return
    let alive = true
    let made: string | null = null
    loadGifBlob(src)
      .then((b) => {
        if (!alive) return
        made = URL.createObjectURL(b)
        setUrl(made)
      })
      .catch(() => { if (alive) setUrl(src) })
    return () => { alive = false; if (made) URL.revokeObjectURL(made) }
  }, [src, enabled, key])
  return url
}

/** Profile picture: chosen store avatar > Google photo > generic icon. Used for me AND for other players. */
export function PlayerAvatar({
  photo,
  avatarId,
  vip = false,
  size = 40,
  ring = true,
  className = "",
  animate = false,
  tapToPlay = false,
}: {
  photo?: string | null
  avatarId?: string | null
  vip?: boolean
  size?: number
  ring?: boolean
  className?: string
  /** play the avatar's GIF animation once (store avatar cards + profile views) */
  animate?: boolean
  /** show the still frame; the GIF plays once each time the player taps / clicks the avatar (Store + Vault) */
  tapToPlay?: boolean
}) {
  const av = resolveAvatar(avatarId, vip)
  const isAnimated = !!av?.imgStill && !!av.img
  const [tapKey, setTapKey] = useState(0)
  const [tapping, setTapping] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  const onTap = () => {
    setTapKey((k) => k + 1)
    setTapping(true)
    if (timer.current) clearTimeout(timer.current)
    // GIF plays once; go back to the still frame when it is over (fallback 2.5s if length unknown)
    timer.current = setTimeout(() => setTapping(false), (av?.imgMs ?? 2500) + 400)
  }
  const playSrc = usePlayOnceSrc(av?.img, (animate || tapping) && isAnimated, `${avatarId}:${tapKey}`)
  const base = `rounded-full shrink-0 ${ring ? "ring-2 ring-emerald-500" : ""} ${className}`
  if (av) {
    if (av.img) {
      // custom image avatar (VIP artwork); animated ones show their still frame until `animate` kicks in
      const shown = isAnimated ? (animate || tapping ? (playSrc ?? av.imgStill!) : av.imgStill!) : av.img
      // eslint-disable-next-line @next/next/no-img-element
      const imgEl = <img src={shown} alt={av.name} style={{ width: size, height: size }} className={`${base} object-cover ${av.id === "avatar_default" ? "dark:invert" : "bg-emerald-900/20"}`} />
      if (tapToPlay && isAnimated) {
        return (
          <button type="button" aria-label={`Play ${av.name}`} onClick={onTap} className="relative shrink-0 rounded-full active:scale-95 transition-transform" style={{ width: size, height: size }}>
            {imgEl}
          </button>
        )
      }
      return imgEl
    }
    return (
      <div
        aria-label={av.name}
        style={{ width: size, height: size, fontSize: size * 0.55, background: `linear-gradient(135deg, ${av.bg![0]}, ${av.bg![1]})` }}
        className={`${base} flex items-center justify-center leading-none select-none`}
      >
        <span aria-hidden>{av.emoji}</span>
      </div>
    )
  }
  if (photo) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={photo} alt="" referrerPolicy="no-referrer" style={{ width: size, height: size }} className={base} />
  }
  // default icon (no store avatar, no Google photo) — black line art, inverted in dark mode
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/default-avatar.png" alt="" style={{ width: size, height: size }} className={`${base} object-cover dark:invert`} />
}
