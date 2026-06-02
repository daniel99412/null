import { getDb } from './database.js'

// ── Types ─────────────────────────────────────────────────────────────────────

export type MemoryType =
  | 'preference'    // sports teams, leagues, sports — also covers legacy user_preferences
  | 'tech_stack'    // typescript, react, docker, etc.
  | 'occupation'    // backend developer, freelancer, etc.
  | 'project'       // "working on a fintech app" — expires in 90d
  | 'goal'          // "want to learn rust" — expires in 180d
  | 'behavior'      // "prefers short answers"
  | 'dislike'       // "hates CSS frameworks"
  | 'relationship'  // "my team uses Java"
  | 'location'      // "lives in Guadalajara"
  | 'alias_self'    // "my name is Daniel"

export type MemorySource = 'explicit' | 'extracted' | 'inferred'

export interface Memory {
  id: number
  type: MemoryType
  value: string        // canonical, lowercase
  raw_value: string | null
  confidence: number
  source: MemorySource
  expires_at: string | null
  created_at: string
  updated_at: string
}

export interface MemoryWithScore extends Memory {
  score: number
  recurrence: number
  last_seen_at: string
}

export interface UpsertMemoryOptions {
  type: MemoryType
  value: string          // will be normalized before insert
  rawValue?: string
  confidence?: number
  source?: MemorySource
  sessionId?: string
}

// ── Expiry config per type ────────────────────────────────────────────────────

const EXPIRES_DAYS: Partial<Record<MemoryType, number>> = {
  project: 90,
  goal: 180,
}

// Permanent types (no decay applied)
export const PERMANENT_TYPES = new Set<MemoryType>([
  'preference', 'tech_stack', 'occupation', 'behavior', 'dislike', 'location', 'alias_self',
])

// Base score weight by type (higher = more important)
const TYPE_WEIGHT: Record<MemoryType, number> = {
  alias_self: 1.0,
  occupation: 0.9,
  preference: 0.85,
  tech_stack: 0.85,
  behavior: 0.8,
  dislike: 0.75,
  goal: 0.7,
  location: 0.75,
  relationship: 0.65,
  project: 0.6,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function normalizeValue(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip diacritics
    .replace(/\s+/g, ' ')
}

/**
 * Resolve an alias to its canonical value + type using the memory_aliases table.
 * Returns null if no alias found — caller should use the original value.
 */
export function resolveAlias(
  raw: string,
  type: MemoryType,
): { canonical: string; type: MemoryType } | null {
  const db = getDb()
  const normalized = normalizeValue(raw)

  // Try exact match with given type first
  const row = db
    .prepare('SELECT canonical, type FROM memory_aliases WHERE alias = ? AND type = ?')
    .get(normalized, type) as { canonical: string; type: string } | undefined

  if (row) return { canonical: row.canonical, type: row.type as MemoryType }

  // Try any type (e.g. when type is unknown)
  const anyRow = db
    .prepare('SELECT canonical, type FROM memory_aliases WHERE alias = ?')
    .get(normalized) as { canonical: string; type: string } | undefined

  if (anyRow) return { canonical: anyRow.canonical, type: anyRow.type as MemoryType }

  return null
}

/**
 * Calculate expires_at date string for a given type.
 * Returns null for permanent types.
 */
function calcExpiresAt(type: MemoryType): string | null {
  const days = EXPIRES_DAYS[type]
  if (!days) return null
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().replace('T', ' ').slice(0, 19)
}

// ── Core upsert ───────────────────────────────────────────────────────────────

/**
 * Insert a new memory or update score/recurrence if it already exists.
 * Handles alias resolution and normalization internally.
 *
 * Returns the memory id (whether inserted or existing).
 */
export function upsertMemory(opts: UpsertMemoryOptions): number {
  const db = getDb()

  // Resolve alias — might change both value and type
  const resolved = resolveAlias(opts.value, opts.type)
  const finalValue = resolved ? resolved.canonical : normalizeValue(opts.value)
  const finalType = resolved ? resolved.type : opts.type

  const confidence = opts.confidence ?? TYPE_WEIGHT[finalType] ?? 0.7
  const source = opts.source ?? 'extracted'
  const rawValue = opts.rawValue ?? opts.value
  const expiresAt = calcExpiresAt(finalType)

  // Try insert first
  const insert = db.prepare(`
    INSERT OR IGNORE INTO memories (type, value, raw_value, confidence, source, expires_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `)
  insert.run(finalType, finalValue, rawValue, confidence, source, expiresAt)

  // Get the id (whether just inserted or already existed)
  const row = db
    .prepare('SELECT id FROM memories WHERE type = ? AND value = ?')
    .get(finalType, finalValue) as { id: number }

  const memoryId = row.id

  // Upsert score — if new: insert with initial score; if existing: bump recurrence + score
  const existingScore = db
    .prepare('SELECT score, recurrence FROM memory_scores WHERE memory_id = ?')
    .get(memoryId) as { score: number; recurrence: number } | undefined

  if (!existingScore) {
    db.prepare(`
      INSERT INTO memory_scores (memory_id, score, recurrence, last_seen_at)
      VALUES (?, ?, 1, datetime('now'))
    `).run(memoryId, confidence)
  } else {
    // Bump: +0.05 per mention, capped at 1.0
    const newScore = Math.min(1.0, existingScore.score + 0.05)
    db.prepare(`
      UPDATE memory_scores
      SET score = ?, recurrence = recurrence + 1, last_seen_at = datetime('now')
      WHERE memory_id = ?
    `).run(newScore, memoryId)
  }

  // Update updated_at on the memory row
  db.prepare("UPDATE memories SET updated_at = datetime('now') WHERE id = ?").run(memoryId)

  // Log the event
  if (opts.sessionId) {
    db.prepare(`
      INSERT INTO memory_events (memory_id, session_id) VALUES (?, ?)
    `).run(memoryId, opts.sessionId)
  }

  return memoryId
}

/**
 * Convenience: upsert multiple memories in a single transaction.
 */
export function upsertMemories(items: UpsertMemoryOptions[]): void {
  const db = getDb()
  const tx = db.transaction(() => {
    for (const item of items) {
      upsertMemory(item)
    }
  })
  tx()
}

// ── Read ──────────────────────────────────────────────────────────────────────

/**
 * Fetch all memories of given types with their scores, ordered by score desc.
 * If no types provided, returns all.
 */
export function getMemoriesByType(
  types?: MemoryType[],
  minScore = 0.4,
): MemoryWithScore[] {
  const db = getDb()

  if (types && types.length > 0) {
    const placeholders = types.map(() => '?').join(', ')
    return db.prepare(`
      SELECT m.*, ms.score, ms.recurrence, ms.last_seen_at
      FROM memories m
      JOIN memory_scores ms ON m.id = ms.memory_id
      WHERE m.type IN (${placeholders})
        AND ms.score >= ?
        AND (m.expires_at IS NULL OR m.expires_at > datetime('now'))
      ORDER BY ms.score DESC, ms.last_seen_at DESC
      LIMIT 30
    `).all(...types, minScore) as MemoryWithScore[]
  }

  return db.prepare(`
    SELECT m.*, ms.score, ms.recurrence, ms.last_seen_at
    FROM memories m
    JOIN memory_scores ms ON m.id = ms.memory_id
    WHERE ms.score >= ?
      AND (m.expires_at IS NULL OR m.expires_at > datetime('now'))
    ORDER BY ms.score DESC, ms.last_seen_at DESC
    LIMIT 30
  `).all(minScore) as MemoryWithScore[]
}

/**
 * Get memories matching a set of keywords (value LIKE search).
 * Used by retrieval engine for keyword-based context matching.
 */
export function searchMemories(keywords: string[], minScore = 0.4): MemoryWithScore[] {
  if (keywords.length === 0) return []
  const db = getDb()

  const conditions = keywords.map(() => 'm.value LIKE ?').join(' OR ')
  const params = keywords.map((k) => `%${normalizeValue(k)}%`)

  return db.prepare(`
    SELECT m.*, ms.score, ms.recurrence, ms.last_seen_at
    FROM memories m
    JOIN memory_scores ms ON m.id = ms.memory_id
    WHERE (${conditions})
      AND ms.score >= ?
      AND (m.expires_at IS NULL OR m.expires_at > datetime('now'))
    ORDER BY ms.score DESC
    LIMIT 15
  `).all(...params, minScore) as MemoryWithScore[]
}

/**
 * Returns true if any memories exist at all.
 */
export function hasAnyMemories(): boolean {
  const db = getDb()
  const row = db.prepare('SELECT COUNT(*) as count FROM memories').get() as { count: number }
  return row.count > 0
}

/**
 * Delete a specific memory by type + value.
 */
export function deleteMemory(type: MemoryType, value: string): void {
  const db = getDb()
  const normalized = normalizeValue(value)
  db.prepare('DELETE FROM memories WHERE type = ? AND value = ?').run(type, normalized)
}
