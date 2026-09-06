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
  playShieldGain,
  playShieldLose,
  playWin,
  playYourTurn,
  setSoundEnabled,
  setSoundVolume,
} from './audio'
import { LudoBoard } from './components/LudoBoard'
import { Dice3D } from './components/Dice3D'
import { GameChat } from './components/GameChat'
import { PlayerAvatar } from './components/PlayerAvatar'
import { ProfilePhotoCropper } from './components/ProfilePhotoCropper'
import { PowerLegend } from './components/PowerLegend'
import { PowerToast } from './components/PowerToast'
import {
  approveSpectate,
  approveJoin,
  claimColor,
  createRoom,
  claimSeat,
  denySpectate,
  denyJoin,
  joinRoom,
  leaveRoom,
  leaveSpectate,
  moveTokenWithRetry,
  releaseColor,
  removePlayer,
  removeSpectator,
  requestSpectate,
  requestJoin,
  resolvePendingPower,
  rollDice,
  setTeams,
  setSlotBot,
  setPlayerAutoPlay,
  setBlitzDuration,
  setQuickTokens,
  setSpectatorAccess,
  extendBlitzTime,
  reduceBlitzTime,
  stopMatch,
  setPlayerColor,
  setOwnPhoto,
  runSeatToss,
  confirmSeatToss,
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
  isAdminAccountId,
  isCareerAccountId,
  isLoginAccountId,
  loadProfile,
  loginWithPin,
  saveProfile,
  saveProfileAsync,
  CAREER_LOGIN_ACCOUNTS,
  type UserProfile,
} from './lib/profile'
import { loadImageFromFile, revokeImageObjectUrl } from './lib/profilePhoto'
import {
  adminSetCareerStats,
  applyHistoryMostLeaders,
  buildElimPairLeaders,
  CAREER_STAT_EDIT_LABELS,
  fetchCareerBoard,
  formatCareerFinishTime,
  isCareerEligibleMatch,
  recordMatchCareerExtras,
  recordMatchMotm,
  recordMatchWins,
  sortCareerBoard,
  sortCareerBoardAscending,
  sortUltimateBoard,
  ultimateScore,
  ULTIMATE_WIN_POINTS,
  type CareerBoardEntry,
  type CareerStatKey,
  type ElimPairLeader,
} from './lib/profileCloud'
import {
  fetchMatchHistory,
  finalizeEligibleMatchHistory,
  formatMostLeaderValue,
  MOST_HISTORY_LABELS,
  type MatchHistoryEntry,
} from './lib/matchHistory'
import {
  clearLiveMatch,
  loadDismissedMatchIds,
  publishLiveMatch,
  saveDismissedMatchIds,
  watchLiveMatches,
  type LiveMatchNotice,
} from './lib/matchNotices'
import { PLAYER_COLOR_HEX, isNamedPlayerColor, normalizeColorKey, resolveColorHex } from './game/colors'
import {
  activeMoveToMovingToken,
  findCaptureVictimIds,
  movableTokens,
  performLocalMove,
  performLocalResolvePower,
  QUICK_TOKEN_OPTIONS,
  TURN_MOVE_TIMEOUT_MS,
  TURN_ROLL_TIMEOUT_MS,
  type QuickTokenCount,
} from './game/engine'
import {
  canTriggerSuper,
  SUPER_USES_PER_GAME,
} from './game/powerUps'
import { computeMotm, computeMotmStandings, computeWorstPlayer, computeWinOdds, rankBlitzPlayers, readPlayerStats, BLITZ_SCORE_RULES, type MotmCandidate } from './game/matchAwards'

function formatCareerMotmPoints(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}
import { PLAYER_COLORS, BLITZ_DURATION_OPTIONS, DEFAULT_BLITZ_DURATION_MS, blitzDurationLabel, canControlSeat, gameModeLabel, hasPowerBoard, isAutoControlled, isBlitzMode, type GameMode, type MovingToken, type PlayerStats, type PowerUpType, type Room, type SpectatorAccess, type TeamAssignMode, type TeamSize } from './game/types'
import {
  isTeamMode,
  teamOfPlayer,
  teamRoomSizes,
} from './game/teams'
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

function CareerLobbyBoard({
  title,
  board,
  roomPlayers,
  statKey,
  formatCount,
  className = '',
  sortEntries,
  formatEntry,
}: {
  title: string
  board: CareerBoardEntry[] | null
  roomPlayers: Room['players']
  statKey: CareerStatKey
  formatCount: (value: number) => string
  className?: string
  sortEntries?: (board: CareerBoardEntry[]) => CareerBoardEntry[]
  formatEntry?: (entry: CareerBoardEntry) => string
}) {
  const ranked = board
    ? (sortEntries ?? ((list) => sortCareerBoard(list, statKey)))(board)
    : null
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

function CareerElimPairsBoard({
  board,
  roomPlayers,
  limit = 8,
}: {
  board: CareerBoardEntry[] | null
  roomPlayers: Room['players']
  limit?: number
}) {
  const leaders: ElimPairLeader[] | null = board
    ? buildElimPairLeaders(board, limit)
    : null
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
                className={`lobby-wins-row ${playerColorClass(entry.attackerColor)} ${attackerInRoom ? 'in-room' : 'away'}`}
                style={playerColorStyle(entry.attackerColor)}
              >
                <span className="lobby-wins-rank">#{index + 1}</span>
                <div className="lobby-wins-meta lobby-elim-pair-meta">
                  <strong className="lobby-wins-name">
                    {entry.attackerName}
                    <span className="lobby-elim-vs"> → </span>
                    {entry.victimName}
                  </strong>
                  <small>
                    {attackerInRoom ? 'Attacker in room' : 'Career total'}
                  </small>
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
        <PlayerAvatar
          name={award.player.name}
          photoUrl={award.player.photoUrl}
          className="motm-avatar"
        />
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
  const [quickTokens, setQuickTokensChoice] = useState<QuickTokenCount>(3)
  const [teamSize, setTeamSize] = useState<TeamSize>(2)
  const [teamAssign, setTeamAssign] = useState<TeamAssignMode>('random')
  const [manualDraft, setManualDraft] = useState<string[][]>([[], []])
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
  const [liveMatchNotices, setLiveMatchNotices] = useState<LiveMatchNotice[]>([])
  const [dismissedMatchIds, setDismissedMatchIds] = useState<string[]>(() =>
    loadDismissedMatchIds(),
  )
  const [matchNoticeOpen, setMatchNoticeOpen] = useState(false)
  const [seatTossDismissedCount, setSeatTossDismissedCount] = useState<number | null>(null)
  const [stopMatchConfirmOpen, setStopMatchConfirmOpen] = useState(false)
  const [colorEditPlayerId, setColorEditPlayerId] = useState<string | null>(null)
  const [cropImage, setCropImage] = useState<HTMLImageElement | null>(null)
  const photoInputRef = useRef<HTMLInputElement>(null)
  const [careerBoard, setCareerBoard] = useState<CareerBoardEntry[] | null>(null)
  const [matchHistory, setMatchHistory] = useState<MatchHistoryEntry[]>([])
  const [matchHistoryOpen, setMatchHistoryOpen] = useState(false)
  const [matchHistoryLoading, setMatchHistoryLoading] = useState(false)
  const [historyExpandedId, setHistoryExpandedId] = useState<string | null>(null)
  const [historyApplyEntry, setHistoryApplyEntry] =
    useState<MatchHistoryEntry | null>(null)
  const [historyApplyBusy, setHistoryApplyBusy] = useState(false)
  const [historyApplyMsg, setHistoryApplyMsg] = useState('')
  const [adminEditOpen, setAdminEditOpen] = useState(false)
  const [adminEditTargetId, setAdminEditTargetId] = useState('')
  const [adminEditDraft, setAdminEditDraft] = useState<
    Partial<Record<CareerStatKey, string>>
  >({})
  const [adminEditMsg, setAdminEditMsg] = useState('')
  const [adminEditBusy, setAdminEditBusy] = useState(false)
  const [colorClaims, setColorClaims] = useState<Record<string, string>>({})
  const [rolling, setRolling] = useState(false)
  const [diceFace, setDiceFace] = useState(1)
  const [displayDice, setDisplayDice] = useState<number | null>(null)
  const [movingToken, setMovingToken] = useState<MovingToken | null>(null)
  const [moveReadyToClear, setMoveReadyToClear] = useState(false)
  const [powerToast, setPowerToast] = useState<{
    type: PowerUpType
    playerName: string
    message?: string
  } | null>(null)
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false)
  const [hostLeaveOpen, setHostLeaveOpen] = useState(false)
  const [newHostId, setNewHostId] = useState('')
  const [removeConfirm, setRemoveConfirm] = useState<RemoveConfirmTarget | null>(null)
  const [turnSecondsLeft, setTurnSecondsLeft] = useState<number | null>(null)
  const [blitzSecondsLeft, setBlitzSecondsLeft] = useState<number | null>(null)
  const [blitzBreakdownOpen, setBlitzBreakdownOpen] = useState(false)
  const [blitzBreakdownTabId, setBlitzBreakdownTabId] = useState<string | null>(null)
  const [motmBreakdownOpen, setMotmBreakdownOpen] = useState(false)
  const [motmBreakdownTabId, setMotmBreakdownTabId] = useState<string | null>(null)
  const [elimBoardOpen, setElimBoardOpen] = useState(false)
  /** Client-side watch flow: pending host approve, or actively watching. */
  const [watchRole, setWatchRole] = useState<
    'pending' | 'watching' | 'join-pending' | null
  >(null)
  const watchRoleRef = useRef<'pending' | 'watching' | 'join-pending' | null>(
    null,
  )
  watchRoleRef.current = watchRole
  const wasSeatPlayerRef = useRef(false)
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
  const prevShieldBuffRef = useRef<Record<string, boolean>>({})
  const shieldSfxPrimedRef = useRef(false)
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
    if (!profile) {
      setLiveMatchNotices([])
      setMatchNoticeOpen(false)
      return
    }
    return watchLiveMatches(setLiveMatchNotices)
  }, [profile?.accountId])

  useEffect(() => {
    if (!room || room.status !== 'finished') return
    void clearLiveMatch(room.id)
  }, [room?.id, room?.status])

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

    let cancelled = false
    const finishedRoom = room

    // Team Power: no career win points — match result only.
    const winnerIds =
      isTeamMode(finishedRoom.gameMode)
        ? []
        : finishedRoom.game.winnerIds[0]
          ? [finishedRoom.game.winnerIds[0]]
          : []
    const awardPool = [
      ...finishedRoom.players.filter((player) => !player.isBot),
      ...(finishedRoom.departedPlayers ?? []).filter((player) => !player.isBot),
    ]
    const motmPlayer = computeMotm(finishedRoom, awardPool)?.player
    const motmId = motmPlayer?.id
    const worstId = computeWorstPlayer(finishedRoom, awardPool)?.player.id ?? null
    const secondId = finishedRoom.game.winnerIds[1] ?? null
    const thirdId = finishedRoom.game.winnerIds[2] ?? null
    const motmById = new Map(
      computeMotmStandings(finishedRoom, awardPool).map((entry) => [
        entry.player.id,
        entry.score,
      ]),
    )
    const deltas = [...finishedRoom.players, ...(finishedRoom.departedPlayers ?? [])]
      .filter((player) => isCareerAccountId(player.id) && !player.isBot)
      .map((player) => {
        const stats = readPlayerStats(finishedRoom, player.id)
        return {
          accountId: player.id,
          eliminations: stats.captures,
          timesEliminated: stats.eliminated,
          sixes: stats.sixes,
          motmPoints: motmById.get(player.id) ?? 0,
          negativePowers: stats.negativePowers ?? 0,
          superPowers: stats.superPowers ?? 0,
          plus3: stats.plus3 ?? 0,
          finishTimeMs: finishedRoom.game?.finishTimesMs?.[player.id] ?? 0,
          elimPairs: Object.fromEntries(
            Object.entries(stats.eliminatedPlayers ?? {}).filter(([victimId]) =>
              isCareerAccountId(victimId),
            ),
          ),
        }
      })

    void (async () => {
      const tasks: Array<Promise<boolean>> = []
      if (winnerIds.some((id) => isCareerAccountId(id))) {
        tasks.push(recordMatchWins(finishedRoom.id, winnerIds))
      }
      if (motmId && isCareerAccountId(motmId)) {
        tasks.push(recordMatchMotm(finishedRoom.id, motmId))
      }
      tasks.push(
        recordMatchCareerExtras(finishedRoom.id, {
          worstId,
          secondId,
          thirdId,
          deltas,
        }),
      )
      await Promise.all(tasks)
      if (cancelled) return

      // Refresh career “most” boards from cloud, then archive leaders + results.
      const board = await finalizeEligibleMatchHistory(finishedRoom)
      if (cancelled || !board) return
      setCareerBoard(board)
    })()

    return () => {
      cancelled = true
    }
  }, [room?.id, room?.status, room?.game?.winnerIds, room?.winningTeamId])

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
    const victims =
      move.willCapture && prevRoomRef.current && roomRef.current
        ? findCaptureVictimIds(prevRoomRef.current, roomRef.current)
        : (move.captureVictimIds ?? [])
    setMovingToken({
      ...move,
      startedAt: Date.now(),
      captureVictimIds: victims.length > 0 ? victims : move.captureVictimIds,
    })
  }, [])

  const showPowerAndResolve = useCallback(async (roomId: string, baseRoom: Room) => {
    const pending = baseRoom.game?.pendingPower
    if (!pending || powerResolveInFlightRef.current) return

    powerResolveInFlightRef.current = true
    const player = baseRoom.players.find((candidate) => candidate.id === pending.playerId)
    const playerName = player?.name ?? 'Player'
    const exhaustedSuper =
      pending.type === 'super' &&
      baseRoom.game != null &&
      !canTriggerSuper(baseRoom.game, pending.playerId)
    setPowerToast({
      type: pending.type,
      playerName,
      message: exhaustedSuper
        ? `${playerName} already used all ${SUPER_USES_PER_GAME} Super leaps`
        : undefined,
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

    const exitToHome = (message?: string) => {
      if (message) setError(message)
      setOptimisticRoom(null)
      localStorage.removeItem('ludo-room')
      setRoomId(null)
      setRoom(null)
      setWatchRole(null)
      wasSeatPlayerRef.current = false
    }

    const restoreRoomNotice = (kickedRoomId: string) => {
      setDismissedMatchIds((prev) => {
        const next = prev.filter((id) => id !== kickedRoomId)
        saveDismissedMatchIds(next)
        return next
      })
    }

    return watchRoom(
      roomId,
      userId,
      (nextRoom) => {
        setRoom(nextRoom)
        if (!nextRoom) {
          exitToHome()
          return
        }
        const asPlayer = nextRoom.players.some((player) => player.id === userId)
        if (asPlayer) {
          wasSeatPlayerRef.current = true
          setWatchRole(null)
          return
        }

        const asWatcher = (nextRoom.spectators ?? []).some(
          (entry) => entry.id === userId,
        )
        const asPendingWatch = (nextRoom.spectatorRequests ?? []).some(
          (entry) => entry.id === userId,
        )
        const asPendingJoin = (nextRoom.joinRequests ?? []).some(
          (entry) => entry.id === userId,
        )

        if (asWatcher) {
          wasSeatPlayerRef.current = false
          setWatchRole('watching')
          return
        }
        if (asPendingWatch) {
          wasSeatPlayerRef.current = false
          setWatchRole('pending')
          return
        }
        if (asPendingJoin) {
          wasSeatPlayerRef.current = false
          setWatchRole('join-pending')
          return
        }

        if (wasSeatPlayerRef.current) {
          restoreRoomNotice(nextRoom.id)
          exitToHome('The host removed you from the room.')
          return
        }

        if (watchRoleRef.current === 'watching' || watchRoleRef.current === 'pending') {
          exitToHome('The host ended your watch session.')
          return
        }
        if (watchRoleRef.current === 'join-pending') {
          restoreRoomNotice(nextRoom.id)
          exitToHome('The host declined your join request.')
          return
        }
      },
      setError,
      (activeMove) => {
        if (activeMove.playerId !== userId && !moveInFlightRef.current) {
          scheduleRemoteMove(activeMoveToMovingToken(activeMove))
        }
      },
      () => {
        exitToHome('The host declined your watch request.')
      },
      (reason) => {
        restoreRoomNotice(roomId)
        exitToHome(
          reason === 'removed'
            ? 'The host removed you from the room.'
            : 'You were removed from the room.',
        )
      },
      () => {
        restoreRoomNotice(roomId)
        exitToHome('The host declined your join request.')
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
    else if (
      action.includes('finished in place') ||
      action.includes('Team wins') ||
      action.includes('teammates home')
    ) {
      playWin()
    }
  }, [displayRoom?.game?.lastAction])

  useEffect(() => {
    shieldSfxPrimedRef.current = false
    prevShieldBuffRef.current = {}
  }, [roomId])

  useEffect(() => {
    const buff = displayRoom?.game?.shieldBuff ?? {}
    const snapshot: Record<string, boolean> = {}
    for (const [id, on] of Object.entries(buff)) {
      snapshot[id] = Boolean(on)
    }
    // Also track players who lost shield (key removed / false).
    for (const id of Object.keys(prevShieldBuffRef.current)) {
      if (!(id in snapshot)) snapshot[id] = false
    }

    if (!shieldSfxPrimedRef.current) {
      shieldSfxPrimedRef.current = true
      prevShieldBuffRef.current = snapshot
      return
    }

    const ids = new Set([
      ...Object.keys(prevShieldBuffRef.current),
      ...Object.keys(snapshot),
    ])
    for (const id of ids) {
      const was = Boolean(prevShieldBuffRef.current[id])
      const now = Boolean(snapshot[id])
      if (!was && now) playShieldGain()
      if (was && !now) playShieldLose()
    }
    prevShieldBuffRef.current = snapshot
  }, [displayRoom?.game?.shieldBuff, displayRoom?.id])

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
      canControlSeat(turnPlayer, userId) &&
      game.phase === 'roll' &&
      !isAutoControlled(turnPlayer)

    if (isMyRoll) {
      const cueKey = `${game.turnIndex}:${game.turnDeadline ?? 0}`
      if (lastYourTurnCue.current !== cueKey) {
        lastYourTurnCue.current = cueKey
        // Only after another player held the turn — skip match-open + own extra turns.
        if (
          previousHolder !== null &&
          previousHolder !== userId &&
          previousHolder !== turnPlayer.controlledBy
        ) {
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

  const openAdminCareerEditor = () => {
    setAdminEditMsg('')
    setAdminEditBusy(false)
    setAdminEditOpen(true)
    void (async () => {
      const board = await fetchCareerBoard()
      setCareerBoard(board)
      const first = board[0]
      const targetId = adminEditTargetId || first?.accountId || ''
      setAdminEditTargetId(targetId)
      const entry = board.find((row) => row.accountId === targetId) ?? first
      if (!entry) {
        setAdminEditDraft({})
        return
      }
      const draft: Partial<Record<CareerStatKey, string>> = {}
      for (const key of Object.keys(CAREER_STAT_EDIT_LABELS) as CareerStatKey[]) {
        draft[key] = String(entry[key] ?? 0)
      }
      setAdminEditDraft(draft)
    })()
  }

  const loadAdminEditTarget = (accountId: string) => {
    setAdminEditTargetId(accountId)
    setAdminEditMsg('')
    const entry = careerBoard?.find((row) => row.accountId === accountId)
    if (!entry) return
    const draft: Partial<Record<CareerStatKey, string>> = {}
    for (const key of Object.keys(CAREER_STAT_EDIT_LABELS) as CareerStatKey[]) {
      draft[key] = String(entry[key] ?? 0)
    }
    setAdminEditDraft(draft)
  }

  const saveAdminCareerStats = () => {
    if (!profile || !isAdminAccountId(profile.accountId) || !adminEditTargetId) return
    setAdminEditBusy(true)
    setAdminEditMsg('')
    void (async () => {
      try {
        const stats: Partial<Record<CareerStatKey, number>> = {}
        for (const key of Object.keys(CAREER_STAT_EDIT_LABELS) as CareerStatKey[]) {
          const raw = adminEditDraft[key]
          if (raw === undefined || raw === '') continue
          const value = Number(raw)
          if (!Number.isFinite(value)) {
            throw new Error(`Invalid value for ${CAREER_STAT_EDIT_LABELS[key]}.`)
          }
          stats[key] = value
        }
        await adminSetCareerStats(profile.accountId, adminEditTargetId, stats)
        const board = await fetchCareerBoard()
        setCareerBoard(board)
        setAdminEditMsg('Saved.')
      } catch (reason) {
        setAdminEditMsg(
          reason instanceof Error ? reason.message : 'Failed to save career stats.',
        )
      } finally {
        setAdminEditBusy(false)
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
  const roomProfileOptions = {
    ...roomColorOptions,
    ...(profile?.photoUrl ? { photoUrl: profile.photoUrl } : {}),
  }

  const applyProfilePhoto = async (dataUrl: string) => {
    if (!profile) return
    const updated: UserProfile = { ...profile, photoUrl: dataUrl }
    await saveProfileAsync(updated)
    setProfile(updated)
    setCropImage(null)
    if (room && room.players.some((player) => player.id === userId)) {
      await setOwnPhoto(room.id, userId, dataUrl)
    }
  }

  const removeProfilePhoto = () => {
    if (!profile) return
    void perform(async () => {
      const updated: UserProfile = { ...profile }
      delete updated.photoUrl
      await saveProfileAsync(updated)
      setProfile(updated)
      if (room && room.players.some((player) => player.id === userId)) {
        await setOwnPhoto(room.id, userId, '')
      }
    })
  }

  const onProfilePhotoFile = (file: File | undefined) => {
    if (!file) return
    void perform(async () => {
      const image = await loadImageFromFile(file)
      setCropImage(image)
    })
  }

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
    if (!canControlSeat(baseRoom.players[baseGame.turnIndex], userId)) {
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
    const turnPlayer = baseRoom.players[baseRoom.game.turnIndex]
    if (!canControlSeat(turnPlayer, userId)) return
    const token = baseRoom.game.tokens.find(
      (candidate) =>
        candidate.playerId === turnPlayer.id && candidate.id === tokenId,
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
      (candidate) =>
        candidate.playerId === turnPlayer.id && candidate.id === tokenId,
    )
    if (!movedToken) {
      moveInFlightRef.current = false
      return
    }

    const willCapture =
      Boolean(nextRoom.game?.lastAction?.includes('captured')) ||
      Boolean(nextRoom.game?.pendingPower?.captured)
    const moving: MovingToken = {
      playerId: turnPlayer.id,
      id: tokenId,
      fromProgress,
      dice,
      startedAt,
      targetProgress: movedToken.progress,
      willCapture,
      captureVictimIds: willCapture
        ? findCaptureVictimIds(baseRoom, nextRoom)
        : undefined,
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
      !canControlSeat(displayRoom.players[displayRoom.game.turnIndex], userId) ||
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
      const playerName = player?.name ?? 'Player'
      const exhaustedSuper =
        pending.type === 'super' &&
        displayRoom?.game != null &&
        !canTriggerSuper(displayRoom.game, pending.playerId)
      setPowerToast({
        type: pending.type,
        playerName,
        message: exhaustedSuper
          ? `${playerName} already used all ${SUPER_USES_PER_GAME} Super leaps`
          : undefined,
      })
      return
    }
    if (!powerResolveInFlightRef.current) {
      const timer = window.setTimeout(() => setPowerToast(null), 300)
      return () => window.clearTimeout(timer)
    }
  }, [displayRoom?.game?.pendingPower, displayRoom?.game, displayRoom?.players])

  useEffect(() => {
    const game = room?.game
    if (!game || game.phase !== 'power' || !game.pendingPower || !room) return
    if (!canControlSeat(room.players[game.turnIndex], userId)) return
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
    setWatchRole(null)
    setRoomId(null)
    setRoom(null)
  }

  const leaveAndExitRoom = () => {
    if (!room) {
      exitRoom()
      return
    }
    const asPlayer = room.players.some((player) => player.id === userId)
    void perform(async () => {
      if (asPlayer) await leaveRoom(room.id, userId)
      else await leaveSpectate(room.id, userId)
      exitRoom()
    })
  }

  const openMatchHistory = () => {
    setMatchHistoryOpen(true)
    setMatchHistoryLoading(true)
    setHistoryApplyMsg('')
    void fetchMatchHistory()
      .then((entries) => setMatchHistory(entries))
      .finally(() => setMatchHistoryLoading(false))
  }

  const confirmApplyHistoryMosts = () => {
    const entry = historyApplyEntry
    if (!entry || !extraCtrl || historyApplyBusy) return
    setHistoryApplyBusy(true)
    setHistoryApplyMsg('')
    void (async () => {
      try {
        const written = await applyHistoryMostLeaders(entry.mostLeaders ?? {})
        if (written <= 0) {
          setHistoryApplyMsg('No most-leader values to apply.')
        } else {
          const board = await fetchCareerBoard()
          setCareerBoard(board)
          setHistoryApplyMsg(
            `Applied most leaders from ${entry.code} to ${written} player${written === 1 ? '' : 's'}.`,
          )
        }
        setHistoryApplyEntry(null)
      } catch (reason) {
        setHistoryApplyMsg(
          reason instanceof Error
            ? reason.message
            : 'Failed to apply history mosts.',
        )
      } finally {
        setHistoryApplyBusy(false)
      }
    })()
  }

  const openLeaveFlow = () => {
    if (!room) return
    if (watchRole || !(room.players.some((player) => player.id === userId))) {
      setLeaveConfirmOpen(true)
      return
    }
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
    const asPlayer = room.players.some((player) => player.id === userId)
    const succeeded = await perform(() =>
      asPlayer
        ? leaveRoom(room.id, userId)
        : leaveSpectate(room.id, userId),
    )
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
    const visibleMatchNotices = liveMatchNotices.filter(
      (notice) =>
        !dismissedMatchIds.includes(notice.roomId) &&
        notice.hostId !== profile?.accountId,
    )
    const dismissMatchNotice = (roomIdToDismiss: string) => {
      setDismissedMatchIds((prev) => {
        const next = [...prev, roomIdToDismiss]
        saveDismissedMatchIds(next)
        return next
      })
    }
    const joinMatchFromNotice = (notice: LiveMatchNotice) => {
      void perform(async () => {
        rememberName()
        setJoinCode(notice.code)
        setMatchNoticeOpen(false)
        if (notice.status === 'playing') {
          const { room: watched, status } = await requestSpectate(
            userId,
            name,
            notice.code,
          )
          setWatchRole(status === 'watching' ? 'watching' : 'pending')
          setRoom(watched)
          setRoomId(watched.id)
          return
        }
        const { room: pendingRoom } = await requestJoin(
          userId,
          name,
          notice.code,
          roomProfileOptions,
        )
        wasSeatPlayerRef.current = false
        setWatchRole('join-pending')
        setRoom(pendingRoom)
        setRoomId(pendingRoom.id)
      })
    }
    return (
      <main className="home-screen" onClickCapture={playButtonSound}>
        <section className="hero-panel">
          <div className="home-topbar">
            <div className="brand"><span className="brand-mark">L</span> Ludo Live</div>
            <div className="home-topbar-actions">
              {profile ? (
                <div className="match-notice-wrap">
                  <button
                    type="button"
                    className={`match-notice-bell ${visibleMatchNotices.length > 0 ? 'has-unread' : ''}`}
                    aria-label={
                      visibleMatchNotices.length > 0
                        ? `${visibleMatchNotices.length} open room notification${visibleMatchNotices.length === 1 ? '' : 's'}`
                        : 'Room notifications'
                    }
                    aria-expanded={matchNoticeOpen}
                    onClick={() => setMatchNoticeOpen((open) => !open)}
                  >
                    <span aria-hidden="true">🔔</span>
                    {visibleMatchNotices.length > 0 ? (
                      <em className="match-notice-badge">
                        {visibleMatchNotices.length > 9
                          ? '9+'
                          : visibleMatchNotices.length}
                      </em>
                    ) : null}
                  </button>
                  {matchNoticeOpen ? (
                    <div className="match-notice-panel" role="dialog" aria-label="Live matches">
                      <div className="match-notice-panel-head">
                        <strong>Open rooms</strong>
                        <button
                          type="button"
                          className="text-button"
                          onClick={() => setMatchNoticeOpen(false)}
                        >
                          Close
                        </button>
                      </div>
                      {visibleMatchNotices.length === 0 ? (
                        <p className="match-notice-empty">No open rooms right now.</p>
                      ) : (
                        <ul className="match-notice-list">
                          {visibleMatchNotices.map((notice) => (
                            <li key={notice.roomId} className="match-notice-item">
                              <div className="match-notice-copy">
                                <strong>
                                  {notice.status === 'playing'
                                    ? `${notice.hostName} started a match`
                                    : `${notice.hostName} opened a room`}
                                </strong>
                                <small>
                                  {gameModeLabel(notice.gameMode)} ·{' '}
                                  {notice.playerCount}/{notice.maxPlayers} · code{' '}
                                  <em>{notice.code}</em>
                                </small>
                              </div>
                              <div className="match-notice-actions">
                                <button
                                  type="button"
                                  className="match-notice-join"
                                  disabled={busy || !canPlay}
                                  onClick={() => joinMatchFromNotice(notice)}
                                >
                                  {notice.status === 'playing' ? 'Watch match' : 'Ask to join'}
                                </button>
                                <button
                                  type="button"
                                  className="text-button"
                                  onClick={() => dismissMatchNotice(notice.roomId)}
                                >
                                  Dismiss
                                </button>
                              </div>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ) : null}
                </div>
              ) : null}
              {profile ? (
                <div className="profile-chip">
                  <PlayerAvatar
                    name={profile.name}
                    photoUrl={profile.photoUrl}
                    className="profile-chip-avatar"
                    style={
                      profile.photoUrl
                        ? undefined
                        : { background: profile.color ? resolveColorHex(profile.color) : '#64748b' }
                    }
                  />
                  <strong>{profile.name}</strong>
                  {isAdminAccountId(profile.accountId) ? (
                    <button
                      type="button"
                      className="text-button"
                      onClick={openAdminCareerEditor}
                    >
                      Edit most stats
                    </button>
                  ) : null}
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
                <span className="color-picker-label">Profile photo</span>
                <div className="profile-photo-row">
                  <PlayerAvatar
                    name={profile.name}
                    photoUrl={profile.photoUrl}
                    className="profile-photo-preview"
                    style={
                      profile.photoUrl
                        ? undefined
                        : {
                            background: profile.color
                              ? resolveColorHex(profile.color)
                              : '#64748b',
                          }
                    }
                  />
                  <div className="profile-photo-actions">
                    <input
                      ref={photoInputRef}
                      type="file"
                      accept="image/*"
                      hidden
                      onChange={(event) => {
                        const file = event.target.files?.[0]
                        event.target.value = ''
                        onProfilePhotoFile(file)
                      }}
                    />
                    <button
                      type="button"
                      className="secondary-button profile-photo-button"
                      disabled={busy}
                      onClick={() => photoInputRef.current?.click()}
                    >
                      {profile.photoUrl ? 'Change photo' : 'Upload photo'}
                    </button>
                    {profile.photoUrl ? (
                      <button
                        type="button"
                        className="text-button"
                        disabled={busy}
                        onClick={removeProfilePhoto}
                      >
                        Remove
                      </button>
                    ) : null}
                    <p className="color-hint">Cropped square · saved ≤400KB</p>
                  </div>
                </div>
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
                    const claimed = await claimSeat(
                      userId,
                      name,
                      joinCode,
                      seatCode,
                      roomProfileOptions.photoUrl
                        ? { photoUrl: roomProfileOptions.photoUrl }
                        : undefined,
                    )
                    setWatchRole(null)
                    setRoom(claimed)
                    setRoomId(claimed.id)
                    return
                  }
                  const joined = await joinRoom(userId, name, joinCode, roomProfileOptions)
                  setWatchRole(null)
                  setRoom(joined)
                  setRoomId(joined.id)
                })}
              >{seatCode.length === 4 ? 'Reclaim seat' : 'Join room'}</button>
              <button
                type="button"
                className="join-watch-button"
                disabled={busy || !canPlay || joinCode.length !== 6}
                onClick={() => perform(async () => {
                  rememberName()
                  const { room: watched, status } = await requestSpectate(
                    userId,
                    name,
                    joinCode,
                  )
                  setWatchRole(status === 'watching' ? 'watching' : 'pending')
                  setRoom(watched)
                  setRoomId(watched.id)
                })}
              >
                Watch match
              </button>
            </div>
            <p className="join-hint">
              Mid-game: seat code reclaims a player seat. Watch match asks the host to let you look only.
            </p>
            {profile ? (
              <>
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
                      <span>+10 surge, rockets, +3 & more</span>
                    </button>
                    <button
                      type="button"
                      className={`mode-option ${gameMode === 'quick' ? 'active' : ''}`}
                      onClick={() => setGameMode('quick')}
                    >
                      <strong>Quick</strong>
                      <span>Pick token count · capture to start · Super leaps</span>
                    </button>
                    <button
                      type="button"
                      className={`mode-option ${gameMode === 'race' ? 'active' : ''}`}
                      onClick={() => setGameMode('race')}
                    >
                      <strong>Race</strong>
                      <span>No captures · pick tokens · boosts & hazards</span>
                    </button>
                    <button
                      type="button"
                      className={`mode-option ${gameMode === 'blitz' ? 'active' : ''}`}
                      onClick={() => setGameMode('blitz')}
                    >
                      <strong>Blitz</strong>
                      <span>Timed scoring · 4 tokens · pick match length</span>
                    </button>
                    <button
                      type="button"
                      className={`mode-option ${gameMode === 'team' ? 'active' : ''}`}
                      onClick={() => {
                        setGameMode('team')
                        setTeamSize(2)
                        if (![2, 4, 5, 6, 8].includes(maxPlayers)) setMaxPlayers(4)
                      }}
                    >
                      <strong>Team Power</strong>
                      <span>2 tokens each · teams · Super/TNT · no career wins</span>
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
                {gameMode === 'quick' || gameMode === 'race' ? (
                  <label>
                    Tokens per player
                    <select
                      value={quickTokens}
                      onChange={(event) =>
                        setQuickTokensChoice(Number(event.target.value) as QuickTokenCount)
                      }
                    >
                      {QUICK_TOKEN_OPTIONS.map((count) => (
                        <option key={count} value={count}>
                          {count} token{count === 1 ? '' : 's'}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                {gameMode === 'team' ? (
                  <>
                    <label>
                      Team size
                      <select
                        value={teamSize}
                        onChange={(event) => {
                          const next = Number(event.target.value) as TeamSize
                          setTeamSize(next)
                          const sizes = teamRoomSizes(next)
                          if (!sizes.includes(maxPlayers)) setMaxPlayers(sizes[0])
                        }}
                      >
                        <option value={2}>2 players per team</option>
                        <option value={3}>3 players per team</option>
                      </select>
                    </label>
                    <label>
                      Team pick
                      <select
                        value={teamAssign}
                        onChange={(event) =>
                          setTeamAssign(event.target.value as TeamAssignMode)
                        }
                      >
                        <option value="random">Random teams at start</option>
                        <option value="manual">Host picks in lobby</option>
                      </select>
                    </label>
                    <p className="join-hint">
                      5 seats + size 2 → leftover human gets a bot they control.
                    </p>
                  </>
                ) : null}
                <label>
                  Room size
                  <select value={maxPlayers} onChange={(event) => setMaxPlayers(Number(event.target.value))}>
                    {(gameMode === 'team' ? teamRoomSizes(teamSize) : [2, 3, 4, 5, 6, 7, 8]).map((count) => (
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
                        ...roomProfileOptions,
                        ...(gameMode === 'blitz' ? { blitzDurationMs } : {}),
                        ...(gameMode === 'quick' || gameMode === 'race'
                          ? { quickTokens }
                          : {}),
                        ...(gameMode === 'team' ? { teamSize, teamAssign } : {}),
                      },
                    )
                    setRoom(created)
                    setRoomId(created.id)
                  })}
                >Create private room</button>
              </>
            ) : (
              <p className="join-hint host-login-hint">
                Login to create a private room. Anyone can still join or watch with a code.
              </p>
            )}
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

        {adminEditOpen && profile && isAdminAccountId(profile.accountId) ? (
          <div
            className="confirm-overlay"
            onClick={() => !adminEditBusy && setAdminEditOpen(false)}
          >
            <div
              className="confirm-card admin-career-modal"
              onClick={(event) => event.stopPropagation()}
            >
              <h2>Edit career / most stats</h2>
              <p>Set absolute values for any login player. Changes apply to all “most” boards.</p>
              <label className="admin-career-player">
                Player
                <select
                  value={adminEditTargetId}
                  disabled={adminEditBusy}
                  onChange={(event) => loadAdminEditTarget(event.target.value)}
                >
                  {Object.values(CAREER_LOGIN_ACCOUNTS).map((account) => (
                    <option key={account.accountId} value={account.accountId}>
                      {careerBoard?.find((row) => row.accountId === account.accountId)?.name
                        ?? account.defaultName}
                    </option>
                  ))}
                </select>
              </label>
              <div className="admin-career-grid">
                {(Object.keys(CAREER_STAT_EDIT_LABELS) as CareerStatKey[]).map((key) => (
                  <label key={key} className="admin-career-field">
                    {CAREER_STAT_EDIT_LABELS[key]}
                    <input
                      type="number"
                      min={0}
                      step={key === 'motmPoints' ? 0.1 : 1}
                      disabled={adminEditBusy}
                      value={adminEditDraft[key] ?? ''}
                      onChange={(event) =>
                        setAdminEditDraft((prev) => ({
                          ...prev,
                          [key]: event.target.value,
                        }))
                      }
                    />
                  </label>
                ))}
              </div>
              {adminEditMsg ? (
                <p className={adminEditMsg === 'Saved.' ? 'admin-career-ok' : 'error'}>
                  {adminEditMsg}
                </p>
              ) : null}
              <div className="confirm-actions">
                <button
                  type="button"
                  className="ghost-button"
                  disabled={adminEditBusy}
                  onClick={() => setAdminEditOpen(false)}
                >
                  Close
                </button>
                <button
                  type="button"
                  disabled={adminEditBusy || !adminEditTargetId}
                  onClick={saveAdminCareerStats}
                >
                  {adminEditBusy ? 'Saving…' : 'Save stats'}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {cropImage ? (
          <ProfilePhotoCropper
            image={cropImage}
            busy={busy}
            onCancel={() => {
              revokeImageObjectUrl(cropImage)
              setCropImage(null)
            }}
            onApply={async (dataUrl) => {
              const ok = await perform(async () => {
                await applyProfilePhoto(dataUrl)
                revokeImageObjectUrl(cropImage)
              })
              if (!ok) return
            }}
          />
        ) : null}
      </main>
    )
  }

  const viewRoom: Room = optimisticRoom ?? room
  const isSeatPlayer = viewRoom.players.some((player) => player.id === userId)
  const isSpectator =
    !isSeatPlayer &&
    ((viewRoom.spectators ?? []).some((entry) => entry.id === userId) ||
      watchRole === 'watching')
  const isPendingWatch =
    !isSeatPlayer &&
    !isSpectator &&
    ((viewRoom.spectatorRequests ?? []).some((entry) => entry.id === userId) ||
      watchRole === 'pending')
  const isPendingJoin =
    !isSeatPlayer &&
    !isSpectator &&
    !isPendingWatch &&
    ((viewRoom.joinRequests ?? []).some((entry) => entry.id === userId) ||
      watchRole === 'join-pending')
  const isPowerMode = hasPowerBoard(viewRoom.gameMode)
  const isQuickMode = (viewRoom.gameMode ?? 'classic') === 'quick'
  const isRaceMode = (viewRoom.gameMode ?? 'classic') === 'race'
  const isBlitz = isBlitzMode(viewRoom.gameMode)
  const blitzScores = isBlitz && viewRoom.game ? rankBlitzPlayers(viewRoom) : []

  const currentPlayer = viewRoom.game ? viewRoom.players[viewRoom.game.turnIndex] : null
  const isMyTurn =
    !isSpectator &&
    !isPendingWatch &&
    !isPendingJoin &&
    canControlSeat(currentPlayer, userId)
  const myTeam = isTeamMode(viewRoom.gameMode)
    ? teamOfPlayer(viewRoom, userId)
    : null
  const myTeamIndex =
    myTeam && viewRoom.teams
      ? viewRoom.teams.findIndex((team) => team.id === myTeam.id)
      : -1
  const myTeammateNames =
    myTeam?.memberIds
      .map((id) => {
        const player = viewRoom.players.find((entry) => entry.id === id)
        if (!player) return null
        if (player.id === userId) return `${player.name} (you)`
        if (player.controlledBy === userId) return `${player.name} (you control)`
        return player.name
      })
      .filter(Boolean) ?? []
  const teamIndexOf = (playerId: string) => {
    if (!viewRoom.teams?.length) return -1
    return viewRoom.teams.findIndex((team) => team.memberIds.includes(playerId))
  }
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

  const matchEliminations = [...viewRoom.players, ...(viewRoom.departedPlayers ?? [])]
    .flatMap((attacker) => {
      const pairs = playerStats(attacker.id).eliminatedPlayers
      return Object.entries(pairs).map(([victimId, count]) => ({
        attackerId: attacker.id,
        attackerName: attacker.name,
        attackerColor: attacker.color,
        victimId,
        victimName: playerNameById(victimId),
        count,
      }))
    })
    .sort(
      (first, second) =>
        second.count - first.count ||
        first.attackerName.localeCompare(second.attackerName),
    )

  const topEliminations = matchEliminations.slice(0, 8)

  const awardPool =
    finalRanking.filter((player) => !player.leftEarly).length > 0
      ? finalRanking.filter((player) => !player.leftEarly)
      : finalRanking
  const liveMotmStandings =
    viewRoom.game && room.status === 'playing'
      ? computeMotmStandings(viewRoom, viewRoom.players)
      : []
  const liveMotm = liveMotmStandings[0] ?? (
    viewRoom.game ? computeMotm(viewRoom, viewRoom.players) : null
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

  if (isPendingWatch || isPendingJoin) {
    return (
      <main className="room-screen" onClickCapture={playButtonSound}>
        <header className="room-header">
          <div className="brand"><span className="brand-mark small">L</span> Ludo Live</div>
          <div className="room-code">
            Room <strong>{room.code}</strong>
          </div>
          <div className="header-actions">
            <button className="text-button" onClick={openLeaveFlow}>Cancel</button>
          </div>
        </header>
        <section className="lobby">
          <div className="lobby-card">
            <span className="eyebrow">
              {isPendingJoin ? 'JOIN REQUEST' : 'WATCH REQUEST'}
            </span>
            <h1>Waiting for the host</h1>
            <p>
              {isPendingJoin
                ? <>You asked to join room <strong>{room.code}</strong>. The host will accept or decline.</>
                : <>You asked to watch room <strong>{room.code}</strong>. The host will accept or decline.</>}
            </p>
            {error ? <p className="error">{error}</p> : null}
            <button
              type="button"
              className="secondary-button"
              disabled={busy}
              onClick={() => void confirmLeave()}
            >
              Cancel request
            </button>
          </div>
        </section>
        {leaveConfirmOpen && (
          <div
            className="confirm-overlay"
            role="dialog"
            aria-modal="true"
            onClick={() => !busy && setLeaveConfirmOpen(false)}
          >
            <div className="confirm-card" onClick={(event) => event.stopPropagation()}>
              <h2>{isPendingJoin ? 'Cancel join request?' : 'Cancel watch request?'}</h2>
              <div className="confirm-actions">
                <button className="cancel-button" disabled={busy} onClick={() => setLeaveConfirmOpen(false)}>
                  Stay
                </button>
                <button className="danger-button" disabled={busy} onClick={() => void confirmLeave()}>
                  Cancel request
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    )
  }

  return (
    <main className="room-screen" onClickCapture={playButtonSound}>
      <header className="room-header">
        <div className="brand"><span className="brand-mark small">L</span> Ludo Live</div>
        {room.status === 'playing' && isBlitz && (blitzScores[0] || liveMotm) ? (
          <div className="header-live-badges">
            {blitzScores[0] ? (
              <div
                className={`live-motm ${playerColorClass(blitzScores[0].player.color)}`}
                style={playerColorStyle(blitzScores[0].player.color)}
                title={`${blitzScores[0].breakdown.total} pts`}
              >
                <span className="live-motm-label">LEAD</span>
                <strong>{blitzScores[0].player.name}</strong>
                <em>{blitzScores[0].breakdown.total} pts</em>
              </div>
            ) : null}
            {liveMotm ? (
              <div
                className={`live-motm ${playerColorClass(liveMotm.player.color)}`}
                style={playerColorStyle(liveMotm.player.color)}
                title={liveMotm.reason}
              >
                <span className="live-motm-label">MOTM</span>
                <strong>{liveMotm.player.name}</strong>
                <em>{formatAwardScore(liveMotm.score)} pts</em>
              </div>
            ) : null}
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
                <>
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
                  <button
                    type="button"
                    className="blitz-extend-button blitz-reduce-button"
                    disabled={busy || (blitzSecondsLeft !== null && blitzSecondsLeft <= 10)}
                    title="Cut 1 minute from the match clock"
                    onClick={() => {
                      void (async () => {
                        setBusy(true)
                        try {
                          await reduceBlitzTime(room.id, userId)
                        } catch (error) {
                          setError(error instanceof Error ? error.message : 'Could not cut time.')
                        } finally {
                          setBusy(false)
                        }
                      })()
                    }}
                  >
                    −1 min
                  </button>
                </>
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
          {room.status === 'playing' && room.hostId === userId ? (
            <button
              type="button"
              className="text-button stop-match-button"
              disabled={busy}
              onClick={() => setStopMatchConfirmOpen(true)}
            >
              Stop match
            </button>
          ) : null}
          <button className="text-button" onClick={openLeaveFlow}>
            {isSpectator ? 'Stop watching' : 'Leave'}
          </button>
        </div>
      </header>

      {isSpectator ? (
        <div className="spectator-banner" role="status">
          <strong>Watching</strong>
          <span>You can see the match but cannot roll or move.</span>
        </div>
      ) : null}

      {room.status === 'lobby' ? (
        <div className={`lobby-stack ${profile ? 'lobby-stack--career' : ''}`}>
        <section className={`lobby ${profile ? 'lobby--with-wins' : ''}`}>
          {profile ? (
            <CareerLobbyBoard
              className="lobby-motm-board"
              title="Career MotM"
              board={careerBoard}
              roomPlayers={room.players}
              statKey="motm"
              formatCount={(value) => `${value} MotM`}
            />
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
              {room.gameMode === 'quick' || room.gameMode === 'race' ? (
                <>
                  {' '}
                  ·{' '}
                  {room.hostId === userId ? (
                    <label className="lobby-blitz-duration">
                      Tokens
                      <select
                        value={room.quickTokens ?? 3}
                        disabled={busy}
                        onChange={(event) => {
                          const next = Number(event.target.value)
                          void perform(async () => {
                            await setQuickTokens(room.id, userId, next)
                          })
                        }}
                      >
                        {QUICK_TOKEN_OPTIONS.map((count) => (
                          <option key={count} value={count}>
                            {count}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : (
                    <strong>{room.quickTokens ?? 3} tokens</strong>
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
                    {player.isBot ? (
                      <span className="avatar">🤖</span>
                    ) : (
                      <PlayerAvatar
                        name={player.name}
                        photoUrl={player.photoUrl}
                        className="avatar"
                      />
                    )}
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
            {isTeamMode(room.gameMode) ? (
              <div className="team-lobby">
                <p className="lobby-hint">
                  Team · {room.teamSize ?? 2} per side ·{' '}
                  {(room.teamAssign ?? teamAssign) === 'manual'
                    ? 'host picks below'
                    : 'random at start'}
                  {(room.maxPlayers === 5 && (room.teamSize ?? 2) === 2)
                    ? ' · leftover seat gets a controlled bot'
                    : ''}
                </p>
                {room.hostId === userId ? (
                  <>
                    <div className="team-assign-row">
                      <button
                        type="button"
                        className={(room.teamAssign ?? teamAssign) === 'random' ? 'active' : ''}
                        disabled={busy}
                        onClick={() => perform(async () => {
                          setTeamAssign('random')
                          await setTeams(room.id, userId, [], 'random')
                        })}
                      >
                        Random
                      </button>
                      <button
                        type="button"
                        className={(room.teamAssign ?? teamAssign) === 'manual' ? 'active' : ''}
                        disabled={busy}
                        onClick={() => {
                          setTeamAssign('manual')
                          const size = room.teamSize ?? 2
                          const count = Math.ceil(room.players.length / size) || 2
                          setManualDraft(
                            Array.from({ length: Math.max(count, 2) }, (_, index) =>
                              manualDraft[index] ?? [],
                            ),
                          )
                        }}
                      >
                        Manual
                      </button>
                    </div>
                    {(room.teamAssign ?? teamAssign) === 'manual' ? (
                      <div className="team-manual">
                        {manualDraft.map((members, teamIndex) => (
                          <div className="team-manual-card" key={teamIndex}>
                            <strong>Team {teamIndex + 1}</strong>
                            <ul>
                              {members.map((id) => {
                                const player = room.players.find((entry) => entry.id === id)
                                return (
                                  <li key={id}>
                                    {player?.name ?? id.slice(0, 6)}
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setManualDraft((prev) =>
                                          prev.map((list, index) =>
                                            index === teamIndex
                                              ? list.filter((entry) => entry !== id)
                                              : list,
                                          ),
                                        )
                                      }
                                    >
                                      ×
                                    </button>
                                  </li>
                                )
                              })}
                            </ul>
                            <select
                              value=""
                              onChange={(event) => {
                                const id = event.target.value
                                if (!id) return
                                setManualDraft((prev) => {
                                  const cleaned = prev.map((list) =>
                                    list.filter((entry) => entry !== id),
                                  )
                                  cleaned[teamIndex] = [
                                    ...cleaned[teamIndex],
                                    id,
                                  ].slice(0, room.teamSize ?? 2)
                                  return cleaned
                                })
                              }}
                            >
                              <option value="">Add player…</option>
                              {room.players
                                .filter(
                                  (player) =>
                                    !manualDraft.some((list) =>
                                      list.includes(player.id),
                                    ),
                                )
                                .map((player) => (
                                  <option key={player.id} value={player.id}>
                                    {player.name}
                                  </option>
                                ))}
                            </select>
                          </div>
                        ))}
                        <button
                          type="button"
                          className="secondary-button"
                          disabled={busy}
                          onClick={() =>
                            setManualDraft((prev) => [...prev, []])
                          }
                        >
                          + Team
                        </button>
                        <button
                          type="button"
                          className="secondary-button"
                          disabled={busy}
                          onClick={() =>
                            perform(async () => {
                              await setTeams(
                                room.id,
                                userId,
                                manualDraft
                                  .filter((list) => list.length > 0)
                                  .map((memberIds) => ({
                                    id: crypto.randomUUID(),
                                    memberIds,
                                  })),
                                'manual',
                              )
                            })
                          }
                        >
                          Save teams
                        </button>
                      </div>
                    ) : null}
                    {room.teams?.length ? (
                      <div className="team-preview">
                        {room.teams.map((team, index) => (
                          <p key={team.id}>
                            Team {index + 1}:{' '}
                            {team.memberIds
                              .map(
                                (id) =>
                                  room.players.find((player) => player.id === id)
                                    ?.name ?? '?',
                              )
                              .join(' + ')}
                          </p>
                        ))}
                      </div>
                    ) : null}
                  </>
                ) : room.teams?.length ? (
                  <div className="team-preview">
                    {room.teams.map((team, index) => (
                      <p key={team.id}>
                        Team {index + 1}:{' '}
                        {team.memberIds
                          .map(
                            (id) =>
                              room.players.find((player) => player.id === id)
                                ?.name ?? '?',
                          )
                          .join(' + ')}
                      </p>
                    ))}
                  </div>
                ) : (
                  <p className="lobby-hint">Host sets teams before start.</p>
                )}
              </div>
            ) : null}
            {room.hostId === userId ? (
              <>
                {room.players.length >= room.maxPlayers &&
                !room.seatToss?.locked ? (
                  <button
                    type="button"
                    className="secondary-button seat-toss-button"
                    disabled={busy || (room.seatToss?.count ?? 0) >= 3}
                    onClick={() =>
                      void perform(async () => {
                        await runSeatToss(room.id, userId)
                        setSeatTossDismissedCount(null)
                      })
                    }
                  >
                    {(room.seatToss?.count ?? 0) === 0
                      ? 'Toss positions'
                      : (room.seatToss?.count ?? 0) < 3
                        ? `Toss again (${room.seatToss!.count}/3)`
                        : '3 tosses done'}
                  </button>
                ) : null}
                {room.seatToss?.count === 3 && !room.seatToss.locked ? (
                  <button
                    type="button"
                    className="start-button seat-toss-button"
                    disabled={busy}
                    onClick={() =>
                      void perform(async () => {
                        await confirmSeatToss(room.id, userId)
                        setSeatTossDismissedCount(null)
                      })
                    }
                  >
                    Use toss 3 positions
                  </button>
                ) : null}
                {room.seatToss?.current &&
                seatTossDismissedCount === room.seatToss.count ? (
                  <button
                    type="button"
                    className="text-button seat-toss-button"
                    onClick={() => setSeatTossDismissedCount(null)}
                  >
                    Show toss results
                  </button>
                ) : null}
                {room.seatToss?.locked ? (
                  <p className="lobby-hint seat-toss-locked-hint">
                    Positions locked from toss 3. Start when ready.
                  </p>
                ) : null}
                <button
                className="start-button"
                disabled={busy || room.players.length < 2}
                onClick={() => perform(async () => {
                  if (
                    isTeamMode(room.gameMode) &&
                    (room.teamAssign ?? teamAssign) === 'manual' &&
                    manualDraft.some((list) => list.length > 0)
                  ) {
                    await setTeams(
                      room.id,
                      userId,
                      manualDraft
                        .filter((list) => list.length > 0)
                        .map((memberIds) => ({
                          id: crypto.randomUUID(),
                          memberIds,
                        })),
                      'manual',
                    )
                  }
                  const started = await startRoom(room.id, userId)
                  void publishLiveMatch(started)
                })}
              >Start game ({room.players.length}/{room.maxPlayers})</button>
              </>
            ) : isSpectator ? (
              <p className="waiting-text">Watching lobby — waiting for the host to start…</p>
            ) : (
              <p className="waiting-text">Waiting for the host to start…</p>
            )}
            {room.hostId === userId ? (
              <div className="watch-host-panel">
                <p className="power-rules-title"><strong>Join requests</strong></p>
                {(room.joinRequests ?? []).length > 0 ? (
                  <ul className="watch-request-list">
                    {(room.joinRequests ?? []).map((request) => (
                      <li key={request.id}>
                        <strong>{request.name}</strong>
                        <span>wants to join</span>
                        <button
                          type="button"
                          className="slot-action"
                          disabled={busy}
                          onClick={() =>
                            void perform(async () => {
                              await approveJoin(room.id, userId, request.id)
                            })
                          }
                        >
                          Accept
                        </button>
                        <button
                          type="button"
                          className="slot-action danger"
                          disabled={busy}
                          onClick={() =>
                            void perform(async () => {
                              await denyJoin(room.id, userId, request.id)
                            })
                          }
                        >
                          Decline
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="lobby-hint">No join requests right now.</p>
                )}
                <p className="power-rules-title"><strong>Watchers</strong></p>
                <label className="lobby-blitz-duration">
                  Who can watch
                  <select
                    value={room.spectatorAccess ?? 'request'}
                    disabled={busy}
                    onChange={(event) => {
                      const access = event.target.value as SpectatorAccess
                      void perform(async () => {
                        await setSpectatorAccess(room.id, userId, access)
                      })
                    }}
                  >
                    <option value="request">Ask host first</option>
                    <option value="open">Anyone with code</option>
                    <option value="off">Off</option>
                  </select>
                </label>
                {(room.spectatorRequests ?? []).length > 0 ? (
                  <ul className="watch-request-list">
                    {(room.spectatorRequests ?? []).map((request) => (
                      <li key={request.id}>
                        <strong>{request.name}</strong>
                        <span>wants to watch</span>
                        <button
                          type="button"
                          className="slot-action"
                          disabled={busy}
                          onClick={() =>
                            void perform(async () => {
                              await approveSpectate(room.id, userId, request.id)
                            })
                          }
                        >
                          Accept
                        </button>
                        <button
                          type="button"
                          className="slot-action danger"
                          disabled={busy}
                          onClick={() =>
                            void perform(async () => {
                              await denySpectate(room.id, userId, request.id)
                            })
                          }
                        >
                          Decline
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="lobby-hint">No watch requests right now.</p>
                )}
                {(room.spectators ?? []).length > 0 ? (
                  <ul className="watch-request-list">
                    {(room.spectators ?? []).map((spectator) => (
                      <li key={spectator.id}>
                        <strong>{spectator.name}</strong>
                        <span>watching</span>
                        <button
                          type="button"
                          className="slot-action danger"
                          disabled={busy}
                          onClick={() =>
                            void perform(async () => {
                              await removeSpectator(room.id, userId, spectator.id)
                            })
                          }
                        >
                          Remove
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
            {room.hostId === userId && (
              <p className="lobby-hint">Fill empty seats with bots or share the room code for friends.</p>
            )}
            {room.hostId === userId ? (
              <button
                type="button"
                className="secondary-button match-history-button"
                disabled={busy || matchHistoryLoading}
                onClick={openMatchHistory}
              >
                {matchHistoryLoading ? 'Loading history…' : 'Match history'}
              </button>
            ) : null}
            {profile && isAdminAccountId(profile.accountId) ? (
              <button
                type="button"
                className="secondary-button"
                onClick={openAdminCareerEditor}
              >
                Edit most stats
              </button>
            ) : null}
            {error && <p className="error">{error}</p>}
          </div>
          {profile ? (
            <CareerLobbyBoard
              title="Career wins"
              board={careerBoard}
              roomPlayers={room.players}
              statKey="wins"
              formatCount={(value) => `${value} ${value === 1 ? 'win' : 'wins'}`}
            />
          ) : null}
        </section>
        {profile ? (
          <section className="lobby-career-more" aria-label="More career stats">
            <h2 className="lobby-career-more-title">More career stats</h2>
            <div className="lobby-career-featured">
              <CareerLobbyBoard
                className="lobby-ultimate-board"
                title="Ultimate player"
                board={careerBoard}
                roomPlayers={room.players}
                statKey="motmPoints"
                sortEntries={sortUltimateBoard}
                formatCount={(value) => `${formatCareerMotmPoints(value)} pts`}
                formatEntry={(entry) => {
                  const points = entry.motmPoints ?? 0
                  const wins = entry.wins ?? 0
                  const total = ultimateScore(entry)
                  return `${formatCareerMotmPoints(total)} (${formatCareerMotmPoints(points)} pts + ${wins}×${ULTIMATE_WIN_POINTS})`
                }}
              />
            </div>
            <div className="lobby-career-grid">
              <CareerLobbyBoard
                title="MotM points total"
                board={careerBoard}
                roomPlayers={room.players}
                statKey="motmPoints"
                formatCount={(value) => `${formatCareerMotmPoints(value)} pts`}
              />
              <CareerLobbyBoard
                title="Matches played"
                board={careerBoard}
                roomPlayers={room.players}
                statKey="matchesPlayed"
                formatCount={(value) =>
                  `${value} ${value === 1 ? 'match' : 'matches'}`
                }
              />
              <CareerLobbyBoard
                title="Worst of the match"
                board={careerBoard}
                roomPlayers={room.players}
                statKey="worst"
                formatCount={(value) => `${value}×`}
              />
              <CareerLobbyBoard
                title="Second place"
                board={careerBoard}
                roomPlayers={room.players}
                statKey="second"
                formatCount={(value) => `${value}×`}
              />
              <CareerLobbyBoard
                title="Third place"
                board={careerBoard}
                roomPlayers={room.players}
                statKey="third"
                formatCount={(value) => `${value}×`}
              />
              <CareerLobbyBoard
                title="Most eliminations"
                board={careerBoard}
                roomPlayers={room.players}
                statKey="eliminations"
                formatCount={(value) => `${value}`}
              />
              <CareerLobbyBoard
                title="Most times eliminated"
                board={careerBoard}
                roomPlayers={room.players}
                statKey="timesEliminated"
                formatCount={(value) => `${value}`}
              />
              <CareerLobbyBoard
                title="Most sixes"
                board={careerBoard}
                roomPlayers={room.players}
                statKey="sixes"
                formatCount={(value) => `${value}`}
              />
              <CareerLobbyBoard
                title="Most Oonjaal"
                board={careerBoard}
                roomPlayers={room.players}
                statKey="negativePowers"
                formatCount={(value) => `${value}`}
              />
              <CareerElimPairsBoard
                board={careerBoard}
                roomPlayers={room.players}
                limit={8}
              />
              <CareerLobbyBoard
                title="Most Super ⚡"
                board={careerBoard}
                roomPlayers={room.players}
                statKey="superPowers"
                formatCount={(value) => `${value}`}
              />
              <CareerLobbyBoard
                title="Most +3"
                board={careerBoard}
                roomPlayers={room.players}
                statKey="plus3"
                formatCount={(value) => `${value}`}
              />
              <CareerLobbyBoard
                title="Fastest finish"
                board={careerBoard}
                roomPlayers={room.players}
                statKey="bestFinishMs"
                sortEntries={(board) =>
                  sortCareerBoardAscending(board, 'bestFinishMs')
                }
                formatCount={(value) => formatCareerFinishTime(value)}
              />
            </div>
          </section>
        ) : null}
        </div>
      ) : (
        <section className={`game-layout ${isPowerMode ? 'game-layout--power' : ''}`}>
          <aside className="players-panel">
            <h2>Players</h2>
            {viewRoom.players.map((player, index) => {
              const isHost = room.hostId === userId
              const hasShield = Boolean(viewRoom.game?.shieldBuff?.[player.id])
              const teamIndex = teamIndexOf(player.id)
              const onMyTeam = Boolean(myTeam?.memberIds.includes(player.id))
              return (
                <div
                  key={player.id}
                  className={`player-row ${playerColorClass(player.color)} ${viewRoom.game?.turnIndex === index ? 'active' : ''} ${hasShield ? 'has-shield' : ''} ${onMyTeam ? 'player-row--ally' : ''}`}
                  style={playerColorStyle(player.color)}
                >
                  <div className="player-row-main">
                    <PlayerAvatar
                      name={player.name}
                      photoUrl={player.photoUrl}
                      className="avatar"
                    />
                    <div className="player-row-copy">
                      <strong>
                        {player.name}
                        {teamIndex >= 0 ? (
                          <span
                            className={`team-chip ${onMyTeam ? 'team-chip--ally' : ''}`}
                            title={onMyTeam ? 'Your teammate' : `Team ${teamIndex + 1}`}
                          >
                            T{teamIndex + 1}
                          </span>
                        ) : null}
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
                            : player.controlledBy === userId
                              ? 'Your bot · you control'
                              : player.isBot
                                ? 'Bot'
                                : [
                                  player.id === userId ? 'You' : null,
                                  onMyTeam && player.id !== userId ? 'Ally' : null,
                                  player.autoPlay ? 'Autoplay' : player.id === userId ? null : 'Online',
                                ]
                                  .filter(Boolean)
                                  .join(' · ') || 'Online'}
                        {isHost && player.rejoinCode ? ` · Seat ${player.rejoinCode}` : ''}
                        {hasShield ? ' · Shield' : ''}
                      </small>
                    </div>
                  </div>
                  {isHost &&
                  (viewRoom.status === 'playing' || player.id !== userId) ? (
                    <div className="player-row-actions">
                      {viewRoom.status === 'playing' ? (
                        <button
                          type="button"
                          className={`slot-action player-color-edit ${colorEditPlayerId === player.id ? 'active' : ''}`}
                          disabled={busy}
                          title="Change this player's color"
                          onClick={(event) => {
                            event.stopPropagation()
                            setColorEditPlayerId((current) =>
                              current === player.id ? null : player.id,
                            )
                          }}
                        >
                          Color
                        </button>
                      ) : null}
                      {!player.isBot && viewRoom.status === 'playing' ? (
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
                      {player.id !== userId ? (
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
                  ) : null}
                  {isHost &&
                  viewRoom.status === 'playing' &&
                  colorEditPlayerId === player.id ? (
                    <div
                      className="player-color-picker"
                      role="group"
                      aria-label={`Color for ${player.name}`}
                    >
                      {PLAYER_COLORS.map((color) => {
                        let takenBy: string | null = null
                        try {
                          const key = normalizeColorKey(color)
                          const owner = viewRoom.players.find((entry) => {
                            if (entry.id === player.id) return false
                            try {
                              return normalizeColorKey(entry.color) === key
                            } catch {
                              return entry.color === key
                            }
                          })
                          takenBy = owner?.name ?? null
                        } catch {
                          takenBy = null
                        }
                        const selected =
                          (() => {
                            try {
                              return normalizeColorKey(player.color) === normalizeColorKey(color)
                            } catch {
                              return player.color === color
                            }
                          })()
                        return (
                          <button
                            key={color}
                            type="button"
                            className={`color-swatch ${selected ? 'selected' : ''}`}
                            style={{ background: PLAYER_COLOR_HEX[color] }}
                            disabled={busy}
                            title={
                              takenBy
                                ? `${color} (swap with ${takenBy})`
                                : color
                            }
                            onClick={() =>
                              void perform(async () => {
                                await setPlayerColor(
                                  room.id,
                                  userId,
                                  player.id,
                                  color,
                                )
                                setColorEditPlayerId(null)
                              })
                            }
                          />
                        )
                      })}
                    </div>
                  ) : null}
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
                <p>Share room + seat code — humans can reclaim left seats (including removed bots).</p>
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
                          {player.isBot ? (
                            '🤖'
                          ) : player.photoUrl ? (
                            <img src={player.photoUrl} alt="" draggable={false} />
                          ) : (
                            player.name[0]?.toUpperCase() ?? '?'
                          )}
                        </span>
                        <div className="reclaim-copy">
                          <strong>{player.name}</strong>
                          <small>
                            Seat {player.seat + 1}
                            {player.isBot ? ' · open for human' : ''}
                          </small>
                        </div>
                        <em className="seat-code-label">{player.rejoinCode ?? '—'}</em>
                      </li>
                    ))}
                </ul>
              </div>
            ) : null}
            {room.hostId === userId ? (
              <div className="watch-host-panel watch-host-panel--game">
                <p className="power-rules-title"><strong>Watchers</strong></p>
                <label className="lobby-blitz-duration">
                  Who can watch
                  <select
                    value={viewRoom.spectatorAccess ?? 'request'}
                    disabled={busy}
                    onChange={(event) => {
                      const access = event.target.value as SpectatorAccess
                      void perform(async () => {
                        await setSpectatorAccess(room.id, userId, access)
                      })
                    }}
                  >
                    <option value="request">Ask host first</option>
                    <option value="open">Anyone with code</option>
                    <option value="off">Off</option>
                  </select>
                </label>
                {(viewRoom.spectatorRequests ?? []).map((request) => (
                  <div key={request.id} className="watch-request-row">
                    <strong>{request.name}</strong>
                    <button
                      type="button"
                      className="slot-action"
                      disabled={busy}
                      onClick={() =>
                        void perform(async () => {
                          await approveSpectate(room.id, userId, request.id)
                        })
                      }
                    >
                      Accept
                    </button>
                    <button
                      type="button"
                      className="slot-action danger"
                      disabled={busy}
                      onClick={() =>
                        void perform(async () => {
                          await denySpectate(room.id, userId, request.id)
                        })
                      }
                    >
                      Decline
                    </button>
                  </div>
                ))}
                {(viewRoom.spectators ?? []).map((spectator) => (
                  <div key={spectator.id} className="watch-request-row">
                    <strong>{spectator.name}</strong>
                    <span>watching</span>
                    <button
                      type="button"
                      className="slot-action danger"
                      disabled={busy}
                      onClick={() =>
                        void perform(async () => {
                          await removeSpectator(room.id, userId, spectator.id)
                        })
                      }
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
          </aside>

          <div className="game-center">
            {room.status === 'playing' && liveMotm && !isBlitz ? (
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
            {myTeam && myTeamIndex >= 0 ? (
              <div className="your-team-banner">
                <span>Your team · T{myTeamIndex + 1}</span>
                <strong>{myTeammateNames.join(' + ')}</strong>
              </div>
            ) : null}
            <LudoBoard
              room={viewRoom}
              userId={userId}
              movingToken={movingToken}
              onMove={(tokenId) => {
                if (isSpectator) return
                void animateMove(tokenId)
              }}
            />
            <PowerToast
              type={powerToast?.type ?? 'star'}
              playerName={powerToast?.playerName ?? ''}
              message={powerToast?.message}
              visible={powerToast !== null}
            />
          </div>

          <aside className="action-panel">
            {isSpectator ? (
              <>
                <span className="eyebrow">SPECTATOR</span>
                <Dice3D
                  value={rolling ? diceFace : displayDice}
                  rolling={rolling}
                />
                <p className="action-hint">
                  Watching live — you can’t roll or move. Current turn:{' '}
                  <strong>{currentPlayer?.name ?? '…'}</strong>
                </p>
              </>
            ) : (
              <>
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
              </>
            )}
            {room.status === 'playing' && viewRoom.game ? (
              <button
                type="button"
                className="blitz-breakdown-open elim-board-open"
                onClick={() => setElimBoardOpen(true)}
              >
                Eliminations
              </button>
            ) : null}
            {isBlitz && room.status === 'playing' ? (
              <div className="blitz-live-panel">
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
                {liveMotmStandings.length > 0 ? (
                  <>
                    <p className="power-rules-title"><strong>MotM standings</strong></p>
                    <ol className="motm-live-board">
                      {liveMotmStandings.map((entry, index) => (
                        <li
                          key={entry.player.id}
                          className={playerColorClass(entry.player.color)}
                          style={playerColorStyle(entry.player.color)}
                        >
                          <span>#{index + 1}</span>
                          <strong>{entry.player.name}</strong>
                          <em>{formatAwardScore(entry.score)}</em>
                        </li>
                      ))}
                    </ol>
                    <button
                      type="button"
                      className="blitz-breakdown-open"
                      onClick={() => {
                        setMotmBreakdownTabId(
                          liveMotmStandings.find((entry) => entry.player.id === userId)?.player.id
                          ?? liveMotmStandings[0]?.player.id
                          ?? null,
                        )
                        setMotmBreakdownOpen(true)
                      }}
                    >
                      MotM point breakdown
                    </button>
                  </>
                ) : null}
              </div>
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
                  <p>No TNT or −5. Super (⚡) leaps halfway to a safe star (max 3 uses per player).</p>
                  <p>Getting all tokens home mid-match does <em>not</em> end the game — keep scoring until the buzzer.</p>
                  <p className="power-rules-title"><strong>How points work</strong></p>
                  <ul className="blitz-score-rules">
                    {BLITZ_SCORE_RULES.map((rule) => (
                      <li key={rule.label}>
                        <strong>{rule.label}</strong> {rule.detail}
                      </li>
                    ))}
                  </ul>
                  <p>Ties break by tokens home, then eliminations, then MotM standings.</p>
                  <p>Roll 6 to leave the yard. Capture and sixes still grant an extra turn.</p>
                  <p>Three consecutive 6s lose the turn. Exact roll needed to finish a token.</p>
                </>
              ) : isRaceMode ? (
                <>
                  <p className="power-rules-title">
                    <strong>Race mode:</strong> pure race to home with boosts and hazards.
                  </p>
                  <p>
                    Each player has {viewRoom.quickTokens ?? 3} token
                    {(viewRoom.quickTokens ?? 3) === 1 ? '' : 's'} (host picks before start).
                  </p>
                  <p>No eliminations from landing on rivals — share the cell and keep racing.</p>
                  <p>Roll 6 to leave the yard.</p>
                  <p>
                    <strong>Boosts:</strong> Rocket, +3, x2, Flame, +10, Super ⚡
                    (halfway leap onto a safe star; max 3 Super uses per player).
                  </p>
                  <p>
                    <strong>Hazards:</strong> ←2 / ←3 / −5, Ice (you slide back 3),
                    Yard (YRD → your start entry) and TNT (you blast to the yard).
                  </p>
                  <p>Three consecutive 6s lose the turn. Exact roll needed to finish a token.</p>
                  <p>
                    Roll within {TURN_ROLL_TIMEOUT_MS / 1000}s or an auto-roll is made. Move within{' '}
                    {TURN_MOVE_TIMEOUT_MS / 1000}s or an auto-move is made. Host can skip either wait.
                  </p>
                  <p>First to get all tokens home wins.</p>
                </>
              ) : isQuickMode ? (
                <>
                  <p className="power-rules-title">
                    <strong>Quick mode:</strong> a faster Power board with a few rule changes.
                  </p>
                  <p>
                    Each player has {viewRoom.quickTokens ?? 3} token
                    {(viewRoom.quickTokens ?? 3) === 1 ? '' : 's'} (host picks before start).
                  </p>
                  <p>Roll 6 to leave the yard.</p>
                  <p>
                    When a token is eliminated, it returns to its colored start square — not the yard —
                    so it can move again without another 6.
                  </p>
                  <p>No TNT or −5 tiles. Two Super (⚡) tiles leap halfway around the board onto a safe star (max 3 uses per player).</p>
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
              {!isBlitz && liveMotmStandings.length > 1 ? (
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
                playerCount={
                  viewRoom.game?.boardPlayerCount ?? viewRoom.maxPlayers
                }
                winOdds={winOdds}
              />
            </div>
          )}
        </section>
      )}

      {!isPendingWatch ? (
        <GameChat
          room={viewRoom}
          userId={userId}
          canSend={isSeatPlayer}
        />
      ) : null}

      {elimBoardOpen && viewRoom.game ? (
        <div
          className="confirm-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Match eliminations"
          onClick={() => setElimBoardOpen(false)}
        >
          <div
            className="confirm-card elim-board-card"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="blitz-breakdown-header">
              <h2>Eliminations</h2>
              <button
                type="button"
                className="text-button"
                onClick={() => setElimBoardOpen(false)}
              >
                Close
              </button>
            </div>
            <p className="elim-board-lead">
              Who eliminated who this match, and how many times.
            </p>
            {matchEliminations.length > 0 ? (
              <ol className="elim-top-list elim-board-list">
                {matchEliminations.map((entry, index) => (
                  <li
                    key={`${entry.attackerId}-${entry.victimId}-${index}`}
                    className={playerColorClass(entry.attackerColor)}
                    style={playerColorStyle(entry.attackerColor)}
                  >
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
              <p className="elim-empty">No eliminations yet this match.</p>
            )}
            <div className="match-stats-list elim-board-totals">
              {[...viewRoom.players, ...(viewRoom.departedPlayers ?? [])].map(
                (player) => {
                  const stats = playerStats(player.id)
                  return (
                    <div
                      key={`elim-live-${player.id}`}
                      className={`match-stats-row ${playerColorClass(player.color)}`}
                      style={playerColorStyle(player.color)}
                    >
                      <div className="match-stats-player">
                        <PlayerAvatar
                          name={player.name}
                          photoUrl={player.photoUrl}
                          className="avatar"
                        />
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
                },
              )}
            </div>
          </div>
        </div>
      ) : null}

      {motmBreakdownOpen && liveMotmStandings.length > 0 ? (
        <div
          className="confirm-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="MotM point breakdown"
          onClick={() => setMotmBreakdownOpen(false)}
        >
          <div
            className="confirm-card blitz-breakdown-card"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="blitz-breakdown-header">
              <h2>MotM point breakdown</h2>
              <button
                type="button"
                className="text-button"
                onClick={() => setMotmBreakdownOpen(false)}
              >
                Close
              </button>
            </div>
            <div className="blitz-breakdown-tabs" role="tablist">
              {liveMotmStandings.map((entry) => (
                <button
                  key={entry.player.id}
                  type="button"
                  role="tab"
                  aria-selected={motmBreakdownTabId === entry.player.id}
                  className={`blitz-breakdown-tab ${playerColorClass(entry.player.color)} ${motmBreakdownTabId === entry.player.id ? 'active' : ''
                    }`}
                  style={playerColorStyle(entry.player.color)}
                  onClick={() => setMotmBreakdownTabId(entry.player.id)}
                >
                  {entry.player.name}
                </button>
              ))}
            </div>
            {(() => {
              const selected =
                liveMotmStandings.find((entry) => entry.player.id === motmBreakdownTabId)
                ?? liveMotmStandings[0]
              if (!selected) return null
              const { breakdown, stats } = selected
              const rows: Array<{
                label: string
                detail: string
                points: number
                negative?: boolean
              }> = [
                {
                  label: 'Eliminations',
                  detail: `${stats.captures} × +3`,
                  points: breakdown.eliminations,
                },
                {
                  label: 'Finish place',
                  detail:
                    selected.place <= 3
                      ? `#${selected.place} (+${breakdown.placeBonus})`
                      : 'Not finished yet',
                  points: breakdown.placeBonus,
                },
                {
                  label: 'Tokens home',
                  detail: `${stats.tokensHome} × +2`,
                  points: breakdown.tokensHome,
                },
                {
                  label: 'Sixes rolled',
                  detail: `${stats.sixes} × +0.5`,
                  points: breakdown.sixes,
                },
                {
                  label: 'Times eliminated',
                  detail: `${stats.eliminated} × −1`,
                  points: -breakdown.timesEliminated,
                  negative: true,
                },
              ]
              return (
                <div className="blitz-breakdown-body">
                  <p className="blitz-breakdown-player">
                    <strong>{selected.player.name}</strong>
                    <em>{formatAwardScore(breakdown.total)} pts</em>
                  </p>
                  <ul className="blitz-breakdown-list">
                    {rows.map((row) => (
                      <li key={row.label}>
                        <div>
                          <strong>{row.label}</strong>
                          <small>{row.detail}</small>
                        </div>
                        <em className={row.negative && row.points < 0 ? 'neg' : ''}>
                          {row.points > 0
                            ? `+${formatAwardScore(row.points)}`
                            : formatAwardScore(row.points)}
                        </em>
                      </li>
                    ))}
                  </ul>
                  <div className="blitz-breakdown-total">
                    <span>Total</span>
                    <strong>{formatAwardScore(breakdown.total)} pts</strong>
                  </div>
                </div>
              )
            })()}
          </div>
        </div>
      ) : null}

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
              {room.status === 'playing'
                ? removeConfirm.kind === 'bot'
                  ? 'Bot tokens leave the board. Share the seat code so a human can reclaim that spot.'
                  : 'Their tokens will be removed. Share the seat code so they (or anyone) can reclaim.'
                : removeConfirm.kind === 'bot'
                  ? 'This bot will be removed from the lobby.'
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
                      {player.isBot ? (
                        '🤖'
                      ) : player.photoUrl ? (
                        <img src={player.photoUrl} alt="" draggable={false} />
                      ) : (
                        player.name[0].toUpperCase()
                      )}
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

      {matchHistoryOpen ? (
        <div
          className="confirm-overlay match-history-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Match history"
          onClick={() => setMatchHistoryOpen(false)}
        >
          <div
            className="confirm-card match-history-card"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="match-history-head">
              <h2>Match history</h2>
              <button
                type="button"
                className="text-button"
                onClick={() => setMatchHistoryOpen(false)}
              >
                Close
              </button>
            </div>
            <p className="match-history-lead">
              Eligible matches (≥3 login players). Each entry stores results and
              the career “most …” leaders after that game.
            </p>
            {matchHistoryLoading ? (
              <p className="match-history-empty">Loading…</p>
            ) : matchHistory.length === 0 ? (
              <p className="match-history-empty">No eligible match history yet.</p>
            ) : (
              <ul className="match-history-list">
                {matchHistory.map((entry) => {
                  const expanded = historyExpandedId === entry.roomId
                  const when = entry.finishedAt
                    ? new Date(entry.finishedAt).toLocaleString()
                    : '—'
                  return (
                    <li key={entry.roomId} className="match-history-item">
                      <button
                        type="button"
                        className="match-history-summary"
                        onClick={() =>
                          setHistoryExpandedId((current) =>
                            current === entry.roomId ? null : entry.roomId,
                          )
                        }
                      >
                        <strong>
                          {entry.gameModeLabel} · {entry.code}
                        </strong>
                        <small>
                          {when} · host {entry.hostName} ·{' '}
                          {entry.loginPlayerCount} login players
                        </small>
                        <span className="match-history-toggle">
                          {expanded ? 'Hide' : 'Details'}
                        </span>
                      </button>
                      {expanded ? (
                        <div className="match-history-details">
                          <div className="match-history-awards">
                            <p>
                              <span>Winner</span>
                              <strong>
                                {entry.winner?.name ?? '—'}
                              </strong>
                            </p>
                            <p>
                              <span>MotM</span>
                              <strong>{entry.motm?.name ?? '—'}</strong>
                            </p>
                            <p>
                              <span>Worst</span>
                              <strong>{entry.worst?.name ?? '—'}</strong>
                            </p>
                          </div>
                          {entry.ranking.length > 0 ? (
                            <ol className="match-history-ranking">
                              {entry.ranking.map((player) => (
                                <li key={`${entry.roomId}-${player.accountId}`}>
                                  #{player.place} {player.name}
                                </li>
                              ))}
                            </ol>
                          ) : null}
                          <h3>Most leaders (after this match)</h3>
                          <ul className="match-history-most">
                            {(
                              Object.keys(MOST_HISTORY_LABELS) as Array<
                                keyof typeof MOST_HISTORY_LABELS
                              >
                            ).map((key) => {
                              const leader = entry.mostLeaders?.[key]
                              return (
                                <li key={`${entry.roomId}-most-${key}`}>
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
                          {extraCtrl ? (
                            <button
                              type="button"
                              className="secondary-button match-history-apply"
                              disabled={historyApplyBusy}
                              onClick={() => {
                                setHistoryApplyMsg('')
                                setHistoryApplyEntry(entry)
                              }}
                            >
                              Apply to most boards
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                    </li>
                  )
                })}
              </ul>
            )}
            {historyApplyMsg ? (
              <p
                className={
                  historyApplyMsg.startsWith('Applied')
                    ? 'match-history-apply-ok'
                    : 'error'
                }
              >
                {historyApplyMsg}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      {historyApplyEntry ? (
        <div
          className="confirm-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Confirm apply most leaders"
          onClick={() => !historyApplyBusy && setHistoryApplyEntry(null)}
        >
          <div
            className="confirm-card"
            onClick={(event) => event.stopPropagation()}
          >
            <h2>Apply most leaders?</h2>
            <p>
              Write the “most …” leader values from match{' '}
              <strong>{historyApplyEntry.code}</strong> (
              {historyApplyEntry.gameModeLabel}) onto the live career most
              boards. Each listed leader’s stat will be set to the value stored
              in this history entry.
            </p>
            <ul className="match-history-apply-preview">
              {(
                Object.keys(MOST_HISTORY_LABELS) as Array<
                  keyof typeof MOST_HISTORY_LABELS
                >
              )
                .filter((key) => {
                  const leader = historyApplyEntry.mostLeaders?.[key]
                  return Boolean(
                    leader &&
                      typeof leader.value === 'number' &&
                      leader.value > 0,
                  )
                })
                .map((key) => {
                  const leader = historyApplyEntry.mostLeaders![key]!
                  return (
                    <li key={`apply-preview-${key}`}>
                      {MOST_HISTORY_LABELS[key]}:{' '}
                      <strong>
                        {leader.name} ·{' '}
                        {formatMostLeaderValue(key, leader.value ?? 0)}
                      </strong>
                    </li>
                  )
                })}
            </ul>
            <div className="confirm-actions">
              <button
                type="button"
                className="ghost-button"
                disabled={historyApplyBusy}
                onClick={() => setHistoryApplyEntry(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={historyApplyBusy}
                onClick={confirmApplyHistoryMosts}
              >
                {historyApplyBusy ? 'Applying…' : 'Confirm apply'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {stopMatchConfirmOpen && room.status === 'playing' ? (
        <div
          className="confirm-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Stop match confirmation"
          onClick={() => !busy && setStopMatchConfirmOpen(false)}
        >
          <div
            className="confirm-card"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="confirm-icon" aria-hidden="true">
              ■
            </div>
            <h2>Stop this match?</h2>
            <p>
              The game ends now. Winners are ranked from the current board
              {isBlitzMode(room.gameMode)
                ? ' (Blitz points).'
                : ' (finishers first, then tokens home / progress).'}
            </p>
            <div className="confirm-actions">
              <button
                className="cancel-button"
                disabled={busy}
                onClick={() => setStopMatchConfirmOpen(false)}
              >
                Keep playing
              </button>
              <button
                className="danger-button"
                disabled={busy}
                onClick={() =>
                  void perform(async () => {
                    await stopMatch(room.id, userId)
                    setStopMatchConfirmOpen(false)
                  })
                }
              >
                Stop & show results
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {room.status === 'lobby' &&
      room.seatToss?.current &&
      seatTossDismissedCount !== room.seatToss.count ? (
        <div
          className="confirm-overlay seat-toss-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Position toss"
          onClick={() => setSeatTossDismissedCount(room.seatToss!.count)}
        >
          <div
            className="confirm-card seat-toss-card"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="seat-toss-head">
              <h2>
                Position toss {room.seatToss.count}/3
                {room.seatToss.locked ? ' · locked' : ''}
              </h2>
              <button
                type="button"
                className="text-button"
                onClick={() => setSeatTossDismissedCount(room.seatToss!.count)}
              >
                Close
              </button>
            </div>
            <p className="seat-toss-lead">
              {room.seatToss.locked
                ? 'Final board seats from toss 3.'
                : room.seatToss.count < 3
                  ? 'Preview only — host must finish all 3 tosses before locking seats.'
                  : 'Toss 3 complete — host can lock these as final positions.'}
            </p>
            <ol className="seat-toss-list">
              {room.seatToss.current.seatOrder.map((playerId, seat) => {
                const player =
                  room.players.find((entry) => entry.id === playerId) ??
                  (room.departedPlayers ?? []).find(
                    (entry) => entry.id === playerId,
                  )
                if (!player) return null
                return (
                  <li
                    key={`toss-${seat}-${playerId}`}
                    className={`seat-toss-row ${playerColorClass(player.color)}`}
                    style={playerColorStyle(player.color)}
                  >
                    <span className="seat-toss-pos">Seat {seat + 1}</span>
                    <PlayerAvatar
                      name={player.name}
                      photoUrl={player.photoUrl}
                      className="avatar"
                    />
                    <strong>{player.name}</strong>
                    {player.isBot ? <small>BOT</small> : null}
                  </li>
                )
              })}
            </ol>
            {room.hostId === userId ? (
              <div className="seat-toss-actions">
                {room.seatToss.count < 3 && !room.seatToss.locked ? (
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={busy}
                    onClick={() =>
                      void perform(async () => {
                        await runSeatToss(room.id, userId)
                        setSeatTossDismissedCount(null)
                      })
                    }
                  >
                    Toss again ({room.seatToss.count}/3)
                  </button>
                ) : null}
                {room.seatToss.count === 3 && !room.seatToss.locked ? (
                  <button
                    type="button"
                    className="start-button seat-toss-confirm"
                    disabled={busy}
                    onClick={() =>
                      void perform(async () => {
                        await confirmSeatToss(room.id, userId)
                        setSeatTossDismissedCount(null)
                      })
                    }
                  >
                    Use these positions
                  </button>
                ) : null}
                {room.seatToss.locked ? (
                  <p className="lobby-hint">Positions locked. You can start the game.</p>
                ) : null}
              </div>
            ) : (
              <p className="lobby-hint">
                {room.seatToss.locked
                  ? 'Host locked these seats.'
                  : room.seatToss.count < 3
                    ? 'Waiting for host to finish 3 tosses…'
                    : 'Waiting for host to lock positions…'}
              </p>
            )}
          </div>
        </div>
      ) : null}

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
            <h2>{isSpectator || isPendingWatch ? 'Stop watching?' : 'Leave this game?'}</h2>
            <p>
              {isSpectator || isPendingWatch
                ? 'You’ll leave as a watcher. The match continues for everyone else.'
                : 'Your tokens will be removed and the remaining players will continue without you.'}
            </p>
            <div className="confirm-actions">
              <button
                className="cancel-button"
                disabled={busy}
                onClick={() => setLeaveConfirmOpen(false)}
              >
                {isSpectator || isPendingWatch ? 'Keep watching' : 'Keep playing'}
              </button>
              <button
                className="danger-button"
                disabled={busy}
                onClick={() => void confirmLeave()}
              >
                {busy
                  ? 'Leaving…'
                  : isSpectator || isPendingWatch
                    ? 'Stop watching'
                    : 'Leave game'}
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
              {room.game?.lastAction?.includes('stopped the match')
                ? isBlitzMode(room.gameMode)
                  ? 'Host stopped the match — ranked by Blitz points.'
                  : 'Host stopped the match — ranked from the current board.'
                : isBlitzMode(room.gameMode)
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
                  <PlayerAvatar
                    name={player.name}
                    photoUrl={player.photoUrl}
                    className="podium-avatar"
                  />
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
                    <PlayerAvatar
                      name={player.name}
                      photoUrl={player.photoUrl}
                      className="avatar"
                    />
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
                        <PlayerAvatar
                          name={player.name}
                          photoUrl={player.photoUrl}
                          className="avatar"
                        />
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

            <button className="results-button" onClick={leaveAndExitRoom}>Back to home</button>
          </div>
        </div>
      )}

      {cropImage ? (
        <ProfilePhotoCropper
          image={cropImage}
          busy={busy}
          onCancel={() => {
            revokeImageObjectUrl(cropImage)
            setCropImage(null)
          }}
          onApply={async (dataUrl) => {
            const ok = await perform(async () => {
              await applyProfilePhoto(dataUrl)
              revokeImageObjectUrl(cropImage)
            })
            if (!ok) return
          }}
        />
      ) : null}
    </main>
  )
}

export default App
