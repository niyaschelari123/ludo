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
  TURN_ROLL_TIMEOUT_MS,
  validateDiceRoll,
} from '../../src/game/engine.js'
import { PLAYER_COLORS, type Room } from '../../src/game/types.js'

const rooms = new Map<string, Room>()
const codeIndex = new Map<string, string>()

const roomCode = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(6)))
    .map((value) => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[value % 32])
    .join('')

const cleanName = (name: string) => name.trim().slice(0, 18) || 'Player'

function sortPlayers(room: Room) {
  room.players.sort((first, second) => first.seat - second.seat)
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
  room.game = createGame(room.players, room.gameMode ?? 'classic')
  room.status = 'playing'
  room.updatedAt = Date.now()
  return room
}

export function rollDice(roomId: string, userId: string, dice: number) {
  const room = structuredClone(getRoom(roomId)) as Room
  if (room.players[room.game?.turnIndex ?? -1]?.id !== userId) {
    throw new Error('It is not your turn.')
  }

  const game = room.game!
  if (game.phase !== 'roll') throw new Error('Dice cannot be rolled now.')

  const player = room.players[game.turnIndex]
  validateDiceRoll(game, player.id, room, dice)
  applyRollMisses(game, player.id, room, dice)
  applyRoll(room, dice)
  room.updatedAt = Date.now()

  rooms.set(roomId, room)
  return room
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

    rebalanceTurnAfterRemoval(room, leavingIndex)
    game.lastAction = lastAction
    finalizeGameIfNeeded(room)
  }

  room.updatedAt = Date.now()
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
      return null
    }
    rooms.set(roomId, next)
    return next
  }

  rooms.set(roomId, room)
  return room
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
