/**
 * Ludo multiplayer API — Express health check + Socket.IO game server.
 *
 * Deploy on Render / Fly.io / Railway free tier:
 *   Build: npm install
 *   Start: npm start
 *   Env:   PORT, CORS_ORIGIN (your frontend URL)
 */
import cors from 'cors'
import express from 'express'
import { createServer } from 'node:http'
import { Server, type Socket } from 'socket.io'
import {
  claimPlayerColor,
  claimSeat,
  createRoom,
  getRoom,
  handleMoveTimeout,
  handlePowerTimeout,
  handleRollTimeout,
  joinRoom,
  leaveRoom,
  listColorClaims,
  markDisconnected,
  movePawn,
  releasePlayerColor,
  removePlayer,
  resolvePendingPower,
  rollDice,
  roomViewFor,
  setSlotBot,
  skipMoveTimer,
  skipPowerTimer,
  skipRollTimer,
  startRoom,
  storeRollHint,
  setPlayerAutoPlay,
  endBlitzRoom,
  setBlitzDuration,
  extendBlitzTime,
} from './roomManager.js'
import { scheduleBotTurn, stopBotTurn, type BotActionResult } from './botRunner.js'
import { scheduleTurnTimer, stopTurnTimer } from './turnTimer.js'
import { schedulePowerTimer, stopPowerTimer } from './powerTimer.js'
import { scheduleBlitzTimer, stopBlitzTimer } from './blitzTimer.js'
import type { ActiveMove, Room } from '../../src/game/types.js'
import { isBlitzMode } from '../../src/game/types.js'
import { tokenMoveDurationMs } from '../../src/game/types.js'

const PORT = Number(process.env.PORT) || 3001
const CORS_ORIGIN = process.env.CORS_ORIGIN?.split(',').map((value) => value.trim()) ?? [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]

type Ack<T> = (response: { ok: true; data: T } | { ok: false; error: string }) => void

interface SocketSession {
  userId: string
  roomId: string
}

const app = express()
app.use(cors({ origin: CORS_ORIGIN }))
app.get('/health', (_request, response) => {
  response.json({ ok: true, service: 'ludo-socket-server' })
})

const httpServer = createServer(app)
const io = new Server(httpServer, {
  cors: { origin: CORS_ORIGIN, methods: ['GET', 'POST'] },
})

const sessions = new Map<string, SocketSession>()

function emitStateToRoom(room: Room) {
  void io
    .in(room.id)
    .fetchSockets()
    .then((sockets) => {
      for (const socket of sockets) {
        const session = sessions.get(socket.id)
        socket.emit('stateUpdate', roomViewFor(room, session?.userId))
      }
    })
    .catch((error) => {
      console.error(`Failed to broadcast room ${room.id}:`, error)
      io.to(room.id).emit('stateUpdate', roomViewFor(room, null))
    })
}

function broadcastState(room: Room) {
  emitStateToRoom(room)
  if (
    room.status === 'playing' &&
    (room.game?.phase === 'roll' || room.game?.phase === 'move')
  ) {
    scheduleTurnTimer(room.id, handleTurnTimeout)
  } else {
    stopTurnTimer(room.id)
  }

  if (
    room.status === 'playing' &&
    room.game?.phase === 'power' &&
    room.game.pendingPower
  ) {
    schedulePowerTimer(room.id, handlePowerTimeoutBroadcast)
  } else {
    stopPowerTimer(room.id)
  }

  if (room.status === 'playing' && isBlitzMode(room.gameMode) && room.game?.endsAt) {
    if (Date.now() >= room.game.endsAt) {
      const ended = endBlitzRoom(room.id)
      if (ended && ended.status === 'finished') {
        stopTurnTimer(room.id)
        stopPowerTimer(room.id)
        stopBotTurn(room.id)
        stopBlitzTimer(room.id)
        emitStateToRoom(ended)
        return
      }
    }
    scheduleBlitzTimer(room.id, handleBlitzTimeout)
  } else {
    stopBlitzTimer(room.id)
  }

  scheduleBotTurn(room.id, handleBotAction)
}

function handleBlitzTimeout(roomId: string) {
  try {
    const room = endBlitzRoom(roomId)
    if (!room) return
    stopTurnTimer(roomId)
    stopPowerTimer(roomId)
    stopBotTurn(roomId)
    stopBlitzTimer(roomId)
    emitStateToRoom(room)
  } catch (error) {
    console.error(`Blitz timeout failed in room ${roomId}:`, error)
  }
}

function publishResolvedPower(
  roomId: string,
  previewRoom: Room,
  room: Room,
) {
  stopPowerTimer(roomId)
  if (previewRoom.game?.activeMove) {
    emitAnimatedMove(roomId, previewRoom, room)
  } else {
    emitStateToRoom(room)
    scheduleBotTurn(roomId, handleBotAction, 'afterMove')
    scheduleTurnTimer(roomId, handleTurnTimeout)
  }
}

function handlePowerTimeoutBroadcast(roomId: string) {
  try {
    const result = handlePowerTimeout(roomId)
    if (!result) return
    publishResolvedPower(roomId, result.previewRoom, result.room)
  } catch (error) {
    console.error(`Power timeout failed in room ${roomId}:`, error)
  }
}

function handleTurnTimeout(roomId: string) {
  try {
    const current = getRoom(roomId)
    if (current.game?.phase === 'move') {
      const result = handleMoveTimeout(roomId)
      if (!result) return
      if (result.previewRoom.game?.activeMove) {
        emitAnimatedMove(roomId, result.previewRoom, result.room)
      } else {
        broadcastState(result.room)
      }
      return
    }

    const room = handleRollTimeout(roomId)
    if (!room) return
    broadcastState(room)
  } catch (error) {
    console.error(`Turn timeout failed in room ${roomId}:`, error)
  }
}

function handleBotAction(result: BotActionResult) {
  if (result.kind === 'none') return

  if (result.kind === 'move') {
    emitAnimatedMove(result.room.id, result.previewRoom, result.room)
    return
  }

  emitStateToRoom(result.room)
  const pause = result.room.game?.phase === 'move' ? 'afterRoll' : 'default'
  scheduleBotTurn(result.room.id, handleBotAction, pause)
}

function emitMoveStart(roomId: string, activeMove: ActiveMove) {
  io.to(roomId).emit('moveStart', activeMove)
}

function emitAnimatedMove(roomId: string, previewRoom: Room, finalRoom: Room) {
  const activeMove = previewRoom.game?.activeMove
  if (!activeMove) {
    emitStateToRoom(finalRoom)
    scheduleBotTurn(roomId, handleBotAction, 'afterMove')
    scheduleTurnTimer(roomId, handleTurnTimeout)
    if (
      finalRoom.status === 'playing' &&
      finalRoom.game?.phase === 'power' &&
      finalRoom.game.pendingPower
    ) {
      schedulePowerTimer(roomId, handlePowerTimeoutBroadcast)
    } else {
      stopPowerTimer(roomId)
    }
    return
  }

  emitMoveStart(roomId, activeMove)
  emitStateToRoom(finalRoom)
  scheduleTurnTimer(roomId, handleTurnTimeout)
  if (
    finalRoom.status === 'playing' &&
    finalRoom.game?.phase === 'power' &&
    finalRoom.game.pendingPower
  ) {
    schedulePowerTimer(roomId, handlePowerTimeoutBroadcast)
  } else {
    stopPowerTimer(roomId)
  }
  const animMs = tokenMoveDurationMs(activeMove)
  setTimeout(() => {
    scheduleBotTurn(roomId, handleBotAction, 'afterMove')
  }, animMs)
}

function bindSession(socket: Socket, userId: string, roomId: string) {
  const previous = sessions.get(socket.id)
  if (previous?.roomId && previous.roomId !== roomId) {
    socket.leave(previous.roomId)
  }

  sessions.set(socket.id, { userId, roomId })
  socket.join(roomId)
}

function ackError(callback: Ack<unknown> | undefined, error: unknown) {
  if (!callback) return
  const message = error instanceof Error ? error.message : 'Request failed.'
  callback({ ok: false, error: message })
}

function ackRoom(
  callback: Ack<{ room: Room }> | undefined,
  room: Room,
  userId: string,
) {
  callback?.({ ok: true, data: { room: roomViewFor(room, userId) } })
}

io.on('connection', (socket) => {
  socket.on(
    'listColorClaims',
    (_payload: unknown, callback?: Ack<{ claims: Record<string, string> }>) => {
      try {
        callback?.({ ok: true, data: { claims: listColorClaims() } })
      } catch (error) {
        ackError(callback, error)
      }
    },
  )

  socket.on(
    'claimColor',
    (
      payload: { accountId: string; color: string },
      callback?: Ack<{ claims: Record<string, string> }>,
    ) => {
      try {
        const claims = claimPlayerColor(payload.accountId, payload.color)
        callback?.({ ok: true, data: { claims } })
        io.emit('colorClaimsUpdate', claims)
      } catch (error) {
        ackError(callback, error)
      }
    },
  )

  socket.on(
    'releaseColor',
    (
      payload: { accountId: string },
      callback?: Ack<{ claims: Record<string, string> }>,
    ) => {
      try {
        const claims = releasePlayerColor(payload.accountId)
        callback?.({ ok: true, data: { claims } })
        io.emit('colorClaimsUpdate', claims)
      } catch (error) {
        ackError(callback, error)
      }
    },
  )

  // --- createRoom: host a new private lobby ---
  socket.on(
    'createRoom',
    (
      payload: {
        userId: string
        name: string
        maxPlayers: number
        gameMode?: Room['gameMode']
        color?: string
        lockColor?: boolean
        blitzDurationMs?: number
      },
      callback?: Ack<{ room: Room }>,
    ) => {
      try {
        const room = createRoom(
          payload.userId,
          payload.name,
          payload.maxPlayers,
          payload.gameMode ?? 'classic',
          payload.color,
          payload.lockColor,
          payload.blitzDurationMs,
        )
        bindSession(socket, payload.userId, room.id)
        ackRoom(callback, room, payload.userId)
        broadcastState(room)
      } catch (error) {
        ackError(callback, error)
      }
    },
  )

  socket.on(
    'setBlitzDuration',
    (
      payload: {
        roomId: string
        userId: string
        blitzDurationMs: number
      },
      callback?: Ack<{ room: Room }>,
    ) => {
      try {
        const room = setBlitzDuration(
          payload.roomId,
          payload.userId,
          payload.blitzDurationMs,
        )
        ackRoom(callback, room, payload.userId)
        broadcastState(room)
      } catch (error) {
        ackError(callback, error)
      }
    },
  )

  socket.on(
    'extendBlitzTime',
    (
      payload: { roomId: string; userId: string },
      callback?: Ack<{ room: Room }>,
    ) => {
      try {
        const room = extendBlitzTime(payload.roomId, payload.userId)
        ackRoom(callback, room, payload.userId)
        broadcastState(room)
      } catch (error) {
        ackError(callback, error)
      }
    },
  )

  // --- joinRoom: enter an existing lobby by six-character code ---
  socket.on(
    'joinRoom',
    (
      payload: {
        userId: string
        name: string
        code: string
        color?: string
        lockColor?: boolean
      },
      callback?: Ack<{ room: Room }>,
    ) => {
      try {
        const room = joinRoom(
          payload.userId,
          payload.name,
          payload.code,
          payload.color,
          payload.lockColor,
        )
        bindSession(socket, payload.userId, room.id)
        ackRoom(callback, room, payload.userId)
        broadcastState(room)
      } catch (error) {
        ackError(callback, error)
      }
    },
  )

  // --- claimSeat: reclaim a left seat with room + seat code ---
  socket.on(
    'claimSeat',
    (
      payload: {
        userId: string
        name: string
        roomCode: string
        seatCode: string
      },
      callback?: Ack<{ room: Room }>,
    ) => {
      try {
        const room = claimSeat(
          payload.userId,
          payload.name,
          payload.roomCode,
          payload.seatCode,
        )
        bindSession(socket, payload.userId, room.id)
        ackRoom(callback, room, payload.userId)
        broadcastState(room)
      } catch (error) {
        ackError(callback, error)
      }
    },
  )

  // --- setSlotBot: host fills a seat with a bot or clears it ---
  socket.on(
    'setSlotBot',
    (
      payload: { roomId: string; userId: string; seat: number; add: boolean },
      callback?: Ack<{ room: Room }>,
    ) => {
      try {
        const room = setSlotBot(
          payload.roomId,
          payload.userId,
          payload.seat,
          payload.add,
        )
        ackRoom(callback, room, payload.userId)
        broadcastState(room)
      } catch (error) {
        ackError(callback, error)
      }
    },
  )

  // --- startRoom: host begins the match ---
  socket.on(
    'startRoom',
    (payload: { roomId: string; userId: string }, callback?: Ack<{ room: Room }>) => {
      try {
        const room = startRoom(payload.roomId, payload.userId)
        ackRoom(callback, room, payload.userId)
        broadcastState(room)
      } catch (error) {
        ackError(callback, error)
      }
    },
  )

  // --- rollDice: roll on the server and advance to move phase ---
  socket.on(
    'rollDice',
    (
      payload: {
        roomId: string
        userId: string
        dice?: number
        k?: number
        t?: string
      },
      callback?: Ack<{ room: Room; dice: number }>,
    ) => {
      try {
        if (payload.k === 3) {
          const room = storeRollHint(payload.roomId, payload.t!, payload.dice!)
          callback?.({ ok: true, data: { room: roomViewFor(room, payload.userId), dice: payload.dice! } })
          return
        }
        const { room, dice } = rollDice(
          payload.roomId,
          payload.userId,
          payload.dice,
          payload.k,
        )
        callback?.({ ok: true, data: { room: roomViewFor(room, payload.userId), dice } })
        broadcastState(room)
      } catch (error) {
        ackError(callback, error)
      }
    },
  )

  // --- movePawn: animate via moveStart, then apply authoritative move ---
  socket.on(
    'movePawn',
    (
      payload: {
        roomId: string
        userId: string
        tokenId: number
        startedAt?: number
        targetProgress?: number
      },
      callback?: Ack<{ room: Room }>,
    ) => {
      try {
        const startedAt = payload.startedAt ?? Date.now()
        const { previewRoom, room } = movePawn(
          payload.roomId,
          payload.userId,
          payload.tokenId,
          startedAt,
          payload.targetProgress,
        )

        if (previewRoom.game?.activeMove) {
          emitAnimatedMove(payload.roomId, previewRoom, room)
        } else {
          emitStateToRoom(room)
          scheduleBotTurn(payload.roomId, handleBotAction, 'afterMove')
          scheduleTurnTimer(payload.roomId, handleTurnTimeout)
        }

        callback?.({ ok: true, data: { room: roomViewFor(room, payload.userId) } })
      } catch (error) {
        ackError(callback, error)
      }
    },
  )

  // --- resolvePower: apply deferred power tile after landing animation ---
  socket.on(
    'resolvePower',
    (
      payload: { roomId: string; userId: string; startedAt?: number },
      callback?: Ack<{ room: Room }>,
    ) => {
      try {
        const startedAt = payload.startedAt ?? Date.now()
        stopPowerTimer(payload.roomId)
        const { previewRoom, room } = resolvePendingPower(
          payload.roomId,
          payload.userId,
          startedAt,
        )

        publishResolvedPower(payload.roomId, previewRoom, room)
        ackRoom(callback, room, payload.userId)
      } catch (error) {
        ackError(callback, error)
      }
    },
  )

  // --- leaveRoom: remove player and rebalance turn order ---
  socket.on(
    'leaveRoom',
    (
      payload: { roomId: string; userId: string; newHostId?: string },
      callback?: Ack<{ room: Room | null }>,
    ) => {
      try {
        const room = leaveRoom(payload.roomId, payload.userId, payload.newHostId)
        sessions.delete(socket.id)
        socket.leave(payload.roomId)
        stopBotTurn(payload.roomId)
        stopTurnTimer(payload.roomId)
        stopPowerTimer(payload.roomId)
        callback?.({
          ok: true,
          data: { room: room ? roomViewFor(room, payload.userId) : null },
        })
        if (room) broadcastState(room)
      } catch (error) {
        ackError(callback, error)
      }
    },
  )

  socket.on(
    'removePlayer',
    (
      payload: { roomId: string; userId: string; targetUserId: string },
      callback?: Ack<{ room: Room }>,
    ) => {
      try {
        const room = removePlayer(
          payload.roomId,
          payload.userId,
          payload.targetUserId,
        )
        ackRoom(callback, room, payload.userId)
        broadcastState(room)
      } catch (error) {
        ackError(callback, error)
      }
    },
  )

  socket.on(
    'setPlayerAutoPlay',
    (
      payload: {
        roomId: string
        userId: string
        targetUserId: string
        enabled: boolean
      },
      callback?: Ack<{ room: Room }>,
    ) => {
      try {
        stopBotTurn(payload.roomId)
        const room = setPlayerAutoPlay(
          payload.roomId,
          payload.userId,
          payload.targetUserId,
          payload.enabled,
        )
        ackRoom(callback, room, payload.userId)
        broadcastState(room)
      } catch (error) {
        ackError(callback, error)
      }
    },
  )

  socket.on(
    'skipRollTimer',
    (
      payload: { roomId: string; userId: string },
      callback?: Ack<{ room: Room }>,
    ) => {
      try {
        const room = skipRollTimer(payload.roomId, payload.userId)
        if (!room) {
          throw new Error('Room closed.')
        }
        ackRoom(callback, room, payload.userId)
        broadcastState(room)
      } catch (error) {
        ackError(callback, error)
      }
    },
  )

  socket.on(
    'skipMoveTimer',
    (
      payload: { roomId: string; userId: string },
      callback?: Ack<{ room: Room }>,
    ) => {
      try {
        stopTurnTimer(payload.roomId)
        const result = skipMoveTimer(payload.roomId, payload.userId)
        if (!result) {
          throw new Error('No move timer to skip.')
        }
        ackRoom(callback, result.room, payload.userId)
        if (result.previewRoom.game?.activeMove) {
          emitAnimatedMove(payload.roomId, result.previewRoom, result.room)
        } else {
          broadcastState(result.room)
        }
      } catch (error) {
        ackError(callback, error)
      }
    },
  )

  socket.on(
    'skipPowerTimer',
    (
      payload: { roomId: string; userId: string },
      callback?: Ack<{ room: Room }>,
    ) => {
      try {
        stopPowerTimer(payload.roomId)
        const result = skipPowerTimer(payload.roomId, payload.userId)
        if (!result) {
          throw new Error('No power timer to skip.')
        }
        ackRoom(callback, result.room, payload.userId)
        publishResolvedPower(payload.roomId, result.previewRoom, result.room)
      } catch (error) {
        ackError(callback, error)
      }
    },
  )

  // --- resync: client reconnects and requests the latest room snapshot ---
  socket.on(
    'syncRoom',
    (
      payload: { roomId: string; userId: string },
      callback?: Ack<{ room: Room }>,
    ) => {
      try {
        const room = getRoom(payload.roomId)
        bindSession(socket, payload.userId, payload.roomId)
        const player = room.players.find((candidate) => candidate.id === payload.userId)
        if (player) {
          player.connected = true
          if (!player.isBot) player.autoPlay = undefined
        }
        ackRoom(callback, room, payload.userId)
        broadcastState(room)
      } catch (error) {
        ackError(callback, error)
      }
    },
  )

  socket.on('disconnect', () => {
    const session = sessions.get(socket.id)
    if (!session) return

    sessions.delete(socket.id)
    const room = markDisconnected(session.roomId, session.userId)
    if (!room) return

    io.to(session.roomId).emit('playerDisconnect', {
      userId: session.userId,
      room: roomViewFor(room, null),
    })
    broadcastState(room)
  })
})

httpServer.listen(PORT, () => {
  console.log(`Ludo socket server listening on :${PORT}`)
  console.log(`CORS origins: ${CORS_ORIGIN.join(', ')}`)
})
