let context: AudioContext | null = null
let enabled = localStorage.getItem('ludo-sound') !== 'off'
const savedVolume = Number(localStorage.getItem('ludo-volume') ?? 0.8)
let masterVolume = Number.isFinite(savedVolume) ? savedVolume : 0.8
const OUTPUT_BOOST = 2.8

const SFX = {
  eliminate: '/eliminate.mp3',
  yourTurn: '/your-turn.mp3',
} as const

const sampleCache = new Map<string, HTMLAudioElement>()

function warmSample(src: string) {
  if (sampleCache.has(src)) return
  const audio = new Audio(src)
  audio.preload = 'auto'
  audio.load()
  sampleCache.set(src, audio)
}

warmSample(SFX.eliminate)
warmSample(SFX.yourTurn)

function audioContext() {
  if (!enabled) return null
  context ??= new AudioContext()
  if (context.state === 'suspended') void context.resume()
  return context
}

function playSample(src: string, volumeScale = 1) {
  if (!enabled) return
  void audioContext()
  warmSample(src)
  const cached = sampleCache.get(src)
  // Clone so overlapping plays work and start is instant from cache.
  const audio = cached ? (cached.cloneNode(true) as HTMLAudioElement) : new Audio(src)
  audio.volume = Math.max(0, Math.min(1, masterVolume * volumeScale))
  audio.currentTime = 0
  void audio.play().catch(() => {
    // Autoplay may be blocked until a user gesture unlocks audio.
  })
}

function tone(
  frequency: number,
  duration: number,
  {
    delay = 0,
    volume = 0.08,
    type = 'sine',
    endFrequency = frequency,
  }: {
    delay?: number
    volume?: number
    type?: OscillatorType
    endFrequency?: number
  } = {},
) {
  const audio = audioContext()
  if (!audio) return
  const start = audio.currentTime + delay
  const oscillator = audio.createOscillator()
  const gain = audio.createGain()
  oscillator.type = type
  oscillator.frequency.setValueAtTime(frequency, start)
  oscillator.frequency.exponentialRampToValueAtTime(
    Math.max(20, endFrequency),
    start + duration,
  )
  gain.gain.setValueAtTime(0.0001, start)
  gain.gain.exponentialRampToValueAtTime(
    Math.min(0.3, volume * masterVolume * OUTPUT_BOOST),
    start + 0.01,
  )
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration)
  oscillator.connect(gain).connect(audio.destination)
  oscillator.start(start)
  oscillator.stop(start + duration + 0.02)
}

export function isSoundEnabled() {
  return enabled
}

export function setSoundEnabled(next: boolean) {
  enabled = next
  localStorage.setItem('ludo-sound', next ? 'on' : 'off')
  if (next) playClick()
}

export function getSoundVolume() {
  return masterVolume
}

export function setSoundVolume(next: number) {
  masterVolume = Math.max(0, Math.min(1, next))
  localStorage.setItem('ludo-volume', String(masterVolume))
}

export function playClick() {
  tone(440, 0.045, { volume: 0.025, type: 'triangle', endFrequency: 520 })
}

export function playDiceTick() {
  tone(170 + Math.random() * 110, 0.055, {
    volume: 0.035,
    type: 'square',
    endFrequency: 120,
  })
}

export function playDiceResult() {
  tone(440, 0.09, { volume: 0.055, type: 'triangle', endFrequency: 560 })
  tone(660, 0.13, { delay: 0.08, volume: 0.06, type: 'triangle' })
}

export function playStep() {
  tone(260, 0.055, { volume: 0.028, type: 'triangle', endFrequency: 210 })
}

export function playEnter() {
  tone(280, 0.11, { volume: 0.055, type: 'triangle', endFrequency: 620 })
  tone(720, 0.09, { delay: 0.08, volume: 0.045, type: 'sine' })
}

export function playCapture() {
  playSample(SFX.eliminate, 0.55)
}

export function playHome() {
  ;[523, 659, 784, 1047].forEach((frequency, index) =>
    tone(frequency, 0.16, {
      delay: index * 0.085,
      volume: 0.075,
      type: 'triangle',
    }),
  )
  tone(523, 0.38, { delay: 0.34, volume: 0.045, type: 'sine' })
  tone(784, 0.38, { delay: 0.34, volume: 0.045, type: 'sine' })
}

export function playWin() {
  ;[523, 659, 784, 1047].forEach((frequency, index) =>
    tone(frequency, 0.28, {
      delay: index * 0.13,
      volume: 0.065,
      type: 'triangle',
    }),
  )
}

/** Desk bell — only the player whose turn just started should hear this. */
export function playYourTurn() {
  playSample(SFX.yourTurn, 0.85)
}

/** Bright metallic rise — shield picked up. */
export function playShieldGain() {
  tone(392, 0.08, { volume: 0.05, type: 'triangle', endFrequency: 523 })
  tone(523, 0.12, { delay: 0.06, volume: 0.065, type: 'sine', endFrequency: 784 })
  tone(784, 0.18, { delay: 0.12, volume: 0.055, type: 'triangle', endFrequency: 988 })
  tone(1175, 0.1, { delay: 0.2, volume: 0.035, type: 'sine' })
}

/** Soft break / shatter — shield blocked a hit and dropped. */
export function playShieldLose() {
  tone(620, 0.07, { volume: 0.055, type: 'square', endFrequency: 280 })
  tone(440, 0.1, { delay: 0.04, volume: 0.045, type: 'sawtooth', endFrequency: 160 })
  tone(220, 0.16, { delay: 0.09, volume: 0.04, type: 'triangle', endFrequency: 90 })
}
