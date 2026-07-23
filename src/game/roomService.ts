import {
  collection,
  doc,
  getDocs,
  limit,
  onSnapshot,
  query,
  runTransaction,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "../firebase";
import {
  applyMove,
  applyRoll,
  applyRollMisses,
  createGame,
  validateDiceRoll,
} from "./engine";
import { PLAYER_COLORS, type Room } from "./types";

const rooms = collection(db, "rooms");

const roomCode = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(6)))
    .map((value) => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[value % 32])
    .join("");

const cleanName = (name: string) => name.trim().slice(0, 18) || "Player";

export async function createRoom(
  userId: string,
  name: string,
  maxPlayers: number,
  gameMode: Room["gameMode"] = "classic",
) {
  if (maxPlayers < 2 || maxPlayers > 8) {
    throw new Error("Room size must be between 2 and 8 players.");
  }
  const ref = doc(rooms);
  const now = Date.now();
  const room: Room = {
    id: ref.id,
    code: roomCode(),
    hostId: userId,
    memberIds: [userId],
    maxPlayers,
    gameMode,
    status: "lobby",
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
    departedPlayers: [],
    game: null,
    createdAt: now,
    updatedAt: now,
  };
  await setDoc(ref, room);
  return room.id;
}

export async function joinRoom(userId: string, name: string, code: string) {
  const result = await getDocs(
    query(rooms, where("code", "==", code.trim().toUpperCase()), limit(1)),
  );
  if (result.empty) throw new Error("Room not found. Check the room code.");
  const ref = result.docs[0].ref;

  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(ref);
    const room = snapshot.data() as Room;
    const returning = room.players.find((player) => player.id === userId);
    if (returning) {
      returning.connected = true;
      returning.name = cleanName(name);
    } else {
      if (room.status !== "lobby")
        throw new Error("This game has already started.");
      if (room.players.length >= room.maxPlayers)
        throw new Error("This room is full.");
      const seat = room.players.length;
      room.players.push({
        id: userId,
        name: cleanName(name),
        color: PLAYER_COLORS[seat],
        seat,
        connected: true,
        joinedAt: Date.now(),
      });
      room.memberIds.push(userId);
    }
    room.updatedAt = Date.now();
    transaction.set(ref, room);
  });
  return ref.id;
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
  );
}

export async function startRoom(roomId: string, userId: string) {
  const ref = doc(rooms, roomId);
  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(ref);
    const room = snapshot.data() as Room;
    if (room.hostId !== userId) throw new Error("Only the host can start.");
    if (room.status !== "lobby")
      throw new Error("The game has already started.");
    if (room.players.length < 2)
      throw new Error("At least two players are required.");
    room.game = createGame(room.players, room.gameMode ?? "classic");
    room.status = "playing";
    room.updatedAt = Date.now();
    transaction.set(ref, room);
  });
}

export async function rollDice(
  roomId: string,
  userId: string,
  dice: number,
) {
  const ref = doc(rooms, roomId);
  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(ref);
    const room = structuredClone(snapshot.data()) as Room;
    if (room.players[room.game?.turnIndex ?? -1]?.id !== userId) {
      throw new Error("It is not your turn.");
    }
    const game = room.game!;
    if (game.phase !== "roll") throw new Error("Dice cannot be rolled now.");
    const player = room.players[game.turnIndex];
    validateDiceRoll(game, player.id, room.players, dice);
    applyRollMisses(game, player.id, room.players, dice);
    applyRoll(room, dice);
    room.updatedAt = Date.now();
    transaction.set(ref, room);
  });
}

export async function startMove(
  roomId: string,
  userId: string,
  tokenId: number,
  fromProgress: number,
  dice: number,
  startedAt = Date.now(),
  targetProgress?: number,
) {
  const ref = doc(rooms, roomId);
  await updateDoc(ref, {
    "game.activeMove": {
      playerId: userId,
      tokenId,
      fromProgress,
      dice,
      startedAt,
      ...(targetProgress !== undefined ? { targetProgress } : {}),
    },
    updatedAt: startedAt,
  });
  return startedAt;
}

export async function moveTokenWithRetry(
  roomId: string,
  userId: string,
  tokenId: number,
  waitForRoll?: () => Promise<void>,
) {
  try {
    await moveToken(roomId, userId, tokenId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (
      waitForRoll &&
      (message.includes("cannot be moved") ||
        message.includes("cannot be rolled") ||
        message.includes("not your turn"))
    ) {
      await waitForRoll();
      await moveToken(roomId, userId, tokenId);
      return;
    }
    throw error;
  }
}

export async function moveToken(
  roomId: string,
  userId: string,
  tokenId: number,
) {
  const ref = doc(rooms, roomId);
  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(ref);
    const room = structuredClone(snapshot.data()) as Room;
    if (room.players[room.game?.turnIndex ?? -1]?.id !== userId) {
      throw new Error("It is not your turn.");
    }
    applyMove(room, tokenId);
    room.updatedAt = Date.now();
    transaction.set(ref, room);
  });
}

export async function leaveRoom(roomId: string, userId: string) {
  const ref = doc(rooms, roomId);
  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists()) return;
    const room = structuredClone(snapshot.data()) as Room;
    const leavingIndex = room.players.findIndex(
      (player) => player.id === userId,
    );
    if (leavingIndex === -1) return;
    const leavingPlayer = room.players[leavingIndex];

    if (room.game) {
      room.departedPlayers ??= [];
      if (!room.departedPlayers.some((player) => player.id === userId)) {
        room.departedPlayers.push({
          ...leavingPlayer,
          connected: false,
          leftAt: Date.now(),
        });
      }
    }

    room.players.splice(leavingIndex, 1);
    room.memberIds = (room.memberIds ?? []).filter((id) => id !== userId);

    if (room.players.length === 0) {
      transaction.delete(ref);
      return;
    }

    if (room.hostId === userId) {
      room.hostId = room.players[0].id;
    }

    if (room.game) {
      const game = room.game;
      game.tokens = game.tokens.filter((token) => token.playerId !== userId);
      game.winnerIds = game.winnerIds.filter((id) => id !== userId);
      delete game.entryMisses?.[userId];
      delete game.finishMisses?.[userId];
      delete game.protectionForfeited?.[userId];

      if (leavingIndex < game.turnIndex) {
        game.turnIndex -= 1;
      } else if (leavingIndex === game.turnIndex) {
        game.turnIndex = leavingIndex % room.players.length;
      }

      for (let offset = 0; offset < room.players.length; offset += 1) {
        const index = (game.turnIndex + offset) % room.players.length;
        if (!game.winnerIds.includes(room.players[index].id)) {
          game.turnIndex = index;
          break;
        }
      }

      game.phase = "roll";
      game.dice = null;
      game.consecutiveSixes = 0;
      game.activeMove = null;
      game.lastAction = `${leavingPlayer.name} left the game`;

      if (
        room.players.length === 1 ||
        game.winnerIds.length >= room.players.length - 1
      ) {
        const remaining = room.players.find(
          (player) => !game.winnerIds.includes(player.id),
        );
        if (remaining) game.winnerIds.push(remaining.id);
        room.status = "finished";
      }
    }

    room.updatedAt = Date.now();
    transaction.set(ref, room);
  });
}
