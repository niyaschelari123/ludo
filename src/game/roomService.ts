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
  options?: {
    color?: string
    lockColor?: boolean
    blitzDurationMs?: number
    teamSize?: 2 | 3
    teamAssign?: 'random' | 'manual'
    quickTokens?: number
  },
) {
  const { room } = await emitAck<{ room: Room }>('createRoom', {
    userId,
    name,
    maxPlayers,
    gameMode,
    ...(options?.color ? { color: options.color, lockColor: options.lockColor } : {}),
    ...(gameMode === 'blitz'
      ? { blitzDurationMs: options?.blitzDurationMs }
      : {}),
    ...(gameMode === 'quick'
      ? { quickTokens: options?.quickTokens ?? 3 }
      : {}),
    ...(gameMode === 'team'
      ? {
          teamSize: options?.teamSize ?? 2,
          teamAssign: options?.teamAssign ?? 'random',
        }
      : {}),
  })
  return room
}

export async function setQuickTokens(
  roomId: string,
  userId: string,
  quickTokens: number,
) {
  const { room } = await emitAck<{ room: Room }>('setQuickTokens', {
    roomId,
    userId,
    quickTokens,
  })
  return room
}

export async function setTeams(
  roomId: string,
  userId: string,
  teams: Array<{ id?: string; memberIds: string[] }>,
  teamAssign?: 'random' | 'manual',
) {
  const { room } = await emitAck<{ room: Room }>('setTeams', {
    roomId,
    userId,
    teams,
    teamAssign,
  })
  return room
}

export async function setBlitzDuration(
  roomId: string,
  userId: string,
  blitzDurationMs: number,
) {
  const { room } = await emitAck<{ room: Room }>('setBlitzDuration', {
    roomId,
    userId,
    blitzDurationMs,
  })
  return room
}

export async function extendBlitzTime(roomId: string, userId: string) {
  const { room } = await emitAck<{ room: Room }>('extendBlitzTime', {
    roomId,
    userId,
  })
  return room
}

export async function joinRoom(
  userId: string,
  name: string,
  code: string,
  options?: { color?: string; lockColor?: boolean },
) {
  const { room } = await emitAck<{ room: Room }>('joinRoom', {
    userId,
    name,
    code,
    ...(options?.color ? { color: options.color, lockColor: options.lockColor } : {}),
  })
  return room
}

/** Take over a seat with room code + host seat code (works mid-game). */
export async function claimSeat(
  userId: string,
  name: string,
  roomCode: string,
  seatCode: string,
) {
  const { room } = await emitAck<{ room: Room }>('claimSeat', {
    userId,
    name,
    roomCode,
    seatCode,
  })
  return room
}

export async function listColorClaims() {
  const { claims } = await emitAck<{ claims: Record<string, string> }>(
    'listColorClaims',
    {},
  )
  return claims
}

export async function claimColor(accountId: string, color: string) {
  const { claims } = await emitAck<{ claims: Record<string, string> }>(
    'claimColor',
    { accountId, color },
  )
  return claims
}

export async function releaseColor(accountId: string) {
  const { claims } = await emitAck<{ claims: Record<string, string> }>(
    'releaseColor',
    { accountId },
  )
  return claims
}

export function watchColorClaims(
  onClaims: (claims: Record<string, string>) => void,
) {
  const socket = getSocket()
  const handle = (claims: Record<string, string>) => onClaims(claims)
  socket.on('colorClaimsUpdate', handle)
  void whenConnected()
    .then(() => listColorClaims())
    .then(onClaims)
    .catch(() => {})
  return () => {
    socket.off('colorClaimsUpdate', handle)
  }
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
  onMoveStart?: (move: ActiveMove) => void,
) {
  const socket = getSocket()

  const handleState = (room: Room) => {
    if (room.id !== roomId) return
    onRoom(room)
  }

  const handleMoveStart = (move: ActiveMove) => {
    onMoveStart?.(move)
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

export async function setSlotBot(
  roomId: string,
  userId: string,
  seat: number,
  add: boolean,
) {
  const { room } = await emitAck<{ room: Room }>('setSlotBot', {
    roomId,
    userId,
    seat,
    add,
  })
  return room
}

export async function startRoom(roomId: string, userId: string) {
  await emitAck('startRoom', { roomId, userId })
}

/**
 * The server decides the dice value and returns it together with the resulting
 * room, so the roller renders exactly what every other client receives.
 */
export async function rollDice(
  roomId: string,
  userId: string,
  dice?: number,
  extras?: { k?: number; t?: string },
) {
  return emitAck<{ room: Room; dice: number }>('rollDice', {
    roomId,
    userId,
    ...(dice !== undefined ? { dice } : {}),
    ...(extras?.k !== undefined ? { k: extras.k, t: extras.t } : {}),
  })
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
  waitForRoll?: () => Promise<unknown>,
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

export async function removePlayer(
  roomId: string,
  userId: string,
  targetUserId: string,
) {
  const { room } = await emitAck<{ room: Room }>('removePlayer', {
    roomId,
    userId,
    targetUserId,
  })
  return room
}

export async function setPlayerAutoPlay(
  roomId: string,
  userId: string,
  targetUserId: string,
  enabled: boolean,
) {
  const { room } = await emitAck<{ room: Room }>('setPlayerAutoPlay', {
    roomId,
    userId,
    targetUserId,
    enabled,
  })
  return room
}

export async function skipMoveTimer(roomId: string, userId: string) {
  const { room } = await emitAck<{ room: Room }>('skipMoveTimer', {
    roomId,
    userId,
  })
  return room
}

export async function skipRollTimer(roomId: string, userId: string) {
  const { room } = await emitAck<{ room: Room }>('skipRollTimer', {
    roomId,
    userId,
  })
  return room
}

export async function skipPowerTimer(roomId: string, userId: string) {
  const { room } = await emitAck<{ room: Room }>('skipPowerTimer', {
    roomId,
    userId,
  })
  return room
}

export async function leaveRoom(
  roomId: string,
  userId: string,
  newHostId?: string,
) {
  await emitAck('leaveRoom', { roomId, userId, newHostId })
}
