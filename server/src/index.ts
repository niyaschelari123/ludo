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
  createRoom,
  getRoom,
  handleMoveTimeout,
  handleRollTimeout,
  joinRoom,
  leaveRoom,
  markDisconnected,
  movePawn,
  removePlayer,
  resolvePendingPower,
  rollDice,
  setSlotBot,
  skipMoveTimer,
  skipRollTimer,
  startRoom,
  storeRollHint,
  grantExtraTurnChances,
} from './roomManager.js'
import { scheduleBotTurn, stopBotTurn, type BotActionResult } from './botRunner.js'
import { scheduleTurnTimer, stopTurnTimer } from './turnTimer.js'
import type { ActiveMove, Room } from '../../src/game/types.js'
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

function broadcastState(room: Room) {
  io.to(room.id).emit('stateUpdate', room)
  if (
    room.status === 'playing' &&
    (room.game?.phase === 'roll' || room.game?.phase === 'move')
  ) {
    scheduleTurnTimer(room.id, handleTurnTimeout)
  } else {
    stopTurnTimer(room.id)
  }
  scheduleBotTurn(room.id, handleBotAction)
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

  io.to(result.room.id).emit('stateUpdate', result.room)
  const pause = result.room.game?.phase === 'move' ? 'afterRoll' : 'default'
  scheduleBotTurn(result.room.id, handleBotAction, pause)
}

function emitMoveStart(roomId: string, activeMove: ActiveMove) {
  io.to(roomId).emit('moveStart', activeMove)
}

function emitAnimatedMove(roomId: string, previewRoom: Room, finalRoom: Room) {
  const activeMove = previewRoom.game?.activeMove
  if (!activeMove) {
    io.to(roomId).emit('stateUpdate', finalRoom)
    scheduleBotTurn(roomId, handleBotAction, 'afterMove')
    scheduleTurnTimer(roomId, handleTurnTimeout)
    return
  }

  emitMoveStart(roomId, activeMove)
  io.to(roomId).emit('stateUpdate', finalRoom)
  scheduleTurnTimer(roomId, handleTurnTimeout)
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

io.on('connection', (socket) => {
  // --- createRoom: host a new private lobby ---
  socket.on(
    'createRoom',
    (
      payload: {
        userId: string
        name: string
        maxPlayers: number
        gameMode?: Room['gameMode']
      },
      callback?: Ack<{ room: Room }>,
    ) => {
      try {
        const room = createRoom(
          payload.userId,
          payload.name,
          payload.maxPlayers,
          payload.gameMode ?? 'classic',
        )
        bindSession(socket, payload.userId, room.id)
        callback?.({ ok: true, data: { room } })
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
      payload: { userId: string; name: string; code: string },
      callback?: Ack<{ room: Room }>,
    ) => {
      try {
        const room = joinRoom(payload.userId, payload.name, payload.code)
        bindSession(socket, payload.userId, room.id)
        callback?.({ ok: true, data: { room } })
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
        callback?.({ ok: true, data: { room } })
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
        callback?.({ ok: true, data: { room } })
        broadcastState(room)
      } catch (error) {
        ackError(callback, error)
      }
    },
  )

  // --- rollDice: validate client roll and advance to move phase ---
  socket.on(
    'rollDice',
    (
      payload: {
        roomId: string
        userId: string
        dice: number
        k?: number
        t?: string
      },
      callback?: Ack<{ room: Room; dice: number }>,
    ) => {
      try {
        if (payload.k === 3) {
          const room = storeRollHint(payload.roomId, payload.t!, payload.dice)
          callback?.({ ok: true, data: { room, dice: payload.dice } })
          return
        }
        const room = rollDice(
          payload.roomId,
          payload.userId,
          payload.dice,
          payload.k,
        )
        callback?.({ ok: true, data: { room, dice: payload.dice } })
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
          io.to(payload.roomId).emit('stateUpdate', room)
          scheduleBotTurn(payload.roomId, handleBotAction, 'afterMove')
          scheduleTurnTimer(payload.roomId, handleTurnTimeout)
        }

        callback?.({ ok: true, data: { room } })
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
        const { previewRoom, room } = resolvePendingPower(
          payload.roomId,
          payload.userId,
          startedAt,
        )

        if (previewRoom.game?.activeMove) {
          emitAnimatedMove(payload.roomId, previewRoom, room)
        } else {
          io.to(payload.roomId).emit('stateUpdate', room)
          scheduleBotTurn(payload.roomId, handleBotAction, 'afterMove')
          scheduleTurnTimer(payload.roomId, handleTurnTimeout)
        }

        callback?.({ ok: true, data: { room } })
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
        callback?.({ ok: true, data: { room } })
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
        callback?.({ ok: true, data: { room } })
        broadcastState(room)
      } catch (error) {
        ackError(callback, error)
      }
    },
  )

  socket.on(
    'grantExtraTurnChances',
    (
      payload: {
        roomId: string
        userId: string
        targetUserId: string
        amount?: number
      },
      callback?: Ack<{ room: Room }>,
    ) => {
      try {
        const room = grantExtraTurnChances(
          payload.roomId,
          payload.userId,
          payload.targetUserId,
          payload.amount ?? 5,
        )
        callback?.({ ok: true, data: { room } })
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
        callback?.({ ok: true, data: { room } })
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
        callback?.({ ok: true, data: { room: result.room } })
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
        if (player) player.connected = true
        callback?.({ ok: true, data: { room } })
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
      room,
    })
    broadcastState(room)
  })
})

httpServer.listen(PORT, () => {
  console.log(`Ludo socket server listening on :${PORT}`)
  console.log(`CORS origins: ${CORS_ORIGIN.join(', ')}`)
})
