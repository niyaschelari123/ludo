import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { exportSquareCrop } from '../lib/profilePhoto'

type ProfilePhotoCropperProps = {
  image: HTMLImageElement
  busy?: boolean
  onCancel: () => void
  onApply: (dataUrl: string) => void | Promise<void>
}

const VIEW = 280

export function ProfilePhotoCropper({
  image,
  busy = false,
  onCancel,
  onApply,
}: ProfilePhotoCropperProps) {
  const minZoom = Math.max(VIEW / image.naturalWidth, VIEW / image.naturalHeight)
  const [zoom, setZoom] = useState(minZoom)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [error, setError] = useState('')
  const dragRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    originX: number
    originY: number
  } | null>(null)

  useEffect(() => {
    const fitted = Math.max(VIEW / image.naturalWidth, VIEW / image.naturalHeight)
    setZoom(fitted)
    setOffset({
      x: (VIEW - image.naturalWidth * fitted) / 2,
      y: (VIEW - image.naturalHeight * fitted) / 2,
    })
    setError('')
  }, [image])

  const clampOffset = (next: { x: number; y: number }, nextZoom: number) => {
    const width = image.naturalWidth * nextZoom
    const height = image.naturalHeight * nextZoom
    const minX = VIEW - width
    const minY = VIEW - height
    return {
      x: Math.min(0, Math.max(minX, next.x)),
      y: Math.min(0, Math.max(minY, next.y)),
    }
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (busy) return
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: offset.x,
      originY: offset.y,
    }
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    setOffset(
      clampOffset(
        {
          x: drag.originX + (event.clientX - drag.startX),
          y: drag.originY + (event.clientY - drag.startY),
        },
        zoom,
      ),
    )
  }

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null
    }
  }

  const changeZoom = (nextZoom: number) => {
    const clamped = Math.min(Math.max(nextZoom, minZoom), minZoom * 4)
    const cx = VIEW / 2
    const cy = VIEW / 2
    const scale = clamped / zoom
    setZoom(clamped)
    setOffset(
      clampOffset(
        {
          x: cx - (cx - offset.x) * scale,
          y: cy - (cy - offset.y) * scale,
        },
        clamped,
      ),
    )
  }

  const apply = async () => {
    setError('')
    try {
      const cropSize = VIEW / zoom
      const offsetX = -offset.x / zoom
      const offsetY = -offset.y / zoom
      const dataUrl = await exportSquareCrop(image, offsetX, offsetY, cropSize)
      await onApply(dataUrl)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not crop photo.')
    }
  }

  return (
    <div
      className="confirm-overlay photo-crop-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Crop profile photo"
      onClick={() => !busy && onCancel()}
    >
      <div
        className="confirm-card photo-crop-card"
        onClick={(event) => event.stopPropagation()}
      >
        <h2>Crop photo</h2>
        <p>Drag to frame your face. Square crop — saved at most 400KB.</p>
        <div
          className="photo-crop-viewport"
          style={{ width: VIEW, height: VIEW }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <img
            src={image.src}
            alt=""
            draggable={false}
            style={{
              width: image.naturalWidth * zoom,
              height: image.naturalHeight * zoom,
              transform: `translate(${offset.x}px, ${offset.y}px)`,
            }}
          />
          <div className="photo-crop-frame" aria-hidden="true" />
        </div>
        <label className="photo-crop-zoom">
          Zoom
          <input
            type="range"
            min={minZoom}
            max={minZoom * 4}
            step={0.01}
            value={zoom}
            disabled={busy}
            onChange={(event) => changeZoom(Number(event.target.value))}
          />
        </label>
        {error ? <p className="photo-crop-error">{error}</p> : null}
        <div className="confirm-actions">
          <button
            type="button"
            className="cancel-button"
            disabled={busy}
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={busy}
            onClick={() => void apply()}
          >
            {busy ? 'Saving…' : 'Use photo'}
          </button>
        </div>
      </div>
    </div>
  )
}
