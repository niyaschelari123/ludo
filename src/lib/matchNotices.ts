import { getSocket, whenConnected } from '../game/socket'
import type { GameMode, RoomStatus } from '../game/types'

export type LiveMatchNotice = {
  roomId: string
  code: string
  hostId: string
  hostName: string
  gameMode: GameMode
  status: Extract<RoomStatus, 'lobby' | 'playing'>
  playerCount: number
  maxPlayers: number
  startedAt: number
}

const DISMISS_KEY = 'ludo-match-notice-dismissed'

function normalizeNotices(raw: unknown): LiveMatchNotice[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null
      const data = entry as Partial<LiveMatchNotice>
      if (!data.roomId || !data.code || !data.hostId || !data.gameMode) return null
      const status = data.status === 'playing' ? 'playing' : 'lobby'
      return {
        roomId: String(data.roomId),
        code: String(data.code).toUpperCase(),
        hostId: String(data.hostId),
        hostName: String(data.hostName ?? 'Host'),
        gameMode: data.gameMode,
        status,
        playerCount:
          typeof data.playerCount === 'number' ? data.playerCount : 0,
        maxPlayers:
          typeof data.maxPlayers === 'number' ? data.maxPlayers : 0,
        startedAt: typeof data.startedAt === 'number' ? data.startedAt : 0,
      } satisfies LiveMatchNotice
    })
    .filter((entry): entry is LiveMatchNotice => entry != null)
    .sort((a, b) => b.startedAt - a.startedAt)
}

/**
 * Subscribe to open rooms / live matches from the game server
 * (home-screen clients on the same socket server).
 */
export function watchLiveMatches(
  onChange: (notices: LiveMatchNotice[]) => void,
): () => void {
  const socket = getSocket()
  const handle = (payload: unknown) => {
    onChange(normalizeNotices(payload))
  }

  let cancelled = false
  socket.on('liveMatchesUpdate', handle)

  const requestList = () => {
    if (cancelled) return
    socket.emit(
      'listLiveMatches',
      {},
      (response: { ok: true; data: { notices: LiveMatchNotice[] } } | { ok: false }) => {
        if (cancelled || !response || !('ok' in response) || !response.ok) return
        onChange(normalizeNotices(response.data.notices))
      },
    )
  }

  void whenConnected(socket).then(requestList)
  socket.on('connect', requestList)

  return () => {
    cancelled = true
    socket.off('liveMatchesUpdate', handle)
    socket.off('connect', requestList)
  }
}

/** @deprecated Server broadcasts when rooms change. */
export async function publishLiveMatch(_room: unknown) {}

/** @deprecated Finished / full rooms drop out of the server list automatically. */
export async function clearLiveMatch(_roomId: string) {}

export function loadDismissedMatchIds(): string[] {
  try {
    const raw = localStorage.getItem(DISMISS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((id): id is string => typeof id === 'string')
  } catch {
    return []
  }
}

export function saveDismissedMatchIds(ids: string[]) {
  localStorage.setItem(DISMISS_KEY, JSON.stringify([...new Set(ids)].slice(-40)))
}
