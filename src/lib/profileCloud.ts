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
  INITIAL_ACCOUNT_MOTM,
  INITIAL_ACCOUNT_WINS,
  LOGIN_ACCOUNTS,
  isLoginAccountId,
} from './profile'
import type { Room } from '../game/types'

export type CareerBoardEntry = {
  accountId: string
  name: string
  color: string
  wins: number
  motm: number
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
  wins: number
  motm: number
}

function readWins(data: Partial<CloudProfile> | undefined, accountId: string) {
  if (typeof data?.wins === 'number' && Number.isFinite(data.wins) && data.wins >= 0) {
    return Math.floor(data.wins)
  }
  return INITIAL_ACCOUNT_WINS[accountId] ?? 0
}

function readMotm(data: Partial<CloudProfile> | undefined, accountId: string) {
  if (typeof data?.motm === 'number' && Number.isFinite(data.motm) && data.motm >= 0) {
    return Math.floor(data.motm)
  }
  return INITIAL_ACCOUNT_MOTM[accountId] ?? 0
}

/** How many distinct logged-in humans played in this room (incl. departed). */
export function countLoginPlayersInMatch(room: Room): number {
  const ids = new Set<string>()
  for (const player of [...room.players, ...(room.departedPlayers ?? [])]) {
    if (player.isBot) continue
    if (!isLoginAccountId(player.id)) continue
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
      const wins = INITIAL_ACCOUNT_WINS[accountId] ?? 0
      const motm = INITIAL_ACCOUNT_MOTM[accountId] ?? 0
      await setDoc(
        ref,
        {
          accountId,
          name: '',
          color: '',
          wins,
          motm,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      )
      return { accountId, name: '', color: '', wins, motm }
    }
    const data = snap.data() as Partial<CloudProfile>
    const wins = readWins(data, accountId)
    const motm = readMotm(data, accountId)
    const patch: Record<string, unknown> = { accountId }
    if (typeof data.wins !== 'number') patch.wins = wins
    if (typeof data.motm !== 'number') patch.motm = motm
    if (Object.keys(patch).length > 1) {
      await setDoc(ref, patch, { merge: true })
    }
    return {
      accountId,
      name: typeof data.name === 'string' ? data.name.trim().slice(0, 18) : '',
      color: typeof data.color === 'string' ? data.color : '',
      wins,
      motm,
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
 */
export async function fetchCareerBoard(
  accountIds?: string[],
): Promise<CareerBoardEntry[]> {
  const defaults = Object.values(LOGIN_ACCOUNTS)
  const wanted = accountIds?.length
    ? [...new Set(accountIds.filter(isLoginAccountId))]
    : defaults.map((account) => account.accountId)

  const byId = new Map(
    defaults.map((account) => [
      account.accountId,
      {
        accountId: account.accountId,
        name: account.defaultName,
        color: '',
        wins: INITIAL_ACCOUNT_WINS[account.accountId] ?? 0,
        motm: INITIAL_ACCOUNT_MOTM[account.accountId] ?? 0,
      } satisfies CareerBoardEntry,
    ]),
  )

  const ids = wanted.filter((id) => byId.has(id) || isLoginAccountId(id))
  for (const id of ids) {
    if (!byId.has(id)) {
      byId.set(id, {
        accountId: id,
        name: id.replace(/^acct:/, ''),
        color: '',
        wins: INITIAL_ACCOUNT_WINS[id] ?? 0,
        motm: INITIAL_ACCOUNT_MOTM[id] ?? 0,
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
        wins: readWins(data, accountId),
        motm: readMotm(data, accountId),
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
              updatedAt: serverTimestamp(),
            },
            { merge: true },
          ).catch(() => {})
        }),
    )
    // Backfill motm on docs that exist but lack the field.
    await Promise.all(
      ids
        .filter((id) => found.has(id))
        .map(async (accountId) => {
          const ref = doc(db, 'profiles', profileDocId(accountId))
          const snap = await getDoc(ref)
          if (!snap.exists()) return
          const data = snap.data() as Partial<CloudProfile>
          if (typeof data.motm === 'number') return
          await setDoc(
            ref,
            { motm: readMotm(data, accountId), accountId },
            { merge: true },
          ).catch(() => {})
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
  return [...board].sort(
    (a, b) => b.motm - a.motm || a.name.localeCompare(b.name),
  )
}

/**
 * Atomically record one win for a finished room (logged-in champion only).
 * Safe if multiple clients call it for the same room.
 */
export async function recordMatchWin(roomId: string, winnerAccountId: string) {
  if (!isFirebaseConfigured || !db) return false
  if (!isLoginAccountId(winnerAccountId) || !roomId) return false

  try {
    await ensureAnonymousAuth()
    const eventRef = doc(db, 'winEvents', roomId)
    const profileRef = doc(db, 'profiles', profileDocId(winnerAccountId))

    await runTransaction(db, async (tx) => {
      const eventSnap = await tx.get(eventRef)
      if (eventSnap.exists()) return

      const profileSnap = await tx.get(profileRef)
      const current = readWins(
        profileSnap.exists()
          ? (profileSnap.data() as Partial<CloudProfile>)
          : undefined,
        winnerAccountId,
      )

      tx.set(eventRef, {
        roomId,
        winnerId: winnerAccountId,
        recordedAt: serverTimestamp(),
      })
      tx.set(
        profileRef,
        {
          accountId: winnerAccountId,
          wins: current + 1,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      )
    })
    return true
  } catch (error) {
    console.warn('Failed to record match win', error)
    return false
  }
}

/**
 * Atomically record one MotM for a finished room (logged-in MotM only).
 * Safe if multiple clients call it for the same room.
 */
export async function recordMatchMotm(roomId: string, motmAccountId: string) {
  if (!isFirebaseConfigured || !db) return false
  if (!isLoginAccountId(motmAccountId) || !roomId) return false

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
