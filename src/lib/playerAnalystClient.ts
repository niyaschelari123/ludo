import type { CareerBoardEntry } from './profileCloud'
import type { MatchHistoryEntry } from './matchHistory'
import { fetchMatchHistory } from './matchHistory'
import { getSocketUrl } from '../game/socket'
import {
  sanitizeMatches,
  sanitizePlayers,
  scoreAwards,
  statsVersion,
  type AnalystAward,
  type AnalystMatch,
  type AnalystNarrative,
  type AnalystPlayer,
} from './playerAnalyst'

export type AnalystAnalysis = {
  statsVersion: string
  awards: AnalystAward[]
  narrative: AnalystNarrative | null
  generatedAt: string
  aiStatus: 'ready' | 'unavailable'
}

export function boardToAnalystPlayers(board: CareerBoardEntry[]): AnalystPlayer[] {
  return board
    .filter((entry) => entry.accountId.startsWith('acct:') && entry.accountId !== 'acct:admin')
    .map((entry) => ({
      accountId: entry.accountId,
      name: entry.name,
      matchesPlayed: entry.matchesPlayed ?? 0,
      wins: entry.wins ?? 0,
      motm: entry.motm ?? 0,
      worst: entry.worst ?? 0,
      second: entry.second ?? 0,
      third: entry.third ?? 0,
      eliminations: entry.eliminations ?? 0,
      timesEliminated: entry.timesEliminated ?? 0,
      sixes: entry.sixes ?? 0,
      motmPoints: entry.motmPoints ?? 0,
      negativePowers: entry.negativePowers ?? 0,
      superPowers: entry.superPowers ?? 0,
      plus10: entry.plus10 ?? 0,
      elimPairs: entry.elimPairs ?? {},
    }))
}

export function historyToAnalystMatches(entries: MatchHistoryEntry[]): AnalystMatch[] {
  return entries.map((entry) => ({
    id: entry.roomId,
    finishedAt: entry.finishedAt,
    players: (entry.matchStats.length > 0
      ? entry.matchStats
      : entry.ranking.map((row) => ({
          accountId: row.accountId,
          place: row.place,
          motmPoints: 0,
          captures: 0,
        }))
    ).map((row) => ({
      accountId: row.accountId,
      place: row.place,
      motmPoints: row.motmPoints ?? 0,
      captures: 'captures' in row ? row.captures : 0,
    })),
  }))
}

export function prepareAnalyst(players: AnalystPlayer[], matches: AnalystMatch[]) {
  const cleanPlayers = sanitizePlayers(players)
  const cleanMatches = sanitizeMatches(matches)
  return {
    players: cleanPlayers,
    matches: cleanMatches,
    version: statsVersion(cleanPlayers, cleanMatches),
  }
}

export async function requestPlayerAnalyst(
  players: AnalystPlayer[],
  matches: AnalystMatch[],
  options?: { force?: boolean; adminPin?: string },
): Promise<AnalystAnalysis | null> {
  const prepared = prepareAnalyst(players, matches)
  const { version } = prepared
  players = prepared.players
  matches = prepared.matches
  const base = getSocketUrl()
  if (!options?.force) {
    try {
      const cached = await fetch(
        `${base}/api/player-analyst?version=${encodeURIComponent(version)}`,
      )
      if (cached.status === 200) {
        const body = (await cached.json()) as { analysis?: AnalystAnalysis }
        if (body.analysis?.statsVersion === version) return body.analysis
      }
    } catch {
      return null
    }
  }
  try {
    const response = await fetch(`${base}/api/player-analyst`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(options?.adminPin ? { 'x-admin-pin': options.adminPin } : {}),
      },
      body: JSON.stringify({
        players,
        matches,
        ...(options?.force ? { force: true } : {}),
      }),
    })
    if (!response.ok) return null
    const body = (await response.json()) as { analysis?: AnalystAnalysis }
    if (body.analysis?.statsVersion !== version) return null
    return body.analysis
  } catch {
    return null
  }
}

/** After a career update, refresh commentary once if the stats hash changed. */
export async function refreshPlayerAnalyst(board: CareerBoardEntry[]) {
  const players = boardToAnalystPlayers(board)
  const history = await fetchMatchHistory().catch(() => [])
  await requestPlayerAnalyst(players, historyToAnalystMatches(history))
}

export function localAwards(board: CareerBoardEntry[], matches: AnalystMatch[]) {
  return scoreAwards(boardToAnalystPlayers(board), matches)
}
