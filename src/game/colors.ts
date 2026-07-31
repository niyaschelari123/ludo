import { PLAYER_COLORS, type PlayerColor } from './types'

export const PLAYER_COLOR_HEX: Record<PlayerColor, string> = {
  red: '#ed1c24',
  green: '#00a651',
  yellow: '#ffd400',
  blue: '#0095da',
  orange: '#f58220',
  purple: '#92278f',
  cyan: '#00bcd4',
  pink: '#ec407a',
  teal: '#14b8a6',
  lime: '#84cc16',
}

export function isNamedPlayerColor(color: string): color is PlayerColor {
  return (PLAYER_COLORS as readonly string[]).includes(color)
}

export function normalizeColorKey(color: string): string {
  const trimmed = color.trim()
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed.toLowerCase()
  if (isNamedPlayerColor(trimmed)) return trimmed
  throw new Error('Invalid color.')
}

export function resolveColorHex(color: string): string {
  if (/^#[0-9a-fA-F]{6}$/i.test(color)) return color.toLowerCase()
  if (isNamedPlayerColor(color)) return PLAYER_COLOR_HEX[color]
  return '#64748b'
}

function mixHex(hex: string, toward: number, amount: number) {
  const value = hex.replace('#', '')
  const mix = (channel: number) =>
    Math.round(channel + (toward - channel) * amount)
      .toString(16)
      .padStart(2, '0')
  const r = Number.parseInt(value.slice(0, 2), 16)
  const g = Number.parseInt(value.slice(2, 4), 16)
  const b = Number.parseInt(value.slice(4, 6), 16)
  return `#${mix(r)}${mix(g)}${mix(b)}`
}

export function tokenStyleFor(color: string) {
  const fill = resolveColorHex(color)
  return {
    fill,
    rim: mixHex(fill, 0, 0.38),
    shine: mixHex(fill, 255, 0.42),
    glow: mixHex(fill, 255, 0.55),
  }
}
