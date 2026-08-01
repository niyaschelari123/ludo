import { isBlitzMode } from '../../src/game/types.js'
import { getRoom } from './roomManager.js'
import type { Room } from '../../src/game/types.js'

const blitzTimers = new Map<string, ReturnType<typeof setTimeout>>()

export function stopBlitzTimer(roomId: string) {
  const timer = blitzTimers.get(roomId)
  if (timer) {
    clearTimeout(timer)
    blitzTimers.delete(roomId)
  }
}

export function scheduleBlitzTimer(
  roomId: string,
  onTimeout: (roomId: string) => void,
) {
  stopBlitzTimer(roomId)

  let room: Room
  try {
    room = getRoom(roomId)
  } catch {
    return
  }

  if (!isBlitzMode(room.gameMode) || room.status !== 'playing' || !room.game?.endsAt) {
    return
  }

  const delay = Math.max(0, room.game.endsAt - Date.now())
  blitzTimers.set(
    roomId,
    setTimeout(() => {
      blitzTimers.delete(roomId)
      onTimeout(roomId)
    }, delay),
  )
}
