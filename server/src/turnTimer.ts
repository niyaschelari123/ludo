import {
  TURN_MOVE_TIMEOUT_MS,
  TURN_ROLL_TIMEOUT_MS,
} from '../../src/game/engine.js'
import type { Room } from '../../src/game/types.js'
import { getRoom } from './roomManager.js'

const turnTimers = new Map<string, ReturnType<typeof setTimeout>>()

export function clearTurnTimer(roomId: string) {
  const timer = turnTimers.get(roomId)
  if (timer) {
    clearTimeout(timer)
    turnTimers.delete(roomId)
  }
}

export function scheduleTurnTimer(
  roomId: string,
  onTimeout: (roomId: string) => void,
) {
  clearTurnTimer(roomId)

  let room: Room
  try {
    room = getRoom(roomId)
  } catch {
    return
  }

  if (room.status !== 'playing' || !room.game) return
  const phase = room.game.phase
  if (phase !== 'roll' && phase !== 'move') return

  const player = room.players[room.game.turnIndex]
  if (!player || player.isBot) return

  const fallback =
    phase === 'move' ? TURN_MOVE_TIMEOUT_MS : TURN_ROLL_TIMEOUT_MS
  const deadline = room.game.turnDeadline ?? Date.now() + fallback
  const delay = Math.max(0, deadline - Date.now())

  turnTimers.set(
    roomId,
    setTimeout(() => {
      turnTimers.delete(roomId)
      onTimeout(roomId)
    }, delay),
  )
}

export function stopTurnTimer(roomId: string) {
  clearTurnTimer(roomId)
}
