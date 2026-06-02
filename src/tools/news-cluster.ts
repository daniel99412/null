/**
 * Story clustering — groups articles that cover the same event.
 *
 * Strategy (v1 — no embeddings):
 *  1. Normalize titles (lowercase, strip diacritics, strip punctuation)
 *  2. Extract high-value tokens (nouns, proper nouns, numbers)
 *  3. Compute Jaccard similarity of token sets between each pair
 *  4. If similarity >= threshold → same cluster
 *  5. Merge transitively (union-find)
 */

import type { NewsArticle } from './rss-fetcher.js'
import { normalizeTitle } from './rss-fetcher.js'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface NewsStory {
  /** Canonical title — from the most reliable anchor source, or first article */
  title: string
  /** All articles covering this story */
  articles: NewsArticle[]
  /** Primary category (from most reliable article) */
  category: string
  /** Earliest publish date among articles */
  publishedAt: string
  /** Sources covering this story */
  sources: string[]
  /** Relevance score — filled by ranker */
  relevanceScore: number
  /** Minutes ago from now (filled after ranking) */
  minutesAgo: number
}

// ─── Constants ────────────────────────────────────────────────────────────────

const SIMILARITY_THRESHOLD = 0.25   // Jaccard threshold to consider same story
const MIN_TOKEN_LENGTH = 3
const MAX_CLUSTER_HOURS = 24         // Don't cluster articles > 24h apart

// Spanish/English stopwords to exclude from token comparison
const STOPWORDS = new Set([
  'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'de', 'del', 'al',
  'en', 'con', 'por', 'para', 'que', 'es', 'son', 'se', 'lo', 'le', 'me',
  'te', 'nos', 'mi', 'tu', 'su', 'como', 'pero', 'mas', 'si', 'ya', 'hay',
  'the', 'a', 'an', 'of', 'in', 'on', 'at', 'to', 'for', 'is', 'are', 'was',
  'and', 'or', 'but', 'not', 'this', 'that', 'its',
  // Common Mexican news filler
  'este', 'esta', 'estos', 'estas', 'nuevo', 'nueva', 'sobre', 'ante',
  'tras', 'desde', 'hasta', 'entre', 'durante', 'segun', 'asi', 'tambien',
])

// ─── Token extraction ─────────────────────────────────────────────────────────

function extractTokens(title: string): Set<string> {
  const normalized = normalizeTitle(title)
  const tokens = normalized
    .split(/\s+/)
    .filter((t) => t.length >= MIN_TOKEN_LENGTH && !STOPWORDS.has(t))
  return new Set(tokens)
}

// ─── Jaccard similarity ───────────────────────────────────────────────────────

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0
  let intersection = 0
  for (const t of a) {
    if (b.has(t)) intersection++
  }
  const union = a.size + b.size - intersection
  return union === 0 ? 0 : intersection / union
}

// ─── Union-Find ───────────────────────────────────────────────────────────────

class UnionFind {
  private parent: number[]

  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i)
  }

  find(x: number): number {
    if (this.parent[x] !== x) this.parent[x] = this.find(this.parent[x])
    return this.parent[x]
  }

  union(x: number, y: number): void {
    this.parent[this.find(x)] = this.find(y)
  }
}

// ─── Time helpers ─────────────────────────────────────────────────────────────

function parseDate(iso: string): number {
  if (!iso) return 0
  const ms = Date.parse(iso)
  return isNaN(ms) ? 0 : ms
}

function hoursApart(a: string, b: string): number {
  const ta = parseDate(a)
  const tb = parseDate(b)
  if (!ta || !tb) return 0
  return Math.abs(ta - tb) / (1000 * 60 * 60)
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Cluster a flat list of articles into NewsStory objects.
 * Articles about the same event are grouped together.
 */
export function clusterArticles(articles: NewsArticle[]): NewsStory[] {
  if (articles.length === 0) return []

  // Pre-compute tokens for each article
  const tokenSets = articles.map((a) => extractTokens(a.title))

  // Build clusters with Union-Find
  const uf = new UnionFind(articles.length)

  for (let i = 0; i < articles.length; i++) {
    for (let j = i + 1; j < articles.length; j++) {
      // Don't cluster articles too far apart in time
      if (hoursApart(articles[i].publishedAt, articles[j].publishedAt) > MAX_CLUSTER_HOURS) continue

      const sim = jaccard(tokenSets[i], tokenSets[j])
      if (sim >= SIMILARITY_THRESHOLD) {
        uf.union(i, j)
      }
    }
  }

  // Group by cluster root
  const clusterMap = new Map<number, NewsArticle[]>()
  for (let i = 0; i < articles.length; i++) {
    const root = uf.find(i)
    if (!clusterMap.has(root)) clusterMap.set(root, [])
    clusterMap.get(root)!.push(articles[i])
  }

  const now = Date.now()
  const stories: NewsStory[] = []

  for (const [, clusterArticles] of clusterMap) {
    // Sort articles by reliability desc to pick best title
    const sorted = [...clusterArticles].sort((a, b) => b.reliability - a.reliability)
    const best = sorted[0]

    // Pick earliest publish date
    const dates = clusterArticles
      .map((a) => parseDate(a.publishedAt))
      .filter((d) => d > 0)
    const earliest = dates.length > 0 ? Math.min(...dates) : 0
    const publishedAt = earliest > 0 ? new Date(earliest).toISOString() : ''

    const minutesAgo = earliest > 0 ? Math.round((now - earliest) / 60000) : -1

    const sources = [...new Set(clusterArticles.map((a) => a.source))]

    stories.push({
      title: best.title,
      articles: clusterArticles,
      category: best.category ?? 'México',
      publishedAt,
      sources,
      relevanceScore: 0,  // filled by ranker
      minutesAgo,
    })
  }

  return stories
}
