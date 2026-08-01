export const PLAYER_COLORS = [
  'red',
  'green',
  'yellow',
  'blue',
  'orange',
  'purple',
  'cyan',
  'pink',
  'teal',
  'lime',
] as const

export type PlayerColor = (typeof PLAYER_COLORS)[number]
export type RoomStatus = 'lobby' | 'playing' | 'finished'
export type TurnPhase = 'roll' | 'move' | 'power'
export type GameMode = 'classic' | 'power' | 'quick'

/** Power and Quick place tiles on the track. */
export function hasPowerBoard(mode: GameMode | null | undefined): boolean {
  return mode === 'power' || mode === 'quick'
}

export function gameModeLabel(mode: GameMode | null | undefined): string {
  if (mode === 'power') return 'Power'
  if (mode === 'quick') return 'Quick'
  return 'Classic'
}
export type PowerUpType =
  | 'plus10'
  | 'half' // legacy; treated as plus10 if present in old rooms
  | 'rocket'
  | 'spring'
  | 'shield'
  | 'flame'
  | 'x2'
  | 'x3'
  | 'star'
  | 'ice'
  | 'portal'
  | 'super'
  | 'back2'
  | 'back3'
  | 'back5'
  | 'yard' // legacy; no longer generated
  | 'tnt'

export interface PowerTile {
  cell: number
  type: PowerUpType
}

export interface Player {
  id: string
  name: string
  /** Named preset or #rrggbb hex. */
  color: string
  seat: number
  connected: boolean
  isBot?: boolean
  /** Host-enabled: server plays this human seat until cancelled. */
  autoPlay?: boolean
  /** Locked profile color — preserved across seat shuffle. */
  colorLocked?: boolean
  joinedAt: number
}

/** Bots and host-autoplay humans are driven by the server. */
export function isAutoControlled(player: Player | null | undefined): boolean {
  return Boolean(player?.isBot || player?.autoPlay)
}

export interface DepartedPlayer extends Player {
  leftAt: number
}

export interface Token {
  id: number
  playerId: string
  progress: number
}

export interface MovingToken {
  playerId: string
  id: number
  fromProgress: number
  dice: number
  startedAt?: number
  targetProgress?: number
}

export interface ActiveMove {
  playerId: string
  tokenId: number
  fromProgress: number
  dice: number
  startedAt: number
  targetProgress?: number
}

export const TOKEN_MOVE_STEP_MS = 135
export const TOKEN_MOVE_END_PADDING_MS = 240

export const movingTokenTarget = (
  move: Pick<MovingToken, 'fromProgress' | 'dice' | 'targetProgress'>,
) =>
  move.targetProgress ??
  (move.fromProgress === -1 ? 0 : move.fromProgress + move.dice)

export const moveAnimStepCount = (move: MovingToken) => {
  const target = movingTokenTarget(move)
  let progress = move.fromProgress
  let steps = 0
  const forward = target >= (move.fromProgress === -1 ? 0 : move.fromProgress)
  if (forward) {
    while (progress < target && steps < 40) {
      steps += 1
      progress = progress === -1 ? 0 : progress + 1
    }
  } else {
    while (progress > target && steps < 40) {
      steps += 1
      progress = progress <= 0 ? -1 : progress - 1
    }
  }
  return Math.max(steps, 1)
}

export const tokenMoveDurationMs = (
  move: Pick<MovingToken, 'fromProgress' | 'dice' | 'targetProgress'>,
) =>
  moveAnimStepCount(move as MovingToken) * TOKEN_MOVE_STEP_MS + TOKEN_MOVE_END_PADDING_MS

export const moveBaseSignature = (move: MovingToken) =>
  `${move.playerId}:${move.id}:${move.fromProgress}:${movingTokenTarget(move)}`

export const resolveAnimationProgress = (movingToken: MovingToken) => {
  const target = movingTokenTarget(movingToken)
  if (!movingToken.startedAt) {
    return { progress: movingToken.fromProgress, done: false, target }
  }

  const stepsTaken = Math.floor(
    (Date.now() - movingToken.startedAt) / TOKEN_MOVE_STEP_MS,
  )
  if (stepsTaken <= 0) {
    return { progress: movingToken.fromProgress, done: false, target }
  }

  let progress = movingToken.fromProgress
  const forward = target >= (movingToken.fromProgress === -1 ? 0 : movingToken.fromProgress)
  for (let step = 0; step < stepsTaken; step += 1) {
    if (forward) {
      if (progress >= target) {
        return { progress: target, done: true, target }
      }
      progress = progress === -1 ? 0 : progress + 1
    } else {
      if (progress <= target) {
        return { progress: target, done: true, target }
      }
      progress = progress <= 0 ? -1 : progress - 1
    }
  }

  return {
    progress,
    done: forward ? progress >= target : progress <= target,
    target,
  }
}

export interface PendingPower {
  playerId: string
  tokenId: number
  type: PowerUpType
  landingCell: number
  captured: boolean
  sharedProtectedCell: boolean
  forfeitedProtection: boolean
}

export interface PlayerStats {
  captures: number
  eliminated: number
  tokensHome: number
  sixes: number
  /** attacker -> how many times this player eliminated that opponent */
  eliminatedPlayers: Record<string, number>
}

export interface GameState {
  turnIndex: number
  phase: TurnPhase
  dice: number | null
  consecutiveSixes: number
  boardPlayerCount: number
  turnDeadline: number | null
  turnMisses: Record<string, number>
  /** Per-player miss allowance before removal. Defaults to MAX_TURN_MISSES. */
  turnMissLimits?: Record<string, number>
  entryMisses: Record<string, number>
  finishMisses: Record<string, number>
  protectionForfeited: Record<string, boolean>
  winnerIds: string[]
  tokens: Token[]
  lastAction: string
  stats?: Record<string, PlayerStats>
  activeMove?: ActiveMove | null
  powerTiles?: Record<number, PowerUpType>
  shieldBuff?: Record<string, boolean>
  pendingExtraTurn?: string | null
  pendingPower?: PendingPower | null
}

export interface Room {
  id: string
  code: string
  hostId: string
  memberIds: string[]
  maxPlayers: number
  gameMode: GameMode
  status: RoomStatus
  players: Player[]
  departedPlayers: DepartedPlayer[]
  game: GameState | null
  createdAt: number
  updatedAt: number
}
