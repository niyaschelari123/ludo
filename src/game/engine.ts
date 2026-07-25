import type { ActiveMove, GameMode, GameState, MovingToken, Player, Room, Token } from './types'
import { applyPowerUp, generatePowerTiles, powerUpAtCell } from './powerUps'

// A classic four-player board has 52 outer cells: 13 per player.
// The same sector length extends cleanly to the 5–8 player polygon boards.
export const CELLS_PER_PLAYER = 13
// Inner home-lane cells before the center finish position.
export const HOME_LENGTH = 5
// Colored outer-track start cell counts as the first home-entry step.
export const OUTER_HOME_ENTRY_TILES = 1
export const TOKENS_PER_PLAYER = 4
export const TURN_ROLL_TIMEOUT_MS = 20_000
export const MAX_TURN_MISSES = 5

/** Five-player pentagon boards use one extra home cell before the center. */
export const homeLengthForBoard = (boardPlayerCount: number) =>
  boardPlayerCount === 5 ? 6 : HOME_LENGTH

export function allSeatPlayers(room: Room): Player[] {
  return [...room.players, ...(room.departedPlayers ?? [])].sort(
    (first, second) => first.seat - second.seat,
  )
}

export function getBoardPlayerCount(room: Room): number {
  if (room.game?.boardPlayerCount) return room.game.boardPlayerCount
  const seats = allSeatPlayers(room)
  return seats.length > 0
    ? Math.max(...seats.map((player) => player.seat)) + 1
    : room.players.length
}

export const trackLength = (room: Room) =>
  getBoardPlayerCount(room) * CELLS_PER_PLAYER

export const homeEntryProgress = (room: Room) => trackLength(room) - 1

export const finishedProgress = (room: Room) =>
  homeEntryProgress(room) +
  OUTER_HOME_ENTRY_TILES +
  homeLengthForBoard(getBoardPlayerCount(room))

export const safeCells = (room: Room) => {
  const length = trackLength(room)
  return new Set(
    allSeatPlayers(room).flatMap((player) => {
      const start = player.seat * CELLS_PER_PLAYER
      return [start, (start + 8) % length]
    }),
  )
}

function beginRollPhase(game: GameState) {
  game.phase = 'roll'
  game.dice = null
  game.turnDeadline = Date.now() + TURN_ROLL_TIMEOUT_MS
}

export function createGame(players: Player[], gameMode: GameMode = 'classic'): GameState {
  const boardPlayerCount = players.length
  return {
    turnIndex: 0,
    phase: 'roll',
    dice: null,
    consecutiveSixes: 0,
    boardPlayerCount,
    turnDeadline: Date.now() + TURN_ROLL_TIMEOUT_MS,
    turnMisses: Object.fromEntries(players.map((player) => [player.id, 0])),
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
    powerTiles:
      gameMode === 'power' ? generatePowerTiles(boardPlayerCount) : {},
    shieldBuff: {},
    pendingExtraTurn: null,
    pendingPower: null,
  }
}

export function globalCell(token: Token, room: Room) {
  const length = trackLength(room)
  if (token.progress < 0 || token.progress >= homeEntryProgress(room)) {
    return null
  }
  const player = allSeatPlayers(room).find(
    (candidate) => candidate.id === token.playerId,
  )
  if (!player) return null
  return (player.seat * CELLS_PER_PLAYER + token.progress) % length
}

export function canMove(token: Token, dice: number, room: Room) {
  const finish = finishedProgress(room)
  if (token.progress >= finish) return false
  if (token.progress === -1) return dice === 6
  return token.progress + dice <= finish
}

export function isSoleTokenProtected(
  game: GameState,
  playerId: string,
  room: Room,
) {
  const finish = finishedProgress(room)
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

export function resolveLandingCapture(
  room: Room,
  playerId: string,
  token: Token,
): { captured: boolean; sharedProtectedCell: boolean } {
  const game = room.game
  if (!game) return { captured: false, sharedProtectedCell: false }

  game.shieldBuff ??= {}
  let captured = false
  let sharedProtectedCell = false
  const landingCell = globalCell(token, room)

  if (landingCell === null || safeCells(room).has(landingCell)) {
    return { captured, sharedProtectedCell }
  }

  for (const opponent of game.tokens) {
    if (
      opponent.playerId !== playerId &&
      globalCell(opponent, room) === landingCell
    ) {
      if (isSoleTokenProtected(game, opponent.playerId, room)) {
        sharedProtectedCell = true
      } else if (game.shieldBuff[opponent.playerId]) {
        game.shieldBuff[opponent.playerId] = false
        sharedProtectedCell = true
      } else {
        opponent.progress = -1
        captured = true
      }
    }
  }

  return { captured, sharedProtectedCell }
}

export function resolveTntBackslideElimination(
  room: Room,
  playerId: string,
  token: Token,
): boolean {
  const game = room.game
  if (!game) return false

  const cell = globalCell(token, room)
  if (cell === null || safeCells(room).has(cell)) return false
  if (powerUpAtCell(game, cell) !== 'tnt') return false

  game.shieldBuff ??= {}
  if (game.shieldBuff[playerId]) {
    game.shieldBuff[playerId] = false
    return false
  }
  if (isSoleTokenProtected(game, playerId, room)) return false

  token.progress = -1
  return true
}

export function hasActiveToken(
  game: GameState,
  playerId: string,
  room: Room,
) {
  const finish = finishedProgress(room)
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
  room: Room,
) {
  const finish = finishedProgress(room)
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
  room: Room,
) {
  game.entryMisses ??= {}
  game.finishMisses ??= {}
  const entryMisses = game.entryMisses[playerId] ?? 0
  const finishMisses = game.finishMisses[playerId] ?? 0
  const hasActive = hasActiveToken(game, playerId, room)
  const finalRoll = requiredFinalRoll(game, playerId, room)
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
  room: Room,
  dice: number,
) {
  game.entryMisses ??= {}
  game.finishMisses ??= {}
  const entryMisses = game.entryMisses[playerId] ?? 0
  const finishMisses = game.finishMisses[playerId] ?? 0
  const hasActive = hasActiveToken(game, playerId, room)
  const finalRoll = requiredFinalRoll(game, playerId, room)
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
  const dice = resolveDiceValue(game, player.id, next)
  applyRollMisses(game, player.id, next, dice)
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
  room: Room,
  dice: number,
) {
  if (!Number.isInteger(dice) || dice < 1 || dice > 6) {
    throw new Error('Invalid dice roll.')
  }
  game.entryMisses ??= {}
  game.finishMisses ??= {}
  const entryMisses = game.entryMisses[playerId] ?? 0
  const finishMisses = game.finishMisses[playerId] ?? 0
  const hasActive = hasActiveToken(game, playerId, room)
  const finalRoll = requiredFinalRoll(game, playerId, room)
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
      canMove(token, room.game!.dice!, room),
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
  game.consecutiveSixes = 0
  beginRollPhase(game)
}

export function applyRollTimeout(room: Room): {
  shouldRemove: boolean
  playerId: string
} {
  const game = room.game
  if (!game || game.phase !== 'roll') {
    throw new Error('Dice cannot time out now.')
  }
  const player = room.players[game.turnIndex]
  if (!player) throw new Error('Current player is missing.')

  game.turnMisses ??= {}
  const misses = (game.turnMisses[player.id] ?? 0) + 1
  game.turnMisses[player.id] = misses

  if (misses >= MAX_TURN_MISSES) {
    return { shouldRemove: true, playerId: player.id }
  }

  game.lastAction = `${player.name} ran out of time (${misses}/${MAX_TURN_MISSES})`
  passTurn(room, game)
  return { shouldRemove: false, playerId: player.id }
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
  game.turnDeadline = null
  if (movableTokens(room).length === 0) passTurn(room, game)
}

function formatMoveAction(
  player: Player,
  {
    captured,
    reachedHome,
    sharedProtectedCell,
    forfeitedProtection,
  }: {
    captured: boolean
    reachedHome: boolean
    sharedProtectedCell: boolean
    forfeitedProtection: boolean
  },
) {
  if (captured) return `${player.name} captured a token`
  if (reachedHome) return `${player.name} brought a token home`
  if (sharedProtectedCell) return `${player.name} shared a protected cell`
  if (forfeitedProtection) {
    return `${player.name} moved and forfeited token protection`
  }
  return `${player.name} moved a token`
}

function completeTurnAfterMove(
  room: Room,
  game: GameState,
  player: Player,
  dice: number,
  {
    captured,
    reachedHome,
    allHome,
  }: {
    captured: boolean
    reachedHome: boolean
    allHome: boolean
  },
  preserveActiveMove = false,
) {
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
    game.pendingExtraTurn === player.id
  if (game.pendingExtraTurn === player.id) {
    game.pendingExtraTurn = null
  }
  if (!preserveActiveMove) {
    game.activeMove = null
  }
  if (!earnsExtraTurn || allHome) {
    passTurn(room, game)
  } else {
    beginRollPhase(game)
  }
}

export function applyPendingPower(room: Room, startedAt = Date.now()) {
  const game = room.game
  if (!game || game.phase !== 'power' || !game.pendingPower) {
    throw new Error('No power to resolve.')
  }

  const pending = game.pendingPower
  const player = room.players.find((candidate) => candidate.id === pending.playerId)
  if (!player) throw new Error('Current player is missing.')

  const token = game.tokens.find(
    (candidate) =>
      candidate.playerId === pending.playerId && candidate.id === pending.tokenId,
  )
  if (!token) throw new Error('That move is not valid.')

  const dice = game.dice ?? 1
  const finish = finishedProgress(room)
  const progressBeforePower = token.progress
  const powerMessage = applyPowerUp(
    room,
    player,
    token,
    pending.type,
    pending.landingCell,
  )

  game.pendingPower = null

  let captured = pending.captured
  let sharedProtectedCell = pending.sharedProtectedCell ?? false
  let selfEliminated = false
  if (token.progress !== progressBeforePower) {
    const powerLandingCapture = resolveLandingCapture(room, player.id, token)
    captured = captured || powerLandingCapture.captured
    sharedProtectedCell =
      sharedProtectedCell || powerLandingCapture.sharedProtectedCell
    if (pending.type === 'back2' || pending.type === 'back3') {
      selfEliminated = resolveTntBackslideElimination(room, player.id, token)
    }
  }

  const reachedHomeAfterPower = token.progress === finish
  const allHome = game.tokens
    .filter((candidate) => candidate.playerId === player.id)
    .every((candidate) => candidate.progress >= finish)

  if (allHome && !game.winnerIds.includes(player.id)) {
    game.winnerIds.push(player.id)
    game.lastAction = `${player.name} finished in place #${game.winnerIds.length}`
  } else if (selfEliminated) {
    game.lastAction = `${player.name} hit TNT after sliding back`
  } else if (captured) {
    game.lastAction = `${player.name} captured a token`
  } else {
    game.lastAction = powerMessage
  }

  if (token.progress !== progressBeforePower) {
    game.activeMove = {
      playerId: player.id,
      tokenId: token.id,
      fromProgress: progressBeforePower,
      dice: token.progress - progressBeforePower,
      startedAt,
      targetProgress: token.progress,
    }
  } else {
    game.activeMove = null
  }

  if (game.winnerIds.length >= room.players.length - 1) {
    const lastPlayer = room.players.find(
      (candidate) => !game.winnerIds.includes(candidate.id),
    )
    if (lastPlayer) game.winnerIds.push(lastPlayer.id)
    room.status = 'finished'
    return
  }

  completeTurnAfterMove(
    room,
    game,
    player,
    dice,
    {
      captured,
      reachedHome: reachedHomeAfterPower,
      allHome,
    },
    token.progress !== progressBeforePower,
  )
}

export function performLocalResolvePower(room: Room, userId: string) {
  const next = structuredClone(room)
  const game = next.game
  if (!game || game.phase !== 'power') {
    throw new Error('No power to resolve.')
  }
  if (next.players[game.turnIndex]?.id !== userId) {
    throw new Error('It is not your turn.')
  }
  applyPendingPower(next)
  next.updatedAt = Date.now()
  return next
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
  if (!token || !canMove(token, dice, room)) {
    throw new Error('That move is not valid.')
  }

  game.protectionForfeited ??= {}
  const playerTokensBeforeMove = game.tokens.filter(
    (candidate) => candidate.playerId === player.id,
  )
  const finish = finishedProgress(room)
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
  const { captured, sharedProtectedCell } = resolveLandingCapture(
    room,
    player.id,
    token,
  )

  const reachedHome = token.progress === finish
  const allHome = game.tokens
    .filter((candidate) => candidate.playerId === player.id)
    .every((candidate) => candidate.progress >= finish)

  const moveContext = {
    captured,
    reachedHome,
    sharedProtectedCell,
    forfeitedProtection,
  }

  const landingCell = globalCell(token, room)

  if (
    (room.gameMode ?? 'classic') === 'power' &&
    landingCell !== null &&
    token.progress > 0 &&
    token.progress < homeEntryProgress(room)
  ) {
    const powerType = powerUpAtCell(game, landingCell)
    if (powerType) {
      game.pendingPower = {
        playerId: player.id,
        tokenId: token.id,
        type: powerType,
        landingCell,
        captured,
        sharedProtectedCell,
        forfeitedProtection,
      }
      game.phase = 'power'
      game.activeMove = null
      game.turnDeadline = null
      game.lastAction = formatMoveAction(player, moveContext)
      return
    }
  }

  if (allHome && !game.winnerIds.includes(player.id)) {
    game.winnerIds.push(player.id)
    game.lastAction = `${player.name} finished in place #${game.winnerIds.length}`
  } else {
    game.lastAction = formatMoveAction(player, moveContext)
  }

  if (game.winnerIds.length >= room.players.length - 1) {
    const lastPlayer = room.players.find(
      (candidate) => !game.winnerIds.includes(candidate.id),
    )
    if (lastPlayer) game.winnerIds.push(lastPlayer.id)
    room.status = 'finished'
    return
  }

  completeTurnAfterMove(room, game, player, dice, {
    captured,
    reachedHome,
    allHome,
  })
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
