import {
  CELLS_PER_PLAYER,
  finishedProgress,
  globalCell,
  homeEntryProgress,
  trackLength,
} from './engine'
import type { GameState, Player, PowerTile, PowerUpType, Room, Token } from './types'

export const ACTIVE_POWER_TYPES: PowerUpType[] = [
  'rocket',
  'spring',
  'x2',
  'shield',
  'flame',
  'back2',
  'back3',
  'yard',
  'tnt',
  'ice',
]

export const POWER_UP_ICONS: Record<PowerUpType, string> = {
  tnt: 'TNT',
  rocket: '🚀',
  spring: '↗',
  shield: '🛡',
  flame: '🔥',
  x2: 'x2',
  x3: 'x3',
  star: '★',
  ice: '❄',
  portal: '◎',
  back2: '←2',
  back3: '←3',
  yard: 'YRD',
}

export const POWER_UP_INFO: {
  type: PowerUpType
  label: string
  description: string
}[] = [
  { type: 'rocket', label: 'Rocket', description: 'Surge 3 extra steps forward' },
  { type: 'spring', label: 'Spring', description: 'Bounce 2 extra steps ahead' },
  { type: 'x2', label: 'x2', description: 'Repeats your dice roll as bonus steps' },
  { type: 'shield', label: 'Shield', description: 'Blocks the next capture attempt' },
  { type: 'flame', label: 'Flame', description: 'Grants a bonus roll after this turn' },
  { type: 'back2', label: 'Back 2', description: 'Slides your token 2 steps backward' },
  { type: 'back3', label: 'Back 3', description: 'Slides your token 3 steps backward' },
  { type: 'yard', label: 'Yard', description: 'Sends your token back to the yard' },
  { type: 'tnt', label: 'TNT', description: 'Blasts rival tokens on the same cell back to yard' },
  { type: 'ice', label: 'Ice', description: 'Pushes rivals on this cell back 3 steps' },
]

export function powerUpLabel(type: PowerUpType) {
  return POWER_UP_INFO.find((entry) => entry.type === type)?.label ?? type
}

export function powerUpDescription(type: PowerUpType) {
  return POWER_UP_INFO.find((entry) => entry.type === type)?.description ?? ''
}

const SLOT_OFFSETS = [4, 10]
const YARD_OFFSET = 7
const TNT_OFFSET = 3
const RARE_POWER_COUNT = 2

const COMMON_CYCLE: PowerUpType[] = [
  'rocket',
  'back2',
  'spring',
  'x2',
  'back3',
  'shield',
  'ice',
  'flame',
]

function spacedSeats(playerCount: number, count: number, startSeat: number): number[] {
  const step = Math.max(1, Math.floor(playerCount / count))
  return Array.from({ length: count }, (_, index) => (startSeat + index * step) % playerCount)
}

export function generatePowerTiles(playerCount: number): Record<number, PowerUpType> {
  const length = playerCount * CELLS_PER_PLAYER
  const tiles: Record<number, PowerUpType> = {}

  for (let seat = 0; seat < playerCount; seat += 1) {
    for (let slot = 0; slot < SLOT_OFFSETS.length; slot += 1) {
      const cell = (seat * CELLS_PER_PLAYER + SLOT_OFFSETS[slot]) % length
      tiles[cell] = COMMON_CYCLE[(seat * SLOT_OFFSETS.length + slot) % COMMON_CYCLE.length]
    }
  }

  const yardSeats = spacedSeats(playerCount, RARE_POWER_COUNT, 0)
  const tntSeats = spacedSeats(
    playerCount,
    RARE_POWER_COUNT,
    Math.max(1, Math.floor(playerCount / 4)),
  )

  for (const seat of yardSeats) {
    tiles[(seat * CELLS_PER_PLAYER + YARD_OFFSET) % length] = 'yard'
  }
  for (const seat of tntSeats) {
    tiles[(seat * CELLS_PER_PLAYER + TNT_OFFSET) % length] = 'tnt'
  }

  return tiles
}

export function powerTilesList(
  tiles: Record<number, PowerUpType> | undefined,
): PowerTile[] {
  if (!tiles) return []
  return Object.entries(tiles).map(([cell, type]) => ({
    cell: Number(cell),
    type,
  }))
}

export function powerUpAtCell(
  game: GameState | null | undefined,
  cell: number | null,
): PowerUpType | null {
  if (!game?.powerTiles || cell === null) return null
  return game.powerTiles[cell] ?? null
}

function advanceToken(token: Token, steps: number, room: Room) {
  const finish = finishedProgress(room)
  const homeEntry = homeEntryProgress(room)
  if (token.progress < 0) return
  const maxOnTrack = homeEntry
  token.progress = Math.min(token.progress + steps, finish)
  if (token.progress > maxOnTrack && token.progress < finish) {
    token.progress = maxOnTrack
  }
}

function retreatToken(token: Token, steps: number) {
  if (token.progress < 0) return
  token.progress = Math.max(-1, token.progress - steps)
}

function opponentsOnCell(
  game: GameState,
  playerId: string,
  cell: number,
  room: Room,
) {
  return game.tokens.filter(
    (candidate) =>
      candidate.playerId !== playerId &&
      globalCell(candidate, room) === cell,
  )
}

export function applyPowerUp(
  room: Room,
  player: Player,
  token: Token,
  type: PowerUpType,
  landingCell: number,
): string {
  const game = room.game!
  game.shieldBuff ??= {}

  switch (type) {
    case 'tnt': {
      let blasted = 0
      for (const opponent of opponentsOnCell(game, player.id, landingCell, room)) {
        if (game.shieldBuff[opponent.playerId]) {
          game.shieldBuff[opponent.playerId] = false
          continue
        }
        opponent.progress = -1
        blasted += 1
      }
      return blasted > 0
        ? `${player.name} triggered TNT and blasted ${blasted} token(s)`
        : `${player.name} triggered TNT`
    }
    case 'rocket':
      advanceToken(token, 3, room)
      return `${player.name} hit a rocket and surged ahead`
    case 'spring':
      advanceToken(token, 2, room)
      return `${player.name} bounced on a spring`
    case 'shield':
      game.shieldBuff[player.id] = true
      return `${player.name} picked up a shield`
    case 'flame':
      game.pendingExtraTurn = player.id
      return `${player.name} ignited a flame bonus turn`
    case 'x2':
      advanceToken(token, game.dice ?? 0, room)
      return `${player.name} doubled the roll with x2`
    case 'x3': {
      const bonus = (game.dice ?? 0) * 2
      advanceToken(token, bonus, room)
      return `${player.name} tripled momentum with x3`
    }
    case 'star':
      return `${player.name} landed on a power star`
    case 'ice': {
      let frozen = 0
      for (const opponent of opponentsOnCell(game, player.id, landingCell, room)) {
        if (opponent.progress > 0) {
          opponent.progress = Math.max(0, opponent.progress - 3)
          frozen += 1
        }
      }
      return frozen > 0
        ? `${player.name} froze ${frozen} rival token(s)`
        : `${player.name} slid over ice`
    }
    case 'portal': {
      const length = trackLength(room)
      const jump = Math.floor(length / 2)
      const targetCell = (landingCell + jump) % length
      const seat = player.seat
      const startCell = seat * CELLS_PER_PLAYER
      let targetProgress = (targetCell - startCell + length) % length
      if (targetProgress >= homeEntryProgress(room)) {
        targetProgress = homeEntryProgress(room) - 1
      }
      token.progress = Math.max(token.progress, targetProgress)
      return `${player.name} warped through a portal`
    }
    case 'back2':
      retreatToken(token, 2)
      return `${player.name} slid back 2 steps`
    case 'back3':
      retreatToken(token, 3)
      return `${player.name} slid back 3 steps`
    case 'yard':
      token.progress = -1
      return `${player.name} was sent back to the yard`
    default:
      return `${player.name} triggered a power tile`
  }
}

export function powerGrantsExtraTurn(game: GameState, playerId: string) {
  if (game.pendingExtraTurn === playerId) {
    game.pendingExtraTurn = null
    return true
  }
  return false
}
