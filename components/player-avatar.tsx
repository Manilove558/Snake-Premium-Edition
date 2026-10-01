"use client"
import { useEffect, useState } from "react"
import { User as UserIcon } from "lucide-react"
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
    if (!enabled || !src) { setUrl(null); return }
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
}: {
  photo?: string | null
  avatarId?: string | null
  vip?: boolean
  size?: number
  ring?: boolean
  className?: string
  /** play the avatar's GIF animation once (store avatar cards + profile views) */
  animate?: boolean
}) {
  const av = resolveAvatar(avatarId, vip)
  const isAnimated = !!av?.imgStill && !!av.img
  const playSrc = usePlayOnceSrc(av?.img, animate && isAnimated, `${avatarId}`)
  const base = `rounded-full shrink-0 ${ring ? "ring-2 ring-emerald-500" : ""} ${className}`
  if (av) {
    if (av.img) {
      // custom image avatar (VIP artwork); animated ones show their still frame until `animate` kicks in
      const shown = isAnimated ? (animate ? (playSrc ?? av.imgStill!) : av.imgStill!) : av.img
      // eslint-disable-next-line @next/next/no-img-element
      return <img src={shown} alt={av.name} style={{ width: size, height: size }} className={`${base} object-cover bg-emerald-900/20`} />
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
  return (
    <div style={{ width: size, height: size }} className={`${base} bg-emerald-500/20 flex items-center justify-center`}>
      <UserIcon className="text-emerald-500" style={{ width: size * 0.5, height: size * 0.5 }} />
    </div>
  )
}
