import { CELLS_PER_PLAYER } from '../game/engine'
import { POWER_UP_ICONS, powerTilesList } from '../game/powerUps'
import type { PowerUpType, Room } from '../game/types'

const SIZE = 600
const CENTER = SIZE / 2

interface Point {
  x: number
  y: number
}

const point = (radius: number, angle: number): Point => ({
  x: CENTER + Math.cos(angle) * radius,
  y: CENTER + Math.sin(angle) * radius,
})

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

function boardSeatCount(room: Room) {
  const seats = [
    ...room.players,
    ...(room.game ? (room.departedPlayers ?? []) : []),
  ].map((player) => player.seat)
  return seats.length === 0 ? room.players.length : Math.max(...seats) + 1
}

function boardStartAngle(count: number) {
  return count === 4 ? (-Math.PI * 3) / 4 : -Math.PI / 2
}

function radialCellAngle(cell: number, count: number) {
  return boardStartAngle(count) + (cell / (count * CELLS_PER_PLAYER)) * Math.PI * 2
}

function squarePoint(cell: number) {
  return FOUR_TRACK[cell]
}

function radialPoint(cell: number, count: number) {
  return point(194, radialCellAngle(cell, count))
}

function PowerMarker({
  x,
  y,
  type,
}: {
  x: number
  y: number
  type: PowerUpType
}) {
  const label = POWER_UP_ICONS[type]
  const isText = type === 'tnt' || type === 'x2' || type === 'x3'

  return (
    <g className={`power-marker power-${type}`}>
      <circle cx={x} cy={y} r="11" className="power-marker-bg" />
      <text
        x={x}
        y={y + (isText ? 4 : 5)}
        textAnchor="middle"
        className={`power-marker-label ${isText ? 'text' : 'emoji'}`}
      >
        {label}
      </text>
    </g>
  )
}

export function PowerUpLayer({ room }: { room: Room }) {
  if ((room.gameMode ?? 'classic') !== 'power' || !room.game?.powerTiles) return null

  const count = boardSeatCount(room)
  const isSquare = room.players.length === 4 && count === 4
  const tiles = powerTilesList(room.game.powerTiles)

  return (
    <g className="power-layer" aria-hidden="true">
      {tiles.map(({ cell, type }) => {
        const position = isSquare ? squarePoint(cell) : radialPoint(cell, count)
        if (!position) return null
        return <PowerMarker key={`${cell}-${type}`} x={position.x} y={position.y} type={type} />
      })}
    </g>
  )
}
