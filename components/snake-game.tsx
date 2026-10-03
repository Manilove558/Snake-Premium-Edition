"use client"

import { useEffect, useState, useRef } from "react"
import { createPortal } from "react-dom"
import { ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Pause, Play, X, Settings, Trophy, Map as MapIcon, Shuffle, Grid3x3, Users, LogOut } from "lucide-react"
// Import the sound manager at the top of the file
import { useSoundManager } from "./sound-manager"
import MultiplayerLobby, { NO_LOBBY_ROOM, type LobbyActions, type LobbyRoomInfo } from "./multiplayer-lobby"
import { SnakeStore } from "./snake-store"
import { SnakeVault } from "./snake-vault"
import { SessionGuard } from "./session-guard"
import { AdminButton } from "./admin-panel"
import { MailboxButton } from "./mailbox"
import { useAuthUser } from "@/lib/auth"
import { subscribeGrants, consumeGrant, applyGrant } from "@/lib/grants"
import { SnakeProfile } from "./snake-profile"
import { SnakeFriends } from "./snake-friends"
import { useStore, equippedItem, loadCatalog, earnCoins, earnGems, setBest } from "@/lib/store"
import { shapePath } from "@/lib/shapes"
import BattleRouter from "./battle-router" // picks classic MultiplayerBattle or RoyaleBattle from the room mode
import { RankPopup, MapPopup, SettingsPopup } from "./home-popups"
import SmoothSnakeLayer from "./smooth-snake-layer"
import { loadSmoothMove, saveSmoothMove } from "@/lib/smooth-move"
import { RotateHint } from "./rotate-hint"
import { PanelHostContext, type ViewId } from "./panel-host"

// Left strip on the home screen keeps room for future buttons. Set to false to hide the dashed placeholders.
const SHOW_FUTURE_STRIP = true
import InvitePopup from "./invite-popup"
import { joinRoom, leaveRoom } from "@/lib/multiplayer"
import { useDisplayName } from "@/lib/profile-name"
import { isVip } from "@/lib/store"
import { removeRoomInvite, type RoomInvite } from "@/lib/invites"

// Game constants
const CELL_SIZE = 15
const GRID_WIDTH = 20
const GRID_HEIGHT = 20
const INITIAL_SPEED = 150
const MAX_CAMPAIGN_LEVEL = 100

// Game modes
const GAME_MODES = {
  CLASSIC: "classic",
  SPEED: "speed",
  WALLS: "walls",
  MAZE: "maze",
  BOX: "box",
  TUNNEL: "tunnel",
  MILL: "mill",
  APARTMENT: "apartment",
  CAMPAIGN: "campaign",
  ZIGZAG: "zigzag",
  PORTAL: "portal",
  REVERSE: "reverse",
  MULTIPLAYER: "multiplayer",
}

// Direction constants
const DIRECTIONS = {
  UP: { x: 0, y: -1 },
  DOWN: { x: 0, y: 1 },
  LEFT: { x: -1, y: 0 },
  RIGHT: { x: 1, y: 0 },
}

// Update the INITIAL_SNAKE position to avoid immediate death in maze mode
const INITIAL_SNAKE = [
  { x: 3, y: 3 },
  { x: 2, y: 3 },
  { x: 1, y: 3 },
]

// Wall patterns for wall mode
const WALL_PATTERNS = [
  // Horizontal walls
  Array.from({ length: GRID_WIDTH - 8 }, (_, i) => ({ x: i + 4, y: 5 })),
  Array.from({ length: GRID_WIDTH - 8 }, (_, i) => ({ x: i + 4, y: 15 })),
]

// Maze patterns
const MAZE_PATTERNS = [
  // Cross pattern
  Array.from({ length: GRID_WIDTH }, (_, i) => ({ x: i, y: GRID_HEIGHT / 2 })).filter(
    (pos) => pos.x !== GRID_WIDTH / 2 - 1 && pos.x !== GRID_WIDTH / 2 && pos.x !== GRID_WIDTH / 2 + 1,
  ),
  Array.from({ length: GRID_HEIGHT }, (_, i) => ({ x: GRID_WIDTH / 2, y: i })).filter(
    (pos) => pos.y !== GRID_HEIGHT / 2 - 1 && pos.y !== GRID_HEIGHT / 2 && pos.y !== GRID_HEIGHT / 2 + 1,
  ),

  // Corner blocks
  Array.from({ length: 5 }, (_, i) => ({ x: i, y: i })),
  Array.from({ length: 5 }, (_, i) => ({ x: GRID_WIDTH - i - 1, y: i })),
  Array.from({ length: 5 }, (_, i) => ({ x: i, y: GRID_HEIGHT - i - 1 })),
  Array.from({ length: 5 }, (_, i) => ({ x: GRID_WIDTH - i - 1, y: GRID_HEIGHT - i - 1 })),
]

// Box patterns
const BOX_PATTERNS = [
  // Small boxes scattered around
  [
    { x: 5, y: 5 },
    { x: 6, y: 5 },
    { x: 5, y: 6 },
    { x: 6, y: 6 },
    { x: 14, y: 5 },
    { x: 15, y: 5 },
    { x: 14, y: 6 },
    { x: 15, y: 6 },
    { x: 5, y: 14 },
    { x: 6, y: 14 },
    { x: 5, y: 15 },
    { x: 6, y: 15 },
    { x: 14, y: 14 },
    { x: 15, y: 14 },
    { x: 14, y: 15 },
    { x: 15, y: 15 },
    { x: 9, y: 9 },
    { x: 10, y: 9 },
    { x: 9, y: 10 },
    { x: 10, y: 10 },
  ],
]

// Completely redesigned tunnel patterns with much more space to move
const TUNNEL_PATTERNS = [
  // Create a tunnel-like structure with more space
  [
    // Top wall with opening
    ...Array.from({ length: 8 }, (_, i) => ({ x: i, y: 5 })),
    ...Array.from({ length: 8 }, (_, i) => ({ x: i + 12, y: 5 })),

    // Bottom wall with opening
    ...Array.from({ length: 8 }, (_, i) => ({ x: i, y: 15 })),
    ...Array.from({ length: 8 }, (_, i) => ({ x: i + 12, y: 15 })),

    // Left wall with opening
    ...Array.from({ length: 4 }, (_, i) => ({ x: 5, y: i + 1 })),
    ...Array.from({ length: 4 }, (_, i) => ({ x: 5, y: i + 10 })),

    // Right wall with opening
    ...Array.from({ length: 4 }, (_, i) => ({ x: 15, y: i + 1 })),
    ...Array.from({ length: 4 }, (_, i) => ({ x: 15, y: i + 10 })),

    // Center obstacle
    { x: 10, y: 10 },
  ],
]

// Mill patterns (rotating obstacles)
const MILL_PATTERNS = [
  // Center point
  { x: GRID_WIDTH / 2, y: GRID_HEIGHT / 2 },

  // Initial mill arms (will be rotated during gameplay)
  ...Array.from({ length: 6 }, (_, i) => ({ x: GRID_WIDTH / 2 + i + 1, y: GRID_HEIGHT / 2 })),
  ...Array.from({ length: 6 }, (_, i) => ({ x: GRID_WIDTH / 2, y: GRID_HEIGHT / 2 + i + 1 })),
  ...Array.from({ length: 6 }, (_, i) => ({ x: GRID_WIDTH / 2 - i - 1, y: GRID_HEIGHT / 2 })),
  ...Array.from({ length: 6 }, (_, i) => ({ x: GRID_WIDTH / 2, y: GRID_HEIGHT / 2 - i - 1 })),
]

// Apartment patterns
const APARTMENT_PATTERNS = [
  // Room walls
  // Top left room
  ...Array.from({ length: 8 }, (_, i) => ({ x: i, y: 0 })),
  ...Array.from({ length: 8 }, (_, i) => ({ x: 0, y: i })),
  ...Array.from({ length: 8 }, (_, i) => ({ x: i, y: 8 })),
  ...Array.from({ length: 8 }, (_, i) => ({ x: 8, y: i })),

  // Top right room
  ...Array.from({ length: 8 }, (_, i) => ({ x: i + 12, y: 0 })),
  ...Array.from({ length: 8 }, (_, i) => ({ x: 19, y: i })),
  ...Array.from({ length: 8 }, (_, i) => ({ x: i + 12, y: 8 })),
  ...Array.from({ length: 8 }, (_, i) => ({ x: 12, y: i })),

  // Bottom left room
  ...Array.from({ length: 8 }, (_, i) => ({ x: i, y: 12 })),
  ...Array.from({ length: 8 }, (_, i) => ({ x: 0, y: i + 12 })),
  ...Array.from({ length: 8 }, (_, i) => ({ x: i, y: 19 })),
  ...Array.from({ length: 8 }, (_, i) => ({ x: 8, y: i + 12 })),

  // Bottom right room
  ...Array.from({ length: 8 }, (_, i) => ({ x: i + 12, y: 12 })),
  ...Array.from({ length: 8 }, (_, i) => ({ x: 19, y: i + 12 })),
  ...Array.from({ length: 8 }, (_, i) => ({ x: i + 12, y: 19 })),
  ...Array.from({ length: 8 }, (_, i) => ({ x: 12, y: i + 12 })),
]

// Remove doorways from apartment
const apartmentWithDoors = APARTMENT_PATTERNS.filter(
  (wall) =>
    !(
      (wall.x === 8 && wall.y === 4) ||
      (wall.x === 12 && wall.y === 4) ||
      (wall.x === 4 && wall.y === 8) ||
      (wall.x === 4 && wall.y === 12) ||
      (wall.x === 16 && wall.y === 8) ||
      (wall.x === 16 && wall.y === 12) ||
      (wall.x === 8 && wall.y === 16) ||
      (wall.x === 12 && wall.y === 16)
    ),
)

// ZigZag pattern
const ZIGZAG_PATTERNS = [
  // Create a zigzag pattern across the grid
  ...Array.from({ length: 4 }, (_, i) =>
    Array.from({ length: GRID_WIDTH - 4 }, (_, j) => ({
      x: j + 2,
      y: i * 5 + 2,
    })),
  )
    .flat()
    .filter((_, index) => index % 2 === 0),

  ...Array.from({ length: 3 }, (_, i) =>
    Array.from({ length: GRID_WIDTH - 4 }, (_, j) => ({
      x: GRID_WIDTH - j - 3,
      y: i * 5 + 5,
    })),
  )
    .flat()
    .filter((_, index) => index % 2 === 0),
]

// Portal positions
const PORTALS = [
  { entrance: { x: 3, y: 3 }, exit: { x: 16, y: 16 } },
  { entrance: { x: 16, y: 3 }, exit: { x: 3, y: 16 } },
  { entrance: { x: 10, y: 5 }, exit: { x: 10, y: 15 } },
]

// Base campaign levels (first 5 levels)
const BASE_CAMPAIGN_LEVELS = [
  // Level 1: Simple walls
  [...Array.from({ length: 10 }, (_, i) => ({ x: 5, y: i + 5 }))],

  // Level 2: Box obstacles
  [
    { x: 5, y: 5 },
    { x: 6, y: 5 },
    { x: 5, y: 6 },
    { x: 6, y: 6 },
    { x: 14, y: 5 },
    { x: 15, y: 5 },
    { x: 14, y: 6 },
    { x: 15, y: 6 },
    { x: 5, y: 14 },
    { x: 6, y: 14 },
    { x: 5, y: 15 },
    { x: 6, y: 15 },
    { x: 14, y: 14 },
    { x: 15, y: 14 },
    { x: 14, y: 15 },
    { x: 15, y: 15 },
  ],

  // Level 3: Tunnel
  [
    ...Array.from({ length: GRID_WIDTH }, (_, i) => ({ x: i, y: 5 })).filter((pos) => pos.x !== 10),
    ...Array.from({ length: GRID_WIDTH }, (_, i) => ({ x: i, y: 15 })).filter((pos) => pos.x !== 10),
  ],

  // Level 4: Maze
  [...MAZE_PATTERNS.flat()],

  // Level 5: Apartment
  [...apartmentWithDoors],
]

// Function to generate a procedural level based on level number
const generateProceduralLevel = (levelNumber: number) => {
  const walls: { x: number; y: number }[] = []

  // Seed based on level number for consistent generation
  const seed = levelNumber * 1337

  // Simple pseudo-random function
  const random = (max: number) => {
    const x = Math.sin(seed + walls.length) * 10000
    return Math.floor((x - Math.floor(x)) * max)
  }

  // Different patterns based on level number
  if (levelNumber % 10 === 6) {
    // Spiral pattern
    const spiralSize = Math.min(8 + Math.floor(levelNumber / 10), 15)
    for (let i = 0; i < spiralSize; i++) {
      // Top row
      for (let j = i; j < GRID_WIDTH - i - 1; j++) {
        if (j !== GRID_WIDTH / 2) walls.push({ x: j, y: i })
      }
      // Right column
      for (let j = i; j < GRID_HEIGHT - i - 1; j++) {
        if (j !== GRID_HEIGHT / 2) walls.push({ x: GRID_WIDTH - i - 1, y: j })
      }
      // Bottom row
      for (let j = GRID_WIDTH - i - 1; j > i; j--) {
        if (j !== GRID_WIDTH / 2) walls.push({ x: j, y: GRID_HEIGHT - i - 1 })
      }
      // Left column
      for (let j = GRID_HEIGHT - i - 1; j > i; j--) {
        if (j !== GRID_HEIGHT / 2) walls.push({ x: i, y: j })
      }
    }
  } else if (levelNumber % 10 === 7) {
    // Checkerboard pattern
    const density = Math.min(3 + Math.floor(levelNumber / 15), 6)
    for (let i = 0; i < GRID_WIDTH; i += density) {
      for (let j = i % (density * 2) === 0 ? 0 : density; j < GRID_HEIGHT; j += density * 2) {
        walls.push({ x: i, y: j })
      }
    }
  } else if (levelNumber % 10 === 8) {
    // Random blocks
    const numBlocks = 5 + Math.floor(levelNumber / 10)
    for (let i = 0; i < numBlocks; i++) {
      const blockX = random(GRID_WIDTH - 4) + 2
      const blockY = random(GRID_HEIGHT - 4) + 2

      walls.push({ x: blockX, y: blockY })
      walls.push({ x: blockX + 1, y: blockY })
      walls.push({ x: blockX, y: blockY + 1 })
      walls.push({ x: blockX + 1, y: blockY + 1 })
    }
  } else if (levelNumber % 10 === 9) {
    // Maze-like pattern
    const numWalls = 10 + Math.floor(levelNumber / 5)
    for (let i = 0; i < numWalls; i++) {
      const isHorizontal = random(2) === 0
      const length = random(8) + 3
      const startX = random(GRID_WIDTH - (isHorizontal ? length : 0))
      const startY = random(GRID_HEIGHT - (isHorizontal ? 0 : length))

      if (isHorizontal) {
        for (let j = 0; j < length; j++) {
          if (j !== Math.floor(length / 2)) {
            // Leave a gap in the middle
            walls.push({ x: startX + j, y: startY })
          }
        }
      } else {
        for (let j = 0; j < length; j++) {
          if (j !== Math.floor(length / 2)) {
            // Leave a gap in the middle
            walls.push({ x: startX, y: startY + j })
          }
        }
      }
    }
  } else {
    // Increasing difficulty patterns
    const numObstacles = 5 + Math.floor(levelNumber / 3)
    for (let i = 0; i < numObstacles; i++) {
      const obstacleType = random(4)

      if (obstacleType === 0) {
        // Horizontal line
        const y = random(GRID_HEIGHT - 2) + 1
        const length = random(GRID_WIDTH - 6) + 3
        const startX = random(GRID_WIDTH - length)

        for (let j = 0; j < length; j++) {
          if (j !== Math.floor(length / 2)) {
            // Leave a gap
            walls.push({ x: startX + j, y })
          }
        }
      } else if (obstacleType === 1) {
        // Vertical line
        const x = random(GRID_WIDTH - 2) + 1
        const length = random(GRID_HEIGHT - 6) + 3
        const startY = random(GRID_HEIGHT - length)

        for (let j = 0; j < length; j++) {
          if (j !== Math.floor(length / 2)) {
            // Leave a gap
            walls.push({ x, y: startY + j })
          }
        }
      } else if (obstacleType === 2) {
        // Box
        const size = random(3) + 1
        const startX = random(GRID_WIDTH - size - 1) + 1
        const startY = random(GRID_HEIGHT - size - 1) + 1

        for (let x = 0; x < size; x++) {
          for (let y = 0; y < size; y++) {
            walls.push({ x: startX + x, y: startY + y })
          }
        }
      } else {
        // L shape
        const startX = random(GRID_WIDTH - 4) + 1
        const startY = random(GRID_HEIGHT - 4) + 1

        walls.push({ x: startX, y: startY })
        walls.push({ x: startX, y: startY + 1 })
        walls.push({ x: startX, y: startY + 2 })
        walls.push({ x: startX + 1, y: startY + 2 })
        walls.push({ x: startX + 2, y: startY + 2 })
      }
    }
  }

  // Remove duplicates
  const uniqueWalls: { x: number; y: number }[] = []
  const wallMap = new Map()

  walls.forEach((wall) => {
    const key = `${wall.x},${wall.y}`
    if (!wallMap.has(key)) {
      wallMap.set(key, true)
      uniqueWalls.push(wall)
    }
  })

  return uniqueWalls
}

// Generate all campaign levels
const generateAllCampaignLevels = () => {
  const allLevels = [...BASE_CAMPAIGN_LEVELS]

  // Generate procedural levels for levels 6-100
  for (let i = 5; i < MAX_CAMPAIGN_LEVEL; i++) {
    allLevels.push(generateProceduralLevel(i + 1))
  }

  return allLevels
}

// Create all campaign levels
const CAMPAIGN_LEVELS = generateAllCampaignLevels()

// Ordered list of game modes for the picker (swipe cycles through this order)
const MODE_LIST = (Object.keys(GAME_MODES) as (keyof typeof GAME_MODES)[]).map((key) => ({
  key,
  value: GAME_MODES[key],
  name: key.charAt(0) + key.slice(1).toLowerCase(),
}))

// Wall/portal layout shown in the mini mode preview
const getModePreviewLayout = (mode: string): { walls: { x: number; y: number }[]; portals?: typeof PORTALS } => {
  switch (mode) {
    case GAME_MODES.WALLS:
      return { walls: WALL_PATTERNS.flat() }
    case GAME_MODES.MAZE:
      return { walls: MAZE_PATTERNS.flat() }
    case GAME_MODES.BOX:
      return { walls: BOX_PATTERNS.flat() }
    case GAME_MODES.TUNNEL:
      return { walls: TUNNEL_PATTERNS.flat() }
    case GAME_MODES.MILL:
      return { walls: MILL_PATTERNS }
    case GAME_MODES.APARTMENT:
      return { walls: apartmentWithDoors }
    case GAME_MODES.ZIGZAG:
      return { walls: ZIGZAG_PATTERNS.flat() }
    case GAME_MODES.PORTAL:
      return { walls: [], portals: PORTALS }
    case GAME_MODES.CAMPAIGN:
      return { walls: CAMPAIGN_LEVELS[0] ?? [] }
    default:
      return { walls: [] }
  }
}

// Pick a random valid 3-segment snake start (head + direction) that avoids
// walls/portals and stays inside the grid. Falls back to the classic start.
const getRandomSnakeStart = (blocked: { x: number; y: number }[]) => {
  const blockedSet = new Set(blocked.map((c) => `${c.x},${c.y}`))
  const dirs = [DIRECTIONS.RIGHT, DIRECTIONS.LEFT, DIRECTIONS.DOWN, DIRECTIONS.UP]
  for (let attempt = 0; attempt < 300; attempt++) {
    const hx = 2 + Math.floor(Math.random() * (GRID_WIDTH - 4))
    const hy = 2 + Math.floor(Math.random() * (GRID_HEIGHT - 4))
    const dir = dirs[Math.floor(Math.random() * dirs.length)]
    const segments = [0, 1, 2].map((i) => ({ x: hx - dir.x * i, y: hy - dir.y * i }))
    const ok = segments.every(
      (s) => s.x >= 0 && s.x < GRID_WIDTH && s.y >= 0 && s.y < GRID_HEIGHT && !blockedSet.has(`${s.x},${s.y}`),
    )
    if (ok) return { segments, direction: dir }
  }
  return { segments: INITIAL_SNAKE, direction: DIRECTIONS.RIGHT }
}

export default function SnakeGame() {
  const [toast, setToast] = useState("")
  const { user } = useAuthUser()
  const [snake, setSnake] = useState(INITIAL_SNAKE)
  const store = useStore()
  const skinItem = equippedItem("skin", store.equipped.skin)
  const trailItem = equippedItem("trail", store.equipped.trail)
  const foodItem = equippedItem("food", store.equipped.food)
  const trailRef = useRef<{ x: number; y: number; life: number }[]>([])
  const prevTailRef = useRef<{ x: number; y: number } | null>(null)
  const [food, setFood] = useState({ x: 15, y: 10 })
  const foodRef = useRef({ x: 15, y: 10 })
  const [direction, setDirection] = useState(DIRECTIONS.RIGHT)
  const [gameOver, setGameOver] = useState(false)
  const [gameStarted, setGameStarted] = useState(false)
  const [score, setScore] = useState(0)
  const [highScore, setHighScore] = useState(0)
  const [gameMode, setGameMode] = useState(GAME_MODES.CLASSIC)
  const [speed, setSpeed] = useState(INITIAL_SPEED)
  const [walls, setWalls] = useState<Array<{ x: number; y: number }>>([])
  const [campaignLevel, setCampaignLevel] = useState(0)
  const [millRotation, setMillRotation] = useState(0)
  const millWallsRef = useRef<Array<{ x: number; y: number }>>([...MILL_PATTERNS])
  const [reverseTimer, setReverseTimer] = useState(0)
  // Add a new state variable for direction change cooldown
  const [directionChangeAllowed, setDirectionChangeAllowed] = useState(true)
  const directionChangeTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  // Add these new state variables after the existing state declarations
  const [darkMode, setDarkMode] = useState(false)
  const [teleportEnabled, setTeleportEnabled] = useState(true)
  const [countdown, setCountdown] = useState(0)
  const countdownRef = useRef<NodeJS.Timeout | null>(null)
  // Start-of-game grace period: for 3s after the game starts the snake is orange
  // and passes through walls without dying, so the player gets a safe launch
  const [graceActive, setGraceActive] = useState(false)
  // Multiplayer views: lobby -> battle. Single-player modes are untouched.
  const [mpView, setMpView] = useState<"none" | "lobby" | "battle">("none")
  const [mpSession, setMpSession] = useState<{ code: string; playerId: string } | null>(null)
  // Which panel the central frame shows. Everything (Store, Vault, Settings, Rank, Map, Multiplayer, ...) renders INSIDE the frame.
  const [activeView, setActiveView] = useState<ViewId>("GAME")
  // The empty layer inside the central frame that panels portal into
  const [frameEl, setFrameEl] = useState<HTMLElement | null>(null)
  // Battle slots: multiplayer draws on the SAME board frame + right dashboard as the classic game
  const [mpCenterEl, setMpCenterEl] = useState<HTMLElement | null>(null)
  const [mpSideEl, setMpSideEl] = useState<HTMLElement | null>(null)
  const [mpLeftEl, setMpLeftEl] = useState<HTMLElement | null>(null)
  // Room state reported by the lobby (host-only start, leave) for the bottom-right action bar
  const [mpLobbyInfo, setMpLobbyInfo] = useState<LobbyRoomInfo>(NO_LOBBY_ROOM)
  const mpLobbyActionsRef = useRef<LobbyActions | null>(null)
  const profileName = useDisplayName(user)

  // Accept a room invite: leave any current room, join the invited room's lobby.
  const handleInviteAccept = async (inv: RoomInvite): Promise<string | null> => {
    const myUid = user?.uid
    if (!myUid) return "Sign in with Google first."
    try {
      if (mpView !== "none" && mpSession) {
        try {
          await leaveRoom(mpSession.code, mpSession.playerId)
        } catch {}
        setMpSession(null)
        setMpView("none")
      }
      const res = await joinRoom(inv.roomCode, profileName, myUid, isVip())
      if ("error" in res) {
        const msgs: Record<string, string> = {
          ROOM_NOT_FOUND: "Room not found — it may have closed.",
          GAME_IN_PROGRESS: "Battle already started — ask the host to invite you to the next one.",
          ROOM_FULL: "Room is full.",
          NOT_RANKED: "That room is not a ranked room.",
          SIGN_IN_REQUIRED: "Sign in with Google to join.",
        }
        return msgs[res.error] ?? "Could not join the room."
      }
      await removeRoomInvite(myUid, inv.roomCode)
      setMpSession({ code: inv.roomCode, playerId: res.playerId })
      setMpView("lobby")
      setActiveView("MULTIPLAYER")
      return null
    } catch (e) {
      return e instanceof Error ? e.message : "Could not join the room."
    }
  }
  const graceActiveRef = useRef(false)
  const graceTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  // Add a new state variable for haptic feedback after the existing state declarations
  const [hapticEnabled, setHapticEnabled] = useState(true)
  // Add a new state variable for grid visibility after the other state declarations
  const [gridVisible, setGridVisible] = useState(true)
  // Tracks client mount so browser-only checks render the same on server and client
  const [mounted, setMounted] = useState(false)
  // Mute/unmute all game sounds
  const [soundEnabled, setSoundEnabled] = useState(true)
  // Master game volume 0..1 (persisted)
  const [volume, setVolume] = useState(() => {
    try {
      const v = parseFloat(localStorage.getItem("snake-game-volume") ?? "")
      return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.8
    } catch {
      return 0.8
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem("snake-game-volume", String(volume))
    } catch {}
  }, [volume])
  // Pause/resume the game loop
  const [isPaused, setIsPaused] = useState(false)
  // Best score is part of the saved profile (local + cloud)
  useEffect(() => { if (store.best > highScore) setHighScore(store.best) }, [store.best]) // eslint-disable-line react-hooks/exhaustive-deps
  // Admin-managed store catalog (skins/trails/avatars edited from the admin panel)
  useEffect(() => { loadCatalog() }, [])
  // Admin currency gifts: claimed live, or on next login via the same subscription.
  // v19.0.1 audit fix: delete the grant node FIRST and credit only if the
  // delete committed — otherwise a failed delete re-credits on every login.
  useEffect(() => {
    if (!user) return
    const uid = user.uid
    return subscribeGrants(uid, async (g) => {
      const consumed = await consumeGrant(uid)
      if (!consumed) return
      applyGrant(g)
      setToast(`🎁 Admin gift: +${g.coins.toLocaleString()} coins, +${g.gems.toLocaleString()} gems!`)
      setTimeout(() => setToast(""), 4000)
    })
  }, [user?.uid])
  useEffect(() => { if (highScore > store.best) setBest(highScore) }, [highScore]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (gameOver && scoreRef.current >= 20) earnGems(Math.floor(scoreRef.current / 20)) }, [gameOver])
  // Which on-screen controls are shown: D-pad buttons or swipe gestures
  const [controlMode, setControlMode] = useState<"buttons" | "swipe">("buttons")
  // "Smooth movement" (Battle Royale style gliding) — saved on this device, on by default
  const [smoothMove, setSmoothMove] = useState(true)
  useEffect(() => setSmoothMove(loadSmoothMove()), [])
  useEffect(() => saveSmoothMove(smoothMove), [smoothMove])
  // Random snake start position (head + direction), regenerated on every mode change
  const [snakeStart, setSnakeStart] = useState(() => getRandomSnakeStart([]))
  // Whether the canvas shows the mode preview (start screen, or game-over after a swipe)
  const [modePreviewActive, setModePreviewActive] = useState(true)

  // Add sound manager
  const { playWalkSound, playFoodSound, playGameOverSound, playGameStartSound } = useSoundManager({
    enabled: soundEnabled,
    volume,
  })

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const gameLoopRef = useRef<NodeJS.Timeout | null>(null)
  const millRotationRef = useRef<NodeJS.Timeout | null>(null)
  const lastDirectionRef = useRef(direction)
  const touchStartRef = useRef({ x: 0, y: 0 })
  const reverseIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const swipeAreaRef = useRef<HTMLDivElement>(null)
  const canvasWrapperRef = useRef<HTMLDivElement>(null)
  // Wrapper around the canvas + start/game-over panel: mode swipe works anywhere inside it
  const modeSwipeAreaRef = useRef<HTMLDivElement>(null)
  // Mirror of the snake state for the game loop. The setSnake updater must stay
  // pure (StrictMode double-invokes updaters in dev), so the loop reads/writes
  // through this ref and commits with a side-effect-free setSnake.
  const snakeRef = useRef(INITIAL_SNAKE)
  const currentWallsRef = useRef<Array<{ x: number; y: number }>>([])
  // Add a new directionQueue ref after the other refs
  const directionQueueRef = useRef<Array<typeof direction>>([])
  // Mirror of the score state for timers whose intervals are
  // created once and would otherwise read a stale score from their closure
  const scoreRef = useRef(0)
  // Mill rotation angle in degrees (ref, not state, so the rotation interval
  // always reads the latest angle instead of a stale closure value)
  const millAngleRef = useRef(0)
  // Reverse-mode countdown (ref mirror of reverseTimer state)
  const reverseTimerRef = useRef(0)
  // Pause flag mirror for the mode timers (timed/mill/reverse),
  // whose intervals are created once and can't read fresh state
  const isPausedRef = useRef(false)

  // Add a function to check if vibration is supported by the device
  const isVibrationSupported = () => {
    return typeof window !== "undefined" && typeof navigator !== "undefined" && "vibrate" in navigator
  }

  // Add a function to trigger haptic feedback
  const triggerHaptic = (pattern: number | number[]) => {
    if (hapticEnabled && isVibrationSupported()) {
      try {
        navigator.vibrate(pattern)
      } catch (error) {
        console.error("Vibration error:", error)
      }
    }
  }

  // Apply dark mode to document body
  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add("dark")
    } else {
      document.documentElement.classList.remove("dark")
    }
  }, [darkMode])

  // Mark mounted on client so browser-only checks render identically on server and client
  useEffect(() => {
    setMounted(true)
  }, [])

  // Keep the snake ref in sync with state (covers init/reverse/campaign resets)
  useEffect(() => {
    snakeRef.current = snake
  }, [snake])

  // Load the saved control scheme (client-only; defaults to "buttons")
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("snake-control-mode")
      // Only "buttons" and "swipe" are valid now ("both" was removed)
      if (saved === "swipe") {
        setControlMode("swipe")
      }
    } catch {
      // storage unavailable — keep the default
    }
  }, [])

  // Persist the control scheme choice
  useEffect(() => {
    try {
      window.localStorage.setItem("snake-control-mode", controlMode)
    } catch {
      // storage unavailable — choice just won't persist
    }
  }, [controlMode])

  // Initialize game
  const initGame = () => {
    // Add haptic feedback for button press
    triggerHaptic(25)

    // Hide the mode preview while the countdown / game runs
    setModePreviewActive(false)
    setActiveView("GAME")

    // Set up the new game's board RIGHT NOW so the 3s countdown already shows
    // the newly selected mode — not the previous game's stale board.
    const start = snakeStart
    setSnake(start.segments)
    snakeRef.current = start.segments
    setDirection(start.direction)
    lastDirectionRef.current = start.direction
    directionQueueRef.current = [] // Reset direction queue
    setScore(0)
    scoreRef.current = 0
    setSpeed(INITIAL_SPEED)
    // Stop any mode timers / grace period left over from a previous game
    if (millRotationRef.current) clearInterval(millRotationRef.current)
    if (reverseIntervalRef.current) clearInterval(reverseIntervalRef.current)
    if (graceTimeoutRef.current) clearTimeout(graceTimeoutRef.current)
    graceActiveRef.current = false
    setGraceActive(false)
    setMillRotation(0)
    millAngleRef.current = 0
    setReverseTimer(0)
    reverseTimerRef.current = 0
    setDirectionChangeAllowed(true) // Reset direction change allowed

    // Clear any existing direction change timeout
    if (directionChangeTimeoutRef.current) {
      clearTimeout(directionChangeTimeoutRef.current)
    }

    // Set walls based on game mode
    if (gameMode === GAME_MODES.WALLS) {
      const newWalls = WALL_PATTERNS.flat()
      setWalls(newWalls)
      currentWallsRef.current = newWalls
    } else if (gameMode === GAME_MODES.MAZE) {
      const newWalls = MAZE_PATTERNS.flat()
      setWalls(newWalls)
      currentWallsRef.current = newWalls
    } else if (gameMode === GAME_MODES.BOX) {
      const newWalls = BOX_PATTERNS.flat()
      setWalls(newWalls)
      currentWallsRef.current = newWalls
    } else if (gameMode === GAME_MODES.TUNNEL) {
      const newWalls = TUNNEL_PATTERNS.flat()
      setWalls(newWalls)
      currentWallsRef.current = newWalls
    } else if (gameMode === GAME_MODES.MILL) {
      millWallsRef.current = [...MILL_PATTERNS]
      setWalls(millWallsRef.current)
      currentWallsRef.current = millWallsRef.current
      // Rotation starts when the countdown finishes
    } else if (gameMode === GAME_MODES.APARTMENT) {
      const newWalls = apartmentWithDoors
      setWalls(newWalls)
      currentWallsRef.current = newWalls
    } else if (gameMode === GAME_MODES.CAMPAIGN) {
      const newWalls = CAMPAIGN_LEVELS[campaignLevel]
      setWalls(newWalls)
      currentWallsRef.current = newWalls
    } else if (gameMode === GAME_MODES.ZIGZAG) {
      const newWalls = ZIGZAG_PATTERNS
      setWalls(newWalls)
      currentWallsRef.current = newWalls
    } else if (gameMode === GAME_MODES.PORTAL) {
      setWalls([])
      currentWallsRef.current = []
      // Portals are handled in the game loop
    } else if (gameMode === GAME_MODES.REVERSE) {
      setWalls([])
      currentWallsRef.current = []
      // Reverse timer starts when the countdown finishes
    } else {
      setWalls([])
      currentWallsRef.current = []
    }

    generateFood()

    // Set countdown to 3 seconds
    setCountdown(3)

    // Start countdown timer
    if (countdownRef.current) {
      clearInterval(countdownRef.current)
    }

    countdownRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          // When countdown reaches 0, start the game
          if (countdownRef.current) {
            clearInterval(countdownRef.current)
          }

          // Play game start sound
          playGameStartSound()

          // Add haptic feedback for game start
          triggerHaptic([50, 30, 50, 30, 100])

          // Start the mode's intervals only when the game actually begins
          // (so mode timers don't tick away during the countdown)
          if (gameMode === GAME_MODES.MILL) {
            startMillRotation()
          } else if (gameMode === GAME_MODES.REVERSE) {
            startReverseTimer()
          }

          // 3-second grace period: orange snake, passes through walls unharmed
          graceActiveRef.current = true
          setGraceActive(true)
          if (graceTimeoutRef.current) {
            clearTimeout(graceTimeoutRef.current)
          }
          graceTimeoutRef.current = setTimeout(() => {
            graceActiveRef.current = false
            setGraceActive(false)
          }, 3000)

          setGameOver(false)
          setIsPaused(false)
          isPausedRef.current = false
          setGameStarted(true)
          return 0
        } else {
          // Add haptic feedback for each countdown number
          triggerHaptic(20)
        }
        return prev - 1
      })
    }, 1000)
  }

  // Pause or resume the game
  const togglePause = () => {
    if (!gameStarted || gameOver || countdown > 0) return
    triggerHaptic(15)
    const next = !isPausedRef.current
    isPausedRef.current = next
    setIsPaused(next)
  }

  // Exit to the start screen and reset the game
  const exitGame = () => {
    triggerHaptic(25)
    if (gameLoopRef.current) clearInterval(gameLoopRef.current)
    if (countdownRef.current) clearInterval(countdownRef.current)
    if (millRotationRef.current) clearInterval(millRotationRef.current)
    if (reverseIntervalRef.current) clearInterval(reverseIntervalRef.current)
    if (graceTimeoutRef.current) clearTimeout(graceTimeoutRef.current)
    graceActiveRef.current = false
    setGraceActive(false)
    if (directionChangeTimeoutRef.current) clearTimeout(directionChangeTimeoutRef.current)
    snakeRef.current = INITIAL_SNAKE
    setSnake(INITIAL_SNAKE)
    setDirection(DIRECTIONS.RIGHT)
    lastDirectionRef.current = DIRECTIONS.RIGHT
    directionQueueRef.current = []
    setScore(0)
    scoreRef.current = 0
    setGameOver(false)
    setIsPaused(false)
    isPausedRef.current = false
    setCountdown(0)
    generateFood()
    setGameStarted(false)
    // Back on the start screen: show the mode preview with a fresh random start
    setModePreviewActive(true)
    setSnakeStart(getRandomSnakeStart(getBlockedCellsForStart()))
  }

  // Fix the mill rotation by updating the startMillRotation function
  const startMillRotation = () => {
    if (millRotationRef.current) {
      clearInterval(millRotationRef.current)
    }

    // Reset mill walls to initial state
    millWallsRef.current = [...MILL_PATTERNS]
    setWalls(millWallsRef.current)
    currentWallsRef.current = millWallsRef.current

    millAngleRef.current = 0
    setMillRotation(0)

    millRotationRef.current = setInterval(() => {
      // Freeze the mill while the game is paused
      if (isPausedRef.current) return

      // Track the angle in a ref: the millRotation state captured in this
      // closure never updates, so reading state here kept the arms frozen.
      millAngleRef.current = (millAngleRef.current + 5) % 360
      setMillRotation(millAngleRef.current)

      // Update mill walls based on rotation
      const centerX = GRID_WIDTH / 2
      const centerY = GRID_HEIGHT / 2
      const angleRad = (millAngleRef.current * Math.PI) / 180

      const newMillWalls = [{ x: Math.floor(centerX), y: Math.floor(centerY) }] // Center point stays fixed

      // Rotate the mill arms
      for (let i = 2; i <= 6; i++) {
        // Start from 2 to leave space near center
        // Right arm
        newMillWalls.push({
          x: Math.round(centerX + i * Math.cos(angleRad)),
          y: Math.round(centerY + i * Math.sin(angleRad)),
        })

        // Down arm
        newMillWalls.push({
          x: Math.round(centerX + i * Math.cos(angleRad + Math.PI / 2)),
          y: Math.round(centerY + i * Math.sin(angleRad + Math.PI / 2)),
        })

        // Left arm
        newMillWalls.push({
          x: Math.round(centerX + i * Math.cos(angleRad + Math.PI)),
          y: Math.round(centerY + i * Math.sin(angleRad + Math.PI)),
        })

        // Up arm
        newMillWalls.push({
          x: Math.round(centerX + i * Math.cos(angleRad + (3 * Math.PI) / 2)),
          y: Math.round(centerY + i * Math.sin(angleRad + (3 * Math.PI) / 2)),
        })
      }

      // Filter out walls that are outside the grid
      const filteredWalls = newMillWalls.filter(
        (wall) => wall.x >= 0 && wall.x < GRID_WIDTH && wall.y >= 0 && wall.y < GRID_HEIGHT,
      )

      millWallsRef.current = filteredWalls
      setWalls(filteredWalls)
      currentWallsRef.current = filteredWalls

      // Check if food is now inside a wall and regenerate if needed
      if (filteredWalls.some((wall) => wall.x === foodRef.current.x && wall.y === foodRef.current.y)) {
        generateFood()
      }
    }, 300) // Rotate faster for better visual effect
  }

  // Reverse-mode timer: every 15 seconds the snake turns around.
  // All logic runs outside setState updaters: StrictMode double-invokes
  // updaters in dev, which used to flip the direction twice (a no-op), and
  // the reversed body is written through snakeRef so the game loop stays
  // in sync with what is drawn.
  const startReverseTimer = () => {
    if (reverseIntervalRef.current) {
      clearInterval(reverseIntervalRef.current)
    }

    reverseTimerRef.current = 0
    setReverseTimer(0)

    reverseIntervalRef.current = setInterval(() => {
      // Freeze the countdown while the game is paused
      if (isPausedRef.current) return

      const newTimer = reverseTimerRef.current + 1

      if (newTimer >= 15) {
        reverseTimerRef.current = 0
        setReverseTimer(0)

        // Reverse the snake direction
        const cur = lastDirectionRef.current
        const newDir =
          cur === DIRECTIONS.UP
            ? DIRECTIONS.DOWN
            : cur === DIRECTIONS.DOWN
              ? DIRECTIONS.UP
              : cur === DIRECTIONS.LEFT
                ? DIRECTIONS.RIGHT
                : DIRECTIONS.LEFT
        lastDirectionRef.current = newDir
        setDirection(newDir)

        // Also reverse the snake body (head becomes tail and vice versa)
        const reversed = [...snakeRef.current].reverse()
        snakeRef.current = reversed
        setSnake(reversed)

        // Haptic feedback for direction reversal
        triggerHaptic([50, 30, 50])
      } else {
        reverseTimerRef.current = newTimer
        setReverseTimer(newTimer)
      }
    }, 1000) // Increment timer every second
  }

  // Generate food at random position - improved to never place food inside walls
  const generateFood = () => {
    let newFood: { x: number; y: number }
    let attempts = 0
    const maxAttempts = 100 // Prevent infinite loop

    do {
      newFood = {
        x: Math.floor(Math.random() * GRID_WIDTH),
        y: Math.floor(Math.random() * GRID_HEIGHT),
      }
      attempts++

      // If we've tried too many times, find any valid position
      if (attempts > maxAttempts) {
        for (let x = 0; x < GRID_WIDTH; x++) {
          for (let y = 0; y < GRID_HEIGHT; y++) {
            const pos = { x, y }
            if (
              !snakeRef.current.some((segment) => segment.x === pos.x && segment.y === pos.y) &&
              !currentWallsRef.current.some((wall) => wall.x === pos.x && wall.y === pos.y)
            ) {
              newFood = pos
              break
            }
          }
          if (attempts > maxAttempts) break
        }
        break
      }
    } while (
      snakeRef.current.some((segment) => segment.x === newFood.x && segment.y === newFood.y) ||
      currentWallsRef.current.some((wall) => wall.x === newFood.x && wall.y === newFood.y)
    )

    foodRef.current = newFood
    setFood(newFood)
  }

  // Advance to next campaign level
  const advanceCampaignLevel = () => {
    const nextLevel = campaignLevel + 1
    if (nextLevel < MAX_CAMPAIGN_LEVEL) {
      setCampaignLevel(nextLevel)
      const newWalls = CAMPAIGN_LEVELS[nextLevel]
      setWalls(newWalls)
      currentWallsRef.current = newWalls

      // Instead of resetting to INITIAL_SNAKE, preserve the current snake length
      // but reposition it to a safe starting position (computed from the ref,
      // outside any updater, so it stays StrictMode-safe)
      const prevSnake = snakeRef.current
      const newSnake: Array<{ x: number; y: number }> = []
      // Start at a safe position
      let startX = 3
      let startY = 3

      // Check if the starting position conflicts with walls
      while (newWalls.some((wall) => wall.x === startX && wall.y === startY)) {
        startX += 1
        if (startX >= GRID_WIDTH - 1) {
          startX = 1
          startY += 1
          if (startY >= GRID_HEIGHT - 1) {
            startY = 1
          }
        }
      }

      // Create a new snake with the same length but at the new position
      for (let i = 0; i < prevSnake.length; i++) {
        newSnake.push({
          x: startX - i,
          y: startY,
        })
      }

      snakeRef.current = newSnake
      setSnake(newSnake)

      setDirection(DIRECTIONS.RIGHT)
      lastDirectionRef.current = DIRECTIONS.RIGHT
      generateFood()
    } else {
      // Player completed all levels
      setGameOver(true)
      playGameOverSound()
      // Long vibration pattern for game over
      triggerHaptic([100, 50, 100, 50, 200])
      if (score > highScore) {
        setHighScore(score)
      }
    }
  }

  // Game loop
  useEffect(() => {
    if (!gameStarted || gameOver || countdown > 0 || isPaused) return

    const moveSnake = () => {
      // Play walk sound when snake moves
      // v19.0.1 audit fix: NO per-tick walk sound / haptic here. Every tick par
      // buzz + audio clone chalane se phone constantly vibrate karta tha aur
      // har tick par naya Audio node allocate hota tha. Sound/haptic sirf food
      // eat aur game over par hote hain (neeche ateFood / doGameOver me dekho).

      // Process the next direction from the queue if available
      if (directionQueueRef.current.length > 0) {
        const nextDirection = directionQueueRef.current.shift()
        if (nextDirection) {
          // Validate the direction change to prevent 180-degree turns
          if (
            (nextDirection === DIRECTIONS.UP && lastDirectionRef.current !== DIRECTIONS.DOWN) ||
            (nextDirection === DIRECTIONS.DOWN && lastDirectionRef.current !== DIRECTIONS.UP) ||
            (nextDirection === DIRECTIONS.LEFT && lastDirectionRef.current !== DIRECTIONS.RIGHT) ||
            (nextDirection === DIRECTIONS.RIGHT && lastDirectionRef.current !== DIRECTIONS.LEFT)
          ) {
            lastDirectionRef.current = nextDirection
          }
        }
      }

      // Read the latest snake through the ref. The state update below must stay
      // pure: StrictMode double-invokes impure updaters in dev, which broke
      // growth when score/food updates ran inside the updater.
      const prevSnake = snakeRef.current

      // Get current head position
      const head = prevSnake[0]

      // Calculate new head position
      const newHead = {
        x: head.x + lastDirectionRef.current.x,
        y: head.y + lastDirectionRef.current.y,
      }

      const doGameOver = () => {
        setGameOver(true)
        playGameOverSound()
        // Long vibration pattern for game over
        triggerHaptic([100, 50, 100, 50, 200])
        if (score > highScore) {
          setHighScore(score)
        }
      }

      // During the start-of-game grace period the snake passes through walls:
      // outer edges wrap around and inner walls are ignored (no death)
      const inGrace = graceActiveRef.current

      // Handle teleporting at edges based on teleportEnabled setting
      if (teleportEnabled || inGrace) {
        // Allow teleporting at the outer edges for all modes
        if (newHead.x < 0) newHead.x = GRID_WIDTH - 1
        if (newHead.x >= GRID_WIDTH) newHead.x = 0
        if (newHead.y < 0) newHead.y = GRID_HEIGHT - 1
        if (newHead.y >= GRID_HEIGHT) newHead.y = 0

        // Check for collisions with inner walls (skipped during the grace period)
        if (
          !inGrace &&
          currentWallsRef.current.some((wall) => wall.x === newHead.x && wall.y === newHead.y)
        ) {
          doGameOver()
          return
        }
      } else {
        // No teleporting - die on outer walls
        if (
          newHead.x < 0 ||
          newHead.x >= GRID_WIDTH ||
          newHead.y < 0 ||
          newHead.y >= GRID_HEIGHT ||
          currentWallsRef.current.some((wall) => wall.x === newHead.x && wall.y === newHead.y)
        ) {
          doGameOver()
          return
        }
      }

      // Handle portals in portal mode
      if (gameMode === GAME_MODES.PORTAL) {
        const portal = PORTALS.find((p) => p.entrance.x === newHead.x && p.entrance.y === newHead.y)

        if (portal) {
          newHead.x = portal.exit.x
          newHead.y = portal.exit.y
        }
      }

      // Decide food BEFORE the self check so we know whether the tail vacates this tick
      const ateFood = newHead.x === foodRef.current.x && newHead.y === foodRef.current.y

      // Check for collision with self — the tail cell vacates this tick unless we're
      // growing, so exclude it (v19.0.1 audit fix: false "ate my own tail" deaths
      // when the head moves into the cell the tail just left).
      const bodyToCheck = ateFood ? prevSnake : prevSnake.slice(0, -1)
      if (bodyToCheck.some((segment) => segment.x === newHead.x && segment.y === newHead.y)) {
        doGameOver()
        return
      }

      if (ateFood) {
        // Play food sound
        playFoodSound()
        earnCoins(2)
        // Stronger vibration when eating food
        triggerHaptic([30, 50, 30])

        const newScore = score + 1
        setScore(newScore)
        scoreRef.current = newScore

        // In campaign mode, advance to next level after 5 points
        if (gameMode === GAME_MODES.CAMPAIGN && newScore % 5 === 0) {
          advanceCampaignLevel()
        }

        generateFood()

        // Increase speed in speed mode
        if (gameMode === GAME_MODES.SPEED) {
          setSpeed((prevSpeed) => Math.max(prevSpeed - 5, 50))
        }
      }

      // Create new snake array — pure, no side effects (grows by 1 on food)
      const newSnake = ateFood ? [newHead, ...prevSnake] : [newHead, ...prevSnake.slice(0, -1)]
      snakeRef.current = newSnake
      setSnake(newSnake)
    }

    // Set up game loop
    const intervalId = setInterval(moveSnake, speed)
    gameLoopRef.current = intervalId

    // Add cleanup for countdown timer in the useEffect cleanup function.
    // NOTE: mode intervals (mill/reverse) are NOT cleared here on purpose.
    // This effect re-runs on every score/timer tick, and clearing them here killed
    // the mode timers right after they started (reverse/timed never worked).
    // They are stopped explicitly on game over, on exit, and on a fresh initGame.
    // COUNTDOWN is also NOT cleared here on purpose (v19.0.1 audit fix):
    // initGame's own setCountdown(3) re-runs this effect, and clearing
    // countdownRef here killed the countdown interval milliseconds after it was
    // created — the game froze at "3" forever. The countdown clears itself at 0;
    // initGame / exitGame / unmount clear it explicitly.
    return () => {
      if (gameLoopRef.current) {
        clearInterval(gameLoopRef.current)
      }
      if (directionChangeTimeoutRef.current) {
        clearTimeout(directionChangeTimeoutRef.current)
      }
    }
  }, [
    gameStarted,
    gameOver,
    speed,
    gameMode,
    campaignLevel,
    reverseTimer,
    playWalkSound,
    playFoodSound,
    playGameOverSound,
    score,
    highScore,
    teleportEnabled,
    countdown,
    hapticEnabled,
    isPaused,
  ])

  // Handle keyboard controls
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!gameStarted || gameOver) return

      // Prevent default behavior for arrow keys to avoid page scrolling
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
        e.preventDefault()
      }

      // Add direction to the queue instead of changing immediately
      switch (e.key) {
        case "ArrowUp":
          if (lastDirectionRef.current !== DIRECTIONS.DOWN) {
            // Only add to queue if it's not already the last item in the queue
            if (
              directionQueueRef.current.length === 0 ||
              directionQueueRef.current[directionQueueRef.current.length - 1] !== DIRECTIONS.UP
            ) {
              directionQueueRef.current.push(DIRECTIONS.UP)
            }
          }
          break
        case "ArrowDown":
          if (lastDirectionRef.current !== DIRECTIONS.UP) {
            if (
              directionQueueRef.current.length === 0 ||
              directionQueueRef.current[directionQueueRef.current.length - 1] !== DIRECTIONS.DOWN
            ) {
              directionQueueRef.current.push(DIRECTIONS.DOWN)
            }
          }
          break
        case "ArrowLeft":
          if (lastDirectionRef.current !== DIRECTIONS.RIGHT) {
            if (
              directionQueueRef.current.length === 0 ||
              directionQueueRef.current[directionQueueRef.current.length - 1] !== DIRECTIONS.LEFT
            ) {
              directionQueueRef.current.push(DIRECTIONS.LEFT)
            }
          }
          break
        case "ArrowRight":
          if (lastDirectionRef.current !== DIRECTIONS.LEFT) {
            if (
              directionQueueRef.current.length === 0 ||
              directionQueueRef.current[directionQueueRef.current.length - 1] !== DIRECTIONS.RIGHT
            ) {
              directionQueueRef.current.push(DIRECTIONS.RIGHT)
            }
          }
          break
      }
    }

    window.addEventListener("keydown", handleKeyDown)

    return () => {
      window.removeEventListener("keydown", handleKeyDown)
    }
  }, [gameStarted, gameOver])

  // Handle touch controls (swipe on the game canvas + the swipe pad)
  useEffect(() => {
    // Attach the same swipe handlers to every swipe surface that exists
    const swipeSurfaces = [swipeAreaRef.current, canvasWrapperRef.current].filter(
      (el): el is HTMLDivElement => el !== null,
    )
    if (swipeSurfaces.length === 0) return

    const handleTouchStart = (e: TouchEvent) => {
      if (!gameStarted || gameOver || controlMode === "buttons") return

      // Prevent default to stop scrolling
      e.preventDefault()

      const touch = e.touches[0]
      touchStartRef.current = { x: touch.clientX, y: touch.clientY }
    }

    const handleTouchMove = (e: TouchEvent) => {
      if (!gameStarted || gameOver || controlMode === "buttons") return

      // Prevent default scrolling behavior
      e.preventDefault()

      // Get current touch position
      const touch = e.touches[0]
      const currentX = touch.clientX
      const currentY = touch.clientY

      // Calculate the distance moved
      const dx = currentX - touchStartRef.current.x
      const dy = currentY - touchStartRef.current.y

      // Set minimum swipe distance
      const minSwipeDistance = 30

      // Only change direction if we've moved enough distance
      if (Math.abs(dx) > minSwipeDistance || Math.abs(dy) > minSwipeDistance) {
        // Determine primary swipe direction
        let newDirection = null

        if (Math.abs(dx) > Math.abs(dy)) {
          // Horizontal swipe
          if (dx > 0 && lastDirectionRef.current !== DIRECTIONS.LEFT) {
            newDirection = DIRECTIONS.RIGHT
          } else if (dx < 0 && lastDirectionRef.current !== DIRECTIONS.RIGHT) {
            newDirection = DIRECTIONS.LEFT
          }
        } else {
          // Vertical swipe
          if (dy > 0 && lastDirectionRef.current !== DIRECTIONS.UP) {
            newDirection = DIRECTIONS.DOWN
          } else if (dy < 0 && lastDirectionRef.current !== DIRECTIONS.DOWN) {
            newDirection = DIRECTIONS.UP
          }
        }

        // Add to queue if valid direction and not already the last item in queue
        if (
          newDirection &&
          (directionQueueRef.current.length === 0 ||
            directionQueueRef.current[directionQueueRef.current.length - 1] !== newDirection)
        ) {
          // Add haptic feedback for swipe direction change
          triggerHaptic(15)

          directionQueueRef.current.push(newDirection)

          // Limit queue size to prevent too many buffered moves
          if (directionQueueRef.current.length > 3) {
            directionQueueRef.current = directionQueueRef.current.slice(-3)
          }
        }

        // Reset touch start position to allow for continuous swiping
        touchStartRef.current = { x: currentX, y: currentY }
      }
    }

    // Add event listeners with passive: false to ensure preventDefault works
    swipeSurfaces.forEach((surface) => {
      surface.addEventListener("touchstart", handleTouchStart, { passive: false })
      surface.addEventListener("touchmove", handleTouchMove, { passive: false })
    })

    // Clean up
    return () => {
      swipeSurfaces.forEach((surface) => {
        surface.removeEventListener("touchstart", handleTouchStart)
        surface.removeEventListener("touchmove", handleTouchMove)
      })
    }
  }, [gameStarted, gameOver, controlMode])

  // Cycle the selected game mode (used by swipe gestures on the mode picker)
  const cycleMode = (dir: 1 | -1) => {
    const idx = MODE_LIST.findIndex((m) => m.value === gameMode)
    const next = MODE_LIST[(idx + dir + MODE_LIST.length) % MODE_LIST.length]
    triggerHaptic(15)
    setGameMode(next.value)
  }

  // Currently selected mode entry (shown on the game canvas)
  const activeMode = MODE_LIST.find((m) => m.value === gameMode) ?? MODE_LIST[0]
  const activeModeIndex = MODE_LIST.findIndex((m) => m.value === gameMode)

  // Cells the random snake start must avoid for the current mode/level
  const getBlockedCellsForStart = () => {
    if (gameMode === GAME_MODES.CAMPAIGN) return CAMPAIGN_LEVELS[campaignLevel] ?? []
    if (gameMode === GAME_MODES.PORTAL) return PORTALS.flatMap((p) => [p.entrance, p.exit])
    return getModePreviewLayout(gameMode).walls
  }

  // New random snake start position every time the mode (or campaign level) changes
  useEffect(() => {
    setSnakeStart(getRandomSnakeStart(getBlockedCellsForStart()))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameMode, campaignLevel])

  // Fresh random start position for the next game whenever the snake dies.
  // Also stop the mode timers and the grace period with the game.
  useEffect(() => {
    if (gameOver) {
      if (millRotationRef.current) clearInterval(millRotationRef.current)
      if (reverseIntervalRef.current) clearInterval(reverseIntervalRef.current)
      if (graceTimeoutRef.current) clearTimeout(graceTimeoutRef.current)
      graceActiveRef.current = false
      setGraceActive(false)
      setSnakeStart(getRandomSnakeStart(getBlockedCellsForStart()))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameOver])

  // Swipe left/right to change the game mode. Active on the start screen and the
  // game-over screen, anywhere inside the canvas + panel area. Uses touchend
  // (not touchmove) so vertical page scrolling stays smooth.
  useEffect(() => {
    const el = modeSwipeAreaRef.current
    if (!el) return

    let startX = 0
    let startY = 0

    const onTouchStart = (e: TouchEvent) => {
      const touch = e.touches[0]
      startX = touch.clientX
      startY = touch.clientY
    }

    const onTouchEnd = (e: TouchEvent) => {
      // Disabled while the game is running or counting down
      if ((gameStarted && !gameOver) || countdown > 0) return
      const touch = e.changedTouches[0]
      const dx = touch.clientX - startX
      const dy = touch.clientY - startY
      // Horizontal swipe with a 40px threshold, ignoring vertical-dominant gestures
      if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) {
        cycleMode(dx < 0 ? 1 : -1)
        // On game over, swiping switches the canvas to the mode preview
        if (gameOver) setModePreviewActive(true)
      }
    }

    el.addEventListener("touchstart", onTouchStart, { passive: true })
    el.addEventListener("touchend", onTouchEnd, { passive: true })
    // --- Mouse drag = touch swipe (PC support, v13.1) ---
    // (touch handlers above are untouched: Android swipe works exactly as before)
    let mouseDownX: number | null = null
    let mouseDownY: number | null = null
    const onMouseDown = (e: MouseEvent) => {
      mouseDownX = e.clientX
      mouseDownY = e.clientY
    }
    const onMouseUp = (e: MouseEvent) => {
      if (mouseDownX === null || mouseDownY === null) return
      const sx = mouseDownX
      const sy = mouseDownY
      mouseDownX = null
      mouseDownY = null
      if ((gameStarted && !gameOver) || countdown > 0) return
      const dx = e.clientX - sx
      const dy = e.clientY - sy
      if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) {
        cycleMode(dx < 0 ? 1 : -1)
        if (gameOver) setModePreviewActive(true)
      }
    }
    el.addEventListener("mousedown", onMouseDown)
    el.addEventListener("mouseup", onMouseUp)
    return () => {
      el.removeEventListener("touchstart", onTouchStart)
      el.removeEventListener("touchend", onTouchEnd)
      el.removeEventListener("mousedown", onMouseDown)
      el.removeEventListener("mouseup", onMouseUp)
    }
  }, [gameMode, gameStarted, gameOver, countdown])

  // Handle direction button clicks
  const handleDirectionClick = (newDirection: typeof direction) => {
    if (!gameStarted || gameOver) return

    // Add haptic feedback for button press
    triggerHaptic(15)

    // Prevent 180-degree turns
    if (
      (newDirection === DIRECTIONS.UP && lastDirectionRef.current === DIRECTIONS.DOWN) ||
      (newDirection === DIRECTIONS.DOWN && lastDirectionRef.current === DIRECTIONS.UP) ||
      (newDirection === DIRECTIONS.LEFT && lastDirectionRef.current === DIRECTIONS.RIGHT) ||
      (newDirection === DIRECTIONS.RIGHT && lastDirectionRef.current === DIRECTIONS.LEFT)
    ) {
      return
    }

    // Add to queue if not already the last item
    if (
      directionQueueRef.current.length === 0 ||
      directionQueueRef.current[directionQueueRef.current.length - 1] !== newDirection
    ) {
      directionQueueRef.current.push(newDirection)

      // Limit queue size
      if (directionQueueRef.current.length > 3) {
        directionQueueRef.current = directionQueueRef.current.slice(-3)
      }
    }
  }

  // Draw game
  useEffect(() => {
    if (!canvasRef.current) return

    const canvas = canvasRef.current
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    // Helper: rounded rect path
    const roundedRect = (x: number, y: number, w: number, h: number, r: number) => {
      ctx.beginPath()
      ctx.moveTo(x + r, y)
      ctx.arcTo(x + w, y, x + w, y + h, r)
      ctx.arcTo(x + w, y + h, x, y + h, r)
      ctx.arcTo(x, y + h, x, y, r)
      ctx.arcTo(x, y, x + w, y, r)
      ctx.closePath()
    }

    // Premium gradient background
    const bgGradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height)
    if (darkMode) {
      bgGradient.addColorStop(0, "#101820")
      bgGradient.addColorStop(1, "#0a0f14")
    } else {
      bgGradient.addColorStop(0, "#eef4ea")
      bgGradient.addColorStop(1, "#dbe8d6")
    }
    ctx.fillStyle = bgGradient
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    // Draw grid only if gridVisible is true
    if (gridVisible) {
      ctx.strokeStyle = darkMode ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.06)"
      ctx.lineWidth = 1
      for (let i = 0; i <= GRID_WIDTH; i++) {
        ctx.beginPath()
        ctx.moveTo(i * CELL_SIZE, 0)
        ctx.lineTo(i * CELL_SIZE, GRID_HEIGHT * CELL_SIZE)
        ctx.stroke()
      }
      for (let i = 0; i <= GRID_HEIGHT; i++) {
        ctx.beginPath()
        ctx.moveTo(0, i * CELL_SIZE)
        ctx.lineTo(GRID_WIDTH * CELL_SIZE, i * CELL_SIZE)
        ctx.stroke()
      }
    }

    // The canvas previews the selected game mode on the start screen,
    // and on the game-over screen once the user swipes to another mode
    const isModePreview = modePreviewActive && (!gameStarted || gameOver)
    const previewLayout = isModePreview ? getModePreviewLayout(gameMode) : null
    const wallsToDraw = previewLayout ? previewLayout.walls : walls

    // Draw walls with subtle depth
    wallsToDraw.forEach((wall) => {
      ctx.fillStyle = darkMode ? "#39424d" : "#8a9686"
      roundedRect(wall.x * CELL_SIZE + 1, wall.y * CELL_SIZE + 1, CELL_SIZE - 2, CELL_SIZE - 2, 3)
      ctx.fill()
    })

    // Draw glowing, pulsing food (hidden in the mode preview)
    if (!isModePreview) {
      const foodPulse = 0.8 + Math.sin(Date.now() / 180) * 0.15
      const fcx = food.x * CELL_SIZE + CELL_SIZE / 2
      const fcy = food.y * CELL_SIZE + CELL_SIZE / 2
      ctx.save()
      ctx.shadowColor = darkMode ? "rgba(255, 84, 112, 0.9)" : "rgba(255, 84, 112, 0.7)"
      ctx.shadowBlur = 10
      if (foodItem.palette) {
        const c = foodItem.palette
        ctx.shadowColor = c[0]
        ctx.fillStyle = c[0]
        ctx.strokeStyle = c[1]
        ctx.lineWidth = 1.5
        shapePath(ctx, foodItem.shape || "star", fcx, fcy, (CELL_SIZE / 2) * foodPulse)
        ctx.fill()
        ctx.stroke()
      } else {
        ctx.fillStyle = "#ff5470"
        ctx.beginPath()
        ctx.arc(fcx, fcy, (CELL_SIZE / 2 - 1) * foodPulse, 0, 2 * Math.PI)
        ctx.fill()
      }
      ctx.restore()
    }

    // Draw snake with gradient body + glowing head (hidden in the mode preview).
    // During the start-of-game grace period the snake is orange so the player
    // can see it is invincible and passes through walls.
    if (!isModePreview) {
      // Trail: remember the cell the tail just left and fade old ones out
      const tail = snake[snake.length - 1]
      const pt = prevTailRef.current
      if (trailItem.palette && pt && (pt.x !== tail.x || pt.y !== tail.y)) trailRef.current.push({ x: pt.x, y: pt.y, life: 9 })
      prevTailRef.current = { x: tail.x, y: tail.y }
      if (!trailItem.palette) trailRef.current = []
      trailRef.current = trailRef.current.filter((t) => t.life > 0)
      trailRef.current.forEach((t, i) => {
        const pal = trailItem.palette || ["#fff"]
        ctx.save()
        ctx.globalAlpha = (t.life / 9) * 0.8
        ctx.shadowColor = pal[i % pal.length]
        ctx.shadowBlur = 8
        ctx.fillStyle = pal[i % pal.length]
        shapePath(ctx, trailItem.shape || "dot", t.x * CELL_SIZE + CELL_SIZE / 2, t.y * CELL_SIZE + CELL_SIZE / 2, (CELL_SIZE / 2 - 2) * (0.4 + t.life / 15))
        ctx.fill()
        ctx.restore()
        t.life -= 1
      })
      // (smooth movement: the SmoothSnakeLayer on top draws the snake while a game is running)
      if (!(smoothMove && gameStarted && !gameOver)) snake.forEach((segment, index) => {
        const isHead = index === 0
        const x = segment.x * CELL_SIZE
        const y = segment.y * CELL_SIZE
        ctx.save()
        if (skinItem.head && !graceActive) {
          const tt = index / Math.max(snake.length - 1, 1)
          ctx.shadowColor = skinItem.glow || skinItem.head
          ctx.shadowBlur = isHead ? 10 : 4
          ctx.fillStyle = isHead ? skinItem.head : skinItem.rainbow ? `hsl(${(index * 28) % 360} 90% 60%)` : index % 2 === 0 ? (skinItem.a as string) : (skinItem.b as string)
          ctx.globalAlpha = isHead ? 1 : 1 - tt * 0.4
        } else if (isHead) {
          ctx.shadowColor = graceActive
            ? "rgba(255, 159, 26, 0.9)"
            : darkMode
              ? "rgba(34, 217, 122, 0.9)"
              : "rgba(23, 183, 106, 0.6)"
          ctx.shadowBlur = 8
          ctx.fillStyle = graceActive ? "#ff9f1a" : darkMode ? "#3af08d" : "#17b76a"
        } else {
          const t = index / Math.max(snake.length - 1, 1)
          ctx.fillStyle = graceActive
            ? `rgba(255, 159, 26, ${1 - t * 0.55})`
            : darkMode
              ? `rgba(58, 240, 141, ${1 - t * 0.55})`
              : `rgba(23, 183, 106, ${1 - t * 0.5})`
        }
        roundedRect(x + 1, y + 1, CELL_SIZE - 2, CELL_SIZE - 2, isHead ? 5 : 4)
        ctx.fill()
        ctx.restore()
      })
    }

    // HUD pill helper
    const drawHudPill = (text: string, x: number, y: number) => {
      ctx.save()
      ctx.font = "600 11px var(--font-outfit), Arial, sans-serif"
      const paddingX = 8
      const textWidth = ctx.measureText(text).width
      const pillW = textWidth + paddingX * 2
      const pillH = 20
      ctx.fillStyle = darkMode ? "rgba(0,0,0,0.45)" : "rgba(255,255,255,0.55)"
      roundedRect(x, y, pillW, pillH, pillH / 2)
      ctx.fill()
      ctx.fillStyle = darkMode ? "#e8fff2" : "#123321"
      ctx.textBaseline = "middle"
      ctx.fillText(text, x + paddingX, y + pillH / 2 + 1)
      ctx.textBaseline = "alphabetic"
      ctx.restore()
    }

    // Draw campaign level indicator
    if (gameMode === GAME_MODES.CAMPAIGN && !isModePreview) {
      drawHudPill(`Level ${campaignLevel + 1}/${MAX_CAMPAIGN_LEVEL}`, 6, 6)
    }

    // Draw portals in portal mode
    if (gameMode === GAME_MODES.PORTAL) {
      PORTALS.forEach((portal) => {
        ctx.save()
        ctx.shadowBlur = 8
        // Draw entrance portal
        ctx.shadowColor = "rgba(59,130,246,0.8)"
        ctx.fillStyle = "#3b82f6"
        ctx.beginPath()
        ctx.arc(
          portal.entrance.x * CELL_SIZE + CELL_SIZE / 2,
          portal.entrance.y * CELL_SIZE + CELL_SIZE / 2,
          CELL_SIZE / 2,
          0,
          2 * Math.PI,
        )
        ctx.fill()

        // Draw exit portal
        ctx.shadowColor = "rgba(34,211,238,0.8)"
        ctx.fillStyle = "#22d3ee"
        ctx.beginPath()
        ctx.arc(
          portal.exit.x * CELL_SIZE + CELL_SIZE / 2,
          portal.exit.y * CELL_SIZE + CELL_SIZE / 2,
          CELL_SIZE / 2,
          0,
          2 * Math.PI,
        )
        ctx.fill()
        ctx.restore()
      })
    }

    // Draw reverse timer in reverse mode
    if (gameMode === GAME_MODES.REVERSE && !isModePreview) {
      drawHudPill(`Reverse in ${15 - reverseTimer}s`, 6, 6)
    }

    // Draw the snake at its random start position in the mode preview,
    // so the user can see where the snake will begin
    if (isModePreview) {
      snakeStart.segments.forEach((segment, index) => {
        const isHead = index === 0
        const x = segment.x * CELL_SIZE
        const y = segment.y * CELL_SIZE
        ctx.save()
        if (isHead) {
          ctx.shadowColor = darkMode ? "rgba(34, 217, 122, 0.9)" : "rgba(23, 183, 106, 0.6)"
          ctx.shadowBlur = 8
          ctx.fillStyle = darkMode ? "#3af08d" : "#17b76a"
        } else {
          ctx.fillStyle = darkMode ? "rgba(58, 240, 141, 0.85)" : "rgba(23, 183, 106, 0.85)"
        }
        roundedRect(x + 1, y + 1, CELL_SIZE - 2, CELL_SIZE - 2, isHead ? 5 : 4)
        ctx.fill()
        ctx.restore()
      })
    }

    // Mode preview overlay on the start screen: the canvas IS the mode display
    if (isModePreview) {
      // Dim the board so the text pops
      ctx.fillStyle = darkMode ? "rgba(0,0,0,0.45)" : "rgba(255,255,255,0.55)"
      ctx.fillRect(0, 0, canvas.width, canvas.height)

      ctx.save()
      ctx.textAlign = "center"
      ctx.textBaseline = "middle"

      // Mode name
      ctx.font = "700 32px var(--font-outfit), Arial, sans-serif"
      ctx.fillStyle = darkMode ? "#ffffff" : "#123321"
      ctx.shadowColor = "rgba(0,0,0,0.3)"
      ctx.shadowBlur = 10
      ctx.fillText(activeMode.name.toUpperCase(), canvas.width / 2, canvas.height / 2 - 34)

      // Mode description
      ctx.shadowBlur = 0
      ctx.font = "400 12px var(--font-outfit), Arial, sans-serif"
      ctx.fillStyle = darkMode ? "rgba(255,255,255,0.8)" : "rgba(18,51,33,0.8)"
      ctx.fillText(getGameModeDescription(), canvas.width / 2, canvas.height / 2 - 4)

      // Campaign level on the preview, so the player knows which level starts
      if (gameMode === GAME_MODES.CAMPAIGN) {
        ctx.font = "700 14px var(--font-outfit), Arial, sans-serif"
        ctx.fillStyle = darkMode ? "#3af08d" : "#0d8a4e"
        ctx.fillText(
          `LEVEL ${campaignLevel + 1} / ${MAX_CAMPAIGN_LEVEL}`,
          canvas.width / 2,
          canvas.height / 2 + 18,
        )
      }

      // Swipe hint
      ctx.font = "600 12px var(--font-outfit), Arial, sans-serif"
      ctx.fillStyle = darkMode ? "#3af08d" : "#0d8a4e"
      ctx.fillText("←  Swipe / drag to change  →", canvas.width / 2, canvas.height / 2 + 42)

      // Position in the mode list
      ctx.font = "600 11px var(--font-outfit), Arial, sans-serif"
      ctx.fillStyle = darkMode ? "rgba(255,255,255,0.6)" : "rgba(18,51,33,0.6)"
      ctx.fillText(`${activeModeIndex + 1} / ${MODE_LIST.length}`, canvas.width / 2, canvas.height / 2 + 62)

      ctx.textAlign = "start"
      ctx.textBaseline = "alphabetic"
      ctx.restore()
    }

    // Small mode pill on the game-over screen so swipe changes are visible there too
    if (gameOver && !isModePreview) {
      drawHudPill(`${activeMode.name} · ${activeModeIndex + 1}/${MODE_LIST.length}`, 6, 6)
    }

    // Draw countdown if active
    if (countdown > 0) {
      // Semi-transparent blurred overlay
      const overlay = ctx.createRadialGradient(
        canvas.width / 2,
        canvas.height / 2,
        10,
        canvas.width / 2,
        canvas.height / 2,
        canvas.width / 1.2,
      )
      overlay.addColorStop(0, "rgba(0,0,0,0.55)")
      overlay.addColorStop(1, "rgba(0,0,0,0.8)")
      ctx.fillStyle = overlay
      ctx.fillRect(0, 0, canvas.width, canvas.height)

      // Draw countdown number with glow — big arcade style
      ctx.save()
      ctx.shadowColor = "rgba(34, 217, 122, 0.95)"
      ctx.shadowBlur = 32
      ctx.fillStyle = "#ffffff"
      ctx.font = "900 110px 'Arial Black', 'Segoe UI Black', Impact, sans-serif"
      ctx.textAlign = "center"
      ctx.textBaseline = "middle"
      ctx.fillText(countdown.toString(), canvas.width / 2, canvas.height / 2)
      ctx.textAlign = "start"
      ctx.textBaseline = "alphabetic"
      ctx.restore()
    }

    // Draw paused overlay
    if (isPaused) {
      ctx.fillStyle = "rgba(0,0,0,0.45)"
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.save()
      ctx.fillStyle = "#ffffff"
      ctx.font = "bold 28px var(--font-outfit), Arial, sans-serif"
      ctx.textAlign = "center"
      ctx.textBaseline = "middle"
      ctx.fillText("Paused", canvas.width / 2, canvas.height / 2)
      ctx.textAlign = "start"
      ctx.textBaseline = "alphabetic"
      ctx.restore()
    }
  }, [
    skinItem,
    trailItem,
    foodItem,
    snake,
    food,
    walls,
    gameMode,
    gameStarted,
    gameOver,
    snakeStart,
    modePreviewActive,
    campaignLevel,
    reverseTimer,
    teleportEnabled,
    countdown,
    darkMode,
    graceActive,
    gridVisible,
    isPaused,
    smoothMove,
  ])

  // Update the game mode descriptions to reflect teleporting
  const getGameModeDescription = () => {
    switch (gameMode) {
      case GAME_MODES.CLASSIC:
        return "Classic snake gameplay"
      case GAME_MODES.SPEED:
        return "Snake speeds up as it grows"
      case GAME_MODES.WALLS:
        return "Teleport at edges, die on walls"
      case GAME_MODES.MAZE:
        return "Teleport at edges, navigate the maze"
      case GAME_MODES.BOX:
        return "Teleport at edges, avoid box obstacles"
      case GAME_MODES.TUNNEL:
        return "Teleport at edges, move through tunnels"
      case GAME_MODES.MILL:
        return "Teleport at edges, avoid rotating mill"
      case GAME_MODES.APARTMENT:
        return "Teleport at outer edges, die on inner walls"
      case GAME_MODES.CAMPAIGN:
        return `Teleport at edges, progress through ${MAX_CAMPAIGN_LEVEL} levels`
      case GAME_MODES.ZIGZAG:
        return "Navigate through a zigzag pattern of walls"
      case GAME_MODES.PORTAL:
        return "Use portals to teleport across the map"
      case GAME_MODES.REVERSE:
        return "Direction reverses every 15 seconds"
      case GAME_MODES.MULTIPLAYER:
        return "Live battles with friends (needs internet)"
      default:
        return ""
    }
  }

  // Clean up all timers when the component unmounts
  useEffect(() => {
    return () => {
      if (directionChangeTimeoutRef.current) {
        clearTimeout(directionChangeTimeoutRef.current)
      }
      if (millRotationRef.current) {
        clearInterval(millRotationRef.current)
      }
      if (reverseIntervalRef.current) {
        clearInterval(reverseIntervalRef.current)
      }
      if (graceTimeoutRef.current) {
        clearTimeout(graceTimeoutRef.current)
      }
      if (countdownRef.current) {
        clearInterval(countdownRef.current)
      }
      if (gameLoopRef.current) {
        clearInterval(gameLoopRef.current)
      }
    }
  }, [])

  // After a game ends the button says "Play Again" only until the player swipes to pick a mode; then it is a fresh "Start Game"
  const swipedAfterGameOver = gameOver && modePreviewActive

  // While a multiplayer room is open the lobby is the "home" view of the frame: closing any other panel returns to it
  const shownView: ViewId = activeView === "GAME" && mpView === "lobby" ? "MULTIPLAYER" : activeView
  const panelCtx = { activeView: shownView, setActiveView, frame: frameEl }
  const openLobby = () => { triggerHaptic(15); setMpView("lobby"); setActiveView("MULTIPLAYER") }
  // Frame close (x): use Android-back history entry when the panel pushed one, otherwise just switch view
  const closeFrame = () => {
    triggerHaptic(15)
    const hs = typeof history !== "undefined" ? (history.state as Record<string, unknown> | null) : null
    if (hs && (hs.store || hs.vault || hs.profile || hs.admin || hs.popup || hs.friends)) history.back()
    else setActiveView("GAME")
  }

  // ---- Landscape layout (game is locked to landscape) ----
  const playing = gameStarted && !gameOver
  // Multiplayer layout flag: leaderboard moves to the left column, exit button sits between Score and Best
  const isMultiplayerActive = mpView === "battle" && !!mpSession
  const inBattle = isMultiplayerActive
  const startLabel = gameOver && !swipedAfterGameOver ? "Play Again" : "Start Game"
  const glassBox = "bg-white/70 dark:bg-white/5 border border-black/5 dark:border-white/10"
  const dpadBtn = `${glassBox} d-pad-btn w-full h-full min-h-[48px] min-w-[48px] rounded-2xl flex items-center justify-center active:scale-95 transition-transform`
  const optBtn = (label: string, icon: React.ReactNode, onClick: () => void, variant: "on" | "off" | "gold" | "green" = "off") => (
    <button
      key={label}
      aria-label={label}
      onClick={() => { triggerHaptic(15); onClick() }}
      className={`d-pad-btn min-h-[48px] rounded-xl border text-[11px] font-bold px-1 py-1.5 flex flex-col items-center justify-center gap-0.5 active:scale-95 transition-transform ${
        variant === "gold" ? "border-amber-400 bg-amber-400/15 text-amber-600 dark:text-amber-300"
        : variant === "green" || variant === "on" ? "border-emerald-500 bg-emerald-500/15 text-emerald-600 dark:text-emerald-300"
        : `${glassBox} text-[#123321] dark:text-[#eafff3]`
      }`}
    >
      {icon}
      <span className="leading-none">{label}</span>
    </button>
  )
  const ic = "h-[18px] w-[18px]"

  return (
    <PanelHostContext.Provider value={panelCtx}>
    <div className="land-root bg-gradient-to-br from-[#f2f6f3] to-[#e2f0e7] dark:from-[#0d1f16] dark:to-[#123321] text-[#123321] dark:text-[#eafff3] animate-fade-in">
      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[300] rounded-2xl px-4 py-2.5 text-sm font-bold text-white bg-gradient-to-r from-amber-500 to-amber-400 shadow-xl">
          {toast}
        </div>
      )}
      <SessionGuard />
      <RotateHint />

      {/* LEFT column: future buttons in a vertical row — always visible (home, classic game, multiplayer / ranked battle) */}
      {SHOW_FUTURE_STRIP && (
        <aside className="shrink-0 w-[clamp(64px,9vw,84px)] min-h-0 overflow-y-auto overscroll-contain flex flex-col items-center justify-center gap-2 p-2 border-r border-dashed border-emerald-500/30 bg-emerald-500/[0.04]">
          <div className="text-[7px] tracking-[.12em] font-bold opacity-50 text-center leading-tight">FUTURE<br />BUTTONS</div>
          <div className="flex flex-col items-center gap-1.5">
            {[0, 1, 2].map((i) => <div key={i} aria-hidden className="h-12 w-12 rounded-xl border-[1.5px] border-dashed border-emerald-500/60 bg-emerald-500/[0.08]" />)}
          </div>
        </aside>
      )}

      {/* CENTER: logo + current map, the square board (max size), swipe hint */}
      <section className="relative flex-1 min-w-0 min-h-0 flex flex-col gap-1 p-2 overflow-hidden">
        {!playing && !inBattle && (
          <div className="shrink-0 flex items-center gap-2.5">
            <div className="leading-none">
              <div className="text-lg font-extrabold tracking-tight bg-gradient-to-r from-emerald-500 to-emerald-300 bg-clip-text text-transparent">Snake <span>PREMIUM</span></div>
              <div className="text-[8px] tracking-[.3em] uppercase opacity-50 font-semibold">Edition</div>
            </div>
          </div>
        )}
        {/* Swipe here to change mode. The inner square = min(width, height) of this area, so the board always fills the free space 1:1. */}
        <div className="flex-1 min-h-0 min-w-0 flex gap-2">
        {/* Multiplayer only: player leaderboard column left of the board */}
        <div ref={setMpLeftEl} className={isMultiplayerActive ? "shrink-0 w-[clamp(112px,17vw,168px)] min-h-0 py-1" : "hidden"} />
        <div ref={modeSwipeAreaRef} className="flex-1 min-h-0 min-w-0 flex items-center justify-center" style={{ containerType: "size" }}>
          <div
            ref={canvasWrapperRef}
            className={`relative rounded-2xl overflow-hidden premium-glow border border-black/10 dark:border-white/10 ${inBattle ? "hidden" : ""}`}
            style={{ width: "min(100cqw, 100cqh)", aspectRatio: "1 / 1" }}
          >
            <canvas
              ref={canvasRef}
              width={GRID_WIDTH * CELL_SIZE}
              height={GRID_HEIGHT * CELL_SIZE}
              className="block w-full h-full touch-none"
              style={{ imageRendering: "auto" }}
            />
            <SmoothSnakeLayer
              snake={snake}
              active={smoothMove && gameStarted && !gameOver}
              tickMs={speed}
              cell={CELL_SIZE}
              cols={GRID_WIDTH}
              rows={GRID_HEIGHT}
              skin={skinItem}
              graceActive={graceActive}
              darkMode={darkMode}
            />
          </div>
          {/* Multiplayer battle board portals in here (same size / frame as the classic board) */}
          <div ref={setMpCenterEl} className="contents" />
        </div>
        </div>
        {!playing && !inBattle && <div className="shrink-0 text-center text-[10px] opacity-50">Swipe ← → on the game to change mode</div>}

        {/* Panel layer: Store / Vault / Settings / Rank / Map / Profile / Friends / Mailbox / Admin / Multiplayer render in here */}
        <div ref={setFrameEl} className={`panel-layer absolute inset-0 z-20 overflow-hidden rounded-2xl ${shownView === "GAME" ? "hidden" : ""}`} />
        {/* Close (x) at the top-right of the frame -> back to the game view (the lobby has its own Leave / Close) */}
        {shownView !== "GAME" && shownView !== "MULTIPLAYER" && (
          <button
            aria-label="Close"
            onClick={closeFrame}
            className={`${glassBox} d-pad-btn absolute top-2 right-2 z-30 h-10 w-10 rounded-full flex items-center justify-center shadow-md active:scale-90 transition-transform`}
          >
            <X className="h-5 w-5" />
          </button>
        )}
      </section>

      {/* RIGHT panel: icons, score, options (scrolls when the screen is short) + pinned Start button */}
      <aside className="shrink-0 w-[clamp(184px,27vw,250px)] min-h-0 flex flex-col border-l border-black/5 dark:border-white/10 bg-white/40 dark:bg-white/[0.02]">
        {/* Battle dashboard slot (score, steering, exit) — the classic content below stays mounted but hidden */}
        <div ref={setMpSideEl} className={inBattle ? "flex-1 min-h-0 overflow-y-auto overscroll-contain p-2 flex flex-col gap-2" : "hidden"} />
        <div className={`flex-1 min-h-0 overflow-y-auto overscroll-contain p-2 flex-col gap-2 ${inBattle ? "hidden" : "flex"}`}>
          {/* header icons — kept mounted while playing (hidden) so their listeners keep running */}
          <div
            className={`${playing ? "hidden" : "grid"} justify-items-center gap-1.5 [&>button]:border [&>button]:border-black/10 dark:[&>button]:border-white/10 [&>button]:bg-white/60 dark:[&>button]:bg-white/5`}
            style={{ gridTemplateColumns: "repeat(auto-fit, minmax(48px, 1fr))" }}
          >
            <SnakeProfile />
            <SnakeFriends />
            <MailboxButton />
            <SnakeStore />
            <button
              aria-label="Settings"
              title="Settings"
              onClick={() => { triggerHaptic(15); setActiveView("SETTINGS") }}
              className="d-pad-btn inline-flex items-center justify-center h-12 w-12 rounded-full hover:bg-accent hover:text-accent-foreground"
            >
              <Settings className="h-5 w-5" />
            </button>
            <AdminButton />
            <SnakeVault />
            {/* Close (x): only while a panel is open in the central frame -> back to the game view */}
            {shownView !== "GAME" && shownView !== "MULTIPLAYER" && (
              <button
                aria-label="Close panel"
                title="Close"
                onClick={closeFrame}
                className="d-pad-btn animate-fade-in inline-flex items-center justify-center h-12 w-12 rounded-full text-red-500 active:scale-90 transition-transform"
              >
                <X className="h-5 w-5" />
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            <div className="rounded-xl bg-white/70 dark:bg-white/[0.06] border border-black/5 dark:border-white/10 px-2.5 py-1 text-center">
              <div className="text-[8px] uppercase tracking-wider opacity-50 font-semibold">Score</div>
              <div className="text-base font-extrabold tabular-nums leading-tight">{score}</div>
            </div>
            <div className="rounded-xl bg-white/70 dark:bg-white/[0.06] border border-black/5 dark:border-white/10 px-2.5 py-1 text-center">
              <div className="text-[8px] uppercase tracking-wider opacity-50 font-semibold">Best</div>
              <div className="text-base font-extrabold tabular-nums leading-tight">{highScore}</div>
            </div>
          </div>

          {playing ? (
            <>
              {/* Steering controls now live on the right */}
              {controlMode !== "swipe" && (
                <div className="flex-1 min-h-0 min-w-0 flex items-center justify-center" style={{ containerType: "size" }}>
                  <div className="grid gap-1.5" style={{ width: "min(100cqw, 100cqh)", aspectRatio: "1 / 1", gridTemplateColumns: "repeat(3, 1fr)", gridTemplateRows: "repeat(3, 1fr)" }}>
                    <div style={{ gridColumn: 2, gridRow: 1 }}><button aria-label="Up" onClick={() => handleDirectionClick(DIRECTIONS.UP)} className={dpadBtn}><ArrowUp className="h-6 w-6" /></button></div>
                    <div style={{ gridColumn: 1, gridRow: 2 }}><button aria-label="Left" onClick={() => handleDirectionClick(DIRECTIONS.LEFT)} className={dpadBtn}><ArrowLeft className="h-6 w-6" /></button></div>
                    <div style={{ gridColumn: 3, gridRow: 2 }}><button aria-label="Right" onClick={() => handleDirectionClick(DIRECTIONS.RIGHT)} className={dpadBtn}><ArrowRight className="h-6 w-6" /></button></div>
                    <div style={{ gridColumn: 2, gridRow: 3 }}><button aria-label="Down" onClick={() => handleDirectionClick(DIRECTIONS.DOWN)} className={dpadBtn}><ArrowDown className="h-6 w-6" /></button></div>
                  </div>
                </div>
              )}
              {controlMode !== "buttons" && (
                <div
                  ref={swipeAreaRef}
                  id="swipe-area"
                  className={`${glassBox} w-full flex-1 min-h-[96px] rounded-2xl relative overflow-hidden`}
                  style={{ touchAction: "none" }}
                >
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-muted-foreground pointer-events-none">
                    <ArrowUp className="h-4 w-4 opacity-50" />
                    <div className="flex gap-2 items-center opacity-50">
                      <ArrowLeft className="h-4 w-4" />
                      <span className="text-xs font-medium">Swipe to steer</span>
                      <ArrowRight className="h-4 w-4" />
                    </div>
                    <ArrowDown className="h-4 w-4 opacity-50" />
                  </div>
                </div>
              )}
              {/* One compact split button: Pause | Exit (icons only) */}
              <div className={`${glassBox} shrink-0 flex h-11 w-full rounded-2xl overflow-hidden`}>
                <button aria-label={isPaused ? "Resume" : "Pause"} title={isPaused ? "Resume" : "Pause"} onClick={togglePause} className="d-pad-btn flex-1 flex items-center justify-center active:bg-black/10 dark:active:bg-white/10">
                  {isPaused ? <Play className="h-5 w-5" /> : <Pause className="h-5 w-5" />}
                </button>
                <div className="w-px my-2 bg-black/15 dark:bg-white/20" />
                <button aria-label="Exit" title="Exit" onClick={exitGame} className="d-pad-btn flex-1 flex items-center justify-center text-red-500 active:bg-black/10 dark:active:bg-white/10">
                  <X className="h-5 w-5" />
                </button>
              </div>
            </>
          ) : (
            <>
              {gameOver && !swipedAfterGameOver && (
                <div className={`${glassBox} text-center rounded-2xl py-2 px-3`}>
                  <div className="text-xs text-muted-foreground">Game Over</div>
                  <div className="text-xl font-extrabold">{score} pts</div>
                  {gameMode === GAME_MODES.CAMPAIGN && campaignLevel === MAX_CAMPAIGN_LEVEL - 1 && score >= 5 && (
                    <div className="text-emerald-500 font-medium mt-1 text-xs">🏆 You completed all 100 levels!</div>
                  )}
                </div>
              )}
              <div className="text-[9px] tracking-[.2em] text-center opacity-45 font-bold">OPTIONS</div>
              <div className="grid grid-cols-2 gap-1.5">
                {optBtn("Rank", <Trophy className={ic} />, () => setActiveView("RANK"), "gold")}
                {optBtn("Map", <MapIcon className={ic} />, () => setActiveView("MAP"), "green")}
                {optBtn("Teleport", <Shuffle className={ic} />, () => setTeleportEnabled(!teleportEnabled), teleportEnabled ? "on" : "off")}
                {optBtn("Grid", <Grid3x3 className={ic} />, () => setGridVisible(!gridVisible), gridVisible ? "on" : "off")}
              </div>
            </>
          )}
        </div>
        {!playing && !inBattle && (
          <div className="shrink-0 p-2 pt-1" style={{ paddingBottom: "max(8px, 0px)" }}>
            {/* Action bar: [ Start ] | [ 🚪 Leave Room (only inside a room) ] | [ Multiplayer ] */}
            {(() => {
              const inRoom = mpView === "lobby" && mpLobbyInfo.inRoom
              const isHost = inRoom && mpLobbyInfo.isHost
              // Inside a room only the host can start; everybody else sees "Waiting for Host..."
              const startDisabled = inRoom && !mpLobbyInfo.canStart
              const startTitle = !inRoom
                ? startLabel
                : !isHost
                  ? "Waiting for Host..."
                  : mpLobbyInfo.canStart || mpLobbyInfo.starting
                    ? "Start battle"
                    : `Need at least ${mpLobbyInfo.minPlayers} players`
              return (
                <div className="flex h-[52px] w-full rounded-2xl overflow-hidden text-white bg-gradient-to-r from-emerald-500 to-emerald-400 shadow-lg shadow-emerald-500/40">
                  <button
                    aria-label={startTitle}
                    title={startTitle}
                    disabled={startDisabled}
                    onClick={() => {
                      triggerHaptic(15)
                      if (inRoom) { if (isHost) mpLobbyActionsRef.current?.start(); return }
                      mpView === "lobby" || gameMode === GAME_MODES.MULTIPLAYER ? openLobby() : initGame()
                    }}
                    className="d-pad-btn flex-1 min-w-0 flex flex-col items-center justify-center gap-0.5 px-1 active:bg-white/25 disabled:opacity-50 disabled:cursor-not-allowed disabled:active:bg-transparent"
                  >
                    <Play className="h-5 w-5" />
                    <span className={`font-extrabold text-center ${inRoom && !isHost ? "text-[8px] leading-[1.05]" : "text-[10px] leading-none"}`}>
                      {inRoom
                        ? !isHost ? "Waiting for Host..." : mpLobbyInfo.starting ? "Starting…" : "Start"
                        : gameOver && !swipedAfterGameOver ? "Play Again" : "Start"}
                    </span>
                  </button>
                  {inRoom && (
                    <>
                      <div className="w-px my-2 bg-white/50" />
                      <button
                        aria-label="Leave Room"
                        title="Leave Room"
                        onClick={() => { triggerHaptic(15); void mpLobbyActionsRef.current?.leave() }}
                        className="d-pad-btn shrink-0 w-12 flex items-center justify-center active:bg-white/25"
                      >
                        <LogOut className="h-5 w-5" />
                      </button>
                    </>
                  )}
                  <div className="w-px my-2 bg-white/50" />
                  <button
                    aria-label="Multiplayer"
                    onClick={openLobby}
                    className="d-pad-btn flex-1 min-w-0 flex flex-col items-center justify-center gap-0.5 px-1 active:bg-white/25"
                  >
                    <Users className="h-5 w-5" />
                    <span className="text-[10px] font-extrabold leading-none">Multiplayer</span>
                  </button>
                </div>
              )
            })()}
          </div>
        )}
      </aside>

      {activeView === "RANK" && <RankPopup onClose={() => setActiveView("GAME")} />}
      {activeView === "MAP" && (
        <MapPopup
          modes={MODE_LIST.map((m) => ({ value: m.value, name: m.name, ...getModePreviewLayout(m.value) }))}
          active={gameMode}
          onPick={(v) => {
            triggerHaptic(15)
            setGameMode(v as typeof gameMode)
            if (gameOver) setModePreviewActive(true)
            setActiveView("GAME")
          }}
          onClose={() => setActiveView("GAME")}
        />
      )}
      {activeView === "SETTINGS" && (
        <SettingsPopup
          soundEnabled={soundEnabled}
          setSoundEnabled={setSoundEnabled}
          volume={volume}
          setVolume={setVolume}
          darkMode={darkMode}
          setDarkMode={setDarkMode}
          controlMode={controlMode}
          setControlMode={(m) => { triggerHaptic(15); setControlMode(m) }}
          hapticEnabled={hapticEnabled}
          setHapticEnabled={setHapticEnabled}
          hapticSupported={!mounted || isVibrationSupported()}
          smoothMove={smoothMove}
          setSmoothMove={(v) => { triggerHaptic(15); setSmoothMove(v) }}
          onClose={() => setActiveView("GAME")}
        />
      )}

      {/* Multiplayer lobby lives inside the central frame (stays mounted, hidden, while another panel is shown on top) */}
      {mpView === "lobby" && frameEl && createPortal(
        <div className={shownView === "MULTIPLAYER" ? "contents" : "hidden"}>
          <MultiplayerLobby
            darkMode={darkMode}
            onRoomInfo={setMpLobbyInfo}
            actionsRef={mpLobbyActionsRef}
            onExit={() => {
              setMpView("none")
              setMpSession(null)
              setActiveView("GAME")
            }}
            onBattleStart={(c, p) => {
              setMpSession({ code: c, playerId: p })
              setMpView("battle")
              setActiveView("GAME")
            }}
            initialCode={mpSession?.code}
            initialPlayerId={mpSession?.playerId}
          />
        </div>,
        frameEl,
      )}
      {mpView === "battle" && mpSession && (
        <BattleRouter
          code={mpSession.code}
          playerId={mpSession.playerId}
          darkMode={darkMode}
          controlMode={controlMode}
          soundEnabled={soundEnabled}
          volume={volume}
          smoothMove={smoothMove}
          centerEl={mpCenterEl}
          sideEl={mpSideEl}
          leftEl={mpLeftEl}
          bestScore={highScore}
          onExit={() => {
            setMpView("none")
            setMpSession(null)
          }}
          onBackToLobby={() => { setMpView("lobby"); setActiveView("MULTIPLAYER") }}
        />
      )}
      {/* Room-invite notifications (signed-in players only) */}
      {user && <InvitePopup darkMode={darkMode} onAccept={handleInviteAccept} />}
    </div>
    </PanelHostContext.Provider>
  )
}
