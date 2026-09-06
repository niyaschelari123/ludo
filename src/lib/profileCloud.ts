import {
  doc,
  getDoc,
  getDocs,
  query,
  where,
  documentId,
  serverTimestamp,
  setDoc,
  runTransaction,
  collection,
} from 'firebase/firestore'
import { signInAnonymously } from 'firebase/auth'
import { auth, db, isFirebaseConfigured } from '../firebase'
import type { UserProfile } from './profile'
import {
  ADMIN_ACCOUNT_ID,
  CAREER_LOGIN_ACCOUNTS,
  INITIAL_ACCOUNT_MOTM,
  INITIAL_ACCOUNT_WINS,
  isAdminAccountId,
  isCareerAccountId,
  isLoginAccountId,
} from './profile'
import { sanitizePhotoDataUrl } from './profilePhoto'
import type { Room } from '../game/types'

export type CareerBoardEntry = {
  accountId: string
  name: string
  color: string
  wins: number
  motm: number
  /** Times awarded Worst Player of the Match. */
  worst: number
  /** Times finished 2nd. */
  second: number
  /** Times finished 3rd. */
  third: number
  /** Career eliminations (captures) made. */
  eliminations: number
  /** Career times your tokens were eliminated. */
  timesEliminated: number
  /** Career sixes rolled. */
  sixes: number
  /** Career matches finished (eligible games). */
  matchesPlayed: number
  /** Sum of MotM award scores across matches. */
  motmPoints: number
  /** Career landings on ←2 / ←3 / −5 tiles (Oonjaal). */
  negativePowers: number
  /** Career Super (⚡) leaps used. */
  superPowers: number
  /** Career landings on the +3 power tile. */
  plus3: number
  /** Best (lowest) all-tokens-home finish time in ms; 0 = none. */
  bestFinishMs: number
  /** Career eliminations of each rival login account (victimId → count). */
  elimPairs: Record<string, number>
}

export type CareerStatKey =
  | 'wins'
  | 'motm'
  | 'worst'
  | 'second'
  | 'third'
  | 'eliminations'
  | 'timesEliminated'
  | 'sixes'
  | 'matchesPlayed'
  | 'motmPoints'
  | 'negativePowers'
  | 'superPowers'
  | 'plus3'
  | 'bestFinishMs'

const CAREER_STAT_KEYS: CareerStatKey[] = [
  'wins',
  'motm',
  'worst',
  'second',
  'third',
  'eliminations',
  'timesEliminated',
  'sixes',
  'matchesPlayed',
  'motmPoints',
  'negativePowers',
  'superPowers',
  'plus3',
  'bestFinishMs',
]

function roundCareerPoints(value: number) {
  return Math.round(Math.max(0, value) * 10) / 10
}

function emptyCareerStats(accountId: string): Pick<
  CareerBoardEntry,
  CareerStatKey
> {
  return {
    wins: INITIAL_ACCOUNT_WINS[accountId] ?? 0,
    motm: INITIAL_ACCOUNT_MOTM[accountId] ?? 0,
    worst: 0,
    second: 0,
    third: 0,
    eliminations: 0,
    timesEliminated: 0,
    sixes: 0,
    matchesPlayed: 0,
    motmPoints: 0,
    negativePowers: 0,
    superPowers: 0,
    plus3: 0,
    bestFinishMs: 0,
  }
}

async function ensureAnonymousAuth() {
  if (!isFirebaseConfigured || !auth) return false
  if (auth.currentUser) return true
  await signInAnonymously(auth)
  return Boolean(auth.currentUser)
}

export function profileDocId(accountId: string) {
  return accountId.replace(/[/\\]/g, '_')
}

export type CloudProfile = {
  accountId: string
  name: string
  color: string
  photoUrl?: string
  wins: number
  motm: number
  worst?: number
  second?: number
  third?: number
  eliminations?: number
  timesEliminated?: number
  sixes?: number
  matchesPlayed?: number
  motmPoints?: number
  negativePowers?: number
  superPowers?: number
  plus3?: number
  bestFinishMs?: number
  /** victimAccountId → career elimination count. */
  elimPairs?: Record<string, number>
}

function readStatCount(
  data: Partial<CloudProfile> | undefined,
  key: CareerStatKey,
  accountId: string,
) {
  const value = data?.[key]
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    if (key === 'motmPoints') return roundCareerPoints(value)
    return Math.floor(value)
  }
  if (key === 'wins') return INITIAL_ACCOUNT_WINS[accountId] ?? 0
  if (key === 'motm') return INITIAL_ACCOUNT_MOTM[accountId] ?? 0
  return 0
}

function readWins(data: Partial<CloudProfile> | undefined, accountId: string) {
  return readStatCount(data, 'wins', accountId)
}

function readMotm(data: Partial<CloudProfile> | undefined, accountId: string) {
  return readStatCount(data, 'motm', accountId)
}

function readElimPairs(
  data: Partial<CloudProfile> | undefined,
): Record<string, number> {
  const raw = data?.elimPairs
  if (!raw || typeof raw !== 'object') return {}
  const out: Record<string, number> = {}
  for (const [victimId, count] of Object.entries(raw)) {
    if (!isCareerAccountId(victimId)) continue
    const n = Number(count)
    if (!Number.isFinite(n) || n <= 0) continue
    out[victimId] = Math.floor(n)
  }
  return out
}

function mergeElimPairs(
  base: Record<string, number>,
  delta: Record<string, number>,
): Record<string, number> {
  const next = { ...base }
  for (const [victimId, count] of Object.entries(delta)) {
    if (!isCareerAccountId(victimId)) continue
    const n = Math.max(0, Math.floor(Number(count)))
    if (n <= 0) continue
    next[victimId] = (next[victimId] ?? 0) + n
  }
  return next
}

function sanitizeElimPairDelta(
  pairs: Record<string, number> | undefined,
): Record<string, number> {
  if (!pairs) return {}
  return mergeElimPairs({}, pairs)
}

export type ElimPairLeader = {
  attackerId: string
  attackerName: string
  attackerColor: string
  victimId: string
  victimName: string
  victimColor: string
  count: number
}

/** Top career “A eliminated B” pairs across all login players. */
export function buildElimPairLeaders(
  board: CareerBoardEntry[],
  limit = 8,
): ElimPairLeader[] {
  const byId = new Map(board.map((entry) => [entry.accountId, entry]))
  const pairs: ElimPairLeader[] = []
  for (const attacker of board) {
    for (const [victimId, count] of Object.entries(attacker.elimPairs ?? {})) {
      if (!isCareerAccountId(victimId) || count <= 0) continue
      const victim = byId.get(victimId)
      pairs.push({
        attackerId: attacker.accountId,
        attackerName: attacker.name,
        attackerColor: attacker.color || '#64748b',
        victimId,
        victimName: victim?.name ?? victimId.replace(/^acct:/, ''),
        victimColor: victim?.color || '#64748b',
        count,
      })
    }
  }
  return pairs
    .sort(
      (a, b) =>
        b.count - a.count ||
        a.attackerName.localeCompare(b.attackerName) ||
        a.victimName.localeCompare(b.victimName),
    )
    .slice(0, Math.max(0, limit))
}

function readCareerStats(
  data: Partial<CloudProfile> | undefined,
  accountId: string,
): Pick<CareerBoardEntry, CareerStatKey> {
  return {
    wins: readStatCount(data, 'wins', accountId),
    motm: readStatCount(data, 'motm', accountId),
    worst: readStatCount(data, 'worst', accountId),
    second: readStatCount(data, 'second', accountId),
    third: readStatCount(data, 'third', accountId),
    eliminations: readStatCount(data, 'eliminations', accountId),
    timesEliminated: readStatCount(data, 'timesEliminated', accountId),
    sixes: readStatCount(data, 'sixes', accountId),
    matchesPlayed: readStatCount(data, 'matchesPlayed', accountId),
    motmPoints: readStatCount(data, 'motmPoints', accountId),
    negativePowers: readStatCount(data, 'negativePowers', accountId),
    superPowers: readStatCount(data, 'superPowers', accountId),
    plus3: readStatCount(data, 'plus3', accountId),
    bestFinishMs: readStatCount(data, 'bestFinishMs', accountId),
  }
}

/** How many distinct logged-in humans played in this room (incl. departed). */
export function countLoginPlayersInMatch(room: Room): number {
  const ids = new Set<string>()
  for (const player of [...room.players, ...(room.departedPlayers ?? [])]) {
    if (player.isBot) continue
    if (!isCareerAccountId(player.id)) continue
    ids.add(player.id)
  }
  return ids.size
}

/** Career win/MotM only count when ≥3 login accounts were in the match. */
export function isCareerEligibleMatch(room: Room): boolean {
  return countLoginPlayersInMatch(room) >= 3
}

/** Load name/color/wins/motm for an account from Firestore (never stores PIN). */
export async function fetchCloudProfile(
  accountId: string,
): Promise<CloudProfile | null> {
  if (!isFirebaseConfigured || !db) return null
  try {
    await ensureAnonymousAuth()
    const ref = doc(db, 'profiles', profileDocId(accountId))
    const snap = await getDoc(ref)
    if (!snap.exists()) {
      const stats = emptyCareerStats(accountId)
      await setDoc(
        ref,
        {
          accountId,
          name: '',
          color: '',
          ...stats,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      )
      return { accountId, name: '', color: '', ...stats }
    }
    const data = snap.data() as Partial<CloudProfile>
    const stats = readCareerStats(data, accountId)
    const patch: Record<string, unknown> = { accountId }
    for (const key of CAREER_STAT_KEYS) {
      if (typeof data[key] !== 'number') patch[key] = stats[key]
    }
    if (Object.keys(patch).length > 1) {
      await setDoc(ref, patch, { merge: true })
    }
    return {
      accountId,
      name: typeof data.name === 'string' ? data.name.trim().slice(0, 18) : '',
      color: typeof data.color === 'string' ? data.color : '',
      ...(typeof data.photoUrl === 'string'
        ? (() => {
            try {
              const photoUrl = sanitizePhotoDataUrl(data.photoUrl)
              return photoUrl ? { photoUrl } : { photoUrl: '' }
            } catch {
              return { photoUrl: '' }
            }
          })()
        : {}),
      ...stats,
    }
  } catch (error) {
    console.warn('Failed to load cloud profile', error)
    return null
  }
}

/** Persist name/color only — PIN stays local. Preserves wins/motm via merge. */
export async function pushCloudProfile(
  profile: UserProfile,
  options?: { throwOnError?: boolean },
) {
  if (!isFirebaseConfigured || !db) {
    if (options?.throwOnError) {
      throw new Error('Firebase is not configured.')
    }
    return
  }
  try {
    await ensureAnonymousAuth()
    await setDoc(
      doc(db, 'profiles', profileDocId(profile.accountId)),
      {
        accountId: profile.accountId,
        name: profile.name.trim().slice(0, 18),
        color: profile.color || '',
        photoUrl: profile.photoUrl || '',
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    )
  } catch (error) {
    console.warn('Failed to save cloud profile', error)
    if (options?.throwOnError) throw error
  }
}

/** Batch-load win counts for logged-in account ids. */
export async function fetchAccountWins(
  accountIds: string[],
): Promise<Record<string, number>> {
  const board = await fetchCareerBoard(accountIds)
  const result: Record<string, number> = {}
  for (const entry of board) {
    result[entry.accountId] = entry.wins
  }
  return result
}

/**
 * Career standings for login accounts (all of them by default).
 * Uses Firestore name/color/wins/motm when present; falls back to defaults.
 * Admin is excluded unless explicitly requested in `accountIds`.
 */
export async function fetchCareerBoard(
  accountIds?: string[],
): Promise<CareerBoardEntry[]> {
  const defaults = Object.values(CAREER_LOGIN_ACCOUNTS)
  const wanted = accountIds?.length
    ? [...new Set(accountIds.filter(isCareerAccountId))]
    : defaults.map((account) => account.accountId)

  const byId = new Map(
    defaults.map((account) => [
      account.accountId,
      {
        accountId: account.accountId,
        name: account.defaultName,
        color: '',
        ...emptyCareerStats(account.accountId),
        elimPairs: {},
      } satisfies CareerBoardEntry,
    ]),
  )

  const ids = wanted.filter((id) => byId.has(id) || isCareerAccountId(id))
  for (const id of ids) {
    if (!byId.has(id)) {
      byId.set(id, {
        accountId: id,
        name: id.replace(/^acct:/, ''),
        color: '',
        ...emptyCareerStats(id),
        elimPairs: {},
      })
    }
  }

  if (!isFirebaseConfigured || !db || ids.length === 0) {
    return ids
      .map((id) => byId.get(id)!)
      .sort(
        (a, b) => b.wins - a.wins || a.name.localeCompare(b.name),
      )
  }

  try {
    await ensureAnonymousAuth()
    const docIds = ids.map(profileDocId)
    const snaps = await getDocs(
      query(collection(db, 'profiles'), where(documentId(), 'in', docIds)),
    )
    const found = new Set<string>()
    snaps.forEach((snap) => {
      const data = snap.data() as Partial<CloudProfile>
      const accountId =
        typeof data.accountId === 'string' && isLoginAccountId(data.accountId)
          ? data.accountId
          : ids.find((id) => profileDocId(id) === snap.id)
      if (!accountId) return
      found.add(accountId)
      const prev = byId.get(accountId)
      byId.set(accountId, {
        accountId,
        name:
          typeof data.name === 'string' && data.name.trim()
            ? data.name.trim().slice(0, 18)
            : (prev?.name ?? accountId.replace(/^acct:/, '')),
        color:
          typeof data.color === 'string' && data.color
            ? data.color
            : (prev?.color ?? ''),
        ...readCareerStats(data, accountId),
        elimPairs: readElimPairs(data),
      })
    })
    await Promise.all(
      ids
        .filter((id) => !found.has(id))
        .map((accountId) => {
          const entry = byId.get(accountId)!
          return setDoc(
            doc(db, 'profiles', profileDocId(accountId)),
            {
              accountId,
              name: entry.name,
              wins: entry.wins,
              motm: entry.motm,
              worst: entry.worst,
              second: entry.second,
              third: entry.third,
              eliminations: entry.eliminations,
              timesEliminated: entry.timesEliminated,
              sixes: entry.sixes,
              matchesPlayed: entry.matchesPlayed,
              motmPoints: entry.motmPoints,
              updatedAt: serverTimestamp(),
            },
            { merge: true },
          ).catch(() => {})
        }),
    )
    // Backfill missing career fields on existing docs.
    await Promise.all(
      ids
        .filter((id) => found.has(id))
        .map(async (accountId) => {
          const ref = doc(db, 'profiles', profileDocId(accountId))
          const snap = await getDoc(ref)
          if (!snap.exists()) return
          const data = snap.data() as Partial<CloudProfile>
          const stats = readCareerStats(data, accountId)
          const patch: Record<string, unknown> = { accountId }
          for (const key of CAREER_STAT_KEYS) {
            if (typeof data[key] !== 'number') patch[key] = stats[key]
          }
          if (Object.keys(patch).length <= 1) return
          await setDoc(ref, patch, { merge: true }).catch(() => {})
        }),
    )
  } catch (error) {
    console.warn('Failed to load career board', error)
  }

  return ids
    .map((id) => byId.get(id)!)
    .sort((a, b) => b.wins - a.wins || a.name.localeCompare(b.name))
}

/** MotM standings sorted by MotM count (then name). */
export function sortMotmBoard(board: CareerBoardEntry[]): CareerBoardEntry[] {
  return sortCareerBoard(board, 'motm')
}

/** Sort career board by any numeric career field. */
export function sortCareerBoard(
  board: CareerBoardEntry[],
  key: CareerStatKey,
): CareerBoardEntry[] {
  return [...board].sort(
    (a, b) =>
      (b[key] ?? 0) - (a[key] ?? 0) || a.name.localeCompare(b.name),
  )
}

/** Lower-is-better career boards (e.g. fastest finish). Zero = no record → bottom. */
export function sortCareerBoardAscending(
  board: CareerBoardEntry[],
  key: CareerStatKey,
): CareerBoardEntry[] {
  return [...board].sort((a, b) => {
    const av = a[key] ?? 0
    const bv = b[key] ?? 0
    if (av <= 0 && bv <= 0) return a.name.localeCompare(b.name)
    if (av <= 0) return 1
    if (bv <= 0) return -1
    return av - bv || a.name.localeCompare(b.name)
  })
}

export function formatCareerFinishTime(ms: number) {
  if (!ms || ms <= 0) return '—'
  const totalSec = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSec / 60)
  const seconds = totalSec % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

/** Each career win is worth this many Ultimate points (on top of MotM points). */
export const ULTIMATE_WIN_POINTS = 50

/** Combined career score for Ultimate ranking. */
export function ultimateScore(entry: CareerBoardEntry) {
  return (entry.motmPoints ?? 0) + (entry.wins ?? 0) * ULTIMATE_WIN_POINTS
}

/** Ultimate: highest MotM points + wins combined. */
export function sortUltimateBoard(board: CareerBoardEntry[]): CareerBoardEntry[] {
  return [...board].sort(
    (a, b) =>
      ultimateScore(b) - ultimateScore(a) ||
      (b.motmPoints ?? 0) - (a.motmPoints ?? 0) ||
      (b.wins ?? 0) - (a.wins ?? 0) ||
      a.name.localeCompare(b.name),
  )
}

export type MatchCareerExtras = {
  worstId?: string | null
  secondId?: string | null
  thirdId?: string | null
  /** Per-login match deltas (stats + MotM points + +1 match). */
  deltas: Array<{
    accountId: string
    eliminations: number
    timesEliminated: number
    sixes: number
    motmPoints: number
    negativePowers: number
    superPowers: number
    plus3: number
    finishTimeMs: number
    /** victimAccountId → eliminations this match. */
    elimPairs?: Record<string, number>
  }>
}

/**
 * Record worst / place / elimination / MotM-points career extras once per room.
 * Safe if multiple clients call it for the same room.
 */
export async function recordMatchCareerExtras(
  roomId: string,
  extras: MatchCareerExtras,
) {
  if (!isFirebaseConfigured || !db || !roomId) return false

  const worstId =
    extras.worstId && isCareerAccountId(extras.worstId) ? extras.worstId : null
  const secondId =
    extras.secondId && isCareerAccountId(extras.secondId) ? extras.secondId : null
  const thirdId =
    extras.thirdId && isCareerAccountId(extras.thirdId) ? extras.thirdId : null
  const deltas = extras.deltas
    .filter((entry) => isCareerAccountId(entry.accountId))
    .map((entry) => ({
      accountId: entry.accountId,
      eliminations: Math.max(0, Math.floor(entry.eliminations)),
      timesEliminated: Math.max(0, Math.floor(entry.timesEliminated)),
      sixes: Math.max(0, Math.floor(entry.sixes)),
      motmPoints: roundCareerPoints(entry.motmPoints),
      negativePowers: Math.max(0, Math.floor(entry.negativePowers)),
      superPowers: Math.max(0, Math.floor(entry.superPowers)),
      plus3: Math.max(0, Math.floor(entry.plus3)),
      finishTimeMs: Math.max(0, Math.floor(entry.finishTimeMs)),
      elimPairs: sanitizeElimPairDelta(entry.elimPairs),
    }))

  if (!worstId && !secondId && !thirdId && deltas.length === 0) return false

  try {
    await ensureAnonymousAuth()
    const eventRef = doc(db, 'careerExtraEvents', roomId)

    await runTransaction(db, async (tx) => {
      const eventSnap = await tx.get(eventRef)
      if (eventSnap.exists()) return

      const touched = new Set<string>()
      if (worstId) touched.add(worstId)
      if (secondId) touched.add(secondId)
      if (thirdId) touched.add(thirdId)
      for (const entry of deltas) touched.add(entry.accountId)

      const profiles = await Promise.all(
        [...touched].map(async (accountId) => {
          const profileRef = doc(db, 'profiles', profileDocId(accountId))
          const profileSnap = await tx.get(profileRef)
          const data = profileSnap.exists()
            ? (profileSnap.data() as Partial<CloudProfile>)
            : undefined
          return {
            accountId,
            profileRef,
            stats: readCareerStats(data, accountId),
            elimPairs: readElimPairs(data),
          }
        }),
      )

      tx.set(eventRef, {
        roomId,
        worstId,
        secondId,
        thirdId,
        deltas,
        recordedAt: serverTimestamp(),
      })

      for (const entry of profiles) {
        const next = { ...entry.stats }
        let nextElimPairs = { ...entry.elimPairs }
        if (entry.accountId === worstId) next.worst += 1
        if (entry.accountId === secondId) next.second += 1
        if (entry.accountId === thirdId) next.third += 1
        const delta = deltas.find((item) => item.accountId === entry.accountId)
        if (delta) {
          next.eliminations += delta.eliminations
          next.timesEliminated += delta.timesEliminated
          next.sixes += delta.sixes
          next.matchesPlayed += 1
          next.motmPoints = roundCareerPoints(
            next.motmPoints + delta.motmPoints,
          )
          next.negativePowers += delta.negativePowers
          next.superPowers += delta.superPowers
          next.plus3 += delta.plus3
          if (
            delta.finishTimeMs > 0 &&
            (next.bestFinishMs <= 0 || delta.finishTimeMs < next.bestFinishMs)
          ) {
            next.bestFinishMs = delta.finishTimeMs
          }
          nextElimPairs = mergeElimPairs(nextElimPairs, delta.elimPairs)
        }
        tx.set(
          entry.profileRef,
          {
            accountId: entry.accountId,
            worst: next.worst,
            second: next.second,
            third: next.third,
            eliminations: next.eliminations,
            timesEliminated: next.timesEliminated,
            sixes: next.sixes,
            matchesPlayed: next.matchesPlayed,
            motmPoints: next.motmPoints,
            negativePowers: next.negativePowers,
            superPowers: next.superPowers,
            plus3: next.plus3,
            bestFinishMs: next.bestFinishMs,
            elimPairs: nextElimPairs,
            updatedAt: serverTimestamp(),
          },
          { merge: true },
        )
      }
    })
    return true
  } catch (error) {
    console.warn('Failed to record career extras', error)
    return false
  }
}

/**
 * Atomically record wins for one or more login accounts in a finished room.
 * Safe if multiple clients call it for the same room.
 */
export async function recordMatchWins(
  roomId: string,
  winnerAccountIds: string[],
) {
  if (!isFirebaseConfigured || !db) return false
  if (!roomId) return false
  const unique = [
    ...new Set(winnerAccountIds.filter((id) => isCareerAccountId(id))),
  ]
  if (unique.length === 0) return false

  try {
    await ensureAnonymousAuth()
    const eventRef = doc(db, 'winEvents', roomId)

    await runTransaction(db, async (tx) => {
      const eventSnap = await tx.get(eventRef)
      if (eventSnap.exists()) return

      const profiles = await Promise.all(
        unique.map(async (accountId) => {
          const profileRef = doc(db, 'profiles', profileDocId(accountId))
          const profileSnap = await tx.get(profileRef)
          const current = readWins(
            profileSnap.exists()
              ? (profileSnap.data() as Partial<CloudProfile>)
              : undefined,
            accountId,
          )
          return { accountId, profileRef, current }
        }),
      )

      tx.set(eventRef, {
        roomId,
        winnerId: unique[0],
        winnerIds: unique,
        recordedAt: serverTimestamp(),
      })
      for (const entry of profiles) {
        tx.set(
          entry.profileRef,
          {
            accountId: entry.accountId,
            wins: entry.current + 1,
            updatedAt: serverTimestamp(),
          },
          { merge: true },
        )
      }
    })
    return true
  } catch (error) {
    console.warn('Failed to record match wins', error)
    return false
  }
}

/** @deprecated Prefer recordMatchWins for team support. */
export async function recordMatchWin(roomId: string, winnerAccountId: string) {
  return recordMatchWins(roomId, [winnerAccountId])
}

/**
 * Atomically record one MotM for a finished room (logged-in MotM only).
 * Safe if multiple clients call it for the same room.
 */
export async function recordMatchMotm(roomId: string, motmAccountId: string) {
  if (!isFirebaseConfigured || !db) return false
  if (!isCareerAccountId(motmAccountId) || !roomId) return false

  try {
    await ensureAnonymousAuth()
    const eventRef = doc(db, 'motmEvents', roomId)
    const profileRef = doc(db, 'profiles', profileDocId(motmAccountId))

    await runTransaction(db, async (tx) => {
      const eventSnap = await tx.get(eventRef)
      if (eventSnap.exists()) return

      const profileSnap = await tx.get(profileRef)
      const current = readMotm(
        profileSnap.exists()
          ? (profileSnap.data() as Partial<CloudProfile>)
          : undefined,
        motmAccountId,
      )

      tx.set(eventRef, {
        roomId,
        motmId: motmAccountId,
        recordedAt: serverTimestamp(),
      })
      tx.set(
        profileRef,
        {
          accountId: motmAccountId,
          motm: current + 1,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      )
    })
    return true
  } catch (error) {
    console.warn('Failed to record match MotM', error)
    return false
  }
}

export const CAREER_STAT_EDIT_LABELS: Record<CareerStatKey, string> = {
  wins: 'Wins',
  motm: 'MotM awards',
  worst: 'Worst awards',
  second: '2nd places',
  third: '3rd places',
  eliminations: 'Eliminations',
  timesEliminated: 'Times eliminated',
  sixes: 'Sixes',
  matchesPlayed: 'Matches played',
  motmPoints: 'MotM points',
  negativePowers: 'Oonjaal',
  superPowers: 'Super ⚡',
  plus3: '+3 landings',
  bestFinishMs: 'Best finish (ms)',
}

/**
 * Admin-only: set absolute career “most” values for a login player.
 * Client-gated by admin PIN login; Firestore still requires auth.
 */
export async function adminSetCareerStats(
  adminAccountId: string,
  targetAccountId: string,
  stats: Partial<Pick<CareerBoardEntry, CareerStatKey>>,
): Promise<void> {
  if (!isAdminAccountId(adminAccountId)) {
    throw new Error('Only the admin account can edit career stats.')
  }
  await writeCareerStatPatch(targetAccountId, stats)
}

async function writeCareerStatPatch(
  targetAccountId: string,
  stats: Partial<Pick<CareerBoardEntry, CareerStatKey>>,
): Promise<void> {
  if (!isCareerAccountId(targetAccountId) || targetAccountId === ADMIN_ACCOUNT_ID) {
    throw new Error('Invalid player account.')
  }
  if (!isFirebaseConfigured || !db) {
    throw new Error('Firebase is not configured.')
  }

  const patch: Record<string, unknown> = {
    accountId: targetAccountId,
    updatedAt: serverTimestamp(),
  }
  for (const key of CAREER_STAT_KEYS) {
    if (!(key in stats) || stats[key] === undefined) continue
    const raw = Number(stats[key])
    if (!Number.isFinite(raw)) continue
    if (key === 'motmPoints') {
      patch[key] = roundCareerPoints(raw)
    } else if (key === 'bestFinishMs') {
      patch[key] = Math.max(0, Math.floor(raw))
    } else {
      patch[key] = Math.max(0, Math.floor(raw))
    }
  }

  if (Object.keys(patch).length <= 2) return

  await ensureAnonymousAuth()
  await setDoc(doc(db, 'profiles', profileDocId(targetAccountId)), patch, {
    merge: true,
  })
}

type HistoryPersonLike = {
  accountId: string
  value?: number
}

/**
 * Write each history most-leader’s stored value onto their career profile
 * (one category at a time). Used by ludo_admin match-history restore.
 */
export async function applyHistoryMostLeaders(
  mostLeaders: Partial<Record<CareerStatKey, HistoryPersonLike | null | undefined>>,
): Promise<number> {
  const byAccount = new Map<
    string,
    Partial<Pick<CareerBoardEntry, CareerStatKey>>
  >()

  for (const key of CAREER_STAT_KEYS) {
    const leader = mostLeaders[key]
    if (!leader?.accountId || !isCareerAccountId(leader.accountId)) continue
    if (typeof leader.value !== 'number' || !Number.isFinite(leader.value)) continue
    if (leader.value < 0) continue
    if (key !== 'bestFinishMs' && leader.value <= 0) continue

    const patch = byAccount.get(leader.accountId) ?? {}
    patch[key] = leader.value
    byAccount.set(leader.accountId, patch)
  }

  let written = 0
  for (const [accountId, stats] of byAccount) {
    await writeCareerStatPatch(accountId, stats)
    written += 1
  }
  return written
}
