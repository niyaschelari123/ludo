process.env.ANALYST_CACHE_DISABLE = '1'

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  acceptNarrative,
  scoreAwards,
  statsVersion,
  type AnalystPlayer,
} from './playerAnalyst.ts'
import { resetAnalystCacheForTests, resolveAnalyst } from '../../server/src/analyst.ts'

function player(partial: Partial<AnalystPlayer> & Pick<AnalystPlayer, 'accountId' | 'name'>): AnalystPlayer {
  return {
    matchesPlayed: 0,
    wins: 0,
    motm: 0,
    worst: 0,
    second: 0,
    third: 0,
    eliminations: 0,
    timesEliminated: 0,
    sixes: 0,
    motmPoints: 0,
    negativePowers: 0,
    superPowers: 0,
    plus10: 0,
    elimPairs: {},
    ...partial,
  }
}

test('rate awards stay insufficient without enough matches', () => {
  const awards = scoreAwards(
    [
      player({ accountId: 'acct:a', name: 'A', matchesPlayed: 2, wins: 2, eliminations: 20 }),
      player({ accountId: 'acct:b', name: 'B', matchesPlayed: 1, wins: 1 }),
    ],
    [],
  )
  assert.equal(awards.find((award) => award.category === 'best_overall')?.status, 'insufficient')
  assert.equal(awards.find((award) => award.category === 'best_eliminator')?.playerId, null)
})

test('more matches do not automatically win a rate award', () => {
  const awards = scoreAwards(
    [
      player({
        accountId: 'acct:volume',
        name: 'Volume',
        matchesPlayed: 20,
        wins: 4,
        motm: 2,
        eliminations: 10,
      }),
      player({
        accountId: 'acct:sharp',
        name: 'Sharp',
        matchesPlayed: 18,
        wins: 14,
        motm: 12,
        eliminations: 40,
      }),
    ],
    [],
  )
  assert.equal(awards.find((award) => award.category === 'best_overall')?.playerId, 'acct:sharp')
})

test('a short career is left out of a similar match group', () => {
  const awards = scoreAwards(
    [
      player({
        accountId: 'acct:anjal',
        name: 'Anjal',
        matchesPlayed: 6,
        wins: 5,
        motm: 5,
        eliminations: 30,
      }),
      player({ accountId: 'acct:a', name: 'Ada', matchesPlayed: 40, wins: 12, motm: 8, eliminations: 20 }),
      player({ accountId: 'acct:b', name: 'Bea', matchesPlayed: 38, wins: 10, motm: 7, eliminations: 18 }),
      player({ accountId: 'acct:c', name: 'Cid', matchesPlayed: 42, wins: 11, motm: 6, eliminations: 16 }),
    ],
    [],
  )
  const overall = awards.find((award) => award.category === 'best_overall')
  assert.notEqual(overall?.playerId, 'acct:anjal')
  assert.equal(overall?.status, 'winner')
})

test('podium rate uses 1st, 2nd, and 3rd among the main group', () => {
  const awards = scoreAwards(
    [
      player({
        accountId: 'acct:podium',
        name: 'Podium',
        matchesPlayed: 40,
        wins: 8,
        second: 10,
        third: 10,
      }),
      player({
        accountId: 'acct:wins',
        name: 'Wins',
        matchesPlayed: 40,
        wins: 14,
        second: 2,
        third: 2,
      }),
      player({
        accountId: 'acct:short',
        name: 'Short',
        matchesPlayed: 4,
        wins: 4,
      }),
    ],
    [],
  )
  assert.equal(awards.find((award) => award.category === 'best_podium')?.playerId, 'acct:podium')
})

test('sharpest rivalry is the most repeated elimination', () => {
  const awards = scoreAwards(
    [
      player({
        accountId: 'acct:ada',
        name: 'Ada',
        matchesPlayed: 40,
        elimPairs: { 'acct:bea': 9, 'acct:cid': 2 },
      }),
      player({
        accountId: 'acct:bea',
        name: 'Bea',
        matchesPlayed: 38,
        elimPairs: { 'acct:ada': 4 },
      }),
      player({
        accountId: 'acct:cid',
        name: 'Cid',
        matchesPlayed: 36,
        elimPairs: { 'acct:ada': 3 },
      }),
    ],
    [],
  )
  const rivalry = awards.find((award) => award.category === 'sharpest_rivalry')
  assert.equal(rivalry?.playerName, 'Ada over Bea')
  assert.equal(rivalry?.score, 9)
})

test('identical scores are marked as ties', () => {
  const awards = scoreAwards(
    [
      player({ accountId: 'acct:a', name: 'Ada', matchesPlayed: 4, eliminations: 8 }),
      player({ accountId: 'acct:b', name: 'Bea', matchesPlayed: 4, eliminations: 8 }),
    ],
    [],
  )
  const award = awards.find((entry) => entry.category === 'best_eliminator')
  assert.equal(award?.tied, true)
  assert.ok(award?.playerId === 'acct:a' || award?.playerId === 'acct:b')
})

test('most improved needs both halves and a real rise', () => {
  const flat = scoreAwards(
    [player({ accountId: 'acct:a', name: 'Ada', matchesPlayed: 6 })],
    Array.from({ length: 6 }, (_, index) => ({
      id: `m${index}`,
      finishedAt: index,
      players: [{ accountId: 'acct:a', place: 2, motmPoints: 1, captures: 0 }],
    })),
  )
  assert.equal(flat.find((award) => award.category === 'most_improved')?.status, 'insufficient')

  const rising = scoreAwards(
    [player({ accountId: 'acct:a', name: 'Ada', matchesPlayed: 6 })],
    [1, 1, 1, 4, 5, 6].map((captures, index) => ({
      id: `r${index}`,
      finishedAt: index,
      players: [{ accountId: 'acct:a', place: 1, motmPoints: 0, captures }],
    })),
  )
  assert.equal(rising.find((award) => award.category === 'most_improved')?.playerId, 'acct:a')
})

test('stats version changes when a number changes', () => {
  const base = [player({ accountId: 'acct:a', name: 'Ada', matchesPlayed: 3, wins: 1 })]
  const next = [player({ accountId: 'acct:a', name: 'Ada', matchesPlayed: 4, wins: 2 })]
  assert.notEqual(statsVersion(base, []), statsVersion(next, []))
  assert.equal(statsVersion(base, []), statsVersion(base, []))
})

test('narrative that names the wrong winner is dropped', () => {
  const awards = scoreAwards(
    [player({ accountId: 'acct:a', name: 'Ada', matchesPlayed: 4, wins: 3, motm: 2 })],
    [],
  )
  const accepted = acceptNarrative(awards, {
    reasons: { best_overall: 'Bea is the best overall player.' },
    overallVerdict: 'Ada still leads the calculated board.',
    rivalries: [],
    observations: [],
  })
  assert.equal(accepted?.reasons.best_overall, undefined)
  assert.match(accepted?.overallVerdict ?? '', /Ada/)
})

test('cached analysis is reused and a Groq failure does not invent a winner', async () => {
  resetAnalystCacheForTests()
  let calls = 0
  const body = {
    players: [player({ accountId: 'acct:a', name: 'Ada', matchesPlayed: 5, wins: 3, motm: 2, eliminations: 4 })],
    matches: [],
  }
  const first = await resolveAnalyst(body, {
    groq: async () => {
      calls += 1
      return JSON.stringify({
        reasons: { best_overall: 'Ada leads on Ultimate points per match.' },
        rivalries: ['Ada and the field'],
        observations: ['Small sample'],
        overallVerdict: 'Ada is the calculated best overall.',
      })
    },
  })
  const second = await resolveAnalyst(body, {
    groq: async () => {
      calls += 1
      return '{}'
    },
  })
  assert.equal(calls, 1)
  assert.equal(second.statsVersion, first.statsVersion)
  assert.equal(second.awards.find((award) => award.category === 'best_overall')?.playerName, 'Ada')

  resetAnalystCacheForTests()
  const failed = await resolveAnalyst(
    {
      players: [player({ accountId: 'acct:b', name: 'Bea', matchesPlayed: 4, wins: 2 })],
      matches: [],
    },
    {
      groq: async () => {
        throw new Error('down')
      },
    },
  )
  assert.equal(failed.aiStatus, 'unavailable')
  assert.equal(failed.narrative, null)
  assert.equal(failed.awards.find((award) => award.category === 'best_overall')?.playerName, 'Bea')
})
