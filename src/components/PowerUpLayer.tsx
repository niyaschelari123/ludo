import { getBoardPlayerCount } from '../game/engine'
import {
  getPolygonBoardGeometry,
  polygonTrackPoint,
  type BoardGeometry,
  type Point,
} from '../game/boardGeometry'
import { POWER_UP_ICONS, powerTilesList, sanitizePowerTiles } from '../game/powerUps'
import { hasPowerBoard, type PowerUpType, type Room } from '../game/types'

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
  return getBoardPlayerCount(room)
}

function PowerMarker({
  x,
  y,
  type,
  rotation = 0,
  cellSize = 32,
}: {
  x: number
  y: number
  type: PowerUpType
  rotation?: number
  cellSize?: number
}) {
  const label = POWER_UP_ICONS[type]
  const isText =
    type === 'plus10' ||
    type === 'half' ||
    type === 'tnt' ||
    type === 'x2' ||
    type === 'x3' ||
    type === 'back2' ||
    type === 'back3' ||
    type === 'back5' ||
    type === 'yard'

  // Fill most of the track cell so icons match the containing box.
  const radius = Math.max(11, cellSize * 0.42)
  const box = radius * 2.15
  const textSize = isText ? radius * 0.72 : radius * 0.95
  const textDy = isText ? radius * 0.36 : radius * 0.4

  return (
    <g className={`power-marker power-${type}`}>
      {type === 'shield' && (
        <rect
          x={x - box / 2}
          y={y - box / 2}
          width={box}
          height={box}
          rx={Math.max(3, cellSize * 0.08)}
          className="shield-box-glow"
          transform={`rotate(${rotation} ${x} ${y})`}
        />
      )}
      <circle cx={x} cy={y} r={radius} className="power-marker-bg" />
      <text
        x={x}
        y={y + textDy}
        textAnchor="middle"
        className={`power-marker-label ${isText ? 'text' : 'emoji'}`}
        style={{ fontSize: `${textSize}px` }}
      >
        {label}
      </text>
    </g>
  )
}

export function PowerUpLayer({
  room,
  geometry,
}: {
  room: Room
  geometry?: BoardGeometry | null
}) {
  if (!hasPowerBoard(room.gameMode) || !room.game?.powerTiles) return null

  sanitizePowerTiles(room.game.powerTiles, getBoardPlayerCount(room))

  const count = boardSeatCount(room)
  const isSquare = count === 4
  const tiles = powerTilesList(room.game.powerTiles)
  const polygonGeometry =
    geometry ?? (isSquare ? null : getPolygonBoardGeometry(count))

  return (
    <g className="power-layer" aria-hidden="true">
      {tiles.map(({ cell, type }) => {
        if (isSquare) {
          const position = FOUR_TRACK[cell]
          if (!position) return null
          return (
            <PowerMarker
              key={`${cell}-${type}`}
              x={position.x}
              y={position.y}
              type={type}
              cellSize={GRID_SIZE}
            />
          )
        }
        if (!polygonGeometry) return null
        const trackCell = polygonTrackPoint(polygonGeometry, cell)
        const rotation = (trackCell.tangent * 180) / Math.PI
        return (
          <PowerMarker
            key={`${cell}-${type}`}
            x={trackCell.point.x}
            y={trackCell.point.y}
            type={type}
            rotation={rotation}
            cellSize={polygonGeometry.cellSize}
          />
        )
      })}
    </g>
  )
}
