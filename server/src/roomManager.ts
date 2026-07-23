/**
 * In-memory room store and game actions.
 * Reuses the shared rules engine from src/game/engine.ts.
 */
import {
  applyMove,
  applyPendingPower,
  applyRoll,
  applyRollMisses,
  createGame,
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
    const seat = room.players.length
    room.players.push({
      id: userId,
      name: cleanName(name),
      color: PLAYER_COLORS[seat],
      seat,
      connected: true,
      joinedAt: Date.now(),
    })
    room.memberIds.push(userId)
  }

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
  validateDiceRoll(game, player.id, room.players, dice)
  applyRollMisses(game, player.id, room.players, dice)
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

  const previewRoom = structuredClone(room) as Room
  applyPendingPower(previewRoom, startedAt)
  previewRoom.updatedAt = Date.now()
  rooms.set(roomId, previewRoom)
  return { previewRoom, room: previewRoom }
}

export function leaveRoom(roomId: string, userId: string) {
  const room = rooms.get(roomId)
  if (!room) return null

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
    rooms.delete(roomId)
    codeIndex.delete(room.code)
    return null
  }

  if (room.hostId === userId) {
    room.hostId = room.players[0].id
  }

  if (room.game) {
    const game = room.game
    game.tokens = game.tokens.filter((token) => token.playerId !== userId)
    game.winnerIds = game.winnerIds.filter((id) => id !== userId)
    delete game.entryMisses?.[userId]
    delete game.finishMisses?.[userId]
    delete game.protectionForfeited?.[userId]

    if (leavingIndex < game.turnIndex) {
      game.turnIndex -= 1
    } else if (leavingIndex === game.turnIndex) {
      game.turnIndex = leavingIndex % room.players.length
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
    game.lastAction = `${leavingPlayer.name} left the game`

    if (
      room.players.length === 1 ||
      game.winnerIds.length >= room.players.length - 1
    ) {
      const remaining = room.players.find(
        (player) => !game.winnerIds.includes(player.id),
      )
      if (remaining) game.winnerIds.push(remaining.id)
      room.status = 'finished'
    }
  }

  room.updatedAt = Date.now()
  return room
}

export function markDisconnected(roomId: string, userId: string) {
  const room = rooms.get(roomId)
  if (!room) return null
  const player = room.players.find((candidate) => candidate.id === userId)
  if (!player) return room
  player.connected = false
  room.updatedAt = Date.now()
  return room
}
