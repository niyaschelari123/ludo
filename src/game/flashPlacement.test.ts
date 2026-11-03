process.env.ANALYST_CACHE_DISABLE = '1'

import assert from 'node:assert/strict'
import test from 'node:test'
import { CELLS_PER_PLAYER } from './engine.ts'
import {
  generateQuickPowerTiles,
  randomizeFlashSupers,
  randomizeSmoke,
  starOffsetAfterFlash,
} from './powerUps.ts'

function flashCells(tiles: Record<number, string>) {
  return Object.entries(tiles)
    .filter(([, type]) => type === 'super')
    .map(([cell]) => Number(cell))
    .sort((a, b) => a - b)
}

function makeRandom(seed: number) {
  let state = seed
  return () => {
    state = (state * 16807) % 2147483647
    return state / 2147483647
  }
}

test('random smoke stays off flash paths and the first 6 steps', () => {
  const random = makeRandom(9)
  const tiles = generateQuickPowerTiles(5)
  const starOffset = randomizeFlashSupers(tiles, 5, random)
  randomizeSmoke(tiles, 5, random, starOffset)
  const flashSeats = new Set(
    Object.entries(tiles)
      .filter(([, type]) => type === 'super')
      .map(([cell]) => Math.floor(Number(cell) / CELLS_PER_PLAYER)),
  )
  const smoke = Object.entries(tiles)
    .filter(([, type]) => type === 'smoke')
    .map(([cell]) => Number(cell))
  assert.equal(smoke.length, 2)
  const smokeSeats = smoke.map((cell) => Math.floor(cell / CELLS_PER_PLAYER))
  assert.notEqual(smokeSeats[0], smokeSeats[1])
  for (const cell of smoke) {
    assert.ok(cell % CELLS_PER_PLAYER > 6)
    assert.equal(flashSeats.has(Math.floor(cell / CELLS_PER_PLAYER)), false)
    assert.notEqual(cell % CELLS_PER_PLAYER, starOffset)
  }
})

test('random flash sits on opposite paths with matching offsets', () => {
  for (let seed = 1; seed < 40; seed += 1) {
    const random = makeRandom(seed)
    const tiles = generateQuickPowerTiles(5)
    const before = { ...tiles }
    const starOffset = randomizeFlashSupers(tiles, 5, random)
    const cells = flashCells(tiles)
    assert.equal(cells.length, 2)
    const seats = cells.map((cell) => Math.floor(cell / CELLS_PER_PLAYER))
    const offsets = cells.map((cell) => cell % CELLS_PER_PLAYER)
    assert.equal(offsets[0], offsets[1])
    const step = Math.floor(5 / 2)
    const gap = (seats[0] - seats[1] + 5) % 5
    assert.ok(gap === step || gap === 5 - step)
    assert.equal(starOffset, starOffsetAfterFlash(offsets[0]))
    assert.equal(starOffset, offsets[0] + 1)
    assert.notEqual(starOffset, offsets[0])
    for (const cell of cells) {
      const offset = cell % CELLS_PER_PLAYER
      assert.ok(offset > 6)
      assert.notEqual(offset, starOffset)
      assert.ok(before[cell] == null || before[cell] === 'super')
    }
  }
})

test('random flash opposite paths work for 4 players too', () => {
  for (let seed = 1; seed < 25; seed += 1) {
    const random = makeRandom(seed)
    const tiles = generateQuickPowerTiles(4)
    const starOffset = randomizeFlashSupers(tiles, 4, random)
    const cells = flashCells(tiles)
    assert.equal(cells.length, 2)
    const seats = cells.map((cell) => Math.floor(cell / CELLS_PER_PLAYER))
    const offsets = cells.map((cell) => cell % CELLS_PER_PLAYER)
    assert.equal(offsets[0], offsets[1])
    assert.equal((seats[0] - seats[1] + 4) % 4, 2)
    assert.equal(starOffset, offsets[0] + 1)
  }
})
