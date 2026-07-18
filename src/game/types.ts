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
export type TurnPhase = 'roll' | 'move'

export interface Player {
  id: string
  name: string
  color: PlayerColor
  seat: number
  connected: boolean
  joinedAt: number
}

export interface Token {
  id: number
  playerId: string
  progress: number
}

export interface GameState {
  turnIndex: number
  phase: TurnPhase
  dice: number | null
  consecutiveSixes: number
  entryMisses: Record<string, number>
  protectionForfeited: Record<string, boolean>
  winnerIds: string[]
  tokens: Token[]
  lastAction: string
}

export interface Room {
  id: string
  code: string
  hostId: string
  memberIds: string[]
  maxPlayers: number
  status: RoomStatus
  players: Player[]
  game: GameState | null
  createdAt: number
  updatedAt: number
}
