import { useEffect, useState } from 'react'
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

const SQUARE_CENTER: Point = { x: 300, y: 300 }

function bombOffset(
  x: number,
  y: number,
  cellSize: number,
  normal?: number,
): Point {
  const dist = cellSize * 0.78
  if (typeof normal === 'number') {
    return {
      x: x + Math.cos(normal) * dist,
      y: y + Math.sin(normal) * dist,
    }
  }
  const dx = x - SQUARE_CENTER.x
  const dy = y - SQUARE_CENTER.y
  const length = Math.hypot(dx, dy) || 1
  return {
    x: x + (dx / length) * dist,
    y: y + (dy / length) * dist,
  }
}

function BombBurst({ x, y, burstKey }: { x: number; y: number; burstKey: number }) {
  return (
    <g className="bomb-burst" key={burstKey} transform={`translate(${x} ${y})`}>
      <circle className="bomb-burst-flash" r={10} />
      <circle className="bomb-burst-ring" r={14} />
      <circle className="bomb-burst-ring bomb-burst-ring--late" r={18} />
      {Array.from({ length: 8 }, (_, index) => {
        const angle = (Math.PI * 2 * index) / 8
        return (
          <circle
            key={index}
            className="bomb-burst-spark"
            r={3.2}
            style={{
              ['--spark-x' as string]: `${Math.cos(angle) * 28}px`,
              ['--spark-y' as string]: `${Math.sin(angle) * 28}px`,
            }}
          />
        )
      })}
    </g>
  )
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
    type === 'spring' ||
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
  const [burst, setBurst] = useState<{ cell: number; key: number } | null>(null)
  const pending = room.game?.pendingPower

  useEffect(() => {
    if (pending?.type !== 'bomb' || !pending.strippedShield) return
    setBurst({ cell: pending.landingCell, key: Date.now() })
    const timer = window.setTimeout(() => setBurst(null), 900)
    return () => window.clearTimeout(timer)
  }, [pending?.type, pending?.landingCell, pending?.playerId, pending?.tokenId, pending?.strippedShield])

  if (!hasPowerBoard(room.gameMode) || !room.game?.powerTiles) return null

  sanitizePowerTiles(room.game.powerTiles, getBoardPlayerCount(room), {
    relocateFivePlayerLayout: room.gameMode !== 'race',
  })

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
          if (type === 'bomb') {
            const outside = bombOffset(position.x, position.y, GRID_SIZE)
            return (
              <g key={`${cell}-${type}`} className="bomb-anchor">
                <line
                  className="bomb-leash"
                  x1={position.x}
                  y1={position.y}
                  x2={outside.x}
                  y2={outside.y}
                />
                <PowerMarker
                  x={outside.x}
                  y={outside.y}
                  type={type}
                  cellSize={GRID_SIZE * 0.72}
                />
              </g>
            )
          }
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
        if (type === 'bomb') {
          const outside = bombOffset(
            trackCell.point.x,
            trackCell.point.y,
            polygonGeometry.cellSize,
            trackCell.normal,
          )
          return (
            <g key={`${cell}-${type}`} className="bomb-anchor">
              <line
                className="bomb-leash"
                x1={trackCell.point.x}
                y1={trackCell.point.y}
                x2={outside.x}
                y2={outside.y}
              />
              <PowerMarker
                x={outside.x}
                y={outside.y}
                type={type}
                rotation={rotation}
                cellSize={polygonGeometry.cellSize * 0.72}
              />
            </g>
          )
        }
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
      {burst
        ? (() => {
            if (isSquare) {
              const position = FOUR_TRACK[burst.cell]
              if (!position) return null
              const outside = bombOffset(position.x, position.y, GRID_SIZE)
              return (
                <BombBurst x={outside.x} y={outside.y} burstKey={burst.key} />
              )
            }
            if (!polygonGeometry) return null
            const trackCell = polygonTrackPoint(polygonGeometry, burst.cell)
            const outside = bombOffset(
              trackCell.point.x,
              trackCell.point.y,
              polygonGeometry.cellSize,
              trackCell.normal,
            )
            return (
              <BombBurst x={outside.x} y={outside.y} burstKey={burst.key} />
            )
          })()
        : null}
    </g>
  )
}
