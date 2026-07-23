import { io, type Socket } from 'socket.io-client'

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL ?? 'http://localhost:3001'

let socket: Socket | null = null

/** Shared Socket.IO client for the game backend. */
export function getSocket() {
  if (!socket) {
    socket = io(SOCKET_URL, {
      autoConnect: true,
      transports: ['websocket', 'polling'],
    })
  }
  return socket
}

/** Wait until the socket is connected before emitting game events. */
export function whenConnected(socket = getSocket()): Promise<void> {
  if (socket.connected) return Promise.resolve()
  return new Promise((resolve) => {
    socket.once('connect', () => resolve())
  })
}

export type SocketAck<T> =
  | { ok: true; data: T }
  | { ok: false; error: string }

/** Emit a socket event and wait for an acknowledgement callback. */
export function emitAck<T>(
  event: string,
  payload: unknown,
  timeoutMs = 10_000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const socket = getSocket()
    let settled = false

    const finish = (action: () => void) => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      action()
    }

    const timer = window.setTimeout(() => {
      finish(() => reject(new Error('Game server did not respond in time.')))
    }, timeoutMs)

    const emit = () => {
      socket.emit(event, payload, (response: SocketAck<T>) => {
        if (response?.ok) finish(() => resolve(response.data))
        else finish(() => reject(new Error(response?.error ?? 'Socket request failed.')))
      })
    }

    if (socket.connected) emit()
    else socket.once('connect', emit)
  })
}
