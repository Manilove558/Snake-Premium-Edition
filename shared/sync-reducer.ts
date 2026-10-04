// shared/sync-reducer.ts — applies GAME_STATE_SYNC messages to the client's picture of the match.
//
// Lives in shared/ (not in the hook) so that the self-test can prove, tick by tick, that
// "snapshot + all deltas" always equals the server's real state. The hook uses the very same code.
import type { Dir, FoodNet, GameStateSync, Point, SnakeNet } from "./snake-protocol"

/** A snake as the client keeps it (flat seg array decoded into points). */
export interface SnakeView {
  id: string
  /** head first */
  cells: Point[]
  dir: Dir
  alive: boolean
  score: number
  kills: number
  speedUntil: number
  shieldUntil: number
  stepMs: number
  seq: number
}

/** Mutable on purpose: the render loop reads it every frame without going through React. */
export interface GameView {
  tick: number
  serverTime: number
  aliveCount: number
  snakes: Map<string, SnakeView>
  foods: Map<number, FoodNet>
}

export const createGameView = (): GameView => ({ tick: 0, serverTime: 0, aliveCount: 0, snakes: new Map(), foods: new Map() })

/** [x0,y0,x1,y1,...] -> [{x,y},...] */
export function decodeSeg(flat: readonly number[]): Point[] {
  const out: Point[] = []
  for (let i = 0; i + 1 < flat.length; i += 2) out.push({ x: flat[i], y: flat[i + 1] })
  return out
}

export function decodeSnake(s: SnakeNet): SnakeView {
  return {
    id: s.id,
    cells: decodeSeg(s.seg),
    dir: s.dir,
    alive: s.alive,
    score: s.score,
    kills: s.kills,
    speedUntil: s.speedUntil,
    shieldUntil: s.shieldUntil,
    stepMs: s.stepMs,
    seq: s.seq,
  }
}

/**
 * Merge one sync message into `view` (in place).
 * @returns ids of the snakes whose cells were (re)written — feed those to the interpolators.
 */
export function applyGameSync(view: GameView, sync: GameStateSync): string[] {
  if (sync.full) {
    view.snakes.clear()
    view.foods.clear()
  }
  const changed: string[] = []
  for (const s of sync.snakes) {
    view.snakes.set(s.id, decodeSnake(s))
    changed.push(s.id)
  }
  for (const id of sync.foodRemove) view.foods.delete(id)
  for (const f of sync.foodAdd) view.foods.set(f.id, f)
  view.tick = sync.tick
  view.serverTime = sync.t
  view.aliveCount = sync.aliveCount
  return changed
}
