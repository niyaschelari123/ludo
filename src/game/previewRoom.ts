import { createGame } from './engine'
import { PLAYER_COLORS, type GameMode, type Room } from './types'

/** Build an in-memory room for board layout previews (no socket server). */
export function createPreviewRoom(
  playerCount: number,
  gameMode: GameMode = 'classic',
): Room {
  const now = Date.now()
  const players = Array.from({ length: playerCount }, (_, seat) => ({
    id: `preview-player-${seat}`,
    name: `Player ${seat + 1}`,
    color: PLAYER_COLORS[seat],
    seat,
    connected: true,
    joinedAt: now,
  }))

  const game = createGame(players, gameMode)
  game.phase = 'roll'
  game.dice = null
  game.turnIndex = 0
  game.lastAction = 'Design preview — all tokens in home'

  // Keep every token in the yard so home layouts are easy to tune.
  for (const token of game.tokens) {
    token.progress = -1
  }

  return {
    id: 'preview-room',
    code: 'DESIGN',
    hostId: players[0].id,
    memberIds: players.map((player) => player.id),
    maxPlayers: playerCount,
    gameMode,
    status: 'playing',
    players,
    departedPlayers: [],
    game,
    createdAt: now,
    updatedAt: now,
  }
}
