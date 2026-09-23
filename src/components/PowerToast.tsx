import { POWER_UP_ICONS, powerUpDescription, powerUpLabel } from '../game/powerUps'
import type { PowerUpType } from '../game/types'

interface PowerToastProps {
  type: PowerUpType
  playerName: string
  visible: boolean
  /** When set, replaces the default “landed on…” line. */
  message?: string
  maxSuperUses?: number
}

export function PowerToast({
  type,
  playerName,
  visible,
  message,
  maxSuperUses,
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
              ? `Max ${maxSuperUses ?? 0} Super leaps — one per token`
              : powerUpDescription(type)}
          </small>
        </div>
      </div>
    </div>
  )
}
