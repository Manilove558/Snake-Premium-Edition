// Shapes used by trails (particles) and food. Same shape is drawn on the game canvas and in the store preview.
export type Shape = "dot" | "square" | "diamond" | "star" | "heart" | "ring"

/** Adds the shape's path to a canvas context. The caller fills / strokes it. */
export function shapePath(ctx: CanvasRenderingContext2D, shape: Shape, cx: number, cy: number, r: number) {
  ctx.beginPath()
  switch (shape) {
    case "square":
      ctx.rect(cx - r * 0.85, cy - r * 0.85, r * 1.7, r * 1.7)
      break
    case "diamond":
      ctx.moveTo(cx, cy - r * 1.1)
      ctx.lineTo(cx + r * 0.85, cy)
      ctx.lineTo(cx, cy + r * 1.1)
      ctx.lineTo(cx - r * 0.85, cy)
      ctx.closePath()
      break
    case "star":
      for (let k = 0; k < 10; k++) {
        const rr = k % 2 === 0 ? r : r * 0.45
        const a = -Math.PI / 2 + (k * Math.PI) / 5
        ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr)
      }
      ctx.closePath()
      break
    case "heart":
      ctx.moveTo(cx, cy + r * 0.9)
      ctx.bezierCurveTo(cx + r * 1.4, cy - r * 0.2, cx + r * 0.6, cy - r * 1.2, cx, cy - r * 0.4)
      ctx.bezierCurveTo(cx - r * 0.6, cy - r * 1.2, cx - r * 1.4, cy - r * 0.2, cx, cy + r * 0.9)
      ctx.closePath()
      break
    case "ring":
      ctx.arc(cx, cy, r, 0, Math.PI * 2)
      ctx.moveTo(cx + r * 0.45, cy)
      ctx.arc(cx, cy, r * 0.45, 0, Math.PI * 2, true) // counter-clockwise → hole
      break
    default:
      ctx.arc(cx, cy, r, 0, Math.PI * 2)
  }
}

const f = (n: number) => n.toFixed(1)

/** Same shape as an SVG element string. `attrs` carries fill / stroke / style. */
export function shapeSvg(shape: Shape, cx: number, cy: number, r: number, attrs: string): string {
  switch (shape) {
    case "square":
      return `<rect x="${f(cx - r * 0.85)}" y="${f(cy - r * 0.85)}" width="${f(r * 1.7)}" height="${f(r * 1.7)}" rx="1.5" ${attrs}/>`
    case "diamond":
      return `<polygon points="${f(cx)},${f(cy - r * 1.1)} ${f(cx + r * 0.85)},${f(cy)} ${f(cx)},${f(cy + r * 1.1)} ${f(cx - r * 0.85)},${f(cy)}" stroke-linejoin="round" ${attrs}/>`
    case "star": {
      let pts = ""
      for (let k = 0; k < 10; k++) {
        const rr = k % 2 === 0 ? r : r * 0.45
        const a = -Math.PI / 2 + (k * Math.PI) / 5
        pts += `${f(cx + Math.cos(a) * rr)},${f(cy + Math.sin(a) * rr)} `
      }
      return `<polygon points="${pts}" stroke-linejoin="round" ${attrs}/>`
    }
    case "heart":
      return `<path d="M${f(cx)} ${f(cy + r * 0.9)} C${f(cx + r * 1.4)} ${f(cy - r * 0.2)} ${f(cx + r * 0.6)} ${f(cy - r * 1.2)} ${f(cx)} ${f(cy - r * 0.4)} C${f(cx - r * 0.6)} ${f(cy - r * 1.2)} ${f(cx - r * 1.4)} ${f(cy - r * 0.2)} ${f(cx)} ${f(cy + r * 0.9)}Z" stroke-linejoin="round" ${attrs}/>`
    case "ring": {
      const q = r * 0.45
      return `<path fill-rule="evenodd" d="M${f(cx - r)} ${f(cy)} a${f(r)} ${f(r)} 0 1 0 ${f(r * 2)} 0 a${f(r)} ${f(r)} 0 1 0 ${f(-r * 2)} 0Z M${f(cx - q)} ${f(cy)} a${f(q)} ${f(q)} 0 1 0 ${f(q * 2)} 0 a${f(q)} ${f(q)} 0 1 0 ${f(-q * 2)} 0Z" ${attrs}/>`
    }
    default:
      return `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}" ${attrs}/>`
  }
}
