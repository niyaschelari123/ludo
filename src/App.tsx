import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react'
import { onAuthStateChanged, signInAnonymously, type User } from 'firebase/auth'
import './App.css'
import {
  getSoundVolume,
  isSoundEnabled,
  playCapture,
  playClick,
  playDiceResult,
  playDiceTick,
  playHome,
  playWin,
  setSoundEnabled,
  setSoundVolume,
} from './audio'
import { LudoBoard } from './components/LudoBoard'
import { auth, isFirebaseConfigured } from './firebase'
import {
  createRoom,
  joinRoom,
  moveToken,
  rollDice,
  startRoom,
  watchRoom,
} from './game/roomService'
import { movableTokens } from './game/engine'
import type { Room } from './game/types'

function App() {
  const [user, setUser] = useState<User | null>(null)
  const [name, setName] = useState(() => localStorage.getItem('ludo-name') ?? '')
  const [joinCode, setJoinCode] = useState('')
  const [maxPlayers, setMaxPlayers] = useState(6)
  const [roomId, setRoomId] = useState<string | null>(() =>
    localStorage.getItem('ludo-room'),
  )
  const [room, setRoom] = useState<Room | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [rolling, setRolling] = useState(false)
  const [diceFace, setDiceFace] = useState(1)
  const [movingToken, setMovingToken] = useState<{
    id: number
    fromProgress: number
    dice: number
  } | null>(null)
  const [moveReadyToClear, setMoveReadyToClear] = useState(false)
  const [soundOn, setSoundOn] = useState(isSoundEnabled)
  const [soundVolume, setSoundVolumeState] = useState(getSoundVolume)
  const lastSoundAction = useRef<string | null>(null)

  useEffect(() => {
    if (!isFirebaseConfigured) return
    const unsubscribe = onAuthStateChanged(auth, setUser)
    if (!auth.currentUser) {
      void signInAnonymously(auth).catch((reason) => setError(reason.message))
    }
    return unsubscribe
  }, [])

  useEffect(() => {
    if (!roomId || !user) return
    localStorage.setItem('ludo-room', roomId)
    return watchRoom(
      roomId,
      (nextRoom) => {
        setRoom(nextRoom)
        if (!nextRoom) {
          localStorage.removeItem('ludo-room')
          setRoomId(null)
        }
      },
      setError,
    )
  }, [roomId, user])

  useEffect(() => {
    if (!rolling) return
    const timer = window.setInterval(
      () => {
        setDiceFace(Math.floor(Math.random() * 6) + 1)
        playDiceTick()
      },
      75,
    )
    return () => window.clearInterval(timer)
  }, [rolling])

  useEffect(() => {
    const action = room?.game?.lastAction
    if (!action || action === lastSoundAction.current) return
    if (lastSoundAction.current === null) {
      lastSoundAction.current = action
      return
    }
    lastSoundAction.current = action
    if (action.includes('captured')) playCapture()
    else if (action.includes('brought a token home')) playHome()
    else if (action.includes('finished in place')) playWin()
  }, [room?.game?.lastAction])

  useEffect(() => {
    if (!moveReadyToClear || !movingToken || !room?.game || !user) return
    const serverToken = room.game.tokens.find(
      (token) =>
        token.playerId === user.uid &&
        token.id === movingToken.id,
    )
    const targetProgress =
      movingToken.fromProgress === -1
        ? 0
        : movingToken.fromProgress + movingToken.dice
    if (serverToken?.progress === targetProgress) {
      setMovingToken(null)
      setMoveReadyToClear(false)
    }
  }, [moveReadyToClear, movingToken, room, user])

  const perform = useCallback(async (action: () => Promise<void>) => {
    setBusy(true)
    setError('')
    try {
      await action()
      return true
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Something went wrong.')
      return false
    } finally {
      setBusy(false)
    }
  }, [])

  const rememberName = () => localStorage.setItem('ludo-name', name.trim())
  const copyCode = () => void navigator.clipboard.writeText(room?.code ?? '')
  const playButtonSound = (event: MouseEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest('button')) playClick()
  }
  const toggleSound = () => {
    const next = !soundOn
    setSoundOn(next)
    setSoundEnabled(next)
  }
  const animateRoll = async () => {
    setRolling(true)
    await perform(async () => {
      await Promise.all([
        rollDice(room!.id, user!.uid),
        new Promise((resolve) => window.setTimeout(resolve, 650)),
      ])
    })
    setRolling(false)
    playDiceResult()
  }
  const animateMove = useCallback(async (tokenId: number) => {
    const token = room?.game?.tokens.find(
      (candidate) => candidate.playerId === user?.uid && candidate.id === tokenId,
    )
    if (!token || !room || !user) return
    const dice = room.game?.dice ?? 1
    const steps = token.progress === -1 ? 1 : dice
    setMoveReadyToClear(false)
    setMovingToken({ id: tokenId, fromProgress: token.progress, dice })
    const succeeded = await perform(async () => {
      await Promise.all([
        moveToken(room.id, user.uid, tokenId),
        new Promise((resolve) => window.setTimeout(resolve, steps * 135 + 240)),
      ])
    })
    if (succeeded) {
      setMoveReadyToClear(true)
    } else {
      setMovingToken(null)
    }
  }, [perform, room, user])

  useEffect(() => {
    if (
      !room?.game ||
      room.status !== 'playing' ||
      room.game.phase !== 'move' ||
      room.players[room.game.turnIndex]?.id !== user?.uid ||
      movingToken ||
      busy
    ) {
      return
    }

    const legalMoves = movableTokens(room)
    if (legalMoves.length !== 1) return
    const timer = window.setTimeout(
      () => void animateMove(legalMoves[0].id),
      350,
    )
    return () => window.clearTimeout(timer)
  }, [animateMove, busy, movingToken, room, user])
  const leave = () => {
    localStorage.removeItem('ludo-room')
    setMovingToken(null)
    setMoveReadyToClear(false)
    setRoomId(null)
    setRoom(null)
  }

  if (!isFirebaseConfigured) {
    return (
      <main className="setup-screen">
        <div className="brand-mark">L</div>
        <h1>Connect Firebase to begin</h1>
        <p>
          Copy <code>.env.example</code> to <code>.env.local</code>, add your
          Firebase web app values, enable Anonymous Authentication, and create a
          Firestore database.
        </p>
      </main>
    )
  }

  if (!user) return <main className="loading-screen">Connecting to game server…</main>

  if (!roomId || !room) {
    return (
      <main className="home-screen" onClickCapture={playButtonSound}>
        <section className="hero-panel">
          <div className="brand"><span className="brand-mark">L</span> Ludo Live</div>
          <button className="sound-toggle home-sound" onClick={toggleSound} title={soundOn ? 'Mute sounds' : 'Enable sounds'}>
            {soundOn ? '🔊' : '🔇'}
          </button>
          <div className="hero-copy">
            <span className="eyebrow">REAL-TIME MULTIPLAYER</span>
            <h1>Roll. Race. Rule the board.</h1>
            <p>
              Play classic Ludo online with friends anywhere. Create a private
              room for up to eight players and share the code.
            </p>
          </div>
          <div className="feature-row">
            <span>◆ 2–8 players</span><span>◆ Live sync</span><span>◆ Private rooms</span>
          </div>
        </section>

        <section className="entry-panel">
          <div className="entry-card">
            <h2>Enter the arena</h2>
            <label>
              Display name
              <input
                value={name}
                maxLength={18}
                onChange={(event) => setName(event.target.value)}
                placeholder="Your name"
              />
            </label>
            <div className="join-row">
              <input
                value={joinCode}
                maxLength={6}
                onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
                placeholder="ROOM CODE"
              />
              <button
                disabled={busy || !name.trim() || joinCode.length !== 6}
                onClick={() => perform(async () => {
                  rememberName()
                  setRoomId(await joinRoom(user.uid, name, joinCode))
                })}
              >Join room</button>
            </div>
            <div className="divider"><span>or host a game</span></div>
            <label>
              Room size
              <select value={maxPlayers} onChange={(event) => setMaxPlayers(Number(event.target.value))}>
                {[2, 3, 4, 5, 6, 7, 8].map((count) => (
                  <option key={count} value={count}>{count} players</option>
                ))}
              </select>
            </label>
            <button
              className="secondary-button"
              disabled={busy || !name.trim()}
              onClick={() => perform(async () => {
                rememberName()
                setRoomId(await createRoom(user.uid, name, maxPlayers))
              })}
            >Create private room</button>
            {error && <p className="error">{error}</p>}
          </div>
        </section>
      </main>
    )
  }

  const currentPlayer = room.game ? room.players[room.game.turnIndex] : null
  const isMyTurn = currentPlayer?.id === user.uid
  const me = room.players.find((player) => player.id === user.uid)
  const finalRanking = room.game
    ? [...room.players].sort((first, second) => {
        const firstPlace = room.game!.winnerIds.indexOf(first.id)
        const secondPlace = room.game!.winnerIds.indexOf(second.id)
        return (
          (firstPlace === -1 ? Number.MAX_SAFE_INTEGER : firstPlace) -
          (secondPlace === -1 ? Number.MAX_SAFE_INTEGER : secondPlace)
        )
      })
    : []

  return (
    <main className="room-screen" onClickCapture={playButtonSound}>
      <header className="room-header">
        <div className="brand"><span className="brand-mark small">L</span> Ludo Live</div>
        <div className="room-code">
          Room <strong>{room.code}</strong>
          <button className="icon-button" onClick={copyCode} title="Copy room code">⧉</button>
        </div>
        <div className="header-actions">
          <input
            className="volume-slider"
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={soundVolume}
            onChange={(event) => {
              const volume = Number(event.target.value)
              setSoundVolumeState(volume)
              setSoundVolume(volume)
            }}
            aria-label="Sound volume"
            title="Sound volume"
          />
          <button className="sound-toggle" onClick={toggleSound} title={soundOn ? 'Mute sounds' : 'Enable sounds'}>
            {soundOn ? '🔊' : '🔇'}
          </button>
          <button className="text-button" onClick={leave}>Leave</button>
        </div>
      </header>

      {room.status === 'lobby' ? (
        <section className="lobby">
          <div className="lobby-card">
            <span className="eyebrow">PRIVATE ROOM</span>
            <h1>Waiting for players</h1>
            <p>Share this code with friends anywhere.</p>
            <button className="code-display" onClick={copyCode}>{room.code} <span>⧉</span></button>
            <div className="players-grid">
              {Array.from({ length: room.maxPlayers }, (_, index) => {
                const player = room.players[index]
                return player ? (
                  <div className={`player-slot ${player.color}`} key={player.id}>
                    <span>{player.name.slice(0, 1).toUpperCase()}</span>
                    <strong>{player.name}</strong>
                    {player.id === room.hostId && <small>HOST</small>}
                  </div>
                ) : (
                  <div className="player-slot empty" key={index}>
                    <span>+</span><strong>Open seat</strong>
                  </div>
                )
              })}
            </div>
            {room.hostId === user.uid ? (
              <button
                className="start-button"
                disabled={busy || room.players.length < 2}
                onClick={() => perform(() => startRoom(room.id, user.uid))}
              >Start game ({room.players.length}/{room.maxPlayers})</button>
            ) : <p className="waiting-text">Waiting for the host to start…</p>}
            {error && <p className="error">{error}</p>}
          </div>
        </section>
      ) : (
        <section className="game-layout">
          <aside className="players-panel">
            <h2>Players</h2>
            {room.players.map((player, index) => (
              <div
                key={player.id}
                className={`player-row ${player.color} ${room.game?.turnIndex === index ? 'active' : ''}`}
              >
                <span className="avatar">{player.name[0].toUpperCase()}</span>
                <div><strong>{player.name}</strong><small>
                  {room.game?.winnerIds.includes(player.id)
                    ? `Finished #${room.game.winnerIds.indexOf(player.id) + 1}`
                    : player.id === user.uid ? 'You' : 'Online'}
                </small></div>
              </div>
            ))}
          </aside>

          <div className="game-center">
            <div className="turn-banner">
              <strong>{isMyTurn ? 'Your turn' : `${currentPlayer?.name}'s turn`}</strong>
              <span>{room.game?.lastAction}</span>
            </div>
            <LudoBoard
              room={room}
              userId={user.uid}
              movingToken={movingToken}
              onMove={(tokenId) => void animateMove(tokenId)}
            />
          </div>

          <aside className="action-panel">
            <span className="eyebrow">TURN CONTROL</span>
            <div className={`dice ${rolling ? 'rolling' : room.game?.dice ? 'rolled' : ''}`}>
              {rolling ? diceFace : room.game?.dice ?? '•'}
            </div>
            {isMyTurn && room.game?.phase === 'roll' ? (
              <button className="roll-button" disabled={busy || rolling} onClick={() => void animateRoll()}>
                Roll dice
              </button>
            ) : isMyTurn ? (
              <p className="action-hint">Choose a glowing {me?.color} token.</p>
            ) : <p className="action-hint">Waiting for {currentPlayer?.name}…</p>}
            <div className="rules">
              <h3>Quick rules</h3>
              <p>Roll 6 to leave the yard.</p>
              <p>Capture and roll 6 for an extra turn.</p>
              <p>A sole active token is protected until one token finishes.</p>
              <p>Ignoring a yard token after rolling 6 forfeits that protection.</p>
              <p>No active tokens: the sixth failed entry attempt guarantees a 6.</p>
              <p>Three consecutive 6s lose the turn.</p>
              <p>Reach home with an exact roll.</p>
            </div>
            {error && <p className="error">{error}</p>}
          </aside>
        </section>
      )}

      {room.status === 'finished' && (
        <div className="results-overlay" role="dialog" aria-modal="true" aria-label="Final standings">
          <div className="results-card">
            <div className="results-rays" />
            <span className="results-eyebrow">GAME COMPLETE</span>
            <h1>Final standings</h1>
            <p className="results-subtitle">A champion has conquered the board!</p>

            <div className="podium">
              {finalRanking.slice(0, 3).map((player, index) => (
                <div className={`podium-place place-${index + 1} ${player.color}`} key={player.id}>
                  <span className="medal">{['🥇', '🥈', '🥉'][index]}</span>
                  <span className="podium-avatar">{player.name[0].toUpperCase()}</span>
                  <strong>{player.name}</strong>
                  <small>{index === 0 ? 'CHAMPION' : `PLACE ${index + 1}`}</small>
                  <div className="podium-block">{index + 1}</div>
                </div>
              ))}
            </div>

            {finalRanking.length > 3 && (
              <div className="remaining-places">
                {finalRanking.slice(3).map((player, index) => (
                  <div className={`result-row ${player.color}`} key={player.id}>
                    <span className="result-position">#{index + 4}</span>
                    <span className="avatar">{player.name[0].toUpperCase()}</span>
                    <strong>{player.name}</strong>
                    {player.id === user.uid && <small>YOU</small>}
                  </div>
                ))}
              </div>
            )}

            <button className="results-button" onClick={leave}>Back to home</button>
          </div>
        </div>
      )}
    </main>
  )
}

export default App
