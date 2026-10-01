// ---------------------------------------------------------------------------
// Multiplayer battle maps (20 x 20 arena).
// Pure data — no Firebase — so both the lobby (preview tiles) and the battle
// (walls / portals) can import it.
// Every map keeps the 8 spawn points (see BATTLE_SPAWNS in multiplayer.ts) and
// the 4 cells in front of each spawn free, so nobody dies on the first tick.
// ---------------------------------------------------------------------------

export interface MapCell {
  x: number
  y: number
}

export interface BattleMap {
  id: string
  name: string
  walls: MapCell[]
  /** Two-way portal pairs: entering one end comes out of the other. */
  portals: [MapCell, MapCell][]
}

export const BATTLE_GRID = 20

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i)
const block = (x: number, y: number): MapCell[] => [
  { x, y },
  { x: x + 1, y },
  { x, y: y + 1 },
  { x: x + 1, y: y + 1 },
]

const WALLS_MAP: MapCell[] = [
  ...range(5, 14).map((x) => ({ x, y: 7 })),
  ...range(5, 14).map((x) => ({ x, y: 12 })),
]

const BOXES_MAP: MapCell[] = [...block(5, 5), ...block(14, 5), ...block(5, 14), ...block(14, 14), ...block(9, 9)]

const CROSS_MAP: MapCell[] = range(6, 13).flatMap((i) => [
  { x: i, y: i },
  { x: 19 - i, y: i },
])

// Square ring with a door in the middle of every side
const FRAME_MAP: MapCell[] = [
  ...range(6, 13)
    .filter((i) => i !== 9 && i !== 10)
    .flatMap((i) => [
      { x: i, y: 6 },
      { x: i, y: 13 },
      { x: 6, y: i },
      { x: 13, y: i },
    ]),
  // corners of the ring
  { x: 6, y: 6 },
  { x: 13, y: 6 },
  { x: 6, y: 13 },
  { x: 13, y: 13 },
].filter((c, i, arr) => arr.findIndex((o) => o.x === c.x && o.y === c.y) === i)

const LANES_MAP: MapCell[] = [...range(5, 14).map((y) => ({ x: 7, y })), ...range(5, 14).map((y) => ({ x: 12, y }))]

export const BATTLE_MAPS: BattleMap[] = [
  { id: "classic", name: "Classic", walls: [], portals: [] },
  { id: "walls", name: "Walls", walls: WALLS_MAP, portals: [] },
  { id: "boxes", name: "Boxes", walls: BOXES_MAP, portals: [] },
  { id: "cross", name: "Cross", walls: CROSS_MAP, portals: [] },
  { id: "frame", name: "Frame", walls: FRAME_MAP, portals: [] },
  { id: "lanes", name: "Lanes", walls: LANES_MAP, portals: [] },
  {
    id: "portals",
    name: "Portals",
    walls: [],
    portals: [
      [
        { x: 5, y: 5 },
        { x: 14, y: 14 },
      ],
      [
        { x: 14, y: 5 },
        { x: 5, y: 14 },
      ],
    ],
  },
]

export function getBattleMap(id?: string | null): BattleMap {
  return BATTLE_MAPS.find((m) => m.id === id) ?? BATTLE_MAPS[0]
}

/** "x,y" keys of every wall and portal cell (cells food must never spawn on). */
export function blockedCellKeys(map: BattleMap): Set<string> {
  const set = new Set<string>()
  for (const w of map.walls) set.add(`${w.x},${w.y}`)
  for (const [a, b] of map.portals) {
    set.add(`${a.x},${a.y}`)
    set.add(`${b.x},${b.y}`)
  }
  return set
}
