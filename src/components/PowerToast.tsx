import { POWER_UP_ICONS, powerUpDescription, powerUpLabel } from '../game/powerUps'
import type { PowerUpType } from '../game/types'

interface PowerToastProps {
  type: PowerUpType
  playerName: string
  visible: boolean
}

export function PowerToast({ type, playerName, visible }: PowerToastProps) {
  if (!visible) return null

  return (
    <div className="power-toast" role="status" aria-live="polite">
      <div className={`power-toast-card power-toast-card--${type}`}>
        <span className="power-toast-icon" aria-hidden="true">
          {POWER_UP_ICONS[type]}
        </span>
        <div className="power-toast-copy">
          <strong>{powerUpLabel(type)}</strong>
          <span>{playerName} landed on a power tile</span>
          <small>{powerUpDescription(type)}</small>
        </div>
      </div>
    </div>
  )
}
