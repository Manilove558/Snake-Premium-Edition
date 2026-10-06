// server/bots.ts — AI bots that live ON THE SERVER.
//
// A bot is an ordinary snake of the authoritative engine. Its brain (lib/bot-ai.ts, the same pure
// BotBrain the old host-browser runner used) is asked for a turn right before the snake moves and the
// answer goes through the SAME GameEngine.setDirection() every human input uses — so a bot can never
// do anything a player could not, and nobody's browser simulates anything any more.
//
// This file is pure: no sockets, no timers, no Date.now(). RoomManager calls think() once per tick.
import { BotBrain, makeBotId, pickBotNames, type BotSelf } from "../lib/bot-ai"
import { mulberry32 } from "../lib/br/zone"
import { PLAYER_COLORS, botFillCount, dirFromVector, type BotLevel, type GameMode } from "../shared/snake-protocol"
import type { GameEngine } from "./engine"

export interface BotSpec {
  id: string
  name: string
  color: string
  level: BotLevel
  joinedAt: number
}

/**
 * Bots that would join a room right now: they fill the empty slots up to the mode's fill target
 * (classic 4, royale 8). Names are unique in the room, colours are the free ones, and every bot sits
 * AFTER the humans in the seat order (joinedAt).
 */
export function planBots(opts: {
  mode: GameMode
  level: BotLevel
  humanNames: string[]
  humanColors: string[]
  humanCount: number
  lastJoinedAt: number
  rng?: () => number
}): BotSpec[] {
  const n = botFillCount(opts.mode, opts.humanCount)
  if (n <= 0) return []
  const rng = opts.rng ?? Math.random
  const names = pickBotNames(n, new Set(opts.humanNames), rng)
  const freeColors = PLAYER_COLORS.filter((c) => !opts.humanColors.includes(c))
  const out: BotSpec[] = []
  for (let i = 0; i < n; i++) {
    out.push({
      id: makeBotId(),
      name: names[i],
      color: freeColors[i % Math.max(1, freeColors.length)] ?? PLAYER_COLORS[(opts.humanCount + i) % PLAYER_COLORS.length],
      level: opts.level,
      joinedAt: opts.lastJoinedAt + 1 + i,
    })
  }
  return out
}

/** Drives all the bots of ONE running match. */
export class BotController {
  private readonly brains = new Map<string, BotBrain>()
  /** per-bot MOVE_INPUT counter (the engine drops stale / duplicate seq numbers) */
  private readonly seq = new Map<string, number>()

  constructor(bots: { id: string; level: BotLevel }[], seed: number) {
    bots.forEach((b, i) => this.brains.set(b.id, new BotBrain(b.level, mulberry32((seed ^ (0x9e3779b9 * (i + 1))) >>> 0))))
  }

  get ids(): string[] {
    return [...this.brains.keys()]
  }

  /** Decide the next turn of every bot that is about to move. Call right BEFORE engine.tick(now). */
  think(engine: GameEngine, now: number): void {
    if (this.brains.size === 0 || engine.isOver || now < engine.startAt) return
    const due = engine.dueToMove().filter((id) => this.brains.has(id))
    if (due.length === 0) return
    const world = engine.botWorld(now)
    for (const id of due) {
      const view = engine.snakeCells(id)
      const brain = this.brains.get(id)
      if (!view || !brain) continue
      const self: BotSelf = { id, seg: view.seg, dx: dirDx(view.dir), dy: dirDy(view.dir), growth: 0 }
      let turn
      try {
        turn = brain.decide(self, world)
      } catch {
        continue // a brain bug must never take the room down: the bot just keeps its heading this step
      }
      const dir = dirFromVector(turn.x, turn.y)
      if (!dir) continue
      const next = (this.seq.get(id) ?? 0) + 1
      this.seq.set(id, next)
      engine.setDirection(id, dir, next)
    }
  }
}

const dirDx = (d: string) => (d === "LEFT" ? -1 : d === "RIGHT" ? 1 : 0)
const dirDy = (d: string) => (d === "UP" ? -1 : d === "DOWN" ? 1 : 0)
