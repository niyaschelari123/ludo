import { getGuestPlayerId } from './playerId'
import { fetchCloudProfile, pushCloudProfile } from './profileCloud'

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

/**
 * Starting career wins (seeded into Firestore when missing).
 * Update these if you want different baselines — only applied when `wins` is absent.
 */
export const INITIAL_ACCOUNT_WINS: Record<string, number> = {
  'acct:niyas': 0,
  'acct:amaljith': 0,
  'acct:anfah': 0,
  'acct:anjal': 0,
  'acct:joji': 0,
  'acct:suhail': 0,
  'acct:vishnu': 0,
  'acct:vivek': 0,
}

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

export function isLoginAccountId(id: string | null | undefined): boolean {
  return Boolean(id && id.startsWith('acct:'))
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

/** Local save + best-effort Firestore sync for name/color. */
export function saveProfile(profile: UserProfile) {
  localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile))
  localStorage.setItem('ludo-name', profile.name)
  void pushCloudProfile(profile)
}

/** Same as saveProfile, but waits for Firestore so the Save button can confirm. */
export async function saveProfileAsync(profile: UserProfile) {
  localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile))
  localStorage.setItem('ludo-name', profile.name)
  await pushCloudProfile(profile, { throwOnError: true })
}

export function clearProfile() {
  localStorage.removeItem(PROFILE_STORAGE_KEY)
}

/**
 * PIN stays local. Name/color prefer Firestore when available so they survive
 * new browsers / cleared storage / new game sessions.
 */
export async function loginWithPin(pin: string): Promise<UserProfile> {
  if (!isLoginPin(pin)) throw new Error('Invalid code.')
  const account = LOGIN_ACCOUNTS[pin]
  const existing = loadProfile()
  const sameAccount = existing?.pin === pin

  let name =
    sameAccount && existing.name ? existing.name : account.defaultName
  let color = sameAccount ? existing.color : ''

  const remote = await fetchCloudProfile(account.accountId)
  if (remote) {
    if (remote.name) name = remote.name
    if (remote.color) color = remote.color
  }

  const profile: UserProfile = {
    pin,
    accountId: account.accountId,
    name,
    color,
  }
  saveProfile(profile)
  return profile
}

/**
 * Refresh local profile from Firestore (e.g. on app load while already logged in).
 */
export async function hydrateProfileFromCloud(
  profile: UserProfile | null = loadProfile(),
): Promise<UserProfile | null> {
  if (!profile) return null
  const remote = await fetchCloudProfile(profile.accountId)
  if (!remote) return profile

  const next: UserProfile = {
    ...profile,
    name: remote.name || profile.name,
    color: remote.color || profile.color,
  }
  if (next.name === profile.name && next.color === profile.color) return profile

  // Avoid a redundant cloud write loop — write local only, then push once.
  localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(next))
  localStorage.setItem('ludo-name', next.name)
  void pushCloudProfile(next)
  return next
}

/** Prefer the logged-in account id; otherwise a stable guest id. */
export function getActiveUserId(profile: UserProfile | null = loadProfile()) {
  return profile?.accountId ?? getGuestPlayerId()
}
