import { getDb } from './database.js'
import { upsertMemory } from './memory-store.js'
import { buildSportsMemoryContext } from './memory-retrieval.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PreferenceCategory =
  | 'team'       // e.g. "atlas", "real madrid"
  | 'league'     // e.g. "liga mx", "premier league"
  | 'sport'      // e.g. "soccer", "basketball"
  | 'player'     // e.g. "messi", "lebron"
  | 'other'

export interface UserPreference {
  id: number
  category: PreferenceCategory
  value: string       // canonical slug / lowercase key
  label: string       // display name as user said it
  created_at: string
}

// ---------------------------------------------------------------------------
// Detection — extract preferences from natural language
// ---------------------------------------------------------------------------

// Phrases that signal the user is stating a personal preference
const PREFERENCE_TRIGGERS = [
  /mi equipo(s)? (favorito|fav|preferido)s? (es|son|de futbol es|de f[uú]tbol son)/i,
  /me gusta(n)? (el|los|la|las)?\s+/i,
  /soy (del|de|fan de(l)?|aficionado (al|a(l)? |del?))/i,
  /le voy (al?|a)\s+/i,
  /mi(s)? (equipo|equipos|club|clubs?|liga|ligas?|deporte|deportes)(s)? (favorito|fav|preferido)(s)? (es|son)/i,
  /sigo (al?|a|la|las|el|los)\s+/i,
  /tambi[eé]n sigo\s+/i,
  /equipo(s)? que sigo/i,
  /I (like|love|follow|support|root for)\s+/i,
  /my (favorite|favourite) (team|club|sport|league)\s*(is|are)/i,
  /I('m| am) a(n?)? .+ fan/i,
]

// Categories inferred from context words
const CATEGORY_HINTS: { pattern: RegExp; category: PreferenceCategory }[] = [
  { pattern: /\b(equipo|team|club|club de f[uú]tbol|soccer team|basketball team)\b/i, category: 'team' },
  { pattern: /\b(liga|league|torneo|tournament|competencia|competition)\b/i, category: 'league' },
  { pattern: /\b(deporte|sport|f[uú]tbol|soccer|basketball|beisbol|baseball|hockey|tenis|tennis)\b/i, category: 'sport' },
  { pattern: /\b(jugador|player|atleta|athlete)\b/i, category: 'player' },
]

// Known sports canonical values (for sport detection in extractPreferencesFromQuery)
// These are stable sport names — not dependent on external APIs, kept in code intentionally.
const SPORT_CANONICAL: Record<string, string> = {
  'futbol': 'futbol', 'fútbol': 'futbol', 'soccer': 'futbol', 'football': 'futbol',
  'basketball': 'basketball', 'basquetbol': 'basketball', 'basquetball': 'basketball',
  'baseball': 'baseball', 'beisbol': 'baseball', 'béisbol': 'baseball',
  'hockey': 'hockey',
  'tenis': 'tenis', 'tennis': 'tenis',
  'americano': 'futbol americano', 'football americano': 'futbol americano', 'futbol americano': 'futbol americano',
}

export interface ExtractedPreference {
  category: PreferenceCategory
  value: string        // canonical
  label: string        // original text
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Attempt to extract preference(s) from a natural language query.
 * Teams and leagues are resolved from the sports catalog DB tables.
 * Sports are resolved from the local SPORT_CANONICAL map (stable, no API dependency).
 */
export function extractPreferencesFromQuery(query: string): ExtractedPreference[] {
  const q = query.toLowerCase().trim()

  // Must match at least one trigger phrase
  const hasPreferenceTrigger = PREFERENCE_TRIGGERS.some((p) => p.test(q))
  if (!hasPreferenceTrigger) return []

  const db = getDb()
  const results: ExtractedPreference[] = []

  // ── Teams — query sports catalog table ──────────────────────────────────
  const teamRows = db
    .prepare('SELECT alias, canonical FROM espn_teams ORDER BY length(alias) DESC')
    .all() as { alias: string; canonical: string }[]

  for (const row of teamRows) {
    const re = new RegExp(`(?<![a-záéíóúüñ])${escapeRegex(row.alias)}(?![a-záéíóúüñ])`, 'i')
    if (re.test(q)) {
      if (!results.some((r) => r.category === 'team' && r.value === row.canonical)) {
        results.push({ category: 'team', value: row.canonical, label: row.alias })
      }
    }
  }

  // ── Leagues — query sports catalog table ────────────────────────────────
  // Use a mutable copy to prevent "liga mx" also matching "la liga" on the same query
  const leagueRows = db
    .prepare('SELECT alias, league_slug FROM espn_leagues ORDER BY length(alias) DESC')
    .all() as { alias: string; league_slug: string }[]

  let qLeague = q
  for (const row of leagueRows) {
    const re = new RegExp(`(?<![a-záéíóúüñ])${escapeRegex(row.alias)}(?![a-záéíóúüñ])`, 'i')
    if (re.test(qLeague)) {
      if (!results.some((r) => r.category === 'league' && r.value === row.league_slug)) {
        results.push({ category: 'league', value: row.league_slug, label: row.alias })
        qLeague = qLeague.replace(re, ' '.repeat(row.alias.length))
      }
    }
  }

  // ── Sports — local map (stable, no API needed) ────────────────────────────
  for (const [keyword, canonical] of Object.entries(SPORT_CANONICAL)) {
    const re = new RegExp(`(?<![a-záéíóúüñ])${escapeRegex(keyword)}(?![a-záéíóúüñ])`, 'i')
    if (re.test(q)) {
      if (!results.some((r) => r.category === 'sport' && r.value === canonical)) {
        results.push({ category: 'sport', value: canonical, label: keyword })
      }
    }
  }

  return results
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export function addPreference(category: PreferenceCategory, value: string, label: string): void {
  const db = getDb()
  // Keep writing to legacy table for backward compatibility
  db.prepare(
    'INSERT OR IGNORE INTO user_preferences (category, value, label) VALUES (?, ?, ?)',
  ).run(category, value, label)

  // Also upsert into the new memory system
  upsertMemory({
    type: 'preference',
    value,
    rawValue: label,
    confidence: 0.9,
    source: 'explicit',
  })
}

export function removePreference(category: PreferenceCategory, value: string): void {
  const db = getDb()
  db.prepare('DELETE FROM user_preferences WHERE category = ? AND value = ?').run(category, value)
}

export function getPreferences(category?: PreferenceCategory): UserPreference[] {
  const db = getDb()
  if (category) {
    return db.prepare('SELECT * FROM user_preferences WHERE category = ? ORDER BY created_at').all(category) as UserPreference[]
  }
  return db.prepare('SELECT * FROM user_preferences ORDER BY category, created_at').all() as UserPreference[]
}

export function getPreferencesByCategory(): Record<PreferenceCategory, string[]> {
  const all = getPreferences()
  const result: Record<PreferenceCategory, string[]> = {
    team: [], league: [], sport: [], player: [], other: [],
  }
  for (const pref of all) {
    result[pref.category].push(pref.value)
  }
  return result
}

export function hasAnyPreferences(): boolean {
  const db = getDb()
  const row = db.prepare('SELECT COUNT(*) as count FROM user_preferences').get() as { count: number }
  return row.count > 0
}

/**
 * Build a human-readable summary of stored preferences for LLM context injection.
 * Delegates to the new memory retrieval system (sports profile).
 */
export function buildPreferencesContext(): string | null {
  return buildSportsMemoryContext()
}

/**
 * Generate a confirmation message for the user after saving preferences.
 */
export function buildPreferenceSavedMessage(saved: ExtractedPreference[]): string {
  if (saved.length === 0) return ''
  const parts = saved.map((p) => {
    const icon = p.category === 'team' ? '[team]' : p.category === 'league' ? '[league]' : p.category === 'sport' ? '[sport]' : '[pref]'
    return `${icon} ${p.value}`
  })
  return `Guardé tus preferencias:\n${parts.join('\n')}\n\nLas tendré en cuenta en futuras consultas deportivas.`
}
