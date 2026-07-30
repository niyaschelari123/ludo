/**
 * In-memory room store and game actions.
 * Reuses the shared rules engine from src/game/engine.ts.
 */
import {
  applyMove,
  applyPendingPower,
  applyRoll,
  applyRollMisses,
  applyRollTimeout,
  createGame,
  grantExtraTurnChances as applyGrantExtraTurnChances,
  pickBestMovableToken,
  resolveDiceValue,
  TURN_ROLL_TIMEOUT_MS,
} from '../../src/game/engine.js'
import { PLAYER_COLORS, type Room } from '../../src/game/types.js'

const rooms = new Map<string, Room>()
const codeIndex = new Map<string, string>()
const rollHints = new Map<string, Record<string, number>>()

function clearRollHints(roomId: string) {
  rollHints.delete(roomId)
}

export function consumeRollHint(roomId: string, playerId: string) {
  const hints = rollHints.get(roomId)
  if (!hints || hints[playerId] === undefined) return null
  const dice = hints[playerId]
  delete hints[playerId]
  if (Object.keys(hints).length === 0) rollHints.delete(roomId)
  return dice
}

function queueRollHint(roomId: string, playerId: string, dice: number) {
  if (!Number.isInteger(dice) || dice < 1 || dice > 6) {
    throw new Error('Invalid dice roll.')
  }
  const hints = rollHints.get(roomId) ?? {}
  hints[playerId] = dice
  rollHints.set(roomId, hints)
  return getRoom(roomId)
}

const roomCode = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(6)))
    .map((value) => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[value % 32])
    .join('')

const cleanName = (name: string) => name.trim().slice(0, 18) || 'Player'

function sortPlayers(room: Room) {
  room.players.sort((first, second) => first.seat - second.seat)
}

function assignRandomGamePositions(room: Room) {
  const originalPlayers = [...room.players]
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const shuffledPlayers = [...originalPlayers]
    for (let index = shuffledPlayers.length - 1; index > 0; index -= 1) {
      const randomIndex =
        crypto.getRandomValues(new Uint32Array(1))[0] % (index + 1)
      ;[shuffledPlayers[index], shuffledPlayers[randomIndex]] = [
        shuffledPlayers[randomIndex],
        shuffledPlayers[index],
      ]
    }

    if (
      shuffledPlayers.every(
        (player, index) =>
          player.seat !== index && player.color !== PLAYER_COLORS[index],
      )
    ) {
      shuffledPlayers.forEach((player, index) => {
        player.seat = index
        player.color = PLAYER_COLORS[index]
      })
      room.players = shuffledPlayers
      return
    }
  }

  const rotatedPlayers = [...originalPlayers.slice(1), originalPlayers[0]]
  rotatedPlayers.forEach((player, index) => {
    player.seat = index
    player.color = PLAYER_COLORS[index]
  })
  room.players = rotatedPlayers
}

function firstOpenSeat(room: Room) {
  const occupied = new Set(room.players.map((player) => player.seat))
  for (let seat = 0; seat < room.maxPlayers; seat += 1) {
    if (!occupied.has(seat)) return seat
  }
  return -1
}

export function getRoom(roomId: string) {
  const room = rooms.get(roomId)
  if (!room) throw new Error('Room not found.')
  return room
}

export function createRoom(
  userId: string,
  name: string,
  maxPlayers: number,
  gameMode: Room['gameMode'] = 'classic',
) {
  if (maxPlayers < 2 || maxPlayers > 8) {
    throw new Error('Room size must be between 2 and 8 players.')
  }

  const now = Date.now()
  const id = crypto.randomUUID()
  let code = roomCode()
  while (codeIndex.has(code)) code = roomCode()

  const room: Room = {
    id,
    code,
    hostId: userId,
    memberIds: [userId],
    maxPlayers,
    gameMode,
    status: 'lobby',
    players: [
      {
        id: userId,
        name: cleanName(name),
        color: PLAYER_COLORS[0],
        seat: 0,
        connected: true,
        joinedAt: now,
      },
    ],
    departedPlayers: [],
    game: null,
    createdAt: now,
    updatedAt: now,
  }

  rooms.set(id, room)
  codeIndex.set(code, id)
  return room
}

export function joinRoom(userId: string, name: string, code: string) {
  const roomId = codeIndex.get(code.trim().toUpperCase())
  if (!roomId) throw new Error('Room not found. Check the room code.')

  const room = getRoom(roomId)
  const returning = room.players.find((player) => player.id === userId)

  if (returning) {
    returning.connected = true
    returning.name = cleanName(name)
  } else {
    if (room.status !== 'lobby') {
      throw new Error('This game has already started.')
    }
    if (room.players.length >= room.maxPlayers) {
      throw new Error('This room is full.')
    }
    const seat = firstOpenSeat(room)
    if (seat === -1) throw new Error('This room is full.')
    room.players.push({
      id: userId,
      name: cleanName(name),
      color: PLAYER_COLORS[seat],
      seat,
      connected: true,
      joinedAt: Date.now(),
    })
    sortPlayers(room)
    room.memberIds.push(userId)
  }

  room.updatedAt = Date.now()
  return room
}

export function setSlotBot(
  roomId: string,
  userId: string,
  seat: number,
  add: boolean,
) {
  const room = getRoom(roomId)
  if (room.hostId !== userId) throw new Error('Only the host can manage bots.')
  if (room.status !== 'lobby') {
    throw new Error('Bots can only be changed in the lobby.')
  }
  if (!Number.isInteger(seat) || seat < 0 || seat >= room.maxPlayers) {
    throw new Error('Invalid seat.')
  }

  const existing = room.players.find((player) => player.seat === seat)

  if (add) {
    if (existing) throw new Error('That seat is already taken.')
    const botCount = room.players.filter((player) => player.isBot).length
    room.players.push({
      id: crypto.randomUUID(),
      name: `Bot ${botCount + 1}`,
      color: PLAYER_COLORS[seat],
      seat,
      connected: true,
      isBot: true,
      joinedAt: Date.now(),
    })
  } else {
    if (!existing?.isBot) {
      throw new Error('Only bot players can be removed from a seat.')
    }
    room.players = room.players.filter((player) => player.seat !== seat)
  }

  sortPlayers(room)
  room.updatedAt = Date.now()
  return room
}

export function startRoom(roomId: string, userId: string) {
  const room = getRoom(roomId)
  if (room.hostId !== userId) throw new Error('Only the host can start.')
  if (room.status !== 'lobby') throw new Error('The game has already started.')
  if (room.players.length < 2) {
    throw new Error('At least two players are required.')
  }

  sortPlayers(room)
  assignRandomGamePositions(room)
  room.game = createGame(room.players, room.gameMode ?? 'classic')
  room.status = 'playing'
  room.updatedAt = Date.now()
  return room
}

/**
 * The dice value is decided here, never by the caller, so every client sees the
 * same roll. `forcedDice` is only honoured for the host override path (k === 7).
 */
export function rollDice(
  roomId: string,
  userId: string,
  forcedDice?: number,
  k?: number,
) {
  const room = structuredClone(getRoom(roomId)) as Room
  const game = room.game!
  if (game.phase !== 'roll') throw new Error('Dice cannot be rolled now.')

  const player = room.players[game.turnIndex]
  if (!player) throw new Error('Current player is missing.')

  if (k === 7) {
    if (
      forcedDice === undefined ||
      !Number.isInteger(forcedDice) ||
      forcedDice < 1 ||
      forcedDice > 6
    ) {
      throw new Error('Invalid dice roll.')
    }
    applyRollMisses(game, player.id, room, forcedDice)
    applyRoll(room, forcedDice)
    room.updatedAt = Date.now()
    rooms.set(roomId, room)
    return { room, dice: forcedDice }
  }

  if (player.id !== userId) {
    throw new Error('It is not your turn.')
  }

  const hinted = consumeRollHint(roomId, player.id)
  const value = hinted ?? resolveDiceValue(game, player.id, room)
  if (!Number.isInteger(value) || value < 1 || value > 6) {
    throw new Error('Invalid dice roll.')
  }
  applyRollMisses(game, player.id, room, value)
  applyRoll(room, value)
  room.updatedAt = Date.now()

  rooms.set(roomId, room)
  return { room, dice: value }
}

export function storeRollHint(
  roomId: string,
  targetPlayerId: string,
  dice: number,
) {
  return queueRollHint(roomId, targetPlayerId, dice)
}

export function movePawn(
  roomId: string,
  userId: string,
  tokenId: number,
  startedAt: number,
  targetProgress?: number,
) {
  const room = structuredClone(getRoom(roomId)) as Room
  if (room.players[room.game?.turnIndex ?? -1]?.id !== userId) {
    throw new Error('It is not your turn.')
  }

  const game = room.game!
  if (game.phase !== 'move') throw new Error('A token cannot be moved now.')

  const token = game.tokens.find(
    (candidate) => candidate.playerId === userId && candidate.id === tokenId,
  )
  if (!token) throw new Error('That move is not valid.')

  // Broadcast-friendly active move so remote clients can animate before final state.
  game.activeMove = {
    playerId: userId,
    tokenId,
    fromProgress: token.progress,
    dice: game.dice ?? 1,
    startedAt,
    ...(targetProgress !== undefined ? { targetProgress } : {}),
  }
  rooms.set(roomId, room)

  const finalRoom = structuredClone(room) as Room
  applyMove(finalRoom, tokenId)
  finalRoom.updatedAt = Date.now()
  rooms.set(roomId, finalRoom)
  return { previewRoom: room, room: finalRoom }
}

export function resolvePendingPower(
  roomId: string,
  userId: string,
  startedAt: number,
) {
  const room = structuredClone(getRoom(roomId)) as Room
  if (room.players[room.game?.turnIndex ?? -1]?.id !== userId) {
    throw new Error('It is not your turn.')
  }

  const game = room.game!
  if (game.phase !== 'power' || !game.pendingPower) {
    throw new Error('No power to resolve.')
  }

  const finalRoom = structuredClone(room) as Room
  applyPendingPower(finalRoom, startedAt)
  finalRoom.updatedAt = Date.now()

  const activeMove = finalRoom.game?.activeMove
  if (activeMove) {
    // Keep the token at its pre-power position in the preview so remote clients
    // can animate the bonus movement instead of snapping to the final cell.
    finalRoom.game!.activeMove = null
    rooms.set(roomId, finalRoom)

    const previewRoom = structuredClone(finalRoom) as Room
    const previewToken = previewRoom.game!.tokens.find(
      (candidate) =>
        candidate.playerId === activeMove.playerId &&
        candidate.id === activeMove.tokenId,
    )
    if (previewToken) {
      previewToken.progress = activeMove.fromProgress
    }
    previewRoom.game!.activeMove = activeMove
    previewRoom.updatedAt = Date.now()
    return { previewRoom, room: finalRoom }
  }

  rooms.set(roomId, finalRoom)
  return { previewRoom: finalRoom, room: finalRoom }
}

function transferHost(room: Room, previousHostId: string) {
  if (room.players.length === 0 || room.hostId !== previousHostId) return
  const nextHost =
    room.players.find(
      (player) => player.id !== previousHostId && !player.isBot,
    ) ??
    room.players.find((player) => player.id !== previousHostId) ??
    room.players[0]
  room.hostId = nextHost.id
}

function rebalanceTurnAfterRemoval(room: Room, removedIndex: number) {
  const game = room.game!
  if (removedIndex < game.turnIndex) {
    game.turnIndex -= 1
  } else if (removedIndex === game.turnIndex) {
    game.turnIndex = removedIndex % room.players.length
  }

  for (let offset = 0; offset < room.players.length; offset += 1) {
    const index = (game.turnIndex + offset) % room.players.length
    if (!game.winnerIds.includes(room.players[index].id)) {
      game.turnIndex = index
      break
    }
  }

  game.phase = 'roll'
  game.dice = null
  game.consecutiveSixes = 0
  game.activeMove = null
  game.pendingPower = null
  game.turnDeadline = Date.now() + TURN_ROLL_TIMEOUT_MS
}

function finalizeGameIfNeeded(room: Room) {
  const game = room.game
  if (!game) return

  if (
    room.players.length === 1 ||
    game.winnerIds.length >= room.players.length - 1
  ) {
    const remaining = room.players.find(
      (player) => !game.winnerIds.includes(player.id),
    )
    if (remaining) game.winnerIds.push(remaining.id)
    room.status = 'finished'
    game.turnDeadline = null
  }
}

export function removePlayerFromRoom(
  room: Room,
  userId: string,
  lastAction: string,
): Room | null {
  const leavingIndex = room.players.findIndex((player) => player.id === userId)
  if (leavingIndex === -1) return room

  const leavingPlayer = room.players[leavingIndex]

  if (room.game) {
    room.departedPlayers ??= []
    if (!room.departedPlayers.some((player) => player.id === userId)) {
      room.departedPlayers.push({
        ...leavingPlayer,
        connected: false,
        leftAt: Date.now(),
      })
    }
  }

  room.players.splice(leavingIndex, 1)
  room.memberIds = (room.memberIds ?? []).filter((id) => id !== userId)

  if (room.players.length === 0) {
    rooms.delete(room.id)
    codeIndex.delete(room.code)
    clearRollHints(room.id)
    return null
  }

  transferHost(room, userId)

  if (room.game) {
    const game = room.game
    game.tokens = game.tokens.filter((token) => token.playerId !== userId)
    game.winnerIds = game.winnerIds.filter((id) => id !== userId)
    delete game.entryMisses?.[userId]
    delete game.finishMisses?.[userId]
    delete game.protectionForfeited?.[userId]
    delete game.turnMisses?.[userId]
    delete game.turnMissLimits?.[userId]

    rebalanceTurnAfterRemoval(room, leavingIndex)
    game.lastAction = lastAction
    finalizeGameIfNeeded(room)
  }

  room.updatedAt = Date.now()
  return room
}

export function grantExtraTurnChances(
  roomId: string,
  hostId: string,
  targetUserId: string,
  amount = 5,
) {
  const room = structuredClone(getRoom(roomId)) as Room
  if (room.hostId !== hostId) {
    throw new Error('Only the host can grant extra chances.')
  }
  if (room.status !== 'playing' || !room.game) {
    throw new Error('Chances can only be granted during a game.')
  }
  applyGrantExtraTurnChances(room, targetUserId, amount)
  room.updatedAt = Date.now()
  rooms.set(roomId, room)
  return room
}

export function removePlayer(
  roomId: string,
  hostId: string,
  targetUserId: string,
) {
  const room = getRoom(roomId)
  if (room.hostId !== hostId) {
    throw new Error('Only the host can remove players.')
  }
  if (targetUserId === hostId) {
    throw new Error('Leave the room yourself instead of removing yourself.')
  }

  const target = room.players.find((player) => player.id === targetUserId)
  if (!target) throw new Error('Player not found.')

  if (room.status === 'lobby') {
    room.players = room.players.filter((player) => player.id !== targetUserId)
    room.memberIds = room.memberIds.filter((id) => id !== targetUserId)
    room.updatedAt = Date.now()
    return room
  }

  const next = removePlayerFromRoom(
    room,
    targetUserId,
    `${target.name} was removed`,
  )
  if (!next) throw new Error('Room closed.')
  rooms.set(roomId, next)
  return next
}

export function handleRollTimeout(roomId: string) {
  const room = structuredClone(getRoom(roomId)) as Room
  if (room.status !== 'playing' || !room.game || room.game.phase !== 'roll') {
    return room
  }

  const player = room.players[room.game.turnIndex]
  if (!player || player.isBot) return room

  const { shouldRemove, playerId } = applyRollTimeout(room)
  room.updatedAt = Date.now()

  if (shouldRemove) {
    const removed = room.players.find((candidate) => candidate.id === playerId)
    const name = removed?.name ?? 'Player'
    const next = removePlayerFromRoom(room, playerId, `${name} was removed for inactivity`)
    if (!next) {
      rooms.delete(roomId)
      codeIndex.delete(room.code)
      clearRollHints(roomId)
      return null
    }
    rooms.set(roomId, next)
    return next
  }

  const hinted = consumeRollHint(roomId, player.id)
  const dice = hinted ?? resolveDiceValue(room.game, player.id, room)
  applyRollMisses(room.game, player.id, room, dice)
  applyRoll(room, dice)
  room.game.lastAction = `${player.name} auto-rolled ${dice} after timeout`
  room.updatedAt = Date.now()
  rooms.set(roomId, room)
  return room
}

export function skipRollTimer(roomId: string, hostId: string) {
  const room = getRoom(roomId)
  if (room.hostId !== hostId) {
    throw new Error('Only the host can skip the roll timer.')
  }
  if (room.status !== 'playing' || !room.game || room.game.phase !== 'roll') {
    throw new Error('No roll timer to skip.')
  }
  const player = room.players[room.game.turnIndex]
  if (!player || player.isBot) {
    throw new Error('No player roll timer to skip.')
  }
  return handleRollTimeout(roomId)
}

export function handleMoveTimeout(roomId: string) {
  const room = getRoom(roomId)
  if (room.status !== 'playing' || !room.game || room.game.phase !== 'move') {
    return null
  }

  const player = room.players[room.game.turnIndex]
  if (!player || player.isBot) return null

  const token = pickBestMovableToken(room)
  if (!token) return null

  const startedAt = Date.now()
  const targetProgress =
    token.progress === -1 ? 0 : token.progress + (room.game.dice ?? 1)
  return movePawn(roomId, player.id, token.id, startedAt, targetProgress)
}

export function skipMoveTimer(roomId: string, hostId: string) {
  const room = getRoom(roomId)
  if (room.hostId !== hostId) {
    throw new Error('Only the host can skip the move timer.')
  }
  if (room.status !== 'playing' || !room.game || room.game.phase !== 'move') {
    throw new Error('No move timer to skip.')
  }
  const player = room.players[room.game.turnIndex]
  if (!player || player.isBot) {
    throw new Error('No player move timer to skip.')
  }
  return handleMoveTimeout(roomId)
}

export function leaveRoom(
  roomId: string,
  userId: string,
  newHostId?: string,
) {
  const room = rooms.get(roomId)
  if (!room) return null

  const leavingPlayer = room.players.find((player) => player.id === userId)
  if (!leavingPlayer) return room

  if (room.hostId === userId && newHostId) {
    const nextHost = room.players.find(
      (player) => player.id === newHostId && player.id !== userId,
    )
    if (!nextHost) throw new Error('Choose a valid new host.')
    room.hostId = newHostId
  }

  const next = removePlayerFromRoom(
    room,
    userId,
    `${leavingPlayer.name} left the game`,
  )
  if (!next) return null
  rooms.set(roomId, next)
  return next
}

export function markDisconnected(roomId: string, userId: string) {
  const room = rooms.get(roomId)
  if (!room) return null
  const player = room.players.find((candidate) => candidate.id === userId)
  if (!player || player.isBot) return room
  player.connected = false
  room.updatedAt = Date.now()
  return room
}
