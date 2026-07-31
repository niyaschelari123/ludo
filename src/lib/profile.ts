import { getGuestPlayerId } from './playerId'

export const PROFILE_STORAGE_KEY = 'ludo-profile'

export const LOGIN_ACCOUNTS = {
  '3661': { accountId: 'acct:niyas', defaultName: 'Niyas' },
  '6397': { accountId: 'acct:amaljith', defaultName: 'Amaljith' },
  '4411': { accountId: 'acct:anfah', defaultName: 'Anfah' },
  '4294': { accountId: 'acct:anjal', defaultName: 'Anjal' },
  '3511': { accountId: 'acct:joji', defaultName: 'Joji' },
  '1958': { accountId: 'acct:suhail', defaultName: 'Suhail' },
  '9368': { accountId: 'acct:vishnu', defaultName: 'Vishnu' },
  '7695': { accountId: 'acct:vivek', defaultName: 'Vivek' },
} as const

export type LoginPin = keyof typeof LOGIN_ACCOUNTS

export type UserProfile = {
  pin: LoginPin
  accountId: string
  name: string
  color: string
}

export function isLoginPin(value: string): value is LoginPin {
  return value in LOGIN_ACCOUNTS
}

export function loadProfile(): UserProfile | null {
  try {
    const raw = localStorage.getItem(PROFILE_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<UserProfile>
    if (!parsed.pin || !isLoginPin(parsed.pin)) return null
    const account = LOGIN_ACCOUNTS[parsed.pin]
    return {
      pin: parsed.pin,
      accountId: account.accountId,
      name: (parsed.name ?? account.defaultName).trim().slice(0, 18) || account.defaultName,
      color: typeof parsed.color === 'string' && parsed.color ? parsed.color : '',
    }
  } catch {
    return null
  }
}

export function saveProfile(profile: UserProfile) {
  localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile))
  localStorage.setItem('ludo-name', profile.name)
}

export function clearProfile() {
  localStorage.removeItem(PROFILE_STORAGE_KEY)
}

export function loginWithPin(pin: string): UserProfile {
  if (!isLoginPin(pin)) throw new Error('Invalid code.')
  const account = LOGIN_ACCOUNTS[pin]
  const existing = loadProfile()
  const profile: UserProfile = {
    pin,
    accountId: account.accountId,
    name:
      existing?.pin === pin && existing.name
        ? existing.name
        : account.defaultName,
    color: existing?.pin === pin ? existing.color : '',
  }
  saveProfile(profile)
  return profile
}

/** Prefer the logged-in account id; otherwise a stable guest id. */
export function getActiveUserId(profile: UserProfile | null = loadProfile()) {
  return profile?.accountId ?? getGuestPlayerId()
}
