import type { CSSProperties } from 'react'

type PlayerAvatarProps = {
  name: string
  photoUrl?: string | null
  className?: string
  style?: CSSProperties
}

export function PlayerAvatar({
  name,
  photoUrl,
  className = 'avatar',
  style,
}: PlayerAvatarProps) {
  const initial = (name?.trim()?.[0] ?? '?').toUpperCase()
  if (photoUrl) {
    return (
      <span className={`${className} avatar--photo`} style={style}>
        <img src={photoUrl} alt="" draggable={false} />
      </span>
    )
  }
  return (
    <span className={className} style={style}>
      {initial}
    </span>
  )
}
