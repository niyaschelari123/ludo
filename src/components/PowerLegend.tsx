import { powerInfoForMode, POWER_UP_ICONS } from '../game/powerUps'
import type { WinOddsEntry } from '../game/matchAwards'
import { isNamedPlayerColor, resolveColorHex } from '../game/colors'
import type { CSSProperties } from 'react'
import type { GameMode } from '../game/types'

function playerColorClass(color: string) {
  return isNamedPlayerColor(color) ? color : 'custom-color'
}

function playerColorStyle(color: string): CSSProperties | undefined {
  return isNamedPlayerColor(color)
    ? undefined
    : ({ ['--player' as string]: resolveColorHex(color) } as CSSProperties)
}

export function PowerLegend({
  showPowers = true,
  gameMode = 'power',
  winOdds = [],
}: {
  showPowers?: boolean
  gameMode?: GameMode | null
  winOdds?: WinOddsEntry[]
}) {
  const powerInfo = powerInfoForMode(gameMode)

  return (
    <div className="power-legend">
      {showPowers ? (
        <>
          <h3 className="power-legend-title">Power tiles</h3>
          <ul className="power-legend-list">
            {powerInfo.map(({ type, label, description }) => (
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

          <div className="motm-rules">
            <h3 className="power-legend-title motm-rules-title">Man of the Match</h3>
            <p>
              Awarded at the end of the game to the strongest overall performer — not always the winner.
            </p>
            <ul>
              <li>+3 per elimination</li>
              <li>+5 / +3 / +1 for 1st / 2nd / 3rd place</li>
              <li>+2 per token home</li>
              <li>+0.5 per six rolled</li>
              <li>−1 per time you were eliminated</li>
            </ul>
            <p>Highest score wins. Ties go to better finish place, then more eliminations.</p>
          </div>
        </>
      ) : null}

      {winOdds.length > 0 ? (
        <div className={`win-odds ${showPowers ? 'win-odds--after-powers' : ''}`}>
          <h3 className="power-legend-title">Win probability</h3>
          <p className="win-odds-note">
            Live race estimate from token progress — leaders pull ahead as they advance.
          </p>
          <ol className="win-odds-list">
            {winOdds.map((entry, index) => (
              <li
                key={entry.player.id}
                className={`win-odds-row ${playerColorClass(entry.player.color)}`}
                style={playerColorStyle(entry.player.color)}
              >
                <span className="win-odds-rank">{index + 1}</span>
                <span className="win-odds-name">{entry.player.name}</span>
                <span className="win-odds-bar-track" aria-hidden="true">
                  <span
                    className="win-odds-bar-fill"
                    style={{ width: `${Math.max(entry.percent, 0)}%` }}
                  />
                </span>
                <strong className="win-odds-pct">{entry.percent.toFixed(1)}%</strong>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </div>
  )
}
