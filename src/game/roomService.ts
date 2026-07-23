/**
 * Multiplayer room API over Socket.IO.
 * Replaces the previous Firebase/Firestore implementation.
 */
import { emitAck, getSocket, whenConnected } from './socket'
import type { ActiveMove, Room } from './types'

export async function createRoom(
  userId: string,
  name: string,
  maxPlayers: number,
  gameMode: Room['gameMode'] = 'classic',
) {
  const { room } = await emitAck<{ room: Room }>('createRoom', {
    userId,
    name,
    maxPlayers,
    gameMode,
  })
  return room
}

export async function joinRoom(userId: string, name: string, code: string) {
  const { room } = await emitAck<{ room: Room }>('joinRoom', {
    userId,
    name,
    code,
  })
  return room
}

export async function syncRoom(roomId: string, userId: string) {
  const { room } = await emitAck<{ room: Room }>('syncRoom', { roomId, userId })
  return room
}

/**
 * Subscribe to room state pushed by the server.
 * Returns an unsubscribe function.
 */
export function watchRoom(
  roomId: string,
  userId: string,
  onRoom: (room: Room | null) => void,
  onError: (message: string) => void,
) {
  const socket = getSocket()
  let latestRoom: Room | null = null

  const handleState = (room: Room) => {
    if (room.id !== roomId) return
    latestRoom = room
    onRoom(room)
  }

  const handleMoveStart = (activeMove: ActiveMove) => {
    if (!latestRoom?.game) return
    latestRoom = {
      ...latestRoom,
      game: {
        ...latestRoom.game,
        activeMove,
      },
    }
    onRoom(latestRoom)
  }

  const handleDisconnect = (payload: { userId: string; room: Room }) => {
    if (payload.room.id === roomId) onRoom(payload.room)
  }

  const handleConnectError = (error: Error) => onError(error.message)
  const handleSocketError = (payload: { message?: string }) => {
    onError(payload.message ?? 'Connection error.')
  }

  socket.on('stateUpdate', handleState)
  socket.on('moveStart', handleMoveStart)
  socket.on('playerDisconnect', handleDisconnect)
  socket.on('connect_error', handleConnectError)
  socket.on('error', handleSocketError)

  void whenConnected()
    .then(() => syncRoom(roomId, userId))
    .then(onRoom)
    .catch((reason) => {
      const message =
        reason instanceof Error ? reason.message : 'Failed to sync room.'
      onError(message)
      // Stale room id (e.g. server restarted) — return to home instead of hanging.
      onRoom(null)
    })

  return () => {
    socket.off('stateUpdate', handleState)
    socket.off('moveStart', handleMoveStart)
    socket.off('playerDisconnect', handleDisconnect)
    socket.off('connect_error', handleConnectError)
    socket.off('error', handleSocketError)
  }
}

export async function startRoom(roomId: string, userId: string) {
  await emitAck('startRoom', { roomId, userId })
}

export async function rollDice(roomId: string, userId: string, dice: number) {
  await emitAck('rollDice', { roomId, userId, dice })
}

export async function movePawn(
  roomId: string,
  userId: string,
  tokenId: number,
  startedAt: number,
  targetProgress: number,
) {
  await emitAck('movePawn', {
    roomId,
    userId,
    tokenId,
    startedAt,
    targetProgress,
  })
}

export async function resolvePendingPower(
  roomId: string,
  userId: string,
  startedAt: number,
) {
  await emitAck('resolvePower', { roomId, userId, startedAt })
}

export async function moveTokenWithRetry(
  roomId: string,
  userId: string,
  tokenId: number,
  startedAt: number,
  targetProgress: number,
  waitForRoll?: () => Promise<void>,
) {
  try {
    await movePawn(roomId, userId, tokenId, startedAt, targetProgress)
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (
      waitForRoll &&
      (message.includes('cannot be moved') ||
        message.includes('cannot be rolled') ||
        message.includes('not your turn'))
    ) {
      await waitForRoll()
      await movePawn(roomId, userId, tokenId, startedAt, targetProgress)
      return
    }
    throw error
  }
}

export async function leaveRoom(roomId: string, userId: string) {
  await emitAck('leaveRoom', { roomId, userId })
}
