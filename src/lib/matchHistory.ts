import {
  collection,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
} from 'firebase/firestore'
import { signInAnonymously } from 'firebase/auth'
import { auth, db, isFirebaseConfigured } from '../firebase'
import {
  countLoginPlayersInMatch,
  fetchCareerBoard,
  formatCareerFinishTime,
  isCareerEligibleMatch,
  sortCareerBoard,
  sortCareerBoardAscending,
  type CareerBoardEntry,
  type CareerStatKey,
} from './profileCloud'
import { isCareerAccountId } from './profile'
import type { GameMode, Room } from '../game/types'
import { gameModeLabel } from '../game/types'
import { computeMotm, computeWorstPlayer } from '../game/matchAwards'
import { isTeamMode } from '../game/teams'

export type HistoryPerson = {
  accountId: string
  name: string
  color: string
  value?: number
}

export type MatchHistoryMostLeaders = Partial<
  Record<CareerStatKey, HistoryPerson | null>
>

export type MatchHistoryEntry = {
  roomId: string
  code: string
  gameMode: GameMode
  gameModeLabel: string
  finishedAt: number
  hostId: string
  hostName: string
  loginPlayerCount: number
  ranking: Array<{
    accountId: string
    name: string
    color: string
    place: number
  }>
  winner: HistoryPerson | null
  motm: HistoryPerson | null
  worst: HistoryPerson | null
  /** Career “most …” leaders after this match’s stats were applied. */
  mostLeaders: MatchHistoryMostLeaders
}

export const MOST_HISTORY_LABELS: Record<CareerStatKey, string> = {
  wins: 'Most wins',
  motm: 'Most MotM',
  worst: 'Most worst awards',
  second: 'Most 2nd places',
  third: 'Most 3rd places',
  eliminations: 'Most eliminations',
  timesEliminated: 'Most times eliminated',
  sixes: 'Most sixes',
  matchesPlayed: 'Most matches played',
  motmPoints: 'Most MotM points',
  negativePowers: 'Most Oonjaal',
  superPowers: 'Most Super ⚡',
  plus3: 'Most +3',
  bestFinishMs: 'Fastest finish',
}

const HISTORY_LIMIT = 25

async function ensureAnonymousAuth() {
  if (!isFirebaseConfigured || !auth) return false
  if (auth.currentUser) return true
  await signInAnonymously(auth)
  return Boolean(auth.currentUser)
}

function personFromEntry(
  entry: CareerBoardEntry | null | undefined,
  value?: number,
): HistoryPerson | null {
  if (!entry) return null
  return {
    accountId: entry.accountId,
    name: entry.name,
    color: entry.color || '#64748b',
    ...(typeof value === 'number' ? { value } : {}),
  }
}

/** Top career leader for each “most” board after the match updates. */
export function buildMostLeaders(
  board: CareerBoardEntry[],
): MatchHistoryMostLeaders {
  const leaders: MatchHistoryMostLeaders = {}
  for (const key of Object.keys(MOST_HISTORY_LABELS) as CareerStatKey[]) {
    const ranked =
      key === 'bestFinishMs'
        ? sortCareerBoardAscending(board, key)
        : sortCareerBoard(board, key)
    const top = ranked[0]
    const value = top?.[key] ?? 0
    if (!top || value <= 0) {
      leaders[key] = null
      continue
    }
    leaders[key] = personFromEntry(top, value)
  }
  return leaders
}

export function formatMostLeaderValue(key: CareerStatKey, value: number) {
  if (key === 'bestFinishMs') return formatCareerFinishTime(value)
  if (key === 'motmPoints') {
    return Number.isInteger(value) ? `${value} pts` : `${value.toFixed(1)} pts`
  }
  if (
    key === 'wins' ||
    key === 'motm' ||
    key === 'worst' ||
    key === 'second' ||
    key === 'third' ||
    key === 'matchesPlayed'
  ) {
    return `${value}×`
  }
  return `${value}`
}

/**
 * Idempotent: one history doc per room. Call after career stats are recorded
 * so mostLeaders reflect the updated career boards.
 */
export async function recordMatchHistory(
  room: Room,
  careerBoard: CareerBoardEntry[],
): Promise<boolean> {
  if (!isFirebaseConfigured || !db) return false
  if (!isCareerEligibleMatch(room) || !room.game) return false

  try {
    await ensureAnonymousAuth()
    const eventRef = doc(db, 'matchHistory', room.id)

    const pool = [
      ...room.players.filter((player) => !player.isBot),
      ...(room.departedPlayers ?? []).filter((player) => !player.isBot),
    ]
    const loginPool = pool.filter((player) => isCareerAccountId(player.id))
    const host =
      room.players.find((player) => player.id === room.hostId) ??
      (room.departedPlayers ?? []).find((player) => player.id === room.hostId)

    const ranking = room.game.winnerIds
      .map((id, index) => {
        const player = pool.find((entry) => entry.id === id)
        if (!player || !isCareerAccountId(player.id)) return null
        return {
          accountId: player.id,
          name: player.name,
          color: player.color,
          place: index + 1,
        }
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry != null)

    const winnerPlayer =
      !isTeamMode(room.gameMode) && room.game.winnerIds[0]
        ? pool.find((player) => player.id === room.game!.winnerIds[0])
        : null
    const motm = computeMotm(room, pool)
    const worst = computeWorstPlayer(room, loginPool.length ? loginPool : pool)

    const entry: Omit<MatchHistoryEntry, 'finishedAt'> & {
      finishedAt: number
      recordedAt: ReturnType<typeof serverTimestamp>
    } = {
      roomId: room.id,
      code: room.code,
      gameMode: room.gameMode,
      gameModeLabel: gameModeLabel(room.gameMode),
      finishedAt: Date.now(),
      hostId: room.hostId,
      hostName: host?.name ?? 'Host',
      loginPlayerCount: countLoginPlayersInMatch(room),
      ranking,
      winner:
        winnerPlayer && isCareerAccountId(winnerPlayer.id)
          ? {
              accountId: winnerPlayer.id,
              name: winnerPlayer.name,
              color: winnerPlayer.color,
            }
          : null,
      motm: motm
        ? {
            accountId: motm.player.id,
            name: motm.player.name,
            color: motm.player.color,
            value: motm.score,
          }
        : null,
      worst: worst
        ? {
            accountId: worst.player.id,
            name: worst.player.name,
            color: worst.player.color,
            value: worst.score,
          }
        : null,
      mostLeaders: buildMostLeaders(careerBoard),
      recordedAt: serverTimestamp(),
    }

    await runTransaction(db, async (tx) => {
      const snap = await tx.get(eventRef)
      if (snap.exists()) return
      tx.set(eventRef, entry)
    })
    return true
  } catch (error) {
    console.warn('Failed to record match history', error)
    return false
  }
}

/** Latest eligible match histories (newest first). */
export async function fetchMatchHistory(
  max = HISTORY_LIMIT,
): Promise<MatchHistoryEntry[]> {
  if (!isFirebaseConfigured || !db) return []
  try {
    await ensureAnonymousAuth()
    const snap = await getDocs(
      query(
        collection(db, 'matchHistory'),
        orderBy('finishedAt', 'desc'),
        limit(max),
      ),
    )
    return snap.docs.map((entry) => {
      const data = entry.data() as Partial<MatchHistoryEntry>
      return {
        roomId: data.roomId ?? entry.id,
        code: String(data.code ?? ''),
        gameMode: (data.gameMode ?? 'classic') as GameMode,
        gameModeLabel: data.gameModeLabel ?? String(data.gameMode ?? 'classic'),
        finishedAt: typeof data.finishedAt === 'number' ? data.finishedAt : 0,
        hostId: String(data.hostId ?? ''),
        hostName: String(data.hostName ?? 'Host'),
        loginPlayerCount:
          typeof data.loginPlayerCount === 'number' ? data.loginPlayerCount : 0,
        ranking: Array.isArray(data.ranking) ? data.ranking : [],
        winner: data.winner ?? null,
        motm: data.motm ?? null,
        worst: data.worst ?? null,
        mostLeaders: (data.mostLeaders ?? {}) as MatchHistoryMostLeaders,
      }
    })
  } catch (error) {
    console.warn('Failed to load match history', error)
    return []
  }
}

/** After career writes settle, refresh board and store history once. */
export async function finalizeEligibleMatchHistory(room: Room) {
  if (!isCareerEligibleMatch(room)) return null
  const board = await fetchCareerBoard()
  await recordMatchHistory(room, board)
  return board
}
