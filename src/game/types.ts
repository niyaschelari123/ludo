export const PLAYER_COLORS = [
  'red',
  'green',
  'yellow',
  'blue',
  'orange',
  'purple',
  'cyan',
  'pink',
] as const

export type PlayerColor = (typeof PLAYER_COLORS)[number]
export type RoomStatus = 'lobby' | 'playing' | 'finished'
export type TurnPhase = 'roll' | 'move' | 'power'
export type GameMode = 'classic' | 'power'
export type PowerUpType =
  | 'tnt'
  | 'rocket'
  | 'spring'
  | 'shield'
  | 'flame'
  | 'x2'
  | 'x3'
  | 'star'
  | 'ice'
  | 'portal'

export interface PowerTile {
  cell: number
  type: PowerUpType
}

export interface Player {
  id: string
  name: string
  color: PlayerColor
  seat: number
  connected: boolean
  joinedAt: number
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
  while (progress < target && steps < 40) {
    steps += 1
    progress = progress === -1 ? 0 : progress + 1
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
  for (let step = 0; step < stepsTaken; step += 1) {
    if (progress >= target) {
      return { progress: target, done: true, target }
    }
    progress = progress === -1 ? 0 : progress + 1
  }

  return { progress, done: progress >= target, target }
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

export interface GameState {
  turnIndex: number
  phase: TurnPhase
  dice: number | null
  consecutiveSixes: number
  entryMisses: Record<string, number>
  finishMisses: Record<string, number>
  protectionForfeited: Record<string, boolean>
  winnerIds: string[]
  tokens: Token[]
  lastAction: string
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
