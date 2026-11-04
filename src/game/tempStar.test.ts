import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_STAR_OFFSET,
  baseSafeCells,
  createGame,
  globalCell,
  redStarCells,
  safeCells,
  settleTempStars,
} from './engine.ts'
import { applyPowerUp } from './powerUps.ts'
import { PLAYER_COLORS, type Room } from './types.ts'

function makeRoom(randomFlash: boolean): Room {
  const now = Date.now()
  const players = Array.from({ length: 4 }, (_, seat) => ({
    id: `p${seat}`,
    name: `Player ${seat + 1}`,
    color: PLAYER_COLORS[seat],
    seat,
    connected: true,
    joinedAt: now,
  }))
  const game = createGame(players, 'power', { randomFlash })
  return {
    id: 'r',
    code: 'TEST',
    hostId: 'p0',
    memberIds: players.map((p) => p.id),
    maxPlayers: 4,
    gameMode: 'power',
    status: 'playing',
    players,
    departedPlayers: [],
    game,
    createdAt: now,
    updatedAt: now,
  } as Room
}

function leapFrom(room: Room, progress: number) {
  const player = room.players[0]
  const token = room.game!.tokens.find((t) => t.playerId === player.id && t.id === 0)!
  token.progress = progress
  const landing = globalCell(token, room)!
  applyPowerUp(room, player, token, 'super', landing)
  return token
}

test('random Flash never moves the stars', () => {
  for (let i = 0; i < 30; i += 1) {
    const room = makeRoom(true)
    assert.equal(room.game!.starOffset, DEFAULT_STAR_OFFSET)
    assert.equal(room.game!.randomFlash, true)
    assert.deepEqual(room.game!.tempStars, [])
    assert.ok(baseSafeCells(room).has(DEFAULT_STAR_OFFSET))
  }
})

test('a Flash leap drops a temporary star that is safe only while the player stays', () => {
  const room = makeRoom(true)
  const token = leapFrom(room, 3)
  const cell = globalCell(token, room)!
  assert.equal(token.progress, 3 + 26)
  assert.equal(baseSafeCells(room).has(cell), false)
  assert.equal(room.game!.tempStars!.length, 1)
  assert.ok(safeCells(room).has(cell), 'temp star is safe while the player is on it')
  assert.equal(redStarCells(room).has(cell), false)

  // staying put keeps the star
  settleTempStars(room)
  assert.ok(safeCells(room).has(cell))

  // leaving removes the safe star and leaves a red one
  token.progress += 1
  settleTempStars(room)
  assert.equal(safeCells(room).has(cell), false)
  assert.ok(redStarCells(room).has(cell))

  // coming back never revives it
  token.progress -= 1
  settleTempStars(room)
  assert.equal(safeCells(room).has(cell), false)
  assert.ok(redStarCells(room).has(cell))
})

test('a leap that ends on an existing safe cell adds no temporary star', () => {
  const room = makeRoom(true)
  const token = leapFrom(room, 0) // 0 + 26 = seat 2 start (already safe)
  assert.ok(baseSafeCells(room).has(globalCell(token, room)!))
  assert.equal(room.game!.tempStars!.length, 0)
})

test('without random Flash the old snap-to-star leap is unchanged', () => {
  const room = makeRoom(false)
  assert.equal(room.game!.randomFlash, false)
  const token = leapFrom(room, 3)
  assert.equal(room.game!.tempStars!.length, 0)
  assert.ok(baseSafeCells(room).has(globalCell(token, room)!), 'snaps onto a permanent safe cell')
})
