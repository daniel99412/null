/**
 * RSS/Atom feed fetcher
 *
 * Uses rss-parser to handle both RSS 2.0 and Atom.
 * On failure: logs the error, increments failure_count in news_sources,
 * and returns an empty array — never throws.
 */

import Parser from 'rss-parser'
import { getDb } from '../memory/database.js'
import { debugLog } from '../utils/debug.js'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface NewsSource {
  id: number
  name: string
  url: string
  feed_url: string | null
  bias_base: number
  reliability: number
  type: string
  scope_json: string
  anchor: number
  enabled: number
  failure_count: number
}

export interface NewsArticle {
  source: string
  sourceId: number
  biasBase: number
  reliability: number
  title: string
  url: string
  snippet: string
  publishedAt: string   // ISO string or ''
  category?: string
}

// ─── Parser instance ──────────────────────────────────────────────────────────

const parser = new Parser({
  timeout: 8000,
  headers: {
    'User-Agent': 'null-cli/1.0 (news digest; +https://github.com/daniel99412/null)',
    'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
  },
  customFields: {
    item: [['media:description', 'mediaDescription'], ['description', 'description']],
  },
})

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Load all enabled news sources from DB.
 */
export function getEnabledSources(): NewsSource[] {
  const db = getDb()
  return db.prepare('SELECT * FROM news_sources WHERE enabled = 1 ORDER BY anchor DESC, reliability DESC').all() as NewsSource[]
}

/**
 * Fetch articles from a single RSS/Atom feed.
 * Returns normalized NewsArticle[]. Never throws — errors are caught and logged.
 */
export async function fetchFeed(source: NewsSource): Promise<NewsArticle[]> {
  if (!source.feed_url) {
    debugLog(`[rss] ${source.name}: no feed_url, skipping`)
    return []
  }

  const db = getDb()

  try {
    debugLog(`[rss] fetching ${source.name}: ${source.feed_url}`)
    const feed = await parser.parseURL(source.feed_url)

    // Update last_checked_at on success
    db.prepare(
      "UPDATE news_sources SET last_checked_at = datetime('now'), last_error = NULL, failure_count = 0, updated_at = datetime('now') WHERE id = ?",
    ).run(source.id)

    const articles: NewsArticle[] = []

    for (const item of feed.items ?? []) {
      const title = cleanText(item.title ?? '')
      const url = (item.link ?? item.guid ?? '').trim()
      if (!title || !url) continue

      // Prefer richer sources: full HTML content > mediaDescription > contentSnippet > summary.
      // Many feeds only ship a short contentSnippet (~200 chars); when `content` is available
      // we get the full article HTML, which stripHtml converts to a much longer readable text.
      const rawContent =
        item.content ??
        (item as unknown as Record<string, string>)['mediaDescription'] ??
        item.contentSnippet ??
        item.summary ??
        ''

      const snippet = cleanText(stripHtml(rawContent)).slice(0, 1500).trim()

      const publishedAt = item.isoDate ?? item.pubDate ?? ''

      articles.push({
        source: source.name,
        sourceId: source.id,
        biasBase: source.bias_base,
        reliability: source.reliability,
        title,
        url,
        snippet,
        publishedAt: normalizeDate(publishedAt),
        category: guessCategory(title, snippet),
      })
    }

    debugLog(`[rss] ${source.name}: ${articles.length} articles`)

    // Persist to cache
    persistArticles(source.id, articles, db)

    return articles
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    debugLog(`[rss] ${source.name} error: ${msg}`)

    db.prepare(
      "UPDATE news_sources SET last_error = ?, failure_count = failure_count + 1, updated_at = datetime('now') WHERE id = ?",
    ).run(msg.slice(0, 255), source.id)

    return []
  }
}

/**
 * Fetch all enabled sources in parallel (up to concurrency limit).
 * Failures are silently swallowed per source.
 */
export async function fetchAllFeeds(concurrency = 6): Promise<NewsArticle[]> {
  const sources = getEnabledSources().filter((s) => s.feed_url)
  debugLog(`[rss] fetching ${sources.length} feeds (concurrency=${concurrency})`)

  const results: NewsArticle[] = []

  // Batch by concurrency
  for (let i = 0; i < sources.length; i += concurrency) {
    const batch = sources.slice(i, i + concurrency)
    const batchResults = await Promise.allSettled(batch.map((s) => fetchFeed(s)))
    for (const r of batchResults) {
      if (r.status === 'fulfilled') {
        results.push(...r.value)
      }
    }
  }

  debugLog(`[rss] total articles fetched: ${results.length}`)
  return results
}

/**
 * Fetch feeds whose scope_json overlaps with the given scopes.
 * Falls back to cached articles (last 6h) if live fetch yields too few.
 */
export async function fetchFeedsByScope(scopes: string[], concurrency = 6): Promise<NewsArticle[]> {
  if (scopes.length === 0) {
    debugLog('[rss] empty scopes — fetching all feeds')
    return fetchAllFeeds(concurrency)
  }

  const sources = getEnabledSources().filter((s) => {
    if (!s.feed_url) return false
    try {
      const sourceScopes: string[] = JSON.parse(s.scope_json)
      return sourceScopes.some((ss) => scopes.some((ts) => ss.includes(ts) || ts.includes(ss)))
    } catch {
      return false
    }
  })

  debugLog(`[rss] fetching ${sources.length} feeds matching scopes [${scopes.join(', ')}]`)

  const results: NewsArticle[] = []

  for (let i = 0; i < sources.length; i += concurrency) {
    const batch = sources.slice(i, i + concurrency)
    const batchResults = await Promise.allSettled(batch.map((s) => fetchFeed(s)))
    for (const r of batchResults) {
      if (r.status === 'fulfilled') {
        results.push(...r.value)
      }
    }
  }

  debugLog(`[rss] scope-filtered articles: ${results.length}`)
  return results
}

/**
 * Filter articles whose title or snippet matches any of the given keywords.
 * Case-insensitive, matches on word boundaries.
 */
export function filterArticlesByKeywords(articles: NewsArticle[], keywords: string[]): NewsArticle[] {
  if (keywords.length === 0) return articles

  const patterns = keywords.map((kw) => new RegExp(`\\b${escapeRegex(kw)}\\b`, 'i'))

  return articles.filter((a) => {
    const text = `${a.title} ${a.snippet}`
    return patterns.some((p) => p.test(text))
  })
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Return cached articles from DB (fallback when live fetch fails or for rate-limit protection).
 * TTL: 6 hours.
 */
export function getCachedArticles(maxAgeHours = 6): NewsArticle[] {
  const db = getDb()
  const rows = db.prepare(`
    SELECT a.*, s.name as source_name, s.bias_base, s.reliability
    FROM news_articles_cache a
    JOIN news_sources s ON a.source_id = s.id
    WHERE a.fetched_at >= datetime('now', '-${maxAgeHours} hours')
    ORDER BY a.published_at DESC
    LIMIT 500
  `).all() as Array<{
    source_name: string
    source_id: number
    bias_base: number
    reliability: number
    title: string
    url: string
    snippet: string | null
    published_at: string | null
    category: string | null
  }>

  return rows.map((r) => ({
    source: r.source_name,
    sourceId: r.source_id,
    biasBase: r.bias_base,
    reliability: r.reliability,
    title: cleanText(r.title),
    url: r.url,
    snippet: cleanText(r.snippet ?? ''),
    publishedAt: r.published_at ?? '',
    category: r.category ?? undefined,
  }))
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function persistArticles(sourceId: number, articles: NewsArticle[], db: ReturnType<typeof getDb>): void {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO news_articles_cache
      (source_id, url, title, snippet, published_at, normalized_title, category)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `)
  const insertMany = db.transaction((items: NewsArticle[]) => {
    for (const a of items) {
      insert.run(
        sourceId,
        a.url,
        a.title,
        a.snippet,
        a.publishedAt || null,
        normalizeTitle(a.title),
        a.category ?? null,
      )
    }
  })
  insertMany(articles)
}

export function cleanText(text: string): string {
  if (!text) return ''
  let clean = text

  for (let i = 0; i < 3; i++) {
    clean = clean
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(Number(n)))
      .replace(/&#x([0-9a-f]+);/gi, (_m, n) => String.fromCharCode(parseInt(n, 16)))
  }

  return clean.replace(/\s+/g, ' ').trim()
}

function stripHtml(html: string): string {
  if (!html) return ''
  return cleanText(html
    // Drop social media embeds (their text is metadata like "View this post
    // on Instagram" or fake author names — not article content).
    .replace(/<blockquote[^>]*class="[^"]*(instagram-media|twitter-tweet|tiktok-embed|fb-post|fb-video)[^"]*"[^>]*>[\s\S]*?<\/blockquote>/gi, ' ')
    // Drop script/style/noscript/svg/iframe blocks entirely
    .replace(/<(script|style|noscript|svg|iframe|figure)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    // Drop images entirely — alt text is often photographer credits, not article content
    .replace(/<img[^>]*\/?>/gi, ' ')
    // Drop figcaption, cite (image credits, photo captions)
    .replace(/<figcaption[^>]*>[\s\S]*?<\/figcaption>/gi, ' ')
    .replace(/<cite[^>]*>[\s\S]*?<\/cite>/gi, ' ')
    // Drop <aside>, <nav>, <header>, <footer> — typically sidebar/related content
    .replace(/<(aside|nav|header|footer|form|button)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    // Drop <a> but keep inner text (rss-parser's content:encoded wraps summaries in <a>)
    .replace(/<a[^>]*>([\s\S]*?)<\/a>/gi, '$1')
    // Strip remaining tags
    .replace(/<[^>]+>/g, ' ')
    // Collapse whitespace
    .replace(/\s+/g, ' '))
}

function normalizeDate(raw: string): string {
  if (!raw) return ''
  try {
    return new Date(raw).toISOString()
  } catch {
    return raw
  }
}

export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const CATEGORY_PATTERNS: [RegExp, string][] = [
  [/\b(presupuesto|pib|inflaci[oó]n|banco de m[eé]xico|banxico|pemex|cfe|t-?mec|aranceles?|dólar|tipo de cambio|remesas|nearshoring|inversi[oó]n|bonos?|deuda|impuesto|sat|hacienda)\b/i, 'Economía'],
  [/\b(presidente|senado|c[aá]mara|diputados?|congreso|partido|elecci[oó]n|voto|gobernador|alcalde|poder judicial|suprema corte|reforma|constituc)\b/i, 'Política'],
  [/\b(crimen|homicidio|asesinato|feminicidio|cartel|narco|secuestro|extorsión|seguridad|polic[ií]a|fiscal[ií]a|ejercito|guardia nacional|violencia|balacera)\b/i, 'Seguridad'],
  [/\b(migraci[oó]n|migrantes?|frontera|deportaci[oó]n|asilo|eeuu|estados unidos|trump|biden|harris|washington)\b/i, 'Migración'],
  [/\b(salud|covid|epidemia|vacuna|hospital|imss|issste|medicamentos?|diabetes|c[aá]ncer)\b/i, 'Salud'],
  [/\b(educaci[oó]n|escuela|universidad|unam|ipn|sep|maestros?|estudiantes?)\b/i, 'Educación'],
  [/\b(tecnolog[ií]a|inteligencia artificial|ia|ai|startup|digital|internet|redes sociales)\b/i, 'Tecnología'],
  [/\b(medio ambiente|clima|hurac[aá]n|terremoto|sismo|desastre|agua|sequía)\b/i, 'Medio Ambiente'],
]

function guessCategory(title: string, snippet: string): string {
  const text = `${title} ${snippet}`.toLowerCase()
  for (const [pattern, category] of CATEGORY_PATTERNS) {
    if (pattern.test(text)) return category
  }
  return 'México'
}
