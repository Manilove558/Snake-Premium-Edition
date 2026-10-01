import type { StoreItem } from "./store"
import { shapeSvg } from "./shapes"

// Mini "game board" previews that are drawn exactly like the real canvas:
// rounded blocks, glowing head, body fading toward the tail, glowing food, fading trail dots.
const C = 12, COLS = 12, ROWS = 8
// tail -> head, on a 12x8 grid
const PATH: [number, number][] = [[3, 6], [4, 6], [5, 6], [5, 5], [5, 4], [6, 4], [7, 4], [8, 4], [8, 3], [8, 2], [9, 2], [10, 2]]
const SHORT: [number, number][] = [[3, 4], [4, 4], [5, 4], [6, 4]]

const rect = (x: number, y: number, rx: number, fill: string, op: number, glow?: string, blur = 3) =>
  `<rect x="${x * C + 1}" y="${y * C + 1}" width="${C - 2}" height="${C - 2}" rx="${rx}" fill="${fill}" fill-opacity="${op.toFixed(2)}"${glow ? ` style="filter:drop-shadow(0 0 ${blur}px ${glow})"` : ""}/>`

function snake(cells: [number, number][], it: StoreItem | null, dark: boolean): string {
  const head = [...cells].reverse() // index 0 = head, like the game
  return head.map(([x, y], i) => {
    const t = i / Math.max(head.length - 1, 1)
    const isHead = i === 0
    if (it && it.head) {
      const fill = isHead ? it.head : it.rainbow ? `hsl(${(i * 28) % 360} 90% 60%)` : i % 2 === 0 ? (it.a as string) : (it.b as string)
      return rect(x, y, isHead ? 4 : 3.2, fill, isHead ? 1 : 1 - t * 0.4, it.glow, isHead ? 4 : 2)
    }
    const col = dark ? "#3af08d" : "#17b76a"
    return rect(x, y, isHead ? 4 : 3.2, col, isHead ? 1 : 1 - t * (dark ? 0.55 : 0.5), isHead ? (dark ? "rgba(34,217,122,.9)" : "rgba(23,183,106,.6)") : undefined, 3)
  }).join("")
}

const berry = (cx: number, cy: number, r: number) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#ff5470" style="filter:drop-shadow(0 0 4px rgba(255,84,112,.9))"/>`

export function boardSvg(it: StoreItem, dark: boolean): string {
  const bg0 = dark ? "#111a25" : "#f3faf5", bg1 = dark ? "#0b0f14" : "#ffffff"
  const grid = dark ? "rgba(58,240,141,.10)" : "rgba(23,183,106,.13)"
  let g = ""
  for (let x = 1; x < COLS; x++) g += `<line x1="${x * C}" y1="0" x2="${x * C}" y2="${ROWS * C}"/>`
  for (let y = 1; y < ROWS; y++) g += `<line x1="0" y1="${y * C}" x2="${COLS * C}" y2="${y * C}"/>`
  let body = ""
  if (it.kind === "skin") body = snake(PATH, it.head ? it : null, dark) + berry(10 * C + C / 2, 5 * C + C / 2, 4.5)
  else if (it.kind === "trail") {
    const pal = it.palette || ["#999"]
    const dots = [[2, 6, 0.8, 5], [1, 6, 0.5, 4], [0, 6, 0.25, 3]].map(([x, y, a, r], i) => {
      const col = pal[i % pal.length]
      return shapeSvg(it.shape || "dot", (x as number) * C + C / 2, (y as number) * C + C / 2, r as number, `fill="${col}" fill-opacity="${a}" style="filter:drop-shadow(0 0 4px ${col})"`)
    }).join("")
    body = dots + snake(PATH, null, dark)
  } else if (it.kind === "food") {
    const cx = 9 * C + C / 2, cy = 4 * C + C / 2
    body = snake(SHORT, null, dark) + (it.palette ? shapeSvg(it.shape || "star", cx, cy, 10, `fill="${it.palette[0]}" stroke="${it.palette[1]}" stroke-width="1.5" style="filter:drop-shadow(0 0 4px ${it.palette[0]})"`) : berry(cx, cy, 8))
  } else if (it.kind === "vip") {
    body = `<path d="M46 66 L50 30 L64 48 L72 24 L80 48 L94 30 L98 66Z" fill="#f5b301" stroke="#fff3b0" stroke-width="2.5" stroke-linejoin="round" style="filter:drop-shadow(0 0 6px #f5b301)"/>` + snake(SHORT, null, dark).replace(/x="(\d+)"/g, (_, n) => `x="${+n - 36}"`).replace(/y="(\d+)"/g, (_, n) => `y="${+n + 20}"`)
  } else {
    body = `<path d="M60 26h24l8 12-20 30-20-30z" fill="#22d97a"/><path d="M52 38h40M64 26l8 42M80 26l-8 42" stroke="#053b1f" stroke-opacity=".5" fill="none"/>`
  }
  return `<svg viewBox="0 0 ${COLS * C} ${ROWS * C}" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="bgc" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${bg0}"/><stop offset="1" stop-color="${bg1}"/></linearGradient></defs><rect width="${COLS * C}" height="${ROWS * C}" fill="url(#bgc)"/><g stroke="${grid}" stroke-width="1">${g}</g>${body}</svg>`
}
