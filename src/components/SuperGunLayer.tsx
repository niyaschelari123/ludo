import { useEffect, useRef, useState, type MutableRefObject } from 'react'
import { getBoardPlayerCount } from '../game/engine'
import {
  canFireSuperGun,
  pointAlongSuperGunPath,
  superGunShotDurationMs,
} from '../game/superGun'
import { boardCenterPoint, boardSizeForRoom } from '../game/tokenPoints'
import type { Room } from '../game/types'

export function SuperGunLayer({
  room,
  userId,
  aimRef,
}: {
  room: Room
  userId: string
  aimRef: MutableRefObject<() => number>
}) {
  const groupRef = useRef<SVGGElement>(null)
  const pointerAngleRef = useRef(-Math.PI / 2)
  const [aimAngle, setAimAngle] = useState(-Math.PI / 2)
  const [now, setNow] = useState(() => Date.now())
  const canAim = canFireSuperGun(room, userId)
  const shot = room.game?.activeShot ?? null
  const shotMs = superGunShotDurationMs(shot?.path)
  const shotFresh = Boolean(shot && now - shot.startedAt < shotMs + 380)
  const armed = Boolean(
    room.game && room.players.some((player) => room.game?.superGunReady?.[player.id]),
  )
  const showGun = armed || shotFresh
  const center = boardCenterPoint(room)
  const size = boardSizeForRoom(room)
  const laserLen = size * 0.46
  const count = getBoardPlayerCount(room)
  const gunScale = count === 4 ? 1 : Math.max(0.85, size / 700)

  useEffect(() => {
    aimRef.current = () => aimAngle
  }, [aimAngle, aimRef])

  useEffect(() => {
    if (!canAim && !shot) return
    let frame = 0
    const tick = () => {
      const time = Date.now()
      setNow(time)
      if (canAim) {
        setAimAngle(pointerAngleRef.current)
      }
      if (canAim || (shot != null && time - shot.startedAt < shotMs + 420)) {
        frame = window.requestAnimationFrame(tick)
      }
    }
    frame = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(frame)
  }, [canAim, shot, shotMs])

  useEffect(() => {
    if (!canAim) return
    const onMove = (event: PointerEvent) => {
      const svg = groupRef.current?.ownerSVGElement
      if (!svg) return
      const ctm = svg.getScreenCTM()
      if (!ctm) return
      const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(
        ctm.inverse(),
      )
      const next = Math.atan2(point.y - center.y, point.x - center.x)
      pointerAngleRef.current = next
      setAimAngle(next)
    }
    window.addEventListener('pointermove', onMove)
    return () => window.removeEventListener('pointermove', onMove)
  }, [canAim, center.x, center.y])

  if (!showGun) return null

  const drawAngle = shotFresh && shot ? shot.angle : canAim ? aimAngle : -Math.PI / 2
  const laserX = center.x + Math.cos(drawAngle) * laserLen
  const laserY = center.y + Math.sin(drawAngle) * laserLen
  const shotAge = shotFresh && shot ? now - shot.startedAt : 0
  const shotT = shotFresh && shot ? Math.min(1, shotAge / shotMs) : 0
  const shotPath =
    shot?.path && shot.path.length > 1
      ? shot.path
      : shot
        ? [center, { x: shot.hitX, y: shot.hitY }]
        : []
  const bullet = shotPath.length
    ? pointAlongSuperGunPath(shotPath, shotT)
    : center

  return (
    <g
      ref={groupRef}
      className="super-gun-layer"
      style={{ pointerEvents: 'none' }}
    >
      {shotFresh && shotPath.length > 1 ? (
        <polyline
          className="super-gun-laser is-firing"
          points={shotPath.map((point) => `${point.x},${point.y}`).join(' ')}
          fill="none"
        />
      ) : canAim ? (
        <line
          className="super-gun-laser"
          x1={center.x}
          y1={center.y}
          x2={laserX}
          y2={laserY}
        />
      ) : null}
      <g
        className="super-gun"
        transform={`translate(${center.x} ${center.y}) rotate(${(drawAngle * 180) / Math.PI}) scale(${gunScale})`}
      >
        <rect className="super-gun-body" x="-10" y="-7" width="28" height="14" rx="3" />
        <rect className="super-gun-barrel" x="16" y="-3.5" width="18" height="7" rx="1.5" />
        <rect className="super-gun-grip" x="-8" y="5" width="8" height="12" rx="1.5" />
        <circle className="super-gun-sight" cx="34" cy="0" r="2.2" />
      </g>
      {shot && shotT < 1 ? (
        <circle className="super-gun-bullet" cx={bullet.x} cy={bullet.y} r={5 * gunScale} />
      ) : null}
    </g>
  )
}
