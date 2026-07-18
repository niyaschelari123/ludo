import { useEffect, useState } from 'react'
import { playEnter, playStep } from '../audio'
import {
  CELLS_PER_PLAYER,
  HOME_LENGTH,
  finishedProgress,
  globalCell,
  homeEntryProgress,
  movableTokens,
  safeCells,
  trackLength,
} from '../game/engine'
import type { PlayerColor, Room, Token } from '../game/types'

const SIZE = 600
const CENTER = SIZE / 2
const COLORS: Record<PlayerColor, string> = {
  red: '#ed1c24',
  green: '#00a651',
  yellow: '#ffd400',
  blue: '#0095da',
  orange: '#f58220',
  purple: '#92278f',
  cyan: '#00bcd4',
  pink: '#ec407a',
}

interface Point {
  x: number
  y: number
}

const point = (radius: number, angle: number): Point => ({
  x: CENTER + Math.cos(angle) * radius,
  y: CENTER + Math.sin(angle) * radius,
})

const pointList = (items: Point[]) =>
  items.map(({ x, y }) => `${x},${y}`).join(' ')

const GRID_SIZE = 32
const GRID_OFFSET = 60
const gridPoint = (row: number, col: number): Point => ({
  x: GRID_OFFSET + col * GRID_SIZE + GRID_SIZE / 2,
  y: GRID_OFFSET + row * GRID_SIZE + GRID_SIZE / 2,
})

// The classic 52-cell cross track, beginning at the red start and moving clockwise.
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

const FOUR_YARD_ORIGINS = [
  { x: 60, y: 60 },
  { x: 348, y: 60 },
  { x: 348, y: 348 },
  { x: 60, y: 348 },
]

const FOUR_YARDS: Point[][] = FOUR_YARD_ORIGINS.map(({ x, y }) => [
  { x: x + 68, y: y + 68 },
  { x: x + 124, y: y + 68 },
  { x: x + 68, y: y + 124 },
  { x: x + 124, y: y + 124 },
])

function boardStartAngle(count: number) {
  return count === 4 ? (-Math.PI * 3) / 4 : -Math.PI / 2
}

function radialCellAngle(cell: number, count: number) {
  return boardStartAngle(count) + (cell / (count * CELLS_PER_PLAYER)) * Math.PI * 2
}

function radialYardPoint(seat: number, tokenId: number, count: number): Point {
  const angle = radialCellAngle(seat * CELLS_PER_PLAYER, count)
  const offsets = [[-18, -17], [18, -17], [-18, 17], [18, 17]]
  const yard = point(242, angle)
  const [tangent, radial] = offsets[tokenId]
  return {
    x: yard.x + Math.cos(angle) * radial - Math.sin(angle) * tangent,
    y: yard.y + Math.sin(angle) * radial + Math.cos(angle) * tangent,
  }
}

function radialTokenPoint(token: Token, room: Room): Point {
  const count = room.players.length
  const player = room.players.find((candidate) => candidate.id === token.playerId)!
  const angle = radialCellAngle(player.seat * CELLS_PER_PLAYER, count)
  const homeEntry = homeEntryProgress(room.players)

  if (token.progress === -1) {
    return radialYardPoint(player.seat, token.id, count)
  }
  if (token.progress >= finishedProgress(room.players)) {
    return point(21 + token.id * 4, angle + (token.id - 1.5) * 0.13)
  }
  if (token.progress >= homeEntry) {
    return point(156 - (token.progress - homeEntry) * 18, angle)
  }
  return point(194, radialCellAngle(globalCell(token, room.players)!, count))
}

function squareTokenPoint(token: Token, room: Room): Point {
  const player = room.players.find((candidate) => candidate.id === token.playerId)!
  const homeEntry = homeEntryProgress(room.players)
  if (token.progress === -1) return FOUR_YARDS[player.seat][token.id]
  if (token.progress >= finishedProgress(room.players)) {
    return {
      x: CENTER + (token.id % 2 === 0 ? -8 : 8),
      y: CENTER + (token.id < 2 ? -8 : 8),
    }
  }
  if (token.progress >= homeEntry) {
    return FOUR_HOME_LANES[player.seat][token.progress - homeEntry]
  }
  return FOUR_TRACK[globalCell(token, room.players)!]
}

function SquareBoard({ room }: { room: Room }) {
  const safe = safeCells(room.players)
  return (
    <>
      <rect x="60" y="60" width="480" height="480" className="square-board-bg" />
      {room.players.map((player) => {
        const position = FOUR_YARD_ORIGINS[player.seat]
        return (
          <g key={player.id}>
            <rect x={position.x} y={position.y} width="192" height="192" fill={COLORS[player.color]} />
            <rect x={position.x + 34} y={position.y + 34} width="124" height="124" rx="8" className="yard-inner" />
            {FOUR_YARDS[player.seat].map((slot, index) => (
              <circle
                key={index}
                cx={slot.x}
                cy={slot.y}
                r="18"
                fill="#fff"
                stroke={COLORS[player.color]}
                className="yard-slot"
              />
            ))}
          </g>
        )
      })}

      {FOUR_TRACK.map((cell, index) => {
        const owner = room.players.find(
          (player) => player.seat * CELLS_PER_PLAYER === index,
        )
        return (
          <g key={index}>
            <rect
              x={cell.x - 16}
              y={cell.y - 16}
              width="32"
              height="32"
              fill={owner ? COLORS[owner.color] : '#fff'}
              className="square-cell"
            />
            {safe.has(index) && !owner && (
              <text x={cell.x} y={cell.y + 7} textAnchor="middle" className="safe-star">☆</text>
            )}
          </g>
        )
      })}

      {room.players.map((player) =>
        FOUR_HOME_LANES[player.seat].map((cell, index) => (
          <rect
            key={`${player.id}-${index}`}
            x={cell.x - 16}
            y={cell.y - 16}
            width="32"
            height="32"
            fill={COLORS[player.color]}
            className="square-cell"
          />
        )),
      )}

      {room.players.map((player) => {
        const labels = [
          { x: 156, y: 82 }, { x: 444, y: 82 },
          { x: 444, y: 526 }, { x: 156, y: 526 },
        ]
        return <text key={player.id} {...labels[player.seat]} textAnchor="middle" className="square-player-label">{player.name}</text>
      })}

      <polygon points="252,252 348,252 300,300" fill={COLORS[room.players[1].color]} className="center-triangle" />
      <polygon points="348,252 348,348 300,300" fill={COLORS[room.players[2].color]} className="center-triangle" />
      <polygon points="348,348 252,348 300,300" fill={COLORS[room.players[3].color]} className="center-triangle" />
      <polygon points="252,348 252,252 300,300" fill={COLORS[room.players[0].color]} className="center-triangle" />
    </>
  )
}

function RadialBoard({ room }: { room: Room }) {
  const count = room.players.length
  const sector = (Math.PI * 2) / count
  const safe = safeCells(room.players)
  const total = trackLength(room.players)
  const cellSize = count >= 7 ? 13 : count === 6 ? 15 : 17

  return (
    <>
      <polygon
        points={pointList(Array.from({ length: count }, (_, index) =>
          point(292, boardStartAngle(count) + index * sector),
        ))}
        className="radial-board-bg"
      />
      {room.players.map((player) => {
        const angle = radialCellAngle(player.seat * CELLS_PER_PLAYER, count)
        const outerLeft = point(289, angle - sector * 0.48)
        const outerRight = point(289, angle + sector * 0.48)
        const centerLeft = point(45, angle - sector * 0.17)
        const centerRight = point(45, angle + sector * 0.17)
        const yardLeft = point(278, angle - sector * 0.32)
        const yardRight = point(278, angle + sector * 0.32)
        const yardTip = point(177, angle)
        const label = point(273, angle)

        return (
          <g key={player.id}>
            <polygon
              points={pointList([outerLeft, outerRight, centerRight, centerLeft])}
              fill={COLORS[player.color]}
              className="radial-sector"
            />
            <polygon
              points={pointList([yardLeft, yardRight, yardTip])}
              className="radial-yard"
            />
            {Array.from({ length: 4 }, (_, tokenId) => {
              const slot = radialYardPoint(player.seat, tokenId, count)
              return (
                <circle
                  key={tokenId}
                  cx={slot.x}
                  cy={slot.y}
                  r={count >= 7 ? 12 : 15}
                  fill="#fff"
                  stroke={COLORS[player.color]}
                  className="yard-slot"
                />
              )
            })}
            <text x={label.x} y={label.y + 4} textAnchor="middle" className="player-label">{player.name}</text>
            {Array.from({ length: HOME_LENGTH }, (_, index) => {
              const lane = point(156 - index * 18, angle)
              return (
                <rect
                  key={index}
                  x={lane.x - cellSize / 2}
                  y={lane.y - cellSize / 2}
                  width={cellSize}
                  height={cellSize}
                  fill={COLORS[player.color]}
                  className="radial-cell"
                  transform={`rotate(${angle * 180 / Math.PI + 90} ${lane.x} ${lane.y})`}
                />
              )
            })}
          </g>
        )
      })}

      {Array.from({ length: total }, (_, index) => {
        const angle = radialCellAngle(index, count)
        const cell = point(194, angle)
        const owner = room.players.find(
          (player) => player.seat * CELLS_PER_PLAYER === index,
        )
        return (
          <g key={index}>
            <rect
              x={cell.x - cellSize / 2}
              y={cell.y - cellSize / 2}
              width={cellSize}
              height={cellSize}
              rx="1"
              fill={owner ? COLORS[owner.color] : '#fff'}
              className="radial-cell"
              transform={`rotate(${angle * 180 / Math.PI + 90} ${cell.x} ${cell.y})`}
            />
            {safe.has(index) && !owner && (
              <text x={cell.x} y={cell.y + 4} textAnchor="middle" className="radial-star">☆</text>
            )}
          </g>
        )
      })}

      <polygon
        points={pointList(Array.from({ length: count }, (_, index) =>
          point(46, boardStartAngle(count) + index * sector),
        ))}
        className="radial-finish"
      />
      <circle cx={CENTER} cy={CENTER} r="16" className="finish-center" />
      <text x={CENTER} y={CENTER + 6} textAnchor="middle" className="crown">★</text>
    </>
  )
}

interface Props {
  room: Room
  userId: string
  movingToken: { id: number; fromProgress: number; dice: number } | null
  onMove: (tokenId: number) => void
}

export function LudoBoard({ room, userId, movingToken, onMove }: Props) {
  const isSquare = room.players.length === 4
  const [animatedProgress, setAnimatedProgress] = useState<number | null>(null)
  const movable = new Set(
    movableTokens(room)
      .filter((token) => token.playerId === userId)
      .map((token) => token.id),
  )

  useEffect(() => {
    if (!movingToken) {
      setAnimatedProgress(null)
      return
    }

    const target =
      movingToken.fromProgress === -1
        ? 0
        : movingToken.fromProgress + movingToken.dice
    setAnimatedProgress(movingToken.fromProgress)

    const timer = window.setInterval(() => {
      setAnimatedProgress((current) => {
        if (current === null) return movingToken.fromProgress
        const next = current === -1 ? 0 : current + 1
        if (current === -1) playEnter()
        else playStep()
        if (next >= target) {
          window.clearInterval(timer)
          return target
        }
        return next
      })
    }, 135)

    return () => window.clearInterval(timer)
  }, [movingToken])

  const displayedTokens = (room.game?.tokens ?? []).map((originalToken) => {
    const player = room.players.find(
      (candidate) => candidate.id === originalToken.playerId,
    )!
    const isMoving =
      originalToken.playerId === userId &&
      originalToken.id === movingToken?.id
    const token: Token =
      isMoving && animatedProgress !== null
        ? { ...originalToken, progress: animatedProgress }
        : originalToken
    const position = isSquare
      ? squareTokenPoint(token, room)
      : radialTokenPoint(token, room)
    const canSelect =
      movingToken === null &&
      originalToken.playerId === userId &&
      movable.has(originalToken.id)

    return { originalToken, player, position, isMoving, canSelect }
  })

  const positionGroups = new Map<string, typeof displayedTokens>()
  displayedTokens.forEach((token) => {
    const key = `${Math.round(token.position.x)}:${Math.round(token.position.y)}`
    const group = positionGroups.get(key) ?? []
    group.push(token)
    positionGroups.set(key, group)
  })

  return (
    <div className={`board-wrap ${isSquare ? 'square' : 'radial'}`}>
      <svg className="ludo-board" viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label={`${room.players.length} player Ludo board`}>
        {isSquare ? <SquareBoard room={room} /> : <RadialBoard room={room} />}

        {displayedTokens.map(
          ({ originalToken, player, position, isMoving, canSelect }) => {
          const groupKey = `${Math.round(position.x)}:${Math.round(position.y)}`
          const group = positionGroups.get(groupKey)!
          const groupIndex = group.findIndex(
            (candidate) =>
              candidate.originalToken.playerId === originalToken.playerId &&
              candidate.originalToken.id === originalToken.id,
          )
          const stacked = group.length > 1
          const tokenRadius =
            !stacked ? 13 : group.length <= 4 ? 8 : group.length <= 9 ? 5 : 4
          const angle =
            group.length === 2
              ? groupIndex * Math.PI
              : (groupIndex / group.length) * Math.PI * 2 - Math.PI / 2
          const columns = Math.ceil(Math.sqrt(group.length))
          const rows = Math.ceil(group.length / columns)
          const column = groupIndex % columns
          const row = Math.floor(groupIndex / columns)
          const gridGap = tokenRadius * 1.8
          const offsetX =
            !stacked
              ? 0
              : group.length <= 4
                ? Math.cos(angle) * 8
                : (column - (columns - 1) / 2) * gridGap
          const offsetY =
            !stacked
              ? 0
              : group.length <= 4
                ? Math.sin(angle) * 8
                : (row - (rows - 1) / 2) * gridGap

          return (
            <g
              key={`${originalToken.playerId}-${originalToken.id}`}
              className={`token ${stacked ? 'stacked' : ''} ${canSelect ? 'movable' : ''} ${isMoving ? 'moving' : ''}`}
              style={{
                transform: `translate(${position.x + offsetX}px, ${position.y + offsetY}px)`,
              }}
              onClick={() => canSelect && onMove(originalToken.id)}
              role={canSelect ? 'button' : undefined}
            >
              <circle r={tokenRadius} fill={COLORS[player.color]} />
              <circle r={Math.max(2.2, tokenRadius * 0.38)} fill="#fff" />
            </g>
          )
        })}
      </svg>
    </div>
  )
}
