import { getDb } from './database.js'
import { upsertMemory } from './memory-store.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PreferenceCategory = 'other'

export interface UserPreference {
  id: number
  category: PreferenceCategory
  value: string
  label: string
  created_at: string
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export function addPreference(category: PreferenceCategory, value: string, label: string): void {
  const db = getDb()
  db.prepare(
    'INSERT OR IGNORE INTO user_preferences (category, value, label) VALUES (?, ?, ?)',
  ).run(category, value, label)

  upsertMemory({
    type: 'preference',
    value,
    rawValue: label,
    confidence: 0.9,
    source: 'explicit',
  })
}

export function getPreferences(category?: PreferenceCategory): UserPreference[] {
  const db = getDb()
  if (category) {
    return db.prepare('SELECT * FROM user_preferences WHERE category = ? ORDER BY created_at').all(category) as UserPreference[]
  }
  return db.prepare('SELECT * FROM user_preferences ORDER BY category, created_at').all() as UserPreference[]
}

export function hasAnyPreferences(): boolean {
  const db = getDb()
  const row = db.prepare('SELECT COUNT(*) as count FROM user_preferences').get() as { count: number }
  return row.count > 0
}

/**
 * Build a human-readable summary of stored preferences for LLM context injection.
 */
export function buildPreferencesContext(): string | null {
  return null
}
