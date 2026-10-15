import {
  isReactionKind,
  type ReactionKind,
} from '../../src/game/reactions.js'
import type { BoardReaction, Room } from '../../src/game/types.js'

const COOLDOWN_MS = 700
const lastSentAt = new Map<string, number>()

function cooldownKey(roomId: string, userId: string) {
  return `${roomId}:${userId}`
}

export function postBoardReaction(
  room: Room,
  userId: string,
  kindRaw: unknown,
): BoardReaction {
  const sender = room.players.find((player) => player.id === userId)
  if (!sender || sender.isBot) {
    throw new Error('Only players can react.')
  }
  if (room.status !== 'playing' && room.status !== 'lobby') {
    throw new Error('Reactions are only available in the room.')
  }
  if (!isReactionKind(kindRaw)) {
    throw new Error('Unknown reaction.')
  }
  const kind: ReactionKind = kindRaw
  const key = cooldownKey(room.id, userId)
  const now = Date.now()
  const previous = lastSentAt.get(key) ?? 0
  if (now - previous < COOLDOWN_MS) {
    throw new Error('Wait a moment before reacting again.')
  }
  lastSentAt.set(key, now)

  return {
    id: crypto.randomUUID(),
    roomId: room.id,
    fromId: sender.id,
    fromName: sender.name,
    fromColor: sender.color,
    kind,
    at: now,
  }
}

export function clearRoomReactions(roomId: string) {
  for (const key of lastSentAt.keys()) {
    if (key.startsWith(`${roomId}:`)) lastSentAt.delete(key)
  }
}
