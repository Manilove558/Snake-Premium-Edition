import SnakeGame from "@/components/snake-game"

export default function Home() {
  return (
    <main className="flex min-h-[100dvh] flex-col items-center justify-center safe-area-px safe-area-pt safe-area-pb py-4 bg-[#f2f4f2] dark:bg-[#0b0f14] touch-none overflow-hidden transition-colors duration-300">
      <div className="w-full max-w-md mx-auto touch-none">
        <SnakeGame />
      </div>
    </main>
  )
}

