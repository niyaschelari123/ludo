const STORAGE_KEY = 'ludo-player-id'

/** Stable anonymous player id stored in the browser. */
export function getPlayerId(): string {
  let id = localStorage.getItem(STORAGE_KEY)
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem(STORAGE_KEY, id)
  }
  return id
}
