import { POWER_UP_ICONS, POWER_UP_INFO } from '../game/powerUps'

export function PowerLegend() {
  return (
    <div className="power-legend">
      <h3 className="power-legend-title">Power tiles</h3>
      <ul className="power-legend-list">
        {POWER_UP_INFO.map(({ type, label, description }) => (
          <li key={type} className="power-legend-item">
            <span className={`power-legend-icon power-icon--${type}`} aria-hidden="true">
              {POWER_UP_ICONS[type]}
            </span>
            <span className="power-legend-copy">
              <strong>{label}</strong>
              <span>{description}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
