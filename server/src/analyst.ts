import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Request, Response } from 'express'
import { ADMIN_PIN } from '../../src/lib/profile.js'
import {
  acceptNarrative,
  sanitizeMatches,
  sanitizePlayers,
  scoreAwards,
  statsVersion,
  type AnalystAward,
  type AnalystNarrative,
} from '../../src/lib/playerAnalyst.js'

const CACHE_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'analyst-cache.json')
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'
const DEFAULT_MODEL = 'llama-3.3-70b-versatile'
const AI_FAIL_COOLDOWN_MS = 2 * 60 * 1000
const GENERATE_LIMIT = 8

type CachedAnalysis = {
  statsVersion: string
  awards: AnalystAward[]
  narrative: AnalystNarrative | null
  generatedAt: string
  aiStatus: 'ready' | 'unavailable'
}

type GroqCaller = (prompt: string) => Promise<string>

const hits = new Map<string, { count: number; resetAt: number }>()
const inflight = new Map<string, Promise<CachedAnalysis>>()
let memory: CachedAnalysis | null = loadCache()
let failUntil = 0

function loadCache(): CachedAnalysis | null {
  try {
    const parsed = JSON.parse(readFileSync(CACHE_PATH, 'utf8')) as CachedAnalysis
    if (!parsed?.statsVersion || !Array.isArray(parsed.awards)) return null
    return parsed
  } catch {
    return null
  }
}

function saveCache(entry: CachedAnalysis) {
  memory = entry
  if (process.env.ANALYST_CACHE_DISABLE === '1') return
  try {
    mkdirSync(dirname(CACHE_PATH), { recursive: true })
    writeFileSync(CACHE_PATH, JSON.stringify(entry))
  } catch (error) {
    console.warn('Analyst cache was not written', error)
  }
}

function clientKey(request: Request) {
  const forwarded = request.header('x-forwarded-for')?.split(',')[0]?.trim()
  return forwarded || request.ip || 'local'
}

function allowGenerate(key: string) {
  const now = Date.now()
  const current = hits.get(key)
  if (!current || current.resetAt <= now) {
    hits.set(key, { count: 1, resetAt: now + 60 * 60 * 1000 })
    return true
  }
  if (current.count >= GENERATE_LIMIT) return false
  current.count += 1
  return true
}

async function defaultGroq(prompt: string) {
  const key = process.env.GROQ_API_KEY
  if (!key) throw new Error('GROQ_API_KEY is not set')
  const model = process.env.GROQ_MODEL || DEFAULT_MODEL
  const response = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0.4,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'You are an expert Ludo statistics analyst. Explain the supplied verified awards using only those numbers. Be fair and specific. Never invent players, matches, or statistics. Never change the winner. Return JSON with keys reasons (object of category to sentence, each sentence must include the winner name), rivalries (array of short strings), observations (array of short strings), overallVerdict (string).',
        },
        { role: 'user', content: prompt },
      ],
    }),
    signal: AbortSignal.timeout(20_000),
  })
  if (response.status === 429) {
    const error = new Error('Groq rate limit')
    ;(error as Error & { status?: number }).status = 429
    throw error
  }
  if (!response.ok) throw new Error(`Groq HTTP ${response.status}`)
  const body = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  const content = body.choices?.[0]?.message?.content
  if (!content) throw new Error('Empty Groq response')
  return content
}

function promptFor(awards: AnalystAward[]) {
  return JSON.stringify({
    awards: awards.map((award) => ({
      category: award.category,
      title: award.title,
      status: award.status,
      playerName: award.playerName,
      score: award.score,
      runnerUpName: award.runnerUpName,
      runnerUpScore: award.runnerUpScore,
      tied: award.tied,
      keyStats: award.keyStats,
      evidence: award.evidence,
    })),
  })
}

export async function resolveAnalyst(
  body: unknown,
  options: { force?: boolean; groq?: GroqCaller },
): Promise<CachedAnalysis> {
  const record = body && typeof body === 'object' ? (body as { players?: unknown; matches?: unknown }) : {}
  const players = sanitizePlayers(record.players)
  const matches = sanitizeMatches(record.matches)
  const version = statsVersion(players, matches)
  const awards = scoreAwards(players, matches)
  const groq = options.groq ?? defaultGroq

  if (!options.force && memory?.statsVersion === version) return memory

  const pending = inflight.get(version)
  if (pending && !options.force) return pending

  const job = (async () => {
    if (!options.force && Date.now() < failUntil && memory?.statsVersion !== version) {
      return {
        statsVersion: version,
        awards,
        narrative: null,
        generatedAt: new Date().toISOString(),
        aiStatus: 'unavailable' as const,
      }
    }
    try {
      const text = await groq(promptFor(awards))
      const narrative = acceptNarrative(awards, JSON.parse(text) as unknown)
      const entry: CachedAnalysis = {
        statsVersion: version,
        awards,
        narrative,
        generatedAt: new Date().toISOString(),
        aiStatus: narrative ? 'ready' : 'unavailable',
      }
      if (narrative) saveCache(entry)
      else failUntil = Date.now() + AI_FAIL_COOLDOWN_MS
      return entry
    } catch (error) {
      const status = (error as { status?: number }).status
      if (status === 429) failUntil = Date.now() + AI_FAIL_COOLDOWN_MS
      else failUntil = Date.now() + AI_FAIL_COOLDOWN_MS
      console.warn('Analyst AI skipped', error instanceof Error ? error.message : error)
      return {
        statsVersion: version,
        awards,
        narrative: null,
        generatedAt: new Date().toISOString(),
        aiStatus: 'unavailable' as const,
      }
    }
  })()

  inflight.set(version, job)
  try {
    return await job
  } finally {
    inflight.delete(version)
  }
}

export function analystCacheVersion() {
  return memory?.statsVersion ?? null
}

export function resetAnalystCacheForTests() {
  memory = null
  failUntil = 0
  inflight.clear()
  hits.clear()
}

export function handleAnalyst(request: Request, response: Response) {
  const version = typeof request.query.version === 'string' ? request.query.version : ''
  if (request.method === 'GET') {
    if (memory && version && memory.statsVersion === version) {
      response.json({ ok: true, analysis: memory })
      return
    }
    response.status(204).end()
    return
  }

  const force = Boolean((request.body as { force?: unknown } | undefined)?.force)
  if (force) {
    const pin = request.header('x-admin-pin') ?? ''
    if (pin !== ADMIN_PIN) {
      response.status(403).json({ ok: false, error: 'Only an admin can refresh the analyst.' })
      return
    }
  } else {
    const players = sanitizePlayers((request.body as { players?: unknown } | undefined)?.players)
    const matches = sanitizeMatches((request.body as { matches?: unknown } | undefined)?.matches)
    const nextVersion = statsVersion(players, matches)
    if (memory?.statsVersion === nextVersion) {
      response.json({ ok: true, analysis: memory })
      return
    }
    if (!allowGenerate(clientKey(request))) {
      response.status(429).json({ ok: false, error: 'Analyst refresh limit reached. Try again later.' })
      return
    }
  }

  void resolveAnalyst(request.body, { force })
    .then((analysis) => {
      response.json({ ok: true, analysis })
    })
    .catch((error) => {
      console.warn('Analyst request failed', error)
      response.status(500).json({ ok: false, error: 'Analyst failed.' })
    })
}
