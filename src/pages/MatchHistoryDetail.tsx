import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  buildMatchCareerDeltas,
  fetchMatchHistoryById,
  formatMostLeaderValue,
  MOST_HISTORY_LABELS,
  type MatchHistoryCareerSnapshot,
  type MatchHistoryEntry,
} from '../lib/matchHistory'
import {
  addMatchDetailsToCareer,
  CAREER_STAT_KEY_LIST,
  type CareerStatKey,
} from '../lib/profileCloud'
import {
  isNamedPlayerColor,
  resolveColorHex,
} from '../game/colors'
import '../App.css'

function playerColorClass(color: string) {
  return isNamedPlayerColor(color) ? color : 'custom-color'
}

function playerColorStyle(color: string): CSSProperties | undefined {
  return isNamedPlayerColor(color)
    ? undefined
    : ({ ['--player' as string]: resolveColorHex(color) } as CSSProperties)
}

function placeLabel(place: number) {
  if (place === 1) return 'Winner'
  if (place === 2) return '2nd'
  if (place === 3) return '3rd'
  return `${place}th`
}

function formatSeatColorName(color: string) {
  if (isNamedPlayerColor(color)) {
    return color.charAt(0).toUpperCase() + color.slice(1)
  }
  return resolveColorHex(color).toUpperCase()
}

const MATCH_STAT_COLUMNS = [
  { key: 'place', label: 'Place' },
  { key: 'motmPoints', label: 'MotM pts' },
  { key: 'superPowers', label: 'Super ⚡' },
  { key: 'plus3', label: '+3' },
  { key: 'negativePowers', label: 'Oonjaal' },
  { key: 'sixes', label: 'Sixes' },
  { key: 'captures', label: 'Elims' },
  { key: 'eliminated', label: 'Eliminated' },
  { key: 'tokensHome', label: 'Home' },
  { key: 'shieldBreaks', label: 'Shield breaks' },
] as const

function snapshotLeaderIds(
  snapshot: MatchHistoryCareerSnapshot[],
  key: CareerStatKey,
) {
  if (snapshot.length === 0) return new Set<string>()
  const values = snapshot.map((entry) => entry[key] ?? 0)
  const best =
    key === 'bestFinishMs'
      ? Math.min(...values.filter((value) => value > 0))
      : Math.max(...values)
  if (!Number.isFinite(best) || best <= 0) return new Set<string>()
  return new Set(
    snapshot
      .filter((entry) => (entry[key] ?? 0) === best)
      .map((entry) => entry.accountId),
  )
}

export function MatchHistoryDetailPage() {
  const { roomId = '' } = useParams<{ roomId: string }>()
  const [entry, setEntry] = useState<MatchHistoryEntry | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [addOpen, setAddOpen] = useState(false)
  const [addBusy, setAddBusy] = useState(false)
  const [addMsg, setAddMsg] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    void fetchMatchHistoryById(roomId)
      .then((next) => {
        if (cancelled) return
        setEntry(next)
        if (!next) setError('That match history was not found.')
      })
      .catch((reason) => {
        if (cancelled) return
        setError(
          reason instanceof Error
            ? reason.message
            : 'Failed to load match history.',
        )
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [roomId])

  const standings = useMemo(() => {
    if (!entry) return []
    if (entry.ranking.length > 0) {
      return [...entry.ranking].sort((first, second) => first.place - second.place)
    }
    return entry.matchStats
      .filter((player) => player.place != null)
      .map((player) => ({
        accountId: player.accountId,
        name: player.name,
        color: player.color,
        place: player.place as number,
      }))
  }, [entry])

  const addDeltas = useMemo(
    () => (entry ? buildMatchCareerDeltas(entry) : []),
    [entry],
  )

  const snapshotLeaders = useMemo(() => {
    const map = {} as Record<CareerStatKey, Set<string>>
    if (!entry) return map
    for (const key of CAREER_STAT_KEY_LIST) {
      map[key] = snapshotLeaderIds(entry.careerSnapshot, key)
    }
    return map
  }, [entry])

  if (loading) {
    return (
      <main className="most-stats-screen">
        <p className="most-stats-loading">Loading match…</p>
      </main>
    )
  }

  if (!entry) {
    return (
      <main className="most-stats-screen">
        <header className="most-stats-header">
          <div className="brand">
            <span className="brand-mark small">L</span> Match details
          </div>
          <Link className="text-button" to="/">
            Back home
          </Link>
        </header>
        <p className="error">{error}</p>
      </main>
    )
  }

  const confirmAddMatch = () => {
    if (!entry || addBusy || addDeltas.length === 0) return
    setAddBusy(true)
    setAddMsg('')
    void addMatchDetailsToCareer(addDeltas)
      .then((written) => {
        setAddOpen(false)
        setAddMsg(
          written > 0
            ? `Added this match onto current Most stats for ${written} player${written === 1 ? '' : 's'}.`
            : 'Nothing to add from this match.',
        )
      })
      .catch((reason) => {
        setAddMsg(
          reason instanceof Error
            ? reason.message
            : 'Failed to add this match to current stats.',
        )
      })
      .finally(() => setAddBusy(false))
  }

  const when = entry.finishedAt
    ? new Date(entry.finishedAt).toLocaleString()
    : '—'

  return (
    <main className="most-stats-screen history-detail-screen">
      <header className="most-stats-header">
        <div className="brand">
          <span className="brand-mark small">L</span> {entry.gameModeLabel} ·{' '}
          {entry.code}
        </div>
        <p className="most-stats-sub">
          {when} · host {entry.hostName} · {entry.loginPlayerCount} login players
        </p>
        <div className="history-detail-header-actions">
          <Link className="text-button" to="/most-stats">
            Most stats
          </Link>
          <Link className="text-button" to="/">
            Back home
          </Link>
        </div>
      </header>

      {addMsg ? (
        <p
          className={
            addMsg.startsWith('Added')
              ? 'match-history-apply-ok history-detail-add-msg'
              : 'error history-detail-add-msg'
          }
        >
          {addMsg}{' '}
          {addMsg.startsWith('Added') ? (
            <Link to="/most-stats">Open statistics page</Link>
          ) : null}
        </p>
      ) : null}

      <section className="history-detail-body">
        <section className="history-detail-panel">
          <h2>Add to current stats</h2>
          <p className="history-detail-empty">
            Add this match’s places, MotM, Super, +3, and the rest on top of
            the numbers now on the Most stats page.
          </p>
          <button
            type="button"
            className="secondary-button match-history-full"
            disabled={addBusy || addDeltas.length === 0}
            onClick={() => {
              setAddMsg('')
              setAddOpen(true)
            }}
          >
            Add this match details with current data
          </button>
        </section>
        <section className="history-detail-panel">
          <h2>Standings</h2>
          {standings.length === 0 ? (
            <p className="history-detail-empty">No finish order was stored.</p>
          ) : (
            <ol className="history-detail-standings">
              {standings.map((player) => (
                <li
                  key={player.accountId}
                  className={playerColorClass(player.color)}
                  style={playerColorStyle(player.color)}
                >
                  <strong>{placeLabel(player.place)}</strong>
                  <span>{player.name}</span>
                  <em>{formatSeatColorName(player.color)}</em>
                </li>
              ))}
            </ol>
          )}
          <div className="history-detail-awards">
            <p>
              <span>Winner</span>
              <strong>{entry.winner?.name ?? '—'}</strong>
            </p>
            <p>
              <span>Second</span>
              <strong>
                {standings.find((player) => player.place === 2)?.name ?? '—'}
              </strong>
            </p>
            <p>
              <span>Third</span>
              <strong>
                {standings.find((player) => player.place === 3)?.name ?? '—'}
              </strong>
            </p>
            <p>
              <span>MotM</span>
              <strong>
                {entry.motm
                  ? `${entry.motm.name}${
                      typeof entry.motm.value === 'number'
                        ? ` · ${entry.motm.value} pts`
                        : ''
                    }`
                  : '—'}
              </strong>
            </p>
            <p>
              <span>Worst</span>
              <strong>{entry.worst?.name ?? '—'}</strong>
            </p>
          </div>
        </section>

        <section className="history-detail-panel">
          <h2>This match</h2>
          {entry.matchStats.length === 0 ? (
            <p className="history-detail-empty">
              This older history did not store per-player match stats. Newer
              matches keep Super, +3, sixes, and the rest here.
            </p>
          ) : (
            <div className="history-detail-table-wrap">
              <table className="history-detail-table">
                <thead>
                  <tr>
                    <th>Player</th>
                    {MATCH_STAT_COLUMNS.map((column) => (
                      <th key={column.key}>{column.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {entry.matchStats.map((player) => (
                    <tr
                      key={player.accountId}
                      className={playerColorClass(player.color)}
                      style={playerColorStyle(player.color)}
                    >
                      <th scope="row">{player.name}</th>
                      {MATCH_STAT_COLUMNS.map((column) => (
                        <td key={column.key}>
                          {column.key === 'place'
                            ? player.place
                              ? placeLabel(player.place)
                              : '—'
                            : column.key === 'motmPoints'
                              ? formatMostLeaderValue(
                                  'motmPoints',
                                  player.motmPoints,
                                )
                              : player[column.key]}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="history-detail-panel">
          <h2>Career most totals after this match</h2>
          {entry.careerSnapshot.length === 0 ? (
            <p className="history-detail-empty">
              No full career snapshot was stored. Leaders only are listed below.
            </p>
          ) : (
            <div className="history-detail-table-wrap">
              <table className="history-detail-table">
                <thead>
                  <tr>
                    <th>Player</th>
                    {CAREER_STAT_KEY_LIST.map((key) => (
                      <th key={key}>{MOST_HISTORY_LABELS[key]}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {entry.careerSnapshot.map((player) => (
                    <tr
                      key={player.accountId}
                      className={playerColorClass(player.color)}
                      style={playerColorStyle(player.color)}
                    >
                      <th scope="row">{player.name}</th>
                      {CAREER_STAT_KEY_LIST.map((key) => {
                        const value = player[key] ?? 0
                        const lead = snapshotLeaders[key]?.has(player.accountId)
                        return (
                          <td
                            key={key}
                            className={lead ? 'is-lead' : undefined}
                          >
                            {value > 0 ? formatMostLeaderValue(key, value) : '—'}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="history-detail-panel">
          <h2>Most leaders</h2>
          <ul className="history-detail-leaders">
            {(Object.keys(MOST_HISTORY_LABELS) as CareerStatKey[]).map((key) => {
              const leader = entry.mostLeaders?.[key]
              return (
                <li key={key}>
                  <span>{MOST_HISTORY_LABELS[key]}</span>
                  <strong>
                    {leader
                      ? `${leader.name} · ${formatMostLeaderValue(key, leader.value ?? 0)}`
                      : '—'}
                  </strong>
                </li>
              )
            })}
          </ul>
        </section>
      </section>

      {addOpen ? (
        <div
          className="confirm-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Add match to current stats"
          onClick={() => !addBusy && setAddOpen(false)}
        >
          <div
            className="confirm-card"
            onClick={(event) => event.stopPropagation()}
          >
            <h2>Add this match to current stats?</h2>
            <p>
              This adds match <strong>{entry.code}</strong> on top of the live
              Most stats page. Do not run it twice or those numbers will
              double.
            </p>
            {addDeltas.length > 0 ? (
              <ul className="match-history-apply-preview">
                {addDeltas.map((player) => {
                  const bits = CAREER_STAT_KEY_LIST.flatMap((key) => {
                    const value = player[key]
                    if (!value) return []
                    return [`${MOST_HISTORY_LABELS[key]} +${formatMostLeaderValue(key, value)}`]
                  })
                  return (
                    <li key={player.accountId}>
                      <strong>{player.name}</strong>
                      {bits.length ? ` — ${bits.join(', ')}` : ''}
                    </li>
                  )
                })}
              </ul>
            ) : (
              <p>No career values found on this match.</p>
            )}
            <div className="confirm-actions">
              <button
                type="button"
                className="cancel-button"
                disabled={addBusy}
                onClick={() => setAddOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="secondary-button"
                disabled={addBusy || addDeltas.length === 0}
                onClick={confirmAddMatch}
              >
                {addBusy ? 'Adding…' : 'Add to current stats'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  )
}
