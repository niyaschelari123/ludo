import { POWER_UP_ICONS, powerUpDescription, powerUpLabel, SUPER_USES_PER_GAME } from '../game/powerUps'
import type { PowerUpType } from '../game/types'

interface PowerToastProps {
  type: PowerUpType
  playerName: string
  visible: boolean
  /** When set, replaces the default “landed on…” line. */
  message?: string
}

export function PowerToast({
  type,
  playerName,
  visible,
  message,
}: PowerToastProps) {
  if (!visible) return null

  return (
    <div className="power-toast" role="status" aria-live="polite">
      <div className={`power-toast-card power-toast-card--${type}`}>
        <span className="power-toast-icon" aria-hidden="true">
          {POWER_UP_ICONS[type]}
        </span>
        <div className="power-toast-copy">
          <strong>{powerUpLabel(type)}</strong>
          <span>
            {message ?? `${playerName} landed on a power tile`}
          </span>
          <small>
            {message
              ? `Max ${SUPER_USES_PER_GAME} Super leaps per player each game`
              : powerUpDescription(type)}
          </small>
        </div>
      </div>
    </div>
  )
}
