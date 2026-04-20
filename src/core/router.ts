import { normalizeQuery } from '../utils/normalize.js'

const ROUTER_SYSTEM_PROMPT = `You are a strict tool router.
Your job is to classify the user query into exactly one of three options.

Available tools:
- webSearch: use ONLY when the query requires information from after September 2023, real-time data (prices, weather, scores), or unknown entities.
- getDateTime: use ONLY when the user explicitly asks for the current date or time.
- none: use for general knowledge, programming, history, science, math, reasoning, jokes, and conversation.

Rules:
- Historical facts, science, math, geography → always "none"
- Jokes, wordplay, riddles, conversational messages → always "none"  
- Reasoning verifiable internally (anagrams, palindromes, math) → always "none"
- Programming questions, code generation, tutorials → always "none"
- Your knowledge cutoff is September 2023. Anything after that → "webSearch"
- Only use "webSearch" if you are confident the information changes frequently or postdates your knowledge

Respond ONLY with valid JSON. No text before or after.
{ "tool": "webSearch" | "getDateTime" | "none", "confidence": number }`.trim()

const MODEL = 'qwen2.5-coder:7b'

export type RoutingDecision = 'webSearch' | 'getDateTime' | 'sportsQuery' | 'none'

export interface RouterResult {
  decision: RoutingDecision
  confidence: number
  source: 'heuristic' | 'llm'
}

interface OllamaChatResponse {
  message?: { content?: string }
}

async function chat(messages: { role: string; content: string }[], systemPrompt: string): Promise<string> {
  const body = {
    model: MODEL,
    stream: false,
    messages: [{ role: 'system', content: systemPrompt }, ...messages],
  }

  const res = await fetch('http://localhost:11434/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    throw new Error(`Ollama chat failed: ${res.status}`)
  }

  const data = await res.json() as OllamaChatResponse
  return data.message?.content || ''
}

// Heurísticas a implementar (corren ANTES del LLM)
// Fuerza NONE — nunca buscar esto (general knowledge, history, programming, science)
const FORCE_NONE_PATTERNS = [
  // Programming / technical
  /\b(function|clase|class|array|loop|recursion|recursiva|algoritmo|algorithm)\b/i,
  /\b(hola mundo|hello world)\b/i,
  /\b(code|syntax|compile|debug|variable|method)\b/i,
  /(?:^|\s)(código|compilar|método)(?:\s|$)/i,
  // Science / math / geography (use (?:^|\s) for accented words)
  /\b(teorema|theorem)\b/i,
  /(?:^|\s)(ecuación|equation|fórmula|formula|derivada|integral)(?:\s|$)/i,
  /\b(ley de newton|law of|gravedad|gravity)\b/i,
  /(?:^|\s)(evolución|evolution|relatividad|relativity)(?:\s|$)/i,
  /\b(capital de|capital of|continente|continent)\b/i,
  /(?:^|\s)(océano|ocean|montaña|mountain)(?:\s|$)/i,
  /(?:^|\s)(tabla periódica|periodic table|elemento químico|chemical element)(?:\s|$)/i,
  /(?:^|\s)(cuántos|how many|cuánto mide|how tall|cuánto pesa|how much does)(?:\s).*\b(planeta|planet|país|country|estado|state)\b/i,
]

// Patterns that indicate a knowledge/history question (not needing search)
// Only apply if the query does NOT also match FORCE_SEARCH_PATTERNS
// Note: use (?:^|\s) instead of \b for accented words (JS \b doesn't support Unicode)
const KNOWLEDGE_QUESTION_PATTERNS = [
  // "qué sabes de X", "qué fue X", "cuéntame sobre X", "explícame X", "háblame de X"
  /(?:^|\s)(qué sabes|que sabes|qué fue|que fue|qué es|que es)(?:\s|$)/i,
  /(?:^|\s)(cuéntame|cuentame|háblame|hablame|explícame|explicame|dime)\b.*\b(sobre|de|acerca)\b/i,
  /\b(explain|tell me about|what is|what was|what were)\b/i,
  // Historical events: guerra, batalla, conquista, tratado, etc.
  /\b(guerra|war|batalla|battle|conquista|conquest|tratado|treaty|imperio|empire)\b/i,
  /(?:^|\s)(revolución|revolution|independencia|independence|reforma|reform)(?:\s|$)/i,
  /\b(edad media|middle ages|renacimiento|renaissance|colonia|colonial)\b/i,
  // Historical figures
  /(?:^|\s)(quién fue|who was|quién inventó|who invented|biografía|biography)(?:\s|$)/i,
  // Established concepts
  /\b(leyes de|laws of)\b/i,
  /(?:^|\s)(constitución|constitution|doctrina|doctrine)(?:\s|$)/i,
]

// Indicators that even a "knowledge-sounding" query needs fresh data
// Note: avoid \b around accented chars (JS regex \b doesn't support Unicode)
const RECENCY_INDICATORS = /(?:^|\s)(hoy|today|ahora|now|actual|current|últim[oa]s?|latest|reciente|recent|202[4-9]|20[3-9]\d|este año|this year|esta semana|this week|ayer|yesterday)(?:\s|$|[?,.])/i

// Fuerza SPORTSQUERY — consultas deportivas con resultados, marcadores, tabla, etc.
// Debe correr ANTES de FORCE_SEARCH_PATTERNS para no caer en webSearch genérico
const FORCE_SPORTS_PATTERNS = [
  // Resultados / marcadores
  /\b(resultados?|marcador(es)?|scores?)\b/i,
  /(?:^|\s)(últimos|ultimos)\b.*\b(partidos?|juegos?|encuentros?)\b/i,
  // "cómo quedó/terminó/ganó" — use (?:^|\s) for accented words (\b fails with Unicode)
  /(?:^|\s)(cómo|como|cuánto|cuanto)\b.*(quedó|quedo|terminó|termino|ganó|gano)(?:\s|$|[?,.])/i,
  // Tabla de posiciones / standings
  /\b(tabla\s+de\s+posiciones|tabla\s+general|standings?|clasificaci[oó]n|posiciones)\b/i,
  // Próximos partidos / calendario
  /(?:^|\s)(próximos|proximos)\b.*\b(partidos?|juegos?|encuentros?)\b/i,
  // "última jornada" — ú is non-word char so \b fails, use (?:^|\s)
  /\b(calend(a|e)rio|fixture|jornada\s+\d+|jornada\s+siguiente|jornada\s+pasada|ultima\s+jornada|jornada\s+anterior)\b/i,
  /(?:^|\s)(última\s+jornada)(?:\s|$|[?,.])/i,
  // bare "jornada" + any known league (order-independent)
  /\bjornada\b.*(liga\s*mx|ligamx|la\s+liga|laliga|premier|bundesliga|serie\s+a|champions|ligue)/i,
  /(liga\s*mx|ligamx|la\s+liga|laliga|premier|bundesliga|serie\s+a|champions|ligue).*\bjornada\b/i,
  // bare "jornada" when asking how it went / results
  /\bjornada\b.*(estuvo|fue|quedó|quedo|terminó|termino|salió|salio)/i,
  /(?:como|cómo|qué tal|que tal)\b.*\bjornada\b/i,
  // Ligas específicas + palabras clave deportivas (order-independent with .*|.*)
  /\b(liga\s*mx|ligamx|premier\s+league|bundesliga|serie\s+a|la\s+liga|laliga|ligue\s+1|champions\s+league)\b.*\b(hoy|ayer|semana|jornada|partido|resultado|marcador)\b/i,
  /\b(hoy|ayer|semana|jornada|partido|resultado|marcador)\b.*\b(liga\s*mx|ligamx|premier|bundesliga|serie\s+a|la\s+liga|laliga|champions)\b/i,
  // "juega hoy", "partido de X", "juego de X"
  // "juega hoy", "jugó ayer" — jugó/jugará end in accented char, use (?:\s|$) at end
  /(?:^|\s)(juega|juegan|jugaron)(?:\s|$|[?,.])/i,
  /(?:^|\s)(jugó|jugara|jugará)/i,
  /\b(partido\s+de|juego\s+de|encuentro\s+de)\b.*\b(hoy|ayer|mañana|esta semana|semana pasada)\b/i,
]


const FORCE_SEARCH_PATTERNS = [
  /\b(20[2-9][4-9]|20[3-9]\d)\b/,          // años después del cutoff (2024+)
  /\b(hoy|today|ahorita|ahora|right now)\b.*\b(precio|price|clima|weather|dólar|dollar)\b/i,
  /\b(últimas?|latest|reciente|recent|noticias?|news|breaking)\b/i,
  /\b(precio|cotización|exchange rate)\b.*\b(dólar|euro|bitcoin|crypto)\b/i,
]

// Fuerza GETDATETIME
const FORCE_DATETIME_PATTERNS = [
  /\b(qué hora|what time|que hora)\b/i,
  /\b(qué día|what day|qué fecha|what date|en qué fecha)\b/i,
  /\b(today'?s date|what is today|what's today)\b/i,
]

export async function routeQuery(query: string): Promise<RouterResult> {
  const normalizedQuery = normalizeQuery(query)

  // Heuristic checks — order matters: FORCE_NONE first, then SEARCH, then DATETIME
  for (const pattern of FORCE_NONE_PATTERNS) {
    if (pattern.test(normalizedQuery)) {
      return { decision: 'none', confidence: 1, source: 'heuristic' }
    }
  }

  for (const pattern of FORCE_SPORTS_PATTERNS) {
    if (pattern.test(normalizedQuery)) {
      return { decision: 'sportsQuery', confidence: 1, source: 'heuristic' }
    }
  }

  for (const pattern of FORCE_SEARCH_PATTERNS) {
    if (pattern.test(normalizedQuery)) {
      return { decision: 'webSearch', confidence: 1, source: 'heuristic' }
    }
  }

  for (const pattern of FORCE_DATETIME_PATTERNS) {
    if (pattern.test(normalizedQuery)) {
      return { decision: 'getDateTime', confidence: 1, source: 'heuristic' }
    }
  }

  // Knowledge question check: if it sounds like a history/knowledge question
  // AND does NOT have recency indicators, force NONE
  const hasRecency = RECENCY_INDICATORS.test(normalizedQuery)
  if (!hasRecency) {
    for (const pattern of KNOWLEDGE_QUESTION_PATTERNS) {
      if (pattern.test(normalizedQuery)) {
        return { decision: 'none', confidence: 0.9, source: 'heuristic' }
      }
    }
  }

  // Fallback to LLM router if no heuristic match
  try {
    const llmResponse = await chat(
      [{ role: 'user', content: normalizedQuery }],
      ROUTER_SYSTEM_PROMPT,
    )
    const parsed = JSON.parse(llmResponse) as { tool: RoutingDecision; confidence: number }
    if (['webSearch', 'getDateTime', 'sportsQuery', 'none'].includes(parsed.tool)) {
      // If LLM says "none" but with low confidence, default to webSearch
      // Better to search unnecessarily than to hallucinate about unknown topics
      if (parsed.tool === 'none' && parsed.confidence < 0.7) {
        return { decision: 'webSearch', confidence: parsed.confidence, source: 'llm' }
      }
      return { decision: parsed.tool, confidence: parsed.confidence, source: 'llm' }
    }
    // Fallback if LLM returns an invalid tool — search to be safe
    return { decision: 'webSearch', confidence: 0.5, source: 'llm' }
  } catch (error) {
    // Fallback if LLM call fails or returns malformed JSON — search to be safe
    return { decision: 'webSearch', confidence: 0, source: 'llm' }
  }
}
