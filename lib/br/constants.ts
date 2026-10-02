// lib/br/constants.ts — tuning values for "Snake Battle Royale" (pure data, no Firebase / React)

/** World size in cells (120 x 120). The canvas keeps its fixed pixel size — only the camera window moves. */
export const BR_GRID = 120
/** Cells visible in the camera window (same 20 x 20 as the classic arena, so the canvas size is unchanged). */
export const BR_VIEW_CELLS = 20
/** Pixel size of one cell on the (fixed-size) canvas. */
export const BR_CELL = 18

export const BR_MIN_PLAYERS = 4
export const BR_MAX_PLAYERS = 8

/** Grid tick (same pace as the classic battle). */
export const BR_TICK_MS = 150

// ---- Shrinking safe zone ----------------------------------------------------
/** A new shrink starts every 30 s. */
export const ZONE_INTERVAL_MS = 30_000
/** The warning banner / target outline shows this long before a shrink starts. */
export const ZONE_WARNING_MS = 5_000
/** How long the border takes to travel from the old box to the new one. */
export const ZONE_SHRINK_MS = 8_000
/** Side length (in cells) of the safe zone after each shrink. Index 0 = start (whole map). */
export const ZONE_SIZES = [BR_GRID, 84, 60, 40, 26, 16, 10, 6] as const
/** A snake head outside the zone dies after this long. */
export const ZONE_GRACE_MS = 3_000
/** While outside, the snake also loses its tail every tick (never below BR_MIN_LENGTH). */
export const ZONE_TAIL_DAMAGE = true
export const BR_MIN_LENGTH = 3

// ---- Food -------------------------------------------------------------------
/** Foods kept on the map by the host (spawned inside the current / next zone). */
export const BR_FOOD_TARGET = 70
/** Host top-up interval. */
export const BR_FOOD_REFILL_MS = 1_000
/** A dead snake drops one food every N segments. */
export const BR_DROP_EVERY = 3

export const BR_START_LENGTH = 4
export const BR_SPAWN_RING_RADIUS = 44
