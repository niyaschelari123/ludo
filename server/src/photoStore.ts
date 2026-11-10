/**
 * Profile photos are stored in rooms as base64 data URLs (up to ~400KB each).
 * Sending them inside every `stateUpdate` made each dice roll / move very heavy,
 * so room views reference them by URL instead and the browser caches the image.
 */
import { createHash } from 'node:crypto'

const MAX_PHOTOS = 500

const idByData = new Map<string, string>()
const dataById = new Map<string, string>()

const PORT = Number(process.env.PORT) || 3001

function baseUrl() {
  const configured = process.env.PUBLIC_BASE_URL ?? process.env.RENDER_EXTERNAL_URL
  return (configured ?? `http://localhost:${PORT}`).replace(/\/$/, '')
}

function register(dataUrl: string) {
  const known = idByData.get(dataUrl)
  if (known) return known

  const id = createHash('sha1').update(dataUrl).digest('hex').slice(0, 24)
  idByData.set(dataUrl, id)
  dataById.set(id, dataUrl)

  if (dataById.size > MAX_PHOTOS) {
    const oldestId = dataById.keys().next().value as string | undefined
    if (oldestId) {
      const oldestData = dataById.get(oldestId)
      dataById.delete(oldestId)
      if (oldestData) idByData.delete(oldestData)
    }
  }
  return id
}

/** Turn a stored data URL into a small, cacheable image URL. */
export function photoUrlFor(dataUrl: string | undefined): string | undefined {
  if (!dataUrl) return undefined
  if (!dataUrl.startsWith('data:')) return dataUrl
  return `${baseUrl()}/photo/${register(dataUrl)}`
}

export function readPhoto(id: string): { mime: string; body: Buffer } | null {
  const dataUrl = dataById.get(id)
  if (!dataUrl) return null
  const match = /^data:(image\/[a-z]+);base64,(.*)$/is.exec(dataUrl)
  if (!match) return null
  return { mime: match[1]!, body: Buffer.from(match[2]!, 'base64') }
}
