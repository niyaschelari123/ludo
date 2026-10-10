import { useEffect, useState } from 'react'
import type { CareerBoardEntry } from '../lib/profileCloud'
import { fetchMatchHistory } from '../lib/matchHistory'
import {
  boardToAnalystPlayers,
  historyToAnalystMatches,
  localAwards,
  prepareAnalyst,
  requestPlayerAnalyst,
  type AnalystAnalysis,
} from '../lib/playerAnalystClient'
import { categoryMeaning, overallRanking, type AnalystAward } from '../lib/playerAnalyst'

export function PlayerAnalystPanel({
  board,
  isAdmin = false,
  adminPin = '',
}: {
  board: CareerBoardEntry[] | null
  isAdmin?: boolean
  adminPin?: string
}) {
  const [awards, setAwards] = useState<AnalystAward[] | null>(null)
  const [analysis, setAnalysis] = useState<AnalystAnalysis | null>(null)
  const [phase, setPhase] = useState<'loading' | 'ready' | 'offline'>('loading')
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    if (!board) return
    let cancelled = false
    setPhase('loading')
    void (async () => {
      const history = await fetchMatchHistory().catch(() => [])
      if (cancelled) return
      const prepared = prepareAnalyst(
        boardToAnalystPlayers(board),
        historyToAnalystMatches(history),
      )
      setAwards(localAwards(board, prepared.matches))
      const remote = await requestPlayerAnalyst(prepared.players, prepared.matches)
      if (cancelled) return
      if (!remote) {
        setAnalysis(null)
        setPhase('offline')
        return
      }
      if (remote.statsVersion === prepared.version) {
        setAnalysis(remote)
        setAwards(remote.awards)
      }
      setPhase('ready')
    })()
    return () => {
      cancelled = true
    }
  }, [board])

  const refresh = () => {
    if (!board || !isAdmin || refreshing) return
    setRefreshing(true)
    void (async () => {
      const history = await fetchMatchHistory().catch(() => [])
      const prepared = prepareAnalyst(
        boardToAnalystPlayers(board),
        historyToAnalystMatches(history),
      )
      const remote = await requestPlayerAnalyst(prepared.players, prepared.matches, {
        force: true,
        adminPin,
      })
      if (remote && remote.statsVersion === prepared.version) {
        setAnalysis(remote)
        setAwards(remote.awards)
        setPhase('ready')
      }
      setRefreshing(false)
    })()
  }

  if (!board) {
    return (
      <section className="analyst" aria-label="Player awards">
        <p className="analyst-status">Loading player awards…</p>
      </section>
    )
  }

  const narrative = analysis?.aiStatus === 'ready' ? analysis.narrative : null
  const shown = awards ?? []
  const ranking = overallRanking(boardToAnalystPlayers(board))

  return (
    <section className="analyst" aria-label="Player awards">
      <header className="analyst-head">
        <div>
          <p className="analyst-kicker">Player Analyst</p>
          <h2>Awards from the Most stats</h2>
        </div>
        {isAdmin ? (
          <button type="button" className="slot-action" disabled={refreshing} onClick={refresh}>
            {refreshing ? 'Refreshing…' : 'Refresh commentary'}
          </button>
        ) : null}
      </header>
      <p className="analyst-note">
        Winners are calculated from career stats. Commentary is written once per stats change
        {phase === 'offline'
          ? '. The commentary server is unreachable, so only the calculated awards are shown.'
          : analysis?.aiStatus === 'unavailable'
            ? '. Commentary is unavailable right now.'
            : '.'}
      </p>

      <section className="analyst-ranking" aria-label="Overall performance ranking">
        <h3>Overall ranking</h3>
        <p className="analyst-meaning">
          Ordered by Ultimate score per match: MotM × 40 + wins × 50 − Worst × 10. Players with far fewer matches are left out.
        </p>
        {ranking.length === 0 ? (
          <p className="analyst-empty">Not enough matches to rank players yet.</p>
        ) : (
          <ol className="analyst-rank-list">
            {ranking.map((row) => (
              <li key={row.accountId}>
                <span className="analyst-rank-place">{row.rank}</span>
                <span className="analyst-rank-name">{row.name}</span>
                <span className="analyst-rank-score">{row.score}</span>
                <span className="analyst-rank-meta">
                  {row.matchesPlayed} matches · {row.wins} wins · {row.motm} MotM · {row.worst} Worst
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <div className="analyst-grid">
        {shown.map((award) => (
          <article key={award.category} className={`analyst-card ${award.status}`}>
            <p className="analyst-icon" aria-hidden="true">{award.icon}</p>
            <h3>{award.title}</h3>
            <p className="analyst-meaning">{award.meaning || categoryMeaning(award.category)}</p>
            {award.status === 'insufficient' ? (
              <p className="analyst-empty">Insufficient data</p>
            ) : (
              <p className="analyst-winner">{award.playerName}</p>
            )}
            {award.tied ? <p className="analyst-tie">Tied score</p> : null}
            {award.keyStats.length > 0 ? (
              <ul className="analyst-stats">
                {award.keyStats.map((stat) => (
                  <li key={stat.label}>
                    <span>{stat.label}</span>
                    <strong>{stat.value}</strong>
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="analyst-evidence">{award.evidence}</p>
            {narrative?.reasons[award.category] ? (
              <p className="analyst-reason">{narrative.reasons[award.category]}</p>
            ) : null}
            {award.runnerUpName ? (
              <p className="analyst-runner">
                Runner-up {award.runnerUpName}
                {award.runnerUpScore != null ? ` · ${award.runnerUpScore}` : ''}
              </p>
            ) : null}
          </article>
        ))}
      </div>

      <aside className="analyst-verdict">
        <h3>Analyst&apos;s Verdict</h3>
        {narrative?.overallVerdict ? (
          <p>{narrative.overallVerdict}</p>
        ) : (
          <p>
            {shown.find((award) => award.category === 'best_overall' && award.playerName)
              ? `${shown.find((award) => award.category === 'best_overall')?.playerName} leads Best Overall on the calculated scores.`
              : 'Not enough finished matches to name a Best Overall player yet.'}
            {' '}
            Commentary appears after the stats server writes it.
          </p>
        )}
        {narrative && narrative.rivalries.length > 0 ? (
          <div>
            <h4>Rivalries</h4>
            <ul>
              {narrative.rivalries.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {narrative && narrative.observations.length > 0 ? (
          <div>
            <h4>Observations</h4>
            <ul>
              {narrative.observations.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </aside>
    </section>
  )
}
