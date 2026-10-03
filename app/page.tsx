import SnakeGame from "@/components/snake-game"
import { ErrorBoundary } from "@/components/error-boundary"

export default function Home() {
  return (
    <main className="h-[100dvh] w-full overflow-hidden bg-[#f2f4f2] dark:bg-[#0b0f14] touch-none transition-colors duration-300">
      <ErrorBoundary name="Game">
        <SnakeGame />
      </ErrorBoundary>
    </main>
  )
}
