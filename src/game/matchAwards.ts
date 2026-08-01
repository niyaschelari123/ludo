import { finishedProgress } from './engine'
import type { Player, PlayerStats, Room } from './types'
import { isBlitzMode } from './types'

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

/** Same scoring used for live MOTM and the end-screen award.
 *  `placeIndex` is 0-based finish place, or `null` if the player has not finished yet
 *  (no free place bonus mid-match).
 */
export function motmBreakdown(
  stats: PlayerStats,
  placeIndex: number | null,
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

export function scoreMotm(stats: PlayerStats, placeIndex: number | null): number {
  return motmBreakdown(stats, placeIndex).total
}

export function motmReason(
  stats: PlayerStats,
  placeIndex: number | null,
): string {
  if (stats.captures > 0) {
    const placeBit =
      placeIndex === 0
        ? ' · Champion'
        : placeIndex !== null && placeIndex < 3
          ? ` · ${placeIndex + 1}${placeIndex === 1 ? 'nd' : placeIndex === 2 ? 'rd' : 'th'} place`
          : ''
    return `${stats.captures} elimination${stats.captures === 1 ? '' : 's'}${placeBit}`
  }
  if (placeIndex === 0) return 'Champion of the board'
  if (stats.tokensHome > 0) {
    return `${stats.tokensHome} token${stats.tokensHome === 1 ? '' : 's'} home`
  }
  if (stats.sixes > 0) {
    return `${stats.sixes} six${stats.sixes === 1 ? '' : 'es'}`
  }
  return 'No MotM points yet'
}

function scoreCandidates(room: Room, players: Player[]): MotmCandidate[] {
  if (!room.game || players.length === 0) return []

  return players.map((player) => {
    const finishIndex = room.game!.winnerIds.indexOf(player.id)
    const placeIndex = finishIndex === -1 ? null : finishIndex
    const stats = readPlayerStats(room, player.id)
    const breakdown = motmBreakdown(stats, placeIndex)
    return {
      player,
      stats,
      place: finishIndex === -1 ? Number.MAX_SAFE_INTEGER : finishIndex + 1,
      score: breakdown.total,
      reason: motmReason(stats, placeIndex),
      breakdown,
    }
  })
}

export function computeMotmStandings(
  room: Room,
  players: Player[],
): MotmCandidate[] {
  return scoreCandidates(room, players).sort(
    (first, second) =>
      second.score - first.score ||
      first.place - second.place ||
      second.stats.captures - first.stats.captures,
  )
}

export function computeMotm(
  room: Room,
  players: Player[],
): MotmCandidate | null {
  return computeMotmStandings(room, players)[0] ?? null
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

/** Blitz scoring rules shown in the rules panel. */
export const BLITZ_SCORE_RULES: { label: string; detail: string }[] = [
  { label: '+15', detail: 'each token finished (home)' },
  { label: '+5', detail: 'each elimination you make' },
  { label: '−3', detail: 'each time one of your tokens is eliminated' },
  { label: '+1', detail: 'each six you roll' },
  { label: '+0–8', detail: 'per unfinished token based on how far it has raced (progress)' },
  { label: '+12', detail: 'bonus if all 4 of your tokens are home before time runs out' },
  { label: '+4', detail: 'bonus if you have the single farthest token on the board at the buzzer' },
]

export type BlitzBreakdown = {
  tokensHome: number
  eliminations: number
  eliminatedPenalty: number
  sixes: number
  boardProgress: number
  allHomeBonus: number
  leadTokenBonus: number
  total: number
}

export type BlitzScoreEntry = {
  player: Player
  breakdown: BlitzBreakdown
  stats: PlayerStats
}

export function blitzBreakdown(room: Room, playerId: string): BlitzBreakdown {
  const game = room.game
  const stats = readPlayerStats(room, playerId)
  const finish = game ? finishedProgress(room) : 1
  const tokens = game?.tokens.filter((token) => token.playerId === playerId) ?? []

  let boardProgress = 0
  let homeCount = 0
  for (const token of tokens) {
    if (token.progress >= finish) {
      homeCount += 1
      continue
    }
    if (token.progress < 0) continue
    boardProgress += Math.floor((token.progress / finish) * 8)
  }

  const tokensHomePts = stats.tokensHome * 15
  const eliminations = stats.captures * 5
  const eliminatedPenalty = stats.eliminated * 3
  const sixes = stats.sixes
  const allHomeBonus = homeCount === tokens.length && tokens.length > 0 ? 12 : 0

  return {
    tokensHome: tokensHomePts,
    eliminations,
    eliminatedPenalty,
    sixes,
    boardProgress,
    allHomeBonus,
    leadTokenBonus: 0,
    total:
      tokensHomePts +
      eliminations -
      eliminatedPenalty +
      sixes +
      boardProgress +
      allHomeBonus,
  }
}

export function rankBlitzPlayers(room: Room): BlitzScoreEntry[] {
  if (!room.game) return []

  const finish = finishedProgress(room)
  let bestProgress = -1
  let leadPlayerIds = new Set<string>()
  for (const token of room.game.tokens) {
    if (token.progress < 0 || token.progress >= finish) continue
    if (token.progress > bestProgress) {
      bestProgress = token.progress
      leadPlayerIds = new Set([token.playerId])
    } else if (token.progress === bestProgress) {
      leadPlayerIds.add(token.playerId)
    }
  }

  const entries = room.players.map((player) => {
    const breakdown = blitzBreakdown(room, player.id)
    if (leadPlayerIds.size === 1 && leadPlayerIds.has(player.id) && bestProgress > 0) {
      breakdown.leadTokenBonus = 4
      breakdown.total += 4
    }
    return {
      player,
      breakdown,
      stats: readPlayerStats(room, player.id),
    }
  })

  entries.sort(
    (first, second) =>
      second.breakdown.total - first.breakdown.total ||
      second.stats.tokensHome - first.stats.tokensHome ||
      second.stats.captures - first.stats.captures ||
      first.player.name.localeCompare(second.player.name),
  )
  return entries
}

/** End a Blitz match by points and lock final standings. */
export function finalizeBlitzGame(room: Room) {
  const game = room.game
  if (!game || !isBlitzMode(room.gameMode)) return room
  if (room.status === 'finished') return room

  const ranking = rankBlitzPlayers(room)
  game.winnerIds = ranking.map((entry) => entry.player.id)
  game.phase = 'roll'
  game.dice = null
  game.turnDeadline = null
  game.pendingPower = null
  game.activeMove = null
  game.endsAt = game.endsAt ?? Date.now()
  room.status = 'finished'
  const lead = ranking[0]
  game.lastAction = lead
    ? `Time's up! ${lead.player.name} wins with ${lead.breakdown.total} pts`
    : `Time's up!`
  room.updatedAt = Date.now()
  return room
}
