import type { CSSProperties } from 'react'
import {
  buildElimPairLeaders,
  formatCareerFinishTime,
  sortCareerBoard,
  sortCareerBoardAscending,
  sortUltimateBoard,
  ultimateScore,
  ULTIMATE_MOTM_POINTS,
  ULTIMATE_WIN_POINTS,
  ULTIMATE_WORST_PENALTY,
  type CareerBoardEntry,
  type CareerStatKey,
  type ElimPairLeader,
} from '../lib/profileCloud'
import { isNamedPlayerColor, resolveColorHex } from '../game/colors'
import type { Room } from '../game/types'

function playerColorClass(color: string) {
  return isNamedPlayerColor(color) ? color : 'custom-color'
}

function playerColorStyle(color: string): CSSProperties | undefined {
  return isNamedPlayerColor(color)
    ? undefined
    : ({ ['--player' as string]: resolveColorHex(color) } as CSSProperties)
}

export function formatCareerMotmPoints(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

export function CareerLobbyBoard({
  title,
  board,
  roomPlayers = [],
  statKey,
  formatCount,
  className = '',
  sortEntries,
  formatEntry,
}: {
  title: string
  board: CareerBoardEntry[] | null
  roomPlayers?: Room['players']
  statKey: CareerStatKey
  formatCount: (value: number) => string
  className?: string
  sortEntries?: (board: CareerBoardEntry[]) => CareerBoardEntry[]
  formatEntry?: (entry: CareerBoardEntry) => string
}) {
  const ranked = board
    ? (sortEntries ?? ((list) => sortCareerBoard(list, statKey)))(board)
    : null
  const hasRoomContext = roomPlayers.length > 0
  return (
    <aside className={`lobby-wins-board lobby-stat-board ${className}`.trim()}>
      <h3>{title}</h3>
      {ranked === null ? (
        <p className="lobby-wins-loading">Loading…</p>
      ) : (
        <ol className="lobby-wins-list">
          {ranked.map((entry, index) => {
            const inRoom = roomPlayers.some(
              (player) => player.id === entry.accountId,
            )
            const value = entry[statKey] ?? 0
            return (
              <li
                key={`${statKey}-${entry.accountId}`}
                className={`lobby-wins-row ${playerColorClass(entry.color)} ${hasRoomContext ? (inRoom ? 'in-room' : 'away') : 'in-room'}`}
                style={playerColorStyle(entry.color)}
              >
                <span className="lobby-wins-rank">#{index + 1}</span>
                <span className="lobby-wins-avatar">
                  {entry.name[0]?.toUpperCase() ?? '?'}
                </span>
                <div className="lobby-wins-meta">
                  <strong className="lobby-wins-name">{entry.name}</strong>
                  {hasRoomContext ? (
                    <small>{inRoom ? 'In room' : 'Not joined'}</small>
                  ) : null}
                </div>
                <em className="lobby-wins-count">
                  {formatEntry ? formatEntry(entry) : formatCount(value)}
                </em>
              </li>
            )
          })}
        </ol>
      )}
    </aside>
  )
}

export function CareerElimPairsBoard({
  board,
  roomPlayers = [],
  limit = 8,
}: {
  board: CareerBoardEntry[] | null
  roomPlayers?: Room['players']
  limit?: number
}) {
  const leaders: ElimPairLeader[] | null = board
    ? buildElimPairLeaders(board, limit)
    : null
  const hasRoomContext = roomPlayers.length > 0
  return (
    <aside className="lobby-wins-board lobby-stat-board lobby-elim-pairs-board">
      <h3>Who eliminated whom (most)</h3>
      {leaders === null ? (
        <p className="lobby-wins-loading">Loading…</p>
      ) : leaders.length === 0 ? (
        <p className="lobby-wins-loading">No eliminations yet</p>
      ) : (
        <ol className="lobby-wins-list">
          {leaders.map((entry, index) => {
            const attackerInRoom = roomPlayers.some(
              (player) => player.id === entry.attackerId,
            )
            return (
              <li
                key={`${entry.attackerId}-${entry.victimId}`}
                className={`lobby-wins-row ${playerColorClass(entry.attackerColor)} ${hasRoomContext ? (attackerInRoom ? 'in-room' : 'away') : 'in-room'}`}
                style={playerColorStyle(entry.attackerColor)}
              >
                <span className="lobby-wins-rank">#{index + 1}</span>
                <div className="lobby-wins-meta lobby-elim-pair-meta">
                  <strong className="lobby-wins-name">
                    {entry.attackerName}
                    <span className="lobby-elim-vs"> → </span>
                    {entry.victimName}
                  </strong>
                  {hasRoomContext ? (
                    <small>
                      {attackerInRoom ? 'Attacker in room' : 'Career total'}
                    </small>
                  ) : null}
                </div>
                <em className="lobby-wins-count">×{entry.count}</em>
              </li>
            )
          })}
        </ol>
      )}
    </aside>
  )
}

/** Full career “most …” boards in lobby order: MotM | Wins, Ultimate, then the rest. */
export function MostStatsPanels({
  board,
  roomPlayers = [],
}: {
  board: CareerBoardEntry[] | null
  roomPlayers?: Room['players']
}) {
  return (
    <div className="lobby-stack lobby-stack--career most-stats-stack">
      <section className="lobby lobby--with-wins most-stats-top" aria-label="Career MotM and wins">
        <CareerLobbyBoard
          className="lobby-motm-board"
          title="Career MotM"
          board={board}
          roomPlayers={roomPlayers}
          statKey="motm"
          formatCount={(value) => `${value} MotM`}
        />
        <div className="most-stats-top-center" aria-hidden="true" />
        <CareerLobbyBoard
          title="Career wins"
          board={board}
          roomPlayers={roomPlayers}
          statKey="wins"
          formatCount={(value) => `${value} ${value === 1 ? 'win' : 'wins'}`}
        />
      </section>

      <section className="lobby-career-more" aria-label="More career stats">
        <div className="lobby-career-featured">
          <CareerLobbyBoard
            className="lobby-ultimate-board"
            title="Ultimate player"
            board={board}
            roomPlayers={roomPlayers}
            statKey="motmPoints"
            sortEntries={sortUltimateBoard}
            formatCount={(value) => `${formatCareerMotmPoints(value)} pts`}
            formatEntry={(entry) => {
              const motm = entry.motm ?? 0
              const wins = entry.wins ?? 0
              const worst = entry.worst ?? 0
              const total = ultimateScore(entry)
              const worstBit =
                worst > 0 ? ` − ${worst}×${ULTIMATE_WORST_PENALTY}` : ''
              return `${formatCareerMotmPoints(total)} (${motm}×${ULTIMATE_MOTM_POINTS} + ${wins}×${ULTIMATE_WIN_POINTS}${worstBit})`
            }}
          />
        </div>
        <div className="lobby-career-grid">
          <CareerLobbyBoard
            title="MotM points total"
            board={board}
            roomPlayers={roomPlayers}
            statKey="motmPoints"
            formatCount={(value) => `${formatCareerMotmPoints(value)} pts`}
          />
          <CareerLobbyBoard
            title="Matches played"
            board={board}
            roomPlayers={roomPlayers}
            statKey="matchesPlayed"
            formatCount={(value) =>
              `${value} ${value === 1 ? 'match' : 'matches'}`
            }
          />
          <CareerLobbyBoard
            title="Worst of the match"
            board={board}
            roomPlayers={roomPlayers}
            statKey="worst"
            formatCount={(value) => `${value}×`}
          />
          <CareerLobbyBoard
            title="Second place"
            board={board}
            roomPlayers={roomPlayers}
            statKey="second"
            formatCount={(value) => `${value}×`}
          />
          <CareerLobbyBoard
            title="Third place"
            board={board}
            roomPlayers={roomPlayers}
            statKey="third"
            formatCount={(value) => `${value}×`}
          />
          <CareerLobbyBoard
            title="Most eliminations"
            board={board}
            roomPlayers={roomPlayers}
            statKey="eliminations"
            formatCount={(value) => `${value}`}
          />
          <CareerLobbyBoard
            title="Most times eliminated"
            board={board}
            roomPlayers={roomPlayers}
            statKey="timesEliminated"
            formatCount={(value) => `${value}`}
          />
          <CareerLobbyBoard
            title="Most sixes"
            board={board}
            roomPlayers={roomPlayers}
            statKey="sixes"
            formatCount={(value) => `${value}`}
          />
          <CareerLobbyBoard
            title="Most Oonjaal"
            board={board}
            roomPlayers={roomPlayers}
            statKey="negativePowers"
            formatCount={(value) => `${value}`}
          />
          <CareerElimPairsBoard
            board={board}
            roomPlayers={roomPlayers}
            limit={8}
          />
          <CareerLobbyBoard
            title="Most Super ⚡"
            board={board}
            roomPlayers={roomPlayers}
            statKey="superPowers"
            formatCount={(value) => `${value}`}
          />
          <CareerLobbyBoard
            title="Most +3"
            board={board}
            roomPlayers={roomPlayers}
            statKey="plus3"
            formatCount={(value) => `${value}`}
          />
          <CareerLobbyBoard
            title="Fastest finish"
            board={board}
            roomPlayers={roomPlayers}
            statKey="bestFinishMs"
            sortEntries={(list) =>
              sortCareerBoardAscending(list, 'bestFinishMs')
            }
            formatCount={(value) => formatCareerFinishTime(value)}
          />
        </div>
      </section>
    </div>
  )
}
