import { tools } from './tools.js'
import { fetchPageText } from '../tools/web-fetch.js'
import { routeQuery } from './router.js'
import { getCachedSearch, setCachedSearch } from '../memory/search-cache.js'
import type { SearchContext } from '../tools/web-search.js'
import {
  getScoreboard,
  detectLeague,
  detectDateRange,
  detectDateIntent,
  hasExplicitDateRange,
  getLastMatchdayRange,
  formatScoreboardContext,
} from '../tools/espn.js'
import { getCurrentWeather, getWeatherByCity, type WeatherData } from '../tools/weather.js'
import { getDefaultClient } from './llm-client.js'
import type { ToolAction } from './toolAction.js'
import { executeAction } from './execute.js'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AgentResult {
  userContent: string
  searchContext: string | null
  statusMessage: string | null
  /** true when router returned 'none' — caller may run ReAct loop */
  useReAct?: boolean
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

// ─── Debug ────────────────────────────────────────────────────────────────────

export function debugLog(msg: string): void {
  process.stderr.write(`[null-debug] ${msg}\n`)
}

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
  debugLog(`  ✓ Fetched [1]: ${candidates[0].title} (${first.content.length} chars)`)

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
        debugLog(`  ✓ Fetched [${i + 2}]: ${remaining[i].title} (${result.value.content.length} chars)`)
      } else {
        debugLog(`  ✗ Skipped [${i + 2}] (no useful content): ${remaining[i].title}`)
      }
    } else {
      articles.push({ title: remaining[i].title, url: remaining[i].url, content: remaining[i].snippet })
      debugLog(`  ✗ Failed [${i + 2}], using snippet: ${remaining[i].title}`)
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

  parts.push('INSTRUCTIONS: You have all the information needed to answer. Summarize each article with specific details (names, scores, dates, numbers). Include source URLs. DO NOT say you cannot access the internet. DO NOT tell the user to visit websites instead — give them the answer directly. Respond in the same language the user writes in.')

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
      searchCtx = await tools.web_search(query)
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

// ─── Sports helpers ───────────────────────────────────────────────────────────

export async function performSportsQuery(query: string): Promise<string | null> {
  const leagueSlug = detectLeague(query)
  if (!leagueSlug) {
    debugLog('No league detected — falling back to webSearch')
    return null
  }

  const intent = detectDateIntent(query)
  const hasExplicit = hasExplicitDateRange(query)

  try {
    if (intent === 'lastMatchday' || !hasExplicit) {
      debugLog(`Sports query: league=${leagueSlug}, intent=${intent === 'lastMatchday' ? 'lastMatchday' : 'auto-lastMatchday'}`)
      const range = await getLastMatchdayRange(leagueSlug)
      debugLog(`Last matchday range: ${range.from.toISOString().slice(0, 10)} to ${range.to.toISOString().slice(0, 10)}`)
      const scoreboard = await getScoreboard(leagueSlug, range)
      debugLog(`ESPN returned ${scoreboard.games.length} games`)
      return formatScoreboardContext(scoreboard, scoreboard.effectiveRange)
    }

    const explicitRange = detectDateRange(query)
    debugLog(`Sports query: league=${leagueSlug}, range=${explicitRange.from.toISOString().slice(0, 10)} to ${explicitRange.to.toISOString().slice(0, 10)}`)

    const scoreboard = await getScoreboard(leagueSlug, explicitRange)
    debugLog(`ESPN returned ${scoreboard.games.length} games`)
    return formatScoreboardContext(scoreboard, scoreboard.effectiveRange)
  } catch (err) {
    debugLog(`ESPN API error: ${err}`)
    return null
  }
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
    onStatus?.('🔍 Searching the web...')
    const result = await performSearch(searchQuery, query)
    return {
      userContent: result ? searchQuery : query,
      searchContext: result?.contextMessage ?? null,
      statusMessage: '🔍 Searching the web...',
    }
  }

  const routerResult = await routeQuery(query)
  const { decision } = routerResult
  debugLog(`Router decision: ${decision} (source: ${routerResult.source}, confidence: ${routerResult.confidence})`)

  if (decision === 'getDateTime') {
    const t = tools.get_time()
    return {
      userContent: `Current time: ${t.time}, date: ${t.date}. User asked: "${query}". Answer naturally.`,
      searchContext: null,
      statusMessage: null,
    }
  }

  if (decision === 'getWeather') {
    onStatus?.('🌤 Obteniendo clima...')
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
        statusMessage: '🌤 Obteniendo clima...',
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      return {
        userContent: `No se pudo obtener el clima: ${errMsg}. Informa al usuario de forma amable.`,
        searchContext: null,
        statusMessage: '🌤 Obteniendo clima...',
      }
    }
  }

  if (decision === 'sportsQuery') {
    onStatus?.('⚽ Consultando resultados deportivos...')
    const sportsCtx = await performSportsQuery(query)
    if (sportsCtx) {
      return {
        userContent: query,
        searchContext: sportsCtx,
        statusMessage: '⚽ Consultando resultados deportivos...',
      }
    }
    // League not recognized — fall back to web search
    const result = await performSearch(query, query)
    return {
      userContent: query,
      searchContext: result?.contextMessage ?? null,
      statusMessage: '⚽ Consultando resultados deportivos...',
    }
  }

  if (decision === 'webSearch') {
    onStatus?.('🔍 Searching the web...')
    try {
      const result = await performSearch(searchQuery, query)
      return {
        userContent: query,
        searchContext: result?.contextMessage ?? null,
        statusMessage: '🔍 Searching the web...',
      }
    } catch {
      return {
        userContent: `${query}\n\n[Note: Web search failed due to a network error. Answer from your knowledge and mention you could not verify current information.]`,
        searchContext: null,
        statusMessage: '🔍 Searching the web...',
      }
    }
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
You have access to the following tools. When you need to use a tool, respond ONLY with a JSON block (no other text):

\`\`\`json
{"action": "<tool_name>", ...params}
\`\`\`

Available tools:
- get_time: No params. Get current time and date.
- get_weather: Optional {"city": "string"}. Get weather. Omit city to use IP location.
- web_search: {"query": "string"}. Search the web for current info.
- web_fetch: {"url": "string"}. Fetch readable text from a URL.
- get_location: No params. Get current location via IP.

When you have enough information to answer, respond normally (no JSON).
Answer in the same language the user writes in.
NEVER say you cannot access the internet — use the tools provided.`

/**
 * Parse a JSON tool call from LLM output.
 * Looks for a ```json ... ``` block or a bare top-level JSON object with an "action" key.
 * Returns null if the text is a normal (non-tool) response.
 */
export function parseMaybeToolCall(text: string): ToolAction | null {
  // Try ```json ... ``` block first
  const blockMatch = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/)
  if (blockMatch) {
    try {
      const parsed: unknown = JSON.parse(blockMatch[1])
      if (isToolAction(parsed)) return parsed
    } catch {
      // not valid JSON
    }
  }

  // Try any JSON object containing "action" key anywhere in the text
  const jsonMatch = text.match(/\{[^{}]*"action"\s*:\s*"[^"]+?"[^{}]*\}/)
  if (jsonMatch) {
    try {
      const parsed: unknown = JSON.parse(jsonMatch[0])
      if (isToolAction(parsed)) return parsed
    } catch {
      // not valid JSON
    }
  }

  // Try bare JSON object covering most of the response
  const trimmed = text.trim()
  if (trimmed.startsWith('{')) {
    const end = trimmed.lastIndexOf('}')
    if (end !== -1) {
      try {
        const parsed: unknown = JSON.parse(trimmed.slice(0, end + 1))
        if (isToolAction(parsed)) return parsed
      } catch {
        // not valid JSON
      }
    }
  }

  return null
}

function isToolAction(value: unknown): value is ToolAction {
  if (typeof value !== 'object' || value === null) return false
  const obj = value as Record<string, unknown>
  const validActions = ['get_time', 'get_location', 'get_weather', 'web_search', 'web_fetch', 'sports_query']
  return typeof obj['action'] === 'string' && validActions.includes(obj['action'])
}

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
  const lang = detectQueryLanguage(query)
  const langInstruction = `IMPORTANT: Respond in ${lang}. The user wrote in ${lang} — always reply in ${lang} regardless of the language of the source material.`

  // Build message list: system + prior history + current user query
  const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
    { role: 'system', content: REACT_SYSTEM_PROMPT },
    ...history.map((m) => ({
      role: m.role as 'system' | 'user' | 'assistant',
      content: m.content,
    })),
    { role: 'user', content: query },
  ]

  for (let i = 0; i < maxIterations; i++) {
    debugLog(`ReAct iteration ${i + 1}/${maxIterations}`)

    // Non-streaming call so we can inspect the full response before acting
    let fullResponse = ''
    await client.streamChat(messages, (tok) => {
      fullResponse += tok
    })

    debugLog(`ReAct LLM response: ${fullResponse.slice(0, 120)}...`)

    const toolCall = parseMaybeToolCall(fullResponse)

    if (!toolCall) {
      // Check if the LLM expressed uncertainty on the first iteration —
      // if so, force a web_search rather than returning a vague answer.
      if (i === 0 && looksUncertain(fullResponse)) {
        debugLog('ReAct: LLM uncertain on first pass — forcing web_search')
        onStatus?.('🔍 Searching the web...')
        onToolCall?.('web_search')
        let searchObservation: string
        try {
          const searchResult = await performSearch(query, query)
          searchObservation = searchResult?.contextMessage ?? 'No results found.'
        } catch (err) {
          searchObservation = `Search failed: ${err instanceof Error ? err.message : String(err)}`
        }
        messages.push({ role: 'assistant', content: fullResponse })
        messages.push({
          role: 'user',
          content: `[Web search results for "${query}"]\n${searchObservation}\n\nNow answer the user's original question using the above data. Be specific and detailed.\n${langInstruction}`,
        })
        continue
      }
      // LLM produced a confident final answer
      debugLog(`ReAct final answer after ${i + 1} iteration(s)`)
      return { answer: fullResponse, iterations: i + 1 }
    }

    // LLM wants to use a tool
    const toolName = toolCall.action
    debugLog(`ReAct tool call: ${toolName}`)
    onToolCall?.(toolName)

    const statusLabels: Record<string, string> = {
      get_time: '🕐 Getting time...',
      get_weather: '🌤 Getting weather...',
      web_search: '🔍 Searching the web...',
      web_fetch: '🌐 Fetching page...',
      get_location: '📍 Getting location...',
      sports_query: '⚽ Fetching sports data...',
    }
    onStatus?.(statusLabels[toolName] ?? `🔧 Running ${toolName}...`)

    let observation: string
    try {
      const result = await executeAction(toolCall)
      observation = JSON.stringify(result, null, 2)
      debugLog(`ReAct tool result (${toolName}): ${observation.slice(0, 200)}`)
    } catch (err) {
      observation = `Error executing ${toolName}: ${err instanceof Error ? err.message : String(err)}`
      debugLog(`ReAct tool error: ${observation}`)
    }

    // Add the assistant's tool call + the observation to the message thread
    messages.push({ role: 'assistant', content: fullResponse })
    messages.push({
      role: 'user',
      content: `[Tool result for ${toolName}]\n${observation}\n\nNow answer the user's original question using the above data.\n${langInstruction}`,
    })
  }

  // Exhausted iterations — ask LLM to produce a final answer with whatever it has
  debugLog('ReAct: max iterations reached, requesting final answer')
  onStatus?.('💭 Composing answer...')
  messages.push({
    role: 'user',
    content: `Please provide your final answer now based on the information collected so far.\n${langInstruction}`,
  })

  let finalAnswer = ''
  await client.streamChat(messages, (tok) => {
    finalAnswer += tok
  })

  return { answer: finalAnswer, iterations: maxIterations }
}
