import { getDb } from './database.js'
import { normalizeQuery } from '../utils/normalize.js'
import type { SearchContext } from '../tools/web-search.js'

export function getCachedSearch(query: string): SearchContext | null {
  const db = getDb()
  const key = normalizeQuery(query)
  const now = Math.floor(Date.now() / 1000)

  const row = db.prepare(
    'SELECT result, created_at, ttl_seconds FROM search_cache WHERE query_key = ?',
  ).get(key) as { result: string; created_at: number; ttl_seconds: number } | undefined

  if (!row) return null

  // Check if expired
  if (now - row.created_at > row.ttl_seconds) {
    db.prepare('DELETE FROM search_cache WHERE query_key = ?').run(key)
    return null
  }

  try {
    return JSON.parse(row.result) as SearchContext
  } catch {
    return null
  }
}

export function setCachedSearch(query: string, result: SearchContext, ttlSeconds: number = 300): void {
  const db = getDb()
  const key = normalizeQuery(query)
  const now = Math.floor(Date.now() / 1000)

  db.prepare(
    'INSERT OR REPLACE INTO search_cache (query_key, result, created_at, ttl_seconds) VALUES (?, ?, ?, ?)',
  ).run(key, JSON.stringify(result), now, ttlSeconds)
}

export function cleanExpiredCache(): void {
  const db = getDb()
  const now = Math.floor(Date.now() / 1000)

  db.prepare(
    'DELETE FROM search_cache WHERE (? - created_at) > ttl_seconds',
  ).run(now)
}
