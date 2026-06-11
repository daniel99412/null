import { getDb } from '../../memory/database.js'

export function getSportsCache<T>(cacheKey: string): T | null {
  const db = getDb()
  const row = db.prepare(`
    SELECT result, created_at, ttl_seconds
    FROM sports_cache
    WHERE cache_key = ?
  `).get(cacheKey) as { result: string; created_at: number; ttl_seconds: number } | undefined

  if (!row) return null

  const expiresAt = row.created_at + row.ttl_seconds * 1000
  if (Date.now() > expiresAt) {
    db.prepare('DELETE FROM sports_cache WHERE cache_key = ?').run(cacheKey)
    return null
  }

  try {
    return JSON.parse(row.result) as T
  } catch {
    db.prepare('DELETE FROM sports_cache WHERE cache_key = ?').run(cacheKey)
    return null
  }
}

export function setSportsCache(cacheKey: string, result: unknown, ttlSeconds: number): void {
  const db = getDb()
  db.prepare(`
    INSERT INTO sports_cache (cache_key, result, created_at, ttl_seconds)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(cache_key) DO UPDATE SET
      result = excluded.result,
      created_at = excluded.created_at,
      ttl_seconds = excluded.ttl_seconds
  `).run(cacheKey, JSON.stringify(result), Date.now(), ttlSeconds)
}

export function ttlForSportsData(kind: 'live' | 'final' | 'fixtures' | 'standings' | 'news'): number {
  switch (kind) {
    case 'live':
      return 60
    case 'final':
      return 24 * 60 * 60
    case 'fixtures':
      return 60 * 60
    case 'standings':
      return 4 * 60 * 60
    case 'news':
      return 30 * 60
  }
}
