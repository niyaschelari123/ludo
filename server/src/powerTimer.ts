import type { Room } from '../../src/game/types.js'
import { getRoom } from './roomManager.js'

/** Auto-resolve stuck power tiles if the lander's client never finishes. */
export const POWER_RESOLVE_TIMEOUT_MS = 4_500

const powerTimers = new Map<string, ReturnType<typeof setTimeout>>()

export function clearPowerTimer(roomId: string) {
  const timer = powerTimers.get(roomId)
  if (timer) {
    clearTimeout(timer)
    powerTimers.delete(roomId)
  }
}

export function schedulePowerTimer(
  roomId: string,
  onTimeout: (roomId: string) => void,
) {
  clearPowerTimer(roomId)

  let room: Room
  try {
    room = getRoom(roomId)
  } catch {
    return
  }

  if (
    room.status !== 'playing' ||
    !room.game ||
    room.game.phase !== 'power' ||
    !room.game.pendingPower
  ) {
    return
  }

  powerTimers.set(
    roomId,
    setTimeout(() => {
      powerTimers.delete(roomId)
      onTimeout(roomId)
    }, POWER_RESOLVE_TIMEOUT_MS),
  )
}

export function stopPowerTimer(roomId: string) {
  clearPowerTimer(roomId)
}
