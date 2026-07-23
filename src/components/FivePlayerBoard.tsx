import {
  FIVE_CENTER,
  FIVE_CELL_SIZE,
  fivePlayerArmPanel,
  fivePlayerCellKey,
  fivePlayerCellRotation,
  fivePlayerGridPoint,
  fivePlayerHubRing,
  fivePlayerOuterRing,
  fivePlayerPocketAngle,
  fivePlayerSafeCells,
  fivePlayerTrackPoint,
  fivePlayerTrackSeat,
  fivePlayerYardCenter,
  fivePlayerYardPoint,
  fivePlayerYardTriangle,
} from './fivePlayerLayout'
import { CELLS_PER_PLAYER, homeLength } from '../game/engine'
import type { PlayerColor, Room } from '../game/types'

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

const pointList = (points: { x: number; y: number }[]) =>
  points.map(({ x, y }) => `${x},${y}`).join(' ')

const CELL_HALF = FIVE_CELL_SIZE / 2

function FivePlayerCell({
  seat,
  x,
  y,
  fill,
  className,
}: {
  seat: number
  x: number
  y: number
  fill: string
  className?: string
}) {
  const rotate = fivePlayerCellRotation(seat)
  return (
    <rect
      x={x - CELL_HALF}
      y={y - CELL_HALF}
      width={FIVE_CELL_SIZE}
      height={FIVE_CELL_SIZE}
      fill={fill}
      className={className}
      transform={`rotate(${rotate} ${x} ${y})`}
    />
  )
}

export function FivePlayerBoard({ room }: { room: Room }) {
  const safe = fivePlayerSafeCells(room.players)
  const total = room.players.length * CELLS_PER_PLAYER
  const hub = fivePlayerHubRing()

  // One rect per unique grid slot — prevents stacked/overlapping path cells.
  const trackCells = new Map<
    string,
    { cell: number; seat: number; x: number; y: number; fill: string }
  >()

  for (let cell = 0; cell < total; cell += 1) {
    const slotKey = fivePlayerCellKey(cell)
    if (trackCells.has(slotKey)) continue

    const position = fivePlayerTrackPoint(cell)
    const seat = fivePlayerTrackSeat(cell)
    const owner = room.players.find(
      (player) => player.seat * CELLS_PER_PLAYER === cell,
    )
    trackCells.set(slotKey, {
      cell,
      seat,
      x: position.x,
      y: position.y,
      fill: owner ? COLORS[owner.color] : '#fff',
    })
  }

  return (
    <>
      <polygon points={pointList(fivePlayerOuterRing())} className="five-board-outline" />

      {room.players.map((player) => (
        <g key={`arm-${player.id}`}>
          <polygon
            points={pointList(fivePlayerArmPanel(player.seat))}
            fill={COLORS[player.color]}
            className="five-arm-panel"
          />
          <polygon
            points={pointList(fivePlayerYardTriangle(player.seat))}
            className="five-yard-triangle"
            stroke={COLORS[player.color]}
          />

          {Array.from({ length: 4 }, (_, tokenId) => {
            const slot = fivePlayerYardPoint(player.seat, tokenId)
            return (
              <circle
                key={`yard-${player.seat}-${tokenId}`}
                cx={slot.x}
                cy={slot.y}
                r="10"
                fill="#fff"
                stroke={COLORS[player.color]}
                strokeWidth="2"
                className="five-yard-slot"
              />
            )
          })}

          <text
            x={fivePlayerYardCenter(player.seat).x}
            y={fivePlayerYardCenter(player.seat).y}
            textAnchor="middle"
            className="five-player-label"
            transform={`rotate(${(fivePlayerPocketAngle(player.seat) * 180) / Math.PI + 90} ${fivePlayerYardCenter(player.seat).x} ${fivePlayerYardCenter(player.seat).y})`}
          >
            {player.name}
          </text>
        </g>
      ))}

      {room.players.map((player) => {
        const laneCells = homeLength(room.players)
        return Array.from({ length: laneCells }, (_, index) => {
          const cell = fivePlayerGridPoint(player.seat, 0, laneCells - 1 - index)
          return (
            <FivePlayerCell
              key={`${player.id}-home-${index}`}
              seat={player.seat}
              x={cell.x}
              y={cell.y}
              fill={COLORS[player.color]}
              className="five-grid-cell home"
            />
          )
        })
      })}

      {[...trackCells.values()].map(({ cell, seat, x, y, fill }) => {
        const rotate = fivePlayerCellRotation(seat)
        const owner = room.players.find(
          (player) => player.seat * CELLS_PER_PLAYER === cell,
        )
        return (
          <g key={`track-${cell}`}>
            <FivePlayerCell
              seat={seat}
              x={x}
              y={y}
              fill={fill}
              className="five-grid-cell track"
            />
            {safe.has(cell) && !owner && (
              <text
                x={x}
                y={y + 5}
                textAnchor="middle"
                className="five-safe-star"
                transform={`rotate(${rotate} ${x} ${y})`}
              >
                ★
              </text>
            )}
          </g>
        )
      })}

      <polygon points={pointList(hub)} className="five-hub" />
      {room.players.map((player, index) => (
        <polygon
          key={`hub-${player.id}`}
          points={pointList([
            hub[index],
            hub[(index + 1) % hub.length],
            { x: FIVE_CENTER, y: FIVE_CENTER },
          ])}
          fill={COLORS[player.color]}
          className="five-hub-slice"
        />
      ))}
      <circle cx={FIVE_CENTER} cy={FIVE_CENTER} r="14" className="five-hub-center" />
    </>
  )
}
