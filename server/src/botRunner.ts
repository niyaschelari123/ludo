import { pickBestMovableToken } from '../../src/game/engine.js'
import { isAutoControlled, type Room } from '../../src/game/types.js'
import {
  getRoom,
  movePawn,
  resolvePendingPower,
  rollDice,
} from './roomManager.js'

const BOT_BEFORE_ROLL_MS = 1800
const BOT_AFTER_ROLL_MS = 2600
const BOT_BEFORE_MOVE_MS = 1400
const BOT_POWER_MS = 2200
const BOT_AFTER_MOVE_MS = 1100
const BOT_TURN_HANDOFF_MS = 1400

export type BotPauseKind = 'default' | 'afterRoll' | 'afterMove'

const botTimers = new Map<string, ReturnType<typeof setTimeout>>()

function humanPause(baseMs: number) {
  const jitter = Math.floor(Math.random() * 600) - 200
  return Math.max(500, baseMs + jitter)
}

function clearBotTimer(roomId: string) {
  const timer = botTimers.get(roomId)
  if (timer) {
    clearTimeout(timer)
    botTimers.delete(roomId)
  }
}

function botDelay(room: Room, pause: BotPauseKind = 'default') {
  const game = room.game
  if (!game) return humanPause(BOT_TURN_HANDOFF_MS)

  if (game.phase === 'roll') return humanPause(BOT_BEFORE_ROLL_MS)
  if (game.phase === 'power') return humanPause(BOT_POWER_MS)
  if (game.phase === 'move') {
    if (pause === 'afterRoll') return humanPause(BOT_AFTER_ROLL_MS)
    if (pause === 'afterMove') return humanPause(BOT_AFTER_MOVE_MS)
    return humanPause(BOT_BEFORE_MOVE_MS)
  }
  return humanPause(BOT_TURN_HANDOFF_MS)
}

export type BotActionResult =
  | { kind: 'state'; room: Room }
  | { kind: 'move'; previewRoom: Room; room: Room }
  | { kind: 'none' }

export function runBotStep(roomId: string): BotActionResult {
  const room = getRoom(roomId)
  if (room.status !== 'playing' || !room.game) return { kind: 'none' }

  const player = room.players[room.game.turnIndex]
  if (!isAutoControlled(player)) return { kind: 'none' }

  const game = room.game

  if (game.phase === 'roll') {
    const { room: nextRoom } = rollDice(roomId, player.id)
    return { kind: 'state', room: nextRoom }
  }

  if (game.phase === 'move') {
    const token = pickBestMovableToken(room)
    if (!token) return { kind: 'none' }
    const startedAt = Date.now()
    const targetProgress =
      token.progress === -1 ? 0 : token.progress + (game.dice ?? 1)
    const { previewRoom, room: nextRoom } = movePawn(
      roomId,
      player.id,
      token.id,
      startedAt,
      targetProgress,
    )
    return { kind: 'move', previewRoom, room: nextRoom }
  }

  if (game.phase === 'power') {
    const startedAt = Date.now()
    const { previewRoom, room: nextRoom } = resolvePendingPower(
      roomId,
      player.id,
      startedAt,
    )
    return { kind: 'move', previewRoom, room: nextRoom }
  }

  return { kind: 'none' }
}

export function scheduleBotTurn(
  roomId: string,
  onResult: (result: BotActionResult) => void,
  pause: BotPauseKind = 'default',
) {
  clearBotTimer(roomId)

  let room: Room
  try {
    room = getRoom(roomId)
  } catch {
    return
  }

  if (room.status !== 'playing' || !room.game) return
  const player = room.players[room.game.turnIndex]
  if (!isAutoControlled(player)) return

  const delay = botDelay(room, pause)
  botTimers.set(
    roomId,
    setTimeout(() => {
      botTimers.delete(roomId)
      try {
        const result = runBotStep(roomId)
        onResult(result)
      } catch (error) {
        console.error(`Bot turn failed in room ${roomId}:`, error)
      }
    }, delay),
  )
}

export function stopBotTurn(roomId: string) {
  clearBotTimer(roomId)
}
