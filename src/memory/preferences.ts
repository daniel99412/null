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

// Team name → canonical lookup (reuse ESPN team names)
const TEAM_CANONICAL: Record<string, string> = {
  'atlas': 'atlas', 'zorros': 'atlas',
  'america': 'america', 'águilas': 'america', 'aguilas': 'america', 'club america': 'america',
  'chivas': 'chivas', 'guadalajara': 'chivas', 'rebaño': 'chivas',
  'cruz azul': 'cruz azul', 'la maquina': 'cruz azul',
  'pumas': 'pumas', 'pumas unam': 'pumas',
  'tigres': 'tigres', 'tigres uanl': 'tigres',
  'monterrey': 'monterrey', 'rayados': 'monterrey',
  'toluca': 'toluca', 'diablos rojos': 'toluca',
  'pachuca': 'pachuca', 'tuzos': 'pachuca',
  'santos': 'santos laguna', 'santos laguna': 'santos laguna',
  'leon': 'leon', 'léon': 'leon',
  'necaxa': 'necaxa', 'rayos': 'necaxa',
  'puebla': 'puebla', 'camoteros': 'puebla',
  'queretaro': 'queretaro', 'querétaro': 'queretaro', 'gallos': 'queretaro',
  'tijuana': 'tijuana', 'xolos': 'tijuana',
  'juarez': 'juarez', 'bravos': 'juarez',
  // LaLiga
  'barcelona': 'barcelona', 'real madrid': 'real madrid', 'atletico madrid': 'atletico madrid',
  // EPL
  'manchester city': 'manchester city', 'man city': 'manchester city',
  'arsenal': 'arsenal', 'liverpool': 'liverpool', 'chelsea': 'chelsea',
  'manchester united': 'manchester united', 'man united': 'manchester united',
  'tottenham': 'tottenham', 'spurs': 'tottenham',
  // NBA
  'lakers': 'lakers', 'los angeles lakers': 'lakers',
  'celtics': 'celtics', 'warriors': 'warriors', 'bulls': 'bulls',
}

const LEAGUE_CANONICAL: Record<string, string> = {
  'liga mx': 'liga mx', 'ligamx': 'liga mx', 'liga mexicana': 'liga mx',
  'premier league': 'premier league', 'epl': 'premier league', 'premier': 'premier league',
  'la liga': 'la liga', 'laliga': 'la liga',
  'serie a': 'serie a',
  'bundesliga': 'bundesliga',
  'ligue 1': 'ligue 1',
  'champions league': 'champions league', 'ucl': 'champions league', 'champions': 'champions league',
  'copa libertadores': 'copa libertadores', 'libertadores': 'copa libertadores',
  'nba': 'nba', 'nfl': 'nfl', 'mlb': 'mlb', 'nhl': 'nhl', 'mls': 'mls',
}

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
 * Returns an array of extracted preferences (may be empty if none found).
 */
export function extractPreferencesFromQuery(query: string): ExtractedPreference[] {
  const q = query.toLowerCase().trim()

  // Must match at least one trigger phrase
  const hasPreferenceTrigger = PREFERENCE_TRIGGERS.some((p) => p.test(q))
  if (!hasPreferenceTrigger) return []

  const results: ExtractedPreference[] = []

  // Sorted by keyword length descending so longer/more-specific matches win first
  // (e.g. "liga mx" before "la liga", "champions league" before "champions")
  const sortedLeagues = Object.entries(LEAGUE_CANONICAL).sort((a, b) => b[0].length - a[0].length)
  const sortedTeams = Object.entries(TEAM_CANONICAL).sort((a, b) => b[0].length - a[0].length)

  // Try to detect teams
  for (const [keyword, canonical] of sortedTeams) {
    const re = new RegExp(`(?<![a-záéíóúüñ])${escapeRegex(keyword)}(?![a-záéíóúüñ])`, 'i')
    if (re.test(q)) {
      if (!results.some((r) => r.category === 'team' && r.value === canonical)) {
        results.push({ category: 'team', value: canonical, label: keyword })
      }
    }
  }

  // Try to detect leagues — use a mutable copy so matched text is consumed
  // (prevents "la liga mx" from matching both "liga mx" AND "la liga")
  let qLeague = q
  for (const [keyword, canonical] of sortedLeagues) {
    const re = new RegExp(`(?<![a-záéíóúüñ])${escapeRegex(keyword)}(?![a-záéíóúüñ])`, 'i')
    if (re.test(qLeague)) {
      if (!results.some((r) => r.category === 'league' && r.value === canonical)) {
        results.push({ category: 'league', value: canonical, label: keyword })
        // Mask matched text so shorter overlapping keywords don't also match
        qLeague = qLeague.replace(re, ' '.repeat(keyword.length))
      }
    }
  }

  // Try to detect sports
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
