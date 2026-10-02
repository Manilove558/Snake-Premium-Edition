"use client"

/** Small "[BOT]" badge shown next to AI players in the lobby, leaderboards and results. */
export function BotTag({ className = "" }: { className?: string }) {
  return (
    <span
      title="AI bot"
      aria-label="AI bot"
      className={`mr-1 inline-block shrink-0 rounded border border-sky-500/40 bg-sky-500/15 px-1 py-px align-middle text-[8px] font-extrabold leading-none tracking-wide text-sky-500 ${className}`}
    >
      [BOT]
    </span>
  )
}
