import {
  CELLS_PER_PLAYER,
  finishedProgress,
  globalCell,
  homeEntryProgress,
  isSoleTokenProtected,
  recordCapture,
  recordEliminated,
  safeCells,
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
  'back5',
  'plus10',
  'tnt',
  'ice',
]

export const POWER_UP_ICONS: Record<PowerUpType, string> = {
  plus10: '+10',
  half: '+10',
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
  back5: '-5',
  yard: 'YRD',
}

export const POWER_UP_INFO: {
  type: PowerUpType
  label: string
  description: string
}[] = [
  { type: 'rocket', label: 'Rocket', description: 'x3 your dice roll as a forward surge' },
  { type: 'spring', label: 'Spring', description: 'Bounce 2 extra steps ahead' },
  { type: 'x2', label: 'x2', description: 'Repeats your dice roll as bonus steps' },
  { type: 'shield', label: 'Shield', description: 'Blocks the next capture attempt (one shield at a time)' },
  { type: 'flame', label: 'Flame', description: 'Grants a bonus roll after this turn' },
  { type: 'back2', label: 'Back 2', description: 'Slides your token 2 steps backward' },
  { type: 'back3', label: 'Back 3', description: 'Slides your token 3 steps backward' },
  { type: 'back5', label: '-5', description: 'Slides your token 5 steps backward' },
  { type: 'plus10', label: '+10', description: 'Surges your token 10 steps forward' },
  {
    type: 'tnt',
    label: 'TNT',
    description: 'Eliminates unprotected tokens on this cell and sends them to the yard',
  },
  { type: 'ice', label: 'Ice', description: 'Pushes rivals on this cell back 3 steps' },
]

export function powerUpLabel(type: PowerUpType) {
  if (type === 'half') return '+10'
  return POWER_UP_INFO.find((entry) => entry.type === type)?.label ?? type
}

export function powerUpDescription(type: PowerUpType) {
  if (type === 'half') return 'Surges your token 10 steps forward'
  return POWER_UP_INFO.find((entry) => entry.type === type)?.description ?? ''
}

const SLOT_OFFSETS = [4, 10]
const PLUS10_OFFSET = 3
const TNT_OFFSET = 9
const RARE_POWER_COUNT = 2
const SHIELD_COUNT = 3
const EXTRA_ROCKET_COUNT = 2
const BACK5_COUNT = 1

const COMMON_CYCLE: PowerUpType[] = [
  'rocket',
  'back2',
  'spring',
  'x2',
  'back3',
  'ice',
  'flame',
]

function spacedSeats(playerCount: number, count: number, startSeat: number): number[] {
  const step = Math.max(1, Math.floor(playerCount / count))
  return Array.from({ length: count }, (_, index) => (startSeat + index * step) % playerCount)
}

function placeSpacedPower(
  tiles: Record<number, PowerUpType>,
  length: number,
  count: number,
  type: PowerUpType,
  startShift = 0,
) {
  const step = Math.max(1, Math.floor(length / count))
  const start = (Math.floor(step / 2) + startShift) % length
  let placed = 0

  for (let index = 0; index < count; index += 1) {
    const preferred = (start + index * step) % length
    for (let offset = 0; offset < length; offset += 1) {
      const cell = (preferred + offset) % length
      if (tiles[cell]) continue
      tiles[cell] = type
      placed += 1
      break
    }
  }

  return placed
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

  const plus10Seats = spacedSeats(
    playerCount,
    RARE_POWER_COUNT,
    Math.max(1, Math.floor(playerCount / 4)),
  )
  const tntSeat = Math.floor(playerCount / 2) % playerCount

  for (const seat of plus10Seats) {
    if (seat === tntSeat) continue
    tiles[(seat * CELLS_PER_PLAYER + PLUS10_OFFSET) % length] = 'plus10'
  }

  tiles[(tntSeat * CELLS_PER_PLAYER + TNT_OFFSET) % length] = 'tnt'
  placeSpacedPower(tiles, length, SHIELD_COUNT, 'shield')
  placeSpacedPower(tiles, length, EXTRA_ROCKET_COUNT, 'rocket', 3)
  placeSpacedPower(tiles, length, BACK5_COUNT, 'back5', 5)

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

function eliminateTokenFromTnt(
  room: Room,
  playerId: string,
  token: Token,
  cell: number | null,
): boolean {
  const game = room.game
  if (!game || cell === null || safeCells(room).has(cell)) return false
  if (powerUpAtCell(game, cell) !== 'tnt') return false

  game.shieldBuff ??= {}
  if (game.shieldBuff[playerId]) {
    game.shieldBuff[playerId] = false
    return false
  }
  if (isSoleTokenProtected(game, playerId, room)) return false

  token.progress = -1
  recordEliminated(game, playerId)
  return true
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
        if (isSoleTokenProtected(game, opponent.playerId, room)) continue
        if (game.shieldBuff[opponent.playerId]) {
          game.shieldBuff[opponent.playerId] = false
          continue
        }
        opponent.progress = -1
        recordCapture(game, player.id, opponent.playerId)
        blasted += 1
      }
      const selfEliminated = eliminateTokenFromTnt(
        room,
        player.id,
        token,
        landingCell,
      )
      if (selfEliminated) {
        return blasted > 0
          ? `${player.name} triggered TNT, blasted ${blasted} token(s), and was eliminated`
          : `${player.name} triggered TNT and was eliminated`
      }
      return blasted > 0
        ? `${player.name} triggered TNT and blasted ${blasted} token(s)`
        : `${player.name} triggered TNT`
    }
    case 'plus10':
    case 'half': {
      advanceToken(token, 10, room)
      return `${player.name} surged +10`
    }
    case 'rocket': {
      const bonus = (game.dice ?? 0) * 2
      advanceToken(token, bonus, room)
      return `${player.name} hit a rocket and surged x3`
    }
    case 'spring':
      advanceToken(token, 2, room)
      return `${player.name} bounced on a spring`
    case 'shield':
      if (game.shieldBuff[player.id]) {
        return `${player.name} already has shield protection`
      }
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
    case 'back5':
      retreatToken(token, 5)
      return `${player.name} slid back 5 steps`
    case 'yard':
      // Legacy tile — no longer generated; treat as a harmless pass.
      return `${player.name} passed an old yard tile`
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
