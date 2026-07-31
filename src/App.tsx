import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from 'react'
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
import { Dice3D } from './components/Dice3D'
import { PowerLegend } from './components/PowerLegend'
import { PowerToast } from './components/PowerToast'
import {
  claimColor,
  createRoom,
  grantExtraTurnChances,
  joinRoom,
  leaveRoom,
  moveTokenWithRetry,
  releaseColor,
  removePlayer,
  resolvePendingPower,
  rollDice,
  setSlotBot,
  skipMoveTimer,
  skipRollTimer,
  startRoom,
  watchColorClaims,
  watchRoom,
} from './game/roomService'
import {
  clearProfile,
  getActiveUserId,
  loadProfile,
  loginWithPin,
  saveProfile,
  type UserProfile,
} from './lib/profile'
import { PLAYER_COLOR_HEX, isNamedPlayerColor, normalizeColorKey, resolveColorHex } from './game/colors'
import {
  activeMoveToMovingToken,
  MAX_TURN_MISSES,
  movableTokens,
  performLocalMove,
  performLocalResolvePower,
  playerTurnMissLimit,
  TURN_MOVE_TIMEOUT_MS,
  TURN_ROLL_TIMEOUT_MS,
} from './game/engine'
import { computeMotm, computeWorstPlayer, computeWinOdds, readPlayerStats, type MotmCandidate } from './game/matchAwards'
import { PLAYER_COLORS, type GameMode, type MovingToken, type PlayerStats, type PowerUpType, type Room } from './game/types'
import {
  moveBaseSignature,
  movingTokenTarget,
  resolveAnimationProgress,
  tokenMoveDurationMs,
} from './game/types'

const POWER_TOAST_MS = 1400

type RemoveConfirmTarget = {
  id: string
  name: string
  kind: 'player' | 'bot'
  seat?: number
}

function FaceStrip({
  selected,
  onPick,
  compact = false,
}: {
  selected?: number
  onPick: (value: number) => void
  compact?: boolean
}) {
  return (
    <div
      className={`face-strip ${compact ? 'face-strip--compact' : ''}`}
      aria-hidden="true"
      onClick={(event) => event.stopPropagation()}
    >
      {[1, 2, 3, 4, 5, 6].map((value) => (
        <button
          key={value}
          type="button"
          className={`face-strip-btn ${selected === value ? 'on' : ''}`}
          onClick={() => onPick(value)}
        >
          {value}
        </button>
      ))}
    </div>
  )
}

function roomTokensMatch(first: Room, second: Room) {
  const firstGame = first.game
  const secondGame = second.game
  if (!firstGame || !secondGame) return firstGame === secondGame
  return firstGame.tokens.every((token) => {
    const other = secondGame.tokens.find(
      (candidate) =>
        candidate.playerId === token.playerId && candidate.id === token.id,
    )
    return other?.progress === token.progress
  })
}

function playerColorClass(color: string) {
  return isNamedPlayerColor(color) ? color : 'custom-color'
}

function playerColorStyle(color: string): CSSProperties | undefined {
  return isNamedPlayerColor(color)
    ? undefined
    : ({ ['--player' as string]: resolveColorHex(color) } as CSSProperties)
}

function formatAwardScore(score: number) {
  return Number.isInteger(score) ? String(score) : score.toFixed(1)
}

function MatchAwardCard({
  title,
  award,
  variant = 'best',
}: {
  title: string
  award: MotmCandidate
  variant?: 'best' | 'worst'
}) {
  return (
    <div
      className={`motm-card ${variant === 'worst' ? 'motm-card--worst' : ''} ${playerColorClass(award.player.color)}`}
      style={playerColorStyle(award.player.color)}
    >
      <span className="motm-eyebrow">{title}</span>
      <div className="motm-body">
        <span className="motm-avatar">{award.player.name[0].toUpperCase()}</span>
        <div>
          <strong>{award.player.name}</strong>
          <small>Total {formatAwardScore(award.score)} pts</small>
        </div>
      </div>
      <ul className="motm-breakdown">
        <li>
          <span>Eliminations ({award.stats.captures} × 3)</span>
          <em>+{award.breakdown.eliminations}</em>
        </li>
        <li>
          <span>
            Finish place
            {award.place <= 3 ? ` (#${award.place})` : ''}
          </span>
          <em>+{award.breakdown.placeBonus}</em>
        </li>
        <li>
          <span>Tokens home ({award.stats.tokensHome} × 2)</span>
          <em>+{award.breakdown.tokensHome}</em>
        </li>
        <li>
          <span>Sixes ({award.stats.sixes} × 0.5)</span>
          <em>+{award.breakdown.sixes}</em>
        </li>
        <li className="motm-breakdown-penalty">
          <span>Times eliminated ({award.stats.eliminated})</span>
          <em>−{award.breakdown.timesEliminated}</em>
        </li>
      </ul>
    </div>
  )
}

function App() {
  const [profile, setProfile] = useState<UserProfile | null>(() => loadProfile())
  const [userId, setUserId] = useState(() => getActiveUserId(loadProfile()))
  const [name, setName] = useState(
    () => loadProfile()?.name ?? localStorage.getItem('ludo-name') ?? '',
  )
  const [joinCode, setJoinCode] = useState('')
  const [maxPlayers, setMaxPlayers] = useState(6)
  const [gameMode, setGameMode] = useState<GameMode>('classic')
  const [roomId, setRoomId] = useState<string | null>(() =>
    localStorage.getItem('ludo-room'),
  )
  const [room, setRoom] = useState<Room | null>(null)
  const [optimisticRoom, setOptimisticRoom] = useState<Room | null>(null)
  const displayRoom = optimisticRoom ?? room
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [loginOpen, setLoginOpen] = useState(false)
  const [loginPin, setLoginPin] = useState('')
  const [loginError, setLoginError] = useState('')
  const [colorClaims, setColorClaims] = useState<Record<string, string>>({})
  const [rolling, setRolling] = useState(false)
  const [diceFace, setDiceFace] = useState(1)
  const [displayDice, setDisplayDice] = useState<number | null>(null)
  const [movingToken, setMovingToken] = useState<MovingToken | null>(null)
  const [moveReadyToClear, setMoveReadyToClear] = useState(false)
  const [powerToast, setPowerToast] = useState<{
    type: PowerUpType
    playerName: string
  } | null>(null)
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false)
  const [hostLeaveOpen, setHostLeaveOpen] = useState(false)
  const [newHostId, setNewHostId] = useState('')
  const [removeConfirm, setRemoveConfirm] = useState<RemoveConfirmTarget | null>(null)
  const [turnSecondsLeft, setTurnSecondsLeft] = useState<number | null>(null)
  const rollSyncRef = useRef<Promise<unknown> | null>(null)
  const moveInFlightRef = useRef(false)
  const powerResolveInFlightRef = useRef(false)
  const prevRoomRef = useRef<Room | null>(null)
  const remoteAnimSignatureRef = useRef<string | null>(null)
  const movingTokenRef = useRef<MovingToken | null>(null)
  const roomRef = useRef<Room | null>(null)
  const [soundOn, setSoundOn] = useState(isSoundEnabled)
  const [soundVolume, setSoundVolumeState] = useState(getSoundVolume)
  const lastSoundAction = useRef<string | null>(null)
  const lastBotRollRef = useRef<string | null>(null)
  const extraCtrl = useMemo(() => {
    try {
      return localStorage.getItem('ludo_admin') === 'true'
    } catch {
      return false
    }
  }, [])
  const [rollPicks, setRollPicks] = useState<Record<string, number>>({})

  useEffect(() => {
    if (!extraCtrl || !displayRoom?.game) return
    const game = displayRoom.game
    if (game.phase === 'roll') return
    const rollerId = displayRoom.players[game.turnIndex]?.id
    if (!rollerId) return
    setRollPicks((prev) => {
      if (prev[rollerId] === undefined) return prev
      const next = { ...prev }
      delete next[rollerId]
      return next
    })
  }, [
    displayRoom?.game?.phase,
    displayRoom?.game?.turnIndex,
    displayRoom?.players,
    extraCtrl,
  ])

  const pickForPlayer = useCallback(
    async (playerId: string, value: number) => {
      setRollPicks((prev) => ({ ...prev, [playerId]: value }))
      const baseRoom = optimisticRoom ?? room
      if (!baseRoom) return
      try {
        await rollDice(baseRoom.id, userId, value, { k: 3, t: playerId })
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'Something went wrong.')
      }
    },
    [optimisticRoom, room, userId],
  )

  useEffect(() => watchColorClaims(setColorClaims), [])

  useEffect(() => {
    if (!profile?.color) return
    void claimColor(profile.accountId, profile.color)
      .then(setColorClaims)
      .catch(() => {})
  }, [profile?.accountId, profile?.color])

  movingTokenRef.current = movingToken
  roomRef.current = room

  const scheduleRemoteMove = useCallback((move: MovingToken) => {
    const signature = moveBaseSignature(move)
    if (remoteAnimSignatureRef.current === signature) return
    remoteAnimSignatureRef.current = signature
    setMovingToken({ ...move, startedAt: Date.now() })
  }, [])

  const showPowerAndResolve = useCallback(async (roomId: string, baseRoom: Room) => {
    const pending = baseRoom.game?.pendingPower
    if (!pending || powerResolveInFlightRef.current) return

    powerResolveInFlightRef.current = true
    const player = baseRoom.players.find((candidate) => candidate.id === pending.playerId)
    setPowerToast({
      type: pending.type,
      playerName: player?.name ?? 'Player',
    })
    await new Promise((resolve) => window.setTimeout(resolve, POWER_TOAST_MS))

    const resolveStartedAt = Date.now()
    try {
      const resolvedRoom = performLocalResolvePower(baseRoom, userId)
      const powerMove = resolvedRoom.game?.activeMove

      if (powerMove) {
        const animated = activeMoveToMovingToken(powerMove)
        const animRoom = structuredClone(resolvedRoom)
        const animToken = animRoom.game!.tokens.find(
          (candidate) =>
            candidate.playerId === animated.playerId &&
            candidate.id === animated.id,
        )
        if (animToken) {
          animToken.progress = animated.fromProgress
        }

        setMovingToken({ ...animated, startedAt: Date.now() })
        setOptimisticRoom(animRoom)
        await new Promise((resolve) =>
          window.setTimeout(resolve, tokenMoveDurationMs(animated)),
        )
        setOptimisticRoom(resolvedRoom)
      } else {
        setOptimisticRoom(resolvedRoom)
      }

      await resolvePendingPower(roomId, userId, resolveStartedAt)
    } catch (reason) {
      setOptimisticRoom(null)
      setError(reason instanceof Error ? reason.message : 'Failed to apply power.')
    } finally {
      powerResolveInFlightRef.current = false
      window.setTimeout(() => setPowerToast(null), 350)
    }
  }, [userId])

  useEffect(() => {
    if (!roomId) return
    localStorage.setItem('ludo-room', roomId)
    return watchRoom(
      roomId,
      userId,
      (nextRoom) => {
        setRoom(nextRoom)
        if (!nextRoom) {
          setOptimisticRoom(null)
          localStorage.removeItem('ludo-room')
          setRoomId(null)
        }
      },
      setError,
      (activeMove) => {
        if (activeMove.playerId !== userId && !moveInFlightRef.current) {
          scheduleRemoteMove(activeMoveToMovingToken(activeMove))
        }
      },
    )
  }, [roomId, userId, scheduleRemoteMove])

  useEffect(() => {
    if (!room?.game) return

    const active = room.game.activeMove
    if (active && active.playerId !== userId && !moveInFlightRef.current) {
      scheduleRemoteMove(activeMoveToMovingToken(active))
    }

    prevRoomRef.current = room
  }, [room, userId, scheduleRemoteMove])

  useEffect(() => {
    if (!movingToken || moveInFlightRef.current) return

    const tryClearRemoteMove = () => {
      const currentMove = movingTokenRef.current
      const currentRoom = roomRef.current
      if (!currentMove || !currentRoom?.game || moveInFlightRef.current) {
        return false
      }

      const target = movingTokenTarget(currentMove)
      const serverToken = currentRoom.game.tokens.find(
        (token) =>
          token.playerId === currentMove.playerId && token.id === currentMove.id,
      )
      if (serverToken?.progress !== target) return false

      const { done } = resolveAnimationProgress(currentMove)
      if (!done) return false

      remoteAnimSignatureRef.current = null
      setMovingToken(null)
      return true
    }

    if (tryClearRemoteMove()) return

    const timer = window.setInterval(() => {
      if (tryClearRemoteMove()) {
        window.clearInterval(timer)
      }
    }, 50)

    return () => window.clearInterval(timer)
  }, [movingToken])

  useEffect(() => {
    if (!optimisticRoom?.game || !room?.game) return
    if (
      movingToken ||
      moveInFlightRef.current ||
      rollSyncRef.current ||
      powerResolveInFlightRef.current
    ) {
      return
    }
    if (room.updatedAt >= optimisticRoom.updatedAt) {
      setOptimisticRoom(null)
      return
    }
    if (
      room.game.lastAction === optimisticRoom.game.lastAction &&
      roomTokensMatch(room, optimisticRoom)
    ) {
      setOptimisticRoom(null)
    }
  }, [optimisticRoom, room, movingToken])

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

  useLayoutEffect(() => {
    const game = room?.game
    if (!game?.dice || game.phase !== 'move' || !room) return

    const action = game.lastAction
    if (!action.includes(' rolled ')) return

    const roller = room.players.find((player) => action.startsWith(player.name))
    if (!roller?.isBot || lastBotRollRef.current === action) return
    lastBotRollRef.current = action

    setRolling(true)
    const finalDice = game.dice
    const timer = window.setTimeout(() => {
      setDiceFace(finalDice)
      setDisplayDice(finalDice)
      setRolling(false)
      playDiceResult()
    }, 950)

    return () => window.clearTimeout(timer)
  }, [room])

  useEffect(() => {
    if (rolling) return
    const game = displayRoom?.game
    if (!game) return
    if (game.phase === 'roll' || !game.dice) {
      setDisplayDice(null)
      return
    }
    setDisplayDice(game.dice)
  }, [displayRoom?.game?.phase, displayRoom?.game?.dice, rolling])

  useEffect(() => {
    const action = displayRoom?.game?.lastAction
    if (!action || action === lastSoundAction.current) return
    if (lastSoundAction.current === null) {
      lastSoundAction.current = action
      return
    }
    lastSoundAction.current = action
    if (action.includes('captured')) playCapture()
    else if (action.includes('brought a token home')) playHome()
    else if (action.includes('finished in place')) playWin()
  }, [displayRoom?.game?.lastAction])

  useEffect(() => {
    const game = displayRoom?.game
    if (
      !game ||
      displayRoom?.status !== 'playing' ||
      (game.phase !== 'roll' && game.phase !== 'move')
    ) {
      setTurnSecondsLeft(null)
      return
    }

    const tick = () => {
      if (!game.turnDeadline) {
        setTurnSecondsLeft(null)
        return
      }
      setTurnSecondsLeft(Math.max(0, Math.ceil((game.turnDeadline - Date.now()) / 1000)))
    }

    tick()
    const timer = window.setInterval(tick, 250)
    return () => window.clearInterval(timer)
  }, [
    displayRoom?.status,
    displayRoom?.game?.phase,
    displayRoom?.game?.turnDeadline,
    displayRoom?.game?.turnIndex,
  ])

  useEffect(() => {
    if (!moveReadyToClear || !movingToken || !room?.game) return
    const serverToken = room.game.tokens.find(
      (token) =>
        token.playerId === movingToken.playerId &&
        token.id === movingToken.id,
    )
    const targetProgress = movingTokenTarget(movingToken)
    if (serverToken?.progress === targetProgress) {
      setMoveReadyToClear(false)
    }
  }, [moveReadyToClear, movingToken, room])

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

  const rememberName = () => {
    const next = name.trim()
    localStorage.setItem('ludo-name', next)
    if (profile) {
      const updated = { ...profile, name: next || profile.name }
      saveProfile(updated)
      setProfile(updated)
    }
  }

  const submitLogin = () => {
    setLoginError('')
    try {
      const next = loginWithPin(loginPin.trim())
      setProfile(next)
      setUserId(next.accountId)
      setName(next.name)
      setLoginOpen(false)
      setLoginPin('')
    } catch (reason) {
      setLoginError(reason instanceof Error ? reason.message : 'Invalid code.')
    }
  }

  const logoutProfile = async () => {
    if (profile) {
      try {
        const claims = await releaseColor(profile.accountId)
        setColorClaims(claims)
      } catch {
        /* ignore */
      }
    }
    clearProfile()
    setProfile(null)
    setUserId(getActiveUserId(null))
  }

  const pickProfileColor = async (color: string) => {
    if (!profile) return
    setError('')
    try {
      const key = normalizeColorKey(color)
      const owner = colorClaims[key]
      if (owner && owner !== profile.accountId) {
        setError('That color is already taken.')
        return
      }
      const claims = await claimColor(profile.accountId, color)
      setColorClaims(claims)
      const updated = { ...profile, color }
      saveProfile(updated)
      setProfile(updated)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not claim color.')
    }
  }

  const roomColorOptions = profile?.color
    ? { color: profile.color, lockColor: true as const }
    : undefined

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
    const baseRoom = optimisticRoom ?? room
    const baseGame = baseRoom?.game
    if (!baseRoom || !baseGame) return
    if (baseGame.phase !== 'roll') {
      setError('Dice cannot be rolled now.')
      return
    }
    if (baseRoom.players[baseGame.turnIndex]?.id !== userId) {
      setError('It is not your turn.')
      return
    }

    setRolling(true)
    setError('')
    setDiceFace(Math.floor(Math.random() * 6) + 1)

    const sync = rollDice(baseRoom.id, userId).catch((reason) => {
      setOptimisticRoom(null)
      setError(reason instanceof Error ? reason.message : 'Failed to sync roll.')
      throw reason
    })
    rollSyncRef.current = sync

    let rolled: { room: Room; dice: number }
    try {
      ;[rolled] = await Promise.all([
        sync,
        new Promise((resolve) => window.setTimeout(resolve, 650)),
      ])
    } catch {
      setRolling(false)
      return
    } finally {
      if (rollSyncRef.current === sync) rollSyncRef.current = null
    }

    setDiceFace(rolled.dice)
    setDisplayDice(rolled.dice)
    setRolling(false)
    setOptimisticRoom(rolled.room)
    playDiceResult()
  }
  const animateMove = useCallback(async (tokenId: number) => {
    if (moveInFlightRef.current) return
    const baseRoom = optimisticRoom ?? room
    if (!baseRoom?.game) return
    const token = baseRoom.game.tokens.find(
      (candidate) => candidate.playerId === userId && candidate.id === tokenId,
    )
    if (!token) return
    const dice = baseRoom.game.dice ?? 1
    const fromProgress = token.progress

    moveInFlightRef.current = true
    setMoveReadyToClear(false)
    setError('')

    const startedAt = Date.now()

    let nextRoom: Room
    try {
      nextRoom = performLocalMove(baseRoom, userId, tokenId)
    } catch (reason) {
      moveInFlightRef.current = false
      setError(reason instanceof Error ? reason.message : 'Something went wrong.')
      return
    }

    const movedToken = nextRoom.game!.tokens.find(
      (candidate) => candidate.playerId === userId && candidate.id === tokenId,
    )
    if (!movedToken) {
      moveInFlightRef.current = false
      return
    }

    const moving: MovingToken = {
      playerId: userId,
      id: tokenId,
      fromProgress,
      dice,
      startedAt,
      targetProgress: movedToken.progress,
    }

    setOptimisticRoom(nextRoom)
    setMovingToken(moving)

    const waitForRoll = () => rollSyncRef.current ?? Promise.resolve()
    const syncMove = moveTokenWithRetry(
      baseRoom.id,
      userId,
      tokenId,
      startedAt,
      movedToken.progress,
      waitForRoll,
    ).then(() => {
      setMoveReadyToClear(true)
    })

    try {
      await Promise.all([
        syncMove,
        new Promise((resolve) =>
          window.setTimeout(resolve, tokenMoveDurationMs(moving)),
        ),
      ])

      if (nextRoom.game?.pendingPower) {
        setMovingToken(null)
        moveInFlightRef.current = false
        await showPowerAndResolve(baseRoom.id, nextRoom)
        return
      }
    } catch (reason) {
      setOptimisticRoom(null)
      setError(reason instanceof Error ? reason.message : 'Failed to sync move.')
    } finally {
      setMovingToken(null)
      moveInFlightRef.current = false
    }
  }, [optimisticRoom, room, userId, showPowerAndResolve])

  useEffect(() => {
    if (
      !displayRoom?.game ||
      displayRoom.status !== 'playing' ||
      displayRoom.game.phase !== 'move' ||
      displayRoom.players[displayRoom.game.turnIndex]?.id !== userId ||
      movingToken ||
      busy ||
      moveInFlightRef.current ||
      rolling
    ) {
      return
    }

    const legalMoves = movableTokens(displayRoom)
    if (legalMoves.length !== 1) return
    const timer = window.setTimeout(
      () => void animateMove(legalMoves[0].id),
      700,
    )
    return () => window.clearTimeout(timer)
  }, [animateMove, busy, displayRoom, movingToken, rolling, userId])

  useEffect(() => {
    const pending = displayRoom?.game?.pendingPower
    if (pending) {
      const player = displayRoom?.players.find(
        (candidate) => candidate.id === pending.playerId,
      )
      setPowerToast({
        type: pending.type,
        playerName: player?.name ?? 'Player',
      })
      return
    }
    if (!powerResolveInFlightRef.current) {
      const timer = window.setTimeout(() => setPowerToast(null), 300)
      return () => window.clearTimeout(timer)
    }
  }, [displayRoom?.game?.pendingPower, displayRoom?.players])

  useEffect(() => {
    const game = room?.game
    if (!game || game.phase !== 'power' || !game.pendingPower || !room) return
    if (room.players[game.turnIndex]?.id !== userId) return
    if (moveInFlightRef.current || powerResolveInFlightRef.current || movingToken) {
      return
    }

    void showPowerAndResolve(room.id, optimisticRoom ?? room)
  }, [room, optimisticRoom, movingToken, showPowerAndResolve, userId])

  const exitRoom = () => {
    localStorage.removeItem('ludo-room')
    setOptimisticRoom(null)
    rollSyncRef.current = null
    moveInFlightRef.current = false
    prevRoomRef.current = null
    remoteAnimSignatureRef.current = null
    setMovingToken(null)
    setMoveReadyToClear(false)
    setLeaveConfirmOpen(false)
    setHostLeaveOpen(false)
    setRemoveConfirm(null)
    setRoomId(null)
    setRoom(null)
  }

  const openLeaveFlow = () => {
    if (!room) return
    const isHost = room.hostId === userId
    const others = room.players
      .filter((player) => player.id !== userId)
      .sort((first, second) => first.seat - second.seat)
    if (isHost && others.length > 0) {
      setNewHostId(others.find((player) => !player.isBot)?.id ?? others[0].id)
      setHostLeaveOpen(true)
      return
    }
    setLeaveConfirmOpen(true)
  }

  const confirmLeave = async () => {
    if (!room) return
    const succeeded = await perform(() => leaveRoom(room.id, userId))
    if (succeeded) exitRoom()
  }

  const confirmHostLeave = async () => {
    if (!room || !newHostId) return
    const succeeded = await perform(() => leaveRoom(room.id, userId, newHostId))
    if (succeeded) exitRoom()
  }

  const confirmRemove = async () => {
    if (!room || !removeConfirm) return
    const target = removeConfirm
    const succeeded = await perform(async () => {
      if (target.kind === 'bot' && target.seat !== undefined) {
        await setSlotBot(room.id, userId, target.seat, false)
      } else {
        await removePlayer(room.id, userId, target.id)
      }
    })
    if (succeeded) setRemoveConfirm(null)
  }

  if (roomId && !room) {
    return (
      <main className="loading-screen">
        {error || 'Reconnecting to room…'}
      </main>
    )
  }

  if (!roomId || !room) {
    const canPlay = Boolean(name.trim()) && (!profile || Boolean(profile.color))
    return (
      <main className="home-screen" onClickCapture={playButtonSound}>
        <section className="hero-panel">
          <div className="home-topbar">
            <div className="brand"><span className="brand-mark">L</span> Ludo Live</div>
            <div className="home-topbar-actions">
              {profile ? (
                <div className="profile-chip">
                  <span
                    className="profile-chip-swatch"
                    style={{ background: profile.color ? resolveColorHex(profile.color) : '#64748b' }}
                  />
                  <strong>{profile.name}</strong>
                  <button type="button" className="text-button" onClick={() => void logoutProfile()}>
                    Log out
                  </button>
                </div>
              ) : (
                <button type="button" className="login-button" onClick={() => setLoginOpen(true)}>
                  Login
                </button>
              )}
              <button className="sound-toggle home-sound" onClick={toggleSound} title={soundOn ? 'Mute sounds' : 'Enable sounds'}>
                {soundOn ? '🔊' : '🔇'}
              </button>
            </div>
          </div>
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
            {profile ? (
              <p className="guest-note">Logged in — your color stays with you in every game.</p>
            ) : (
              <p className="guest-note">Playing as guest. Login is optional.</p>
            )}
            <label>
              Display name
              <input
                value={name}
                maxLength={18}
                onChange={(event) => setName(event.target.value)}
                placeholder="Your name"
              />
            </label>
            {profile ? (
              <div className="color-picker-block">
                <span className="color-picker-label">Your color</span>
                <div className="color-swatches">
                  {PLAYER_COLORS.map((color) => {
                    let takenByOther = false
                    try {
                      const key = normalizeColorKey(color)
                      const owner = colorClaims[key]
                      takenByOther = Boolean(owner && owner !== profile.accountId)
                    } catch {
                      takenByOther = false
                    }
                    return (
                      <button
                        key={color}
                        type="button"
                        className={`color-swatch ${profile.color === color ? 'selected' : ''}`}
                        style={{ background: PLAYER_COLOR_HEX[color] }}
                        disabled={takenByOther}
                        title={takenByOther ? 'Taken' : color}
                        onClick={() => void pickProfileColor(color)}
                      />
                    )
                  })}
                  <label className="color-swatch color-swatch-custom" title="Custom color">
                    <input
                      type="color"
                      value={
                        profile.color?.startsWith('#')
                          ? profile.color
                          : resolveColorHex(profile.color || 'red')
                      }
                      onChange={(event) => void pickProfileColor(event.target.value)}
                    />
                  </label>
                </div>
                {!profile.color ? (
                  <p className="color-hint">Pick a color before joining a room.</p>
                ) : null}
              </div>
            ) : null}
            <div className="join-row">
              <input
                value={joinCode}
                maxLength={6}
                onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
                placeholder="ROOM CODE"
              />
              <button
                disabled={busy || !canPlay || joinCode.length !== 6}
                onClick={() => perform(async () => {
                  rememberName()
                  const joined = await joinRoom(userId, name, joinCode, roomColorOptions)
                  setRoom(joined)
                  setRoomId(joined.id)
                })}
              >Join room</button>
            </div>
            <div className="divider"><span>or host a game</span></div>
            <label>
              Game mode
              <div className="mode-picker">
                <button
                  type="button"
                  className={`mode-option ${gameMode === 'classic' ? 'active' : ''}`}
                  onClick={() => setGameMode('classic')}
                >
                  <strong>Classic</strong>
                  <span>Standard Ludo rules</span>
                </button>
                <button
                  type="button"
                  className={`mode-option ${gameMode === 'power' ? 'active' : ''}`}
                  onClick={() => setGameMode('power')}
                >
                  <strong>Power</strong>
                  <span>+10 surge, rockets, springs & more</span>
                </button>
              </div>
            </label>
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
              disabled={busy || !canPlay}
              onClick={() => perform(async () => {
                rememberName()
                const created = await createRoom(
                  userId,
                  name,
                  maxPlayers,
                  gameMode,
                  roomColorOptions,
                )
                setRoom(created)
                setRoomId(created.id)
              })}
            >Create private room</button>
            {error && <p className="error">{error}</p>}
          </div>
        </section>

        {loginOpen ? (
          <div className="confirm-overlay" onClick={() => setLoginOpen(false)}>
            <div className="confirm-card login-modal" onClick={(event) => event.stopPropagation()}>
              <h2>Login</h2>
              <p>Enter your 4-digit code.</p>
              <input
                className="login-pin-input"
                value={loginPin}
                maxLength={4}
                inputMode="numeric"
                autoFocus
                placeholder="••••"
                onChange={(event) => setLoginPin(event.target.value.replace(/\D/g, '').slice(0, 4))}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && loginPin.length === 4) submitLogin()
                }}
              />
              {loginError ? <p className="error">{loginError}</p> : null}
              <div className="confirm-actions">
                <button type="button" className="ghost-button" onClick={() => setLoginOpen(false)}>
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={loginPin.length !== 4}
                  onClick={submitLogin}
                >
                  Continue
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </main>
    )
  }

  const viewRoom: Room = optimisticRoom ?? room
  const isPowerMode = (viewRoom.gameMode ?? 'classic') === 'power'

  const currentPlayer = viewRoom.game ? viewRoom.players[viewRoom.game.turnIndex] : null
  const isMyTurn = currentPlayer?.id === userId
  const canPickRollFor = (playerId: string) => {
    if (!extraCtrl || viewRoom.status !== 'playing' || !viewRoom.game) return false
    if (viewRoom.game.winnerIds.includes(playerId)) return false
    const turnPlayer = viewRoom.players[viewRoom.game.turnIndex]
    if (turnPlayer?.id === playerId && viewRoom.game.phase !== 'roll') return false
    return true
  }
  const activeRanking = viewRoom.game
    ? [...viewRoom.players].sort((first, second) => {
        const firstPlace = viewRoom.game!.winnerIds.indexOf(first.id)
        const secondPlace = viewRoom.game!.winnerIds.indexOf(second.id)
        return (
          (firstPlace === -1 ? Number.MAX_SAFE_INTEGER : firstPlace) -
          (secondPlace === -1 ? Number.MAX_SAFE_INTEGER : secondPlace)
        )
      }).map((player) => ({ ...player, leftEarly: false as const }))
    : []
  const departedRanking = [...(viewRoom.departedPlayers ?? [])]
    .sort((first, second) => second.leftAt - first.leftAt)
    .map((player) => ({ ...player, leftEarly: true as const }))
  const finalRanking = [...activeRanking, ...departedRanking]
  const playerStats = (playerId: string): PlayerStats =>
    readPlayerStats(viewRoom, playerId)

  const playerNameById = (playerId: string) =>
    [...viewRoom.players, ...(viewRoom.departedPlayers ?? [])].find(
      (player) => player.id === playerId,
    )?.name ?? 'Player'

  const topEliminations = [...viewRoom.players, ...(viewRoom.departedPlayers ?? [])]
    .flatMap((attacker) => {
      const pairs = playerStats(attacker.id).eliminatedPlayers
      return Object.entries(pairs).map(([victimId, count]) => ({
        attackerId: attacker.id,
        attackerName: attacker.name,
        victimId,
        victimName: playerNameById(victimId),
        count,
      }))
    })
    .sort((first, second) => second.count - first.count || first.attackerName.localeCompare(second.attackerName))
    .slice(0, 5)

  const awardPool =
    finalRanking.filter((player) => !player.leftEarly).length > 0
      ? finalRanking.filter((player) => !player.leftEarly)
      : finalRanking
  const liveMotm = viewRoom.game
    ? computeMotm(viewRoom, viewRoom.players)
    : null
  const winOdds = viewRoom.game ? computeWinOdds(viewRoom) : []
  const motm =
    viewRoom.status === 'finished'
      ? computeMotm(viewRoom, awardPool)
      : liveMotm
  const worstPlayer =
    viewRoom.status === 'finished'
      ? computeWorstPlayer(viewRoom, awardPool)
      : null
  const showWorst =
    Boolean(
      worstPlayer &&
        motm &&
        worstPlayer.player.id !== motm.player.id,
    )

  const bannerAction =
    rolling && viewRoom.game?.lastAction?.includes(' rolled ')
      ? 'Rolling dice…'
      : viewRoom.game?.lastAction

  return (
    <main className="room-screen" onClickCapture={playButtonSound}>
      <header className="room-header">
        <div className="brand"><span className="brand-mark small">L</span> Ludo Live</div>
        {room.status === 'playing' && liveMotm ? (
          <div
            className={`live-motm ${playerColorClass(liveMotm.player.color)}`}
            style={playerColorStyle(liveMotm.player.color)}
            title={liveMotm.reason}
          >
            <span className="live-motm-label">MOTM</span>
            <strong>{liveMotm.player.name}</strong>
            <em>({Number.isInteger(liveMotm.score) ? liveMotm.score : liveMotm.score.toFixed(1)})</em>
          </div>
        ) : (
          <div className="room-code">
            Room <strong>{room.code}</strong>
            <button className="icon-button" onClick={copyCode} title="Copy room code">⧉</button>
          </div>
        )}
        <div className="header-actions">
          {room.status === 'playing' ? (
            <div className="room-code room-code--compact">
              <strong>{room.code}</strong>
              <button className="icon-button" onClick={copyCode} title="Copy room code">⧉</button>
            </div>
          ) : null}
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
          <button className="text-button" onClick={openLeaveFlow}>Leave</button>
        </div>
      </header>

      {room.status === 'lobby' ? (
        <section className="lobby">
          <div className="lobby-card">
            <span className="eyebrow">PRIVATE ROOM</span>
            <h1>Waiting for players</h1>
            <p>Share this code with friends anywhere.</p>
            <p className="lobby-mode">
              Mode: <strong>{(room.gameMode ?? 'classic') === 'power' ? 'Power' : 'Classic'}</strong>
            </p>
            <button className="code-display" onClick={copyCode}>{room.code} <span>⧉</span></button>
            <div className="players-grid">
              {Array.from({ length: room.maxPlayers }, (_, index) => {
                const player = room.players.find((candidate) => candidate.seat === index)
                const isHost = room.hostId === userId
                return player ? (
                  <div
                    className={`player-slot ${playerColorClass(player.color)} ${player.isBot ? 'bot' : ''}`}
                    style={playerColorStyle(player.color)}
                    key={player.id}
                  >
                    <span>{player.isBot ? '🤖' : player.name.slice(0, 1).toUpperCase()}</span>
                    <div className="player-slot-copy">
                      <strong>{player.name}</strong>
                      {player.isBot && <em>Bot</em>}
                    </div>
                    {player.id === room.hostId && <small>HOST</small>}
                    {isHost && player.isBot ? (
                      <button
                        type="button"
                        className="slot-action"
                        disabled={busy}
                        onClick={() => setRemoveConfirm({
                          id: player.id,
                          name: player.name,
                          kind: 'bot',
                          seat: index,
                        })}
                      >
                        Remove
                      </button>
                    ) : isHost && player.id !== userId ? (
                      <button
                        type="button"
                        className="slot-action"
                        disabled={busy}
                        onClick={() => setRemoveConfirm({
                          id: player.id,
                          name: player.name,
                          kind: 'player',
                        })}
                      >
                        Remove
                      </button>
                    ) : null}
                  </div>
                ) : (
                  <div className="player-slot empty" key={index}>
                    <span>+</span>
                    <div className="player-slot-copy">
                      <strong>Open seat</strong>
                      <em>Waiting for player</em>
                    </div>
                    {isHost ? (
                      <button
                        type="button"
                        className="slot-action"
                        disabled={busy}
                        onClick={() => perform(async () => {
                          await setSlotBot(room.id, userId, index, true)
                        })}
                      >
                        Add bot
                      </button>
                    ) : null}
                  </div>
                )
              })}
            </div>
            {room.hostId === userId ? (
              <button
                className="start-button"
                disabled={busy || room.players.length < 2}
                onClick={() => perform(() => startRoom(room.id, userId))}
              >Start game ({room.players.length}/{room.maxPlayers})</button>
            ) : <p className="waiting-text">Waiting for the host to start…</p>}
            {room.hostId === userId && (
              <p className="lobby-hint">Fill empty seats with bots or share the room code for friends.</p>
            )}
            {error && <p className="error">{error}</p>}
          </div>
        </section>
      ) : (
        <section className={`game-layout ${isPowerMode ? 'game-layout--power' : ''}`}>
          <aside className="players-panel">
            <h2>Players</h2>
            {viewRoom.players.map((player, index) => {
              const misses = viewRoom.game?.turnMisses?.[player.id] ?? 0
              const missLimit = viewRoom.game
                ? playerTurnMissLimit(viewRoom.game, player.id)
                : MAX_TURN_MISSES
              const isHost = room.hostId === userId
              const hasShield = Boolean(viewRoom.game?.shieldBuff?.[player.id])
              return (
              <div
                key={player.id}
                className={`player-row ${playerColorClass(player.color)} ${viewRoom.game?.turnIndex === index ? 'active' : ''} ${hasShield ? 'has-shield' : ''}`}
                style={playerColorStyle(player.color)}
              >
                <div className="player-row-main">
                <span className="avatar">{player.name[0].toUpperCase()}</span>
                <div>
                  <strong>
                    {player.name}
                    {hasShield ? (
                      <span className="shield-badge" title="Shield active — next capture blocked">
                        🛡
                      </span>
                    ) : null}
                  </strong>
                  <small>
                    {viewRoom.game?.winnerIds.includes(player.id)
                      ? `Finished #${viewRoom.game.winnerIds.indexOf(player.id) + 1}`
                      : player.id === userId
                        ? 'You'
                        : player.isBot
                          ? 'Bot'
                          : 'Online'}
                    {hasShield ? ' · Shield' : ''}
                    {misses > 0 ? ` · ${misses}/${missLimit} misses` : ''}
                  </small>
                </div>
                {isHost && !player.isBot && viewRoom.status === 'playing' ? (
                  <button
                    type="button"
                    className="slot-action player-boost"
                    disabled={busy}
                    title="Give +5 roll chances"
                    onClick={(event) => {
                      event.stopPropagation()
                      void perform(async () => {
                        await grantExtraTurnChances(room.id, userId, player.id, 5)
                      })
                    }}
                  >
                    +5
                  </button>
                ) : null}
                {isHost && player.id !== userId ? (
                  <button
                    type="button"
                    className="slot-action player-remove"
                    disabled={busy}
                    onClick={(event) => {
                      event.stopPropagation()
                      setRemoveConfirm({
                        id: player.id,
                        name: player.name,
                        kind: 'player',
                      })
                    }}
                  >
                    Remove
                  </button>
                ) : null}
                </div>
                {canPickRollFor(player.id) ? (
                  <FaceStrip
                    compact
                    selected={rollPicks[player.id]}
                    onPick={(value) => void pickForPlayer(player.id, value)}
                  />
                ) : null}
              </div>
            )})}
          </aside>

          <div className="game-center">
            <div className="turn-banner">
              <strong>{isMyTurn ? 'Your turn' : `${currentPlayer?.name}'s turn`}</strong>
              <span>{bannerAction}</span>
              {turnSecondsLeft !== null &&
              (viewRoom.game?.phase === 'roll' || viewRoom.game?.phase === 'move') ? (
                <span className={`turn-timer ${turnSecondsLeft <= 5 ? 'urgent' : ''}`}>
                  {viewRoom.game?.phase === 'roll' ? 'Roll' : 'Move'} within {turnSecondsLeft}s
                </span>
              ) : null}
            </div>
            <LudoBoard
              room={viewRoom}
              userId={userId}
              movingToken={movingToken}
              onMove={(tokenId) => void animateMove(tokenId)}
            />
            <PowerToast
              type={powerToast?.type ?? 'star'}
              playerName={powerToast?.playerName ?? ''}
              visible={powerToast !== null}
            />
          </div>

          <aside className="action-panel">
            <span className="eyebrow">TURN CONTROL</span>
            <Dice3D
              value={rolling ? diceFace : displayDice}
              rolling={rolling}
            />
            {isMyTurn && viewRoom.game?.phase === 'roll' ? (
              <button className="roll-button" disabled={busy || rolling} onClick={() => void animateRoll()}>
                Roll dice
              </button>
            ) : viewRoom.game?.phase === 'power' ? (
              <p className="action-hint">Power tile activating…</p>
            ) : isMyTurn ? (
              <p className="action-hint">Choose a glowing token.</p>
            ) : <p className="action-hint">Waiting for {currentPlayer?.name}…</p>}
            {room.hostId === userId &&
            viewRoom.status === 'playing' &&
            viewRoom.game?.phase === 'roll' &&
            currentPlayer &&
            !currentPlayer.isBot ? (
              <button
                type="button"
                className="secondary-button skip-move-timer"
                disabled={busy || rolling}
                onClick={() =>
                  void perform(async () => {
                    await skipRollTimer(room.id, userId)
                  })
                }
              >
                Skip wait · auto-roll
              </button>
            ) : null}
            {room.hostId === userId &&
            viewRoom.status === 'playing' &&
            viewRoom.game?.phase === 'move' &&
            currentPlayer &&
            !currentPlayer.isBot ? (
              <button
                type="button"
                className="secondary-button skip-move-timer"
                disabled={busy || rolling}
                onClick={() =>
                  void perform(async () => {
                    await skipMoveTimer(room.id, userId)
                  })
                }
              >
                Skip wait · auto-move
              </button>
            ) : null}
            <div className="rules">
              <h3>Quick rules</h3>
              <p>Roll 6 to leave the yard.</p>
              <p>Capture and roll 6 for an extra turn.</p>
              <p>A sole active token is protected until one token finishes.</p>
              <p>Ignoring a yard token after rolling 6 forfeits that protection.</p>
              <p>No active tokens: the sixth failed entry attempt guarantees a 6.</p>
              <p>Last token 1–3 steps away: the eighth attempt guarantees the exact roll.</p>
              <p>Three consecutive 6s lose the turn.</p>
              <p>
                Roll within {TURN_ROLL_TIMEOUT_MS / 1000}s or an auto-roll is made. Move within{' '}
                {TURN_MOVE_TIMEOUT_MS / 1000}s or an auto-move is made. Default{' '}
                {MAX_TURN_MISSES} roll misses removes you; host can grant +5 and skip either wait.
              </p>
              <p>Reach home with an exact roll.</p>
              <p className="power-rules-title">
                <strong>Man of the Match:</strong> scored from eliminations, finish place,
                tokens home, sixes, and times eliminated. Highest score wins (not always the champion).
              </p>
            </div>
            {error && <p className="error">{error}</p>}
          </aside>
          {(isPowerMode || room.status === 'playing') && (
            <div className="power-legend-bar">
              <PowerLegend showPowers={isPowerMode} winOdds={winOdds} />
            </div>
          )}
        </section>
      )}

      {removeConfirm && (
        <div
          className="confirm-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Remove player confirmation"
          onClick={() => !busy && setRemoveConfirm(null)}
        >
          <div className="confirm-card" onClick={(event) => event.stopPropagation()}>
            <div className="confirm-icon">!</div>
            <h2>Remove {removeConfirm.name}?</h2>
            <p>
              {removeConfirm.kind === 'bot'
                ? 'This bot will be removed from the lobby.'
                : room.status === 'playing'
                  ? 'Their tokens will be removed. The board layout stays the same.'
                  : 'This player will be removed from the lobby.'}
            </p>
            <div className="confirm-actions">
              <button
                className="cancel-button"
                disabled={busy}
                onClick={() => setRemoveConfirm(null)}
              >
                Cancel
              </button>
              <button
                className="danger-button"
                disabled={busy}
                onClick={() => void confirmRemove()}
              >
                {busy ? 'Removing…' : 'Remove player'}
              </button>
            </div>
          </div>
        </div>
      )}

      {hostLeaveOpen && room && (
        <div
          className="confirm-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Choose new host"
          onClick={() => !busy && setHostLeaveOpen(false)}
        >
          <div className="confirm-card host-leave-card" onClick={(event) => event.stopPropagation()}>
            <div className="confirm-icon">!</div>
            <h2>Choose new host</h2>
            <p>
              You are the host. Pick who should run the room before you leave.
              Your tokens will be removed if the game has started.
            </p>
            <div className="host-picker" role="radiogroup" aria-label="New host">
              {room.players
                .filter((player) => player.id !== userId)
                .sort((first, second) => first.seat - second.seat)
                .map((player) => (
                  <label
                    key={player.id}
                    className={`host-option ${playerColorClass(player.color)} ${newHostId === player.id ? 'selected' : ''}`}
                    style={playerColorStyle(player.color)}
                  >
                    <input
                      type="radio"
                      name="new-host"
                      value={player.id}
                      checked={newHostId === player.id}
                      onChange={() => setNewHostId(player.id)}
                    />
                    <span className="host-option-avatar">
                      {player.isBot ? '🤖' : player.name[0].toUpperCase()}
                    </span>
                    <span className="host-option-copy">
                      <strong>{player.name}</strong>
                      <small>{player.isBot ? 'Bot' : 'Player'}</small>
                    </span>
                  </label>
                ))}
            </div>
            <div className="confirm-actions">
              <button
                className="cancel-button"
                disabled={busy}
                onClick={() => setHostLeaveOpen(false)}
              >
                Stay
              </button>
              <button
                className="danger-button"
                disabled={busy || !newHostId}
                onClick={() => void confirmHostLeave()}
              >
                {busy ? 'Leaving…' : 'Leave game'}
              </button>
            </div>
          </div>
        </div>
      )}

      {leaveConfirmOpen && (
        <div
          className="confirm-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Leave game confirmation"
          onClick={() => !busy && setLeaveConfirmOpen(false)}
        >
          <div className="confirm-card" onClick={(event) => event.stopPropagation()}>
            <div className="confirm-icon">!</div>
            <h2>Leave this game?</h2>
            <p>
              Your tokens will be removed and the remaining players will
              continue without you.
            </p>
            <div className="confirm-actions">
              <button
                className="cancel-button"
                disabled={busy}
                onClick={() => setLeaveConfirmOpen(false)}
              >
                Keep playing
              </button>
              <button
                className="danger-button"
                disabled={busy}
                onClick={() => void confirmLeave()}
              >
                {busy ? 'Leaving…' : 'Leave game'}
              </button>
            </div>
          </div>
        </div>
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
                <div
                  className={`podium-place place-${index + 1} ${playerColorClass(player.color)} ${player.leftEarly ? 'left-early' : ''}`}
                  style={playerColorStyle(player.color)}
                  key={player.id}
                >
                  <span className="medal">{player.leftEarly ? '🚪' : ['🥇', '🥈', '🥉'][index]}</span>
                  <span className="podium-avatar">{player.name[0].toUpperCase()}</span>
                  <strong>{player.name}</strong>
                  <small>
                    {player.leftEarly
                      ? 'LEFT EARLY'
                      : index === 0
                        ? 'CHAMPION'
                        : `PLACE ${index + 1}`}
                  </small>
                  <div className="podium-block">{index + 1}</div>
                </div>
              ))}
            </div>

            {finalRanking.length > 3 && (
              <div className="remaining-places">
                {finalRanking.slice(3).map((player, index) => (
                  <div
                    className={`result-row ${playerColorClass(player.color)} ${player.leftEarly ? 'left-early' : ''}`}
                    style={playerColorStyle(player.color)}
                    key={player.id}
                  >
                    <span className="result-position">#{index + 4}</span>
                    <span className="avatar">{player.name[0].toUpperCase()}</span>
                    <strong>{player.name}</strong>
                    <small>
                      {player.leftEarly
                        ? 'LEFT EARLY'
                        : player.id === userId
                          ? 'YOU'
                          : ''}
                    </small>
                  </div>
                ))}
              </div>
            )}

            {motm ? <MatchAwardCard title="Man of the Match" award={motm} /> : null}
            {showWorst && worstPlayer ? (
              <MatchAwardCard
                title="Worst Player of the Match"
                award={worstPlayer}
                variant="worst"
              />
            ) : null}

            <div className="match-stats">
              <h2>Eliminations</h2>
              {topEliminations.length > 0 ? (
                <ol className="elim-top-list">
                  {topEliminations.map((entry, index) => (
                    <li key={`${entry.attackerId}-${entry.victimId}-${index}`}>
                      <span className="elim-rank">{index + 1}</span>
                      <span className="elim-pair">
                        <strong>{entry.attackerName}</strong> eliminated{' '}
                        <strong>{entry.victimName}</strong>
                      </span>
                      <em className="elim-count">×{entry.count}</em>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="elim-empty">No player eliminations this match.</p>
              )}

              <div className="match-stats-list">
                {finalRanking.map((player) => {
                  const stats = playerStats(player.id)
                  return (
                    <div
                      key={`stats-${player.id}`}
                      className={`match-stats-row ${playerColorClass(player.color)}`}
                      style={playerColorStyle(player.color)}
                    >
                      <div className="match-stats-player">
                        <span className="avatar">{player.name[0].toUpperCase()}</span>
                        <strong>{player.name}</strong>
                      </div>
                      <div className="match-stats-grid match-stats-grid--elim">
                        <span>
                          <em>{stats.captures}</em>
                          Eliminations done
                        </span>
                        <span>
                          <em>{stats.eliminated}</em>
                          Times eliminated
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            <button className="results-button" onClick={exitRoom}>Back to home</button>
          </div>
        </div>
      )}
    </main>
  )
}

export default App
