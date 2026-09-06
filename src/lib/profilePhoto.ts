/** Max stored / exported profile photo size (bytes). */
export const PROFILE_PHOTO_MAX_BYTES = 400 * 1024

/** Allow larger source files — crop + JPEG compress down to PROFILE_PHOTO_MAX_BYTES. */
export const PROFILE_PHOTO_SOURCE_MAX_BYTES = 8 * 1024 * 1024

/** Square output size for profile photos. */
export const PROFILE_PHOTO_OUTPUT_SIZE = 320

const DATA_URL_PREFIX = /^data:image\/(jpeg|jpg|png|webp);base64,/i

export function assertPhotoFileSize(file: File) {
  if (file.size > PROFILE_PHOTO_SOURCE_MAX_BYTES) {
    throw new Error('Photo is too large (max 8MB).')
  }
  if (file.type && !file.type.startsWith('image/')) {
    throw new Error('Choose an image file.')
  }
}

export function sanitizePhotoDataUrl(value: unknown): string | undefined {
  if (value == null || value === '') return undefined
  if (typeof value !== 'string') throw new Error('Invalid photo.')
  if (!DATA_URL_PREFIX.test(value)) {
    throw new Error('Photo must be a cropped image.')
  }
  // Base64 expands ~4/3; allow a little overhead for the data-URL prefix.
  const maxChars = Math.ceil(PROFILE_PHOTO_MAX_BYTES * (4 / 3)) + 64
  if (value.length > maxChars) {
    throw new Error('Photo must be 400KB or smaller.')
  }
  return value
}

export function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  assertPhotoFileSize(file)
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Could not read that image.'))
    }
    image.src = url
  })
}

export function revokeImageObjectUrl(image: HTMLImageElement) {
  if (image.src.startsWith('blob:')) {
    URL.revokeObjectURL(image.src)
  }
}

/**
 * Export a 1:1 crop from `image` using normalized crop state.
 * `offsetX` / `offsetY` are image-pixel offsets of the crop top-left.
 * `cropSize` is the square side in image pixels.
 */
export async function exportSquareCrop(
  image: HTMLImageElement,
  offsetX: number,
  offsetY: number,
  cropSize: number,
): Promise<string> {
  const canvas = document.createElement('canvas')
  canvas.width = PROFILE_PHOTO_OUTPUT_SIZE
  canvas.height = PROFILE_PHOTO_OUTPUT_SIZE
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not crop image.')

  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(
    image,
    offsetX,
    offsetY,
    cropSize,
    cropSize,
    0,
    0,
    PROFILE_PHOTO_OUTPUT_SIZE,
    PROFILE_PHOTO_OUTPUT_SIZE,
  )

  let quality = 0.92
  let dataUrl = canvas.toDataURL('image/jpeg', quality)
  while (dataUrlByteLength(dataUrl) > PROFILE_PHOTO_MAX_BYTES && quality > 0.45) {
    quality -= 0.07
    dataUrl = canvas.toDataURL('image/jpeg', quality)
  }
  if (dataUrlByteLength(dataUrl) > PROFILE_PHOTO_MAX_BYTES) {
    throw new Error('Cropped photo is still over 400KB. Try a smaller image.')
  }
  return dataUrl
}

function dataUrlByteLength(dataUrl: string) {
  const comma = dataUrl.indexOf(',')
  const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl
  return Math.floor((base64.length * 3) / 4)
}
