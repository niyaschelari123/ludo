import type { ActiveMove, GameMode, GameState, MovingToken, Player, Room, Token } from './types'
import { applyPowerUp, generatePowerTiles, powerUpAtCell } from './powerUps'

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

export function createGame(players: Player[], gameMode: GameMode = 'classic'): GameState {
  return {
    turnIndex: 0,
    phase: 'roll',
    dice: null,
    consecutiveSixes: 0,
    entryMisses: Object.fromEntries(players.map((player) => [player.id, 0])),
    finishMisses: Object.fromEntries(players.map((player) => [player.id, 0])),
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
    activeMove: null,
    powerTiles: gameMode === 'power' ? generatePowerTiles(players.length) : {},
    shieldBuff: {},
    pendingExtraTurn: null,
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

export function requiredFinalRoll(
  game: GameState,
  playerId: string,
  players: Player[],
) {
  const finish = finishedProgress(players)
  const unfinishedTokens = game.tokens.filter(
    (token) => token.playerId === playerId && token.progress < finish,
  )
  if (unfinishedTokens.length !== 1) return null
  const remaining = finish - unfinishedTokens[0].progress
  return remaining >= 1 && remaining <= 3 ? remaining : null
}

function randomDiceValue() {
  return (crypto.getRandomValues(new Uint8Array(1))[0] % 6) + 1
}

export function resolveDiceValue(
  game: GameState,
  playerId: string,
  players: Player[],
) {
  game.entryMisses ??= {}
  game.finishMisses ??= {}
  const entryMisses = game.entryMisses[playerId] ?? 0
  const finishMisses = game.finishMisses[playerId] ?? 0
  const hasActive = hasActiveToken(game, playerId, players)
  const finalRoll = requiredFinalRoll(game, playerId, players)
  const randomDice = randomDiceValue()
  return !hasActive && entryMisses >= 4
    ? 6
    : finalRoll !== null && finishMisses >= 7
      ? finalRoll
      : randomDice
}

export function applyRollMisses(
  game: GameState,
  playerId: string,
  players: Player[],
  dice: number,
) {
  game.entryMisses ??= {}
  game.finishMisses ??= {}
  const entryMisses = game.entryMisses[playerId] ?? 0
  const finishMisses = game.finishMisses[playerId] ?? 0
  const hasActive = hasActiveToken(game, playerId, players)
  const finalRoll = requiredFinalRoll(game, playerId, players)
  game.entryMisses[playerId] = hasActive || dice === 6 ? 0 : entryMisses + 1
  game.finishMisses[playerId] =
    finalRoll === null || dice === finalRoll ? 0 : finishMisses + 1
}

export function performLocalRoll(room: Room, userId: string) {
  const next = structuredClone(room)
  const game = next.game
  if (!game || game.phase !== 'roll') {
    throw new Error('Dice cannot be rolled now.')
  }
  if (next.players[game.turnIndex]?.id !== userId) {
    throw new Error('It is not your turn.')
  }
  const player = next.players[game.turnIndex]
  const dice = resolveDiceValue(game, player.id, next.players)
  applyRollMisses(game, player.id, next.players, dice)
  applyRoll(next, dice)
  next.updatedAt = Date.now()
  return { room: next, dice }
}

export function performLocalMove(room: Room, userId: string, tokenId: number) {
  const next = structuredClone(room)
  const game = next.game
  if (!game || game.phase !== 'move') {
    throw new Error('A token cannot be moved now.')
  }
  if (next.players[game.turnIndex]?.id !== userId) {
    throw new Error('It is not your turn.')
  }
  applyMove(next, tokenId)
  next.updatedAt = Date.now()
  return next
}

export function validateDiceRoll(
  game: GameState,
  playerId: string,
  players: Player[],
  dice: number,
) {
  if (!Number.isInteger(dice) || dice < 1 || dice > 6) {
    throw new Error('Invalid dice roll.')
  }
  game.entryMisses ??= {}
  game.finishMisses ??= {}
  const entryMisses = game.entryMisses[playerId] ?? 0
  const finishMisses = game.finishMisses[playerId] ?? 0
  const hasActive = hasActiveToken(game, playerId, players)
  const finalRoll = requiredFinalRoll(game, playerId, players)
  if (!hasActive && entryMisses >= 4 && dice !== 6) {
    throw new Error('Invalid dice roll.')
  }
  if (finalRoll !== null && finishMisses >= 7 && dice !== finalRoll) {
    throw new Error('Invalid dice roll.')
  }
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
        } else if (game.shieldBuff?.[opponent.playerId]) {
          game.shieldBuff[opponent.playerId] = false
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

  let powerMessage: string | null = null
  if (
    (room.gameMode ?? 'classic') === 'power' &&
    landingCell !== null &&
    token.progress > 0 &&
    token.progress < homeEntryProgress(room.players)
  ) {
    const powerType = powerUpAtCell(game, landingCell)
    if (powerType) {
      powerMessage = applyPowerUp(room, player, token, powerType, landingCell)
    }
  }

  const reachedHomeAfterPower = token.progress === finish

  if (allHome && !game.winnerIds.includes(player.id)) {
    game.winnerIds.push(player.id)
    game.lastAction = `${player.name} finished in place #${game.winnerIds.length}`
  } else {
    game.lastAction = powerMessage
      ?? (captured
      ? `${player.name} captured a token`
      : reachedHome || reachedHomeAfterPower
        ? `${player.name} brought a token home`
        : sharedProtectedCell
          ? `${player.name} shared a protected cell`
          : forfeitedProtection
            ? `${player.name} moved and forfeited token protection`
        : `${player.name} moved a token`)
  }

  if (game.winnerIds.length >= room.players.length - 1) {
    const lastPlayer = room.players.find(
      (candidate) => !game.winnerIds.includes(candidate.id),
    )
    if (lastPlayer) game.winnerIds.push(lastPlayer.id)
    room.status = 'finished'
    return
  }

  const earnsExtraTurn =
    dice === 6 ||
    captured ||
    reachedHome ||
    reachedHomeAfterPower ||
    game.pendingExtraTurn === player.id
  if (game.pendingExtraTurn === player.id) {
    game.pendingExtraTurn = null
  }
  game.activeMove = null
  game.phase = 'roll'
  game.dice = null
  if (!earnsExtraTurn || allHome) {
    passTurn(room, game)
  }
}

export function detectMovedToken(prev: Room, next: Room): MovingToken | null {
  if (!prev.game || !next.game) return null
  if (prev.game.lastAction === next.game.lastAction) return null

  const action = next.game.lastAction
  if (action.includes('rolled')) return null

  const mover = [...next.players]
    .sort((first, second) => second.name.length - first.name.length)
    .find((player) => action.startsWith(player.name))
  if (!mover) return null

  for (const token of next.game.tokens) {
    if (token.playerId !== mover.id) continue
    const oldToken = prev.game.tokens.find(
      (candidate) => candidate.playerId === mover.id && candidate.id === token.id,
    )
    if (!oldToken || oldToken.progress === token.progress) continue
    if (
      token.progress > oldToken.progress ||
      (oldToken.progress === -1 && token.progress >= 0)
    ) {
      const dice =
        oldToken.progress === -1 ? 6 : token.progress - oldToken.progress
      if (dice > 0) {
        return {
          playerId: mover.id,
          id: token.id,
          fromProgress: oldToken.progress,
          dice,
          targetProgress: token.progress,
        }
      }
    }
  }

  return null
}

export function activeMoveToMovingToken(active: ActiveMove): MovingToken {
  return {
    playerId: active.playerId,
    id: active.tokenId,
    fromProgress: active.fromProgress,
    dice: active.dice,
    startedAt: active.startedAt,
    targetProgress: active.targetProgress,
  }
}
