// lib/br/render.ts — canvas drawing for the big map: camera window (ctx.translate), danger zone, minimap.
// Pure drawing helpers: no React, no Firebase.
import { BR_CELL, BR_GRID, BR_VIEW_CELLS } from "./constants"
import type { Camera } from "./camera"
import type { ZoneBox, ZoneState } from "./zone"
import type { Cell } from "./interpolation"

export interface DrawSnake {
  id: string
  color: string
  seg: Cell[]
  mine: boolean
}

export interface BrFrame {
  camera: Camera
  zone: ZoneState
  foods: Cell[]
  snakes: DrawSnake[]
  /** local clock in ms (drives pulsing effects) */
  now: number
  darkMode: boolean
  grid: boolean
  /** show a faint outline around the head the camera follows (spectating) */
  followId: string | null
}

const SIZE = BR_VIEW_CELLS * BR_CELL // canvas is square: 360 x 360

/** Main entry: draws the whole frame. The canvas keeps its fixed pixel size. */
export function drawBrFrame(ctx: CanvasRenderingContext2D, f: BrFrame) {
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, SIZE, SIZE)

  // void behind the world (visible only if the camera ever shows past the edge)
  ctx.fillStyle = f.darkMode ? "#05080b" : "#c9d6c4"
  ctx.fillRect(0, 0, SIZE, SIZE)

  // ---- world space: camera = translate -----------------------------------
  ctx.save()
  const off = f.camera.offsetPx
  ctx.translate(Math.round(off.x), Math.round(off.y))

  const x0 = Math.max(0, Math.floor(f.camera.originX) - 1)
  const y0 = Math.max(0, Math.floor(f.camera.originY) - 1)
  const x1 = Math.min(BR_GRID, Math.ceil(f.camera.originX + BR_VIEW_CELLS) + 1)
  const y1 = Math.min(BR_GRID, Math.ceil(f.camera.originY + BR_VIEW_CELLS) + 1)

  // ground
  ctx.fillStyle = f.darkMode ? "#101820" : "#eef4ea"
  ctx.fillRect(0, 0, BR_GRID * BR_CELL, BR_GRID * BR_CELL)

  // grid lines — only the visible part (cheap even on 120 x 120)
  if (f.grid) {
    ctx.strokeStyle = f.darkMode ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.06)"
    ctx.lineWidth = 1
    ctx.beginPath()
    for (let x = x0; x <= x1; x++) {
      ctx.moveTo(x * BR_CELL, y0 * BR_CELL)
      ctx.lineTo(x * BR_CELL, y1 * BR_CELL)
    }
    for (let y = y0; y <= y1; y++) {
      ctx.moveTo(x0 * BR_CELL, y * BR_CELL)
      ctx.lineTo(x1 * BR_CELL, y * BR_CELL)
    }
    ctx.stroke()
  }

  // foods (culled to the window)
  ctx.save()
  ctx.shadowColor = "rgba(255,80,120,0.9)"
  ctx.shadowBlur = 8
  ctx.fillStyle = "#ff5078"
  for (const fd of f.foods) {
    if (fd.x < x0 - 1 || fd.x > x1 || fd.y < y0 - 1 || fd.y > y1) continue
    ctx.beginPath()
    ctx.arc(fd.x * BR_CELL + BR_CELL / 2, fd.y * BR_CELL + BR_CELL / 2, BR_CELL / 2 - 3, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()

  // snakes (others first, mine on top)
  const ordered = [...f.snakes].sort((a, b) => Number(a.mine) - Number(b.mine))
  for (const s of ordered) drawSnake(ctx, s, s.mine || s.id === f.followId)

  // world border (the real, deadly wall)
  ctx.strokeStyle = f.darkMode ? "#3b5a49" : "#7f9d8b"
  ctx.lineWidth = 6
  ctx.strokeRect(-3, -3, BR_GRID * BR_CELL + 6, BR_GRID * BR_CELL + 6)

  // danger zone + borders
  drawDangerZone(ctx, f.zone, f.now)
  ctx.restore()
}

function drawSnake(ctx: CanvasRenderingContext2D, s: DrawSnake, glow: boolean) {
  const n = s.seg.length
  for (let i = n - 1; i >= 0; i--) {
    const c = s.seg[i]
    ctx.save()
    if (glow && i === 0) {
      ctx.shadowColor = s.color
      ctx.shadowBlur = 12
    }
    ctx.fillStyle = s.color
    ctx.globalAlpha = i === 0 ? 1 : Math.max(0.45, 1 - (i / Math.max(n, 1)) * 0.5)
    ctx.beginPath()
    ctx.roundRect(c.x * BR_CELL + 1, c.y * BR_CELL + 1, BR_CELL - 2, BR_CELL - 2, 4)
    ctx.fill()
    ctx.restore()
  }
  // eyes on the head
  if (n > 1) {
    const h = s.seg[0]
    const nx = s.seg[1]
    const dx = Math.sign(h.x - nx.x)
    const dy = Math.sign(h.y - nx.y)
    ctx.fillStyle = "#fff"
    const cx = h.x * BR_CELL + BR_CELL / 2 + dx * 3
    const cy = h.y * BR_CELL + BR_CELL / 2 + dy * 3
    const px = dy !== 0 ? 3.5 : 0
    const py = dx !== 0 ? 3.5 : 0
    for (const sgn of [-1, 1]) {
      ctx.beginPath()
      ctx.arc(cx + px * sgn, cy + py * sgn, 1.8, 0, Math.PI * 2)
      ctx.fill()
    }
  }
}

/** Translucent red everywhere OUTSIDE the safe box (world space), plus the pulsing border + next-zone preview. */
function drawDangerZone(ctx: CanvasRenderingContext2D, zone: ZoneState, now: number) {
  const b = zone.box
  const px = (v: number) => v * BR_CELL
  const left = px(b.minX)
  const top = px(b.minY)
  const w = px(b.maxX - b.minX + 1)
  const h = px(b.maxY - b.minY + 1)
  const W = BR_GRID * BR_CELL

  // evenodd: big rect minus safe rect = only the outside gets tinted
  ctx.save()
  ctx.beginPath()
  ctx.rect(0, 0, W, W)
  ctx.rect(left, top, w, h)
  ctx.fillStyle = zone.warning ? "rgba(255,40,40,0.34)" : "rgba(255,40,40,0.26)"
  ctx.fill("evenodd")
  ctx.restore()

  // safe-zone border
  const pulse = 0.55 + 0.45 * Math.sin(now / (zone.shrinking ? 120 : 380))
  ctx.save()
  ctx.strokeStyle = `rgba(255,70,70,${0.55 + 0.45 * pulse})`
  ctx.lineWidth = 3
  ctx.shadowColor = "rgba(255,0,0,0.8)"
  ctx.shadowBlur = 10
  ctx.strokeRect(left, top, w, h)
  ctx.restore()

  // next safe zone (shown during the 5 s warning)
  if (zone.warning && zone.target) {
    const t = zone.target
    ctx.save()
    ctx.setLineDash([10, 8])
    ctx.lineDashOffset = -(now / 40) % 18
    ctx.strokeStyle = "rgba(255,255,255,0.95)"
    ctx.lineWidth = 3
    ctx.strokeRect(px(t.minX), px(t.minY), px(t.maxX - t.minX + 1), px(t.maxY - t.minY + 1))
    ctx.restore()
  }
}

// ---------------------------------------------------------------------------
// Minimap (screen space, top-right of the fixed canvas)
// ---------------------------------------------------------------------------
export interface MinimapDot {
  color: string
  x: number
  y: number
  mine: boolean
}

export function drawMinimap(
  ctx: CanvasRenderingContext2D,
  opts: { camera: Camera; zone: ZoneState; dots: MinimapDot[]; now: number; size?: number; margin?: number },
) {
  const size = opts.size ?? 92
  const margin = opts.margin ?? 6
  const ox = SIZE - size - margin
  const oy = margin
  const k = size / BR_GRID
  const mx = (v: number) => ox + v * k
  const my = (v: number) => oy + v * k
  const z = opts.zone

  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)

  // frame + background
  ctx.fillStyle = "rgba(8,14,18,0.72)"
  ctx.fillRect(ox - 2, oy - 2, size + 4, size + 4)
  ctx.fillStyle = "rgba(60,110,80,0.55)"
  ctx.fillRect(ox, oy, size, size)

  // danger zone (outside the safe box)
  ctx.beginPath()
  ctx.rect(ox, oy, size, size)
  ctx.rect(mx(z.box.minX), my(z.box.minY), (z.box.maxX - z.box.minX + 1) * k, (z.box.maxY - z.box.minY + 1) * k)
  ctx.fillStyle = "rgba(255,40,40,0.5)"
  ctx.fill("evenodd")

  // zone border
  ctx.strokeStyle = "rgba(255,90,90,0.95)"
  ctx.lineWidth = 1.2
  ctx.strokeRect(mx(z.box.minX), my(z.box.minY), (z.box.maxX - z.box.minX + 1) * k, (z.box.maxY - z.box.minY + 1) * k)

  // next zone (dashed, only while warning)
  if (z.warning && z.target) {
    ctx.setLineDash([3, 2])
    ctx.strokeStyle = "#fff"
    ctx.strokeRect(mx(z.target.minX), my(z.target.minY), (z.target.maxX - z.target.minX + 1) * k, (z.target.maxY - z.target.minY + 1) * k)
    ctx.setLineDash([])
  }

  // camera window
  ctx.strokeStyle = "rgba(255,255,255,0.55)"
  ctx.lineWidth = 1
  ctx.strokeRect(mx(opts.camera.originX), my(opts.camera.originY), BR_VIEW_CELLS * k, BR_VIEW_CELLS * k)

  // players
  for (const d of opts.dots) {
    const r = d.mine ? 3 : 2.3
    ctx.beginPath()
    ctx.arc(mx(d.x + 0.5), my(d.y + 0.5), r, 0, Math.PI * 2)
    ctx.fillStyle = d.color
    ctx.fill()
    if (d.mine) {
      ctx.strokeStyle = "#fff"
      ctx.lineWidth = 1.3
      ctx.stroke()
    }
  }
  ctx.restore()
}

/** Is (x, y) cell-space inside a box (convenience for HUD code). */
export const boxContains = (b: ZoneBox, x: number, y: number) => x >= b.minX - 0.5 && x <= b.maxX + 0.5 && y >= b.minY - 0.5 && y <= b.maxY + 0.5
