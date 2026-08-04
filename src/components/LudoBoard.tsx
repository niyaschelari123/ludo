import { useEffect, useLayoutEffect, useMemo, useState } from 'react'
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
import {
  BOARD_SIZE,
  getPolygonBoardGeometry,
  pointList,
  polygonTrackPoint,
  type BoardGeometry,
  type Point,
} from '../game/boardGeometry'
import type { MovingToken, Room, Token } from '../game/types'
import { resolveColorHex, tokenStyleFor } from '../game/colors'
import {
  resolveAnimationProgress,
} from '../game/types'
import { PowerUpLayer } from './PowerUpLayer'

const SIZE = BOARD_SIZE
const CENTER = SIZE / 2

const point = (radius: number, angle: number): Point => ({
  x: CENTER + Math.cos(angle) * radius,
  y: CENTER + Math.sin(angle) * radius,
})

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

function finishSlot(angle: number, tokenId: number, finishRadius = 48): Point {
  const radialDistance = tokenId < 2 ? finishRadius * 0.38 : finishRadius * 0.68
  const tangentDistance = tokenId % 2 === 0 ? -7 : 7
  const base = point(radialDistance, angle)
  return {
    x: base.x - Math.sin(angle) * tangentDistance,
    y: base.y + Math.cos(angle) * tangentDistance,
  }
}

/** Park finished tokens strictly inside that seat's colored center triangle. */
function polygonFinishSlot(
  geometry: BoardGeometry,
  seat: number,
  tokenId: number,
): Point {
  const sector = geometry.sectors[seat]
  const [center, left, right] = sector.finishSector
  // Barycentric weights (center, left, right) — keep clear of sector edges.
  const nests: Array<[number, number, number]> = [
    [0.62, 0.22, 0.16],
    [0.62, 0.16, 0.22],
    [0.48, 0.28, 0.24],
    [0.48, 0.24, 0.28],
  ]
  const [wc, wl, wr] = nests[tokenId % 4]
  return {
    x: center.x * wc + left.x * wl + right.x * wr,
    y: center.y * wc + left.y * wl + right.y * wr,
  }
}

function polygonTokenPoint(token: Token, room: Room, geometry: BoardGeometry): Point {
  const player = allSeatPlayers(room).find(
    (candidate) => candidate.id === token.playerId,
  )!
  const sector = geometry.sectors[player.seat]
  const homeEntry = homeEntryProgress(room)
  const finished = finishedProgress(room)

  if (token.progress === -1) {
    return sector.yardSlots[token.id] ?? sector.yardSlots[0]
  }
  if (token.progress >= finished) {
    return polygonFinishSlot(geometry, player.seat, token.id)
  }
  if (token.progress >= homeEntry) {
    const homeStep = Math.min(
      geometry.homeLength - 1,
      Math.max(0, Math.floor(token.progress - homeEntry)),
    )
    return sector.homeLane[homeStep] ?? sector.homeLane[sector.homeLane.length - 1]
  }
  const cell = globalCell(token, room)
  if (cell === null) return geometry.center
  // Animate smoothly along the pentagon edge between integer cells.
  const progress = token.progress
  if (!Number.isInteger(progress) && progress >= 0) {
    const from = polygonTrackPoint(geometry, Math.floor(cell))
    const to = polygonTrackPoint(geometry, Math.ceil(cell) % geometry.trackCells.length)
    // globalCell already wraps; for partial steps lerp using fractional progress on relative path.
    const frac = progress - Math.floor(progress)
    return {
      x: from.point.x + (to.point.x - from.point.x) * frac,
      y: from.point.y + (to.point.y - from.point.y) * frac,
    }
  }
  return polygonTrackPoint(geometry, cell).point
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
    return FOUR_HOME_LANES[player.seat][homeStep]
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
  geometry?: BoardGeometry,
) {
  if (isSquare) {
    if (!stacked) return isFinished ? 8 : 14
    if (groupLength <= 4) return 8
    if (groupLength <= 9) return 5
    return 4
  }

  const yardTokenRadius = geometry?.yardTokenRadius ?? (boardCount >= 7 ? 12 : 13)
  const cellSize = geometry?.cellSize ?? (boardCount >= 7 ? 13 : 16)

  if (inYard) {
    const yardFit = yardTokenRadius * 0.9
    if (!stacked) return yardFit
    if (groupLength <= 4) return yardFit * 0.88
    return yardFit * 0.72
  }

  const cellFit = cellSize * 0.44
  if (isFinished) {
    // Keep home tokens small enough to stay inside their center color wedge.
    const finishFit = Math.min(11, (geometry?.finishPolygon[0]
      ? Math.hypot(
        geometry.finishPolygon[0].x - geometry.center.x,
        geometry.finishPolygon[0].y - geometry.center.y,
      ) * 0.11
      : 10))
    if (!stacked) return finishFit
    if (groupLength <= 4) return finishFit * 0.85
    return finishFit * 0.7
  }
  if (!stacked) return cellFit
  if (groupLength <= 4) return cellFit * 0.8
  if (groupLength <= 9) return cellFit * 0.62
  return cellFit * 0.5
}

function TokenDisc({
  color,
  radius,
  finished,
}: {
  color: string
  radius: number
  finished?: boolean
}) {
  const style = tokenStyleFor(color)
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
            <rect x={position.x} y={position.y} width="192" height="192" fill={resolveColorHex(player.color)} />
            <rect x={position.x + 34} y={position.y + 34} width="124" height="124" rx="8" className="yard-inner" />
            {place > 0 && (
              <g className="home-rank-badge">
                <circle
                  cx={position.x + 96}
                  cy={position.y + 96}
                  r="25"
                  fill={resolveColorHex(player.color)}
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
                stroke={resolveColorHex(player.color)}
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
            {safe.has(index) && !owner && (
              <rect
                x={cell.x - 17}
                y={cell.y - 17}
                width="34"
                height="34"
                rx="3"
                className="safe-cell-aura"
              />
            )}
            <rect
              x={cell.x - 16}
              y={cell.y - 16}
              width="32"
              height="32"
              fill={owner ? resolveColorHex(owner.color) : '#fff'}
              className={`square-cell ${safe.has(index) && !owner ? 'safe-cell' : ''}`}
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
            fill={resolveColorHex(player.color)}
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

      <polygon points="252,252 348,252 300,300" fill={resolveColorHex(boardPlayers[1]?.color ?? 'green')} className="center-triangle" />
      <polygon points="348,252 348,348 300,300" fill={resolveColorHex(boardPlayers[2]?.color ?? 'yellow')} className="center-triangle" />
      <polygon points="348,348 252,348 300,300" fill={resolveColorHex(boardPlayers[3]?.color ?? 'blue')} className="center-triangle" />
      <polygon points="252,348 252,252 300,300" fill={resolveColorHex(boardPlayers[0]?.color ?? 'red')} className="center-triangle" />
    </>
  )
}

function PolygonPlayerLabels({
  room,
  geometry,
}: {
  room: Room
  geometry: BoardGeometry
}) {
  const boardPlayers = allSeatPlayers(room)
  const largeNgon = geometry.playerCount >= 5 && geometry.playerCount <= 7

  return (
    <g className="polygon-player-labels" pointerEvents="none">
      {geometry.sectors.map((sector) => {
        const player = boardPlayers.find((candidate) => candidate.seat === sector.seat)
        if (!player) return null
        const departed = (room.departedPlayers ?? []).some(
          (candidate) => candidate.id === player.id,
        )
        return (
          <text
            key={player.id}
            x={sector.labelPoint.x}
            y={sector.labelPoint.y + 4}
            textAnchor="middle"
            className={`player-label ${largeNgon ? 'large-ngon-label' : ''} ${departed ? 'departed-label' : ''}`}
          >
            {departed ? `${player.name} (left)` : player.name}
          </text>
        )
      })}
    </g>
  )
}

function PolygonBoard({ room, geometry }: { room: Room; geometry: BoardGeometry }) {
  const count = geometry.playerCount
  const boardPlayers = allSeatPlayers(room)
  const largeNgon = count >= 5 && count <= 7
  const safe = safeCells(room)
  const boardClass = largeNgon ? 'large-ngon-bg' : ''
  const sectorClass = largeNgon ? 'large-ngon-sector' : ''
  const yardClass = largeNgon ? 'large-ngon-yard' : ''
  const yardSlotClass = largeNgon ? 'large-ngon-yard-slot' : ''
  const trackCellClass = largeNgon ? 'large-ngon-track-cell' : ''
  const homeCellClass = largeNgon ? 'large-ngon-home-cell' : ''
  const starClass = largeNgon ? 'large-ngon-star' : ''
  const finishClass = largeNgon ? 'large-ngon-finish-sector' : 'five-finish-sector'
  const cell = geometry.cellSize

  return (
    <>
      <polygon
        points={pointList(geometry.outerPolygon)}
        className={`radial-board-bg ${boardClass}`}
      />
      <polygon
        points={pointList(geometry.trackFieldPolygon)}
        className={largeNgon ? 'large-ngon-track-field' : 'radial-track-field'}
      />

      {geometry.sectors.map((sector) => {
        const player = boardPlayers.find((candidate) => candidate.seat === sector.seat)
        if (!player) return null
        const place = room.game
          ? room.game.winnerIds.indexOf(player.id) + 1
          : 0
        return (
          <g key={player.id}>
            <polygon
              points={pointList(sector.homePolygon)}
              fill={resolveColorHex(player.color)}
              className={`radial-sector ${sectorClass}`}
            />
            <polygon
              points={pointList(sector.yardPolygon)}
              className={`radial-yard ${yardClass}`}
            />
            {place > 0 && (
              <g className="home-rank-badge radial-rank-badge">
                <circle
                  cx={sector.rankPoint.x}
                  cy={sector.rankPoint.y}
                  r={largeNgon ? 18 : 14}
                  fill={resolveColorHex(player.color)}
                />
                <text
                  x={sector.rankPoint.x}
                  y={sector.rankPoint.y + 6}
                  textAnchor="middle"
                  className="home-rank radial-home-rank"
                >
                  #{place}
                </text>
              </g>
            )}
            {sector.yardSlots.map((slot, tokenId) => (
              <circle
                key={tokenId}
                cx={slot.x}
                cy={slot.y}
                r={geometry.yardTokenRadius}
                fill="#fff"
                stroke={resolveColorHex(player.color)}
                className={`yard-slot ${yardSlotClass}`}
              />
            ))}
            {sector.homeLane.map((lane, index) => (
              <rect
                key={`home-${index}`}
                x={lane.x - cell / 2}
                y={lane.y - cell / 2}
                width={cell}
                height={cell}
                fill={resolveColorHex(player.color)}
                className={`radial-cell ${homeCellClass}`}
                transform={`rotate(${(sector.angle * 180) / Math.PI + 90} ${lane.x} ${lane.y})`}
              />
            ))}
          </g>
        )
      })}

      {geometry.trackCells.map((trackCell) => {
        const owner = boardPlayers.find(
          (player) => player.seat * CELLS_PER_PLAYER === trackCell.index,
        )
        const rotation = (trackCell.tangent * 180) / Math.PI
        const { point: cellPoint } = trackCell
        return (
          <g key={trackCell.index}>
            {safe.has(trackCell.index) && !owner && (
              <rect
                x={cellPoint.x - cell / 2 - 1}
                y={cellPoint.y - cell / 2 - 1}
                width={cell + 2}
                height={cell + 2}
                rx="2"
                className="safe-cell-aura"
                transform={`rotate(${rotation} ${cellPoint.x} ${cellPoint.y})`}
              />
            )}
            <rect
              x={cellPoint.x - cell / 2}
              y={cellPoint.y - cell / 2}
              width={cell}
              height={cell}
              rx="3"
              fill={owner ? resolveColorHex(owner.color) : '#fff'}
              className={`radial-cell ${trackCellClass} ${safe.has(trackCell.index) && !owner ? 'safe-cell' : ''}`}
              transform={`rotate(${rotation} ${cellPoint.x} ${cellPoint.y})`}
            />
            {safe.has(trackCell.index) && !owner && (
              <text
                x={cellPoint.x}
                y={cellPoint.y + 4}
                textAnchor="middle"
                className={`radial-star ${starClass}`}
              >
                ★
              </text>
            )}
          </g>
        )
      })}

      {geometry.sectors.map((sector) => {
        const player = boardPlayers.find((candidate) => candidate.seat === sector.seat)
        return (
          <polygon
            key={`finish-${sector.seat}`}
            points={pointList(sector.finishSector)}
            fill={resolveColorHex(player?.color ?? 'red')}
            className={finishClass}
          />
        )
      })}
      <polygon
        points={pointList(geometry.finishPolygon)}
        className="pentagon-finish-ring"
      />
      <circle cx={geometry.center.x} cy={geometry.center.y} r="10" className="finish-center" />
      <text x={geometry.center.x} y={geometry.center.y + 4} textAnchor="middle" className="crown">★</text>
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
  const largeNgon = boardCount >= 5 && boardCount <= 7
  const geometry = useMemo(
    () =>
      isSquare
        ? null
        : getPolygonBoardGeometry(boardCount, homeLengthForBoard(boardCount)),
    [boardCount, isSquare],
  )
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
    const position = isSquare || !geometry
      ? squareTokenPoint(token, room)
      : polygonTokenPoint(token, room, geometry)
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
    <div className={`board-wrap ${isSquare ? 'square' : 'radial'} ${largeNgon ? 'large-ngon-board' : ''}`}>
      <svg
        className="ludo-board"
        viewBox={`0 0 ${geometry?.size ?? SIZE} ${geometry?.size ?? SIZE}`}
        role="img"
        aria-label={`${boardCount} player Ludo board`}
      >
        <defs>
          <filter
            id="safe-cell-neon-glow"
            x="-150%"
            y="-150%"
            width="400%"
            height="400%"
          >
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feFlood floodColor="#facc15" floodOpacity="1" result="color" />
            <feComposite in="color" in2="blur" operator="in" result="glow" />
            <feMerge>
              <feMergeNode in="glow" />
              <feMergeNode in="glow" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        {isSquare || !geometry ? (
          <SquareBoard room={room} />
        ) : (
          <PolygonBoard room={room} geometry={geometry} />
        )}
        <PowerUpLayer room={room} geometry={geometry} />

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
            // Finished tokens already have per-token slots inside their color wedge —
            // never fan them out or they'll spill onto neighboring sectors.
            const stacked = !isFinished && group.length > 1
            const inYard = originalToken.progress === -1
            const tokenRadius = tokenDisplayRadius(
              boardCount,
              isSquare,
              stacked,
              group.length,
              isFinished,
              inYard,
              geometry ?? undefined,
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
        {!isSquare && geometry ? (
          <PolygonPlayerLabels room={room} geometry={geometry} />
        ) : null}
      </svg>
    </div>
  )
}
