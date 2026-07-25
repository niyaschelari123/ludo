import { useEffect, useLayoutEffect, useState } from 'react'
import { playEnter, playStep } from '../audio'
import {
  allSeatPlayers,
  CELLS_PER_PLAYER,
  finishedProgress,
  getBoardPlayerCount,
  globalCell,
  homeEntryProgress,
  homeLengthForBoard,
  movableTokens,
  safeCells,
} from '../game/engine'
import type { MovingToken, PlayerColor, Room, Token } from '../game/types'
import {
  resolveAnimationProgress,
} from '../game/types'
import { PowerUpLayer } from './PowerUpLayer'

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

const TOKEN_STYLES: Record<
  PlayerColor,
  { fill: string; rim: string; shine: string; glow: string }
> = {
  red: { fill: '#ed1c24', rim: '#9a1212', shine: '#ff6b6b', glow: '#ffb3b3' },
  green: { fill: '#00a651', rim: '#006b32', shine: '#4cd98a', glow: '#9dffc8' },
  yellow: { fill: '#ffd400', rim: '#c9a000', shine: '#fff1a0', glow: '#ffe9a0' },
  blue: { fill: '#0095da', rim: '#005f8f', shine: '#7fd4ff', glow: '#a8dcff' },
  orange: { fill: '#f58220', rim: '#b85a00', shine: '#ffc27a', glow: '#ffc899' },
  purple: { fill: '#92278f', rim: '#5f1a5d', shine: '#e08adf', glow: '#e8b0e8' },
  cyan: { fill: '#00bcd4', rim: '#007f96', shine: '#8cecff', glow: '#9ef4ff' },
  pink: { fill: '#ec407a', rim: '#a8325c', shine: '#ffb3cb', glow: '#ffb8d4' },
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

function boardSeatCount(room: Room) {
  return getBoardPlayerCount(room)
}

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

interface RadialLayout {
  outerRadius: number
  trackFieldRadius: number
  trackRadius: number
  yardRadius: number
  yardInnerRadius: number
  homeLaneStart: number
  homeLaneStep: number
  finishRadius: number
  labelRadius: number
  rankRadius: number
  cellSize: number
  yardTokenRadius: number
  sectorOuterSpan: number
  sectorInnerSpan: number
  yardSpan: number
  yardInnerSpan: number
  polygonBoard: boolean
  quadYard: boolean
}

function radialBoardLayout(count: number): RadialLayout {
  if (count === 6) {
    return {
      outerRadius: 292,
      trackFieldRadius: 216,
      trackRadius: 198,
      yardRadius: 282,
      yardInnerRadius: 222,
      homeLaneStart: 166,
      homeLaneStep: 22,
      finishRadius: 60,
      labelRadius: 286,
      rankRadius: 202,
      cellSize: 17,
      yardTokenRadius: 12,
      sectorOuterSpan: 0.48,
      sectorInnerSpan: 0.49,
      yardSpan: 0.31,
      yardInnerSpan: 0.3,
      polygonBoard: true,
      quadYard: true,
    }
  }
  if (count === 5) {
    return {
      outerRadius: 290,
      trackFieldRadius: 212,
      trackRadius: 196,
      yardRadius: 278,
      yardInnerRadius: 220,
      homeLaneStart: 168,
      homeLaneStep: 20,
      finishRadius: 58,
      labelRadius: 282,
      rankRadius: 200,
      cellSize: 18,
      yardTokenRadius: 12,
      sectorOuterSpan: 0.46,
      sectorInnerSpan: 0.47,
      yardSpan: 0.3,
      yardInnerSpan: 0.29,
      polygonBoard: true,
      quadYard: true,
    }
  }
  return {
    outerRadius: 292,
    trackFieldRadius: 45,
    trackRadius: 194,
    yardRadius: 278,
    yardInnerRadius: 177,
    homeLaneStart: 156,
    homeLaneStep: 18,
    finishRadius: 46,
    labelRadius: 273,
    rankRadius: 202,
    cellSize: count >= 7 ? 13 : 17,
    yardTokenRadius: count >= 7 ? 12 : 15,
    sectorOuterSpan: 0.48,
    sectorInnerSpan: 0.17,
    yardSpan: 0.31,
    yardInnerSpan: 0,
    polygonBoard: false,
    quadYard: false,
  }
}

function finishSlot(angle: number, tokenId: number): Point {
  const radialDistance = tokenId < 2 ? 20 : 36
  const tangentDistance = tokenId % 2 === 0 ? -7 : 7
  const base = point(radialDistance, angle)
  return {
    x: base.x - Math.sin(angle) * tangentDistance,
    y: base.y + Math.cos(angle) * tangentDistance,
  }
}

function radialYardPoint(seat: number, tokenId: number, count: number): Point {
  const layout = radialBoardLayout(count)
  const angle = radialCellAngle(seat * CELLS_PER_PLAYER, count)
  const offsets = layout.quadYard
    ? [
        [-20, -18],
        [20, -18],
        [-20, 18],
        [20, 18],
      ]
    : [
        [-18, -17],
        [18, -17],
        [-18, 17],
        [18, 17],
      ]
  const yard = point(layout.yardRadius, angle)
  const [tangent, radial] = offsets[tokenId]
  return {
    x: yard.x + Math.cos(angle) * radial - Math.sin(angle) * tangent,
    y: yard.y + Math.sin(angle) * radial + Math.cos(angle) * tangent,
  }
}

function radialTokenPoint(token: Token, room: Room): Point {
  const count = boardSeatCount(room)
  const layout = radialBoardLayout(count)
  const player = room.players.find((candidate) => candidate.id === token.playerId)!
  const angle = radialCellAngle(player.seat * CELLS_PER_PLAYER, count)
  const homeEntry = homeEntryProgress(room)

  if (token.progress === -1) {
    return radialYardPoint(player.seat, token.id, count)
  }
  if (token.progress >= finishedProgress(room)) {
    return finishSlot(angle, token.id)
  }
  if (token.progress >= homeEntry) {
    const homeStep = token.progress - homeEntry
    if (homeStep === 0) {
      return point(
        layout.trackRadius,
        radialCellAngle(player.seat * CELLS_PER_PLAYER, count),
      )
    }
    return point(
      layout.homeLaneStart - (homeStep - 1) * layout.homeLaneStep,
      angle,
    )
  }
  return point(
    layout.trackRadius,
    radialCellAngle(globalCell(token, room)!, count),
  )
}

function squareTokenPoint(token: Token, room: Room): Point {
  const player = allSeatPlayers(room).find(
    (candidate) => candidate.id === token.playerId,
  )!
  const homeEntry = homeEntryProgress(room)
  if (token.progress === -1) return FOUR_YARDS[player.seat][token.id]
  if (token.progress >= finishedProgress(room)) {
    const finishAngles = [Math.PI, -Math.PI / 2, 0, Math.PI / 2]
    return finishSlot(finishAngles[player.seat], token.id)
  }
  if (token.progress >= homeEntry) {
    const homeStep = token.progress - homeEntry
    if (homeStep === 0) {
      return FOUR_TRACK[player.seat * CELLS_PER_PLAYER]
    }
    return FOUR_HOME_LANES[player.seat][homeStep - 1]
  }
  return FOUR_TRACK[globalCell(token, room)!]
}

function tokenDisplayRadius(
  boardCount: number,
  isSquare: boolean,
  stacked: boolean,
  groupLength: number,
  isFinished: boolean,
  inYard: boolean,
) {
  if (isSquare) {
    if (!stacked) return isFinished ? 8 : 14
    if (groupLength <= 4) return 8
    if (groupLength <= 9) return 5
    return 4
  }

  const layout = radialBoardLayout(boardCount)
  if (inYard) {
    const yardFit = layout.yardTokenRadius * 0.66
    if (!stacked) return yardFit
    if (groupLength <= 4) return yardFit * 0.82
    return yardFit * 0.65
  }

  const cellFit = layout.cellSize * 0.44
  if (!stacked) return isFinished ? Math.min(7, cellFit) : cellFit
  if (groupLength <= 4) return cellFit * 0.8
  if (groupLength <= 9) return cellFit * 0.62
  return cellFit * 0.5
}

function TokenDisc({
  color,
  radius,
  finished,
}: {
  color: PlayerColor
  radius: number
  finished?: boolean
}) {
  const style = TOKEN_STYLES[color]
  const rim = Math.max(1.4, radius * 0.16)
  const body = Math.max(0, radius - rim * 0.45)
  const glowWidth = Math.max(1.2, radius * 0.14)

  return (
    <>
      <ellipse
        cx={radius * 0.04}
        cy={radius * 0.9}
        rx={radius * 0.78}
        ry={radius * 0.2}
        fill="rgba(0,0,0,0.3)"
      />
      <circle
        r={radius * 1.1}
        fill="none"
        stroke={style.glow}
        strokeWidth={glowWidth * 1.8}
        opacity={finished ? 0.28 : 0.42}
      />
      <circle
        r={radius}
        fill={style.fill}
        stroke={style.rim}
        strokeWidth={rim}
      />
      <circle
        r={body * 0.9}
        fill={style.fill}
        stroke="rgba(255,255,255,0.28)"
        strokeWidth={Math.max(0.8, radius * 0.07)}
      />
      <circle r={body * 0.72} fill={style.shine} opacity={finished ? 0.15 : 0.28} />
      <ellipse
        cx={-radius * 0.26}
        cy={-radius * 0.3}
        rx={radius * 0.32}
        ry={radius * 0.18}
        fill="#fff"
        opacity={finished ? 0.28 : 0.5}
      />
      <circle
        r={radius + glowWidth * 0.15}
        fill="none"
        stroke={style.glow}
        strokeWidth={glowWidth}
        opacity={finished ? 0.65 : 0.9}
      />
      <circle
        r={radius + glowWidth * 0.05}
        fill="none"
        stroke="rgba(255,255,255,0.9)"
        strokeWidth={Math.max(0.7, radius * 0.06)}
        opacity={finished ? 0.5 : 0.75}
      />
    </>
  )
}

function SquareBoard({ room }: { room: Room }) {
  const safe = safeCells(room)
  const boardPlayers = allSeatPlayers(room)
  return (
    <>
      <rect x="60" y="60" width="480" height="480" className="square-board-bg" />
      {boardPlayers.map((player) => {
        const position = FOUR_YARD_ORIGINS[player.seat]
        const place = room.game
          ? room.game.winnerIds.indexOf(player.id) + 1
          : 0
        return (
          <g key={player.id}>
            <rect x={position.x} y={position.y} width="192" height="192" fill={COLORS[player.color]} />
            <rect x={position.x + 34} y={position.y + 34} width="124" height="124" rx="8" className="yard-inner" />
            {place > 0 && (
              <g className="home-rank-badge">
                <circle
                  cx={position.x + 96}
                  cy={position.y + 96}
                  r="25"
                  fill={COLORS[player.color]}
                />
                <text
                  x={position.x + 96}
                  y={position.y + 104}
                  textAnchor="middle"
                  className="home-rank"
                >
                  #{place}
                </text>
              </g>
            )}
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
        const owner = boardPlayers.find(
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

      {boardPlayers.map((player) =>
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

      {boardPlayers.map((player) => {
        const labels = [
          { x: 156, y: 82 }, { x: 444, y: 82 },
          { x: 444, y: 526 }, { x: 156, y: 526 },
        ]
        const departed = (room.departedPlayers ?? []).some(
          (candidate) => candidate.id === player.id,
        )
        return (
          <text
            key={player.id}
            {...labels[player.seat]}
            textAnchor="middle"
            className={`square-player-label ${departed ? 'departed-label' : ''}`}
          >
            {departed ? `${player.name} (left)` : player.name}
          </text>
        )
      })}

      <polygon points="252,252 348,252 300,300" fill={COLORS[boardPlayers[1]?.color ?? 'green']} className="center-triangle" />
      <polygon points="348,252 348,348 300,300" fill={COLORS[boardPlayers[2]?.color ?? 'yellow']} className="center-triangle" />
      <polygon points="348,348 252,348 300,300" fill={COLORS[boardPlayers[3]?.color ?? 'blue']} className="center-triangle" />
      <polygon points="252,348 252,252 300,300" fill={COLORS[boardPlayers[0]?.color ?? 'red']} className="center-triangle" />
    </>
  )
}

function RadialBoard({ room }: { room: Room }) {
  const count = boardSeatCount(room)
  const boardPlayers = allSeatPlayers(room)
  const isFive = count === 5
  const isSix = count === 6
  const layout = radialBoardLayout(count)
  const sector = (Math.PI * 2) / count
  const total = count * CELLS_PER_PLAYER
  const lanes = homeLengthForBoard(boardSeatCount(room))
  const safe = safeCells(room)
  const boardClass = isSix ? 'six-board-bg' : isFive ? 'five-board-bg' : ''
  const sectorClass = isSix ? 'six-sector' : isFive ? 'five-sector' : ''
  const yardClass = isSix ? 'six-yard' : isFive ? 'five-yard' : ''
  const yardSlotClass = isSix ? 'six-yard-slot' : isFive ? 'five-yard-slot' : ''
  const trackCellClass = isSix ? 'six-track-cell' : isFive ? 'five-track-cell' : ''
  const homeCellClass = isSix ? 'six-home-cell' : isFive ? 'five-home-cell' : ''
  const starClass = isSix ? 'six-star' : isFive ? 'five-star' : ''
  const labelClass = isSix ? 'six-player-label' : isFive ? 'five-player-label' : ''
  const finishClass = isSix ? 'six-finish-sector' : 'five-finish-sector'

  return (
    <>
      <polygon
        points={pointList(Array.from({ length: count }, (_, index) =>
          point(layout.outerRadius, boardStartAngle(count) + index * sector),
        ))}
        className={`radial-board-bg ${boardClass}`}
      />
      {layout.polygonBoard && (
        <polygon
          points={pointList(Array.from({ length: count }, (_, index) =>
            point(layout.trackFieldRadius, boardStartAngle(count) + index * sector),
          ))}
          className={isSix ? 'six-track-field' : 'five-track-field'}
        />
      )}
      {boardPlayers.map((player) => {
        const angle = radialCellAngle(player.seat * CELLS_PER_PLAYER, count)
        const departed = (room.departedPlayers ?? []).some(
          (candidate) => candidate.id === player.id,
        )
        const place = room.game
          ? room.game.winnerIds.indexOf(player.id) + 1
          : 0
        const outerLeft = point(layout.outerRadius - 3, angle - sector * layout.sectorOuterSpan)
        const outerRight = point(layout.outerRadius - 3, angle + sector * layout.sectorOuterSpan)
        const centerLeft = point(
          layout.trackFieldRadius,
          angle - sector * layout.sectorInnerSpan,
        )
        const centerRight = point(
          layout.trackFieldRadius,
          angle + sector * layout.sectorInnerSpan,
        )
        const yardLeft = point(layout.yardRadius, angle - sector * layout.yardSpan)
        const yardRight = point(layout.yardRadius, angle + sector * layout.yardSpan)
        const yardInnerLeft = point(
          layout.yardInnerRadius,
          angle - sector * layout.yardInnerSpan,
        )
        const yardInnerRight = point(
          layout.yardInnerRadius,
          angle + sector * layout.yardInnerSpan,
        )
        const yardTip = point(layout.yardInnerRadius - 43, angle)
        const label = point(layout.labelRadius, angle)
        const rankPoint = point(layout.rankRadius, angle)

        return (
          <g key={player.id}>
            <polygon
              points={pointList([outerLeft, outerRight, centerRight, centerLeft])}
              fill={COLORS[player.color]}
              className={`radial-sector ${sectorClass}`}
            />
            <polygon
              points={pointList(
                layout.quadYard
                  ? [yardLeft, yardRight, yardInnerRight, yardInnerLeft]
                  : [yardLeft, yardRight, yardTip],
              )}
              className={`radial-yard ${yardClass}`}
            />
            {place > 0 && (
              <g className="home-rank-badge radial-rank-badge">
                <circle
                  cx={rankPoint.x}
                  cy={rankPoint.y}
                  r={count >= 7 ? 14 : 18}
                  fill={COLORS[player.color]}
                />
                <text
                  x={rankPoint.x}
                  y={rankPoint.y + 6}
                  textAnchor="middle"
                  className="home-rank radial-home-rank"
                >
                  #{place}
                </text>
              </g>
            )}
            {Array.from({ length: 4 }, (_, tokenId) => {
              const slot = radialYardPoint(player.seat, tokenId, count)
              return (
                <circle
                  key={tokenId}
                  cx={slot.x}
                  cy={slot.y}
                  r={layout.yardTokenRadius}
                  fill="#fff"
                  stroke={COLORS[player.color]}
                  className={`yard-slot ${yardSlotClass}`}
                />
              )
            })}
            <text
              x={label.x}
              y={label.y + 4}
              textAnchor="middle"
              className={`player-label ${labelClass} ${departed ? 'departed-label' : ''}`}
            >
              {departed ? `${player.name} (left)` : player.name}
            </text>
            {Array.from({ length: lanes }, (_, index) => {
              const lane = point(
                layout.homeLaneStart - index * layout.homeLaneStep,
                angle,
              )
              return (
                <rect
                  key={index}
                  x={lane.x - layout.cellSize / 2}
                  y={lane.y - layout.cellSize / 2}
                  width={layout.cellSize}
                  height={layout.cellSize}
                  fill={COLORS[player.color]}
                  className={`radial-cell ${homeCellClass}`}
                  transform={`rotate(${angle * 180 / Math.PI + 90} ${lane.x} ${lane.y})`}
                />
              )
            })}
          </g>
        )
      })}

      {Array.from({ length: total }, (_, index) => {
        const angle = radialCellAngle(index, count)
        const cell = point(layout.trackRadius, angle)
        const owner = boardPlayers.find(
          (player) => player.seat * CELLS_PER_PLAYER === index,
        )
        return (
          <g key={index}>
            <rect
              x={cell.x - layout.cellSize / 2}
              y={cell.y - layout.cellSize / 2}
              width={layout.cellSize}
              height={layout.cellSize}
              rx="1"
              fill={owner ? COLORS[owner.color] : '#fff'}
              className={`radial-cell ${trackCellClass}`}
              transform={`rotate(${angle * 180 / Math.PI + 90} ${cell.x} ${cell.y})`}
            />
            {safe.has(index) && !owner && (
              <text
                x={cell.x}
                y={cell.y + 4}
                textAnchor="middle"
                className={`radial-star ${starClass}`}
              >
                ★
              </text>
            )}
          </g>
        )
      })}

      {layout.polygonBoard
        ? boardPlayers.map((player) => {
            const angle = radialCellAngle(player.seat * CELLS_PER_PLAYER, count)
            return (
              <polygon
                key={`finish-${player.id}`}
                points={pointList([
                  { x: CENTER, y: CENTER },
                  point(layout.finishRadius, angle - sector / 2),
                  point(layout.finishRadius, angle + sector / 2),
                ])}
                fill={COLORS[player.color]}
                className={finishClass}
              />
            )
          })
        : (
          <polygon
            points={pointList(Array.from({ length: count }, (_, index) =>
              point(layout.finishRadius, boardStartAngle(count) + index * sector),
            ))}
            className="radial-finish"
          />
        )}
      <circle cx={CENTER} cy={CENTER} r="16" className="finish-center" />
      <text x={CENTER} y={CENTER + 6} textAnchor="middle" className="crown">★</text>
    </>
  )
}

interface Props {
  room: Room
  userId: string
  movingToken: MovingToken | null
  onMove: (tokenId: number) => void
}

export function LudoBoard({
  room,
  userId,
  movingToken,
  onMove,
}: Props) {
  const boardCount = boardSeatCount(room)
  const isSquare = boardCount === 4
  const isFive = boardCount === 5
  const isSix = boardCount === 6
  const [animatedProgress, setAnimatedProgress] = useState<number | null>(null)
  const moveAnimationKey = movingToken
    ? `${movingToken.playerId}:${movingToken.id}:${movingToken.fromProgress}:${movingToken.dice}:${movingToken.startedAt ?? ''}`
    : null
  const movable = new Set(
    movableTokens(room)
      .filter((token) => token.playerId === userId)
      .map((token) => token.id),
  )

  useLayoutEffect(() => {
    if (!movingToken) {
      setAnimatedProgress(null)
      return
    }
    const { progress, done, target } = resolveAnimationProgress(movingToken)
    setAnimatedProgress(done ? target : progress)
  }, [moveAnimationKey, movingToken])

  useEffect(() => {
    if (!movingToken) return

    let lastProgress: number | null = null
    const tick = () => {
      const { progress, done, target } = resolveAnimationProgress(movingToken)
      if (lastProgress !== null && progress !== lastProgress) {
        if (progress === -1 || lastProgress === -1) playEnter()
        else playStep()
      }
      lastProgress = done ? target : progress
      setAnimatedProgress(lastProgress)
      return done
    }

    tick()
    const timer = window.setInterval(() => {
      if (tick()) window.clearInterval(timer)
    }, 32)

    return () => window.clearInterval(timer)
  }, [moveAnimationKey, movingToken])

  const displayedTokens = (room.game?.tokens ?? []).map((originalToken) => {
    const player = room.players.find(
      (candidate) => candidate.id === originalToken.playerId,
    )!
    const isMoving =
      originalToken.playerId === movingToken?.playerId &&
      originalToken.id === movingToken?.id
    const token: Token = isMoving
      ? {
          ...originalToken,
          progress: animatedProgress ?? movingToken.fromProgress,
        }
      : originalToken
    const position = isSquare
      ? squareTokenPoint(token, room)
      : radialTokenPoint(token, room)
    const canSelect =
      movingToken === null &&
      originalToken.playerId === userId &&
      movable.has(originalToken.id)
    const isFinished =
      originalToken.progress >= finishedProgress(room)

    return {
      originalToken,
      player,
      position,
      isMoving,
      canSelect,
      isFinished,
    }
  })

  const positionGroups = new Map<string, typeof displayedTokens>()
  displayedTokens.forEach((token) => {
    const key = `${Math.round(token.position.x)}:${Math.round(token.position.y)}`
    const group = positionGroups.get(key) ?? []
    group.push(token)
    positionGroups.set(key, group)
  })

  return (
    <div className={`board-wrap ${isSquare ? 'square' : 'radial'} ${isFive ? 'five-player-board' : ''} ${isSix ? 'six-player-board' : ''}`}>
      <svg
        className="ludo-board"
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        role="img"
        aria-label={`${boardCount} player Ludo board`}
      >
        {isSquare ? (
          <SquareBoard room={room} />
        ) : (
          <RadialBoard room={room} />
        )}
        <PowerUpLayer room={room} />

        {displayedTokens.map(
          ({
            originalToken,
            player,
            position,
            isMoving,
            canSelect,
            isFinished,
          }) => {
            const groupKey = `${Math.round(position.x)}:${Math.round(position.y)}`
            const group = positionGroups.get(groupKey)!
            const groupIndex = group.findIndex(
              (candidate) =>
                candidate.originalToken.playerId === originalToken.playerId &&
                candidate.originalToken.id === originalToken.id,
            )
            const stacked = group.length > 1
            const inYard = originalToken.progress === -1
            const tokenRadius = tokenDisplayRadius(
              boardCount,
              isSquare,
              stacked,
              group.length,
              isFinished,
              inYard,
            )
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
                className={`token token--${player.color} ${isFinished ? 'finished' : ''} ${stacked ? 'stacked' : ''} ${canSelect ? 'movable' : ''} ${isMoving ? 'moving' : ''}`}
                style={{
                  transform: `translate(${position.x + offsetX}px, ${position.y + offsetY}px)`,
                }}
                onClick={() => canSelect && onMove(originalToken.id)}
                role={canSelect ? 'button' : undefined}
              >
                <TokenDisc
                  color={player.color}
                  radius={tokenRadius}
                  finished={isFinished}
                />
              </g>
            )
          })}
      </svg>
    </div>
  )
}
