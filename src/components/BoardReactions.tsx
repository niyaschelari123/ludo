import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { isNamedPlayerColor, resolveColorHex } from '../game/colors'
import {
  REACTION_KINDS,
  REACTION_LABELS,
  isReactionKind,
  reactionEmoji,
  type ReactionKind,
} from '../game/reactions'
import { sendReaction, watchReactions } from '../game/roomService'
import type { BoardReaction, Room } from '../game/types'

type FloatItem = {
  key: string
  reaction: BoardReaction
  lane: number
  drift: 'a' | 'b' | 'c' | 'd'
  durationMs: number
}

function playerColorClass(color: string) {
  return isNamedPlayerColor(color) ? color : 'custom-color'
}

function playerColorStyle(color: string): CSSProperties | undefined {
  return isNamedPlayerColor(color)
    ? undefined
    : ({ ['--player' as string]: resolveColorHex(color) } as CSSProperties)
}

function displayEmoji(kind: string) {
  return isReactionKind(kind) ? reactionEmoji(kind) : '✨'
}

const FLOAT_MS = 4200
const MOMENT_MS = 6500

export function BoardReactions({
  room,
  userId,
  canSend,
}: {
  room: Room
  userId: string
  canSend: boolean
}) {
  const [floats, setFloats] = useState<FloatItem[]>([])
  const [busyKind, setBusyKind] = useState<ReactionKind | null>(null)
  const [moment, setMoment] = useState(false)
  const [open, setOpen] = useState(false)
  const seenRef = useRef<Set<string>>(new Set())
  const laneRef = useRef(0)
  const lastMomentKey = useRef('')
  const rootRef = useRef<HTMLDivElement | null>(null)

  const spawn = (reaction: BoardReaction) => {
    if (seenRef.current.has(reaction.id)) return
    seenRef.current.add(reaction.id)
    const lane = laneRef.current % 5
    laneRef.current += 1
    const paths = ['a', 'b', 'c', 'd'] as const
    const key = `${reaction.id}-${Date.now()}`
    const item: FloatItem = {
      key,
      reaction,
      lane,
      drift: paths[lane % paths.length] as FloatItem['drift'],
      durationMs: FLOAT_MS,
    }
    setFloats((prev) => [...prev.slice(-8), item])
    window.setTimeout(() => {
      setFloats((prev) => prev.filter((entry) => entry.key !== key))
    }, FLOAT_MS + 60)
  }

  useEffect(() => {
    seenRef.current = new Set()
    setFloats([])
    setOpen(false)
    return watchReactions(room.id, spawn)
  }, [room.id])

  useEffect(() => {
    if (room.status !== 'playing' || !room.game) {
      setMoment(false)
      return
    }
    const action = room.game.lastAction ?? ''
    const pending = room.game.pendingPower
    const captureMoment = action.includes('captured')
    const superMoment = pending?.type === 'super'
    const gunMoment = action.includes('Super Gun')
    if (!captureMoment && !superMoment && !gunMoment) return
    const key = superMoment
      ? `super:${pending?.playerId}:${pending?.tokenId}:${pending?.landingCell}`
      : `${captureMoment ? 'capture' : 'gun'}:${action}`
    if (key === lastMomentKey.current) return
    lastMomentKey.current = key
    setMoment(true)
    const timer = window.setTimeout(() => setMoment(false), MOMENT_MS)
    return () => window.clearTimeout(timer)
  }, [
    room.status,
    room.game?.lastAction,
    room.game?.pendingPower?.type,
    room.game?.pendingPower?.playerId,
    room.game?.pendingPower?.tokenId,
    room.game?.pendingPower?.landingCell,
  ])

  useEffect(() => {
    if (!open) return
    const onPointer = (event: PointerEvent) => {
      const root = rootRef.current
      if (!root || root.contains(event.target as Node)) return
      setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', onPointer)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onPointer)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (room.status !== 'playing' && room.status !== 'lobby') return null

  const react = (kind: ReactionKind) => {
    if (!canSend || busyKind) return
    setBusyKind(kind)
    setOpen(false)
    void sendReaction(room.id, userId, kind)
      .then(spawn)
      .catch(() => {
        /* cooldown / offline — ignore quietly */
      })
      .finally(() => setBusyKind(null))
  }

  return (
    <div
      ref={rootRef}
      className={`board-reactions ${moment ? 'is-moment' : ''} ${open ? 'is-open' : ''}`}
    >
      <div className="board-reaction-stage" aria-hidden="true">
        {floats.map((item) => {
          const mine = item.reaction.fromId === userId
          return (
            <div
              key={item.key}
              className={`board-reaction-float ${item.drift} ${playerColorClass(item.reaction.fromColor)}`}
              style={
                {
                  ...playerColorStyle(item.reaction.fromColor),
                  ['--reaction-lane' as string]: String(item.lane),
                  ['--reaction-ms' as string]: `${item.durationMs}ms`,
                } as CSSProperties
              }
            >
              <span className="board-reaction-emoji">
                {displayEmoji(item.reaction.kind)}
              </span>
              <span className="board-reaction-name">
                {mine ? 'You' : item.reaction.fromName}
              </span>
            </div>
          )
        })}
      </div>

      {canSend ? (
        <div className="board-reaction-launcher">
          <button
            type="button"
            className={`board-reaction-toggle ${moment ? 'is-hot' : ''}`}
            aria-expanded={open}
            aria-haspopup="dialog"
            title={moment ? 'React!' : 'Reactions'}
            onClick={() => setOpen((value) => !value)}
          >
            <span aria-hidden="true">😀</span>
            {moment ? <em>React!</em> : null}
          </button>

          {open ? (
            <div
              className="board-reaction-popup"
              role="dialog"
              aria-label="Pick a reaction"
            >
              <div className="board-reaction-popup-head">
                <strong>Reactions</strong>
                <button
                  type="button"
                  className="board-reaction-close"
                  aria-label="Close reactions"
                  onClick={() => setOpen(false)}
                >
                  ×
                </button>
              </div>
              <div className="board-reaction-grid">
                {REACTION_KINDS.map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    className="board-reaction-btn"
                    title={REACTION_LABELS[kind]}
                    aria-label={REACTION_LABELS[kind]}
                    disabled={busyKind !== null}
                    onClick={() => react(kind)}
                  >
                    {reactionEmoji(kind)}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
