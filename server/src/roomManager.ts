/**
 * In-memory room store and game actions.
 * Reuses the shared rules engine from src/game/engine.ts.
 */
import {
  applyMove,
  applyPendingPower,
  applyRoll,
  applyRollMisses,
  createGame,
  getBoardPlayerCount,
  normalizeQuickTokenCount,
  pickBestMovableToken,
  resolveDiceValue,
  TURN_ROLL_TIMEOUT_MS,
} from '../../src/game/engine.js'
import { sanitizePowerTiles } from '../../src/game/powerUps.js'
import { PLAYER_COLORS, canControlSeat, isAutoControlled, isBlitzMode, normalizeBlitzDurationMs, BLITZ_EXTEND_MS, type Room, type Team, type TeamAssignMode, type TeamSize } from '../../src/game/types.js'
import {
  buildRandomTeams,
  buildSequentialTeams,
  isTeamMode,
  normalizeTeamAssign,
  normalizeTeamSize,
  teamRoomSizes,
  validateTeamAssignment,
} from '../../src/game/teams.js'
import { finalizeBlitzGame } from '../../src/game/matchAwards.js'
import { normalizeColorKey } from '../../src/game/colors.js'

const rooms = new Map<string, Room>()
const codeIndex = new Map<string, string>()
const rollHints = new Map<string, Record<string, number>>()
/** colorKey -> accountId */
const colorClaims = new Map<string, string>()

function shuffleInPlace<T>(items: T[]) {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const randomIndex =
      crypto.getRandomValues(new Uint32Array(1))[0] % (index + 1)
    ;[items[index], items[randomIndex]] = [items[randomIndex], items[index]]
  }
  return items
}

function usedColorsInRoom(room: Room, exceptUserId?: string) {
  return new Set(
    room.players
      .filter((player) => player.id !== exceptUserId)
      .map((player) => {
        try {
          return normalizeColorKey(player.color)
        } catch {
          return player.color
        }
      }),
  )
}

function nextFreePresetColor(room: Room, exceptUserId?: string) {
  const used = usedColorsInRoom(room, exceptUserId)
  for (const color of PLAYER_COLORS) {
    const key = normalizeColorKey(color)
    if (used.has(key)) continue
    const owner = colorClaims.get(key)
    if (owner && owner !== exceptUserId) continue
    return color
  }
  for (const color of PLAYER_COLORS) {
    if (!used.has(normalizeColorKey(color))) return color
  }
  return PLAYER_COLORS[room.players.length % PLAYER_COLORS.length]
}

export function listColorClaims() {
  return Object.fromEntries(colorClaims.entries())
}

export function claimPlayerColor(accountId: string, color: string) {
  const key = normalizeColorKey(color)
  const owner = colorClaims.get(key)
  if (owner && owner !== accountId) {
    throw new Error('That color is already taken.')
  }
  for (const [claimed, ownerId] of colorClaims) {
    if (ownerId === accountId && claimed !== key) colorClaims.delete(claimed)
  }
  colorClaims.set(key, accountId)
  return listColorClaims()
}

export function releasePlayerColor(accountId: string) {
  for (const [claimed, ownerId] of colorClaims) {
    if (ownerId === accountId) colorClaims.delete(claimed)
  }
  return listColorClaims()
}

function resolveJoinColor(
  room: Room,
  userId: string,
  preferredColor?: string,
  lockColor?: boolean,
) {
  if (preferredColor && lockColor) {
    const key = normalizeColorKey(preferredColor)
    const claimOwner = colorClaims.get(key)
    if (claimOwner && claimOwner !== userId) {
      throw new Error('That color is already taken.')
    }
    const used = usedColorsInRoom(room, userId)
    if (used.has(key)) {
      throw new Error('That color is already used in this room.')
    }
    if (!claimOwner) colorClaims.set(key, userId)
    return { color: preferredColor, colorLocked: true as const }
  }
  return {
    color: nextFreePresetColor(room, userId),
    colorLocked: false as const,
  }
}

function clearRollHints(roomId: string) {
  rollHints.delete(roomId)
}

export function consumeRollHint(roomId: string, playerId: string) {
  const hints = rollHints.get(roomId)
  if (!hints || hints[playerId] === undefined) return null
  const dice = hints[playerId]
  delete hints[playerId]
  if (Object.keys(hints).length === 0) rollHints.delete(roomId)
  return dice
}

function queueRollHint(roomId: string, playerId: string, dice: number) {
  if (!Number.isInteger(dice) || dice < 1 || dice > 6) {
    throw new Error('Invalid dice roll.')
  }
  const hints = rollHints.get(roomId) ?? {}
  hints[playerId] = dice
  rollHints.set(roomId, hints)
  return getRoom(roomId)
}

const roomCode = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(6)))
    .map((value) => '0123456789'[value % 10])
    .join('')

const seatCode = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(4)))
    .map((value) => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[value % 32])
    .join('')

function allocateRejoinCode(room: Room) {
  let code = seatCode()
  while (
    room.players.some((player) => player.rejoinCode === code) ||
    (room.departedPlayers ?? []).some((player) => player.rejoinCode === code)
  ) {
    code = seatCode()
  }
  return code
}

/** Strip seat rejoin codes unless the viewer is the current host. */
export function roomViewFor(room: Room, viewerId: string | null | undefined): Room {
  // Relocate shields (etc.) that were generated on player entry / safe cells.
  if (room.game?.powerTiles && Object.keys(room.game.powerTiles).length > 0) {
    sanitizePowerTiles(room.game.powerTiles, getBoardPlayerCount(room))
  }
  const view = structuredClone(room) as Room
  if (viewerId && viewerId === room.hostId) return view
  for (const player of view.players) {
    delete player.rejoinCode
  }
  for (const player of view.departedPlayers ?? []) {
    delete player.rejoinCode
  }
  return view
}

const cleanName = (name: string) => name.trim().slice(0, 18) || 'Player'

function sortPlayers(room: Room) {
  room.players.sort((first, second) => first.seat - second.seat)
}

function assignRandomGamePositions(room: Room) {
  const originalPlayers = [...room.players]
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const shuffledPlayers = [...originalPlayers]
    shuffleInPlace(shuffledPlayers)

    if (shuffledPlayers.every((player, index) => player.seat !== index)) {
      shuffledPlayers.forEach((player, index) => {
        player.seat = index
      })
      room.players = shuffledPlayers
      return
    }
  }

  const rotatedPlayers = [...originalPlayers.slice(1), originalPlayers[0]]
  rotatedPlayers.forEach((player, index) => {
    player.seat = index
  })
  room.players = rotatedPlayers
}

function firstOpenSeat(room: Room) {
  const occupied = new Set(room.players.map((player) => player.seat))
  for (let seat = 0; seat < room.maxPlayers; seat += 1) {
    if (!occupied.has(seat)) return seat
  }
  return -1
}

export function getRoom(roomId: string) {
  const room = rooms.get(roomId)
  if (!room) throw new Error('Room not found.')
  return room
}

export function createRoom(
  userId: string,
  name: string,
  maxPlayers: number,
  gameMode: Room['gameMode'] = 'classic',
  preferredColor?: string,
  lockColor?: boolean,
  blitzDurationMs?: number | null,
  teamSize?: TeamSize | null,
  teamAssign?: TeamAssignMode | null,
  quickTokens?: number | null,
) {
  if (maxPlayers < 2 || maxPlayers > 8) {
    throw new Error('Room size must be between 2 and 8 players.')
  }
  if (isTeamMode(gameMode)) {
    const size = normalizeTeamSize(teamSize, maxPlayers)
    if (!teamRoomSizes(size).includes(maxPlayers)) {
      throw new Error(
        size === 3
          ? 'Team (3) needs 3 or 6 players.'
          : 'Team (2) needs 2, 4, 5, 6, or 8 players.',
      )
    }
  }

  const now = Date.now()
  const id = crypto.randomUUID()
  let code = roomCode()
  while (codeIndex.has(code)) code = roomCode()

  const stubRoom = {
    players: [] as Room['players'],
  } as Room
  const { color, colorLocked } = resolveJoinColor(
    stubRoom,
    userId,
    preferredColor,
    lockColor,
  )

  const room: Room = {
    id,
    code,
    hostId: userId,
    memberIds: [userId],
    maxPlayers,
    gameMode,
    blitzDurationMs:
      gameMode === 'blitz' ? normalizeBlitzDurationMs(blitzDurationMs) : null,
    quickTokens:
      gameMode === 'quick' ? normalizeQuickTokenCount(quickTokens) : null,
    teamSize: isTeamMode(gameMode)
      ? normalizeTeamSize(teamSize, maxPlayers)
      : null,
    teamAssign: isTeamMode(gameMode)
      ? normalizeTeamAssign(teamAssign)
      : null,
    teams: null,
    winningTeamId: null,
    status: 'lobby',
    players: [
      {
        id: userId,
        name: cleanName(name),
        color,
        seat: 0,
        connected: true,
        colorLocked,
        rejoinCode: seatCode(),
        joinedAt: now,
      },
    ],
    departedPlayers: [],
    game: null,
    createdAt: now,
    updatedAt: now,
  }

  rooms.set(id, room)
  codeIndex.set(code, id)
  return room
}

export function joinRoom(
  userId: string,
  name: string,
  code: string,
  preferredColor?: string,
  lockColor?: boolean,
) {
  const roomId = codeIndex.get(code.trim().toUpperCase())
  if (!roomId) throw new Error('Room not found. Check the room code.')

  const room = getRoom(roomId)
  const returning = room.players.find((player) => player.id === userId)

  if (returning) {
    returning.connected = true
    returning.name = cleanName(name)
    returning.autoPlay = undefined
    if (!returning.rejoinCode) returning.rejoinCode = allocateRejoinCode(room)
    if (lockColor && preferredColor) {
      const resolved = resolveJoinColor(room, userId, preferredColor, true)
      returning.color = resolved.color
      returning.colorLocked = true
    }
  } else {
    if (room.status !== 'lobby') {
      throw new Error('This game has already started.')
    }
    if (room.players.length >= room.maxPlayers) {
      throw new Error('This room is full.')
    }
    const seat = firstOpenSeat(room)
    if (seat === -1) throw new Error('This room is full.')
    const resolved = resolveJoinColor(
      room,
      userId,
      preferredColor,
      lockColor,
    )
    room.players.push({
      id: userId,
      name: cleanName(name),
      color: resolved.color,
      seat,
      connected: true,
      colorLocked: resolved.colorLocked,
      rejoinCode: allocateRejoinCode(room),
      joinedAt: Date.now(),
    })
    sortPlayers(room)
    room.memberIds.push(userId)
  }

  room.updatedAt = Date.now()
  return room
}

export function setSlotBot(
  roomId: string,
  userId: string,
  seat: number,
  add: boolean,
) {
  const room = getRoom(roomId)
  if (room.hostId !== userId) throw new Error('Only the host can manage bots.')
  if (room.status !== 'lobby') {
    throw new Error('Bots can only be changed in the lobby.')
  }
  if (!Number.isInteger(seat) || seat < 0 || seat >= room.maxPlayers) {
    throw new Error('Invalid seat.')
  }

  const existing = room.players.find((player) => player.seat === seat)

  if (add) {
    if (existing) throw new Error('That seat is already taken.')
    const botCount = room.players.filter((player) => player.isBot).length
    room.players.push({
      id: crypto.randomUUID(),
      name: `Bot ${botCount + 1}`,
      color: nextFreePresetColor(room),
      seat,
      connected: true,
      isBot: true,
      rejoinCode: allocateRejoinCode(room),
      joinedAt: Date.now(),
    })
  } else {
    if (!existing?.isBot) {
      throw new Error('Only bot players can be removed from a seat.')
    }
    room.players = room.players.filter((player) => player.seat !== seat)
  }

  sortPlayers(room)
  room.updatedAt = Date.now()
  return room
}

export function setTeams(
  roomId: string,
  hostId: string,
  teams: Team[],
  teamAssign?: TeamAssignMode,
) {
  const room = getRoom(roomId)
  if (room.hostId !== hostId) throw new Error('Only the host can set teams.')
  if (room.status !== 'lobby') throw new Error('Teams can only be set in the lobby.')
  if (!isTeamMode(room.gameMode)) throw new Error('This room is not Team mode.')
  const assign = normalizeTeamAssign(teamAssign ?? room.teamAssign)
  room.teamAssign = assign

  if (assign === 'random' && teams.length === 0) {
    room.teams = null
    room.updatedAt = Date.now()
    return room
  }

  const teamSize = room.teamSize ?? 2
  const error = validateTeamAssignment(room.players, teams, teamSize)
  if (error) throw new Error(error)
  room.teams = teams.map((team) => ({
    id: team.id || crypto.randomUUID(),
    memberIds: [...team.memberIds],
  }))
  room.updatedAt = Date.now()
  return room
}

function addControlledTeammateBot(room: Room, humanId: string) {
  if (room.players.length >= 8) {
    throw new Error('Cannot add teammate bot — board is full.')
  }
  if (room.players.length >= room.maxPlayers) {
    room.maxPlayers = Math.min(8, room.players.length + 1)
  }
  const seat = firstOpenSeat(room)
  if (seat === -1) throw new Error('No open seat for teammate bot.')
  const botCount = room.players.filter((player) => player.isBot).length
  const botId = crypto.randomUUID()
  room.players.push({
    id: botId,
    name: `Bot ${botCount + 1}`,
    color: nextFreePresetColor(room),
    seat,
    connected: true,
    isBot: true,
    controlledBy: humanId,
    rejoinCode: allocateRejoinCode(room),
    joinedAt: Date.now(),
  })
  sortPlayers(room)
  return botId
}

/**
 * Fill leftover solo seat with a controlled bot (5 humans + team size 2),
 * then build / complete teams before kickoff.
 */
function prepareTeamModeStart(room: Room) {
  const teamSize = room.teamSize ?? 2
  room.teamSize = teamSize
  room.teamAssign = normalizeTeamAssign(room.teamAssign)

  let teams = room.teams ? structuredClone(room.teams) : null

  if (room.teamAssign === 'random' || !teams?.length) {
    teams = buildRandomTeams(room.players, teamSize)
  }

  // 5 humans + size-2: one incomplete pair → add bot teammate that human controls.
  if (teamSize === 2) {
    const short = teams.filter((team) => team.memberIds.length === 1)
    const full = teams.filter((team) => team.memberIds.length === 2)
    if (short.length === 1 && full.length * 2 + 1 === room.players.length) {
      const humanId = short[0].memberIds[0]
      const botId = addControlledTeammateBot(room, humanId)
      short[0].memberIds.push(botId)
    }
  }

  const error = validateTeamAssignment(room.players, teams, teamSize)
  if (error) throw new Error(error)

  // Rebuild if seats changed after bot inject and assign was random-ish incomplete.
  if (teams.some((team) => team.memberIds.length < teamSize)) {
    teams = buildSequentialTeams(room.players, teamSize)
  }

  const finalError = validateTeamAssignment(room.players, teams, teamSize)
  if (finalError) throw new Error(finalError)

  room.teams = teams
  room.winningTeamId = null
}

export function startRoom(roomId: string, userId: string) {
  const room = getRoom(roomId)
  if (room.hostId !== userId) throw new Error('Only the host can start.')
  if (room.status !== 'lobby') throw new Error('The game has already started.')
  if (room.players.length < 2) {
    throw new Error('At least two players are required.')
  }

  if (isTeamMode(room.gameMode)) {
    prepareTeamModeStart(room)
  }

  sortPlayers(room)
  assignRandomGamePositions(room)
  // After seat shuffle, team memberIds stay stable (ids), only seats moved.
  for (const player of room.players) {
    if (!player.rejoinCode) player.rejoinCode = allocateRejoinCode(room)
  }
  room.game = createGame(room.players, room.gameMode ?? 'classic', {
    blitzDurationMs: room.blitzDurationMs,
    quickTokens: room.quickTokens,
  })
  room.status = 'playing'
  room.updatedAt = Date.now()
  return room
}

/** Host can change Quick token count while still in the lobby. */
export function setQuickTokens(
  roomId: string,
  hostId: string,
  quickTokens: number,
) {
  const room = getRoom(roomId)
  if (room.hostId !== hostId) {
    throw new Error('Only the host can change token count.')
  }
  if (room.status !== 'lobby') {
    throw new Error('Token count can only be changed in the lobby.')
  }
  if (room.gameMode !== 'quick') {
    throw new Error('Token count only applies to Quick mode.')
  }
  room.quickTokens = normalizeQuickTokenCount(quickTokens)
  room.updatedAt = Date.now()
  return room
}

/** Host can change Blitz length while still in the lobby. */
export function setBlitzDuration(
  roomId: string,
  hostId: string,
  blitzDurationMs: number,
) {
  const room = getRoom(roomId)
  if (room.hostId !== hostId) {
    throw new Error('Only the host can change the Blitz duration.')
  }
  if (room.status !== 'lobby') {
    throw new Error('Blitz duration can only be changed in the lobby.')
  }
  if (room.gameMode !== 'blitz') {
    throw new Error('Duration only applies to Blitz mode.')
  }
  room.blitzDurationMs = normalizeBlitzDurationMs(blitzDurationMs)
  room.updatedAt = Date.now()
  return room
}

/** Host adds +5 minutes to the live Blitz clock (repeatable). */
export function extendBlitzTime(roomId: string, hostId: string) {
  const room = getRoom(roomId)
  if (room.hostId !== hostId) {
    throw new Error('Only the host can add Blitz time.')
  }
  if (!isBlitzMode(room.gameMode)) {
    throw new Error('Extra time only applies to Blitz mode.')
  }
  if (room.status !== 'playing' || !room.game) {
    throw new Error('Blitz time can only be added during a match.')
  }
  if (typeof room.game.endsAt !== 'number') {
    throw new Error('This Blitz match has no clock.')
  }

  const host = room.players.find((player) => player.id === hostId)
  room.game.endsAt = Math.max(room.game.endsAt, Date.now()) + BLITZ_EXTEND_MS
  room.game.lastAction = `${host?.name ?? 'Host'} added +5 min`
  room.updatedAt = Date.now()
  return room
}

/** Force-end a Blitz room when the clock hits zero. */
export function endBlitzRoom(roomId: string) {
  const room = rooms.get(roomId)
  if (!room) return null
  if (!isBlitzMode(room.gameMode) || room.status !== 'playing' || !room.game) {
    return room
  }
  const next = structuredClone(room) as Room
  finalizeBlitzGame(next)
  rooms.set(roomId, next)
  return next
}

/**
 * The dice value is decided here, never by the caller, so every client sees the
 * same roll. `forcedDice` is only honoured for the host override path (k === 7).
 */
export function rollDice(
  roomId: string,
  userId: string,
  forcedDice?: number,
  k?: number,
) {
  const room = structuredClone(getRoom(roomId)) as Room
  const game = room.game!
  if (game.phase !== 'roll') throw new Error('Dice cannot be rolled now.')

  const player = room.players[game.turnIndex]
  if (!player) throw new Error('Current player is missing.')

  if (k === 7) {
    if (
      forcedDice === undefined ||
      !Number.isInteger(forcedDice) ||
      forcedDice < 1 ||
      forcedDice > 6
    ) {
      throw new Error('Invalid dice roll.')
    }
    applyRollMisses(game, player.id, room, forcedDice)
    applyRoll(room, forcedDice)
    room.updatedAt = Date.now()
    rooms.set(roomId, room)
    return { room, dice: forcedDice }
  }

  if (!canControlSeat(player, userId)) {
    throw new Error('It is not your turn.')
  }

  const hinted = consumeRollHint(roomId, player.id)
  const value = hinted ?? resolveDiceValue(game, player.id, room)
  if (!Number.isInteger(value) || value < 1 || value > 6) {
    throw new Error('Invalid dice roll.')
  }
  applyRollMisses(game, player.id, room, value)
  applyRoll(room, value)
  room.updatedAt = Date.now()

  rooms.set(roomId, room)
  return { room, dice: value }
}

export function storeRollHint(
  roomId: string,
  targetPlayerId: string,
  dice: number,
) {
  return queueRollHint(roomId, targetPlayerId, dice)
}

export function movePawn(
  roomId: string,
  userId: string,
  tokenId: number,
  startedAt: number,
  targetProgress?: number,
) {
  const room = structuredClone(getRoom(roomId)) as Room
  const turnPlayer = room.players[room.game?.turnIndex ?? -1]
  if (!canControlSeat(turnPlayer, userId)) {
    throw new Error('It is not your turn.')
  }

  const game = room.game!
  if (game.phase !== 'move') throw new Error('A token cannot be moved now.')

  const token = game.tokens.find(
    (candidate) =>
      candidate.playerId === turnPlayer.id && candidate.id === tokenId,
  )
  if (!token) throw new Error('That move is not valid.')

  // Broadcast-friendly active move so remote clients can animate before final state.
  game.activeMove = {
    playerId: turnPlayer.id,
    tokenId,
    fromProgress: token.progress,
    dice: game.dice ?? 1,
    startedAt,
    ...(targetProgress !== undefined ? { targetProgress } : {}),
  }
  rooms.set(roomId, room)

  const finalRoom = structuredClone(room) as Room
  applyMove(finalRoom, tokenId)
  const willCapture =
    Boolean(finalRoom.game?.lastAction?.includes('captured')) ||
    Boolean(finalRoom.game?.pendingPower?.captured)
  if (room.game?.activeMove) {
    room.game.activeMove.willCapture = willCapture
  }
  finalRoom.updatedAt = Date.now()
  rooms.set(roomId, finalRoom)
  return { previewRoom: room, room: finalRoom }
}

export function resolvePendingPower(
  roomId: string,
  userId: string,
  startedAt: number,
) {
  const current = getRoom(roomId)
  const game = current.game
  if (!game) throw new Error('Room has no active game.')

  // Late / raced clients: power already applied — return current state.
  if (game.phase !== 'power' || !game.pendingPower) {
    return { previewRoom: current, room: current }
  }

  if (!canControlSeat(current.players[game.turnIndex], userId)) {
    throw new Error('It is not your turn.')
  }

  const finalRoom = structuredClone(current) as Room
  applyPendingPower(finalRoom, startedAt)
  finalRoom.updatedAt = Date.now()

  const activeMove = finalRoom.game?.activeMove
  if (activeMove) {
    // Keep the token at its pre-power position in the preview so remote clients
    // can animate the bonus movement instead of snapping to the final cell.
    finalRoom.game!.activeMove = null
    rooms.set(roomId, finalRoom)

    const previewRoom = structuredClone(finalRoom) as Room
    const previewToken = previewRoom.game!.tokens.find(
      (candidate) =>
        candidate.playerId === activeMove.playerId &&
        candidate.id === activeMove.tokenId,
    )
    if (previewToken) {
      previewToken.progress = activeMove.fromProgress
    }
    previewRoom.game!.activeMove = activeMove
    previewRoom.updatedAt = Date.now()
    return { previewRoom, room: finalRoom }
  }

  rooms.set(roomId, finalRoom)
  return { previewRoom: finalRoom, room: finalRoom }
}

/** Server/host force-resolve when the lander's client stalls. */
export function handlePowerTimeout(roomId: string) {
  const room = getRoom(roomId)
  if (
    room.status !== 'playing' ||
    !room.game ||
    room.game.phase !== 'power' ||
    !room.game.pendingPower
  ) {
    return null
  }

  const player =
    room.players.find((candidate) => candidate.id === room.game!.pendingPower!.playerId) ??
    room.players[room.game.turnIndex]
  if (!player) return null

  return resolvePendingPower(roomId, player.id, Date.now())
}

export function skipPowerTimer(roomId: string, hostId: string) {
  const room = getRoom(roomId)
  if (room.hostId !== hostId) {
    throw new Error('Only the host can skip the power timer.')
  }
  if (
    room.status !== 'playing' ||
    !room.game ||
    room.game.phase !== 'power' ||
    !room.game.pendingPower
  ) {
    throw new Error('No power timer to skip.')
  }
  return handlePowerTimeout(roomId)
}

function transferHost(room: Room, previousHostId: string) {
  if (room.players.length === 0 || room.hostId !== previousHostId) return
  const nextHost =
    room.players.find(
      (player) =>
        player.id !== previousHostId &&
        !player.isBot &&
        player.connected,
    ) ??
    room.players.find(
      (player) => player.id !== previousHostId && !player.isBot,
    ) ??
    room.players.find((player) => player.id !== previousHostId) ??
    room.players[0]
  room.hostId = nextHost.id
}

function snapshotForReclaim(room: Room, player: Room['players'][number]) {
  const game = room.game
  if (!game) return {}
  const winnerPlace = game.winnerIds.indexOf(player.id)
  return {
    reclaimable: true as const,
    savedTokens: game.tokens
      .filter((token) => token.playerId === player.id)
      .map((token) => ({ ...token })),
    savedStats: game.stats?.[player.id]
      ? structuredClone(game.stats[player.id])
      : undefined,
    savedEntryMisses: game.entryMisses?.[player.id],
    savedFinishMisses: game.finishMisses?.[player.id],
    savedProtectionForfeited: game.protectionForfeited?.[player.id],
    savedShieldBuff: game.shieldBuff?.[player.id],
    savedWinnerPlace: winnerPlace >= 0 ? winnerPlace : undefined,
  }
}

/**
 * Claim a departed reclaimable seat with room code + seat code.
 * Restores tokens/stats at the exact board position.
 */
export function claimSeat(
  userId: string,
  name: string,
  roomCodeValue: string,
  rejoinCodeValue: string,
) {
  const roomId = codeIndex.get(roomCodeValue.trim().toUpperCase())
  if (!roomId) throw new Error('Room not found. Check the room code.')

  const room = getRoom(roomId)
  if (room.status !== 'playing' || !room.game) {
    throw new Error('Seat reclaim is only available during a match.')
  }

  const code = rejoinCodeValue.trim().toUpperCase()
  if (code.length < 4) throw new Error('Enter the seat code from the host.')

  if (room.players.some((player) => player.id === userId)) {
    throw new Error('You are already in this room.')
  }

  room.departedPlayers ??= []
  const departedIndex = room.departedPlayers.findIndex(
    (player) =>
      player.reclaimable &&
      (player.rejoinCode ?? '').toUpperCase() === code,
  )
  if (departedIndex === -1) {
    throw new Error('Invalid seat code, or that seat is not open to reclaim.')
  }

  const departed = room.departedPlayers[departedIndex]
  if (room.players.some((player) => player.seat === departed.seat)) {
    throw new Error('That seat is already taken.')
  }

  const game = room.game
  const currentTurnId = room.players[game.turnIndex]?.id
  const displayName = cleanName(name)

  const restored: Room['players'][number] = {
    id: userId,
    name: displayName,
    color: departed.color,
    seat: departed.seat,
    connected: true,
    colorLocked: departed.colorLocked,
    rejoinCode: departed.rejoinCode ?? allocateRejoinCode(room),
    joinedAt: departed.joinedAt,
  }

  room.departedPlayers.splice(departedIndex, 1)
  room.players.push(restored)
  sortPlayers(room)
  if (!room.memberIds.includes(userId)) room.memberIds.push(userId)

  const tokens = (departed.savedTokens ?? []).map((token) => ({
    ...token,
    playerId: userId,
  }))
  game.tokens.push(...tokens)

  if (departed.savedStats) {
    game.stats ??= {}
    game.stats[userId] = structuredClone(departed.savedStats)
  }
  if (departed.savedEntryMisses !== undefined) {
    game.entryMisses[userId] = departed.savedEntryMisses
  }
  if (departed.savedFinishMisses !== undefined) {
    game.finishMisses[userId] = departed.savedFinishMisses
  }
  if (departed.savedProtectionForfeited !== undefined) {
    game.protectionForfeited[userId] = departed.savedProtectionForfeited
  }
  if (departed.savedShieldBuff) {
    game.shieldBuff ??= {}
    game.shieldBuff[userId] = true
  }
  if (
    typeof departed.savedWinnerPlace === 'number' &&
    departed.savedWinnerPlace >= 0 &&
    !game.winnerIds.includes(userId)
  ) {
    const place = Math.min(departed.savedWinnerPlace, game.winnerIds.length)
    game.winnerIds.splice(place, 0, userId)
  }

  if (currentTurnId) {
    const nextIndex = room.players.findIndex((player) => player.id === currentTurnId)
    if (nextIndex >= 0) game.turnIndex = nextIndex
  }

  game.lastAction = `${displayName} reclaimed seat ${restored.seat + 1}`
  room.updatedAt = Date.now()
  return room
}

function rebalanceTurnAfterRemoval(room: Room, removedIndex: number) {
  const game = room.game!
  if (removedIndex < game.turnIndex) {
    game.turnIndex -= 1
  } else if (removedIndex === game.turnIndex) {
    game.turnIndex = removedIndex % room.players.length
  }

  for (let offset = 0; offset < room.players.length; offset += 1) {
    const index = (game.turnIndex + offset) % room.players.length
    if (!game.winnerIds.includes(room.players[index].id)) {
      game.turnIndex = index
      break
    }
  }

  game.phase = 'roll'
  game.dice = null
  game.consecutiveSixes = 0
  game.activeMove = null
  game.pendingPower = null
  game.turnDeadline = Date.now() + TURN_ROLL_TIMEOUT_MS
}

function finalizeGameIfNeeded(room: Room) {
  const game = room.game
  if (!game) return

  if (isTeamMode(room.gameMode) && room.teams?.length) {
    const teamSize = room.teamSize ?? 2
    const finishedTeam = room.teams.find(
      (team) =>
        team.memberIds.length >= teamSize &&
        team.memberIds.every((id) => game.winnerIds.includes(id)),
    )
    if (finishedTeam) {
      room.winningTeamId = finishedTeam.id
      room.status = 'finished'
      game.turnDeadline = null
    }
    return
  }

  if (
    room.players.length === 1 ||
    game.winnerIds.length >= room.players.length - 1
  ) {
    const remaining = room.players.find(
      (player) => !game.winnerIds.includes(player.id),
    )
    if (remaining) game.winnerIds.push(remaining.id)
    room.status = 'finished'
    game.turnDeadline = null
  }
}

export function removePlayerFromRoom(
  room: Room,
  userId: string,
  lastAction: string,
  options?: { reclaimable?: boolean },
): Room | null {
  const leavingIndex = room.players.findIndex((player) => player.id === userId)
  if (leavingIndex === -1) return room

  const leavingPlayer = room.players[leavingIndex]
  const reclaimable = Boolean(options?.reclaimable && room.game)

  if (room.game) {
    room.departedPlayers ??= []
    if (!room.departedPlayers.some((player) => player.id === userId)) {
      if (!leavingPlayer.rejoinCode) {
        leavingPlayer.rejoinCode = allocateRejoinCode(room)
      }
      room.departedPlayers.push({
        ...leavingPlayer,
        connected: false,
        autoPlay: undefined,
        leftAt: Date.now(),
        ...(reclaimable ? snapshotForReclaim(room, leavingPlayer) : { reclaimable: false }),
      })
    }
  }

  room.players.splice(leavingIndex, 1)
  room.memberIds = (room.memberIds ?? []).filter((id) => id !== userId)

  if (room.players.length === 0) {
    rooms.delete(room.id)
    codeIndex.delete(room.code)
    clearRollHints(room.id)
    return null
  }

  transferHost(room, userId)

  if (room.game) {
    const game = room.game
    game.tokens = game.tokens.filter((token) => token.playerId !== userId)
    game.winnerIds = game.winnerIds.filter((id) => id !== userId)
    delete game.entryMisses?.[userId]
    delete game.finishMisses?.[userId]
    delete game.protectionForfeited?.[userId]
    delete game.stats?.[userId]
    delete game.shieldBuff?.[userId]
    if (game.pendingExtraTurn === userId) game.pendingExtraTurn = null
    if (game.pendingPower?.playerId === userId) game.pendingPower = null
    if (game.activeMove?.playerId === userId) game.activeMove = null

    rebalanceTurnAfterRemoval(room, leavingIndex)
    game.lastAction = reclaimable
      ? `${leavingPlayer.name} left — seat open for reclaim`
      : lastAction
    finalizeGameIfNeeded(room)
  }

  room.updatedAt = Date.now()
  return room
}

export function setPlayerAutoPlay(
  roomId: string,
  hostId: string,
  targetUserId: string,
  enabled: boolean,
) {
  const room = structuredClone(getRoom(roomId)) as Room
  if (room.hostId !== hostId) {
    throw new Error('Only the host can change autoplay.')
  }
  if (room.status !== 'playing' || !room.game) {
    throw new Error('Autoplay can only be changed during a game.')
  }

  const player = room.players.find((candidate) => candidate.id === targetUserId)
  if (!player) throw new Error('Player not found.')
  if (player.isBot) throw new Error('Uncontrolled bots are already automatic.')
  if (player.controlledBy) {
    throw new Error('This bot is controlled by a teammate.')
  }

  player.autoPlay = enabled || undefined
  room.game.lastAction = enabled
    ? `${player.name} is on autoplay`
    : `${player.name}'s autoplay cancelled`
  room.updatedAt = Date.now()
  rooms.set(roomId, room)
  return room
}

export function removePlayer(
  roomId: string,
  hostId: string,
  targetUserId: string,
) {
  const room = getRoom(roomId)
  if (room.hostId !== hostId) {
    throw new Error('Only the host can remove players.')
  }
  if (targetUserId === hostId) {
    throw new Error('Leave the room yourself instead of removing yourself.')
  }

  const target = room.players.find((player) => player.id === targetUserId)
  if (!target) throw new Error('Player not found.')

  if (room.status === 'lobby') {
    room.players = room.players.filter((player) => player.id !== targetUserId)
    room.memberIds = room.memberIds.filter((id) => id !== targetUserId)
    room.updatedAt = Date.now()
    return room
  }

  const next = removePlayerFromRoom(
    room,
    targetUserId,
    `${target.name} was removed`,
    { reclaimable: !target.isBot },
  )
  if (!next) throw new Error('Room closed.')
  rooms.set(roomId, next)
  return next
}

export function handleRollTimeout(roomId: string) {
  const room = structuredClone(getRoom(roomId)) as Room
  if (room.status !== 'playing' || !room.game || room.game.phase !== 'roll') {
    return room
  }

  const player = room.players[room.game.turnIndex]
  if (!player || isAutoControlled(player)) return room

  const hinted = consumeRollHint(roomId, player.id)
  const dice = hinted ?? resolveDiceValue(room.game, player.id, room)
  applyRollMisses(room.game, player.id, room, dice)
  applyRoll(room, dice)
  room.game.lastAction = `${player.name} auto-rolled ${dice} after timeout`
  room.updatedAt = Date.now()
  rooms.set(roomId, room)
  return room
}

export function skipRollTimer(roomId: string, hostId: string) {
  const room = getRoom(roomId)
  if (room.hostId !== hostId) {
    throw new Error('Only the host can skip the roll timer.')
  }
  if (room.status !== 'playing' || !room.game || room.game.phase !== 'roll') {
    throw new Error('No roll timer to skip.')
  }
  const player = room.players[room.game.turnIndex]
  if (!player || isAutoControlled(player)) {
    throw new Error('No player roll timer to skip.')
  }
  return handleRollTimeout(roomId)
}

export function handleMoveTimeout(roomId: string) {
  const room = getRoom(roomId)
  if (room.status !== 'playing' || !room.game || room.game.phase !== 'move') {
    return null
  }

  const player = room.players[room.game.turnIndex]
  if (!player || isAutoControlled(player)) return null

  const token = pickBestMovableToken(room)
  if (!token) return null

  const startedAt = Date.now()
  const targetProgress =
    token.progress === -1 ? 0 : token.progress + (room.game.dice ?? 1)
  return movePawn(roomId, player.id, token.id, startedAt, targetProgress)
}

export function skipMoveTimer(roomId: string, hostId: string) {
  const room = getRoom(roomId)
  if (room.hostId !== hostId) {
    throw new Error('Only the host can skip the move timer.')
  }
  if (room.status !== 'playing' || !room.game || room.game.phase !== 'move') {
    throw new Error('No move timer to skip.')
  }
  const player = room.players[room.game.turnIndex]
  if (!player || isAutoControlled(player)) {
    throw new Error('No player move timer to skip.')
  }
  return handleMoveTimeout(roomId)
}

export function leaveRoom(
  roomId: string,
  userId: string,
  newHostId?: string,
) {
  const room = rooms.get(roomId)
  if (!room) return null

  const leavingPlayer = room.players.find((player) => player.id === userId)
  if (!leavingPlayer) return room

  if (room.hostId === userId && newHostId) {
    const nextHost = room.players.find(
      (player) => player.id === newHostId && player.id !== userId,
    )
    if (!nextHost) throw new Error('Choose a valid new host.')
    room.hostId = newHostId
  }

  const reclaimable =
    room.status === 'playing' && Boolean(room.game) && !leavingPlayer.isBot

  const next = removePlayerFromRoom(
    room,
    userId,
    `${leavingPlayer.name} left the game`,
    { reclaimable },
  )
  if (!next) return null
  rooms.set(roomId, next)
  return next
}

export function markDisconnected(roomId: string, userId: string) {
  const room = rooms.get(roomId)
  if (!room) return null
  const player = room.players.find((candidate) => candidate.id === userId)
  if (!player || player.isBot) return room
  player.connected = false
  room.updatedAt = Date.now()
  return room
}
