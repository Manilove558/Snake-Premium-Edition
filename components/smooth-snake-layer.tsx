"use client"

// components/smooth-snake-layer.tsx — single-player "Smooth movement" (Battle Royale style).
//
// A transparent canvas laid over the board that draws ONLY the snake, 60 fps, gliding between the
// grid cells the game loop produces. The main canvas keeps drawing everything else (food, walls,
// trail, portals, HUD) exactly as before and just skips the snake while this layer is active.
import { useEffect, useRef } from "react"
import { SnakeInterpolator, type Cell } from "@/lib/br/interpolation"
import { drawSnakeEyes, eyeDirection, pushGlide } from "@/lib/smooth-move"

interface SkinLook {
  head?: string
  a?: string
  b?: string
  glow?: string
  rainbow?: boolean
}

interface Props {
  snake: readonly Cell[]
  /** false = draw nothing (the main canvas draws the snake: preview, game over, smooth off) */
  active: boolean
  /** game tick length in ms (the current snake speed) */
  tickMs: number
  cell: number
  cols: number
  rows: number
  skin: SkinLook
  graceActive: boolean
  darkMode: boolean
}

export default function SmoothSnakeLayer({ snake, active, tickMs, cell, cols, rows, skin, graceActive, darkMode }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const interp = useRef(new SnakeInterpolator())
  const lastDir = useRef<Cell>({ x: 1, y: 0 })
  const live = useRef({ active, tickMs, cell, skin, graceActive, darkMode })
  live.current = { active, tickMs, cell, skin, graceActive, darkMode }

  // every new game tick = a new target for the glide
  useEffect(() => {
    if (!active) {
      interp.current.clear()
      return
    }
    pushGlide(interp.current, snake.map((s) => ({ x: s.x, y: s.y })), performance.now())
  }, [snake, active])

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext("2d")
    if (!canvas || !ctx) return
    let raf = 0
    const frame = () => {
      raf = requestAnimationFrame(frame)
      const { active: on, tickMs: tick, cell: c, skin: sk, graceActive: grace, darkMode: dark } = live.current
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      if (!on) return
      const segs = interp.current.sample(performance.now(), Math.max(16, tick))
      const n = segs.length
      // tail -> head so the glowing head is always on top
      for (let i = n - 1; i >= 0; i--) {
        const isHead = i === 0
        const t = i / Math.max(n - 1, 1)
        ctx.save()
        if (sk.head && !grace) {
          ctx.shadowColor = sk.glow || sk.head
          ctx.shadowBlur = isHead ? 10 : 4
          ctx.fillStyle = isHead ? sk.head : sk.rainbow ? `hsl(${(i * 28) % 360} 90% 60%)` : i % 2 === 0 ? (sk.a as string) : (sk.b as string)
          ctx.globalAlpha = isHead ? 1 : 1 - t * 0.4
        } else if (isHead) {
          ctx.shadowColor = grace ? "rgba(255, 159, 26, 0.9)" : dark ? "rgba(34, 217, 122, 0.9)" : "rgba(23, 183, 106, 0.6)"
          ctx.shadowBlur = 8
          ctx.fillStyle = grace ? "#ff9f1a" : dark ? "#3af08d" : "#17b76a"
        } else {
          ctx.fillStyle = grace ? `rgba(255, 159, 26, ${1 - t * 0.55})` : dark ? `rgba(58, 240, 141, ${1 - t * 0.55})` : `rgba(23, 183, 106, ${1 - t * 0.5})`
        }
        ctx.beginPath()
        ctx.roundRect(segs[i].x * c + 1, segs[i].y * c + 1, c - 2, c - 2, isHead ? 5 : 4)
        ctx.fill()
        ctx.restore()
      }
      // eyes on the head, looking where the snake is heading
      if (n > 1) {
        lastDir.current = eyeDirection(segs[0], segs[1], lastDir.current)
        drawSnakeEyes(ctx, segs[0].x, segs[0].y, lastDir.current, c)
      }
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [])

  return <canvas ref={canvasRef} width={cols * cell} height={rows * cell} className="pointer-events-none absolute inset-0 block h-full w-full" aria-hidden />
}
