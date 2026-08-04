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
  playYourTurn,
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
  claimSeat,
  joinRoom,
  leaveRoom,
  moveTokenWithRetry,
  releaseColor,
  removePlayer,
  resolvePendingPower,
  rollDice,
  setSlotBot,
  setPlayerAutoPlay,
  setBlitzDuration,
  extendBlitzTime,
  skipMoveTimer,
  skipPowerTimer,
  skipRollTimer,
  startRoom,
  watchColorClaims,
  watchRoom,
} from './game/roomService'
import {
  clearProfile,
  getActiveUserId,
  hydrateProfileFromCloud,
  isLoginAccountId,
  loadProfile,
  loginWithPin,
  saveProfile,
  saveProfileAsync,
  type UserProfile,
} from './lib/profile'
import {
  fetchCareerBoard,
  isCareerEligibleMatch,
  recordMatchMotm,
  recordMatchWin,
  sortMotmBoard,
  type CareerBoardEntry,
} from './lib/profileCloud'
import { PLAYER_COLOR_HEX, isNamedPlayerColor, normalizeColorKey, resolveColorHex } from './game/colors'
import {
  activeMoveToMovingToken,
  movableTokens,
  performLocalMove,
  performLocalResolvePower,
  TURN_MOVE_TIMEOUT_MS,
  TURN_ROLL_TIMEOUT_MS,
} from './game/engine'
import { computeMotm, computeMotmStandings, computeWorstPlayer, computeWinOdds, rankBlitzPlayers, readPlayerStats, BLITZ_SCORE_RULES, type MotmCandidate } from './game/matchAwards'
import { PLAYER_COLORS, BLITZ_DURATION_OPTIONS, DEFAULT_BLITZ_DURATION_MS, blitzDurationLabel, gameModeLabel, hasPowerBoard, isAutoControlled, isBlitzMode, type GameMode, type MovingToken, type PlayerStats, type PowerUpType, type Room } from './game/types'
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
  const [seatCode, setSeatCode] = useState('')
  const [maxPlayers, setMaxPlayers] = useState(6)
  const [gameMode, setGameMode] = useState<GameMode>('classic')
  const [blitzDurationMs, setBlitzDurationMs] = useState(DEFAULT_BLITZ_DURATION_MS)
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
  const [profileSaveMsg, setProfileSaveMsg] = useState('')
  const [careerBoard, setCareerBoard] = useState<CareerBoardEntry[] | null>(null)
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
  const [blitzSecondsLeft, setBlitzSecondsLeft] = useState<number | null>(null)
  const [blitzBreakdownOpen, setBlitzBreakdownOpen] = useState(false)
  const [blitzBreakdownTabId, setBlitzBreakdownTabId] = useState<string | null>(null)
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
  const lastYourTurnCue = useRef<string | null>(null)
  const prevTurnPlayerIdForCue = useRef<string | null>(null)
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
    let cancelled = false
    void (async () => {
      const next = await hydrateProfileFromCloud()
      if (cancelled || !next) return
      setProfile(next)
      setUserId(next.accountId)
      setName(next.name)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!profile || !room || room.status !== 'lobby') {
      setCareerBoard(null)
      return
    }
    let cancelled = false
    void fetchCareerBoard().then((board) => {
      if (!cancelled) setCareerBoard(board)
    })
    return () => {
      cancelled = true
    }
  }, [profile?.accountId, room?.id, room?.status])

  useEffect(() => {
    if (!room || room.status !== 'finished' || !room.game) return
    if (!isCareerEligibleMatch(room)) return

    const winnerId = room.game.winnerIds[0]
    const motmPlayer = computeMotm(room, [
      ...room.players,
      ...(room.departedPlayers ?? []),
    ])?.player
    const motmId = motmPlayer?.id

    if (isLoginAccountId(winnerId)) {
      void recordMatchWin(room.id, winnerId).then((recorded) => {
        if (!recorded) return
        setCareerBoard((prev) => {
          if (!prev) return prev
          return [...prev]
            .map((entry) =>
              entry.accountId === winnerId
                ? { ...entry, wins: entry.wins + 1 }
                : entry,
            )
            .sort((a, b) => b.wins - a.wins || a.name.localeCompare(b.name))
        })
      })
    }

    if (motmId && isLoginAccountId(motmId)) {
      void recordMatchMotm(room.id, motmId).then((recorded) => {
        if (!recorded) return
        setCareerBoard((prev) => {
          if (!prev) return prev
          return [...prev].map((entry) =>
            entry.accountId === motmId
              ? { ...entry, motm: entry.motm + 1 }
              : entry,
          )
        })
      })
    }
  }, [room?.id, room?.status, room?.game?.winnerIds])

  useEffect(() => {
    if (!profile?.color) return
    void claimColor(profile.accountId, profile.color)
      .then(setColorClaims)
      .catch(() => { })
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
    if (!game || !room) return

    const action = game.lastAction
    const rolledMatch = action.match(/\brolled (\d)\b/)
    const isThreeSixes = action.includes('rolled three sixes')
    if (!rolledMatch && !isThreeSixes) return

    const roller = room.players.find((player) => action.startsWith(player.name))
    if (!isAutoControlled(roller) || lastBotRollRef.current === action) return
    lastBotRollRef.current = action

    const finalDice = rolledMatch
      ? Number(rolledMatch[1])
      : (game.lastDice ?? game.dice ?? 6)

    setRolling(true)
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
    const shown = game.dice ?? game.lastDice ?? null
    if (shown) {
      setDisplayDice(shown)
      return
    }
    const rolledMatch = game.lastAction.match(/\brolled (\d)\b/)
    if (rolledMatch) {
      setDisplayDice(Number(rolledMatch[1]))
      return
    }
    if (game.lastAction.includes('rolled three sixes')) {
      setDisplayDice(6)
    }
  }, [
    displayRoom?.game?.phase,
    displayRoom?.game?.dice,
    displayRoom?.game?.lastDice,
    displayRoom?.game?.lastAction,
    rolling,
  ])

  useEffect(() => {
    const action = displayRoom?.game?.lastAction
    if (!action || action === lastSoundAction.current) return
    if (lastSoundAction.current === null) {
      lastSoundAction.current = action
      return
    }
    lastSoundAction.current = action
    if (action.includes('brought a token home')) playHome()
    else if (action.includes('finished in place')) playWin()
  }, [displayRoom?.game?.lastAction])

  // Faa SFX: start as soon as the capturing token begins hopping (preloaded = no lag).
  useEffect(() => {
    if (!movingToken?.startedAt || !movingToken.willCapture) return
    playCapture()
  }, [movingToken])

  // Local-only: desk bell only when turn passes from someone else → you (not extra rolls).
  useEffect(() => {
    const game = displayRoom?.game
    if (!displayRoom || displayRoom.status !== 'playing' || !game) {
      lastYourTurnCue.current = null
      prevTurnPlayerIdForCue.current = null
      return
    }

    const turnPlayer = displayRoom.players[game.turnIndex]
    if (!turnPlayer) return

    const previousHolder = prevTurnPlayerIdForCue.current
    const isMyRoll =
      turnPlayer.id === userId &&
      game.phase === 'roll' &&
      !isAutoControlled(turnPlayer)

    if (isMyRoll) {
      const cueKey = `${game.turnIndex}:${game.turnDeadline ?? 0}`
      if (lastYourTurnCue.current !== cueKey) {
        lastYourTurnCue.current = cueKey
        // Only after another player held the turn — skip match-open + own extra turns.
        if (previousHolder !== null && previousHolder !== userId) {
          playYourTurn()
        }
      }
    }

    if (prevTurnPlayerIdForCue.current !== turnPlayer.id) {
      prevTurnPlayerIdForCue.current = turnPlayer.id
    }
  }, [
    displayRoom?.status,
    displayRoom?.game?.phase,
    displayRoom?.game?.turnIndex,
    displayRoom?.game?.turnDeadline,
    displayRoom?.players,
    userId,
  ])

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
    const game = displayRoom?.game
    if (
      !displayRoom ||
      displayRoom.status !== 'playing' ||
      !isBlitzMode(displayRoom.gameMode) ||
      !game?.endsAt
    ) {
      setBlitzSecondsLeft(null)
      return
    }

    const tick = () => {
      setBlitzSecondsLeft(Math.max(0, Math.ceil((game.endsAt! - Date.now()) / 1000)))
    }
    tick()
    const timer = window.setInterval(tick, 250)
    return () => window.clearInterval(timer)
  }, [displayRoom?.status, displayRoom?.gameMode, displayRoom?.game?.endsAt])

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
    void (async () => {
      try {
        const next = await loginWithPin(loginPin.trim())
        setProfile(next)
        setUserId(next.accountId)
        setName(next.name)
        setLoginOpen(false)
        setLoginPin('')
      } catch (reason) {
        setLoginError(reason instanceof Error ? reason.message : 'Invalid code.')
      }
    })()
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

  const pickProfileColor = (color: string) => {
    if (!profile) return
    setError('')
    setProfileSaveMsg('')
    try {
      const key = normalizeColorKey(color)
      const owner = colorClaims[key]
      if (owner && owner !== profile.accountId) {
        setError('That color is already taken.')
        return
      }
      setProfile({ ...profile, color })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not set color.')
    }
  }

  const saveProfileDetails = () => {
    if (!profile) return
    setError('')
    setProfileSaveMsg('')
    void perform(async () => {
      const nextName = name.trim().slice(0, 18) || profile.name
      if (!profile.color) {
        throw new Error('Pick a color before saving.')
      }
      const claims = await claimColor(profile.accountId, profile.color)
      setColorClaims(claims)
      const updated = { ...profile, name: nextName, color: profile.color }
      await saveProfileAsync(updated)
      setProfile(updated)
      setName(updated.name)
      setProfileSaveMsg('Profile saved')
      window.setTimeout(() => setProfileSaveMsg(''), 2500)
    })
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
      willCapture:
        Boolean(nextRoom.game?.lastAction?.includes('captured')) ||
        Boolean(nextRoom.game?.pendingPower?.captured),
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
                <div className="profile-save-row">
                  <button
                    type="button"
                    className="secondary-button profile-save-button"
                    disabled={busy || !profile.color || !name.trim()}
                    onClick={saveProfileDetails}
                  >
                    Save profile
                  </button>
                  {profileSaveMsg ? (
                    <span className="profile-save-status">{profileSaveMsg}</span>
                  ) : null}
                </div>
              </div>
            ) : null}
            <div className="join-row">
              <input
                value={joinCode}
                maxLength={6}
                onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
                placeholder="ROOM CODE"
              />
              <input
                className="seat-code-input"
                value={seatCode}
                maxLength={4}
                onChange={(event) => setSeatCode(event.target.value.toUpperCase())}
                placeholder="SEAT"
                title="Seat code from host (to rejoin mid-game)"
              />
              <button
                disabled={
                  busy ||
                  !canPlay ||
                  joinCode.length !== 6 ||
                  (seatCode.length > 0 && seatCode.length !== 4)
                }
                onClick={() => perform(async () => {
                  rememberName()
                  if (seatCode.length === 4) {
                    const claimed = await claimSeat(userId, name, joinCode, seatCode)
                    setRoom(claimed)
                    setRoomId(claimed.id)
                    return
                  }
                  const joined = await joinRoom(userId, name, joinCode, roomColorOptions)
                  setRoom(joined)
                  setRoomId(joined.id)
                })}
              >{seatCode.length === 4 ? 'Reclaim seat' : 'Join room'}</button>
            </div>
            <p className="join-hint">
              Mid-game return: ask the host for your seat code, then enter room + seat codes.
            </p>
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
                <button
                  type="button"
                  className={`mode-option ${gameMode === 'quick' ? 'active' : ''}`}
                  onClick={() => setGameMode('quick')}
                >
                  <strong>Quick</strong>
                  <span>3 tokens, capture to start, Super leaps</span>
                </button>
                <button
                  type="button"
                  className={`mode-option ${gameMode === 'race' ? 'active' : ''}`}
                  onClick={() => setGameMode('race')}
                >
                  <strong>Race</strong>
                  <span>4 tokens, no captures — first home wins</span>
                </button>
                <button
                  type="button"
                  className={`mode-option ${gameMode === 'blitz' ? 'active' : ''}`}
                  onClick={() => setGameMode('blitz')}
                >
                  <strong>Blitz</strong>
                  <span>Timed scoring · 4 tokens · pick match length</span>
                </button>
              </div>
            </label>
            {gameMode === 'blitz' ? (
              <label>
                Blitz duration
                <select
                  value={blitzDurationMs}
                  onChange={(event) => setBlitzDurationMs(Number(event.target.value))}
                >
                  {BLITZ_DURATION_OPTIONS.map((option) => (
                    <option key={option.minutes} value={option.minutes * 60_000}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
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
                  {
                    ...roomColorOptions,
                    ...(gameMode === 'blitz' ? { blitzDurationMs } : {}),
                  },
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
  const isPowerMode = hasPowerBoard(viewRoom.gameMode)
  const isQuickMode = (viewRoom.gameMode ?? 'classic') === 'quick'
  const isRaceMode = (viewRoom.gameMode ?? 'classic') === 'race'
  const isBlitz = isBlitzMode(viewRoom.gameMode)
  const blitzScores = isBlitz && viewRoom.game ? rankBlitzPlayers(viewRoom) : []

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
  const liveMotmStandings =
    viewRoom.game && room.status === 'playing' && !isBlitz
      ? computeMotmStandings(viewRoom, viewRoom.players)
      : []
  const liveMotm = liveMotmStandings[0] ?? (
    viewRoom.game && !isBlitz ? computeMotm(viewRoom, viewRoom.players) : null
  )
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
        {room.status === 'playing' && isBlitz && blitzScores[0] ? (
          <div
            className={`live-motm ${playerColorClass(blitzScores[0].player.color)}`}
            style={playerColorStyle(blitzScores[0].player.color)}
            title={`${blitzScores[0].breakdown.total} pts`}
          >
            <span className="live-motm-label">LEAD</span>
            <strong>{blitzScores[0].player.name}</strong>
            <em>{blitzScores[0].breakdown.total} pts</em>
          </div>
        ) : (
          <div className="room-code">
            Room <strong>{room.code}</strong>
            <button className="icon-button" onClick={copyCode} title="Copy room code">⧉</button>
          </div>
        )}
        <div className="header-actions">
          {room.status === 'playing' && isBlitz && blitzSecondsLeft !== null ? (
            <div className={`blitz-clock ${blitzSecondsLeft <= 60 ? 'urgent' : ''}`}>
              <span className="blitz-clock-label">Time</span>
              <strong>
                {Math.floor(blitzSecondsLeft / 60)}:
                {String(blitzSecondsLeft % 60).padStart(2, '0')}
              </strong>
              {room.hostId === userId ? (
                <button
                  type="button"
                  className="blitz-extend-button"
                  disabled={busy}
                  title="Add 5 minutes to the match clock"
                  onClick={() => {
                    void (async () => {
                      setBusy(true)
                      try {
                        await extendBlitzTime(room.id, userId)
                      } catch (error) {
                        setError(error instanceof Error ? error.message : 'Could not add time.')
                      } finally {
                        setBusy(false)
                      }
                    })()
                  }}
                >
                  +5 min
                </button>
              ) : null}
            </div>
          ) : null}
          {room.status === 'playing' && isBlitz ? (
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
        <section className={`lobby ${profile ? 'lobby--with-wins' : ''}`}>
          {profile ? (
            <aside className="lobby-wins-board lobby-motm-board">
              <h3>Career MotM</h3>
              {careerBoard === null ? (
                <p className="lobby-wins-loading">Loading…</p>
              ) : (
                <ol className="lobby-wins-list">
                  {sortMotmBoard(careerBoard).map((entry, index) => {
                    const inRoom = room.players.some(
                      (player) => player.id === entry.accountId,
                    )
                    return (
                      <li
                        key={`motm-${entry.accountId}`}
                        className={`lobby-wins-row ${playerColorClass(entry.color)} ${inRoom ? 'in-room' : 'away'}`}
                        style={playerColorStyle(entry.color)}
                      >
                        <span className="lobby-wins-rank">#{index + 1}</span>
                        <span className="lobby-wins-avatar">
                          {entry.name[0]?.toUpperCase() ?? '?'}
                        </span>
                        <div className="lobby-wins-meta">
                          <strong className="lobby-wins-name">{entry.name}</strong>
                          <small>{inRoom ? 'In room' : 'Not joined'}</small>
                        </div>
                        <em className="lobby-wins-count">
                          {entry.motm} MotM
                        </em>
                      </li>
                    )
                  })}
                </ol>
              )}
            </aside>
          ) : null}
          <div className="lobby-card">
            <span className="eyebrow">PRIVATE ROOM</span>
            <h1>Waiting for players</h1>
            <p>Share this code with friends anywhere.</p>
            <p className="lobby-mode">
              Mode: <strong>{gameModeLabel(room.gameMode)}</strong>
              {isBlitzMode(room.gameMode) ? (
                <>
                  {' '}
                  ·{' '}
                  {room.hostId === userId ? (
                    <label className="lobby-blitz-duration">
                      Time
                      <select
                        value={room.blitzDurationMs ?? DEFAULT_BLITZ_DURATION_MS}
                        disabled={busy}
                        onChange={(event) => {
                          const next = Number(event.target.value)
                          void perform(async () => {
                            await setBlitzDuration(room.id, userId, next)
                          })
                        }}
                      >
                        {BLITZ_DURATION_OPTIONS.map((option) => (
                          <option key={option.minutes} value={option.minutes * 60_000}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : (
                    <strong>{blitzDurationLabel(room.blitzDurationMs)}</strong>
                  )}
                </>
              ) : null}
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
                      {isHost && player.rejoinCode ? (
                        <em className="seat-code-label">Seat {player.rejoinCode}</em>
                      ) : null}
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
          {profile ? (
            <aside className="lobby-wins-board">
              <h3>Career wins</h3>
              {careerBoard === null ? (
                <p className="lobby-wins-loading">Loading…</p>
              ) : (
                <ol className="lobby-wins-list">
                  {careerBoard.map((entry, index) => {
                    const inRoom = room.players.some(
                      (player) => player.id === entry.accountId,
                    )
                    return (
                      <li
                        key={`wins-${entry.accountId}`}
                        className={`lobby-wins-row ${playerColorClass(entry.color)} ${inRoom ? 'in-room' : 'away'}`}
                        style={playerColorStyle(entry.color)}
                      >
                        <span className="lobby-wins-rank">#{index + 1}</span>
                        <span className="lobby-wins-avatar">
                          {entry.name[0]?.toUpperCase() ?? '?'}
                        </span>
                        <div className="lobby-wins-meta">
                          <strong className="lobby-wins-name">{entry.name}</strong>
                          <small>{inRoom ? 'In room' : 'Not joined'}</small>
                        </div>
                        <em className="lobby-wins-count">
                          {entry.wins} {entry.wins === 1 ? 'win' : 'wins'}
                        </em>
                      </li>
                    )
                  })}
                </ol>
              )}
            </aside>
          ) : null}
        </section>
      ) : (
        <section className={`game-layout ${isPowerMode ? 'game-layout--power' : ''}`}>
          <aside className="players-panel">
            <h2>Players</h2>
            {viewRoom.players.map((player, index) => {
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
                        {isBlitz
                          ? `${blitzScores.find((entry) => entry.player.id === player.id)?.breakdown.total ?? 0} pts`
                          : viewRoom.game?.winnerIds.includes(player.id)
                            ? `Finished #${viewRoom.game.winnerIds.indexOf(player.id) + 1}`
                            : player.isBot
                              ? 'Bot'
                              : [
                                player.id === userId ? 'You' : null,
                                player.autoPlay ? 'Autoplay' : player.id === userId ? null : 'Online',
                              ]
                                .filter(Boolean)
                                .join(' · ') || 'Online'}
                        {isHost && player.rejoinCode ? ` · Seat ${player.rejoinCode}` : ''}
                        {hasShield ? ' · Shield' : ''}
                      </small>
                    </div>
                    {isHost &&
                      !player.isBot &&
                      viewRoom.status === 'playing' ? (
                      <button
                        type="button"
                        className={`slot-action player-autoplay ${player.autoPlay ? 'active' : ''}`}
                        disabled={busy}
                        title={
                          player.autoPlay
                            ? player.id === userId
                              ? 'Cancel your autoplay — you play manually again'
                              : 'Cancel autoplay — they play manually again'
                            : player.id === userId
                              ? 'Put yourself on autoplay'
                              : 'Autoplay for them while they are away'
                        }
                        onClick={(event) => {
                          event.stopPropagation()
                          void perform(async () => {
                            await setPlayerAutoPlay(
                              room.id,
                              userId,
                              player.id,
                              !player.autoPlay,
                            )
                          })
                        }}
                      >
                        {player.autoPlay ? 'Cancel auto' : 'Autoplay'}
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
              )
            })}
            {room.hostId === userId &&
              viewRoom.status === 'playing' &&
              (viewRoom.departedPlayers ?? []).some((player) => player.reclaimable) ? (
              <div className="reclaim-panel">
                <h3>Left seats</h3>
                <p>Share room + seat code to reclaim at the same spot.</p>
                <ul className="reclaim-list">
                  {(viewRoom.departedPlayers ?? [])
                    .filter((player) => player.reclaimable)
                    .sort((first, second) => first.seat - second.seat)
                    .map((player) => (
                      <li
                        key={`${player.id}-${player.leftAt}`}
                        className={playerColorClass(player.color)}
                        style={playerColorStyle(player.color)}
                      >
                        <span className="reclaim-avatar">
                          {player.name[0]?.toUpperCase() ?? '?'}
                        </span>
                        <div className="reclaim-copy">
                          <strong>{player.name}</strong>
                          <small>Seat {player.seat + 1}</small>
                        </div>
                        <em className="seat-code-label">{player.rejoinCode ?? '—'}</em>
                      </li>
                    ))}
                </ul>
              </div>
            ) : null}
          </aside>

          <div className="game-center">
            {room.status === 'playing' && liveMotm ? (
              <div
                className={`live-motm live-motm--board ${playerColorClass(liveMotm.player.color)}`}
                style={playerColorStyle(liveMotm.player.color)}
                title={liveMotm.reason}
              >
                <span className="live-motm-label">MOTM</span>
                <strong>{liveMotm.player.name}</strong>
                <em>{formatAwardScore(liveMotm.score)} pts · {liveMotm.reason}</em>
              </div>
            ) : null}
            <div className="turn-banner">
              <strong>{isMyTurn ? 'Your turn' : `${currentPlayer?.name}'s turn`}</strong>
              <span>{bannerAction}</span>
              {turnSecondsLeft !== null &&
                (viewRoom.game?.phase === 'roll' || viewRoom.game?.phase === 'move') &&
                !isAutoControlled(currentPlayer) ? (
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
              <p className="action-hint">
                {viewRoom.game.pendingPower
                  ? `Waiting for ${viewRoom.players.find(
                    (player) => player.id === viewRoom.game!.pendingPower!.playerId,
                  )?.name ?? currentPlayer?.name ?? 'player'
                  }'s power…`
                  : 'Power tile activating…'}
              </p>
            ) : isMyTurn ? (
              <p className="action-hint">Choose a glowing token.</p>
            ) : (
              <p className="action-hint">
                {currentPlayer?.autoPlay
                  ? `${currentPlayer.name} is on autoplay…`
                  : `Waiting for ${currentPlayer?.name}…`}
              </p>
            )}
            {room.hostId === userId &&
              viewRoom.status === 'playing' &&
              viewRoom.game?.phase === 'roll' &&
              currentPlayer &&
              !isAutoControlled(currentPlayer) ? (
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
              !isAutoControlled(currentPlayer) ? (
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
            {room.hostId === userId &&
              viewRoom.status === 'playing' &&
              viewRoom.game?.phase === 'power' &&
              viewRoom.game.pendingPower ? (
              <button
                type="button"
                className="secondary-button skip-move-timer"
                disabled={busy}
                onClick={() =>
                  void perform(async () => {
                    await skipPowerTimer(room.id, userId)
                  })
                }
              >
                Skip wait · apply power
              </button>
            ) : null}
            <div className="rules">
              <h3>Quick rules</h3>
              {isBlitz ? (
                <>
                  <p className="power-rules-title">
                    <strong>Blitz mode:</strong> Quick-style board with a hard{' '}
                    {blitzDurationLabel(viewRoom.blitzDurationMs)} clock.
                    Host can tap <strong>+5 min</strong> any time during the match.
                    When time hits zero the match ends instantly — highest score wins (not necessarily
                    who finished the most tokens first).
                  </p>
                  <p>Each player has 4 tokens. Captures send tokens back to their colored start (not the yard).</p>
                  <p>No TNT or −5. Super (⚡) tiles leap halfway to a safe star.</p>
                  <p>Getting all tokens home mid-match does <em>not</em> end the game — keep scoring until the buzzer.</p>
                  <p className="power-rules-title"><strong>How points work</strong></p>
                  <ul className="blitz-score-rules">
                    {BLITZ_SCORE_RULES.map((rule) => (
                      <li key={rule.label}>
                        <strong>{rule.label}</strong> {rule.detail}
                      </li>
                    ))}
                  </ul>
                  <p>Ties break by tokens home, then eliminations, then name.</p>
                  <p>Roll 6 to leave the yard. Capture and sixes still grant an extra turn.</p>
                  <p>Three consecutive 6s lose the turn. Exact roll needed to finish a token.</p>
                  {blitzScores.length > 0 ? (
                    <>
                      <p className="power-rules-title"><strong>Live scoreboard</strong></p>
                      <ol className="blitz-scoreboard">
                        {blitzScores.map((entry, index) => (
                          <li key={entry.player.id}>
                            <span>#{index + 1}</span>
                            <strong>{entry.player.name}</strong>
                            <em>{entry.breakdown.total} pts</em>
                          </li>
                        ))}
                      </ol>
                      <button
                        type="button"
                        className="blitz-breakdown-open"
                        onClick={() => {
                          setBlitzBreakdownTabId(
                            blitzScores.find((entry) => entry.player.id === userId)?.player.id
                            ?? blitzScores[0]?.player.id
                            ?? null,
                          )
                          setBlitzBreakdownOpen(true)
                        }}
                      >
                        Point breakdown
                      </button>
                    </>
                  ) : null}
                </>
              ) : isRaceMode ? (
                <>
                  <p className="power-rules-title">
                    <strong>Race mode:</strong> Quick-style power board, pure race to home.
                  </p>
                  <p>Each player has 4 tokens.</p>
                  <p>No eliminations — landing on another token does nothing; share the cell and keep racing.</p>
                  <p>Roll 6 to leave the yard.</p>
                  <p>No TNT or −5 tiles. Two Super (⚡) tiles leap halfway around the board onto a safe star.</p>
                  <p>Ice does not push rivals. Roll 6 still grants an extra turn.</p>
                  <p>Three consecutive 6s lose the turn.</p>
                  <p>
                    Roll within {TURN_ROLL_TIMEOUT_MS / 1000}s or an auto-roll is made. Move within{' '}
                    {TURN_MOVE_TIMEOUT_MS / 1000}s or an auto-move is made. Host can skip either wait.
                  </p>
                  <p>First to get all tokens home wins. Reach home with an exact roll.</p>
                </>
              ) : isQuickMode ? (
                <>
                  <p className="power-rules-title">
                    <strong>Quick mode:</strong> a faster Power board with a few rule changes.
                  </p>
                  <p>Each player has 3 tokens (not 4).</p>
                  <p>Roll 6 to leave the yard.</p>
                  <p>
                    When a token is eliminated, it returns to its colored start square — not the yard —
                    so it can move again without another 6.
                  </p>
                  <p>No TNT or −5 tiles. Two Super (⚡) tiles leap halfway around the board onto a safe star.</p>
                  <p>Capture and roll 6 for an extra turn.</p>
                  <p>A sole active token is protected until one token finishes.</p>
                  <p>Three consecutive 6s lose the turn.</p>
                  <p>
                    Roll within {TURN_ROLL_TIMEOUT_MS / 1000}s or an auto-roll is made. Move within{' '}
                    {TURN_MOVE_TIMEOUT_MS / 1000}s or an auto-move is made. Host can skip either wait.
                  </p>
                  <p>Reach home with an exact roll.</p>
                </>
              ) : (
                <>
                  <p>Roll 6 to leave the yard.</p>
                  <p>Capture and roll 6 for an extra turn.</p>
                  <p>A sole active token is protected until one token finishes.</p>
                  <p>Ignoring a yard token after rolling 6 forfeits that protection.</p>
                  <p>No active tokens: the sixth failed entry attempt guarantees a 6.</p>
                  <p>Last token 1–3 steps away: the eighth attempt guarantees the exact roll.</p>
                  <p>Three consecutive 6s lose the turn.</p>
                  <p>
                    Roll within {TURN_ROLL_TIMEOUT_MS / 1000}s or an auto-roll is made. Move within{' '}
                    {TURN_MOVE_TIMEOUT_MS / 1000}s or an auto-move is made. Host can skip either wait.
                  </p>
                  <p>Reach home with an exact roll.</p>
                </>
              )}
              <p className="power-rules-title">
                <strong>Man of the Match:</strong> scored from eliminations, finish place,
                tokens home, sixes, and times eliminated. Highest score wins (not always the champion).
              </p>
              {liveMotmStandings.length > 1 ? (
                <>
                  <p className="power-rules-title"><strong>Live MotM points</strong></p>
                  <ol className="motm-live-board">
                    {liveMotmStandings.slice(1).map((entry, index) => (
                      <li
                        key={entry.player.id}
                        className={playerColorClass(entry.player.color)}
                        style={playerColorStyle(entry.player.color)}
                      >
                        <span>#{index + 2}</span>
                        <strong>{entry.player.name}</strong>
                        <em>{formatAwardScore(entry.score)}</em>
                      </li>
                    ))}
                  </ol>
                </>
              ) : null}
            </div>
            {error && <p className="error">{error}</p>}
          </aside>
          {(isPowerMode || room.status === 'playing') && (
            <div className="power-legend-bar">
              <PowerLegend
                showPowers={isPowerMode}
                gameMode={viewRoom.gameMode}
                winOdds={winOdds}
              />
            </div>
          )}
        </section>
      )}

      {blitzBreakdownOpen && isBlitz && blitzScores.length > 0 ? (
        <div
          className="confirm-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Blitz point breakdown"
          onClick={() => setBlitzBreakdownOpen(false)}
        >
          <div
            className="confirm-card blitz-breakdown-card"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="blitz-breakdown-header">
              <h2>Point breakdown</h2>
              <button
                type="button"
                className="text-button"
                onClick={() => setBlitzBreakdownOpen(false)}
              >
                Close
              </button>
            </div>
            <div className="blitz-breakdown-tabs" role="tablist">
              {blitzScores.map((entry) => (
                <button
                  key={entry.player.id}
                  type="button"
                  role="tab"
                  aria-selected={blitzBreakdownTabId === entry.player.id}
                  className={`blitz-breakdown-tab ${playerColorClass(entry.player.color)} ${blitzBreakdownTabId === entry.player.id ? 'active' : ''
                    }`}
                  style={playerColorStyle(entry.player.color)}
                  onClick={() => setBlitzBreakdownTabId(entry.player.id)}
                >
                  {entry.player.name}
                </button>
              ))}
            </div>
            {(() => {
              const selected =
                blitzScores.find((entry) => entry.player.id === blitzBreakdownTabId)
                ?? blitzScores[0]
              if (!selected) return null
              const { breakdown, stats } = selected
              const rows: Array<{
                label: string
                detail: string
                points: number
                negative?: boolean
              }> = [
                  {
                    label: 'Tokens home',
                    detail: `${stats.tokensHome} × +15`,
                    points: breakdown.tokensHome,
                  },
                  {
                    label: 'Eliminations',
                    detail: `${stats.captures} × +5`,
                    points: breakdown.eliminations,
                  },
                  {
                    label: 'Times eliminated',
                    detail: `${stats.eliminated} × −3`,
                    points: -breakdown.eliminatedPenalty,
                    negative: true,
                  },
                  {
                    label: 'Sixes rolled',
                    detail: `${stats.sixes} × +1`,
                    points: breakdown.sixes,
                  },
                  {
                    label: 'Board progress',
                    detail: 'Unfinished tokens (+0–8 each)',
                    points: breakdown.boardProgress,
                  },
                  {
                    label: 'All home bonus',
                    detail: 'All 4 tokens finished',
                    points: breakdown.allHomeBonus,
                  },
                  {
                    label: 'Lead token bonus',
                    detail: 'Farthest token on board',
                    points: breakdown.leadTokenBonus,
                  },
                ]
              return (
                <div className="blitz-breakdown-body">
                  <p className="blitz-breakdown-player">
                    <strong>{selected.player.name}</strong>
                    <em>{breakdown.total} pts</em>
                  </p>
                  <ul className="blitz-breakdown-list">
                    {rows.map((row) => (
                      <li key={row.label}>
                        <div>
                          <strong>{row.label}</strong>
                          <small>{row.detail}</small>
                        </div>
                        <em className={row.negative && row.points < 0 ? 'neg' : ''}>
                          {row.points > 0 ? `+${row.points}` : row.points}
                        </em>
                      </li>
                    ))}
                  </ul>
                  <div className="blitz-breakdown-total">
                    <span>Total</span>
                    <strong>{breakdown.total} pts</strong>
                  </div>
                </div>
              )
            })()}
          </div>
        </div>
      ) : null}

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
              {room.status === 'playing'
                ? ' Your tokens leave the board; the host can still share your seat code to reclaim.'
                : ''}
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
            <p className="results-subtitle">
              {isBlitzMode(room.gameMode)
                ? 'Time expired — ranked by Blitz points!'
                : 'A champion has conquered the board!'}
            </p>

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
                      : isBlitzMode(room.gameMode)
                        ? `${rankBlitzPlayers(room).find((entry) => entry.player.id === player.id)?.breakdown.total ?? 0} PTS`
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
