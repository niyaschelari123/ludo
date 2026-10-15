/** Quick in-match emoji reactions that float over the board. */

export const REACTION_KINDS = [
  'laugh',
  'clap',
  'salt',
  'fire',
  'wow',
  'skull',
  'heart',
  'cry',
  'angry',
  'cool',
  'party',
  'flex',
  'think',
  'sleepy',
  'poop',
  'eyes',
  'hundred',
  'rocket',
  'bomb',
  'star',
  'trophy',
  'devil',
  'angel',
  'wave',
] as const

export type ReactionKind = (typeof REACTION_KINDS)[number]

export const REACTION_EMOJIS: Record<ReactionKind, string> = {
  laugh: '😂',
  clap: '👏',
  salt: '🧂',
  fire: '🔥',
  wow: '😮',
  skull: '💀',
  heart: '❤️',
  cry: '😭',
  angry: '😡',
  cool: '😎',
  party: '🥳',
  flex: '💪',
  think: '🤔',
  sleepy: '😴',
  poop: '💩',
  eyes: '👀',
  hundred: '💯',
  rocket: '🚀',
  bomb: '💣',
  star: '⭐',
  trophy: '🏆',
  devil: '😈',
  angel: '😇',
  wave: '👋',
}

export const REACTION_LABELS: Record<ReactionKind, string> = {
  laugh: 'Laugh',
  clap: 'Clap',
  salt: 'Salt',
  fire: 'Fire',
  wow: 'Wow',
  skull: 'Skull',
  heart: 'Heart',
  cry: 'Cry',
  angry: 'Angry',
  cool: 'Cool',
  party: 'Party',
  flex: 'Flex',
  think: 'Think',
  sleepy: 'Sleepy',
  poop: 'Poop',
  eyes: 'Eyes',
  hundred: 'Hundred',
  rocket: 'Rocket',
  bomb: 'Bomb',
  star: 'Star',
  trophy: 'Trophy',
  devil: 'Devil',
  angel: 'Angel',
  wave: 'Wave',
}

export function isReactionKind(value: unknown): value is ReactionKind {
  return typeof value === 'string' && (REACTION_KINDS as readonly string[]).includes(value)
}

export function reactionEmoji(kind: ReactionKind) {
  return REACTION_EMOJIS[kind]
}
