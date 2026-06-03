import { fetchPageText } from '../tools/web-fetch.js'
import { searchAndExtract } from '../tools/web-search.js'
import type { SearchContext } from '../tools/web-search.js'
import { routeQuery } from './router.js'
import { getCachedSearch, setCachedSearch } from '../memory/search-cache.js'
import { buildSportsContext } from '../tools/espn.js'
import type { ESPNScoreboard } from '../tools/espn.js'
import {
  extractPreferencesFromQuery,
  addPreference,
  buildPreferenceSavedMessage,
} from '../memory/preferences.js'
import { checkMemoryGate } from '../memory/memory-gate.js'
import { extractMemoriesFromMessage } from '../memory/memory-extractor.js'
import { buildSportsMemoryContext, buildGeneralMemoryContext } from '../memory/memory-retrieval.js'
import { getCurrentWeather, getWeatherByCity, type WeatherData } from '../tools/weather.js'
import { getDefaultClient, type ChatMessage } from './llm-client.js'
import { getNewsTopics } from '../memory/database.js'
import { getRegistry } from '../mcp/registry.js'
import type { OllamaToolFormat } from '../mcp/types.js'
import { loadConfig, DEFAULT_MODEL, DEFAULT_OLLAMA_URL } from '../config/index.js'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AgentResult {
  userContent: string
  searchContext: string | null
  statusMessage: string | null
  /** true when router returned 'none' — caller may run ReAct loop */
  useReAct?: boolean
  /** Pre-rendered ASCII table for sports results — display directly, bypass LLM rewrite */
  tableOutput?: string
  /** Current phase/stage of the tournament (e.g. "Clausura - Semifinals") */
  seasonPhase?: string
  /** Raw scoreboard data — used by TUI to build structured commentary prompt */
  scoreboard?: ESPNScoreboard
  /** True when query was primarily about news — TUI should skip scoreboard commentary */
  newsIntent?: boolean
  /** Number of ESPN articles that specifically matched the focus team */
  teamNewsCount?: number
  /** When set, display this text directly without streaming through LLM */
  directResponse?: string
  /** Articles from a news digest — enables "press 1-9 to read full" in TUI */
  digestArticles?: Array<{ position: number; title: string; url: string; source: string; category: string }>
}

interface FetchedArticle {
  title: string
  url: string
  content: string
}

interface SearchPipelineResult {
  contextMessage: string
  originalTxt: string
}

import { debugLog } from '../utils/debug.js'

export { debugLog }

// ─── Weather helpers ──────────────────────────────────────────────────────────

/**
 * Extract city name from a weather query using simple regex patterns.
 * Returns null if no city is mentioned (use IP geolocation instead).
 */
export function extractCityFromQuery(query: string): string | null {
  const patterns = [
    // "clima/tiempo/temperatura en <city>"
    /(?:clima|tiempo|temperatura|weather)\s+(?:en|de|para|in)\s+([A-Za-záéíóúüñÁÉÍÓÚÜÑ\s]+?)(?:\?|$|,|\s+hoy|\s+ahorita|\s+ahora)/i,
    // "<city> clima/tiempo/temperatura"
    /(?:en|de|para|in)\s+([A-Za-záéíóúüñÁÉÍÓÚÜÑ\s]+?)\s+(?:clima|tiempo|temperatura|weather)/i,
    // "hace calor/frío en <city>"
    /(?:hace\s+(?:calor|frío|frio)\s+en)\s+([A-Za-záéíóúüñÁÉÍÓÚÜÑ\s]+?)(?:\?|$|,)/i,
    // "lloverá/llovera/llueve/llover en <city>" or "va a llover en <city>"
    /(?:llov(?:er[áa]|er[eé]|e|iendo|er)\s+(?:en|hoy en|mañana en|esta noche en)|va\s+a\s+llover\s+en|habrá?\s+lluvia\s+en)\s+([A-Za-záéíóúüñÁÉÍÓÚÜÑ\s]+?)(?:\?|$|,)/i,
    // "hoy llovera en <city>" — hoy/mañana + precipitation verb + en
    /(?:hoy|mañana|esta\s+(?:noche|tarde|mañana))\s+(?:llov\w+|nev\w+|graniz\w+|lluve|llueve)\s+en\s+([A-Za-záéíóúüñÁÉÍÓÚÜÑ\s]+?)(?:\?|$|,)/i,
    // generic "en <city>" as last resort — only if query is clearly weather-related
    /(?:^|\s)en\s+([A-Za-záéíóúüñÁÉÍÓÚÜÑ][A-Za-záéíóúüñÁÉÍÓÚÜÑ\s]{2,})(?:\?|$|,)/i,
  ]

  for (const pattern of patterns) {
    const match = query.match(pattern)
    if (match) {
      const city = match[1].trim()
      if (city.length >= 3 && !/^(hoy|ahora|aqui|aquí|mi|la|el|un|una|esta|este)$/i.test(city)) {
        return city
      }
    }
  }
  return null
}

export function buildWeatherContext(weather: WeatherData): string {
  const sunriseStr = new Date(weather.sunrise * 1000).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
  const sunsetStr = new Date(weather.sunset * 1000).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
  const locationStr = weather.location
    ? `Ubicación detectada (IP): ${weather.location.city}, ${weather.location.region}`
    : `Ciudad consultada: ${weather.city_query}`

  return [
    `[DATOS REALES DEL CLIMA — obtenidos ahora mismo vía API]`,
    `Ciudad: ${weather.city_name}, ${weather.country}`,
    `Condición: ${weather.description}`,
    `Temperatura: ${weather.temp}°C (sensación térmica ${weather.feels_like}°C)`,
    `Humedad: ${weather.humidity}%`,
    `Presión: ${weather.pressure} hPa`,
    `Viento: ${weather.wind_speed} m/s`,
    `Visibilidad: ${(weather.visibility / 1000).toFixed(1)} km`,
    `Nubosidad: ${weather.clouds}%`,
    `Amanecer: ${sunriseStr} / Atardecer: ${sunsetStr}`,
    locationStr,
    ``,
    `Con estos datos reales responde la pregunta del usuario de forma natural y conversacional. NO digas que no tienes acceso a internet — estos datos son reales y actuales.`,
  ].join('\n')
}

// ─── Search helpers ───────────────────────────────────────────────────────────

/**
 * Returns true if the fetched text looks like real content
 * (not a CAPTCHA page, error page, or empty result).
 */
function hasUsefulContent(text: string, minLength: number): boolean {
  if (text.length < minLength) return false
  // Common indicators of useless content
  const noise = [
    /captcha/i,
    /access denied/i,
    /403 forbidden/i,
    /please enable javascript/i,
    /browser.*not supported/i,
  ]
  return !noise.some((p) => p.test(text))
}

/**
 * Adaptive fetch strategy:
 * - Always fetch the first result
 * - If it has enough content (>2000 chars), stop there
 * - Otherwise fetch next 2 in parallel
 * - Wikipedia extract counts as content
 */
async function fetchArticlesAdaptive(
  results: { title: string; url: string; snippet: string }[],
  options?: {
    maxArticles?: number
    minContentLength?: number
    timeoutMs?: number
  },
): Promise<FetchedArticle[]> {
  const maxArticles = options?.maxArticles ?? 3
  const minContentLength = options?.minContentLength ?? 500
  const wikiExtractPresent = false // caller checks this separately

  const candidates = results.slice(0, maxArticles)
  if (candidates.length === 0) return []

  const fetchOne = async (r: { title: string; url: string; snippet: string }, signal?: AbortSignal): Promise<FetchedArticle> => {
    try {
      const text = await fetchPageText(r.url, { signal })
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

  // Fetch first article
  const first = await fetchOne(candidates[0])
  articles.push(first)
  debugLog(`  + Fetched [1]: ${candidates[0].title} (${first.content.length} chars)`)

  // If first article has sufficient content and wiki extract isn't needed, we're done
  if (hasUsefulContent(first.content, 2000) && !wikiExtractPresent) {
    debugLog('  Adaptive: first article sufficient, skipping rest')
    return articles
  }

  // Fetch remaining candidates (up to maxArticles-1) in parallel
  const remaining = candidates.slice(1)
  if (remaining.length === 0) return articles

  const settled = await Promise.allSettled(
    remaining.map((r) => fetchOne(r)),
  )

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
    parts.push(`Source: ${a.url}`)
    parts.push(a.content.slice(0, 3000))
    parts.push('')
  }

  parts.push('INSTRUCTIONS: You have all the information needed to answer. This data was fetched automatically from the web — the user did NOT provide it, so never say "the article you provided" or "based on what you shared". Summarize with specific details (names, scores, dates, numbers). Do NOT mention source names or URLs unless the user explicitly asks for sources. DO NOT say you cannot access the internet. DO NOT tell the user to visit websites instead — give them the answer directly. Respond in the same language the user writes in.')

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
      searchCtx = await searchAndExtract(query)
      debugLog(`DDG returned ${searchCtx.results.length} results, extract: ${searchCtx.extract ? 'yes' : 'no'}`)

      if (searchCtx.results.length === 0 && !searchCtx.extract) {
        debugLog('No search results found')
        return null
      }

      setCachedSearch(query, searchCtx, 300)
    }

    debugLog(`Fetching top ${Math.min(searchCtx.results.length, 3)} pages (adaptive)...`)
    const articles = await fetchArticlesAdaptive(searchCtx.results, {
      maxArticles: 3,
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

// ─── Main entry point ─────────────────────────────────────────────────────────

/**
 * Process a user query through the routing + tool pipeline.
 * Returns userContent (to send to LLM), optional searchContext (system message),
 * and optional statusMessage (for TUI display while loading).
 *
 * Pure logic — no React state is touched here.
 * onStatus callback is called immediately when a loading status is known,
 * before the async work begins (allows TUI to show status mid-processing).
 */
export async function processQuery(
  query: string,
  isExplicitSearch?: boolean,
  onStatus?: (msg: string) => void,
): Promise<AgentResult> {
  const searchQuery = isExplicitSearch
    ? query.replace(/^\/search\s+/i, '').trim()
    : query

  if (isExplicitSearch) {
    onStatus?.('Searching the web...')
    const result = await performSearch(searchQuery, query)
    return {
      userContent: result ? searchQuery : query,
      searchContext: result?.contextMessage ?? null,
      statusMessage: 'Searching the web...',
    }
  }

  const routerResult = await routeQuery(query)
  const { decision } = routerResult
  debugLog(`Router decision: ${decision} (source: ${routerResult.source}, confidence: ${routerResult.confidence})`)

  // ── Background memory extraction ──────────────────────────────────────────
  // Fire-and-forget: check gate first (free), then run LLM extractor only if
  // gate passes. Never awaited — must not block or throw into the main flow.
  if (decision !== 'savePreference') {
    const gateResult = checkMemoryGate(query)
    if (gateResult.shouldExtract) {
      extractMemoriesFromMessage(query, gateResult.hints).catch(() => {/* silent */})
    }
  }

  if (decision === 'getDateTime') {
    const now = new Date()
    const t = {
      iso: now.toISOString(),
      time: now.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }),
      date: now.toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' }),
      day: now.toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' }),
    }
    return {
      userContent: `Current time: ${t.time}, date: ${t.date}. User asked: "${query}". Answer naturally.`,
      searchContext: null,
      statusMessage: null,
    }
  }

  if (decision === 'getWeather') {
    onStatus?.('Obteniendo clima...')
    try {
      const city = extractCityFromQuery(query)
      debugLog(`Weather query — city extracted: ${city ?? '(none, using IP location)'}`)
      const weather = city
        ? await getWeatherByCity(city)
        : await getCurrentWeather()
      const ctx = buildWeatherContext(weather)
      return {
        userContent: `${ctx}\n\nPregunta del usuario: ${query}`,
        searchContext: null,
        statusMessage: 'Obteniendo clima...',
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      return {
        userContent: `No se pudo obtener el clima: ${errMsg}. Informa al usuario de forma amable.`,
        searchContext: null,
        statusMessage: 'Obteniendo clima...',
      }
    }
  }

  if (decision === 'savePreference') {
    const extracted = extractPreferencesFromQuery(query)
    if (extracted.length > 0) {
      for (const p of extracted) {
        addPreference(p.category, p.value, p.label)
        debugLog(`Saved preference: ${p.category}=${p.value}`)
      }
      const msg = buildPreferenceSavedMessage(extracted)
      return {
        userContent: query,
        searchContext: null,
        statusMessage: null,
        directResponse: msg,
      }
    }
    // Couldn't extract specifics — fall through to LLM
  }

  if (decision === 'sportsQuery') {
    onStatus?.('Consultando resultados deportivos...')
    const sportsResult = await buildSportsContext(query)
    if (sportsResult) {
      const memCtx = buildSportsMemoryContext()
      let llmContext = memCtx
        ? `${memCtx}\n\n${sportsResult.llmContext}`
        : sportsResult.llmContext

      // If news intent but ESPN returned < 2 team-specific articles, supplement with webSearch
      if (sportsResult.newsIntent && (sportsResult.teamNewsCount ?? 0) < 2) {
        const webQuery = sportsResult.focusTeamName
          ? `noticias ${sportsResult.focusTeamName} futbol`
          : query
        debugLog(`[agent] ESPN news thin (${sportsResult.teamNewsCount ?? 0}) — supplementing with webSearch: "${webQuery}"`)
        onStatus?.('Buscando noticias en la web...')
        const webResult = await performSearch(webQuery, query)
        if (webResult) {
          llmContext = `${llmContext}\n\n--- Noticias adicionales (web) ---\n${webResult.contextMessage}`
          debugLog(`[agent] webSearch supplement added (${webResult.contextMessage.length} chars)`)
        }
      }

      return {
        userContent: query,
        searchContext: llmContext,
        statusMessage: 'Consultando resultados deportivos...',
        tableOutput: sportsResult.tableOutput,
        seasonPhase: sportsResult.seasonPhase,
        scoreboard: sportsResult.scoreboard,
        newsIntent: sportsResult.newsIntent,
        teamNewsCount: sportsResult.teamNewsCount,
      }
    }

    // buildSportsContext returned null — league not detected in query.
    // Check memory: if user has a saved team/league, retry with that context.
    const memCtx = buildSportsMemoryContext()
    if (memCtx) {
      debugLog(`ESPN league not detected in query — retrying with memory context: ${memCtx.slice(0, 80)}`)
      // Extract team/league values from memory context and append to query
      // e.g. "[User context]\n- preference: atlas, liga mx" → "atlas liga mx"
      const memValues = memCtx
        .split('\n')
        .filter((l) => l.startsWith('- '))
        .map((l) => l.replace(/^- \w+:\s*/, ''))
        .join(' ')
      const enrichedQuery = `${query} ${memValues}`
      debugLog(`enriched query: "${enrichedQuery}"`)
      const retryResult = await buildSportsContext(enrichedQuery)
      if (retryResult) {
        const llmContext = `${memCtx}\n\n${retryResult.llmContext}`
        return {
          userContent: query,
          searchContext: llmContext,
          statusMessage: 'Consultando resultados deportivos...',
          tableOutput: retryResult.tableOutput,
          seasonPhase: retryResult.seasonPhase,
          scoreboard: retryResult.scoreboard,
          newsIntent: retryResult.newsIntent,
          teamNewsCount: retryResult.teamNewsCount,
        }
      }
      debugLog(`ESPN retry also failed — falling back to webSearch with enriched query`)
    }

    // League not recognized even after memory enrichment — fall back to web search
    // Use enriched query if we have memory to avoid "Microsoft Teams" type confusion
    const searchQuery = memCtx
      ? `${query} ${memCtx.split('\n').filter(l => l.startsWith('- ')).map(l => l.replace(/^- \w+:\s*/, '')).join(' ')}`
      : query
    const result = await performSearch(searchQuery, query)
    return {
      userContent: query,
      searchContext: result?.contextMessage ?? null,
      statusMessage: 'Consultando resultados deportivos...',
    }
  }

  if (decision === 'webSearch') {
    onStatus?.('Searching the web...')
    try {
      const result = await performSearch(searchQuery, query)
      return {
        userContent: query,
        searchContext: result?.contextMessage ?? null,
        statusMessage: 'Searching the web...',
      }
    } catch {
      return {
        userContent: `${query}\n\n[Note: Web search failed due to a network error. Answer from your knowledge and mention you could not verify current information.]`,
        searchContext: null,
        statusMessage: 'Searching the web...',
      }
    }
  }

  if (decision === 'mexicoNewsDigest' || decision === 'newsDigest') {
    const topicName = extractNewsTopic(query)
    try {
      const { buildTopicNewsDigest, buildAllTopicsDigest } = await import('../tools/mexico-news.js')

      if (topicName) {
        onStatus?.(`Obteniendo noticias de ${topicName}...`)
        const digest = await buildTopicNewsDigest(topicName, query)
        return {
          userContent: query,
          searchContext: null,
          statusMessage: `Obteniendo noticias de ${topicName}...`,
          directResponse: digest.formatted,
          digestArticles: digest.articles,
        }
      }

      // No specific topic detected — show all topics
      onStatus?.('Obteniendo noticias de todos los temas...')
      const digest = await buildAllTopicsDigest()
      return {
        userContent: query,
        searchContext: null,
        statusMessage: 'Obteniendo noticias de todos los temas...',
        directResponse: digest.formatted,
        digestArticles: digest.articles,
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return {
        userContent: query,
        searchContext: null,
        statusMessage: 'Obteniendo noticias...',
        directResponse: `No se pudo obtener el digest de noticias: ${msg}`,
      }
    }
  }

// ─── News topic extraction ─────────────────────────────────────────────────

/**
 * Extract a news topic name from a user query.
 * Returns null when no specific topic is mentioned — caller should show all topics.
 */
function extractNewsTopic(query: string): string | null {
  const topics = getNewsTopics()
  if (topics.length === 0) return null

  const normalized = query.toLowerCase().trim()

  // Check topic names first
  for (const topic of topics) {
    const topicName = topic.name.toLowerCase()
    if (normalized.includes(topicName)) {
      return topic.name
    }
  }

  // Check topic keywords
  for (const topic of topics) {
    const keywords: string[] = JSON.parse(topic.keywords)
    for (const kw of keywords) {
      if (normalized.includes(kw.toLowerCase())) {
        return topic.name
      }
    }
  }

  // No specific topic detected
  return null
}

  // decision === 'none' — answer directly from LLM knowledge (or via ReAct)
  return {
    userContent: query,
    searchContext: null,
    statusMessage: null,
    useReAct: true,
  }
}

// ─── ReAct loop ───────────────────────────────────────────────────────────────

const REACT_SYSTEM_PROMPT = `You are Null, a knowledgeable AI assistant running in a terminal.
You have access to tools that you can call to help answer the user.
When you need information, call the appropriate tool.
When you have enough information to answer the user, respond directly.
Answer in the same language the user writes in.
NEVER say you cannot access the internet — use the available tools to get current information.`

export interface ReActResult {
  /** Final answer text from LLM */
  answer: string
  /** Number of tool iterations performed */
  iterations: number
}

/**
 * ReAct loop: Reasoning + Acting.
 * Gives the LLM access to tools through structured JSON output.
 * Loops up to maxIterations times; each iteration the LLM either calls a
 * tool (JSON) or produces a final answer (plain text).
 *
 * @param query - User query
 * @param history - Prior conversation messages (role/content pairs)
 * @param onStatus - Optional callback fired with status text each iteration
 * @param onToolCall - Optional callback fired when a tool is about to execute
 * @param maxIterations - Max tool-call iterations (default: 3)
 */
// ─── MCP tool-enabled Ollama call ─────────────────────────────────────────

interface ReactCallResult {
  content: string
  toolCalls?: Array<{ name: string; arguments: Record<string, unknown> }>
}

/**
 * Non-streaming Ollama call with the `tools` parameter.
 * Returns structured content + optional tool calls from the LLM.
 */
async function reactCall(
  messages: { role: string; content: string }[],
  tools: OllamaToolFormat[],
  temperature?: number,
): Promise<ReactCallResult> {
  const config = loadConfig()
  const baseUrl = config.ollamaUrl ?? DEFAULT_OLLAMA_URL
  const model = config.model ?? DEFAULT_MODEL

  const body: Record<string, unknown> = {
    model,
    stream: false,
    messages: messages.map(m => ({ role: m.role, content: m.content })),
    tools,
    options: temperature !== undefined ? { temperature } : undefined,
  }

  const res = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    throw new Error(`Ollama request failed: ${res.status}`)
  }

  const data = await res.json() as {
    message?: {
      content?: string
      tool_calls?: Array<{
        function: { name: string; arguments: string }
      }>
    }
  }

  const content = data.message?.content ?? ''

  if (data.message?.tool_calls && data.message.tool_calls.length > 0) {
    return {
      content,
      toolCalls: data.message.tool_calls.map(tc => ({
        name: tc.function.name,
        arguments: JSON.parse(tc.function.arguments),
      })),
    }
  }

  return { content }
}

/**
 * Detect whether a query is primarily Spanish or English.
 * Returns a language label suitable for injecting into prompts.
 */
function detectQueryLanguage(text: string): string {
  const spanishSignals = /\b(que|qué|cómo|como|cuándo|cuando|dónde|donde|quién|quien|es|son|está|están|tiene|tienen|hoy|mañana|puedes|puedo|dame|dime|sabes|lloverá|llovera|clima|tiempo|gracias|por favor|porfa)\b/i
  return spanishSignals.test(text) ? 'Spanish' : 'English'
}

/**
 * Returns true if the LLM response signals that it lacks specific knowledge
 * and would benefit from a web search.
 */
function looksUncertain(text: string): boolean {
  const signals = [
    /\bneed more (specific|detail|info)/i,
    /\bcould you (please )?(specify|clarify|tell me more)/i,
    /\bI('m| am) not (sure|certain|aware)/i,
    /\bI don'?t have (specific|detailed|current|recent|enough)/i,
    /\bI (don'?t|cannot|can'?t) (find|confirm|verify|access)/i,
    /\bno (specific|detailed) information/i,
    /\bappears to be\b.*\bbut I (need|don'?t have)/i,
    /\bplease (provide|give me|share) more/i,
    /\bwhich (episode|aspect|part|season)/i,
    /\bcould you (elaborate|describe|explain)/i,
    /\bI('m| am) (unfamiliar|not familiar)/i,
    /\bmy knowledge (is limited|doesn'?t include|may not)/i,
  ]
  return signals.some((re) => re.test(text))
}

export async function processQueryWithReAct(
  query: string,
  history: { role: string; content: string }[] = [],
  onStatus?: (msg: string) => void,
  onToolCall?: (toolName: string) => void,
  maxIterations = 3,
): Promise<ReActResult> {
  const client = getDefaultClient()
  const registry = getRegistry()
  const lang = detectQueryLanguage(query)
  const langInstruction = `IMPORTANT: Respond in ${lang}. The user wrote in ${lang} — always reply in ${lang} regardless of the language of the source material.`

  debugLog(`ReAct history length: ${history.length} messages`)
  history.forEach((m, i) => debugLog(`  [${i}] ${m.role}: ${m.content.slice(0, 60)}`))

  // Get tool schemas from MCP registry for the Ollama tools parameter
  const ollamaTools = registry.getOllamaTools()
  debugLog(`[agent] ReAct using ${ollamaTools.length} tools from registry`)

  // Inject memory context into system prompt if available
  const memCtx = buildGeneralMemoryContext(query)
  const systemPrompt = memCtx
    ? `${REACT_SYSTEM_PROMPT}\n\n${memCtx}`
    : REACT_SYSTEM_PROMPT
  if (memCtx) debugLog(`[agent] injected memory context:\n${memCtx}`)

  // Build message list: system + prior history + current user query
  const messages: { role: string; content: string }[] = [
    { role: 'system', content: systemPrompt },
    ...history.map((m) => ({
      role: m.role as 'system' | 'user' | 'assistant',
      content: m.content,
    })),
    { role: 'user', content: query },
  ]

  let hasExternalData = false

  for (let i = 0; i < maxIterations; i++) {
    debugLog(`ReAct iteration ${i + 1}/${maxIterations}`)

    // Use lower temperature when grounding on external tool data
    const temperature = hasExternalData ? 0.3 : undefined

    const response = await reactCall(messages, ollamaTools, temperature)
    const fullContent = response.content
    const toolCalls = response.toolCalls

    debugLog(`ReAct LLM response: ${fullContent.slice(0, 100)}...${toolCalls ? ` (${toolCalls.length} tool calls)` : ' (text)'}`)

    if (!toolCalls || toolCalls.length === 0) {
      // LLM produced a text response — check for uncertainty on first pass
      if (i === 0 && looksUncertain(fullContent)) {
        debugLog('ReAct: LLM uncertain on first pass — forcing web_search')
        onStatus?.('Searching the web...')
        onToolCall?.('web_search')
        let searchObservation: string
        try {
          const searchResult = await registry.executeTool('web_search', { query })
          searchObservation = typeof searchResult === 'string'
            ? searchResult
            : JSON.stringify(searchResult, null, 2)
        } catch (err) {
          searchObservation = `Search failed: ${err instanceof Error ? err.message : String(err)}`
        }
        messages.push({ role: 'assistant', content: fullContent })
        messages.push({
          role: 'user',
          content: `[Web search results for "${query}"]\n${searchObservation}\n\nNow answer the user's original question using the above data. Be specific and detailed.\n${langInstruction}`,
        })
        hasExternalData = true
        continue
      }
      // Final answer
      debugLog(`ReAct final answer after ${i + 1} iteration(s)`)
      return { answer: fullContent, iterations: i + 1 }
    }

    // LLM wants to use one or more tools
    for (const tc of toolCalls) {
      const toolName = tc.name
      debugLog(`ReAct tool call: ${toolName}`)
      onToolCall?.(toolName)

      const statusLabels: Record<string, string> = {
        get_time: 'Getting time...',
        get_weather: 'Getting weather...',
        web_search: 'Searching the web...',
        web_fetch: 'Fetching page...',
        get_location: 'Getting location...',
        news_digest: 'Fetching news...',
        news_manage_topics: 'Managing topics...',
      }
      onStatus?.(statusLabels[toolName] ?? `Running ${toolName}...`)

      let observation: string
      try {
        const result = await registry.executeTool(toolName, tc.arguments)
        observation = typeof result === 'string'
          ? result
          : JSON.stringify(result, null, 2)
        debugLog(`ReAct tool result (${toolName}): ${observation.slice(0, 200)}`)
      } catch (err) {
        observation = `Error executing ${toolName}: ${err instanceof Error ? err.message : String(err)}`
        debugLog(`ReAct tool error: ${observation}`)
      }

      // Add the assistant's response + the tool result to the message thread
      messages.push({ role: 'assistant', content: fullContent || `[Calling tool: ${toolName}]` })
      messages.push({
        role: 'user',
        content: `[Tool result for ${toolName}]\n${observation}\n\nNow answer the user's original question using the above data.\n${langInstruction}`,
      })
      hasExternalData = true
    }
  }

  // Exhausted iterations — ask LLM to produce a final answer with whatever it has
  debugLog('ReAct: max iterations reached, requesting final answer')
  onStatus?.('Composing answer...')
  messages.push({
    role: 'user',
    content: `Please provide your final answer now based on the information collected so far.\n${langInstruction}`,
  })

  let finalAnswer = ''
  await client.streamChat(messages as ChatMessage[], (tok: string) => {
    finalAnswer += tok
  }, hasExternalData ? { temperature: 0.3 } : undefined)

  return { answer: finalAnswer, iterations: maxIterations }
}
