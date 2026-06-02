/**
 * Relevance ranking for NewsStory objects.
 *
 * Factors:
 *  - Coverage: number of sources covering the story
 *  - Recency: how recent (minutes ago)
 *  - Reliability: average reliability of covering sources
 *  - Category boost: politics, security, economy get higher weight
 *  - Mexico impact: keywords tied to national interest
 *  - Anchor boost: at least one wire agency covering it
 */

import type { NewsStory } from './news-cluster.js'

// ─── Category boosts ──────────────────────────────────────────────────────────

const CATEGORY_BOOST: Record<string, number> = {
  'Política': 1.4,
  'Seguridad': 1.35,
  'Economía': 1.30,
  'Migración': 1.20,
  'Salud': 1.10,
  'Tecnología': 1.05,
  'Educación': 1.05,
  'Medio Ambiente': 1.05,
  'Deportes': 0.85,
  'México': 1.0,
}

// Keyword boost — high-impact topics per RFC
const IMPACT_KEYWORDS = [
  /\bbanxico\b/i,
  /\bpemex\b/i,
  /\bcfe\b/i,
  /\bt-?mec\b/i,
  /\bremesas?\b/i,
  /\bmigraci[oó]n\b/i,
  /\baranceles?\b/i,
  /\bnearshoring\b/i,
  /\btipo de cambio\b/i,
  /\bdólar\b/i,
  /\btrump\b/i,
  /\bsupreme court\b/i,
  /\bsupremac[oó]rte\b/i,
  /\bmundial 2026\b/i,
  /\bpresupuesto\b/i,
  /\bpib\b/i,
  /\binflaci[oó]n\b/i,
]

// ─── Scoring helpers ──────────────────────────────────────────────────────────

/**
 * Recency score: 1.0 for articles from last 30 min, decays to 0.1 at 24h.
 */
function recencyScore(minutesAgo: number): number {
  if (minutesAgo < 0) return 0.3  // unknown date
  if (minutesAgo <= 30) return 1.0
  if (minutesAgo <= 60) return 0.95
  if (minutesAgo <= 120) return 0.88
  if (minutesAgo <= 240) return 0.78
  if (minutesAgo <= 480) return 0.65
  if (minutesAgo <= 720) return 0.50
  if (minutesAgo <= 1440) return 0.30
  return 0.15
}

/**
 * Coverage score: log-scaled, max boost at 8+ sources.
 */
function coverageScore(sourceCount: number): number {
  return Math.min(1.0, Math.log2(sourceCount + 1) / Math.log2(9))
}

/**
 * Average reliability of sources covering this story.
 */
function avgReliability(story: NewsStory): number {
  if (story.articles.length === 0) return 0.5
  const sum = story.articles.reduce((acc, a) => acc + a.reliability, 0)
  return sum / story.articles.length
}

/**
 * Returns true if at least one anchor (wire agency) covers the story.
 */
function hasAnchor(story: NewsStory): boolean {
  return story.articles.some((a) => a.reliability >= 0.9)
}

/**
 * Impact keyword match boost.
 */
function impactBoost(story: NewsStory): number {
  const text = `${story.title} ${story.articles.map((a) => a.snippet).join(' ')}`
  const matches = IMPACT_KEYWORDS.filter((re) => re.test(text)).length
  return Math.min(0.30, matches * 0.08)
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Score each story and return sorted list (highest first).
 */
export function rankStories(stories: NewsStory[]): NewsStory[] {
  for (const story of stories) {
    const coverage = coverageScore(story.sources.length)          // 0–1
    const recency  = recencyScore(story.minutesAgo)               // 0–1
    const relScore = avgReliability(story)                        // 0–1
    const catMult  = CATEGORY_BOOST[story.category] ?? 1.0
    const impact   = impactBoost(story)                           // 0–0.30
    const anchorBonus = hasAnchor(story) ? 0.15 : 0              // flat bonus

    // Weighted sum: coverage matters most, then recency, then reliability
    const raw = (
      coverage   * 0.35 +
      recency    * 0.30 +
      relScore   * 0.20 +
      impact     +
      anchorBonus
    ) * catMult

    story.relevanceScore = Math.min(1.0, raw)
  }

  return stories.sort((a, b) => b.relevanceScore - a.relevanceScore)
}
