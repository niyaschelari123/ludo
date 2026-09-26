import { hasSuperGunReady } from '../../src/game/superGun.js'
import type { Room } from '../../src/game/types.js'
import { getRoom } from './roomManager.js'

const gunTimers = new Map<string, ReturnType<typeof setTimeout>>()

export function clearSuperGunTimer(roomId: string) {
  const timer = gunTimers.get(roomId)
  if (timer) {
    clearTimeout(timer)
    gunTimers.delete(roomId)
  }
}

export function scheduleSuperGunTimer(
  roomId: string,
  onTimeout: (roomId: string) => void,
) {
  clearSuperGunTimer(roomId)

  let room: Room
  try {
    room = getRoom(roomId)
  } catch {
    return
  }

  if (room.status !== 'playing' || !room.game) return
  const player = room.players[room.game.turnIndex]
  if (!player || !hasSuperGunReady(room, player.id)) return

  const deadline = room.game.superGunDeadline ?? Date.now()
  const delay = Math.max(0, deadline - Date.now())

  gunTimers.set(
    roomId,
    setTimeout(() => {
      gunTimers.delete(roomId)
      onTimeout(roomId)
    }, delay),
  )
}

export function stopSuperGunTimer(roomId: string) {
  clearSuperGunTimer(roomId)
}
