import {
  allSeatPlayers,
  finishedProgress,
  getBoardPlayerCount,
  globalCell,
  homeEntryProgress,
  homeLengthForBoard,
} from './engine'
import {
  BOARD_CENTER,
  BOARD_SIZE,
  getPolygonBoardGeometry,
  polygonTrackPoint,
  type Point,
} from './boardGeometry'
import type { Room, Token } from './types'

const GRID_SIZE = 32
const GRID_OFFSET = 60
const gridPoint = (row: number, col: number): Point => ({
  x: GRID_OFFSET + col * GRID_SIZE + GRID_SIZE / 2,
  y: GRID_OFFSET + row * GRID_SIZE + GRID_SIZE / 2,
})

const FOUR_TRACK: Point[] = [
  [6, 1], [6, 2], [6, 3], [6, 4], [6, 5],
  [5, 6], [4, 6], [3, 6], [2, 6], [1, 6], [0, 6], [0, 7], [0, 8],
  [1, 8], [2, 8], [3, 8], [4, 8], [5, 8],
  [6, 9], [6, 10], [6, 11], [6, 12], [6, 13], [6, 14], [7, 14], [8, 14],
  [8, 13], [8, 12], [8, 11], [8, 10], [8, 9],
  [9, 8], [10, 8], [11, 8], [12, 8], [13, 8], [14, 8], [14, 7], [14, 6],
  [13, 6], [12, 6], [11, 6], [10, 6], [9, 6],
  [8, 5], [8, 4], [8, 3], [8, 2], [8, 1], [8, 0], [7, 0], [6, 0],
].map(([row, col]) => gridPoint(row, col))

const FOUR_HOME_LANES: Point[][] = [
  [1, 2, 3, 4, 5].map((col) => gridPoint(7, col)),
  [1, 2, 3, 4, 5].map((row) => gridPoint(row, 7)),
  [13, 12, 11, 10, 9].map((col) => gridPoint(7, col)),
  [13, 12, 11, 10, 9].map((row) => gridPoint(row, 7)),
]

export function boardCenterPoint(room: Room): Point {
  const count = getBoardPlayerCount(room)
  if (count === 4) return { x: BOARD_CENTER, y: BOARD_CENTER }
  return getPolygonBoardGeometry(count, homeLengthForBoard(count)).center
}

export function boardSizeForRoom(room: Room): number {
  const count = getBoardPlayerCount(room)
  if (count === 4) return BOARD_SIZE
  return getPolygonBoardGeometry(count, homeLengthForBoard(count)).size
}

export function tokenBoardPoint(room: Room, token: Token): Point {
  const count = getBoardPlayerCount(room)
  const player = allSeatPlayers(room).find(
    (entry) => entry.id === token.playerId,
  )
  const center = boardCenterPoint(room)
  if (!player) return center

  const homeEntry = homeEntryProgress(room)
  const finished = finishedProgress(room)

  if (count === 4) {
    if (token.progress < 0) return center
    if (token.progress >= finished) return center
    if (token.progress >= homeEntry) {
      const lane = FOUR_HOME_LANES[player.seat] ?? []
      const step = Math.min(
        lane.length - 1,
        Math.max(0, Math.floor(token.progress - homeEntry)),
      )
      return lane[step] ?? center
    }
    const cell = globalCell(token, room)
    return cell === null ? center : (FOUR_TRACK[cell] ?? center)
  }

  const geometry = getPolygonBoardGeometry(count, homeLengthForBoard(count))
  const sector = geometry.sectors[player.seat]
  if (!sector) return geometry.center
  if (token.progress < 0 || token.progress >= finished) return geometry.center
  if (token.progress >= homeEntry) {
    const step = Math.min(
      geometry.homeLength - 1,
      Math.max(0, Math.floor(token.progress - homeEntry)),
    )
    return sector.homeLane[step] ?? sector.homeLane[sector.homeLane.length - 1]
  }
  const cell = globalCell(token, room)
  if (cell === null) return geometry.center
  return polygonTrackPoint(geometry, cell).point
}
