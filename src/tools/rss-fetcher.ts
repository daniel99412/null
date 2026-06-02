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
      const title = (item.title ?? '').trim()
      const url = (item.link ?? item.guid ?? '').trim()
      if (!title || !url) continue

      const snippet = stripHtml(
        (item.contentSnippet ?? item.content ?? (item as unknown as Record<string, string>)['mediaDescription'] ?? item.summary ?? '').slice(0, 400),
      ).trim()

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
    title: r.title,
    url: r.url,
    snippet: r.snippet ?? '',
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

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
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
  [/\b(mundial|deporte|f[uú]tbol|liga|copa|olimpiadas?|atletas?)\b/i, 'Deportes'],
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
