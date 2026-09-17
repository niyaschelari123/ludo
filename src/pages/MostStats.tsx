import { useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { MostStatsPanels } from '../components/CareerBoards'
import {
  hydrateProfileFromCloud,
  loadProfile,
  type UserProfile,
} from '../lib/profile'
import {
  fetchCareerBoard,
  type CareerBoardEntry,
} from '../lib/profileCloud'
import '../App.css'

/**
 * Standalone career “most …” boards for any logged-in player.
 */
export function MostStatsPage() {
  const [profile, setProfile] = useState<UserProfile | null>(() => loadProfile())
  const [board, setBoard] = useState<CareerBoardEntry[] | null>(null)
  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const next = (await hydrateProfileFromCloud()) ?? loadProfile()
      if (cancelled) return
      setProfile(next)
      setReady(true)
      if (!next) return
      try {
        const career = await fetchCareerBoard()
        if (!cancelled) setBoard(career)
      } catch (reason) {
        if (!cancelled) {
          setError(
            reason instanceof Error
              ? reason.message
              : 'Failed to load career stats.',
          )
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  if (!ready) {
    return (
      <main className="most-stats-screen">
        <p className="most-stats-loading">Loading…</p>
      </main>
    )
  }

  if (!profile) {
    return <Navigate to="/" replace />
  }

  return (
    <main className="most-stats-screen">
      <header className="most-stats-header">
        <div className="brand">
          <span className="brand-mark small">L</span> Most stats
        </div>
        <p className="most-stats-sub">
          Career leaderboards for logged-in players
        </p>
        <Link className="text-button" to="/">
          Back home
        </Link>
      </header>

      <section className="most-stats-body" aria-label="Most career stats">
        {error ? <p className="error">{error}</p> : null}
        <MostStatsPanels board={board} />
      </section>
    </main>
  )
}
