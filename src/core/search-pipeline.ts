import { getCachedSearch, setCachedSearch } from '../memory/search-cache.js'
import { fetchPageText } from '../tools/web-fetch.js'
import type { SearchContext } from '../tools/web-search.js'
import { debugLog } from '../utils/debug.js'
import { tools } from './tools.js'

export interface FetchedArticle {
  title: string
  url: string
  content: string
}

export interface SearchPipelineResult {
  contextMessage: string
  originalTxt: string
}

function hasUsefulContent(text: string, minLength: number): boolean {
  if (text.length < minLength) return false
  const noise = [
    /captcha/i,
    /access denied/i,
    /403 forbidden/i,
    /please enable javascript/i,
    /browser.*not supported/i,
  ]
  return !noise.some((p) => p.test(text))
}

function isNewsQuery(query: string): boolean {
  return /\b(noticias?|news|breaking|últimas?|ultimas?|latest|recientes?|recent)\b/i.test(query)
}

function sourceFromUrl(url: string): string {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '')
    return hostname
  } catch {
    return url
  }
}

function diversifyResults(
  results: { title: string; url: string; snippet: string }[],
  maxPerSource: number,
): { title: string; url: string; snippet: string }[] {
  const counts = new Map<string, number>()
  const diversified: { title: string; url: string; snippet: string }[] = []

  for (const result of results) {
    const source = sourceFromUrl(result.url)
    const count = counts.get(source) ?? 0
    if (count >= maxPerSource) continue

    counts.set(source, count + 1)
    diversified.push(result)
  }

  return diversified
}

async function fetchArticlesAdaptive(
  results: { title: string; url: string; snippet: string }[],
  options?: {
    maxArticles?: number
    minContentLength?: number
  },
): Promise<FetchedArticle[]> {
  const maxArticles = options?.maxArticles ?? 3
  const minContentLength = options?.minContentLength ?? 500
  const candidates = results.slice(0, maxArticles)
  if (candidates.length === 0) return []

  const fetchOne = async (r: { title: string; url: string; snippet: string }): Promise<FetchedArticle> => {
    try {
      const text = await fetchPageText(r.url)
      return {
        title: r.title,
        url: r.url,
        content: text && text.length > 100 ? text : r.snippet,
      }
    } catch {
      return { title: r.title, url: r.url, content: r.snippet }
    }
  }

  const articles: FetchedArticle[] = []
  const first = await fetchOne(candidates[0])
  articles.push(first)
  debugLog(`  + Fetched [1]: ${candidates[0].title} (${first.content.length} chars)`)

  if (hasUsefulContent(first.content, 2000)) {
    debugLog('  Adaptive: first article sufficient, skipping rest')
    return articles
  }

  const remaining = candidates.slice(1)
  const settled = await Promise.allSettled(remaining.map((r) => fetchOne(r)))

  for (let i = 0; i < settled.length; i++) {
    const result = settled[i]
    if (result.status === 'fulfilled') {
      if (hasUsefulContent(result.value.content, minContentLength)) {
        articles.push(result.value)
        debugLog(`  + Fetched [${i + 2}]: ${remaining[i].title} (${result.value.content.length} chars)`)
      } else {
        debugLog(`  - Skipped [${i + 2}] (no useful content): ${remaining[i].title}`)
      }
    } else {
      articles.push({ title: remaining[i].title, url: remaining[i].url, content: remaining[i].snippet })
      debugLog(`  - Failed [${i + 2}], using snippet: ${remaining[i].title}`)
    }
  }

  return articles
}

export function buildArticleContext(
  articles: FetchedArticle[],
  query: string,
  wikiExtract?: string | null,
): string {
  const now = new Date()
  const systemLocale = Intl.DateTimeFormat().resolvedOptions()
  const todayStr = now.toLocaleDateString(systemLocale.locale, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: systemLocale.timeZone,
  })

  const parts = [
    `Today is ${todayStr}.`,
    `The following are ${articles.length} current articles/sources about "${query}".`,
    `Read each one and use the information to answer the user's question.`,
    '',
  ]

  if (wikiExtract) {
    parts.push('--- Background ---')
    parts.push(wikiExtract)
    parts.push('')
  }

  for (let i = 0; i < articles.length; i++) {
    const a = articles[i]
    parts.push(`--- Article ${i + 1}: ${a.title} ---`)
    parts.push(`Source: ${sourceFromUrl(a.url)}`)
    parts.push(a.content.slice(0, 3000))
    parts.push('')
  }

  if (isNewsQuery(query)) {
    parts.push('FORMAT INSTRUCTIONS:')
    parts.push(`Format the answer as exactly ${articles.length} terminal-friendly news cards; one card represents exactly one article.`)
    parts.push('Use this shape for every card:')
    parts.push('┌─ <category> · <source>')
    parts.push('│ Titular: <headline in the answer language>')
    parts.push('│ Resumen: <1-2 sentence summary with concrete facts>')
    parts.push('│ Inclinación: <izquierda|centro|derecha|no estimable>')
    parts.push('└─')
    parts.push('Every card MUST include all three labeled fields: Titular, Resumen, Inclinación.')
    parts.push('Bad format: a card with only two unlabeled lines.')
    parts.push('Estimate political inclination only when the article itself is about politics, public policy, parties, elections, government, courts, war, diplomacy, police, or social conflict.')
    parts.push('For health, entertainment, technology, education, weather, or general service stories, write "no estimable".')
    parts.push('Do NOT claim this is verified by an external rating service.')
    parts.push('')
  }

  parts.push('INSTRUCTIONS: You have all the information needed to answer. This data was fetched automatically from the web — the user did NOT provide it, so never say "the article you provided" or "based on what you shared". Summarize with specific details (names, scores, dates, numbers). Do NOT mention URLs unless the user explicitly asks for sources. DO NOT say you cannot access the internet. DO NOT tell the user to visit websites instead — give them the answer directly. Respond in the same language the user writes in.')

  return parts.join('\n')
}

export async function performSearch(query: string, originalTxt: string): Promise<SearchPipelineResult | null> {
  try {
    debugLog(`Router triggered webSearch for: "${query}"`)

    const cached = getCachedSearch(query)
    let searchCtx: SearchContext

    if (cached) {
      debugLog('Using cached search results')
      searchCtx = cached
    } else {
      searchCtx = await tools.web_search(query, isNewsQuery(query) ? 10 : 5)
      debugLog(`DDG returned ${searchCtx.results.length} results, extract: ${searchCtx.extract ? 'yes' : 'no'}`)

      if (searchCtx.results.length === 0 && !searchCtx.extract) {
        debugLog('No search results found')
        return null
      }

      setCachedSearch(query, searchCtx, 300)
    }

    debugLog(`Fetching top ${Math.min(searchCtx.results.length, 3)} pages (adaptive)...`)
    const candidates = isNewsQuery(query)
      ? diversifyResults(searchCtx.results, 2)
      : searchCtx.results

    const articles = await fetchArticlesAdaptive(candidates, {
      maxArticles: isNewsQuery(query) ? 10 : 3,
      minContentLength: 500,
    })
    debugLog(`Got ${articles.length} articles`)

    const contextMessage = buildArticleContext(articles, query, searchCtx.extract)
    debugLog(`Context message length: ${contextMessage.length} chars`)

    return { contextMessage, originalTxt }
  } catch (err) {
    debugLog(`Search pipeline error: ${err}`)
  }

  return null
}
