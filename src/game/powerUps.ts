import {
  CELLS_PER_PLAYER,
  finishedProgress,
  globalCell,
  homeEntryProgress,
  trackLength,
} from './engine'
import type { GameState, Player, PowerTile, PowerUpType, Room, Token } from './types'

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
}

const POWER_CYCLE: PowerUpType[] = [
  'rocket',
  'x2',
  'spring',
  'tnt',
  'shield',
  'flame',
  'x3',
  'star',
  'ice',
  'portal',
]

const SLOT_OFFSETS = [2, 4, 6, 9, 11]

export function generatePowerTiles(playerCount: number): Record<number, PowerUpType> {
  const length = playerCount * CELLS_PER_PLAYER
  const tiles: Record<number, PowerUpType> = {}
  let typeIndex = 0

  for (let seat = 0; seat < playerCount; seat += 1) {
    for (const offset of SLOT_OFFSETS) {
      const cell = (seat * CELLS_PER_PLAYER + offset) % length
      if (tiles[cell]) continue
      tiles[cell] = POWER_CYCLE[typeIndex % POWER_CYCLE.length]
      typeIndex += 1
    }
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

function advanceToken(token: Token, steps: number, players: Player[]) {
  const finish = finishedProgress(players)
  const homeEntry = homeEntryProgress(players)
  if (token.progress < 0) return
  const maxOnTrack = homeEntry
  token.progress = Math.min(token.progress + steps, finish)
  if (token.progress > maxOnTrack && token.progress < finish) {
    token.progress = maxOnTrack
  }
}

function opponentsOnCell(game: GameState, playerId: string, cell: number, players: Player[]) {
  return game.tokens.filter(
    (candidate) =>
      candidate.playerId !== playerId &&
      globalCell(candidate, players) === cell,
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
      for (const opponent of opponentsOnCell(game, player.id, landingCell, room.players)) {
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
      advanceToken(token, 3, room.players)
      return `${player.name} hit a rocket and surged ahead`
    case 'spring':
      advanceToken(token, 2, room.players)
      return `${player.name} bounced on a spring`
    case 'shield':
      game.shieldBuff[player.id] = true
      return `${player.name} picked up a shield`
    case 'flame':
      game.pendingExtraTurn = player.id
      return `${player.name} ignited a flame bonus turn`
    case 'x2':
      advanceToken(token, game.dice ?? 0, room.players)
      return `${player.name} doubled the roll with x2`
    case 'x3': {
      const bonus = (game.dice ?? 0) * 2
      advanceToken(token, bonus, room.players)
      return `${player.name} tripled momentum with x3`
    }
    case 'star':
      return `${player.name} landed on a power star`
    case 'ice': {
      let frozen = 0
      for (const opponent of opponentsOnCell(game, player.id, landingCell, room.players)) {
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
      const length = trackLength(room.players)
      const jump = Math.floor(length / 2)
      const targetCell = (landingCell + jump) % length
      const seat = player.seat
      const startCell = seat * CELLS_PER_PLAYER
      let targetProgress = (targetCell - startCell + length) % length
      if (targetProgress >= homeEntryProgress(room.players)) {
        targetProgress = homeEntryProgress(room.players) - 1
      }
      token.progress = Math.max(token.progress, targetProgress)
      return `${player.name} warped through a portal`
    }
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
