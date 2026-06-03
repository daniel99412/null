/**
 * Mexico News Digest — main orchestrator.
 *
 * Pipeline:
 *   1. Check digest cache (TTL 15 min)
 *   2. Fetch RSS feeds (with per-article cache TTL 6h)
 *   3. Normalize → cluster → rank → bias
 *   4. Format top 10 as terminal cards
 *   5. Save to digest cache
 */

import { fetchAllFeeds, getCachedArticles } from './rss-fetcher.js'
import { clusterArticles } from './news-cluster.js'
import { rankStories } from './news-rank.js'
import { analyzeBias } from './news-bias.js'
import { fetchPageText } from './web-fetch.js'
import type { NewsStory } from './news-cluster.js'
import { getDb } from '../memory/database.js'
import { debugLog } from '../utils/debug.js'

// Module augmentation: add the optional `enrichedContent` field filled by
// enrichTopStories() so the digest summary uses the full article body when
// available, not just the RSS snippet.
declare module './news-cluster.js' {
  interface NewsStory {
    enrichedContent?: string
  }
}

// ─── Cache helpers ────────────────────────────────────────────────────────────

const DIGEST_TTL_MINUTES = 15

function getDigestCache(scope: string, query: string): DigestResult | null {
  const db = getDb()
  const row = db.prepare(`
    SELECT result_json FROM news_digest_cache
    WHERE scope = ? AND query = ? AND expires_at > datetime('now')
  `).get(scope, query) as { result_json: string } | undefined
  if (!row) return null
  try {
    return JSON.parse(row.result_json) as DigestResult
  } catch {
    return null
  }
}

function setDigestCache(scope: string, query: string, result: DigestResult): void {
  const db = getDb()
  db.prepare(`
    INSERT OR REPLACE INTO news_digest_cache (scope, query, result_json, expires_at)
    VALUES (?, ?, ?, datetime('now', '+${DIGEST_TTL_MINUTES} minutes'))
  `).run(scope, query, JSON.stringify(result))
}

// ─── Formatting ───────────────────────────────────────────────────────────────

function formatRecency(minutesAgo: number, publishedAt: string): string {
  if (minutesAgo < 0) return 'fecha desconocida'
  const timeStr = publishedAt
    ? new Date(publishedAt).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
    : ''
  if (minutesAgo < 60) return timeStr ? `hace ${minutesAgo} min (${timeStr})` : `hace ${minutesAgo} min`
  const h = Math.round(minutesAgo / 60)
  if (h === 1) return timeStr ? `hace 1 hora (${timeStr})` : 'hace 1 hora'
  if (h < 24) return timeStr ? `hace ${h} horas (${timeStr})` : `hace ${h} horas`
  const d = Math.round(h / 24)
  return d === 1 ? 'hace 1 día' : `hace ${d} días`
}

function buildNeutralSummary(story: NewsStory): string {
  // Prefer enriched (full-page) content when available — it gives a much more
  // complete summary than the RSS snippet alone.
  if (story.enrichedContent && story.enrichedContent.length >= 100) {
    const clean = story.enrichedContent.replace(/\s+/g, ' ').trim()
    return clean.slice(0, 450).replace(/\s+\S*$/, '') + (clean.length > 450 ? '…' : '')
  }

  // Fallback: pick the LONGEST snippet among the top 3 most reliable articles.
  // Longer snippets usually have more context, even if from a slightly
  // less-reliable source. Falls back to title when snippets are too short.
  const sorted = [...story.articles].sort((a, b) => b.reliability - a.reliability)
  const candidates = sorted
    .slice(0, 3)
    .map((a) => a.snippet)
    .filter((s) => s && s.length >= 20)

  if (candidates.length === 0) {
    return story.title
  }

  const best = candidates.reduce((a, b) => (b.length > a.length ? b : a))
  return best.slice(0, 300).replace(/\s+\S*$/, '') + (best.length > 300 ? '…' : '')
}

/**
 * Fetch full article content for the top N stories in parallel.
 * Mutates each story by setting `enrichedContent` when the fetch succeeds.
 * Failures are silently swallowed — the digest falls back to RSS snippets.
 */
async function enrichTopStories(stories: NewsStory[], count: number): Promise<void> {
  const targets = stories.slice(0, count)
  debugLog(`[news-digest] enriching top ${targets.length} stories with full-page fetch`)

  await Promise.allSettled(
    targets.map(async (story) => {
      // Pick the most reliable article URL to fetch
      const best = [...story.articles].sort((a, b) => b.reliability - a.reliability)[0]
      if (!best) return
      try {
        const text = await fetchPageText(best.url, { maxChars: 3000 })
        if (text && text.length >= 100) {
          story.enrichedContent = text
          debugLog(`[news-digest] enriched "${story.title.slice(0, 40)}…" (${text.length} chars)`)
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        debugLog(`[news-digest] enrich failed for ${best.url}: ${msg}`)
      }
    }),
  )
}

// Wrap text to a max line width, breaking on word boundaries.
// Prefixes each line with `prefix` so box-drawing characters stay aligned.
function wrapWithPrefix(text: string, prefix: string, maxWidth: number): string[] {
  // Normalize whitespace: collapse runs to single space
  const clean = text.replace(/\s+/g, ' ').trim()
  const contentWidth = maxWidth - prefix.length
  if (contentWidth <= 0) return [`${prefix}${clean}`]

  const words = clean.split(' ')
  const lines: string[] = []
  let current = ''

  for (const word of words) {
    if (current.length === 0) {
      // First word on this line
      if (word.length > contentWidth) {
        // Word longer than line — hard break
        let remaining = word
        while (remaining.length > contentWidth) {
          lines.push(`${prefix}${remaining.slice(0, contentWidth)}`)
          remaining = remaining.slice(contentWidth)
        }
        current = remaining
      } else {
        current = word
      }
    } else if (current.length + 1 + word.length <= contentWidth) {
      current = `${current} ${word}`
    } else {
      lines.push(`${prefix}${current}`)
      current = word
    }
  }
  if (current.length > 0) lines.push(`${prefix}${current}`)

  return lines
}

function formatCard(story: NewsStory): string {
  const bias = analyzeBias(story)
  const sourceList = story.sources.slice(0, 5).join(' · ')
  const extra = story.sources.length > 5 ? ` +${story.sources.length - 5}` : ''
  const summary = buildNeutralSummary(story)
  const recency = formatRecency(story.minutesAgo, story.publishedAt)
  const coverage = story.articles.length === 1
    ? '1 medio'
    : `${story.articles.length} medios`

  // Card interior width (between │ characters). Tuned for ~80-col terminals.
  const CONTENT_WIDTH = 72

  const titularLines = wrapWithPrefix(story.title, '│ ', CONTENT_WIDTH)
  const resumenLines = wrapWithPrefix(`Resumen: ${summary}`, '│ ', CONTENT_WIDTH)

  const lines: string[] = []
  lines.push(`┌─ ${story.category} · ${sourceList}${extra}`)
  lines.push('│')
  for (const ln of titularLines) lines.push(ln)
  lines.push('│')
  for (const ln of resumenLines) lines.push(ln)
  lines.push('│')
  lines.push(`│ Cobertura: ${coverage}`)
  lines.push(`│ Recencia: ${recency}`)
  lines.push('│')
  lines.push(`│ Inclinación de cobertura: ${bias.biasLabel} (${bias.finalBias.toFixed(1)})`)
  lines.push(`│ Polarización: ${bias.polarizationLabel}`)
  lines.push('└')

  return lines.join('\n')
}

function formatDigest(stories: NewsStory[], fetchedAt: Date): string {
  const dateStr = fetchedAt.toLocaleString('es-MX', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })

  const header = [
    `╔══════════════════════════════════════════════════╗`,
    `║         RESUMEN DE NOTICIAS — MÉXICO             ║`,
    `║  ${dateStr.slice(0, 46).padEnd(46)}  ║`,
    `╚══════════════════════════════════════════════════╝`,
    '',
  ].join('\n')

  if (stories.length === 0) {
    return `${header}No se pudieron obtener noticias en este momento. Intenta de nuevo en unos minutos.`
  }

  const cards = stories.map((s) => formatCard(s)).join('\n\n')

  const footer = [
    '',
    `─────────────────────────────────────────────────────`,
    `Fuentes: ${stories.flatMap((s) => s.sources).filter((v, i, a) => a.indexOf(v) === i).length} medios consultados`,
    `Nota: La inclinación de cobertura es una estimación basada en la inclinación histórica de las fuentes. No representa verdad ni calidad.`,
  ].join('\n')

  return `${header}${cards}${footer}`
}

// ─── Main export ──────────────────────────────────────────────────────────────

export interface DigestArticle {
  position: number
  title: string
  url: string
  source: string
  category: string
}

export interface DigestResult {
  formatted: string
  articles: DigestArticle[]
}

export async function buildMexicoNewsDigest(query = 'mexico'): Promise<DigestResult> {
  const scope = 'mexico'
  // Bump DIGEST_FORMAT_VERSION when format changes to invalidate stale cache.
  const DIGEST_FORMAT_VERSION = 'v7'
  const cacheKey = `${DIGEST_FORMAT_VERSION}:${query.toLowerCase().trim().slice(0, 80)}`

  // Check digest cache first
  const cached = getDigestCache(scope, cacheKey)
  if (cached) {
    debugLog('[news-digest] serving from cache')
    return cached
  }

  debugLog('[news-digest] building fresh digest...')
  const fetchedAt = new Date()

  // Fetch live RSS feeds; fall back to cached articles if fetch yields nothing
  let articles = await fetchAllFeeds()
  if (articles.length < 5) {
    debugLog('[news-digest] live fetch returned few results, supplementing with cache')
    const cached6h = getCachedArticles(6)
    const existingUrls = new Set(articles.map((a) => a.url))
    articles = [...articles, ...cached6h.filter((a) => !existingUrls.has(a.url))]
  }

  debugLog(`[news-digest] total articles: ${articles.length}`)

  if (articles.length === 0) {
    return {
      formatted: 'No se pudieron obtener noticias. Verifica tu conexión a internet e intenta de nuevo.',
      articles: [],
    }
  }

  // Filter to last 24h (some feeds include old items)
  const cutoff = Date.now() - 24 * 60 * 60 * 1000
  const recent = articles.filter((a) => {
    if (!a.publishedAt) return true
    const t = Date.parse(a.publishedAt)
    return isNaN(t) || t >= cutoff
  })
  debugLog(`[news-digest] articles within 24h: ${recent.length}`)

  const toCluster = recent.length >= 10 ? recent : articles

  // Cluster → rank → take top 10
  const stories = clusterArticles(toCluster)
  debugLog(`[news-digest] stories after clustering: ${stories.length}`)

  const ranked = rankStories(stories).slice(0, 10)
  debugLog(`[news-digest] top ${ranked.length} stories selected`)

  // Enrich the top 3 stories with full-page content for richer summaries.
  // +1 fetch in parallel = ~4s added (4s default timeout in fetchPageText).
  await enrichTopStories(ranked, 3)

  const formatted = formatDigest(ranked, fetchedAt)

  // Build the article list — pick the best article per story (highest reliability)
  const articlesList: DigestArticle[] = ranked.map((story, i) => {
    const best = [...story.articles].sort((a, b) => b.reliability - a.reliability)[0]
    return {
      position: i + 1,
      title: story.title,
      url: best.url,
      source: best.source,
      category: story.category,
    }
  })

  // Cache the full result (formatted + articles) so the reader keeps working
  // on subsequent requests within the TTL window.
  setDigestCache(scope, cacheKey, { formatted, articles: articlesList })

  return { formatted, articles: articlesList }
}
