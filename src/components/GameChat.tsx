import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react'
import { isNamedPlayerColor, resolveColorHex } from '../game/colors'
import { sendChat, watchChat } from '../game/roomService'
import type { ChatMessage, Room } from '../game/types'

function playerColorClass(color: string) {
  return isNamedPlayerColor(color) ? color : 'custom-color'
}

function playerColorStyle(color: string): CSSProperties | undefined {
  return isNamedPlayerColor(color)
    ? undefined
    : ({ ['--player' as string]: resolveColorHex(color) } as CSSProperties)
}

function formatChatTime(at: number) {
  try {
    return new Date(at).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return ''
  }
}

type FloatToast = {
  key: string
  message: ChatMessage
  lane: number
  drift: 'left' | 'right'
  durationMs: number
}

type GameChatProps = {
  room: Room
  userId: string
  canSend: boolean
}

const FLOAT_DURATION_MS = 5200

export function GameChat({ room, userId, canSend }: GameChatProps) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [floats, setFloats] = useState<FloatToast[]>([])
  const [text, setText] = useState('')
  const [toUserId, setToUserId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [unread, setUnread] = useState(0)
  const listRef = useRef<HTMLDivElement | null>(null)
  const openRef = useRef(open)
  const seenIdsRef = useRef<Set<string>>(new Set())
  const historyReadyRef = useRef(false)
  const laneRef = useRef(0)
  openRef.current = open

  const spawnFloat = (message: ChatMessage) => {
    if (seenIdsRef.current.has(message.id)) return
    seenIdsRef.current.add(message.id)

    const lane = laneRef.current % 5
    laneRef.current += 1
    const drift: 'left' | 'right' = lane % 2 === 0 ? 'right' : 'left'
    const key = `${message.id}-${Date.now()}`
    const toast: FloatToast = {
      key,
      message,
      lane,
      drift,
      durationMs: FLOAT_DURATION_MS,
    }
    setFloats((prev) => [...prev.slice(-7), toast])
    window.setTimeout(() => {
      setFloats((prev) => prev.filter((entry) => entry.key !== key))
    }, FLOAT_DURATION_MS + 80)
  }

  useEffect(() => {
    historyReadyRef.current = false
    seenIdsRef.current = new Set()
    setFloats([])
    return watchChat(
      room.id,
      userId,
      (history) => {
        for (const message of history) {
          seenIdsRef.current.add(message.id)
        }
        historyReadyRef.current = true
        setMessages(history)
      },
      (message) => {
        setMessages((prev) => {
          if (prev.some((entry) => entry.id === message.id)) return prev
          return [...prev, message]
        })
        if (historyReadyRef.current) spawnFloat(message)
        if (!openRef.current) setUnread((count) => count + 1)
      },
    )
  }, [room.id, userId])

  useEffect(() => {
    if (!open) return
    setUnread(0)
    const node = listRef.current
    if (node) node.scrollTop = node.scrollHeight
  }, [open, messages.length])

  const humans = room.players.filter(
    (player) => !player.isBot && player.id !== userId,
  )

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!canSend || busy || !text.trim()) return
    setBusy(true)
    setError('')
    try {
      const message = await sendChat(room.id, userId, text, toUserId || null)
      setMessages((prev) => {
        if (prev.some((entry) => entry.id === message.id)) return prev
        return [...prev, message]
      })
      spawnFloat(message)
      setText('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not send.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="chat-float-stage" aria-hidden="true">
        {floats.map((toast) => {
          const { message } = toast
          const mine = message.fromId === userId
          return (
            <div
              key={toast.key}
              className={`chat-float ${toast.drift} ${message.scope === 'dm' ? 'is-dm' : ''} ${playerColorClass(message.fromColor)}`}
              style={
                {
                  ...playerColorStyle(message.fromColor),
                  ['--chat-lane' as string]: String(toast.lane),
                  ['--chat-float-ms' as string]: `${toast.durationMs}ms`,
                } as CSSProperties
              }
            >
              <span className="chat-float-glow" />
              <div className="chat-float-card">
                <strong>
                  {mine ? 'You' : message.fromName}
                  {message.scope === 'dm'
                    ? ` → ${message.toId === userId ? 'you' : message.toName}`
                    : ''}
                </strong>
                <p>{message.text}</p>
              </div>
            </div>
          )
        })}
      </div>

      <div className={`game-chat ${open ? 'is-open' : ''}`}>
        <button
          type="button"
          className="game-chat-toggle"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
        >
          Chat
          {unread > 0 ? (
            <em className="game-chat-badge">{unread > 9 ? '9+' : unread}</em>
          ) : null}
        </button>

        {open ? (
          <div className="game-chat-panel" role="dialog" aria-label="Room chat">
            <div className="game-chat-header">
              <strong>Chat</strong>
              <button
                type="button"
                className="text-button"
                onClick={() => setOpen(false)}
              >
                Close
              </button>
            </div>

            <div className="game-chat-messages" ref={listRef}>
              {messages.length === 0 ? (
                <p className="game-chat-empty">No messages yet. Say hi.</p>
              ) : (
                messages.map((message) => {
                  const mine = message.fromId === userId
                  return (
                    <div
                      key={message.id}
                      className={`game-chat-bubble ${mine ? 'mine' : ''} ${message.scope === 'dm' ? 'dm' : ''} ${playerColorClass(message.fromColor)}`}
                      style={playerColorStyle(message.fromColor)}
                    >
                      <div className="game-chat-meta">
                        <strong>{mine ? 'You' : message.fromName}</strong>
                        {message.scope === 'dm' ? (
                          <span>
                            → {message.toId === userId ? 'you' : message.toName}
                          </span>
                        ) : (
                          <span>Everyone</span>
                        )}
                        <em>{formatChatTime(message.at)}</em>
                      </div>
                      <p>{message.text}</p>
                    </div>
                  )
                })
              )}
            </div>

            {canSend ? (
              <form
                className="game-chat-compose"
                onSubmit={(event) => void submit(event)}
              >
                <label className="game-chat-to">
                  To
                  <select
                    value={toUserId}
                    onChange={(event) => setToUserId(event.target.value)}
                  >
                    <option value="">Everyone</option>
                    {humans.map((player) => (
                      <option key={player.id} value={player.id}>
                        {player.name}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="game-chat-input-row">
                  <input
                    value={text}
                    maxLength={200}
                    placeholder={
                      toUserId ? 'Private message…' : 'Message everyone…'
                    }
                    onChange={(event) => setText(event.target.value)}
                  />
                  <button type="submit" disabled={busy || !text.trim()}>
                    Send
                  </button>
                </div>
                {error ? <p className="error">{error}</p> : null}
              </form>
            ) : (
              <p className="game-chat-readonly">
                Watching — you can read chat only.
              </p>
            )}
          </div>
        ) : null}
      </div>
    </>
  )
}
