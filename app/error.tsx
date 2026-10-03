"use client"

// Next.js route-level boundary: any error that escapes the component boundaries lands here instead of a blank page.
export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="flex h-[100dvh] w-full items-center justify-center bg-[#f2f4f2] p-4 text-[#123321]">
      <div className="w-full max-w-sm rounded-2xl bg-white p-4 shadow-xl">
        <h1 className="text-base font-extrabold">Kuch gadbad ho gayi</h1>
        <pre className="mt-2 max-h-32 overflow-auto rounded-lg bg-black/5 p-2 text-[10px] whitespace-pre-wrap break-words">{String(error?.message || error).slice(0, 400)}</pre>
        <button onClick={() => reset()} className="mt-3 min-h-[44px] w-full rounded-xl bg-emerald-500 text-sm font-bold text-white">Dobara try karo</button>
      </div>
    </main>
  )
}
