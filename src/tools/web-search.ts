export interface SearchResult {
  title: string
  snippet: string
  url: string
}

export interface SearchContext {
  query: string
  results: SearchResult[]
  extract: string | null
}

import { debugLog } from '../utils/debug.js'

const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

/**
 * Search DuckDuckGo HTML lite for results matching the query.
 * No API key required — parses the lightweight HTML endpoint.
 */
export async function searchWeb(query: string, limit: number = 5): Promise<SearchResult[]> {
  debugLog(`[web-search] query: "${query}" (limit: ${limit})`)
  const params = new URLSearchParams({ q: query })

  const res = await fetch(`https://html.duckduckgo.com/html/?${params}`, {
    headers: { 'User-Agent': BROWSER_UA },
  })

  if (!res.ok) {
    debugLog(`[web-search] DuckDuckGo returned ${res.status}`)
    throw new Error(`DuckDuckGo search failed: ${res.status}`)
  }

  const html = await res.text()

  // Check for CAPTCHA / anomaly detection
  if (html.includes('Please try again') && !html.includes('result__a')) {
    throw new Error('DuckDuckGo rate-limited this request — try again shortly')
  }

  const parsed = parseDDGResults(html, limit)
  debugLog(`[web-search] got ${parsed.length} results: ${parsed.map(r => r.title.slice(0,30)).join(' | ')}`)
  return parsed
}

/**
 * Parse DuckDuckGo HTML lite results page.
 * Extracts title, URL, and snippet from each organic result.
 */
function parseDDGResults(html: string, limit: number): SearchResult[] {
  const results: SearchResult[] = []

  // Match result links: <a class="result__a" href="...">title</a>
  const linkRegex = /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g
  // Match snippets: <a class="result__snippet" ...>snippet</a>
  const snippetRegex = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g

  const links = [...html.matchAll(linkRegex)]
  const snippets = [...html.matchAll(snippetRegex)]

  for (let i = 0; i < Math.min(links.length, limit); i++) {
    const rawUrl = links[i][1]
    const title = stripHtml(links[i][2]).trim()

    // DDG wraps URLs in a redirect: extract the actual URL from uddg= param
    let url = rawUrl
    const uddgMatch = rawUrl.match(/[?&]uddg=([^&]+)/)
    if (uddgMatch) {
      url = decodeURIComponent(uddgMatch[1])
    }

    // Skip ads (they point to duckduckgo.com/y.js or bing.com/aclick)
    if (url.includes('duckduckgo.com/y.js') || url.includes('bing.com/aclick')) {
      continue
    }

    const snippet = i < snippets.length ? stripHtml(snippets[i][1]).trim() : ''

    results.push({ title, snippet, url })
  }

  return results
}

/**
 * Strip HTML tags and decode common entities.
 */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
}

/**
 * Get the intro extract of a Wikipedia article by title.
 * Used to enrich search results when the top result is a Wikipedia page.
 */
export async function getWikipediaExtract(title: string, maxChars: number = 3000): Promise<string | null> {
  const params = new URLSearchParams({
    action: 'query',
    prop: 'extracts',
    exintro: 'true',
    explaintext: 'true',
    titles: title,
    format: 'json',
    exchars: String(maxChars),
  })

  const res = await fetch(`https://en.wikipedia.org/w/api.php?${params}`, {
    headers: { 'User-Agent': 'NullCLI/0.1 (local AI assistant)' },
  })

  if (!res.ok) return null

  const data = await res.json() as WikiExtractResponse
  const pages = data.query.pages
  const page = Object.values(pages)[0]

  if (!page || page.missing !== undefined) return null
  return page.extract || null
}

/**
 * Full search pipeline: search DuckDuckGo, then optionally fetch
 * a Wikipedia extract if the top result is from Wikipedia.
 * Returns structured context ready to inject into an LLM prompt.
 */
export async function searchAndExtract(query: string): Promise<SearchContext> {
  const results = await searchWeb(query, 5)

  let extract: string | null = null

  // If a top result is Wikipedia, grab the extract for richer context
  const wikiResult = results.find((r) => r.url.includes('wikipedia.org/wiki/'))
  if (wikiResult) {
    const titleMatch = wikiResult.url.match(/\/wiki\/(.+)$/)
    if (titleMatch) {
      const title = decodeURIComponent(titleMatch[1].replace(/_/g, ' '))
      extract = await getWikipediaExtract(title)
    }
  }

  return { query, results, extract }
}

// Wikipedia API response types
interface WikiExtractResponse {
  query: {
    pages: Record<string, {
      title: string
      extract?: string
      missing?: boolean
    }>
  }
}
