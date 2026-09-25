import type { CSSProperties } from 'react'
import { boardStartAngle } from '../game/boardGeometry'
import { isNamedPlayerColor, resolveColorHex } from '../game/colors'
import type { Player } from '../game/types'
import { PlayerAvatar } from './PlayerAvatar'

function playerColorClass(color: string) {
  return isNamedPlayerColor(color) ? color : 'custom-color'
}

function slotStyle(seat: number, playerCount: number, color: string): CSSProperties {
  const start = boardStartAngle(playerCount)
  const angle = start + (seat * 2 * Math.PI) / playerCount
  const radius = playerCount <= 4 ? 38 : 36
  const pos: CSSProperties = {
    left: `${50 + Math.cos(angle) * radius}%`,
    top: `${50 + Math.sin(angle) * radius}%`,
  }
  if (isNamedPlayerColor(color)) return pos
  return { ...pos, ['--player' as string]: resolveColorHex(color) }
}

export function SeatBoardMap({
  players,
  seatOrder,
  selectedIds,
  pendingIds,
  interactive,
  onSelect,
}: {
  players: Player[]
  seatOrder: string[]
  selectedIds: string[]
  pendingIds: string[]
  interactive: boolean
  onSelect?: (playerId: string) => void
}) {
  const count = seatOrder.length
  return (
    <div
      className={`seat-board-map ${count === 4 ? 'seat-board-map--4' : 'seat-board-map--n'}`}
      aria-label="Board seats"
    >
      <div className="seat-board-face" aria-hidden="true">
        <span className="seat-board-cross" />
        <span className="seat-board-home" />
      </div>
      {seatOrder.map((playerId, seat) => {
        const player = players.find((entry) => entry.id === playerId)
        if (!player) return null
        const selected = selectedIds.includes(playerId)
        const pending = pendingIds.includes(playerId)
        const className = [
          'seat-board-slot',
          playerColorClass(player.color),
          selected ? 'is-selected' : '',
          pending ? 'is-pending' : '',
          interactive ? 'is-interactive' : '',
        ]
          .filter(Boolean)
          .join(' ')
        return (
          <button
            key={`board-seat-${seat}-${playerId}`}
            type="button"
            className={className}
            style={slotStyle(seat, count, player.color)}
            disabled={!interactive}
            onClick={() => onSelect?.(playerId)}
          >
            <span className="seat-board-pos">Seat {seat + 1}</span>
            <PlayerAvatar
              name={player.name}
              photoUrl={player.photoUrl}
              className="avatar"
            />
            <strong>{player.name}</strong>
            {player.isBot ? <small>BOT</small> : null}
          </button>
        )
      })}
    </div>
  )
}
