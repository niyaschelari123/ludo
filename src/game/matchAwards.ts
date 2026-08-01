import { finishedProgress } from './engine'
import type { Player, PlayerStats, Room } from './types'

export type MotmBreakdown = {
  eliminations: number
  placeBonus: number
  tokensHome: number
  sixes: number
  timesEliminated: number
  total: number
}

export type MotmCandidate = {
  player: Player
  score: number
  place: number
  stats: PlayerStats
  reason: string
  breakdown: MotmBreakdown
}

export type WinOddsEntry = {
  player: Player
  percent: number
  strength: number
}

function emptyStats(): PlayerStats {
  return {
    captures: 0,
    eliminated: 0,
    tokensHome: 0,
    sixes: 0,
    eliminatedPlayers: {},
  }
}

export function readPlayerStats(
  room: Room,
  playerId: string,
): PlayerStats {
  const stats = room.game?.stats?.[playerId] ?? emptyStats()
  return {
    ...emptyStats(),
    ...stats,
    eliminatedPlayers: stats.eliminatedPlayers ?? {},
  }
}

/** Same scoring used for live MOTM and the end-screen award. */
export function motmBreakdown(
  stats: PlayerStats,
  placeIndex: number,
): MotmBreakdown {
  const eliminations = stats.captures * 3
  const placeBonus =
    placeIndex === 0 ? 5 : placeIndex === 1 ? 3 : placeIndex === 2 ? 1 : 0
  const tokensHome = stats.tokensHome * 2
  const sixes = stats.sixes * 0.5
  const timesEliminated = stats.eliminated
  return {
    eliminations,
    placeBonus,
    tokensHome,
    sixes,
    timesEliminated,
    total: eliminations + placeBonus + tokensHome + sixes - timesEliminated,
  }
}

export function scoreMotm(stats: PlayerStats, placeIndex: number): number {
  return motmBreakdown(stats, placeIndex).total
}

export function motmReason(
  stats: PlayerStats,
  placeIndex: number,
): string {
  if (stats.captures > 0) {
    const placeBit =
      placeIndex === 0
        ? ' · Champion'
        : placeIndex < 3
          ? ` · ${placeIndex + 1}${placeIndex === 1 ? 'nd' : placeIndex === 2 ? 'rd' : 'th'} place`
          : ''
    return `${stats.captures} elimination${stats.captures === 1 ? '' : 's'}${placeBit}`
  }
  if (placeIndex === 0) return 'Champion of the board'
  return `${stats.tokensHome} token${stats.tokensHome === 1 ? '' : 's'} home`
}

function scoreCandidates(room: Room, players: Player[]): MotmCandidate[] {
  if (!room.game || players.length === 0) return []

  const ranked = [...players].sort((first, second) => {
    const firstPlace = room.game!.winnerIds.indexOf(first.id)
    const secondPlace = room.game!.winnerIds.indexOf(second.id)
    return (
      (firstPlace === -1 ? Number.MAX_SAFE_INTEGER : firstPlace) -
      (secondPlace === -1 ? Number.MAX_SAFE_INTEGER : secondPlace)
    )
  })

  return ranked.map((player, index) => {
    const stats = readPlayerStats(room, player.id)
    const breakdown = motmBreakdown(stats, index)
    return {
      player,
      stats,
      place: index + 1,
      score: breakdown.total,
      reason: motmReason(stats, index),
      breakdown,
    }
  })
}

export function computeMotm(
  room: Room,
  players: Player[],
): MotmCandidate | null {
  return (
    scoreCandidates(room, players).sort(
      (first, second) =>
        second.score - first.score ||
        first.place - second.place ||
        second.stats.captures - first.stats.captures,
    )[0] ?? null
  )
}

/** Lowest MOTM score — the weakest overall performance. */
export function computeWorstPlayer(
  room: Room,
  players: Player[],
): MotmCandidate | null {
  return (
    scoreCandidates(room, players).sort(
      (first, second) =>
        first.score - second.score ||
        second.place - first.place ||
        first.stats.captures - second.stats.captures ||
        second.stats.eliminated - first.stats.eliminated,
    )[0] ?? null
  )
}

/**
 * Live win odds from race position — display only, does not affect gameplay.
 *
 * Uses weighted progress of each player's best tokens (home tokens count fully,
 * yard tokens count as 0) plus small capture/six bonuses, then softmax so
 * leaders pull ahead clearly instead of staying near-equal.
 */
export function computeWinOdds(room: Room): WinOddsEntry[] {
  const game = room.game
  if (!game || room.players.length === 0) return []

  const finish = finishedProgress(room)
  const championId = game.winnerIds[0]

  if (championId) {
    return [...room.players]
      .map((player) => ({
        player,
        strength: player.id === championId ? 1 : 0,
        percent: player.id === championId ? 100 : 0,
      }))
      .sort((first, second) => second.percent - first.percent)
  }

  const TOKEN_WEIGHTS = [5, 3, 2, 1]

  const scored = room.players.map((player) => {
    const tokens = game.tokens.filter((token) => token.playerId === player.id)
    const progresses = tokens
      .map((token) => {
        if (token.progress >= finish) return finish
        if (token.progress < 0) return 0
        return token.progress
      })
      .sort((first, second) => second - first)

    // Small base so players still in yard keep a floor of odds.
    let score = finish * 0.2
    progresses.forEach((progress, index) => {
      score += progress * (TOKEN_WEIGHTS[index] ?? 1)
    })

    const homeCount = progresses.filter((progress) => progress >= finish).length
    score += homeCount * finish * 0.5

    const stats = readPlayerStats(room, player.id)
    score += stats.captures * 3
    score += stats.sixes * 0.5

    return { player, score }
  })

  // Higher temperature keeps mid-game odds readable (not 100% / 0%).
  const temperature = Math.max(60, finish * 1.15)
  const maxScore = Math.max(...scored.map((entry) => entry.score))
  const strengths = scored.map((entry) => ({
    player: entry.player,
    strength: Math.exp((entry.score - maxScore) / temperature),
  }))

  const total = strengths.reduce((sum, entry) => sum + entry.strength, 0)
  if (total <= 0) {
    const even = Math.round(1000 / strengths.length) / 10
    return strengths
      .map((entry) => ({ ...entry, percent: even }))
      .sort((first, second) => first.player.name.localeCompare(second.player.name))
  }

  const raw = strengths.map((entry) => ({
    ...entry,
    percent: (entry.strength / total) * 100,
  }))

  const rounded = raw.map((entry) => ({
    ...entry,
    percent: Math.round(entry.percent * 10) / 10,
  }))
  rounded.sort((first, second) => second.percent - first.percent)

  const drift =
    Math.round((100 - rounded.reduce((sum, entry) => sum + entry.percent, 0)) * 10) /
    10
  if (rounded[0]) {
    rounded[0].percent = Math.round((rounded[0].percent + drift) * 10) / 10
  }

  return rounded
}
