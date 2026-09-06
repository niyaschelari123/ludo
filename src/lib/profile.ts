import { getGuestPlayerId } from './playerId'
import { sanitizePhotoDataUrl } from './profilePhoto'

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
  /** Admin — can edit career “most” stats; excluded from leaderboards. */
  '5071': { accountId: 'acct:admin', defaultName: 'Admin' },
} as const

export const ADMIN_ACCOUNT_ID = LOGIN_ACCOUNTS['5071'].accountId
export const ADMIN_PIN = '5071' as const

/** Login accounts that appear on career / most boards (excludes admin). */
export const CAREER_LOGIN_ACCOUNTS = Object.fromEntries(
  Object.entries(LOGIN_ACCOUNTS).filter(
    ([, account]) => account.accountId !== ADMIN_ACCOUNT_ID,
  ),
) as Omit<typeof LOGIN_ACCOUNTS, typeof ADMIN_PIN>

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

/**
 * Starting MotM career counts (seeded when `motm` is absent).
 * Anfah / Amal (Amaljith) / Niyas start at 1.
 */
export const INITIAL_ACCOUNT_MOTM: Record<string, number> = {
  'acct:niyas': 1,
  'acct:amaljith': 1,
  'acct:anfah': 1,
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
  /** Cropped square JPEG/PNG data URL (≤400KB). */
  photoUrl?: string
}

export function isLoginPin(value: string): value is LoginPin {
  return value in LOGIN_ACCOUNTS
}

export function isLoginAccountId(id: string | null | undefined): boolean {
  return Boolean(id && id.startsWith('acct:'))
}

export function isAdminAccountId(id: string | null | undefined): boolean {
  return id === ADMIN_ACCOUNT_ID
}

/** Login humans that count toward career eligibility / boards (not admin). */
export function isCareerAccountId(id: string | null | undefined): boolean {
  return isLoginAccountId(id) && !isAdminAccountId(id)
}

export function loadProfile(): UserProfile | null {
  try {
    const raw = localStorage.getItem(PROFILE_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<UserProfile>
    if (!parsed.pin || !isLoginPin(parsed.pin)) return null
    const account = LOGIN_ACCOUNTS[parsed.pin]
    let photoUrl: string | undefined
    try {
      photoUrl = sanitizePhotoDataUrl(parsed.photoUrl)
    } catch {
      photoUrl = undefined
    }
    return {
      pin: parsed.pin,
      accountId: account.accountId,
      name: (parsed.name ?? account.defaultName).trim().slice(0, 18) || account.defaultName,
      color: typeof parsed.color === 'string' && parsed.color ? parsed.color : '',
      ...(photoUrl ? { photoUrl } : {}),
    }
  } catch {
    return null
  }
}

/** Local save + best-effort Firestore sync for name/color. */
export function saveProfile(profile: UserProfile) {
  localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile))
  localStorage.setItem('ludo-name', profile.name)
  // Lazy import so the Socket server can load login helpers without Firebase.
  void import('./profileCloud').then(({ pushCloudProfile }) => {
    void pushCloudProfile(profile)
  })
}

/** Same as saveProfile, but waits for Firestore so the Save button can confirm. */
export async function saveProfileAsync(profile: UserProfile) {
  localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile))
  localStorage.setItem('ludo-name', profile.name)
  const { pushCloudProfile } = await import('./profileCloud')
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
  let photoUrl = sameAccount ? existing.photoUrl : undefined

  const { fetchCloudProfile } = await import('./profileCloud')
  const remote = await fetchCloudProfile(account.accountId)
  if (remote) {
    if (remote.name) name = remote.name
    if (remote.color) color = remote.color
    if (remote.photoUrl) photoUrl = remote.photoUrl
    else if (remote.photoUrl === '') photoUrl = undefined
  }

  const profile: UserProfile = {
    pin,
    accountId: account.accountId,
    name,
    color,
    ...(photoUrl ? { photoUrl } : {}),
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
  const { fetchCloudProfile, pushCloudProfile } = await import('./profileCloud')
  const remote = await fetchCloudProfile(profile.accountId)
  if (!remote) return profile

  const next: UserProfile = {
    ...profile,
    name: remote.name || profile.name,
    color: remote.color || profile.color,
    ...(remote.photoUrl
      ? { photoUrl: remote.photoUrl }
      : remote.photoUrl === ''
        ? { photoUrl: undefined }
        : {}),
  }
  const photoChanged =
    (next.photoUrl ?? '') !== (profile.photoUrl ?? '')
  if (
    next.name === profile.name &&
    next.color === profile.color &&
    !photoChanged
  ) {
    return profile
  }

  // Avoid a redundant cloud write loop — write local only, then push once.
  const stored = { ...next }
  if (!stored.photoUrl) delete stored.photoUrl
  localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(stored))
  localStorage.setItem('ludo-name', next.name)
  void pushCloudProfile(next)
  return next
}

/** Prefer the logged-in account id; otherwise a stable guest id. */
export function getActiveUserId(profile: UserProfile | null = loadProfile()) {
  return profile?.accountId ?? getGuestPlayerId()
}
