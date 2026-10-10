/**
 * Deterministic Most-stats awards. AI may explain these results; it does not pick winners.
 *
 * Rate awards only include players whose match count sits with the main group.
 * A short career (far below the others) cannot win on a hot per-match rate.
 * Totals are shown beside rates.
 *
 * Most improved compares each player's older match half with their newer half
 * (at least MIN_SPLIT matches in each half). Match score = place points + MotM points + eliminations.
 */
export const MIN_MATCHES = 3
export const MIN_SPLIT = 3

export const ANALYST_CATEGORIES = [
  'best_overall',
  'best_attacking',
  'best_eliminator',
  'most_dominant',
  'most_consistent',
  'most_improved',
  'most_aggressive',
  'most_underrated',
  'best_podium',
  'sharpest_rivalry',
] as const

export type AnalystCategory = (typeof ANALYST_CATEGORIES)[number]

export type AnalystPlayer = {
  accountId: string
  name: string
  matchesPlayed: number
  wins: number
  motm: number
  worst: number
  second: number
  third: number
  eliminations: number
  timesEliminated: number
  sixes: number
  motmPoints: number
  negativePowers: number
  superPowers: number
  plus10: number
  /** victimAccountId → times this player eliminated them. */
  elimPairs: Record<string, number>
}

export type AnalystMatchPlayer = {
  accountId: string
  place: number | null
  motmPoints: number
  captures: number
}

export type AnalystMatch = {
  id: string
  finishedAt: number
  players: AnalystMatchPlayer[]
}

export type AnalystStat = { label: string; value: string }

export type AnalystAward = {
  category: AnalystCategory
  title: string
  icon: string
  /** Plain explanation of the award. */
  meaning: string
  status: 'winner' | 'insufficient'
  playerId: string | null
  playerName: string | null
  score: number | null
  tied: boolean
  runnerUpId: string | null
  runnerUpName: string | null
  runnerUpScore: number | null
  keyStats: AnalystStat[]
  /** Factual line from the formula. Not an AI sentence. */
  evidence: string
}

export function categoryMeaning(category: AnalystCategory) {
  return CATEGORY_META[category].meaning
}

const CATEGORY_META: Record<AnalystCategory, { title: string; icon: string; meaning: string }> = {
  best_overall: {
    title: 'Best Overall Player',
    icon: '🏆',
    meaning: 'Highest Ultimate score per match. Ultimate is MotM × 40 + wins × 50 − Worst × 10.',
  },
  best_attacking: {
    title: 'Best Attacking Player',
    icon: '⚡',
    meaning: 'Most eliminations, sixes, Super powers, and +10 moves per match.',
  },
  best_eliminator: {
    title: 'Best Eliminator',
    icon: '🎯',
    meaning: 'Knocks out the most tokens per match.',
  },
  most_dominant: {
    title: 'Most Dominant Player',
    icon: '👑',
    meaning: 'Wins and MotM awards most often per match.',
  },
  most_consistent: {
    title: 'Most Consistent Player',
    icon: '🛡️',
    meaning: 'Keeps a high MotM-point average and rarely takes the Worst award.',
  },
  most_improved: {
    title: 'Most Improved Player',
    icon: '🔥',
    meaning: 'Recent matches score higher than the earlier half of their saved history.',
  },
  most_aggressive: {
    title: 'Most Aggressive Player',
    icon: '💥',
    meaning: 'Uses the most sixes, Super powers, and Oonjaal per match.',
  },
  most_underrated: {
    title: 'Most Underrated Player',
    icon: '🧠',
    meaning: 'Strong eliminations, MotM points, and sixes, with fewer wins and MotM awards.',
  },
  best_podium: {
    title: 'Best Podium Rate',
    icon: '🥉',
    meaning: 'Finishes 1st, 2nd, or 3rd most often per match.',
  },
  sharpest_rivalry: {
    title: 'Sharpest Rivalry',
    icon: '⚔️',
    meaning: 'Knocks out the same opponent the most times.',
  },
}

function num(value: number) {
  return Number.isFinite(value) ? Math.max(0, value) : 0
}

function round(value: number) {
  return Math.round(value * 100) / 100
}

function rate(total: number, matches: number) {
  if (matches <= 0) return 0
  return total / matches
}

export function ultimatePoints(player: AnalystPlayer) {
  return player.motm * 40 + player.wins * 50 - player.worst * 10
}

function placePoints(place: number | null) {
  if (place === 1) return 5
  if (place === 2) return 3
  if (place === 3) return 1
  return 0
}

export function matchPerformance(row: AnalystMatchPlayer) {
  return placePoints(row.place) + num(row.motmPoints) + num(row.captures)
}

export function sanitizePlayers(raw: unknown): AnalystPlayer[] {
  if (!Array.isArray(raw)) return []
  const out: AnalystPlayer[] = []
  for (const item of raw.slice(0, 12)) {
    if (!item || typeof item !== 'object') continue
    const row = item as Partial<AnalystPlayer>
    if (typeof row.accountId !== 'string' || !row.accountId.startsWith('acct:')) continue
    if (row.accountId === 'acct:admin') continue
    const name =
      typeof row.name === 'string' && row.name.trim()
        ? row.name.trim().slice(0, 18)
        : row.accountId.replace(/^acct:/, '')
    out.push({
      accountId: row.accountId,
      name,
      matchesPlayed: num(Number(row.matchesPlayed)),
      wins: num(Number(row.wins)),
      motm: num(Number(row.motm)),
      worst: num(Number(row.worst)),
      second: num(Number(row.second)),
      third: num(Number(row.third)),
      eliminations: num(Number(row.eliminations)),
      timesEliminated: num(Number(row.timesEliminated)),
      sixes: num(Number(row.sixes)),
      motmPoints: num(Number(row.motmPoints)),
      negativePowers: num(Number(row.negativePowers)),
      superPowers: num(Number(row.superPowers)),
      plus10: num(Number(row.plus10)),
      elimPairs: sanitizePairs(row.elimPairs),
    })
  }
  return out.sort((a, b) => a.accountId.localeCompare(b.accountId))
}

function sanitizePairs(raw: unknown) {
  const pairs: Record<string, number> = {}
  if (!raw || typeof raw !== 'object') return pairs
  for (const [victimId, count] of Object.entries(raw)) {
    if (!victimId.startsWith('acct:') || victimId === 'acct:admin') continue
    const value = num(Number(count))
    if (value <= 0) continue
    pairs[victimId] = Math.floor(value)
  }
  return pairs
}

export function sanitizeMatches(raw: unknown): AnalystMatch[] {
  if (!Array.isArray(raw)) return []
  const out: AnalystMatch[] = []
  for (const item of raw.slice(0, 25)) {
    if (!item || typeof item !== 'object') continue
    const row = item as Partial<AnalystMatch>
    if (typeof row.id !== 'string' || !row.id) continue
    const players: AnalystMatchPlayer[] = []
    if (Array.isArray(row.players)) {
      for (const player of row.players.slice(0, 8)) {
        if (!player || typeof player !== 'object') continue
        const entry = player as Partial<AnalystMatchPlayer>
        if (typeof entry.accountId !== 'string' || !entry.accountId.startsWith('acct:')) {
          continue
        }
        const place = Number(entry.place)
        players.push({
          accountId: entry.accountId,
          place: Number.isFinite(place) && place > 0 ? Math.floor(place) : null,
          motmPoints: num(Number(entry.motmPoints)),
          captures: num(Number(entry.captures)),
        })
      }
    }
    out.push({
      id: row.id.slice(0, 80),
      finishedAt: num(Number(row.finishedAt)),
      players,
    })
  }
  return out.sort((a, b) => a.finishedAt - b.finishedAt || a.id.localeCompare(b.id))
}

const SCORING_VERSION = 3

export function statsVersion(players: AnalystPlayer[], matches: AnalystMatch[]) {
  const payload = JSON.stringify({ scoring: SCORING_VERSION, players, matches })
  let hash = 2166136261
  for (let index = 0; index < payload.length; index += 1) {
    hash ^= payload.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

type Ranked = {
  player: AnalystPlayer
  score: number
  stats: AnalystStat[]
}

/**
 * Lowest match count that still sits with the busier players.
 * Uses the upper half of careers that already have MIN_MATCHES, then 70% of that
 * typical count, so one short career does not drag the bar down.
 */
export function comparableMatchFloor(players: AnalystPlayer[]) {
  const counts = players
    .map((player) => player.matchesPlayed)
    .filter((count) => count >= MIN_MATCHES)
    .sort((a, b) => a - b)
  if (counts.length === 0) return MIN_MATCHES
  const upper = counts.slice(Math.floor(counts.length / 2))
  const typical = upper[Math.floor((upper.length - 1) / 2)] ?? MIN_MATCHES
  return Math.max(MIN_MATCHES, Math.ceil(typical * 0.7))
}

function rankRate(
  players: AnalystPlayer[],
  scoreOf: (player: AnalystPlayer) => number,
  statsOf: (player: AnalystPlayer) => AnalystStat[],
) {
  const floor = comparableMatchFloor(players)
  const pool = players.filter((player) => player.matchesPlayed >= floor)
  const ranked = pool
    .map((player) => ({ player, score: scoreOf(player), stats: statsOf(player) }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.player.matchesPlayed - a.player.matchesPlayed ||
        a.player.name.localeCompare(b.player.name),
    )
  return { pool: pool.length, ranked }
}

function awardFromRank(
  category: AnalystCategory,
  ranked: Ranked[],
  pool: number,
  emptyReason: string,
): AnalystAward {
  const meta = CATEGORY_META[category]
  const base = {
    category,
    title: meta.title,
    icon: meta.icon,
    meaning: meta.meaning,
  }
  if (pool < 1 || ranked.length === 0) {
    return {
      ...base,
      status: 'insufficient',
      playerId: null,
      playerName: null,
      score: null,
      tied: false,
      runnerUpId: null,
      runnerUpName: null,
      runnerUpScore: null,
      keyStats: [],
      evidence: emptyReason,
    }
  }
  const winner = ranked[0]
  const tied = ranked.filter((entry) => Math.abs(entry.score - winner.score) < 1e-9)
  const runner = ranked.find((entry) => entry.player.accountId !== winner.player.accountId)
  const tieNote =
    tied.length > 1
      ? ` Tied on this score with ${tied
          .slice(1)
          .map((entry) => entry.player.name)
          .join(', ')}.`
      : ''
  const runnerNote = runner
    ? ` Runner-up ${runner.player.name} at ${round(runner.score)}.`
    : ''
  return {
    ...base,
    status: 'winner',
    playerId: winner.player.accountId,
    playerName: winner.player.name,
    score: round(winner.score),
    tied: tied.length > 1,
    runnerUpId: runner?.player.accountId ?? null,
    runnerUpName: runner?.player.name ?? null,
    runnerUpScore: runner ? round(runner.score) : null,
    keyStats: winner.stats,
    evidence: `${winner.player.name} leads at ${round(winner.score)}.${runnerNote}${tieNote}`,
  }
}

function perMatchStats(player: AnalystPlayer, extra: AnalystStat[] = []): AnalystStat[] {
  return [
    { label: 'Matches', value: String(player.matchesPlayed) },
    ...extra,
  ]
}

export function scoreAwards(players: AnalystPlayer[], matches: AnalystMatch[]): AnalystAward[] {
  const matchFloor = comparableMatchFloor(players)
  const eligibleNote = `Only players in the same match range are compared (at least ${matchFloor} matches).`

  const overall = rankRate(
    players,
    (player) => rate(ultimatePoints(player), player.matchesPlayed),
    (player) =>
      perMatchStats(player, [
        { label: 'Ultimate / match', value: String(round(rate(ultimatePoints(player), player.matchesPlayed))) },
        { label: 'Wins', value: String(player.wins) },
        { label: 'MotM', value: String(player.motm) },
        { label: 'Eliminations', value: String(player.eliminations) },
      ]),
  )

  const attacking = rankRate(
    players,
    (player) =>
      rate(
        player.eliminations * 3 + player.sixes * 0.5 + player.superPowers * 2 + player.plus10,
        player.matchesPlayed,
      ),
    (player) =>
      perMatchStats(player, [
        { label: 'Eliminations', value: String(player.eliminations) },
        { label: 'Sixes', value: String(player.sixes) },
        { label: 'Super ⚡', value: String(player.superPowers) },
        { label: '+10', value: String(player.plus10) },
      ]),
  )

  const eliminator = rankRate(
    players,
    (player) => rate(player.eliminations, player.matchesPlayed),
    (player) =>
      perMatchStats(player, [
        { label: 'Eliminations', value: String(player.eliminations) },
        {
          label: 'Per match',
          value: String(round(rate(player.eliminations, player.matchesPlayed))),
        },
      ]),
  )

  const dominant = rankRate(
    players,
    (player) => rate(player.wins * 2 + player.motm, player.matchesPlayed),
    (player) =>
      perMatchStats(player, [
        { label: 'Wins', value: String(player.wins) },
        { label: 'MotM', value: String(player.motm) },
        { label: '2nd', value: String(player.second) },
      ]),
  )

  const consistent = rankRate(
    players,
    (player) =>
      rate(player.motmPoints, player.matchesPlayed) * (1 - rate(player.worst, player.matchesPlayed)),
    (player) =>
      perMatchStats(player, [
        { label: 'MotM points / match', value: String(round(rate(player.motmPoints, player.matchesPlayed))) },
        { label: 'Worst awards', value: String(player.worst) },
        {
          label: 'Worst / match',
          value: String(round(rate(player.worst, player.matchesPlayed))),
        },
      ]),
  )

  const aggressive = rankRate(
    players,
    (player) =>
      rate(player.sixes + player.superPowers * 2 + player.negativePowers, player.matchesPlayed),
    (player) =>
      perMatchStats(player, [
        { label: 'Sixes', value: String(player.sixes) },
        { label: 'Super ⚡', value: String(player.superPowers) },
        { label: 'Oonjaal', value: String(player.negativePowers) },
      ]),
  )

  const underrated = rankRate(
    players,
    (player) => {
      const output = rate(
        player.eliminations * 2 + player.motmPoints + player.sixes * 0.25,
        player.matchesPlayed,
      )
      const recognition = rate(player.wins + player.motm, player.matchesPlayed)
      return output - recognition * 15
    },
    (player) =>
      perMatchStats(player, [
        { label: 'Eliminations', value: String(player.eliminations) },
        { label: 'MotM points', value: String(round(player.motmPoints)) },
        { label: 'Wins', value: String(player.wins) },
        { label: 'MotM awards', value: String(player.motm) },
      ]),
  )
  const underratedRanked = underrated.ranked.filter((entry) => entry.score > 0)

  const improved = scoreImproved(players, matches, matchFloor)
  const podium = rankRate(
    players,
    (player) => rate(player.wins + player.second + player.third, player.matchesPlayed),
    (player) =>
      perMatchStats(player, [
        { label: 'Wins', value: String(player.wins) },
        { label: '2nd', value: String(player.second) },
        { label: '3rd', value: String(player.third) },
        {
          label: 'Podium / match',
          value: String(round(rate(player.wins + player.second + player.third, player.matchesPlayed))),
        },
      ]),
  )
  const rivalry = scoreRivalry(players, matchFloor)

  return [
    awardFromRank('best_overall', overall.ranked, overall.pool, eligibleNote),
    awardFromRank('best_attacking', attacking.ranked, attacking.pool, eligibleNote),
    awardFromRank('best_eliminator', eliminator.ranked, eliminator.pool, eligibleNote),
    awardFromRank('most_dominant', dominant.ranked, dominant.pool, eligibleNote),
    awardFromRank('most_consistent', consistent.ranked, consistent.pool, eligibleNote),
    improved,
    awardFromRank('most_aggressive', aggressive.ranked, aggressive.pool, eligibleNote),
    awardFromRank(
      'most_underrated',
      underratedRanked,
      underrated.pool,
      underrated.pool < 1
        ? eligibleNote
        : 'No player is clearly ahead of their awards yet.',
    ),
    awardFromRank('best_podium', podium.ranked, podium.pool, eligibleNote),
    rivalry,
  ]
}

function scoreRivalry(players: AnalystPlayer[], matchFloor: number): AnalystAward {
  const names = new Map(players.map((player) => [player.accountId, player.name]))
  const ranked: Ranked[] = []
  for (const player of players) {
    if (player.matchesPlayed < matchFloor) continue
    let bestVictim = ''
    let bestCount = 0
    for (const [victimId, count] of Object.entries(player.elimPairs ?? {})) {
      if (victimId === player.accountId || !names.has(victimId) || count <= bestCount) continue
      bestVictim = victimId
      bestCount = count
    }
    if (!bestVictim || bestCount <= 0) continue
    const victimName = names.get(bestVictim) ?? bestVictim
    ranked.push({
      player: { ...player, name: `${player.name} over ${victimName}` },
      score: bestCount,
      stats: [
        { label: 'Eliminated', value: victimName },
        { label: 'Times', value: String(bestCount) },
        { label: 'Matches', value: String(player.matchesPlayed) },
      ],
    })
  }
  ranked.sort(
    (a, b) => b.score - a.score || a.player.name.localeCompare(b.player.name),
  )
  return awardFromRank(
    'sharpest_rivalry',
    ranked,
    ranked.length,
    'No saved eliminations between players in the same match range.',
  )
}

function scoreImproved(
  players: AnalystPlayer[],
  matches: AnalystMatch[],
  matchFloor: number,
): AnalystAward {
  const byId = new Map(players.map((player) => [player.accountId, player]))
  const ranked: Ranked[] = []
  for (const player of players) {
    if (player.matchesPlayed < matchFloor) continue
    const rows = matches
      .map((match) => {
        const row = match.players.find((entry) => entry.accountId === player.accountId)
        return row ? { at: match.finishedAt, score: matchPerformance(row) } : null
      })
      .filter((row): row is { at: number; score: number } => row != null)
      .sort((a, b) => a.at - b.at)
    if (rows.length < MIN_SPLIT * 2) continue
    const mid = Math.floor(rows.length / 2)
    const earlier = rows.slice(0, mid)
    const recent = rows.slice(mid)
    if (earlier.length < MIN_SPLIT || recent.length < MIN_SPLIT) continue
    const earlierAvg = earlier.reduce((sum, row) => sum + row.score, 0) / earlier.length
    const recentAvg = recent.reduce((sum, row) => sum + row.score, 0) / recent.length
    const known = byId.get(player.accountId) ?? player
    ranked.push({
      player: known,
      score: recentAvg - earlierAvg,
      stats: [
        { label: 'Recent avg', value: String(round(recentAvg)) },
        { label: 'Earlier avg', value: String(round(earlierAvg)) },
        { label: 'Matches compared', value: String(rows.length) },
      ],
    })
  }
  const positive = ranked
    .filter((entry) => entry.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score || a.player.name.localeCompare(b.player.name),
    )
  return awardFromRank(
    'most_improved',
    positive,
    positive.length,
    `Needs at least ${MIN_SPLIT} earlier and ${MIN_SPLIT} recent matches, and a higher recent average.`,
  )
}

export type AnalystNarrative = {
  reasons: Partial<Record<AnalystCategory, string>>
  rivalries: string[]
  observations: string[]
  overallVerdict: string
}

function clip(value: unknown, max: number) {
  if (typeof value !== 'string') return ''
  return value.replace(/\s+/g, ' ').trim().slice(0, max)
}

/** Keep only explanations that still refer to the calculated winner. */
export function acceptNarrative(
  awards: AnalystAward[],
  raw: unknown,
): AnalystNarrative | null {
  if (!raw || typeof raw !== 'object') return null
  const data = raw as Partial<AnalystNarrative> & { reasons?: unknown }
  const reasons: AnalystNarrative['reasons'] = {}
  if (data.reasons && typeof data.reasons === 'object') {
    for (const award of awards) {
      if (award.status !== 'winner' || !award.playerName) continue
      const text = clip((data.reasons as Record<string, unknown>)[award.category], 420)
      if (!text) continue
      if (!text.toLowerCase().includes(award.playerName.toLowerCase())) continue
      reasons[award.category] = text
    }
  }
  const rivalries = Array.isArray(data.rivalries)
    ? data.rivalries.map((item) => clip(item, 180)).filter(Boolean).slice(0, 3)
    : []
  const observations = Array.isArray(data.observations)
    ? data.observations.map((item) => clip(item, 180)).filter(Boolean).slice(0, 3)
    : []
  const overallVerdict = clip(data.overallVerdict, 500)
  if (!overallVerdict && Object.keys(reasons).length === 0) return null
  return { reasons, rivalries, observations, overallVerdict }
}
