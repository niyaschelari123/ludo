process.env.ANALYST_CACHE_DISABLE = '1'

import assert from 'node:assert/strict'
import test from 'node:test'
import { CELLS_PER_PLAYER } from './engine.ts'
import { generateQuickPowerTiles, randomizeFlashSupers, randomizeSmoke } from './powerUps.ts'

function flashCells(tiles: Record<number, string>) {
  return Object.entries(tiles)
    .filter(([, type]) => type === 'super')
    .map(([cell]) => Number(cell))
    .sort((a, b) => a - b)
}

test('random smoke stays off flash paths and the first 6 steps', () => {
  let state = 9
  const random = () => {
    state = (state * 16807) % 2147483647
    return state / 2147483647
  }
  const tiles = generateQuickPowerTiles(5)
  randomizeFlashSupers(tiles, 5, random)
  randomizeSmoke(tiles, 5, random)
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
  }
})

test('random flash stays off the first 6 steps and off other powers', () => {
  for (let seed = 1; seed < 40; seed += 1) {
    let state = seed
    const random = () => {
      state = (state * 16807) % 2147483647
      return state / 2147483647
    }
    const tiles = generateQuickPowerTiles(5)
    const before = { ...tiles }
    randomizeFlashSupers(tiles, 5, random)
    const cells = flashCells(tiles)
    assert.equal(cells.length, 2)
    const seats = cells.map((cell) => Math.floor(cell / CELLS_PER_PLAYER))
    assert.notEqual(seats[0], seats[1])
    for (const cell of cells) {
      const offset = cell % CELLS_PER_PLAYER
      assert.ok(offset > 6)
      assert.notEqual(offset, 8)
      assert.ok(before[cell] == null || before[cell] === 'super')
    }
  }
})
