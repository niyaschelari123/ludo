import {
  collection,
  doc,
  getDocs,
  limit,
  onSnapshot,
  query,
  runTransaction,
  setDoc,
  where,
} from 'firebase/firestore'
import { db } from '../firebase'
import { applyMove, applyRoll, createGame, hasActiveToken } from './engine'
import { PLAYER_COLORS, type Room } from './types'

const rooms = collection(db, 'rooms')

const roomCode = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(6)))
    .map((value) => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[value % 32])
    .join('')

const cleanName = (name: string) => name.trim().slice(0, 18) || 'Player'

export async function createRoom(
  userId: string,
  name: string,
  maxPlayers: number,
) {
  if (maxPlayers < 2 || maxPlayers > 8) {
    throw new Error('Room size must be between 2 and 8 players.')
  }
  const ref = doc(rooms)
  const now = Date.now()
  const room: Room = {
    id: ref.id,
    code: roomCode(),
    hostId: userId,
    memberIds: [userId],
    maxPlayers,
    status: 'lobby',
    players: [
      {
        id: userId,
        name: cleanName(name),
        color: PLAYER_COLORS[0],
        seat: 0,
        connected: true,
        joinedAt: now,
      },
    ],
    game: null,
    createdAt: now,
    updatedAt: now,
  }
  await setDoc(ref, room)
  return room.id
}

export async function joinRoom(userId: string, name: string, code: string) {
  const result = await getDocs(
    query(rooms, where('code', '==', code.trim().toUpperCase()), limit(1)),
  )
  if (result.empty) throw new Error('Room not found. Check the room code.')
  const ref = result.docs[0].ref

  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(ref)
    const room = snapshot.data() as Room
    const returning = room.players.find((player) => player.id === userId)
    if (returning) {
      returning.connected = true
      returning.name = cleanName(name)
    } else {
      if (room.status !== 'lobby') throw new Error('This game has already started.')
      if (room.players.length >= room.maxPlayers) throw new Error('This room is full.')
      const seat = room.players.length
      room.players.push({
        id: userId,
        name: cleanName(name),
        color: PLAYER_COLORS[seat],
        seat,
        connected: true,
        joinedAt: Date.now(),
      })
      room.memberIds.push(userId)
    }
    room.updatedAt = Date.now()
    transaction.set(ref, room)
  })
  return ref.id
}

export function watchRoom(
  roomId: string,
  onRoom: (room: Room | null) => void,
  onError: (message: string) => void,
) {
  return onSnapshot(
    doc(rooms, roomId),
    (snapshot) => onRoom(snapshot.exists() ? (snapshot.data() as Room) : null),
    (error) => onError(error.message),
  )
}

export async function startRoom(roomId: string, userId: string) {
  const ref = doc(rooms, roomId)
  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(ref)
    const room = snapshot.data() as Room
    if (room.hostId !== userId) throw new Error('Only the host can start.')
    if (room.status !== 'lobby') throw new Error('The game has already started.')
    if (room.players.length < 2) throw new Error('At least two players are required.')
    room.game = createGame(room.players)
    room.status = 'playing'
    room.updatedAt = Date.now()
    transaction.set(ref, room)
  })
}

export async function rollDice(roomId: string, userId: string) {
  const ref = doc(rooms, roomId)
  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(ref)
    const room = structuredClone(snapshot.data()) as Room
    if (room.players[room.game?.turnIndex ?? -1]?.id !== userId) {
      throw new Error('It is not your turn.')
    }
    const game = room.game!
    const player = room.players[game.turnIndex]
    game.entryMisses ??= {}
    const misses = game.entryMisses[player.id] ?? 0
    const hasActive = hasActiveToken(game, player.id, room.players)
    const randomDice = crypto.getRandomValues(new Uint8Array(1))[0] % 6 + 1
    const dice = !hasActive && misses >= 5 ? 6 : randomDice
    game.entryMisses[player.id] =
      hasActive || dice === 6 ? 0 : misses + 1
    applyRoll(room, dice)
    room.updatedAt = Date.now()
    transaction.set(ref, room)
  })
}

export async function moveToken(
  roomId: string,
  userId: string,
  tokenId: number,
) {
  const ref = doc(rooms, roomId)
  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(ref)
    const room = structuredClone(snapshot.data()) as Room
    if (room.players[room.game?.turnIndex ?? -1]?.id !== userId) {
      throw new Error('It is not your turn.')
    }
    applyMove(room, tokenId)
    room.updatedAt = Date.now()
    transaction.set(ref, room)
  })
}
