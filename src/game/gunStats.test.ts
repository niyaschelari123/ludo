import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createGame,
  globalCell,
  recordSuperGunHit,
} from './engine.ts'
import { applyPowerUp, superUsesLimit } from './powerUps.ts'
import { readPlayerStats } from './matchAwards.ts'
import { PLAYER_COLORS, type Room } from './types.ts'
import { buildGunPairLeaders, type CareerBoardEntry } from '../lib/profileCloud.ts'

function makeRoom(): Room {
  const now = Date.now()
  const players = Array.from({ length: 4 }, (_, seat) => ({
    id: `acct:p${seat}`,
    name: `Player ${seat + 1}`,
    color: PLAYER_COLORS[seat],
    seat,
    connected: true,
    joinedAt: now,
  }))
  return {
    id: 'r',
    code: 'TEST',
    hostId: 'acct:p0',
    memberIds: players.map((p) => p.id),
    maxPlayers: 4,
    gameMode: 'power',
    status: 'playing',
    players,
    departedPlayers: [],
    game: createGame(players, 'power', { randomFlash: true }),
    createdAt: now,
    updatedAt: now,
  } as Room
}

test('the Super Gun is counted only after every Flash leap is used', () => {
  const room = makeRoom()
  const player = room.players[0]
  const game = room.game!
  const limit = superUsesLimit(room)
  assert.ok(limit >= 2)
  const token = game.tokens.find((t) => t.playerId === player.id && t.id === 0)!

  for (let leap = 1; leap <= limit; leap += 1) {
    token.progress = 3
    applyPowerUp(room, player, token, 'super', globalCell(token, room)!)
    const earned = readPlayerStats(room, player.id).superGuns
    assert.equal(earned, leap === limit ? 1 : 0, `after leap ${leap}/${limit}`)
  }
  assert.equal(game.superGunReady?.[player.id], true)
})

test('Super Gun hits are recorded shooter → victim', () => {
  const room = makeRoom()
  const game = room.game!
  recordSuperGunHit(game, 'acct:p0', 'acct:p1')
  recordSuperGunHit(game, 'acct:p0', 'acct:p1')
  recordSuperGunHit(game, 'acct:p0', 'acct:p2')
  recordSuperGunHit(game, 'acct:p3', 'acct:p0')
  assert.deepEqual(readPlayerStats(room, 'acct:p0').gunHits, {
    'acct:p1': 2,
    'acct:p2': 1,
  })
  assert.deepEqual(readPlayerStats(room, 'acct:p3').gunHits, { 'acct:p0': 1 })
  assert.deepEqual(readPlayerStats(room, 'acct:p1').gunHits, {})
})

test('the career “who shot whom” list is sorted by count and ignores empty rows', () => {
  const base = {
    color: '',
    wins: 0, motm: 0, worst: 0, second: 0, third: 0, eliminations: 0,
    timesEliminated: 0, sixes: 0, matchesPlayed: 0, motmPoints: 0,
    negativePowers: 0, superPowers: 0, superGuns: 0, plus10: 0, bestFinishMs: 0,
    elimPairs: {},
  }
  const board = [
    { ...base, accountId: 'acct:niyas', name: 'Niyas', gunPairs: { 'acct:joji': 3, 'acct:anjal': 1 } },
    { ...base, accountId: 'acct:joji', name: 'Joji', gunPairs: { 'acct:niyas': 5 } },
    { ...base, accountId: 'acct:anjal', name: 'Anjal' },
  ] as unknown as CareerBoardEntry[]
  const leaders = buildGunPairLeaders(board, 8)
  assert.deepEqual(
    leaders.map((l) => [l.attackerName, l.victimName, l.count]),
    [['Joji', 'Niyas', 5], ['Niyas', 'Joji', 3], ['Niyas', 'Anjal', 1]],
  )
  // the elimination list is untouched by gun data
  assert.equal(buildGunPairLeaders(board, 1).length, 1)
})
