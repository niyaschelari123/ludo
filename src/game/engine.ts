import type { GameState, Player, Room, Token } from './types'

// A classic four-player board has 52 outer cells: 13 per player.
// The same sector length extends cleanly to the 5–8 player polygon boards.
export const CELLS_PER_PLAYER = 13
// Five colored home-lane cells plus the center finish position.
export const HOME_LENGTH = 5
export const TOKENS_PER_PLAYER = 4

export const trackLength = (players: Player[]) =>
  players.length * CELLS_PER_PLAYER

// A token starts on one of the shared cells and turns into its home lane
// before reaching the perimeter cell immediately preceding that start.
export const homeEntryProgress = (players: Player[]) =>
  trackLength(players) - 1

export const finishedProgress = (players: Player[]) =>
  homeEntryProgress(players) + HOME_LENGTH

export const safeCells = (players: Player[]) =>
  new Set(
    players.flatMap((player) => {
      const start = player.seat * CELLS_PER_PLAYER
      return [start, (start + 8) % trackLength(players)]
    }),
  )

export function createGame(players: Player[]): GameState {
  return {
    turnIndex: 0,
    phase: 'roll',
    dice: null,
    consecutiveSixes: 0,
    entryMisses: Object.fromEntries(players.map((player) => [player.id, 0])),
    protectionForfeited: Object.fromEntries(
      players.map((player) => [player.id, false]),
    ),
    winnerIds: [],
    tokens: players.flatMap((player) =>
      Array.from({ length: TOKENS_PER_PLAYER }, (_, id) => ({
        id,
        playerId: player.id,
        progress: -1,
      })),
    ),
    lastAction: `${players[0].name} starts`,
  }
}

export function globalCell(token: Token, players: Player[]) {
  const length = trackLength(players)
  if (token.progress < 0 || token.progress >= homeEntryProgress(players)) {
    return null
  }
  const player = players.find((candidate) => candidate.id === token.playerId)
  if (!player) return null
  return (player.seat * CELLS_PER_PLAYER + token.progress) % length
}

export function canMove(token: Token, dice: number, players: Player[]) {
  const finish = finishedProgress(players)
  if (token.progress >= finish) return false
  if (token.progress === -1) return dice === 6
  return token.progress + dice <= finish
}

export function isSoleTokenProtected(
  game: GameState,
  playerId: string,
  players: Player[],
) {
  const finish = finishedProgress(players)
  const playerTokens = game.tokens.filter(
    (token) => token.playerId === playerId,
  )
  const hasFinishedToken = playerTokens.some(
    (token) => token.progress >= finish,
  )
  const activeTokens = playerTokens.filter(
    (token) => token.progress >= 0 && token.progress < finish,
  )
  return (
    !hasFinishedToken &&
    activeTokens.length === 1 &&
    !game.protectionForfeited?.[playerId]
  )
}

export function hasActiveToken(
  game: GameState,
  playerId: string,
  players: Player[],
) {
  const finish = finishedProgress(players)
  return game.tokens.some(
    (token) =>
      token.playerId === playerId &&
      token.progress >= 0 &&
      token.progress < finish,
  )
}

export function movableTokens(room: Room) {
  if (!room.game?.dice) return []
  const player = room.players[room.game.turnIndex]
  return room.game.tokens.filter(
    (token) =>
      token.playerId === player?.id &&
      canMove(token, room.game!.dice!, room.players),
  )
}

function nextActiveTurn(room: Room, game: GameState) {
  for (let offset = 1; offset <= room.players.length; offset += 1) {
    const index = (game.turnIndex + offset) % room.players.length
    if (!game.winnerIds.includes(room.players[index].id)) return index
  }
  return game.turnIndex
}

function passTurn(room: Room, game: GameState) {
  game.turnIndex = nextActiveTurn(room, game)
  game.phase = 'roll'
  game.dice = null
  game.consecutiveSixes = 0
}

export function applyRoll(room: Room, value: number) {
  const game = room.game
  if (!game || game.phase !== 'roll') throw new Error('Dice cannot be rolled now.')
  const player = room.players[game.turnIndex]
  if (!player) throw new Error('Current player is missing.')

  game.dice = value
  game.consecutiveSixes = value === 6 ? game.consecutiveSixes + 1 : 0
  game.lastAction = `${player.name} rolled ${value}`

  if (game.consecutiveSixes === 3) {
    game.lastAction = `${player.name} rolled three sixes and lost the turn`
    passTurn(room, game)
    return
  }

  game.phase = 'move'
  if (movableTokens(room).length === 0) passTurn(room, game)
}

export function applyMove(room: Room, tokenId: number) {
  const game = room.game
  const dice = game?.dice
  if (!game || game.phase !== 'move' || !dice) {
    throw new Error('A token cannot be moved now.')
  }

  const player = room.players[game.turnIndex]
  const token = game.tokens.find(
    (candidate) => candidate.playerId === player.id && candidate.id === tokenId,
  )
  if (!token || !canMove(token, dice, room.players)) {
    throw new Error('That move is not valid.')
  }

  game.protectionForfeited ??= {}
  const playerTokensBeforeMove = game.tokens.filter(
    (candidate) => candidate.playerId === player.id,
  )
  const finish = finishedProgress(room.players)
  const activeTokensBeforeMove = playerTokensBeforeMove.filter(
    (candidate) =>
      candidate.progress >= 0 && candidate.progress < finish,
  )
  const hasTokenInYard = playerTokensBeforeMove.some(
    (candidate) => candidate.progress === -1,
  )
  const enteringFromYard = token.progress === -1
  const forfeitedProtection =
    dice === 6 &&
    hasTokenInYard &&
    activeTokensBeforeMove.length === 1 &&
    !enteringFromYard
  if (enteringFromYard) {
    game.protectionForfeited[player.id] = false
  } else if (forfeitedProtection) {
    game.protectionForfeited[player.id] = true
  }

  token.progress = token.progress === -1 ? 0 : token.progress + dice
  let captured = false
  let sharedProtectedCell = false
  const landingCell = globalCell(token, room.players)

  if (landingCell !== null && !safeCells(room.players).has(landingCell)) {
    for (const opponent of game.tokens) {
      if (
        opponent.playerId !== player.id &&
        globalCell(opponent, room.players) === landingCell
      ) {
        if (isSoleTokenProtected(game, opponent.playerId, room.players)) {
          sharedProtectedCell = true
        } else {
          opponent.progress = -1
          captured = true
        }
      }
    }
  }

  const reachedHome = token.progress === finish
  const allHome = game.tokens
    .filter((candidate) => candidate.playerId === player.id)
    .every((candidate) => candidate.progress >= finish)

  if (allHome && !game.winnerIds.includes(player.id)) {
    game.winnerIds.push(player.id)
    game.lastAction = `${player.name} finished in place #${game.winnerIds.length}`
  } else {
    game.lastAction = captured
      ? `${player.name} captured a token`
      : reachedHome
        ? `${player.name} brought a token home`
        : sharedProtectedCell
          ? `${player.name} shared a protected cell`
          : forfeitedProtection
            ? `${player.name} moved and forfeited token protection`
        : `${player.name} moved a token`
  }

  if (game.winnerIds.length >= room.players.length - 1) {
    const lastPlayer = room.players.find(
      (candidate) => !game.winnerIds.includes(candidate.id),
    )
    if (lastPlayer) game.winnerIds.push(lastPlayer.id)
    room.status = 'finished'
    return
  }

  const earnsExtraTurn = dice === 6 || captured || reachedHome
  game.phase = 'roll'
  game.dice = null
  if (!earnsExtraTurn || allHome) {
    passTurn(room, game)
  }
}
