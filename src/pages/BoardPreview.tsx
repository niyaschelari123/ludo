import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { LudoBoard } from '../components/LudoBoard'
import { createPreviewRoom } from '../game/previewRoom'

interface BoardPreviewProps {
  playerCount: number
}

/**
 * Static board preview for tuning N-player layouts without a live match.
 * Uses the same LudoBoard component as the real game.
 */
export function BoardPreview({ playerCount }: BoardPreviewProps) {
  const room = useMemo(() => createPreviewRoom(playerCount), [playerCount])
  const previewUserId = room.players[0].id

  return (
    <main className="room-screen board-preview-screen">
      <header className="room-header">
        <div className="brand">
          <span className="brand-mark small">L</span> Board preview
        </div>
        <div className="room-code">
          <strong>{playerCount} players</strong>
          <span className="preview-tag">design mode</span>
        </div>
        <div className="header-actions">
          <Link className="text-button" to="/">
            Back to game
          </Link>
        </div>
      </header>

      <section className="preview-layout">
        <p className="preview-note">
          Edit <code>LudoBoard.tsx</code> or <code>App.css</code> — changes show
          here instantly. No match or server required.
        </p>
        <div className="game-center preview-board-center">
          <LudoBoard
            room={room}
            userId={previewUserId}
            movingToken={null}
            onMove={() => {}}
          />
        </div>
      </section>
    </main>
  )
}
