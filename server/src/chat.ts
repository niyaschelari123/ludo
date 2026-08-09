import type { ChatMessage, Room } from '../../src/game/types.js'

const MAX_CHAT_MESSAGES = 120
const MAX_CHAT_LENGTH = 200

const chatByRoom = new Map<string, ChatMessage[]>()

function cleanText(text: string) {
  return text.replace(/\s+/g, ' ').trim().slice(0, MAX_CHAT_LENGTH)
}

export function clearRoomChat(roomId: string) {
  chatByRoom.delete(roomId)
}

export function chatHistoryFor(roomId: string, userId: string): ChatMessage[] {
  return (chatByRoom.get(roomId) ?? []).filter(
    (message) =>
      message.scope === 'all' ||
      message.fromId === userId ||
      message.toId === userId,
  )
}

export function postChatMessage(
  room: Room,
  userId: string,
  text: string,
  options?: { toUserId?: string | null },
): ChatMessage {
  const sender = room.players.find((player) => player.id === userId)
  if (!sender || sender.isBot) {
    throw new Error('Only players can chat.')
  }

  const body = cleanText(text)
  if (!body) throw new Error('Message cannot be empty.')

  const toUserId = options?.toUserId?.trim() || null
  let scope: ChatMessage['scope'] = 'all'
  let toId: string | undefined
  let toName: string | undefined

  if (toUserId) {
    if (toUserId === userId) {
      throw new Error('Cannot message yourself.')
    }
    const target = room.players.find(
      (player) => player.id === toUserId && !player.isBot,
    )
    if (!target) {
      throw new Error('That player is not in this room.')
    }
    scope = 'dm'
    toId = target.id
    toName = target.name
  }

  const message: ChatMessage = {
    id: crypto.randomUUID(),
    roomId: room.id,
    fromId: sender.id,
    fromName: sender.name,
    fromColor: sender.color,
    text: body,
    scope,
    toId,
    toName,
    at: Date.now(),
  }

  const list = chatByRoom.get(room.id) ?? []
  list.push(message)
  while (list.length > MAX_CHAT_MESSAGES) list.shift()
  chatByRoom.set(room.id, list)
  return message
}
