import { getMemoriesByType, searchMemories, hasAnyMemories, type MemoryType, type MemoryWithScore } from './memory-store.js'

// ── Query profiles ────────────────────────────────────────────────────────────
//
// Different query types need different memory types injected.
// This keeps the prompt injection focused and avoids retrieval pollution.

export type QueryProfile =
  | 'sports'    // only inject preference memories (teams, leagues, sports)
  | 'tech'      // inject tech_stack, occupation, project, goal
  | 'general'   // inject all types with score >= threshold

const PROFILE_TYPES: Record<QueryProfile, MemoryType[]> = {
  sports: ['preference'],
  tech: ['tech_stack', 'occupation', 'project', 'goal'],
  general: [
    'preference', 'tech_stack', 'occupation', 'goal',
    'behavior', 'dislike', 'location', 'alias_self', 'relationship',
  ],
}

// Max memories to inject — keeps prompt block under ~200 tokens
const MAX_MEMORIES = 8
const MIN_SCORE = 0.4

// ── Labels for display ────────────────────────────────────────────────────────

const TYPE_LABELS: Record<MemoryType, string> = {
  preference: 'preference',
  tech_stack: 'tech',
  occupation: 'occupation',
  project: 'project',
  goal: 'goal',
  behavior: 'behavior',
  dislike: 'dislike',
  relationship: 'relationship',
  location: 'location',
  alias_self: 'name',
}

// ── Core retrieval ────────────────────────────────────────────────────────────

/**
 * Retrieve memories relevant to a query.
 *
 * Strategy:
 * 1. Fetch all memories of the types defined by the profile
 * 2. If keywords provided, also run a keyword search and merge (dedup by id)
 * 3. Sort by score desc, cap at MAX_MEMORIES
 */
export function retrieveMemories(
  profile: QueryProfile,
  keywords: string[] = [],
): MemoryWithScore[] {
  if (!hasAnyMemories()) return []

  const types = PROFILE_TYPES[profile]
  const byType = getMemoriesByType(types, MIN_SCORE)

  // Keyword search on top (only for general profile — sports/tech don't need it)
  let byKeyword: MemoryWithScore[] = []
  if (profile === 'general' && keywords.length > 0) {
    byKeyword = searchMemories(keywords, MIN_SCORE)
  }

  // Merge and deduplicate by memory id
  const seen = new Set<number>()
  const merged: MemoryWithScore[] = []

  for (const m of [...byType, ...byKeyword]) {
    if (!seen.has(m.id)) {
      seen.add(m.id)
      merged.push(m)
    }
  }

  // Sort by score desc, then recency
  merged.sort((a, b) => b.score - a.score || new Date(b.last_seen_at).getTime() - new Date(a.last_seen_at).getTime())

  return merged.slice(0, MAX_MEMORIES)
}

// ── Context builder ───────────────────────────────────────────────────────────

/**
 * Build a compact memory context string for injection into an LLM prompt.
 * Returns null if no relevant memories found.
 *
 * Output format:
 *   [User context]
 *   - name: Daniel
 *   - occupation: backend developer
 *   - tech: typescript, react
 *   - preference: atlas, liga mx
 *
 * Grouped by type, values comma-separated to minimize tokens.
 */
export function buildMemoryContext(
  profile: QueryProfile,
  keywords: string[] = [],
): string | null {
  const memories = retrieveMemories(profile, keywords)
  if (memories.length === 0) return null

  // Group by type
  const groups = new Map<string, string[]>()
  for (const m of memories) {
    const label = TYPE_LABELS[m.type as MemoryType] ?? m.type
    if (!groups.has(label)) groups.set(label, [])
    groups.get(label)!.push(m.value)
  }

  const lines = ['[User context]']
  for (const [label, values] of groups) {
    lines.push(`- ${label}: ${values.join(', ')}`)
  }

  return lines.join('\n')
}

/**
 * Convenience: build context specifically for sports queries.
 * Replaces buildPreferencesContext() from preferences.ts.
 */
export function buildSportsMemoryContext(): string | null {
  return buildMemoryContext('sports')
}

/**
 * Convenience: build context for general/ReAct queries.
 * Extracts keywords from the query for better matching.
 */
export function buildGeneralMemoryContext(query: string): string | null {
  const keywords = extractKeywords(query)
  return buildMemoryContext('general', keywords)
}

// ── Keyword extraction (simple, no NLP lib needed) ───────────────────────────

function extractKeywords(text: string): string[] {
  const STOPWORDS = new Set([
    'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'de', 'del', 'al',
    'en', 'con', 'por', 'para', 'que', 'es', 'son', 'se', 'lo', 'le', 'me',
    'te', 'nos', 'mi', 'tu', 'su', 'como', 'pero', 'mas', 'si', 'ya', 'hay',
    'the', 'a', 'an', 'of', 'in', 'on', 'at', 'to', 'for', 'is', 'are', 'was',
    'i', 'you', 'he', 'she', 'we', 'they', 'it', 'and', 'or', 'but', 'not',
    'can', 'do', 'does', 'did', 'have', 'has', 'will', 'would', 'could', 'should',
    'what', 'how', 'when', 'where', 'who', 'why', 'which',
  ])

  return text
    .toLowerCase()
    .replace(/[^a-záéíóúüña-z0-9\s]/gi, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w))
    .slice(0, 8) // cap to avoid over-querying
}
