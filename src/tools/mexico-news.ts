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
import type { NewsStory } from './news-cluster.js'
import { getDb } from '../memory/database.js'
import { debugLog } from '../utils/debug.js'

// ─── Cache helpers ────────────────────────────────────────────────────────────

const DIGEST_TTL_MINUTES = 15

function getDigestCache(scope: string, query: string): string | null {
  const db = getDb()
  const row = db.prepare(`
    SELECT result_json FROM news_digest_cache
    WHERE scope = ? AND query = ? AND expires_at > datetime('now')
  `).get(scope, query) as { result_json: string } | undefined
  return row?.result_json ?? null
}

function setDigestCache(scope: string, query: string, result: string): void {
  const db = getDb()
  db.prepare(`
    INSERT OR REPLACE INTO news_digest_cache (scope, query, result_json, expires_at)
    VALUES (?, ?, ?, datetime('now', '+${DIGEST_TTL_MINUTES} minutes'))
  `).run(scope, query, result)
}

// ─── Formatting ───────────────────────────────────────────────────────────────

function formatRecency(minutesAgo: number): string {
  if (minutesAgo < 0) return 'hora desconocida'
  if (minutesAgo < 60) return `hace ${minutesAgo} minutos`
  const h = Math.round(minutesAgo / 60)
  if (h === 1) return 'hace 1 hora'
  if (h < 24) return `hace ${h} horas`
  const d = Math.round(h / 24)
  return d === 1 ? 'hace 1 día' : `hace ${d} días`
}

function buildNeutralSummary(story: NewsStory): string {
  // Collect unique snippets from the top 3 most reliable articles
  const sorted = [...story.articles].sort((a, b) => b.reliability - a.reliability)
  const snippets = sorted
    .slice(0, 3)
    .map((a) => a.snippet)
    .filter((s) => s && s.length > 20)

  if (snippets.length === 0) {
    return 'Sin resumen disponible.'
  }

  // Return the best snippet (from most reliable source)
  // Truncate to ~200 chars to keep cards tight
  return snippets[0].slice(0, 220).replace(/\s+$/, '') + (snippets[0].length > 220 ? '…' : '')
}

function formatCard(story: NewsStory, index: number): string {
  const bias = analyzeBias(story)
  const sourceList = story.sources.slice(0, 5).join(' · ')
  const extra = story.sources.length > 5 ? ` +${story.sources.length - 5}` : ''
  const summary = buildNeutralSummary(story)
  const recency = formatRecency(story.minutesAgo)
  const coverage = story.articles.length === 1
    ? '1 medio'
    : `${story.articles.length} medios`

  const lines = [
    `┌─ ${story.category} · ${sourceList}${extra}`,
    `│`,
    `│ Titular: ${story.title}`,
    `│`,
    `│ Resumen: ${summary}`,
    `│`,
    `│ Cobertura: ${coverage}`,
    `│ Recencia: ${recency}`,
    `│`,
    `│ Inclinación de cobertura: ${bias.biasLabel} (${bias.finalBias.toFixed(1)})`,
    `│ Polarización: ${bias.polarizationLabel}`,
    `└`,
  ]

  return `${index + 1}. ${lines.join('\n')}`
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

  const cards = stories.map((s, i) => formatCard(s, i)).join('\n\n')

  const footer = [
    '',
    `─────────────────────────────────────────────────────`,
    `Fuentes: ${stories.flatMap((s) => s.sources).filter((v, i, a) => a.indexOf(v) === i).length} medios consultados`,
    `Nota: La inclinación de cobertura es una estimación basada en la inclinación histórica de las fuentes. No representa verdad ni calidad.`,
  ].join('\n')

  return `${header}${cards}${footer}`
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function buildMexicoNewsDigest(query = 'mexico'): Promise<string> {
  const scope = 'mexico'
  const cacheKey = query.toLowerCase().trim().slice(0, 80)

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
    return 'No se pudieron obtener noticias. Verifica tu conexión a internet e intenta de nuevo.'
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

  const result = formatDigest(ranked, fetchedAt)

  // Cache the digest
  setDigestCache(scope, cacheKey, result)

  return result
}
