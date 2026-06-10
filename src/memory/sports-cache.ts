import { getDb } from './database.js'
import type { SportsScoreboard, SportsNewsArticle, SportsStandings, SportsGameSummary } from '../tools/sports.js'

const TTL_FINALS_ONLY = 86400   // 24 hours — all games are final, data won't change
const TTL_HAS_LIVE    = 300     // 5 minutes — live game in progress
const TTL_HAS_TODAY   = 300     // 5 minutes — scheduled game today (could go live soon)
const TTL_NEWS        = 86400   // 24 hours — news articles
const TTL_STANDINGS   = 14400   // 4 hours — standings change infrequently
const TTL_SUMMARY     = 86400   // 24 hours — completed game summaries don't change

/**
 * Determine TTL based on scoreboard content:
 * - Any in_progress game → 5 min
 * - Any game scheduled for today → 5 min
 * - All games final → 24 hours
 */
function resolveTtl(scoreboard: SportsScoreboard): number {
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const todayEnd = new Date()
  todayEnd.setHours(23, 59, 59, 999)

  for (const game of scoreboard.games) {
    if (game.status === 'in_progress') return TTL_HAS_LIVE

    if (game.status === 'scheduled') {
      const gameDate = new Date(game.date)
      if (gameDate >= todayStart && gameDate <= todayEnd) return TTL_HAS_TODAY
    }
  }

  return TTL_FINALS_ONLY
}

// ---------------------------------------------------------------------------
// Generic cache helpers
// ---------------------------------------------------------------------------

function getCache<T>(key: string): T | null {
  const db = getDb()
  const now = Math.floor(Date.now() / 1000)
  const row = db.prepare(
    'SELECT result, created_at, ttl_seconds FROM espn_cache WHERE cache_key = ?',
  ).get(key) as { result: string; created_at: number; ttl_seconds: number } | undefined

  if (!row) return null
  if (now - row.created_at > row.ttl_seconds) {
    db.prepare('DELETE FROM espn_cache WHERE cache_key = ?').run(key)
    return null
  }
  try {
    return JSON.parse(row.result) as T
  } catch {
    return null
  }
}

function setCache(key: string, value: unknown, ttl: number): void {
  const db = getDb()
  const now = Math.floor(Date.now() / 1000)
  db.prepare(
    'INSERT OR REPLACE INTO espn_cache (cache_key, result, created_at, ttl_seconds) VALUES (?, ?, ?, ?)',
  ).run(key, JSON.stringify(value), now, ttl)
}

// ---------------------------------------------------------------------------
// Cache key builders
// ---------------------------------------------------------------------------

/**
 * Build a deterministic cache key from league slug + date range.
 */
export function buildCacheKey(leagueSlug: string, fromDate: Date, toDate: Date): string {
  const fmt = (d: Date) =>
    `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
  return `sports:scoreboard:${leagueSlug}:${fmt(fromDate)}-${fmt(toDate)}`
}

export function buildNewsCacheKey(leagueSlug: string, teamId?: string): string {
  return teamId
    ? `sports:news:${leagueSlug}:team:${teamId}`
    : `sports:news:${leagueSlug}`
}

export function buildStandingsCacheKey(leagueSlug: string): string {
  return `sports:standings:${leagueSlug}`
}

export function buildSummaryCacheKey(leagueSlug: string, gameId: string): string {
  return `sports:summary:${leagueSlug}:${gameId}`
}

// ---------------------------------------------------------------------------
// Scoreboard cache
// ---------------------------------------------------------------------------

export function getCachedScoreboard(key: string): SportsScoreboard | null {
  const parsed = getCache<SportsScoreboard>(key)
  if (!parsed) return null
  // Rehydrate Date objects inside effectiveRange (JSON serializes them as strings)
  parsed.effectiveRange = {
    from: new Date(parsed.effectiveRange.from),
    to: new Date(parsed.effectiveRange.to),
  }
  return parsed
}

export function setCachedScoreboard(key: string, scoreboard: SportsScoreboard): void {
  setCache(key, scoreboard, resolveTtl(scoreboard))
}

// ---------------------------------------------------------------------------
// News cache
// ---------------------------------------------------------------------------

export function getCachedNews(key: string): SportsNewsArticle[] | null {
  return getCache<SportsNewsArticle[]>(key)
}

export function setCachedNews(key: string, articles: SportsNewsArticle[]): void {
  setCache(key, articles, TTL_NEWS)
}

// ---------------------------------------------------------------------------
// Standings cache
// ---------------------------------------------------------------------------

export function getCachedStandings(key: string): SportsStandings | null {
  return getCache<SportsStandings>(key)
}

export function setCachedStandings(key: string, standings: SportsStandings): void {
  setCache(key, standings, TTL_STANDINGS)
}

// ---------------------------------------------------------------------------
// Game summary cache
// ---------------------------------------------------------------------------

export function getCachedSummary(key: string): SportsGameSummary | null {
  return getCache<SportsGameSummary>(key)
}

export function setCachedSummary(key: string, summary: SportsGameSummary): void {
  setCache(key, summary, TTL_SUMMARY)
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

export function cleanExpiredEspnCache(): void {
  const db = getDb()
  const now = Math.floor(Date.now() / 1000)
  db.prepare('DELETE FROM espn_cache WHERE (? - created_at) > ttl_seconds').run(now)
}

