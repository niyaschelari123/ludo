import {
  canControlSeat,
  type Room,
  type SuperGunShot,
  type Token,
} from './types'
import {
  expireSuperGun,
  finishedProgress,
  globalCell,
  homeEntryProgress,
  isSoleTokenProtected,
  recordCapture,
  recordShieldBreak,
  resumeAfterSuperGun,
  safeCells,
} from './engine'
import { boardCenterPoint, boardSizeForRoom, tokenBoardPoint } from './tokenPoints'

const HIT_RADIUS = 22
const MAX_BOUNCES = 18
const NUDGE = 1.6

export function hasSuperGunReady(room: Room, playerId: string) {
  return Boolean(room.game?.superGunReady?.[playerId])
}

export function canFireSuperGun(room: Room, userId: string) {
  const game = room.game
  if (!game || room.status !== 'playing') return false
  const shooter = room.players[game.turnIndex]
  if (!shooter || !canControlSeat(shooter, userId)) return false
  if (!hasSuperGunReady(room, shooter.id)) return false
  if (game.phase === 'power' && game.pendingPower) return false
  if (game.superGunDeadline && Date.now() > game.superGunDeadline) return false
  return true
}

/** Laser follows the pointer with no wobble. */
export function aimLaserAngle(pointerAngle: number) {
  return pointerAngle
}

export function superGunPathLength(path: { x: number; y: number }[] | undefined) {
  if (!path || path.length < 2) return 0
  let length = 0
  for (let index = 1; index < path.length; index += 1) {
    length += Math.hypot(
      path[index].x - path[index - 1].x,
      path[index].y - path[index - 1].y,
    )
  }
  return length
}

export function superGunShotDurationMs(path: { x: number; y: number }[] | undefined) {
  const length = superGunPathLength(path)
  if (length <= 0) return 720
  return Math.min(2800, Math.max(520, length / 0.82))
}

export function pointAlongSuperGunPath(
  path: { x: number; y: number }[],
  t: number,
) {
  if (path.length === 0) return { x: 0, y: 0 }
  if (path.length === 1 || t <= 0) return path[0]
  const total = superGunPathLength(path)
  if (total <= 0) return path[path.length - 1]
  let remain = Math.min(1, t) * total
  for (let index = 1; index < path.length; index += 1) {
    const from = path[index - 1]
    const to = path[index]
    const span = Math.hypot(to.x - from.x, to.y - from.y)
    if (remain <= span) {
      const u = span === 0 ? 1 : remain / span
      return {
        x: from.x + (to.x - from.x) * u,
        y: from.y + (to.y - from.y) * u,
      }
    }
    remain -= span
  }
  return path[path.length - 1]
}

function playfield(room: Room) {
  const size = boardSizeForRoom(room)
  const pad = size * 0.08
  return { min: pad, max: size - pad }
}

/** Tokens the bullet can send home. Stars, home path, and other safe seats are skipped. */
function isSuperGunVulnerable(room: Room, token: Token, shooterId: string) {
  const game = room.game
  if (!game) return false
  if (token.playerId === shooterId) return false
  if (token.progress < 0) return false
  const homeEntry = homeEntryProgress(room)
  if (token.progress >= homeEntry) return false
  const cell = globalCell(token, room)
  if (cell !== null && safeCells(room).has(cell)) return false
  if (isSoleTokenProtected(game, token.playerId, room)) return false
  return true
}

function isSuperGunBlocker(room: Room, token: Token, shooterId: string) {
  const game = room.game
  if (!game) return false
  if (token.playerId === shooterId) return false
  if (token.progress < 0) return false
  if (token.progress >= finishedProgress(room)) return false
  return !isSuperGunVulnerable(room, token, shooterId)
}

function rayCircleHit(
  origin: { x: number; y: number },
  dir: { x: number; y: number },
  center: { x: number; y: number },
  radius: number,
) {
  const ox = center.x - origin.x
  const oy = center.y - origin.y
  const along = ox * dir.x + oy * dir.y
  if (along < 2) return null
  const closest = ox * ox + oy * oy - along * along
  const rad2 = radius * radius
  if (closest > rad2) return null
  const t = along - Math.sqrt(Math.max(0, rad2 - closest))
  if (t < 2) return null
  return t
}

function rayRectExit(
  origin: { x: number; y: number },
  dir: { x: number; y: number },
  min: number,
  max: number,
) {
  let tX = Number.POSITIVE_INFINITY
  let tY = Number.POSITIVE_INFINITY
  if (dir.x > 1e-6) tX = (max - origin.x) / dir.x
  else if (dir.x < -1e-6) tX = (min - origin.x) / dir.x
  if (dir.y > 1e-6) tY = (max - origin.y) / dir.y
  else if (dir.y < -1e-6) tY = (min - origin.y) / dir.y
  const t = Math.min(tX, tY)
  if (!Number.isFinite(t) || t <= 0) return null
  return {
    t,
    point: { x: origin.x + dir.x * t, y: origin.y + dir.y * t },
    bounceX: tX <= tY,
  }
}

function traceSuperGunShot(room: Room, angle: number, shooterId: string) {
  const game = room.game
  const start = boardCenterPoint(room)
  const { min, max } = playfield(room)
  const path = [{ ...start }]
  if (!game) {
    return { path, hit: null as Token | null, hitX: start.x, hitY: start.y }
  }

  let origin = { ...start }
  let dir = { x: Math.cos(angle), y: Math.sin(angle) }
  const tokens = game.tokens.filter(
    (token) => token.playerId !== shooterId && token.progress >= 0,
  )

  for (let bounce = 0; bounce <= MAX_BOUNCES; bounce += 1) {
    const wall = rayRectExit(origin, dir, min, max)
    if (!wall) break

    type Candidate = {
      token: Token
      t: number
      point: { x: number; y: number }
      vulnerable: boolean
    }
    let nearest: Candidate | null = null

    for (const token of tokens) {
      const center = tokenBoardPoint(room, token)
      const t = rayCircleHit(origin, dir, center, HIT_RADIUS)
      if (t == null || t >= wall.t) continue
      const point = { x: origin.x + dir.x * t, y: origin.y + dir.y * t }
      const vulnerable = isSuperGunVulnerable(room, token, shooterId)
      if (!vulnerable && !isSuperGunBlocker(room, token, shooterId)) continue
      if (!nearest || t < nearest.t) {
        nearest = { token, t, point, vulnerable }
      }
    }

    if (nearest?.vulnerable) {
      path.push(nearest.point)
      return {
        path,
        hit: nearest.token,
        hitX: nearest.point.x,
        hitY: nearest.point.y,
      }
    }

    if (nearest) {
      path.push(nearest.point)
      const center = tokenBoardPoint(room, nearest.token)
      let nx = nearest.point.x - center.x
      let ny = nearest.point.y - center.y
      const nLen = Math.hypot(nx, ny) || 1
      nx /= nLen
      ny /= nLen
      const dot = dir.x * nx + dir.y * ny
      dir = { x: dir.x - 2 * dot * nx, y: dir.y - 2 * dot * ny }
      origin = {
        x: nearest.point.x + dir.x * NUDGE,
        y: nearest.point.y + dir.y * NUDGE,
      }
      continue
    }

    path.push(wall.point)
    dir = {
      x: wall.bounceX ? -dir.x : dir.x,
      y: wall.bounceX ? dir.y : -dir.y,
    }
    origin = {
      x: wall.point.x + dir.x * NUDGE,
      y: wall.point.y + dir.y * NUDGE,
    }
  }

  const last = path[path.length - 1]
  return { path, hit: null, hitX: last.x, hitY: last.y }
}

/** Fire the Super Gun. Hit token always returns to the nest (−1), not the entry. */
export function applySuperGunShot(
  room: Room,
  userId: string,
  rawAngle: number,
  startedAt = Date.now(),
) {
  const game = room.game
  if (!game || room.status !== 'playing') {
    throw new Error('No active game.')
  }
  const shooter = room.players[game.turnIndex]
  if (!canControlSeat(shooter, userId)) {
    throw new Error('It is not your turn.')
  }
  if (!hasSuperGunReady(room, shooter.id)) {
    throw new Error('The Super Gun is not ready.')
  }
  if (game.superGunDeadline && Date.now() > game.superGunDeadline) {
    expireSuperGun(room)
    throw new Error('The Super Gun window ran out.')
  }
  if (game.phase === 'power' && game.pendingPower) {
    throw new Error('Finish the power tile first.')
  }
  if (!Number.isFinite(rawAngle)) {
    throw new Error('Bad aim angle.')
  }

  const angle = ((rawAngle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)
  const traced = traceSuperGunShot(room, angle, shooter.id)

  game.superGunReady = { ...(game.superGunReady ?? {}), [shooter.id]: false }
  game.superGunUsed = { ...(game.superGunUsed ?? {}), [shooter.id]: true }
  game.superGunDeadline = null

  const shot: SuperGunShot = {
    shooterId: shooter.id,
    angle,
    path: traced.path,
    hitPlayerId: traced.hit?.playerId ?? null,
    hitTokenId: traced.hit?.id ?? null,
    hitX: traced.hitX,
    hitY: traced.hitY,
    startedAt,
  }
  game.activeShot = shot

  if (game.superGunHold) {
    game.superGunHold = { ...game.superGunHold, tokenMoved: false }
  }

  if (!traced.hit) {
    game.lastAction = `${shooter.name} fired the Super Gun and missed`
    resumeAfterSuperGun(room)
    return room
  }

  const fromProgress = traced.hit.progress
  traced.hit.progress = -1
  game.shieldBuff ??= {}
  if (game.shieldBuff[traced.hit.playerId]) {
    game.shieldBuff[traced.hit.playerId] = false
    recordShieldBreak(game, shooter.id)
  }
  recordCapture(game, shooter.id, traced.hit.playerId)
  game.activeMove = {
    playerId: traced.hit.playerId,
    tokenId: traced.hit.id,
    fromProgress,
    dice: -1 - fromProgress,
    startedAt,
    targetProgress: -1,
    willCapture: true,
    captureVictimIds: [traced.hit.playerId],
  }
  const victim = room.players.find((player) => player.id === traced.hit!.playerId)
  game.lastAction = `${shooter.name} hit ${victim?.name ?? 'a player'} with the Super Gun — sent to the nest`
  const victimMove = game.activeMove
  resumeAfterSuperGun(room)
  if (victimMove) game.activeMove = victimMove
  return room
}
