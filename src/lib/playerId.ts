const STORAGE_KEY = 'ludo-player-id'

/** Stable anonymous guest id stored in the browser. */
export function getGuestPlayerId(): string {
  let id = localStorage.getItem(STORAGE_KEY)
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem(STORAGE_KEY, id)
  }
  return id
}

/** @deprecated Prefer getActiveUserId from profile.ts */
export function getPlayerId(): string {
  return getGuestPlayerId()
}
